/**
 * POST /api/clandestine
 *
 * Triggers a single AI → AI whisper in the clandestine channel. Detectives
 * "overhear" these by late-joining the channel and reading the backfill.
 *
 * Body: {
 *   fromSuspectId: string,
 *   toSuspectId: string,
 *   context?: string,  // e.g. last question the from-suspect was asked
 * }
 *
 * Returns: { text: string, fromSuspectId, fromSuspectName, toSuspectId }
 */

import { NextResponse } from "next/server";
import { findSuspect, SUSPECTS } from "@/lib/ai/suspects";
import { generateClandestineWhisper } from "@/lib/ai/llm";

interface RequestBody {
  fromSuspectId: string;
  toSuspectId: string;
  context?: string;
}

export async function POST(req: Request) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const from = findSuspect(body.fromSuspectId);
  const to =
    body.toSuspectId === body.fromSuspectId
      ? SUSPECTS.find((s) => s.id !== body.fromSuspectId)
      : findSuspect(body.toSuspectId);

  if (!from || !to) {
    return NextResponse.json(
      { error: "unknown_suspect", fromSuspectId: body.fromSuspectId, toSuspectId: body.toSuspectId },
      { status: 404 }
    );
  }

  const text = await generateClandestineWhisper(
    from.name,
    to.name,
    body.context ?? "We are both in separate rooms. They are pressing us."
  );

  return NextResponse.json({
    text,
    fromSuspectId: from.id,
    fromSuspectName: from.name,
    toSuspectId: to.id,
  });
}
