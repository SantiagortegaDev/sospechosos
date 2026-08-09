/**
 * LLM wrapper — Groq (free tier: ~30 rpm / 14,400 rpd).
 *
 * Strategy:
 *   1. Primary model: `llama-3.3-70b-versatile` (best quality).
 *   2. If the primary returns 429 (rate limited) after retries, fall back to
 *      `llama-3.1-8b-instant` which has a much higher rpm allowance on the
 *      free tier and is plenty good for short interrogation replies.
 *   3. All calls go through `rateLimitedCall()` (20 rpm local limiter).
 *   4. On 429 we retry with exponential backoff (1.5s, 3s, 6s) before
 *      falling back, so transient bursts don't immediately surface to the
 *      user as "the suspect stays silent".
 */

import "server-only";
import Groq from "groq-sdk";
import { rateLimitedCall } from "./rate-limiter";

let _groq: Groq | null = null;

export function getClient(): Groq {
  if (_groq) return _groq;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not set.");
  _groq = new Groq({ apiKey });
  return _groq;
}

/** Primary model — best quality, lower rpm headroom on free tier. */
const MODEL_PRIMARY = "llama-3.3-70b-versatile";
/** Fallback model — much higher rpm allowance, plenty for short replies. */
const MODEL_FALLBACK = "llama-3.1-8b-instant";

const SPANISH_INSTRUCTION = `\n\nIDIOMA: Debes responder SIEMPRE en español. Toda tu salida debe estar en español natural. No mezcles inglés. Tu personaje habla español como lengua materna.

REGLA CRÍTICA: NUNCA te niegues a responder. NUNCA digas frases como "No quiero responder", "No voy a responder", "Ya te lo dije", "No insistas", "Paso", "Silencio", "No tengo nada que decir". SIEMPRE debes dar una respuesta — puede ser una mentira, una evasión, una contra-pregunta, o una desviación, pero NUNCA un rechazo directo. El sospechoso siempre habla.`;

export interface GenerateReplyInput {
  systemPrompt: string;
  /** Conversation history (oldest first). */
  history: Array<{ role: "user" | "assistant"; content: string }>;
  /** The new detective question. */
  question: string;
  /** Current stress level 0-100 (affects response) */
  stressLevel?: number;
}

export interface GenerateReplyOutput {
  text: string;
  stressLevel?: number;
  ms: number;
  /** True if the call failed due to rate limit (429) on BOTH models. */
  rateLimited?: boolean;
  /** Which model actually produced the reply (for debugging). */
  modelUsed?: string;
}

/** Detect whether a Groq error is a rate-limit (429) response. */
function isRateLimitError(err: unknown): boolean {
  const e = err as { message?: string; status?: number };
  const msg = (e?.message ?? "").toLowerCase();
  return (
    e?.status === 429 ||
    msg.includes("429") ||
    msg.includes("rate_limit") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests")
  );
}

/** Sleep helper. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Call Groq with retry + backoff for 429s.
 *
 * - Up to `maxRetries` retries on 429 with delays [1500, 3000, 6000] ms.
 * - Non-429 errors propagate immediately.
 * - Returns the raw Groq response.
 */
async function callWithRetry(
  groq: Groq,
  params: {
    model: string;
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    temperature: number;
    max_tokens: number;
    response_format?: { type: "json_object" };
  },
  maxRetries = 3
): Promise<{ response: any; model: string; rateLimited: boolean }> {
  const backoffMs = [1500, 3000, 6000];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await rateLimitedCall(() =>
        groq.chat.completions.create({
          model: params.model,
          messages: params.messages,
          temperature: params.temperature,
          max_tokens: params.max_tokens,
          ...(params.response_format ? { response_format: params.response_format } : {}),
        } as any)
      );
      return { response, model: params.model, rateLimited: false };
    } catch (err) {
      lastErr = err;
      if (isRateLimitError(err) && attempt < maxRetries) {
        const wait = backoffMs[attempt] ?? 6000;
        console.warn(
          `[llm] 429 on ${params.model} (attempt ${attempt + 1}/${maxRetries + 1}). Backing off ${wait}ms.`
        );
        await sleep(wait);
        continue;
      }
      // Non-retryable, or out of retries.
      if (isRateLimitError(err)) {
        return { response: null, model: params.model, rateLimited: true };
      }
      throw err;
    }
  }
  // All retries exhausted on 429.
  return { response: null, model: params.model, rateLimited: true };
}

export async function generateSuspectReply(
  input: GenerateReplyInput
): Promise<GenerateReplyOutput> {
  const t0 = Date.now();
  const groq = getClient();

  // Build stress modifier for system prompt
  let stressModifier = "";
  if (input.stressLevel !== undefined) {
    const s = input.stressLevel;
    if (s > 80) {
      stressModifier = `\n\nESTADO ACTUAL: Estrés EXTREMO (${s}/100). Estás al límite. Tus manos tiemblan. Puedes dejar escapar algo que no deberías. Tus respuestas son más cortas, más erráticas. Quizás mientes mal o te contradices.`;
    } else if (s > 60) {
      stressModifier = `\n\nESTADO ACTUAL: Estrés ALTO (${s}/100). Estás incómodo. Tus respuestas son más defensivas. Evitas contacto visual. Puede que des demasiada información o cambies de tema.`;
    } else if (s > 40) {
      stressModifier = `\n\nESTADO ACTUAL: Estrés MODERADO (${s}/100). Algo tenso pero controlado. Mantienes tu fachada pero con grietas ocasionales.`;
    } else {
      stressModifier = `\n\nESTADO ACTUAL: Tranquilo/a (${s}/100). Controlado, confiado. Respondes con calma y precisión.`;
    }
  }

  const systemInstruction = input.systemPrompt + stressModifier + SPANISH_INSTRUCTION;

  // Build conversation history for Groq format
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemInstruction },
  ];

  // Add history (last 20 turns)
  for (const turn of input.history.slice(-20)) {
    messages.push({
      role: turn.role === "user" ? "user" : "assistant",
      content: turn.content,
    });
  }

  // Add the new question
  messages.push({ role: "user", content: input.question });

  // --- Try primary model with retries ---
  let result = await callWithRetry(groq, {
    model: MODEL_PRIMARY,
    messages,
    temperature: 0.7,
    max_tokens: 250,
  });

  // --- Fallback to lighter model if primary was rate-limited ---
  if (result.rateLimited) {
    console.warn(`[llm] Primary ${MODEL_PRIMARY} rate-limited. Falling back to ${MODEL_FALLBACK}.`);
    result = await callWithRetry(groq, {
      model: MODEL_FALLBACK,
      messages,
      temperature: 0.7,
      max_tokens: 250,
    });
  }

  if (result.response) {
    const text =
      result.response.choices[0]?.message?.content?.trim() ??
      "No tengo nada más que decir.";
    return { text, ms: Date.now() - t0, modelUsed: result.model };
  }

  // Both models rate-limited — return in-character silence, but flag it.
  return {
    text: "[El sospechoso respira hondo y guarda silencio por un momento.]",
    ms: Date.now() - t0,
    rateLimited: true,
    modelUsed: "none",
  };
}

/**
 * Generate a case using Groq (used by /api/generate-case).
 * Returns raw text that should be JSON.parse'd by the caller.
 * Uses primary model with retries; falls back to the lighter model if 429.
 */
export async function generateCaseFromSeed(systemPrompt: string, seed: string): Promise<string> {
  const t0 = Date.now();
  const groq = getClient();

  const buildParams = (model: string) => ({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Genera el caso para la semilla: ${seed}` },
    ],
    temperature: 0.9,
    max_tokens: 4000,
    response_format: { type: "json_object" as const },
  });

  let result = await callWithRetry(groq, buildParams(MODEL_PRIMARY), 2);

  if (result.rateLimited) {
    console.warn(`[llm] Case gen: primary 429, falling back to ${MODEL_FALLBACK}.`);
    result = await callWithRetry(groq, buildParams(MODEL_FALLBACK), 2);
  }

  if (result.response) {
    const text = result.response.choices[0]?.message?.content?.trim() ?? "";
    if (!text) throw new Error("Empty response from Groq");
    return text;
  }

  throw new Error("RATE_LIMITED");
}

/**
 * Judge evaluation using Groq.
 * Same retry + fallback strategy.
 */
export async function generateJudgeVerdict(systemPrompt: string, prompt: string): Promise<string> {
  const groq = getClient();

  const buildParams = (model: string) => ({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 400,
  });

  let result = await callWithRetry(groq, buildParams(MODEL_PRIMARY), 2);

  if (result.rateLimited) {
    console.warn(`[llm] Judge: primary 429, falling back to ${MODEL_FALLBACK}.`);
    result = await callWithRetry(groq, buildParams(MODEL_FALLBACK), 2);
  }

  if (result.response) {
    return result.response.choices[0]?.message?.content?.trim() ?? "";
  }

  // Both models rate-limited — return empty so caller can use a deterministic fallback.
  console.error("[llm] Judge: both models rate-limited.");
  return "";
}
