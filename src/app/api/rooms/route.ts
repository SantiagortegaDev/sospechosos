/**
 * POST /api/rooms — Create a new room.
 * GET /api/rooms?code=xxx — Check if a room exists.
 */

import { NextResponse } from "next/server";
import { createRoom, getRoom, roomExists } from "@/lib/store/rooms";
import type { RoomSettings } from "@/lib/types/game";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { hostId, hostUsername, settings } = body as {
      hostId?: string;
      hostUsername?: string;
      settings?: Partial<RoomSettings>;
    };

    if (!hostId || !hostUsername) {
      return NextResponse.json({ error: "missing_host_info" }, { status: 400 });
    }

    const roomSettings: RoomSettings = {
      roundTimeMinutes: settings?.roundTimeMinutes ?? 5,
      maxDetectives: settings?.maxDetectives ?? 4,
    };

    const room = createRoom(hostId, hostUsername, roomSettings);

    return NextResponse.json({
      code: room.code,
      settings: room.settings,
      playerCount: room.players.size,
    });
  } catch (err) {
    console.error("[rooms] create failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return NextResponse.json({ error: "missing_code" }, { status: 400 });
  }

  const room = getRoom(code);
  if (!room) {
    return NextResponse.json({ exists: false });
  }

  return NextResponse.json({
    exists: true,
    code: room.code,
    status: room.status,
    settings: room.settings,
    playerCount: room.players.size,
    maxDetectives: room.settings.maxDetectives,
    players: Array.from(room.players.values()).map(p => ({
      username: p.username,
      isHost: p.isHost,
    })),
  });
}
