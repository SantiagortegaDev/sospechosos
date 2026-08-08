/**
 * GeneratedCase schema — the shape of a case produced by /api/generate-case.
 */

export type Gender = "man" | "woman";

export interface GeneratedLie {
  topic: string;
  match: string;
  variations: string[];
  underPressure?: string;
}

export interface GeneratedStressRule {
  match: string;
  stressDelta: number;
  bpmDelta: number;
  coherenceDelta: number;
  label: string;
}

export interface TimelineEvent {
  time: string;
  event: string;
  isPublic: boolean;
}

export interface Alibi {
  claimed: string;
  actual: string;
  witnesses: string[];
}

export interface GeneratedSuspect {
  name: string;
  role: string;
  avatar: string;
  gender: Gender;
  identity: string;
  truth: string;
  culpability: "guilty" | "innocent" | "accomplice" | "witness";
  demeanor: string;
  breakingLine: string;
  lies: GeneratedLie[];
  stressRules: GeneratedStressRule[];
  counterQuestions: string[];
  baseline: {
    stress: number;
    bpm: number;
    coherence: number;
  };
  alibi?: Alibi;
}

export interface GeneratedEvidence {
  id: string;
  label: string;
  description: string;
  isRedHerring?: boolean;
  unlockTopic?: string;
}

export interface GeneratedCase {
  seed: string;
  title: string;
  briefing: string;
  situation: string;
  stakes: string;
  suspect: GeneratedSuspect;
  evidence: GeneratedEvidence[];
  suggestedQuestions: string[];
  timeline?: TimelineEvent[];
  difficulty?: "facil" | "medio" | "dificil";
}

/**
 * Pick a suspect portrait filename deterministically from seed + gender.
 */
export function portraitFilename(
  seed: string,
  gender: Gender,
  count = 10
): { primary: string; fallbacks: string[] } {
  let h = 2166136261 >>> 0;
  const s = `${seed}|${gender}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const idx = (h % count) + 1;

  const candidates = [
    `/suspects/${gender}_ (${idx}).jpeg`,
    `/suspects/${gender}_(${idx}).jpeg`,
    `/suspects/${gender}_${idx}.jpeg`,
    `/suspects/${gender}_(${idx}).png`,
    `/suspects/${gender}_${idx}.png`,
  ];

  return {
    primary: candidates[0],
    fallbacks: candidates.slice(1),
  };
}
