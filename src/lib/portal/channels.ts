/**
 * Channel registry & content-type contracts for "The Interrogation Room".
 *
 * Five channels per case:
 *   interrogation:{caseId}  — central chat where detectives press the current AI suspect
 *   detectives:{caseId}     — private conspiracy/notes channel between the 2 humans
 *   clandestine:{caseId}    — background whispers between AI suspects (humans sniff it via late-join backfill)
 *   evidence:{caseId}       — collaborative cursors + evidence-pinned events on the shared board
 *   biometrics:{caseId}     — ephemeral stream of suspect telemetry (stress / bpm / coherence)
 *
 * Channel IDs are derived from a single CASE_ID so two browser tabs in the same case
 * collide into the same room — that's how the two detectives meet.
 */

export const CASE_ID = "case_001"; // single demo case for the hackathon

export const channelIds = {
  interrogation: `interrogation:${CASE_ID}`,
  detectives: `detectives:${CASE_ID}`,
  clandestine: `clandestine:${CASE_ID}`,
  evidence: `evidence:${CASE_ID}`,
  biometrics: `biometrics:${CASE_ID}`,
} as const;

export type ChannelId = (typeof channelIds)[keyof typeof channelIds];

/* ─────────────────────────  Interrogation channel  ───────────────────────── */

export interface InterrogationQuestion {
  text: string;
  suspectId: string;
  detectiveId: string;
  detectiveName: string;
}

export interface InterrogationAnswer {
  text: string;
  suspectId: string;
  suspectName: string;
  /** True if the AI admitted to something material; frontend can highlight it. */
  flagged: boolean;
}

export type InterrogationContent = InterrogationQuestion | InterrogationAnswer;

/* ─────────────────────────  Detectives private channel  ───────────────────────── */

export interface DetectiveNote {
  text: string;
  detectiveId: string;
  detectiveName: string;
}

/* ─────────────────────────  Clandestine (AI ↔ AI) channel  ───────────────────────── */

export interface ClandestineWhisper {
  text: string;
  fromSuspectId: string;
  toSuspectId: string;
  fromSuspectName: string;
}

/* ─────────────────────────  Evidence board channel  ───────────────────────── */

export interface EvidencePin {
  id: string;
  label: string;
  x: number; // 0..1 relative to board
  y: number; // 0..1 relative to board
  addedBy: string;
  color: string;
}

export interface CursorPayload {
  x: number;
  y: number;
}

/** The single ephemeral "type" that distinguishes cursor traffic from evidence pins. */
export const CURSOR_TYPE = "cursor";

/* ─────────────────────────  Biometrics stream channel  ───────────────────────── */

export interface BiometricSample {
  suspectId: string;
  stress: number; // 0..100
  bpm: number; // 50..180
  coherence: number; // 0..100
  /** Optional spoken-stress marker: the LLM tag that triggered the delta. */
  trigger?: string;
}

/* ─────────────────────────  Type discriminators (channel `type` field)  ───────────────────────── */

export const MessageType = {
  Question: "interrogation.question",
  Answer: "interrogation.answer",
  Whisper: "clandestine.whisper",
  Note: "detectives.note",
  Pin: "evidence.pin",
  Biometric: "biometrics.update",
} as const;
