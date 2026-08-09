/**
 * POST /api/ai-tick — Autonomous suspect event.
 * Accepts systemPrompt directly (works with AI-generated cases).
 */

import { NextResponse } from "next/server";
import { generateAutonomousEvent } from "@/lib/ai/llm";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { suspectId, suspectName, suspectAvatar, systemPrompt, recentContext, stressLevel } = body;

    if (!systemPrompt) {
      return NextResponse.json({ error: "missing_system_prompt" }, { status: 400 });
    }

    const t0 = Date.now();
    const event = await generateAutonomousEvent(
      systemPrompt,
      recentContext || "Silencio en la sala.",
      stressLevel || 30
    );

    if (!event.text || event.text.length < 2) {
      return NextResponse.json({ skipped: true, ms: Date.now() - t0 });
    }

    return NextResponse.json({
      event: {
        suspectId: suspectId ?? "unknown",
        suspectName: suspectName ?? "SOSPECHOSO",
        avatar: suspectAvatar ?? "[?]",
        kind: event.kind,
        text: event.text,
      },
      ms: Date.now() - t0,
    });
  } catch (err) {
    console.error("[ai-tick] failed:", err);
    return NextResponse.json({ error: "ai_tick_failed" }, { status: 500 });
  }
}
