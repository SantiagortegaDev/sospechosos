/**
 * POST /api/interrogate
 *
 * Generates a suspect reply with FULL conversation history for memory.
 * Accepts systemPrompt directly (works with AI-generated cases).
 */

import { NextResponse } from "next/server";
import { generateSuspectReply } from "@/lib/ai/llm";
import type { StressState } from "@/lib/types/game";

interface StressRule {
  match: string;
  stressDelta: number;
  coherenceDelta: number;
  bpmDelta: number;
  label: string;
}

interface RequestBody {
  suspectId: string;
  suspectName?: string;
  suspectAvatar?: string;
  systemPrompt?: string;
  question: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  previousStress?: StressState;
  presentedEvidence?: { label: string; description: string };
  technique?: string;
  stressRules?: StressRule[];
}

export async function POST(req: Request) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.systemPrompt || typeof body.question !== "string") {
    return NextResponse.json(
      { error: "missing_fields" },
      { status: 400 }
    );
  }

  const q = body.question.toLowerCase();
  let stressDelta = 0;
  let confidenceDelta = 0;
  let hostilityDelta = 0;
  let trigger: string | undefined;

  // Apply stress rules from request body (compiled regexes)
  if (body.stressRules && Array.isArray(body.stressRules)) {
    for (const rule of body.stressRules) {
      try {
        if (new RegExp(rule.match, "i").test(q)) {
          stressDelta += rule.stressDelta;
          confidenceDelta += rule.coherenceDelta;
          hostilityDelta += Math.round(rule.bpmDelta / 2);
          trigger = rule.label;
          break;
        }
      } catch { /* invalid regex, skip */ }
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

  // Baseline relaxation toward 40% stress, 60% confidence, 20% hostility
  const baseStress = prevStress
    ? prevStress.stress + (40 - prevStress.stress) * 0.06
    : 30;
  const baseConfidence = prevStress
    ? prevStress.confidence + (60 - prevStress.confidence) * 0.06
    : 70;
  const baseHostility = prevStress
    ? prevStress.hostility + (20 - prevStress.hostility) * 0.06
    : 20;

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
    systemPrompt: body.systemPrompt,
    history: Array.isArray(body.history) ? body.history : [],
    question: fullQuestion,
    stressLevel: actualStress.stress,
  });

  // If the LLM call was rate-limited, return 429 so the frontend can show
  // a clear message instead of silently using the fallback text.
  if (reply.rateLimited) {
    return NextResponse.json(
      {
        error: "rate_limited",
        detail:
          "Límite de tokens de Groq alcanzado (100k/día en tier gratuito). Espera ~20 minutos o usa una seed ya generada. Mientras tanto, el sospechoso guarda silencio.",
      },
      { status: 429 }
    );
  }

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
      suspectId: body.suspectId,
      suspectName: body.suspectName ?? "SOSPECHOSO",
      avatar: body.suspectAvatar ?? "[?]",
      flagged,
    },
    stress: displayStress,
    ms: reply.ms,
  });
}
