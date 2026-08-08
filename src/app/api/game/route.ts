import { NextResponse } from "next/server";
import { accuse, getCase, interrogate, startCase } from "@/lib/game/engine";

export const runtime = "nodejs";
export async function GET(request: Request) { const id = new URL(request.url).searchParams.get("caseId") ?? "meridian-escrow"; return NextResponse.json(getCase(id)); }
export async function POST(request: Request) {
  let body: { action?: string; caseId?: string; suspectId?: string; question?: string }; try { body = await request.json(); } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
  const caseId = typeof body.caseId === "string" ? body.caseId : "meridian-escrow";
  try { const state = body.action === "start" ? startCase(caseId) : body.action === "accuse" && typeof body.suspectId === "string" ? accuse(caseId, body.suspectId) : body.action === "interrogate" && typeof body.suspectId === "string" && typeof body.question === "string" ? await interrogate(caseId, body.suspectId, body.question, request.headers.get("x-forwarded-for") ?? "anonymous") : null; if (!state) return NextResponse.json({ error: "Acción inválida." }, { status: 400 }); return NextResponse.json(state); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible actualizar el caso." }, { status: 422 }); }
}
