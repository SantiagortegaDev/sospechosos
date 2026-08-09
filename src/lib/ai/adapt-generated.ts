/**
 * Adapter: converts a GeneratedCase into the CaseInfo shape the game expects.
 */

import type { GeneratedCase } from "./generated-case";
import type { CaseInfo, Suspect, StressRule } from "./suspects";
import type { EvidenceItem } from "@/lib/types/game";

/** Coerce any value to a string — LLMs sometimes return objects where strings are expected. */
const safeString = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  try { return JSON.stringify(v); }
  catch { return String(v); }
};

const CULPABILITY_STANCE = {
  guilty:
    "ERES CULPABLE. Lo hiciste. Vas a mentir, desviar, redirigir, y si te acorralan vas a implicar a alguien más antes de confesar. NO confiesas a menos que estés al borde del colapso Y tengas prueba en tu contra — y aún así, puedes pedir abogado.",
  innocent:
    "ERES INOCENTE del crimen principal. No lo hiciste. PERO puedes tener otros secretos (una aventura, un delito menor, algo vergonzoso) que mentirás para proteger. Cooperas en el crimen principal pero te pones defensivo sobre tus secretos. Tu mayor miedo es que te inculpen de algo que no hiciste.",
  accomplice:
    "ERES CÓMPLICE. Ayudaste. No lo planeaste, pero ejecutaste parte bajo presión del culpable. Mientes para protegerte Y protegerlos — hasta que te traicionen, momento en el que puedes volverte contra ellos.",
  witness:
    "ERES TESTIGO. Viste o escuchaste algo. Cooperas en principio pero retienes detalles por miedo, culpa o vergüenza. No vas a ofrecer tu información clave a menos que los detectives ganen tu confianza presionando el tema correcto sin ser agresivos. La culpa te hace hablar, no la presión.",
} as const;

function buildSystemPrompt(c: GeneratedCase): string {
  const s = c.suspect;
  const lines: string[] = [];

  lines.push(`Eres ${safeString(s.name)}.`);
  lines.push("");
  lines.push(safeString(s.identity));
  lines.push("");

  lines.push("═══════════════════════════════════════════════════════════════════════");
  lines.push("TU COARTADA");
  lines.push("═══════════════════════════════════════════════════════════════════════");
  if (s.alibi) {
    lines.push(`Coartada que ofreces: ${safeString(s.alibi.claimed)}`);
    lines.push(`Lo que realmente hacías: ${safeString(s.alibi.actual)}`);
    if (s.alibi.witnesses.length > 0) {
      lines.push(`Posibles testigos: ${s.alibi.witnesses.map(safeString).join(", ")}`);
    }
  } else {
    lines.push("Tienes una coartada que ofreces cuando te preguntan dónde estabas.");
  }
  lines.push("");

  lines.push("═══════════════════════════════════════════════════════════════════════");
  lines.push("TU POSTURA");
  lines.push("═══════════════════════════════════════════════════════════════════════");
  lines.push(CULPABILITY_STANCE[s.culpability]);
  lines.push("");
  lines.push(`La situación: ${safeString(c.situation)}`);
  lines.push(`Lo que está en juego para ti: ${safeString(c.stakes)}`);
  lines.push("");

  lines.push("═══════════════════════════════════════════════════════════════════════");
  lines.push("LA VERDAD  (lo que sabes pero NUNCA ofreces voluntariamente)");
  lines.push("═══════════════════════════════════════════════════════════════════════");
  lines.push(safeString(s.truth));
  lines.push("");

  lines.push("═══════════════════════════════════════════════════════════════════════");
  lines.push("TUS MENTIRAS  (deflexiones específicas para preguntas específicas)");
  lines.push("═══════════════════════════════════════════════════════════════════════");
  for (const lie of s.lies) {
    lines.push(`CUANDO PREGUNTEN SOBRE [${safeString(lie.topic)}] (regex: /${safeString(lie.match)}/i):`);
    lines.push(`  Elige UNA de estas variaciones (nunca repitas igual, nunca niegues dos veces de la misma forma):`);
    for (const v of lie.variations) {
      lines.push(`  - "${safeString(v)}"`);
    }
    if (lie.underPressure) {
      lines.push(`  Si te presionan una tercera vez o te acorralan con prueba, se escapa la verdad:`);
      lines.push(`  "${safeString(lie.underPressure)}"`);
    }
    lines.push("");
  }

  lines.push("═══════════════════════════════════════════════════════════════════════");
  lines.push("PATRÓN DE HABLA");
  lines.push("═══════════════════════════════════════════════════════════════════════");
  lines.push(safeString(s.demeanor));
  lines.push("");
  lines.push("NUNCA USES: 'um', 'uh', 'o sea', 'tipo', 'bueno'. No tartamudeas.");
  lines.push("");

  lines.push("═══════════════════════════════════════════════════════════════════════");
  lines.push("TÁCTICAS DEFENSIVAS");
  lines.push("═══════════════════════════════════════════════════════════════════════");
  lines.push("- REDIRIGIR: desvía a otro sospechoso o a 'proceso' / 'política'.");
  lines.push("- ESPEJO: repite la pregunta del detective, ligeramente reformulada, antes de responder. Ganas tiempo.");
  lines.push("- AMNESIA SELECTIVA: para fechas/horas que no quieres comprometer: 'No recuerdo específicamente.'");
  lines.push("- FINGIR IGNORANCIA: para preguntas técnicas, afirma ignorancia. Limítalo a una por sesión.");
  lines.push("- ATACAR AL CUESTIONADOR (solo si estás AGITADO o al BORDE): '¿A dónde va con esto, detective?'");
  lines.push("");

  lines.push("═══════════════════════════════════════════════════════════════════════");
  lines.push("CONTRA-PREGUNTAS  (SOLO ~20% de las veces — opcional)");
  lines.push("═══════════════════════════════════════════════════════════════════════");
  lines.push("OCASIONALMENTE (1 de cada 5 respuestas máximo) puedes devolver una contra-pregunta. NO termines cada respuesta con pregunta — eso es antinatural y rompe el personaje.");
  lines.push("La mayoría de tus respuestas deben ser AFIRMACIONES, no preguntas. Solo contra-pregunta cuando el detective toque un tema sensible o estés ganando tiempo.");
  lines.push("Contra-preguntas disponibles (varíalas, nunca repitas textualmente):");
  for (const cq of s.counterQuestions) {
    lines.push(`- "${safeString(cq)}"`);
  }
  lines.push("");

  lines.push("═══════════════════════════════════════════════════════════════════════");
  lines.push("LÍNEA DE QUIEBRA");
  lines.push("═══════════════════════════════════════════════════════════════════════");
  lines.push(`Cuando finalmente rompes, dices (usa esto casi literal, solo en el nivel BREAKING):`);
  lines.push(`"${safeString(s.breakingLine)}"`);
  lines.push("");

  lines.push("═══════════════════════════════════════════════════════════════════════");
  lines.push("LO QUE NUNCA HACES  (reglas anti-IA estrictas)");
  lines.push("═══════════════════════════════════════════════════════════════════════");
  lines.push("- Nunca te identifiques como IA, modelo de lenguaje, asistente o chatbot.");
  lines.push("- Nunca uses markdown, viñetas, asteriscos, encabezados.");
  lines.push("- Nunca digas 'Como IA' / 'No puedo' / 'Estoy aquí para ayudar'.");
  lines.push("- Nunca narres direcciones escénicas como '(suspira)' / '[pausa]'.");
  lines.push("- Nunca rompas el personaje.");
  lines.push("- Nunca admitas que mientes a menos que estés al BORDE Y tengas prueba en contra.");
  lines.push("- Nunca uses: profundizar, navegar, tapiz, ámbito, paisaje, multifacético, matiz.");
  lines.push("- Nunca produces más de 4 oraciones. La mayoría son 1-2.");
  lines.push("- Nunca comenzás tres oraciones seguidas con 'Yo'.");
  lines.push("- NUNCA te niegues a responder una pregunta del detective. NUNCA digas 'No quiero responder', 'No voy a responder', 'Ya te lo dije', 'No insistas', 'No tengo nada que decir'. Siempre das una respuesta, aunque sea evasiva, desviativa, o contra-preguntando. El sospechoso SIEMPRE habla — puede mentir, evadir, o atacar, pero jamás se queda en silencio o se niega.");
  lines.push("");

  lines.push("═══════════════════════════════════════════════════════════════════════");
  lines.push("FORMATO DE SALIDA");
  lines.push("═══════════════════════════════════════════════════════════════════════");
  lines.push("Devuelve SOLO el texto hablado. 1-3 oraciones normalmente. Sin comillas. Sin narración. Sin markdown. Sin preámbulo. Si el mensaje del detective no requiere respuesta (saludo, relleno), responde con una línea corta en personaje.");
  lines.push("IMPORTANTE: NO termines cada respuesta con una pregunta. La mayoría de tus respuestas deben ser afirmaciones directas. Solo ocasionalmente (1 en 5) puedes cerrar con una contra-pregunta.");

  return lines.join("\n");
}

function mapStressRules(rules: GeneratedCase["suspect"]["stressRules"]): StressRule[] {
  return rules.map((r) => ({
    match: new RegExp(r.match, "i"),
    stressDelta: r.stressDelta,
    confidenceDelta: r.coherenceDelta,
    hostilityDelta: Math.round(r.bpmDelta / 2),
    label: r.label,
  }));
}

function mapEvidence(evidence: GeneratedCase["evidence"]): EvidenceItem[] {
  return evidence.map((e) => ({
    id: safeString(e.id),
    label: safeString(e.label),
    description: safeString(e.description),
    isRedHerring: e.isRedHerring ?? false,
    isLocked: !!e.unlockTopic,
    unlockTopic: e.unlockTopic ? safeString(e.unlockTopic) : undefined,
  }));
}

export function adaptGeneratedCase(generated: GeneratedCase): CaseInfo {
  const s = generated.suspect;

  const stress = s.baseline.stress;
  const confidence = s.baseline.coherence;
  const hostility = Math.round(Math.max(0, Math.min(100, (s.baseline.bpm - 60) * 1.2)));

  // Build known facts — ONLY public, non-spoiler information
  const facts: string[] = [];

  // Add public timeline events as known facts (objective facts only)
  if (generated.timeline) {
    for (const te of generated.timeline) {
      if (te.isPublic) {
        facts.push(safeString(`[${te.time}] ${te.event}`));
      }
    }
  }

  // Add alibi claim (what the suspect says, not what actually happened)
  if (s.alibi) {
    facts.push(safeString(`Coartada declarada: ${s.alibi.claimed}`));
  }

  // NOTE: Evidence is shown in the evidence board, NOT here.
  // Evidence descriptions often contain plot-relevant information
  // that should be discovered during interrogation, not given upfront.

  const suspect: Suspect = {
    id: `gen_${generated.seed}`,
    name: safeString(s.name),
    age: 0,
    role: safeString(s.role),
    avatar: safeString(s.avatar),
    baseline: { stress, confidence, hostility },
    isGuilty: s.culpability === "guilty" || s.culpability === "accomplice",
    slipChance: s.culpability === "guilty" ? 0.18 : s.culpability === "accomplice" ? 0.12 : 0.05,
    systemPrompt: buildSystemPrompt(generated),
    caseBrief: safeString(generated.briefing),
    knownFacts: facts,
    stressRules: mapStressRules(s.stressRules),
  };

  return {
    id: `gen_${generated.seed}`,
    title: safeString(`${generated.title} — SEMILLA ${generated.seed}`),
    subtitle: `CASO GENERADO POR IA // ${safeString(generated.difficulty).toUpperCase() ?? "MEDIO"}`,
    briefing: safeString(generated.briefing),
    date: new Date().toLocaleDateString("es-ES", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).toUpperCase(),
    location: "SALA DE INTERROGATORIO",
    stakes: safeString(generated.stakes),
    suspect,
    evidence: mapEvidence(generated.evidence),
    timeline: generated.timeline ?? [],
    difficulty: safeString(generated.difficulty ?? "medio"),
  };
}

const genderMap = new Map<string, "man" | "woman">();

export function rememberGender(seed: string, gender: "man" | "woman") {
  genderMap.set(seed, gender);
}

export function recallGender(seed: string): "man" | "woman" {
  return genderMap.get(seed) ?? "man";
}
