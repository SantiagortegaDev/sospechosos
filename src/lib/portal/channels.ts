/**
 * Channel registry — simplified for single-suspect game.
 *
 * Channels per ROOM:
 *   game:{room}         — main chat between both detectives and the suspect
 *   detectives:{room}    — private detective-to-detective channel
 *   stress:{room}       — suspect stress/emotion indicators
 *   ai-events:{room}    — autonomous suspect events (thoughts, comments)
 *   game-state:{room}   — timer, phase, sync
 *   achievements:{room}  — achievement notifications
 *   votes:{room}        — voting channel during deliberation
 */

export function channelIdsFor(roomCode: string) {
  const r = roomCode.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
  return {
    game: `game:${r}`,
    detectives: `detectives:${r}`,
    stress: `stress:${r}`,
    aiEvents: `ai-events:${r}`,
    gameState: `game-state:${r}`,
    achievements: `achievements:${r}`,
    votes: `votes:${r}`,
  } as const;
}

export type ChannelBundle = ReturnType<typeof channelIdsFor>;

/* ─── Game channel — detective/suspect messages ─── */

export interface GameMessage {
  type: "detective.question" | "suspect.answer" | "suspect.autonomous" | "suspect.thought" | "system.event";
  senderType: "detective" | "suspect" | "system";
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
}

/* ─── Detectives private channel ─── */

export interface DetectiveMessage {
  type: "detective.note";
  detectiveId: string;
  detectiveName: string;
  text: string;
  timestamp: number;
}

/* ─── Stress channel ─── */

export interface StressUpdate {
  suspectId: string;
  stress: number;
  confidence: number;
  hostility: number;
  trigger?: string;
  timestamp: number;
}

/* ─── AI events channel ─── */

export interface AIEventPayload {
  suspectId: string;
  suspectName: string;
  kind: "thought" | "comment" | "nervous" | "challenge" | "slip";
  text: string;
  timestamp: number;
}

/* ─── Game state channel ─── */

export interface GameStatePayload {
  phase: string;
  timeRemaining: number;
  totalTime: number;
  players: Array<{ id: string; username: string }>;
}

/* ─── Achievement channel ─── */

export interface AchievementPayload {
  achievementId: string;
  name: string;
  description: string;
  icon: string;
  reference?: string;
  message: string;
  unlockedBy: string;
  at: number;
}

/* ─── Votes channel ─── */

export interface VotePayload {
  playerId: string;
  playerName: string;
  vote: "guilty" | "innocent";
  reason: string;
  votedAt: number;
}
