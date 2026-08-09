/**
 * Token-bucket rate limiter for Groq API calls.
 *
 * Groq free tier: 30 requests/minute, 14,400 requests/day.
 * We target 25 rpm to stay safely under the limit with margin.
 *
 * All LLM calls MUST go through `rateLimitedCall()` to avoid 429 errors.
 */

export interface RateLimiterConfig {
  /** Max tokens (requests) in the bucket. */
  maxTokens: number;
  /** Tokens refilled per millisecond. */
  refillRatePerMs: number;
  /** Initial tokens (default = maxTokens). */
  initialTokens?: number;
}

/** Default config: 25 rpm = 0.4167 req/s ≈ 1 token per 2400ms. */
const DEFAULT_CONFIG: RateLimiterConfig = {
  maxTokens: 25,
  refillRatePerMs: 25 / 60_000, // 25 tokens per 60,000ms
};

export class TokenBucketLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly config: RateLimiterConfig;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.tokens = this.config.initialTokens ?? this.config.maxTokens;
    this.lastRefill = Date.now();
  }

  /** Refill tokens based on elapsed time. */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    const added = elapsed * this.config.refillRatePerMs;
    this.tokens = Math.min(this.config.maxTokens, this.tokens + added);
    this.lastRefill = now;
  }

  /**
   * Try to consume 1 token. Returns true if allowed, false if rate-limited.
   * Does NOT block — caller must handle the rejection.
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
   * Returns the time waited in ms (0 if no wait needed).
   */
  async acquire(): Promise<number> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return 0;
    }
    // Calculate how long to wait for 1 token
    const waitMs = Math.ceil(1 / this.config.refillRatePerMs);
    await new Promise((r) => setTimeout(r, waitMs));
    // Refill again after waiting
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return waitMs;
    }
    // Edge case: still no token (shouldn't happen with correct math)
    return waitMs;
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
 * 25 rpm gives us 5 rpm headroom under Groq's 30 rpm free tier limit.
 */
export const globalLimiter = new TokenBucketLimiter();

/**
 * Wrap an async LLM call with rate limiting.
 * If rate limited, waits until a token is available, then calls fn.
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
