/**
 * POST /api/generate-case
 *
 * Body: { seed: string }
 *
 * Returns: GeneratedCase (see src/lib/ai/generated-case.ts).
 * Uses Gemini via Google AI Studio.
 */

import { NextResponse } from "next/server";
import { generateCaseFromSeed } from "@/lib/ai/llm";
import type { GeneratedCase } from "@/lib/ai/generated-case";
import { deepSanitize } from "@/lib/ai/deep-sanitize";

const cache = new Map<string, GeneratedCase>();

const SYSTEM_PROMPT = `Generas casos de interrogación noir en español. Devuelves SOLO un objeto JSON con esta forma exacta:

{
  "title": "TÍTULO MAYÚSCULAS corto",
  "briefing": "2-3 oraciones gancho",
  "situation": "3-5 oraciones con el contexto del crimen",
  "stakes": "qué pierde el sospechoso si es culpable",
  "difficulty": "facil" | "medio" | "dificil",
  "suspect": {
    "name": "NOMBRE COMPLETO MAYÚSCULAS",
    "role": "cargo breve",
    "avatar": "emoji",
    "gender": "man" o "woman",
    "identity": "2-4 oraciones describiendo quién es",
    "truth": "3-6 oraciones, lo que sabe pero NO dice voluntariamente",
    "culpability": "guilty" | "innocent" | "accomplice" | "witness",
    "demeanor": "2-4 oraciones, cómo habla (tono, longitud de frases, tics)",
    "breakingLine": "1-2 oraciones, qué dice cuando rompe",
    "lies": [
      {"topic":"TEMA","match":"regex sobre el tema","variations":["mentira 1","mentira 2","mentira 3"],"underPressure":"verdad que se escapa"}
    ],
    "stressRules": [
      {"match":"regex","stressDelta":5-35,"bpmDelta":5-30,"coherenceDelta":-5 a -30,"label":"LABEL_TRIGGER"}
    ],
    "counterQuestions": ["contra-pregunta 1","...10 total"],
    "baseline": {"stress":10-40,"bpm":65-90,"coherence":70-95},
    "alibi": {
      "claimed": "lo que el sospechoso dice que hacía",
      "actual": "lo que realmente hacía",
      "witnesses": ["nombre de posibles testigos"]
    }
  },
  "evidence": [
    {"id":"ev_1","label":"TAG","description":"descripción","isRedHerring":false,"unlockTopic":"regex AMPLO del tema, ej: 'coartada|dónde estabas|ubicación|noche|día' para evidencia de ubicación"}
  ],
  "timeline": [
    {"time":"18:00","event":"descripción del evento","isPublic":true}
  ],
  "suggestedQuestions": ["pregunta 1","pregunta 2","pregunta 3"]
}

REGLAS:
- 4-6 mentiras, 5-8 stressRules, 10 counterQuestions, 4-6 evidence (1-2 con isRedHerring:true), 3 suggestedQuestions.
- 4-8 eventos en timeline, algunos con isPublic:false.
- Varía el tipo de crimen: fraude, robo, asesinato, desaparición, sabotaje, incendio, secuestro, extorsión.
- Varía el escenario: oficina, almacén, hospital, escuela, museo, restaurante, puerto, granja.
- Los regex deben ser JavaScript válido.
- TODO el texto en español natural.
- El caso debe ser resoluble: verdad + mentiras + evidencia + timeline deben conectar.
- El sospechoso debe poder ser guilty, innocent, accomplice o witness (varía).
- difficulty: "facil" si el culpable es obvio y las mentiras son simples, "medio" si requiere pensar, "dificil" si las mentiras son sofisticadas y hay pistas falsas.
- El alibi debe ser detallado: el sospechoso lo menciona voluntariamente pero puede tener agujeros.
- Las evidencias con unlockTopic se desbloquean cuando el detective pregunta sobre ese tema. Los unlockTopic DEBEN ser regex AMPLOS con múltiples sinónimos separados por |, ej: 'coartada|dónde estabas|ubicación|noche|día|estabas|encontrabas'. NUNCA uses patrones de una sola palabra específica que el detective no adivinaría.
- Las evidencias con isRedHerring:true parecen relevantes pero llevan a conclusiones incorrectas.

La SEMILLA es: "${"%SEED%"}". Úsala como inspiración creativa. Misma semilla = mismo caso. Devuelve SOLO el JSON.`;

export async function POST(req: Request) {
  let body: { seed?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const seed = (body.seed ?? "").toString().trim();
  if (!seed) {
    return NextResponse.json({ error: "missing_seed" }, { status: 400 });
  }

  const cached = cache.get(seed);
  if (cached) {
    return NextResponse.json(cached);
  }

  const systemPrompt = SYSTEM_PROMPT.replace("%SEED%", seed);

  try {
    const raw = await generateCaseFromSeed(systemPrompt, seed);
    let parsed: GeneratedCase;
    try {
      parsed = JSON.parse(raw) as GeneratedCase;
    } catch (err) {
      console.error("[generate-case] JSON parse failed:", err, raw.slice(0, 500));
      return NextResponse.json(
        { error: "generation_failed", detail: "LLM returned invalid JSON" },
        { status: 502 }
      );
    }

    // Deep sanitize ALL fields — LLMs sometimes return objects where strings are expected.
    // This prevents React #310 "Objects are not valid as a React child".
    deepSanitize(parsed);

    parsed.seed = seed;

    if (!parsed.suspect?.name || !parsed.suspect?.gender) {
      return NextResponse.json(
        { error: "generation_incomplete", detail: "missing suspect fields" },
        { status: 502 }
      );
    }
    if (!Array.isArray(parsed.suspect.lies) || parsed.suspect.lies.length === 0) {
      parsed.suspect.lies = [
        {
          topic: "GENERIC",
          match: "qué|como|cuando|donde|por qué",
          variations: ["No recuerdo los detalles."],
          underPressure: "No quiero hablar más.",
        },
      ];
    }
    if (!Array.isArray(parsed.suspect.stressRules) || parsed.suspect.stressRules.length === 0) {
      parsed.suspect.stressRules = [
        { match: "culpable|inocente|mentir|verdad", stressDelta: 20, bpmDelta: 16, coherenceDelta: -12, label: "ACCUSATION" },
      ];
    }
    if (!Array.isArray(parsed.suspect.counterQuestions) || parsed.suspect.counterQuestions.length === 0) {
      parsed.suspect.counterQuestions = ["¿Por qué me pregunta eso?"];
    }
    if (!parsed.suspect.baseline) {
      parsed.suspect.baseline = { stress: 22, bpm: 74, coherence: 88 };
    }
    if (!Array.isArray(parsed.evidence)) parsed.evidence = [];
    if (!Array.isArray(parsed.suggestedQuestions)) parsed.suggestedQuestions = [];
    if (!Array.isArray(parsed.timeline)) parsed.timeline = [];
    if (!parsed.difficulty) parsed.difficulty = "medio";
    if (!parsed.suspect.alibi) {
      parsed.suspect.alibi = {
        claimed: "Estaba en casa esa noche.",
        actual: "Estaba en casa esa noche.",
        witnesses: [],
      };
    }

    cache.set(seed, parsed);

    return NextResponse.json(parsed);
  } catch (err) {
    const msg = (err as Error).message;
    console.error("[generate-case] failed:", msg);
    if (msg === "RATE_LIMITED") {
      return NextResponse.json(
        {
          error: "rate_limited",
          detail: "Límite de Gemini alcanzado. Espera unos minutos o usa otra seed ya generada.",
        },
        { status: 429 }
      );
    }
    return NextResponse.json(
      { error: "generation_failed", detail: msg },
      { status: 500 }
    );
  }
}
