/**
 * Token-bucket rate limiter with a fair FIFO queue.
 *
 * Groq free tier (llama-3.3-70b-versatile): ~30 rpm / 14,400 rpd.
 * We target 20 rpm to leave comfortable headroom under the real limit.
 *
 * Why 20 and not 25:
 *   - The Groq free-tier counter is shared across ALL requests made with the
 *     same API key, including cold-start retries and the case-generation call.
 *   - 20 rpm = 1 request every 3s, which leaves enough room for the
 *     case-generation burst (1 heavy call) plus a steady stream of
 *     interrogation questions.
 *
 * Why a FIFO queue:
 *   The previous implementation computed the wait time for 1 token and slept
 *   that exact amount, but multiple concurrent callers would all sleep the
 *   SAME amount and then race to consume the same single token. The loser
 *   silently returned without a token, defeating the limiter entirely.
 *   The FIFO queue serializes acquisitions so each caller truly waits its
 *   turn and each token goes to exactly one caller.
 */

export interface RateLimiterConfig {
  /** Max tokens (requests) in the bucket. */
  maxTokens: number;
  /** Tokens refilled per millisecond. */
  refillRatePerMs: number;
  /** Initial tokens (default = maxTokens). */
  initialTokens?: number;
}

/** Default config: 20 rpm = 1 token per 3000ms. */
const DEFAULT_CONFIG: RateLimiterConfig = {
  maxTokens: 20,
  refillRatePerMs: 20 / 60_000, // 20 tokens per 60,000ms
};

export class TokenBucketLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly config: RateLimiterConfig;
  /** FIFO chain of pending acquirers. Each entry resolves once it's its turn. */
  private tail: Promise<void> = Promise.resolve();

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.tokens = this.config.initialTokens ?? this.config.maxTokens;
    this.lastRefill = Date.now();
  }

  /** Refill tokens based on elapsed time. Caller must hold the chain. */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    const added = elapsed * this.config.refillRatePerMs;
    this.tokens = Math.min(this.config.maxTokens, this.tokens + added);
    this.lastRefill = now;
  }

  /**
   * Try to consume 1 token without blocking.
   * Returns true if allowed, false if rate-limited.
   * Does NOT use the FIFO queue — only use for opportunistic checks.
   */
  tryAcquire(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /**
   * Consume 1 token. If none available, wait until one is refilled.
   * Serialized through a FIFO promise chain so concurrent callers each
   * get a distinct token (no races, no phantom consumptions).
   *
   * @returns the time waited in ms (0 if no wait needed).
   */
  async acquire(): Promise<number> {
    const t0 = Date.now();
    // Chain onto the tail. This guarantees only one acquirer runs at a time.
    const prevTail = this.tail;
    let resolveTurn!: () => void;
    this.tail = new Promise<void>((resolve) => {
      resolveTurn = resolve;
    });

    try {
      await prevTail;
      this.refill();
      if (this.tokens < 1) {
        // Wait just long enough for 1 token to refill.
        const waitMs = Math.ceil((1 - this.tokens) / this.config.refillRatePerMs);
        await new Promise((r) => setTimeout(r, waitMs));
        this.refill();
      }
      // Consume 1 token (clamp to 0 in case of floating-point drift).
      this.tokens = Math.max(0, this.tokens - 1);
      return Date.now() - t0;
    } finally {
      // Release the next acquirer in the chain.
      resolveTurn();
    }
  }

  /** Current available tokens (for debugging). */
  get available(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  /** Time until next token available (ms). */
  get timeToNext(): number {
    if (this.tokens >= 1) return 0;
    return Math.ceil((1 - this.tokens) / this.config.refillRatePerMs);
  }
}

/**
 * Global singleton limiter for all Groq API calls.
 * 20 rpm gives ~10 rpm headroom under Groq's 30 rpm free-tier limit,
 * which absorbs short bursts without tripping the upstream 429.
 */
export const globalLimiter = new TokenBucketLimiter();

/**
 * Wrap an async LLM call with rate limiting.
 * If rate-limited, waits until a token is available, then calls fn.
 *
 * NOTE: This only enforces OUR local limit. The caller is still responsible
 * for handling upstream 429s with retries/backoff (see llm.ts).
 *
 * @param fn - The async function to call (typically a Groq API call)
 * @returns The result of fn, or throws if fn throws
 */
export async function rateLimitedCall<T>(fn: () => Promise<T>): Promise<T> {
  const waited = await globalLimiter.acquire();
  if (waited > 0) {
    console.log(`[rate-limiter] Waited ${waited}ms for token. Available: ${globalLimiter.available}`);
  }
  return fn();
}
