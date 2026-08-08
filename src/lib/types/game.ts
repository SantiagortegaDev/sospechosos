/**
 * Core game types for "SOSPECHOSOS — The Interrogation Room"
 * Pixel Art Noir Edition — Single suspect, multiplayer detectives
 */

export type GamePhase =
  | "welcome"
  | "create_or_join"
  | "create"
  | "join"
  | "join_by_link"
  | "lobby"
  | "generating_case"
  | "case_intro"
  | "evidence_review"
  | "playing"
  | "deliberation"
  | "vote"
  | "verdict"
  | "revelation"
  | "results";

export interface RoomSettings {
  roundTimeMinutes: number;
  maxDetectives: number; // 2-4
}

export interface Player {
  id: string;
  username: string;
  isHost: boolean;
  joinedAt: number;
}

export interface Room {
  code: string;
  settings: RoomSettings;
  players: Map<string, Player>;
  status: "lobby" | "playing" | "deliberation" | "vote" | "verdict" | "results";
  createdAt: number;
  startedAt?: number;
  hostId: string;
  selectedCaseId?: string;
}

export interface GameState {
  phase: GamePhase;
  timeRemaining: number;
  totalTime: number;
  events: GameEvent[];
  achievements: Achievement[];
  verdict?: VerdictResult;
  ending?: EndingResult;
}

export interface GameEvent {
  id: string;
  type: "evidence_leak" | "witness_appears" | "suspect_nervous" | "system_alert";
  description: string;
  startedAt: number;
  duration: number;
  resolved?: boolean;
  challengeData?: ChallengeData;
}

export interface ChallengeData {
  type: string;
  question: string;
  answer: string;
  hint?: string;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  reference?: string;
  unlocked: boolean;
  unlockedAt?: number;
  condition: string;
}

export interface VerdictResult {
  majorityCorrect: boolean;
  guiltyVotes: number;
  innocentVotes: number;
  suspectIsGuilty: boolean;
  votes: Array<{ playerId: string; playerName: string; vote: "guilty" | "innocent" }>;
  decision: "freed" | "imprisoned";
  judgeReasoning: string;
  judgesComment: string;
}

export interface EndingResult {
  type: string;
  title: string;
  description: string;
  reference?: string;
  isSpecial: boolean;
}

/** Per-detective conversation history with the suspect */
export interface ConversationTurn {
  role: "detective" | "suspect";
  text: string;
  detectiveName?: string;
  timestamp: number;
}

/** Detective's personal notepad */
export interface DetectiveNote {
  id: string;
  text: string;
  detectiveId: string;
  detectiveName: string;
  createdAt: number;
}

/** Timeline entry */
export interface TimelineEntry {
  id: string;
  label: string;
  description: string;
  addedBy: string;
  addedByName: string;
  createdAt: number;
}

/** Stress indicator snapshot */
export interface StressState {
  stress: number;       // 0-100
  confidence: number;  // 0-100
  hostility: number;   // 0-100
  trigger?: string;
}

/** Vote from a detective */
export interface DetectiveVote {
  playerId: string;
  playerName: string;
  vote: "guilty" | "innocent";
  reason: string;
  votedAt: number;
}

/** Case definition */
export interface CaseData {
  id: string;
  title: string;
  subtitle: string;
  briefing: string;
  date: string;
  location: string;
  stakes: string;
  suspectId: string;
  suspectIsGuilty: boolean;
  truthKey: string;
}

export interface Session {
  username: string;
  roomCode: string;
  isHost: boolean;
}

/** Evidence item for the evidence board */
export interface EvidenceItem {
  id: string;
  label: string;
  description: string;
  isRedHerring?: boolean;
  isLocked: boolean;
  unlockTopic?: string;
}

/** Interrogation technique */
export type InterrogationTechnique = "neutral" | "amenaza" | "empatia" | "enganio";

/** Detective rating at game end */
export type DetectiveRating = "S" | "A" | "B" | "C" | "D";

/** Suspect visual tell */
export interface SuspectTell {
  id: string;
  emoji: string;
  label: string;
  minStress: number;
}
