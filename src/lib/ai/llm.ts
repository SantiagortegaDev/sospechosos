/**
 * LLM wrapper — Groq (Llama 3.3 70B).
 * Now includes conversation history for memory.
 */

import "server-only";
import Groq from "groq-sdk";

let _groq: Groq | null = null;

export function getClient(): Groq {
  if (_groq) return _groq;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not set.");
  _groq = new Groq({ apiKey });
  return _groq;
}

const MODEL = "llama-3.3-70b-versatile";

const SPANISH_INSTRUCTION = `\n\nIDIOMA: Debes responder SIEMPRE en español. Toda tu salida debe estar en español natural. No mezcles inglés. Tu personaje habla español como lengua materna.`;

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
  /** True if the call failed due to Groq rate limit (429). */
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

  const messages: Array<
    | { role: "system"; content: string }
    | { role: "user"; content: string }
    | { role: "assistant"; content: string }
  > = [
    { role: "system", content: input.systemPrompt + stressModifier + SPANISH_INSTRUCTION },
    // Include last 10 turns of conversation for memory
    ...input.history.slice(-20),
    { role: "user", content: input.question },
  ];

  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages,
      temperature: 0.7,
      max_tokens: 250,
    });

    const text =
      completion.choices?.[0]?.message?.content?.trim() ??
      "No tengo nada más que decir.";

    return { text, ms: Date.now() - t0 };
  } catch (err) {
    const errMsg = (err as Error).message ?? "";
    console.error("[llm] generateSuspectReply failed:", errMsg);

    // Detect rate limit (429) specifically — the user is out of Groq tokens
    // for the day. Give them a useful in-character message that explains it
    // instead of the same "abogado" line on every question.
    if (errMsg.includes("429") || errMsg.includes("rate_limit")) {
      return {
        text: "[Límite de Groq alcanzado — espera unos minutos o usa una seed ya generada. El sospechoso permanece en silencio.]",
        ms: Date.now() - t0,
        rateLimited: true,
      };
    }

    // For other errors (network, server, etc.) — return a VARIED in-character
    // fallback, not always the same "abogado" line. The detective still gets
    // something to react to, and it doesn't break immersion as badly.
    const fallbacks = [
      "No tengo nada más que decir.",
      "Esa pregunta no la voy a responder.",
      "Ya te lo dije. No insistas.",
      "Silencio.",
      "No recuerdo.",
      "¿Por qué me preguntas eso otra vez?",
      "No veo cómo eso sea relevante.",
      "Paso.",
      "No tengo por qué explicarte nada.",
      "Ya respondí lo suficiente.",
    ];
    const text = fallbacks[Math.floor(Math.random() * fallbacks.length)];
    return { text, ms: Date.now() - t0 };
  }
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
  const groq = getClient();

  let stressContext = "";
  if (stressLevel > 70) {
    stressContext = "Estás muy nervioso/a. Tu estrés es alto. Puedes decir algo inesperado, murmurar, o ponerte defensive.";
  } else if (stressLevel > 40) {
    stressContext = "Estás algo tenso pero controlado.";
  } else {
    stressContext = "Estás relativamente tranquilo.";
  }

  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: `${systemPrompt}\n\n${stressContext}${SPANISH_INSTRUCTION}

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
        },
        {
          role: "user",
          content: `Contexto reciente: ${recentContext || "Silencio en la sala."}\n\n¿Qué haces?`,
        },
      ],
      temperature: 0.85,
      max_tokens: 80,
    });

    const raw = (completion.choices?.[0]?.message?.content ?? "").trim();
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
