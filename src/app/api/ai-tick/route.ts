/**
 * POST /api/ai-tick — Autonomous suspect event.
 */

import { NextResponse } from "next/server";
import { findSuspect } from "@/lib/ai/suspects";
import { generateAutonomousEvent } from "@/lib/ai/llm";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { suspectId, recentContext, stressLevel } = body;

    const suspect = findSuspect(suspectId);
    if (!suspect) {
      return NextResponse.json({ error: "unknown_suspect" }, { status: 404 });
    }

    const t0 = Date.now();
    const event = await generateAutonomousEvent(
      suspect.systemPrompt,
      recentContext || "Silencio en la sala.",
      stressLevel || 30
    );

    if (!event.text || event.text.length < 2) {
      return NextResponse.json({ skipped: true, ms: Date.now() - t0 });
    }

    return NextResponse.json({
      event: {
        suspectId: suspect.id,
        suspectName: suspect.name,
        avatar: suspect.avatar,
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
