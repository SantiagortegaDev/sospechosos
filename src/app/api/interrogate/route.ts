/**
 * POST /api/interrogate
 *
 * Body: {
 *   suspectId: string,
 *   question: string,
 *   history: Array<{ role: "user"|"assistant", content: string }>,
 *   previousBiometrics?: BiometricState,
 * }
 *
 * Returns: {
 *   answer: { text, suspectId, suspectName, flagged },
 *   biometrics: BiometricState,
 *   trigger?: string,
 *   ms: number,
 * }
 *
 * Flow:
 *   1. Receive the detective's question (already published to the interrogation
 *      channel by the client, so the other detective sees it instantly).
 *   2. Run the biometric delta engine on the question to update the suspect's
 *      stress / bpm / coherence.
 *   3. Invoke the LLM with the suspect's system prompt + history.
 *   4. Detect whether the AI "admitted" something material (flagged).
 *   5. Return the answer + new biometric state to the client. The client then
 *      publishes both the answer (to interrogation channel) and the biometric
 *      sample (to biometrics channel, ephemeral).
 *
 * The server stays stateless — biometric "previous" is passed in by the client,
 * which keeps it in React state. This is fine for the hackathon; for production
 * you'd persist per-suspect state in your DB or in Portal channel state.
 */

import { NextResponse } from "next/server";
import { findSuspect } from "@/lib/ai/suspects";
import { nextBiometric, detectFlag, type BiometricState } from "@/lib/ai/biometrics";
import { generateSuspectReply } from "@/lib/ai/llm";

interface RequestBody {
  suspectId: string;
  question: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  previousBiometrics?: BiometricState;
}

export async function POST(req: Request) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.suspectId || typeof body.question !== "string") {
    return NextResponse.json(
      { error: "missing_required_fields", required: ["suspectId", "question"] },
      { status: 400 }
    );
  }

  const suspect = findSuspect(body.suspectId);
  if (!suspect) {
    return NextResponse.json(
      { error: "unknown_suspect", suspectId: body.suspectId },
      { status: 404 }
    );
  }

  // 1) Biometric delta — fast, deterministic, no LLM round-trip.
  const bioUpdate = nextBiometric(
    suspect,
    body.question,
    body.previousBiometrics
  );

  // 2) LLM reply — single round-trip; the wrapper handles errors with a character-consistent fallback.
  const reply = await generateSuspectReply({
    systemPrompt: suspect.systemPrompt,
    history: Array.isArray(body.history) ? body.history : [],
    question: body.question,
  });

  const flagged = detectFlag(reply.text);

  return NextResponse.json({
    answer: {
      text: reply.text,
      suspectId: suspect.id,
      suspectName: suspect.name,
      flagged,
    },
    biometrics: bioUpdate.state,
    trigger: bioUpdate.trigger,
    ms: reply.ms,
  });
}
