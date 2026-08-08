/**
 * LLM wrapper.
 *
 * For this sandboxed build we use the in-environment `z-ai-web-dev-sdk` (server-only).
 * For production / hackathon judging on your own infra, swap the body of
 * `generateSuspectReply` to call OpenAI (`openai` npm pkg) or Groq (`groq-sdk`)
 * — the rest of the system doesn't care which provider you use.
 *
 * Why a wrapper: the rest of the codebase never imports the SDK directly, so
 * swapping providers is a one-file change.
 */

import "server-only";
import ZAI from "z-ai-web-dev-sdk";

let _zai: ZAI | null = null;

async function getClient(): Promise<ZAI> {
  if (_zai) return _zai;
  _zai = await ZAI.create();
  return _zai;
}

export interface GenerateReplyInput {
  systemPrompt: string;
  /** Conversation history (oldest first). Each entry is already role-tagged. */
  history: Array<{ role: "user" | "assistant"; content: string }>;
  /** The new detective question. */
  question: string;
}

export interface GenerateReplyOutput {
  text: string;
  ms: number;
}

export async function generateSuspectReply(
  input: GenerateReplyInput
): Promise<GenerateReplyOutput> {
  const t0 = Date.now();
  const zai = await getClient();

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: input.systemPrompt },
    ...input.history,
    { role: "user", content: input.question },
  ];

  try {
    const completion = await zai.chat.completions.create({
      messages,
      temperature: 0.7,
      max_tokens: 220,
    });

    const text =
      completion.choices?.[0]?.message?.content?.trim() ??
      "I have nothing further to say.";

    return { text, ms: Date.now() - t0 };
  } catch (err) {
     
    console.error("[llm] generateSuspectReply failed:", err);
    return {
      text: "I'd like to speak with my attorney before continuing.",
      ms: Date.now() - t0,
    };
  }
}

/**
 * Generates a short "whisper" from one suspect to another in the clandestine
 * channel. Used to make the AI layer feel alive — detectives who late-join the
 * clandestine channel see the backfill and feel like they overheard something.
 */
export async function generateClandestineWhisper(
  fromSuspectName: string,
  toSuspectName: string,
  context: string
): Promise<string> {
  const zai = await getClient();

  try {
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are ${fromSuspectName}. You are whispering to ${toSuspectName} in a back-channel while both of you are being interrogated in separate rooms. Keep it under 18 words. No quotation marks. No narration. Pure whispered text. Anxious, coded, plausible deniability.`,
        },
        {
          role: "user",
          content: `Context: ${context}\n\nWhisper to ${toSuspectName}:`,
        },
      ],
      temperature: 0.85,
      max_tokens: 60,
    });

    return (
      completion.choices?.[0]?.message?.content?.trim() ??
      "Don't say anything."
    );
  } catch (err) {
     
    console.error("[llm] generateClandestineWhisper failed:", err);
    return "Keep your mouth shut.";
  }
}
