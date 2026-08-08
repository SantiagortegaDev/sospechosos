export type GamePhase = "briefing" | "investigating" | "resolved";
export type MessageRole = "detective" | "suspect" | "system";

export interface CaseMessage { id: string; suspectId?: string; role: MessageRole; text: string; createdAt: number }
export interface Clue { id: string; title: string; detail: string; suspectIds: string[]; discovered: boolean }
export interface Contradiction { id: string; suspectId: string; claim: string; evidence: string; discovered: boolean }
export interface Biometrics { stress: number; bpm: number; coherence: number; lastTopic?: string }
export interface SuspectState { id: string; name: string; role: string; initials: string; personality: string; truth: string[]; lies: string[]; secrets: string[]; knownFacts: string[]; unknownFacts: string[]; motive: string; history: CaseMessage[]; biometrics: Biometrics; revealedClueIds: string[]; pressure: number }
export interface CaseState { id: string; title: string; premise: string; objective: string; culpritId: string; suspects: SuspectState[]; clues: Clue[]; contradictions: Contradiction[]; history: CaseMessage[]; timerEndsAt: number; phase: GamePhase; accusation?: { suspectId: string; correct: boolean; resolvedAt: number }; eventLog: CaseMessage[]; revision: number }
export interface CaseDefinition extends Omit<CaseState, "suspects" | "history" | "eventLog" | "accusation" | "phase" | "revision" | "timerEndsAt"> { suspects: Omit<SuspectState, "history" | "revealedClueIds" | "pressure">[] }
