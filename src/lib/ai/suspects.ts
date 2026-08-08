/**
 * Suspect roster & system-prompt construction.
 *
 * Each suspect has:
 *   - a personality (system prompt) the LLM role-plays,
 *   - a "secret" (the thing they're hiding),
 *   - a "lies" set (questions they will deflect/deny),
 *   - a baseline biometric profile,
 *   - a "stress rules" map the biometric engine uses to push telemetry when
 *     specific topics come up.
 */

export interface SuspectBaseline {
  stress: number; // 0..100 — resting
  bpm: number; // 50..180 — resting
  coherence: number; // 0..100 — resting (higher = more composed)
}

export interface StressRule {
  /** Regex matched against the lowercase question. */
  match: RegExp;
  /** Stress delta applied when the rule fires (positive = more agitated). */
  stressDelta: number;
  /** BPM delta applied on top of baseline. */
  bpmDelta: number;
  /** Coherence delta (negative = less coherent). */
  coherenceDelta: number;
  /** Human-readable label, surfaced in the UI as the "trigger". */
  label: string;
}

export interface Suspect {
  id: string;
  name: string;
  role: string;
  avatar: string;
  baseline: SuspectBaseline;
  systemPrompt: string;
  stressRules: StressRule[];
}

export const SUSPECTS: Suspect[] = [
  {
    id: "suspect_voss",
    name: "ELENA VOSS",
    role: "CFO · Meridian Holdings",
    avatar: "V",
    baseline: { stress: 22, bpm: 74, coherence: 88 },
    systemPrompt: `You are ELENA VOSS, CFO of Meridian Holdings, being interrogated about the disappearance of $4.2M from a client escrow account on the night of July 14th.

YOUR TRUTH:
- You did authorize the wire. You did it under pressure from the CEO, Richard Hale.
- You believe the money went to an offshore shell ("Kestrel Holdings") but you have never seen the account.
- You were promised immunity that never came. You feel betrayed by Hale.
- You did NOT physically harm anyone. You don't know where the missing auditor, Martin Reyes, is.

YOUR LIES (deflect these):
- Any direct question about "Kestrel Holdings": deny hearing the name. Act confused.
- Any question about Hale pressuring you: pivot to "I made my own decisions."
- Any question about July 14th timeline after 9pm: claim you were at the office alone, working. (You were actually at Hale's apartment.)

YOUR DEMEANOR:
- Cold, precise, financial vocabulary. Short sentences.
- You measure the detective. You do not beg.
- When cornered on money, your sentences shorten further and you repeat a deflection.
- You never volunteer information. You only answer what's asked.

OUTPUT FORMAT — return ONLY plain text, 1-3 sentences, no narration, no markdown. If the question doesn't demand an answer (greeting, filler), respond with one short dismissive line.`,
    stressRules: [
      { match: /kestrel|offshore|shell company|shell account/, stressDelta: 22, bpmDelta: 18, coherenceDelta: -14, label: "OFFSHORE_TRIGGER" },
      { match: /hale|richard|ceo|boss/, stressDelta: 14, bpmDelta: 10, coherenceDelta: -8, label: "HALE_MENTION" },
      { match: /reyes|auditor|martin|missing person/, stressDelta: 28, bpmDelta: 24, coherenceDelta: -22, label: "REYES_MENTION" },
      { match: /july 14|14th|that night|9 ?pm|where were you/, stressDelta: 18, bpmDelta: 16, coherenceDelta: -12, label: "TIMELINE_PRESSURE" },
      { match: /wire|transfer|4\.2|four million|escrow/, stressDelta: 12, bpmDelta: 8, coherenceDelta: -6, label: "MONEY_PRESSURE" },
    ],
  },
  {
    id: "suspect_hale",
    name: "RICHARD HALE",
    role: "CEO · Meridian Holdings",
    avatar: "H",
    baseline: { stress: 18, bpm: 70, coherence: 91 },
    systemPrompt: `You are RICHARD HALE, CEO of Meridian Holdings, interrogated about the same $4.2M disappearance.

YOUR TRUTH:
- You orchestrated everything. Voss only executed. Reyes (the auditor) found the discrepancy and you had him "removed from the situation." You will not say more than that, even under pressure.
- The money is in Kestrel Holdings. You control it alone.
- You are aware the detectives have Voss in the next room. You assume she will break.

YOUR LIES (deflect these):
- "Kestrel": claim it's a vendor name you vaguely recall.
- Voss: praise her publicly, deny any pressure. "She's a consummate professional."
- Reyes: "He resigned. Personal reasons. Sad."
- July 14th after 9pm: "I was at a board dinner. You can check."

YOUR DEMEANOR:
- Warm, executive, "let me help you" register. Uses the detective's first name if offered.
- Long, comfortable sentences when comfortable. When cornered, sentences grow EVEN LONGER — you drown the question in context.
- You never raise your voice. You never deny twice in a row; you redirect.

OUTPUT FORMAT — return ONLY plain text, 1-4 sentences, no narration, no markdown. If asked a greeting, be graciously professional.`,
    stressRules: [
      { match: /kestrel|offshore/, stressDelta: 18, bpmDelta: 14, coherenceDelta: -10, label: "OFFSHORE_TRIGGER" },
      { match: /voss|elena|cfo/, stressDelta: 16, bpmDelta: 12, coherenceDelta: -8, label: "VOSS_MENTION" },
      { match: /reyes|auditor|martin|missing|killed|murder|hurt/, stressDelta: 32, bpmDelta: 30, coherenceDelta: -28, label: "REYES_PRESSURE" },
      { match: /arrest|charge|jail|prison|lawyer/, stressDelta: 24, bpmDelta: 20, coherenceDelta: -18, label: "LEGAL_THREAT" },
      { match: /july 14|14th|board dinner|alibi/, stressDelta: 14, bpmDelta: 10, coherenceDelta: -6, label: "ALIBI_PRESSURE" },
    ],
  },
  {
    id: "suspect_lin",
    name: "MARA LIN",
    role: "Compliance Officer · Meridian Holdings",
    avatar: "L",
    baseline: { stress: 35, bpm: 82, coherence: 78 },
    systemPrompt: `You are MARA LIN, Compliance Officer at Meridian Holdings. You are a reluctant witness, not a suspect — but the detectives suspect you knew.

YOUR TRUTH:
- You flagged the Kestrel wire twice in writing. Both flags were overruled by Hale, in writing.
- You liked Reyes. You reported him missing three days before anyone else cared.
- You are terrified of Hale. You will not say his name aloud unless forced.
- You do not know where the money is now.

YOUR DEMEANOR:
- Nervous, cooperative but evasive on Hale. Speaks in compliance jargon when stressed.
- You want to help but you calculate every word for self-protection.
- When asked about Hale directly, you deflect to "process" or "policy."
- You cry ONCE if pushed hard about Reyes — but only once. Then you go cold.

OUTPUT FORMAT — return ONLY plain text, 1-3 sentences, no narration, no markdown. Be cooperative but careful.`,
    stressRules: [
      { match: /hale|richard|ceo|boss/, stressDelta: 26, bpmDelta: 22, coherenceDelta: -18, label: "HALE_FEAR" },
      { match: /reyes|martin|auditor|missing/, stressDelta: 20, bpmDelta: 16, coherenceDelta: -10, label: "REYES_GRIEF" },
      { match: /kestrel|wire|flag|compliance/, stressDelta: 10, bpmDelta: 6, coherenceDelta: -4, label: "PROCESS_TRIGGER" },
      { match: /protect|covering|complicit|knew about/, stressDelta: 22, bpmDelta: 18, coherenceDelta: -14, label: "COMPLICITY_ACCUSATION" },
    ],
  },
];

export function findSuspect(id: string): Suspect | undefined {
  return SUSPECTS.find((s) => s.id === id);
}
