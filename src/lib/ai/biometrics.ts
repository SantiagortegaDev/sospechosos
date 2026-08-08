/**
 * Biometric delta engine.
 *
 * Given a suspect and an incoming detective question, return the new biometric
 * sample plus a trigger label. We:
 *   1. Start from baseline (or current state if passed in),
 *   2. Apply the first matching stress rule (most-specific-first ordering is
 *      preserved in the suspect definition),
 *   3. Apply a small drift back toward baseline so telemetry relaxes between
 *      aggressive questions,
 *   4. Clamp to physical ranges.
 */

import type { Suspect, SuspectBaseline } from "./suspects";

export interface BiometricState extends SuspectBaseline {
  suspectId: string;
}

export interface BiometricUpdate {
  state: BiometricState;
  trigger: string | undefined;
}

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

/** Fraction of the gap-to-baseline to close per relaxation step (0..1). */
const RELAX_TOWARD_BASELINE = 0.08;

export function nextBiometric(
  suspect: Suspect,
  question: string,
  previous: BiometricState | undefined
): BiometricUpdate {
  const base: BiometricState = previous ?? {
    suspectId: suspect.id,
    ...suspect.baseline,
  };

  // Relax toward baseline by a small step before applying new pressure.
  const relaxed: BiometricState = {
    suspectId: suspect.id,
    stress: base.stress + (suspect.baseline.stress - base.stress) * RELAX_TOWARD_BASELINE,
    bpm: base.bpm + (suspect.baseline.bpm - base.bpm) * RELAX_TOWARD_BASELINE,
    coherence:
      base.coherence +
      (suspect.baseline.coherence - base.coherence) * RELAX_TOWARD_BASELINE,
  };

  const q = question.toLowerCase();
  const firing = suspect.stressRules.find((rule) => rule.match.test(q));

  if (!firing) {
    return {
      state: {
        suspectId: suspect.id,
        stress: clamp(relaxed.stress, 0, 100),
        bpm: clamp(relaxed.bpm, 50, 180),
        coherence: clamp(relaxed.coherence, 0, 100),
      },
      trigger: undefined,
    };
  }

  return {
    state: {
      suspectId: suspect.id,
      stress: clamp(relaxed.stress + firing.stressDelta, 0, 100),
      bpm: clamp(relaxed.bpm + firing.bpmDelta, 50, 180),
      coherence: clamp(relaxed.coherence + firing.coherenceDelta, 0, 100),
    },
    trigger: firing.label,
  };
}

/** Heuristic "did the AI admit something material" flag for the answer envelope. */
export function detectFlag(answerText: string): boolean {
  const t = answerText.toLowerCase();
  const signals = [
    "i did",
    "i authorized",
    "i told",
    "i ordered",
    "i knew",
    "i was there",
    "yes, i",
    "i admit",
    "i covered",
  ];
  return signals.some((s) => t.includes(s));
}
