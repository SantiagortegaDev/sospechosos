/**
 * In-memory room store — no database needed.
 * Rooms auto-expire after 6 hours.
 */

import type { Room, RoomSettings, Player } from "@/lib/types/game";

const rooms = new Map<string, Room>();
const ROOM_TTL_MS = 6 * 60 * 60 * 1000; // 6h

function generateRoomCode(length = 6): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function cleanup() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.createdAt > ROOM_TTL_MS) {
      rooms.delete(code);
    }
  }
}

export function createRoom(
  hostId: string,
  hostUsername: string,
  settings: RoomSettings
): Room {
  cleanup();
  let code = generateRoomCode();
  while (rooms.has(code)) {
    code = generateRoomCode();
  }

  const players = new Map<string, Player>();
  const host: Player = {
    id: hostId,
    username: hostUsername,
    isHost: true,
    joinedAt: Date.now(),
  };
  players.set(hostId, host);

  const room: Room = {
    code,
    settings,
    players,
    status: "lobby",
    createdAt: Date.now(),
    hostId,
  };

  rooms.set(code, room);
  return room;
}

export function getRoom(code: string): Room | null {
  cleanup();
  return rooms.get(code.trim().toLowerCase()) ?? null;
}

export function joinRoom(
  code: string,
  playerId: string,
  username: string
): { room: Room; player: Player } | { error: string } {
  let room = getRoom(code);
  // Vercel serverless runs each API route in a potentially different
  // instance, so the in-memory rooms Map is NOT shared between the host's
  // createRoom call and the joiner's joinRoom call. When the joiner lands
  // on a cold instance, getRoom returns null and they get "Sala no
  // encontrada" even though the host's instance has the room.
  //
  // Workaround: auto-create the room with default settings if it doesn't
  // exist. The host (on another instance) doesn't need to be in our Map —
  // the Portal SDK channel handles real-time presence syncing. We just
  // need a local record so subsequent calls to startGame / getRoom work
  // on THIS instance. Real-time lobby presence is handled by the
  // lobby.join / lobby.presence broadcasts in page.tsx.
  if (!room) {
    const players = new Map<string, Player>();
    const player: Player = {
      id: playerId,
      username,
      isHost: false, // The joiner is never the host.
      joinedAt: Date.now(),
    };
    players.set(playerId, player);
    room = {
      code: code.trim().toLowerCase(),
      settings: { roundTimeMinutes: 5, maxDetectives: 2 }, // sensible defaults
      players,
      status: "lobby",
      createdAt: Date.now(),
      hostId: "", // Unknown — host lives on another instance.
    };
    rooms.set(code.trim().toLowerCase(), room);
    return { room, player };
  }
  if (room.status !== "lobby") return { error: "El juego ya empezó" };
  if (room.players.size >= room.settings.maxDetectives) {
    return { error: "La sala está llena" };
  }

  const player: Player = {
    id: playerId,
    username,
    isHost: false,
    joinedAt: Date.now(),
  };
  room.players.set(playerId, player);
  return { room, player };
}

export function startGame(code: string): Room | { error: string } {
  const room = getRoom(code);
  if (!room) return { error: "Sala no encontrada" };
  if (room.status !== "lobby") return { error: "El juego ya empezó" };
  if (room.players.size < 1) return { error: "Se necesita al menos 1 detective" };

  room.status = "playing";
  room.startedAt = Date.now();
  return room;
}

export function updateRoomStatus(code: string, status: Room["status"]): boolean {
  const room = getRoom(code);
  if (!room) return false;
  room.status = status;
  return true;
}

export function removePlayer(code: string, playerId: string): void {
  const room = getRoom(code);
  if (!room) return;
  room.players.delete(playerId);
  if (playerId === room.hostId && room.players.size > 0) {
    const [newHostId, newHost] = room.players.entries().next().value!;
    newHost.isHost = true;
    room.hostId = newHostId;
  }
}

export function getRoomCount(): number {
  cleanup();
  return rooms.size;
}

export function roomExists(code: string): boolean {
  return getRoom(code) !== null;
}
