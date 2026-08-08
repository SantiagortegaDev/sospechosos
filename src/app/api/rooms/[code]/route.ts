/**
 * GET /api/rooms/[code] — Get room details.
 * POST /api/rooms/[code]/join — Join a room.
 * POST /api/rooms/[code]/start — Start the game.
 */

import { NextResponse } from "next/server";
import { getRoom, joinRoom, startGame } from "@/lib/store/rooms";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const room = getRoom(code);
  if (!room) {
    return NextResponse.json({ error: "room_not_found" }, { status: 404 });
  }

  return NextResponse.json({
    code: room.code,
    status: room.status,
    settings: room.settings,
    playerCount: room.players.size,
    players: Array.from(room.players.values()).map(p => ({
      id: p.id,
      username: p.username,
      isHost: p.isHost,
    })),
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const body = await req.json();
  const action = body.action as string;

  if (action === "join") {
    const { playerId, username } = body as { playerId?: string; username?: string };
    if (!playerId || !username) {
      return NextResponse.json({ error: "missing_join_info" }, { status: 400 });
    }
    const result = joinRoom(code, playerId, username);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({
      code: result.room.code,
      username: result.player.username,
      isHost: result.player.isHost,
      playerCount: result.room.players.size,
    });
  }

  if (action === "start") {
    const result = startGame(code);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ code: result.code, status: result.status });
  }

  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}
