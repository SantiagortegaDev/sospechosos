/**
 * POST /api/interrogate
 *
 * Generates a suspect reply with FULL conversation history for memory.
 * Returns answer text + updated stress levels (with noise for display).
 */

import { NextResponse } from "next/server";
import { findSuspect } from "@/lib/ai/suspects";
import { generateSuspectReply } from "@/lib/ai/llm";
import type { StressState } from "@/lib/types/game";

interface RequestBody {
  suspectId: string;
  question: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  previousStress?: StressState;
  presentedEvidence?: { label: string; description: string };
  technique?: string;
}

export async function POST(req: Request) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.suspectId || typeof body.question !== "string") {
    return NextResponse.json(
      { error: "missing_fields" },
      { status: 400 }
    );
  }

  const suspect = findSuspect(body.suspectId);
  if (!suspect) {
    return NextResponse.json({ error: "unknown_suspect" }, { status: 404 });
  }

  const q = body.question.toLowerCase();
  let stressDelta = 0;
  let confidenceDelta = 0;
  let hostilityDelta = 0;
  let trigger: string | undefined;

  for (const rule of suspect.stressRules) {
    if (rule.match.test(q)) {
      stressDelta += rule.stressDelta;
      confidenceDelta += rule.confidenceDelta;
      hostilityDelta += rule.hostilityDelta;
      trigger = rule.label;
      break;
    }
  }

  // If evidence is presented, add extra stress spike
  let evidenceModifier = "";
  if (body.presentedEvidence) {
    stressDelta += 15 + Math.floor(Math.random() * 15);
    confidenceDelta -= 10 + Math.floor(Math.random() * 10);
    hostilityDelta += 5 + Math.floor(Math.random() * 10);
    trigger = "EVIDENCE_PRESENTED";
    evidenceModifier = `\n\nEl detective ACABA DE PRESENTAR EVIDENCIA EN TU CONTRA: "${body.presentedEvidence.label}" — ${body.presentedEvidence.description}. Esto es grave. Reacciona con estrés, intenta desacreditarla, o si no puedes, muestra incomodidad extrema.`;
  }

  // If a technique is used, add a modifier
  let techniqueModifier = "";
  if (body.technique && body.technique !== "neutral") {
    if (body.technique === "amenaza") {
      stressDelta += 8;
      hostilityDelta += 5;
      techniqueModifier = "\n\nEl detective usa una TÁCTICA DE AMENAZA. Presiona con consecuencias legales. Esto te pone más hostil y defensivo.";
    } else if (body.technique === "empatia") {
      confidenceDelta += 5;
      hostilityDelta -= 5;
      techniqueModifier = "\n\nEl detective usa una TÁCTICA DE EMPATÍA. Habla amable, busca conexión. Bajas la guardia un poco, pero no mucho.";
    } else if (body.technique === "enganio") {
      stressDelta += 5;
      techniqueModifier = "\n\nEl detective usa una TÁCTICA DE ENGAÑO. Te dice que ya saben la verdad, que tienen testigos, que alguien ya confesó. Esto te pone nervioso pero puedes dudar.";
    }
  }

  const prevStress = body.previousStress;
  const clamp = (n: number, min: number, max: number) =>
    Math.max(min, Math.min(max, n));

  const relax = 0.06;
  const baseStress = prevStress
    ? prevStress.stress + (suspect.baseline.stress - prevStress.stress) * relax
    : suspect.baseline.stress;
  const baseConfidence = prevStress
    ? prevStress.confidence + (suspect.baseline.confidence - prevStress.confidence) * relax
    : suspect.baseline.confidence;
  const baseHostility = prevStress
    ? prevStress.hostility + (suspect.baseline.hostility - prevStress.hostility) * relax
    : suspect.baseline.hostility;

  const actualStress: StressState = {
    stress: clamp(Math.round(baseStress + stressDelta), 0, 100),
    confidence: clamp(Math.round(baseConfidence + confidenceDelta), 0, 100),
    hostility: clamp(Math.round(baseHostility + hostilityDelta), 0, 100),
    trigger,
  };

  // Add noise for display (±5-15%) while keeping actual stress accurate
  const addNoise = (val: number, range: [number, number]) => {
    const [minNoise, maxNoise] = range;
    const noise = minNoise + Math.random() * (maxNoise - minNoise);
    const direction = Math.random() > 0.5 ? 1 : -1;
    return clamp(Math.round(val + noise * direction), 0, 100);
  };

  const displayStress: StressState = {
    stress: addNoise(actualStress.stress, [5, 15]),
    confidence: addNoise(actualStress.confidence, [3, 10]),
    hostility: addNoise(actualStress.hostility, [3, 10]),
    trigger: actualStress.trigger,
  };

  const fullQuestion = body.question + evidenceModifier + techniqueModifier;

  const reply = await generateSuspectReply({
    systemPrompt: suspect.systemPrompt,
    history: Array.isArray(body.history) ? body.history : [],
    question: fullQuestion,
    stressLevel: actualStress.stress,
  });

  const textLower = reply.text.toLowerCase();
  const slipSignals = [
    "lo hice", "yo hice", "lo cometí", "yo cometí",
    "es verdad", "es cierto", "tienes razón",
    "fui yo", "yo estaba", "lo sé porque",
    "admito", "es real", "sí, es verdad",
    "me vi obligado", "no tuve opción",
  ];
  const flagged = slipSignals.some(s => textLower.includes(s));

  return NextResponse.json({
    answer: {
      text: reply.text,
      suspectId: suspect.id,
      suspectName: suspect.name,
      avatar: suspect.avatar,
      flagged,
    },
    stress: displayStress,
    ms: reply.ms,
  });
}
