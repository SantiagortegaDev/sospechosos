/**
 * LLM wrapper — Google Gemini (via Google AI Studio).
 * Uses @google/generative-ai SDK.
 * Includes conversation history for memory.
 */

import "server-only";
import { GoogleGenerativeAI } from "@google/generative-ai";

let _genAI: GoogleGenerativeAI | null = null;

export function getClient(): GoogleGenerativeAI {
  if (_genAI) return _genAI;
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_AI_API_KEY is not set.");
  _genAI = new GoogleGenerativeAI(apiKey);
  return _genAI;
}

const MODEL = "gemini-2.0-flash";

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
  const genAI = getClient();

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

  // Build conversation history for Gemini format
  // Gemini uses "user" and "model" roles (not "assistant")
  const historyContents = input.history.slice(-20).map((turn) => ({
    role: turn.role === "user" ? "user" as const : "model" as const,
    parts: [{ text: turn.content }],
  }));

  const MAX_RETRIES = 1;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const model = genAI.getGenerativeModel({
        model: MODEL,
        systemInstruction,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 250,
        },
      });

      const chat = model.startChat({ history: historyContents });
      const result = await chat.sendMessage(input.question);

      const text =
        result.response.text()?.trim() ?? "No tengo nada más que decir.";

      return { text, ms: Date.now() - t0 };
    } catch (err) {
      const errMsg = (err as Error).message ?? "";
      console.error(`[llm] generateSuspectReply failed (attempt ${attempt + 1}):`, errMsg);

      // Detect rate limit (429) — bail immediately.
      if (errMsg.includes("429") || errMsg.includes("rate_limit") || errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("QUOTA")) {
        return {
          text: "[Límite de Gemini alcanzado — espera unos minutos. El sospechoso permanece en silencio.]",
          ms: Date.now() - t0,
          rateLimited: true,
        };
      }

      // Safety filter triggered — return in-character evasion
      if (errMsg.includes("SAFETY") || errMsg.includes("blocked")) {
        // Gemini safety filters sometimes trigger on interrogation content
        // Return a neutral in-character response
        const safeResponses = [
          "Mira, no creo que eso tenga importancia ahora.",
          "Prefiero no hablar de eso por ahora.",
          "¿Podemos hablar de otra cosa?",
        ];
        return {
          text: safeResponses[Math.floor(Math.random() * safeResponses.length)],
          ms: Date.now() - t0,
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
 * Generate an autonomous AI event — the suspect says something
 * unprompted (thought, comment, nervous tic).
 */
export interface AIEvent {
  kind: "thought" | "comment" | "nervous";
  text: string;
}

export async function generateAutonomousEvent(
  systemPrompt: string,
  recentContext: string,
  stressLevel: number
): Promise<AIEvent> {
  const genAI = getClient();

  let stressContext = "";
  if (stressLevel > 70) {
    stressContext = "Estás muy nervioso/a. Tu estrés es alto. Puedes decir algo inesperado, murmurar, o ponerte defensive.";
  } else if (stressLevel > 40) {
    stressContext = "Estás algo tenso pero controlado.";
  } else {
    stressContext = "Estás relativamente tranquilo.";
  }

  try {
    const model = genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: `${systemPrompt}\n\n${stressContext}${SPANISH_INSTRUCTION}

Estás solo/a en la sala de interrogación. Los detectives están en silencio. Genera UN evento espontáneo:

Opciones:
- THOUGHT: un pensamiento interno (máximo 15 palabras)
- COMMENT: algo que dices en voz alta sin que te pregunten (máximo 20 palabras)
- NERVOUS: un tic nervioso o comportamiento visible (máximo 15 palabras)

Responde en EXACTAMENTE este formato:
THOUGHT|<texto en español>
COMMENT|<texto en español>
NERVOUS|<texto en español>

No añadas nada más.`,
      generationConfig: {
        temperature: 0.85,
        maxOutputTokens: 80,
      },
    });

    const result = await model.generateContent(
      `Contexto reciente: ${recentContext || "Silencio en la sala."}\n\n¿Qué haces?`
    );

    const raw = (result.response.text() ?? "").trim();
    const match = raw.match(/^(THOUGHT|COMMENT|NERVOUS)\|(.+)$/i);
    if (!match) {
      return { kind: "thought", text: raw.slice(0, 80) || "...pensando." };
    }
    const kind = match[1].toLowerCase() as AIEvent["kind"];
    return { kind, text: match[2].trim() };
  } catch (err) {
    console.error("[llm] generateAutonomousEvent failed:", err);
    return { kind: "thought", text: "..." };
  }
}

/**
 * Generate a case using Gemini (used by /api/generate-case).
 * Returns raw text that should be JSON.parse'd by the caller.
 */
export async function generateCaseFromSeed(systemPrompt: string, seed: string): Promise<string> {
  const t0 = Date.now();
  const genAI = getClient();

  try {
    const model = genAI.getGenerativeModel({
      model: MODEL,
      generationConfig: {
        temperature: 0.9,
        maxOutputTokens: 4000,
        responseMimeType: "application/json",
      },
    });

    const result = await model.generateContent(systemPrompt + `\n\nGenera el caso para la semilla: ${seed}`);
    const text = result.response.text()?.trim() ?? "";

    if (!text) throw new Error("Empty response from Gemini");

    return text;
  } catch (err) {
    const errMsg = (err as Error).message ?? "";
    console.error(`[llm] generateCaseFromSeed failed:`, errMsg);

    if (errMsg.includes("429") || errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("QUOTA")) {
      throw new Error("RATE_LIMITED");
    }

    throw err;
  }
}

/**
 * Judge evaluation using Gemini.
 */
export async function generateJudgeVerdict(systemPrompt: string, prompt: string): Promise<string> {
  const genAI = getClient();

  try {
    const model = genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: systemPrompt,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 400,
      },
    });

    const result = await model.generateContent(prompt);
    return result.response.text()?.trim() ?? "";
  } catch (err) {
    console.error("[llm] generateJudgeVerdict failed:", err);
    return "";
  }
}
