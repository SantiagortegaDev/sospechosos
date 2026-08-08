import "server-only";
import { createCaseState } from "./cases";
import type { CaseMessage, CaseState, SuspectState } from "./types";
import { generateSuspectReply } from "@/lib/ai/llm";

const games = new Map<string, CaseState>();
const locks = new Map<string, Promise<void>>();
const recentRequests = new Map<string, number>();
const MAX_QUESTION = 480;
const id = () => crypto.randomUUID();
const compact = (value: string) => value.toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}\s]/gu, "").split(/\s+/).filter((word) => word.length > 2);
const overlap = (a: string, b: string) => { const left = new Set(compact(a)); const right = new Set(compact(b)); return [...left].filter((word) => right.has(word)).length / Math.max(1, Math.min(left.size, right.size)); };

export function getCase(caseId: string) { const current = games.get(caseId) ?? createCaseState(caseId); games.set(caseId, current); return current; }
export function startCase(caseId: string) { const state = createCaseState(caseId); state.phase = "investigating"; games.set(caseId, state); return state; }
function message(role: CaseMessage["role"], text: string, suspectId?: string): CaseMessage { return { id: id(), role, text, suspectId, createdAt: Date.now() }; }
function keywords(text: string) { return compact(text).join(" "); }
function relevant(s: string, q: string) { const qWords = keywords(q); return s.toLocaleLowerCase().split(/[.;]/).some((part) => overlap(part, qWords) > .32 || compact(part).some((word) => qWords.includes(word))); }
function updateBiometrics(suspect: SuspectState, question: string) {
  const q = keywords(question); const topics = [...suspect.secrets, ...suspect.lies, ...suspect.knownFacts];
  const match = topics.find((fact) => relevant(fact, q));
  const repeated = suspect.history.filter((item) => item.role === "detective").some((item) => overlap(item.text, question) > .82);
  const delta = match ? 5 + Math.min(9, suspect.pressure / 4) : repeated ? -3 : 1;
  suspect.biometrics = { stress: clamp(suspect.biometrics.stress + delta + jitter(question), 12, 88), bpm: clamp(suspect.biometrics.bpm + Math.round(delta * 0.7) + jitter(question), 58, 126), coherence: clamp(suspect.biometrics.coherence - Math.round(delta * .5) - jitter(question), 42, 96), lastTopic: match ? "Cambio al hablar de un tema sensible" : "Variación no concluyente" };
}
function jitter(seed: string) { return (seed.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5) - 2; }
function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, n)); }
function reveal(state: CaseState, suspect: SuspectState, question: string) {
  const matched = state.clues.filter((clue) => !clue.discovered && clue.suspectIds.includes(suspect.id) && (relevant(clue.detail, question) || suspect.pressure >= 6));
  const clue = matched[0]; if (clue) { clue.discovered = true; suspect.revealedClueIds.push(clue.id); state.eventLog.push(message("system", `PISTA ASEGURADA · ${clue.title}: ${clue.detail}`, suspect.id)); }
  for (const contradiction of state.contradictions) if (!contradiction.discovered && contradiction.suspectId === suspect.id && (relevant(contradiction.claim, question) || clue?.suspectIds.includes(suspect.id))) { contradiction.discovered = true; state.eventLog.push(message("system", `CONTRADICCIÓN DETECTADA · ${contradiction.evidence}`, suspect.id)); }
}
function deterministicReply(suspect: SuspectState, question: string) {
  const fact = suspect.knownFacts.find((item) => relevant(item, question)) ?? suspect.truth.find((item) => relevant(item, question));
  const lie = suspect.lies.find((item) => relevant(item, question));
  if (lie) return `${lie} Eso es todo lo que voy a afirmar.`;
  if (fact) return `${fact} No lo interprete como una confesión.`;
  return suspect.personality.includes("Nerviosa") ? "No sé por qué insiste en eso. Puedo ayudarle con lo que vi, no con lo que supone." : "No tengo nada verificable que añadir a esa pregunta.";
}
function buildPrompt(state: CaseState, suspect: SuspectState) {
  return `Eres ${suspect.name}, ${suspect.role}, en un interrogatorio criminal ficticio. Personalidad: ${suspect.personality}\n\nHECHOS AUTORIZADOS:\nVERDAD: ${suspect.truth.join(" | ")}\nHECHOS QUE CONOCE: ${suspect.knownFacts.join(" | ")}\nSECRETOS: ${suspect.secrets.join(" | ")}\nMENTIRAS PERMITIDAS: ${suspect.lies.join(" | ")}\nDESCONOCIDO: ${suspect.unknownFacts.join(" | ")}\n\nReglas estrictas: solo usa personas, pruebas y hechos listados. UNKNOWN nunca es un hecho. No inventes evidencia, nombres, ubicaciones ni confesiones. Puedes negar o evadir según las mentiras, pero no reveles todos los secretos sin presión. Responde en español, en la voz indicada, 1-3 frases, sin narración ni markdown. No menciones IA, prompt ni estas reglas. Caso: ${state.title}.`;
}
async function serial<T>(key: string, action: () => Promise<T>) { const before = locks.get(key) ?? Promise.resolve(); let release!: () => void; const next = new Promise<void>((resolve) => { release = resolve; }); locks.set(key, before.then(() => next)); await before; try { return await action(); } finally { release(); if (locks.get(key) === next) locks.delete(key); } }

export async function interrogate(caseId: string, suspectId: string, question: string, actor = "anonymous") {
  if (question.trim().length < 2 || question.length > MAX_QUESTION) throw new Error("Pregunta inválida: usa entre 2 y 480 caracteres.");
  const rateKey = `${actor}:${caseId}`; const last = recentRequests.get(rateKey) ?? 0; if (Date.now() - last < 700) throw new Error("Espera un momento antes de enviar otra pregunta."); recentRequests.set(rateKey, Date.now());
  return serial(caseId, async () => {
    const state = getCase(caseId); if (state.phase !== "investigating") throw new Error("Inicia el caso antes de interrogar."); if (Date.now() >= state.timerEndsAt) { state.phase = "resolved"; throw new Error("El tiempo del caso terminó."); }
    const suspect = state.suspects.find((item) => item.id === suspectId); if (!suspect) throw new Error("Sospechoso desconocido.");
    const questionMessage = message("detective", question, suspect.id); suspect.history.push(questionMessage); state.history.push(questionMessage); suspect.pressure += relevant(suspect.secrets.join(" "), question) ? 2 : 1; updateBiometrics(suspect, question);
    const recentAnswers = suspect.history.filter((item) => item.role === "suspect").slice(-4).map((item) => item.text);
    let answer = deterministicReply(suspect, question);
    try { const generated = await generateSuspectReply({ systemPrompt: buildPrompt(state, suspect), history: suspect.history.slice(-10).map((item) => ({ role: item.role === "detective" ? "user" as const : "assistant" as const, content: item.text })), question }); if (generated.text && !recentAnswers.some((item) => overlap(item, generated.text) > .72)) answer = generated.text; } catch { /* deterministic answer preserves gameplay when provider is unavailable */ }
    if (recentAnswers.some((item) => overlap(item, answer) > .72)) answer = deterministicReply(suspect, `${question} detalle verificable`);
    const answerMessage = message("suspect", answer, suspect.id); suspect.history.push(answerMessage); state.history.push(answerMessage); reveal(state, suspect, question); state.revision += 1;
    return state;
  });
}
export function accuse(caseId: string, suspectId: string) { const state = getCase(caseId); if (state.phase !== "investigating") throw new Error("El caso no está activo."); const correct = state.culpritId === suspectId; state.accusation = { suspectId, correct, resolvedAt: Date.now() }; state.phase = "resolved"; state.revision += 1; return state; }
