/**
 * POST /api/judge — Evaluate the final vote.
 */

import { NextResponse } from "next/server";
import { evaluateVote } from "@/lib/ai/judge";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { suspectId, suspectName, suspectIsGuilty, votes, conversationSummary, stressHistory } = body;
    if (!suspectId || !votes || !Array.isArray(votes)) {
      return NextResponse.json({ error: "missing_fields" }, { status: 400 });
    }
    const verdict = await evaluateVote(
      suspectId,
      votes,
      conversationSummary || "Sin resumen disponible.",
      stressHistory || "Sin datos de estrés.",
      typeof suspectIsGuilty === "boolean" ? suspectIsGuilty : undefined,
      typeof suspectName === "string" ? suspectName : undefined
    );
    return NextResponse.json(verdict);
  } catch (err) {
    console.error("[judge] failed:", err);
    return NextResponse.json({ error: "judge_error" }, { status: 500 });
  }
}
