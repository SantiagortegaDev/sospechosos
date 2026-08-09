/**
 * LLM wrapper — Groq (free tier: 30 rpm / 14,400 rpd).
 * Uses groq-sdk with llama-3.3-70b-versatile.
 * Includes conversation history for memory.
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

const MODEL = "llama-3.3-70b-versatile";

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
  /** True if the call failed due to rate limit (429). */
  rateLimited?: boolean;
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

  const MAX_RETRIES = 1;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await rateLimitedCall(() =>
        groq.chat.completions.create({
          model: MODEL,
          messages,
          temperature: 0.7,
          max_tokens: 250,
        })
      );

      const text = response.choices[0]?.message?.content?.trim() ?? "No tengo nada más que decir.";
      return { text, ms: Date.now() - t0 };
    } catch (err) {
      const errMsg = (err as Error).message ?? "";
      console.error(`[llm] generateSuspectReply failed (attempt ${attempt + 1}):`, errMsg);

      // Detect rate limit (429) — bail immediately.
      if (errMsg.includes("429") || errMsg.includes("rate_limit") || errMsg.includes("Rate limit")) {
        return {
          text: "[Límite alcanzado — espera unos minutos. El sospechoso permanece en silencio.]",
          ms: Date.now() - t0,
          rateLimited: true,
        };
      }

      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      // Final fallback — in-character evasion
      const fallbacks = [
        "Mira, no creo que eso tenga importancia ahora.",
        "¿Me puedes repetir la pregunta? Estaba distraído.",
        "Prefiero no hablar de eso por ahora.",
        "Eso... no sé qué decirte exactamente.",
        "¿Podemos hablar de otra cosa?",
        "No estoy seguro de cómo responder a eso.",
        "Eso no tiene nada que ver con lo que pasó.",
        "Déjame pensar un momento... no, no tengo nada que agregar.",
        "¿Por qué me preguntas eso? No tiene sentido.",
        "No recuerdo los detalles exactos de eso.",
      ];
      const text = fallbacks[Math.floor(Math.random() * fallbacks.length)];
      return { text, ms: Date.now() - t0 };
    }
  }
  return { text: "...", ms: Date.now() - t0 };
}

/**
 * Generate a case using Groq (used by /api/generate-case).
 * Returns raw text that should be JSON.parse'd by the caller.
 */
export async function generateCaseFromSeed(systemPrompt: string, seed: string): Promise<string> {
  const t0 = Date.now();
  const groq = getClient();

  try {
    const response = await rateLimitedCall(() =>
      groq.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Genera el caso para la semilla: ${seed}` },
        ],
        temperature: 0.9,
        max_tokens: 4000,
        response_format: { type: "json_object" },
      })
    );

    const text = response.choices[0]?.message?.content?.trim() ?? "";
    if (!text) throw new Error("Empty response from Groq");
    return text;
  } catch (err) {
    const errMsg = (err as Error).message ?? "";
    console.error(`[llm] generateCaseFromSeed failed:`, errMsg);

    if (errMsg.includes("429") || errMsg.includes("rate_limit") || errMsg.includes("Rate limit")) {
      throw new Error("RATE_LIMITED");
    }

    throw err;
  }
}

/**
 * Judge evaluation using Groq.
 */
export async function generateJudgeVerdict(systemPrompt: string, prompt: string): Promise<string> {
  const groq = getClient();

  try {
    const response = await rateLimitedCall(() =>
      groq.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 400,
      })
    );

    return response.choices[0]?.message?.content?.trim() ?? "";
  } catch (err) {
    console.error("[llm] generateJudgeVerdict failed:", err);
    return "";
  }
}
