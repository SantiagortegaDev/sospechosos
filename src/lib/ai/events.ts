/**
 * Secondary events system — random events that interrupt gameplay.
 * Events: power outage, message interception, witness, comms cut, etc.
 */

import type { GameEvent, ChallengeData } from "@/lib/types/game";

const MATH_CHALLENGES = [
  () => {
    const a = Math.floor(Math.random() * 20) + 5;
    const b = Math.floor(Math.random() * 20) + 5;
    const op = Math.random() > 0.5 ? "+" : "-";
    const answer = op === "+" ? a + b : a - b;
    return { question: `¿Cuánto es ${a} ${op} ${b}?`, answer: String(answer) };
  },
  () => {
    const a = Math.floor(Math.random() * 12) + 2;
    const b = Math.floor(Math.random() * 12) + 2;
    return { question: `¿Cuánto es ${a} × ${b}?`, answer: String(a * b) };
  },
];

const SEQUENCE_CHALLENGES = [
  () => {
    const start = Math.floor(Math.random() * 10) + 1;
    const diff = Math.floor(Math.random() * 5) + 2;
    const seq = [start, start + diff, start + diff * 2, start + diff * 3];
    const next = start + diff * 4;
    return { 
      question: `Completa la secuencia: ${seq.join(", ")}, ?`, 
      answer: String(next),
      hint: `La diferencia entre cada número es ${diff}`
    };
  },
];

const WORD_CHALLENGES = [
  () => {
    const words = [
      { original: "SOSPECHOSO", scrambled: "SEPOHCOSOS" },
      { original: "EVIOENCIA", scrambled: "NEIVDOEACI" },
      { original: "INTERROGAR", scrambled: "GEARTIRON" },
      { original: "CRIMINAL", scrambled: "MIARLNCEI" },
      { original: "JUSTICIA", scrambled: "JCUATIIAS" },
      { original: "DETECTIVE", scrambled: "DTECTIEEV" },
    ];
    const w = words[Math.floor(Math.random() * words.length)];
    return { question: `¿Qué palabra es: "${w.scrambled}"?`, answer: w.original };
  },
];

const CODE_CHALLENGES = [
  () => {
    // Simple cipher: each letter shifted by a fixed amount
    const words = ["VERDAD", "MENTIRA", "CULPABLE", "INOCENTE"];
    const word = words[Math.floor(Math.random() * words.length)];
    const shift = 3;
    const coded = word.split("").map(c => 
      String.fromCharCode(((c.charCodeAt(0) - 65 + shift) % 26) + 65)
    ).join("");
    return { 
      question: `Descifra (César +${shift}): "${coded}"`, 
      answer: word,
      hint: "Cada letra avanza 3 posiciones en el abecedario"
    };
  },
];

export const EVENT_TEMPLATES: Array<{
  type: GameEvent["type"];
  description: string;
  duration: number;
  needsChallenge: boolean;
  gameReference: string;
}> = [
  {
    type: "power_outage",
    description: "⚡ SE VA LA LUZ — Los monitores se apagan. Los sospechosos no pueden ser monitoreados temporalmente. Completa el reto para restaurar la energía.",
    duration: 15000,
    needsChallenge: true,
    gameReference: "Five Nights at Freddy's — Power running out...",
  },
  {
    type: "message_intercepted",
    description: "📡 MENSAJES INTERCEPTADOS — Parece que alguien está espiando tu canal privado de detectives. Completa el reto para cifrar tus comunicaciones.",
    duration: 20000,
    needsChallenge: true,
    gameReference: "Metal Gear Solid — \"!\" Alert detected",
  },
  {
    type: "witness_appears",
    description: "👁️ TESTIGO MISTERIOSO — Alguien apareció en la sala de espera. Dice tener información vital... pero solo hablará si resuelven su acertijo.",
    duration: 20000,
    needsChallenge: true,
    gameReference: "Professor Layton — \"Every puzzle has a solution\"",
  },
  {
    type: "communication_cut",
    description: "🔇 COMUNICACIÓN CORTADA — El canal de detectives ha sido interferido. No pueden comunicarse por 45 segundos. A menos que resuelvan esto...",
    duration: 20000,
    needsChallenge: true,
    gameReference: "Splinter Cell — Communications jammed",
  },
  {
    type: "suspect_lawyer",
    description: "⚖️ ABOGADO — Un sospechoso pide su abogado. Se niega a responder preguntas por 60 segundos. El tiempo sigue corriendo...",
    duration: 25000,
    needsChallenge: false,
    gameReference: "Ace Attorney — \"I'd like to speak with my attorney\"",
  },
  {
    type: "evidence_leak",
    description: "📄 FILTRACIÓN DE EVIDENCIA — Un documento parcial apareció en la pizarra de evidencia. Lee con atención — podría ser una pista... o una trampa.",
    duration: 15000,
    needsChallenge: false,
    gameReference: "Papers, Please — Examine the documents carefully",
  },
  {
    type: "challenge",
    description: "🧩 RETO DEL SISTEMA — El sistema de interrogatorio requiere verificación humana. Resuelve el reto para continuar.",
    duration: 20000,
    needsChallenge: true,
    gameReference: "Resident Evil — Solve the puzzle to proceed",
  },
];

export function generateRandomEvent(): GameEvent {
  const template = EVENT_TEMPLATES[Math.floor(Math.random() * EVENT_TEMPLATES.length)];
  
  let challengeData: ChallengeData | undefined;
  
  if (template.needsChallenge) {
    const generators = [MATH_CHALLENGES, SEQUENCE_CHALLENGES, WORD_CHALLENGES, CODE_CHALLENGES];
    const gen = generators[Math.floor(Math.random() * generators.length)];
    const funcs = gen.length > 1 ? gen : gen;
    const func = Array.isArray(funcs) ? funcs[Math.floor(Math.random() * funcs.length)] : funcs;
    const challenge = typeof func === "function" ? func() : { question: "Error", answer: "error" };
    challengeData = {
      type: template.type === "challenge" ? "math" : 
            template.type === "power_outage" ? "code_break" :
            template.type === "message_intercepted" ? "word_scramble" : "sequence",
      question: challenge.question,
      answer: challenge.answer,
      hint: challenge.hint,
    };
  }

  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: template.type,
    description: template.description,
    startedAt: Date.now(),
    duration: template.duration,
    resolved: false,
    challengeData,
  };
}

export function getEventGameReference(eventType: GameEvent["type"]): string {
  const template = EVENT_TEMPLATES.find(t => t.type === eventType);
  return template?.gameReference || "Unknown event";
}

// Leak evidence text — shown during evidence_leak events
export const EVIDENCE_LEAKS = [
  "DOCUMENTO PARCIAL: \"...transferencia autorizada por [ILEGIBLE] el día 14 de julio... Kestrel Holdings cuenta #... saldo $4,200,000...\"",
  "EMAIL RECUPERADO: \"De: R.H. Para: E.V. Asunto: Lo que tiene que hacerse. Reyes está preguntando demasiadas preguntas. — R\"",
  "REGISTRO DE LLAMADAS: 14/07 21:47 — De: Hale (personal) → Voss (personal) — Duración: 4m 32s",
  "RECEPCIÓN BANCARIA: Kestrel Holdings Ltd. — Depósito inicial: $4,200,000 — Fecha: 15/07/2024 — Beneficiario: [REDACTADO]",
  "NOTA MANUSCRITA: \"Martin no va a dejar pasar esto. Hay que hacer algo. — E\" (encontrada en el cajón de Voss)",
];
