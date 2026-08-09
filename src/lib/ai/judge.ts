/**
 * AI Judge — only activates at the END of the game.
 * Evaluates the collective detective decision (vote results) and decides:
 * - If the suspect goes FREE or is IMPRISONED
 * Uses Groq (llama-3.3-70b-versatile) via rate-limited LLM wrapper.
 */

import { generateJudgeVerdict } from "./llm";

/** Force any value to a plain string — LLMs sometimes return objects. */
function forceStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  try { return JSON.stringify(v); } catch { return String(v); }
}

const JUDGE_SYSTEM_PROMPT = `Eres el JUEZ VALERIA CRUZ, una magistrada implacable con 30 años de experiencia. Has revisado TODA la evidencia de esta investigación.

Tu Personalidad:
- Cita máximas legales y casos famosos
- Cero tolerancia para argumentos débiles ("No pierdan mi tiempo")
- Aprecias razonamiento inteligente, incluso si es parcialmente incorrecto
- Hablas en tono autoritario con humor seco
- Referencias: Phoenix Wright, Atticus Finch, 12 Angry Men

Tu papel: Los detectives han VOTADO si el sospechoso es culpable o inocente. Tú decides:
1. Si la decisión de los detectives es CORRECTA (coincide con la realidad del caso)
2. Si el sospechoso va PRESO o queda LIBRE
3. Tu razonamiento y un comentario memorable

Formato de salida — JSON exacto:
{
  "majorityCorrect": true/false,
  "suspectIsGuilty": true/false,
  "decision": "imprisoned" o "freed",
  "judgeReasoning": "Tu razonamiento detallado de 2-4 oraciones EN ESPAÑOL",
  "judgesComment": "Un comentario memorable EN ESPAÑOL, con referencia legal o cultural"
}

IMPORTANTE: Todos los campos de texto deben estar en español.`;

export async function evaluateVote(
  suspectId: string,
  votes: Array<{ playerName: string; vote: "guilty" | "innocent"; reason: string }>,
  conversationSummary: string,
  stressHistory: string,
  suspectIsGuiltyOverride?: boolean,
  suspectNameOverride?: string
): Promise<{
  majorityCorrect: boolean;
  suspectIsGuilty: boolean;
  decision: "freed" | "imprisoned";
  guiltyVotes: number;
  innocentVotes: number;
  judgeReasoning: string;
  judgesComment: string;
}> {
  const suspectName = suspectNameOverride || "Desconocido";
  const actualGuilty = suspectIsGuiltyOverride ?? false;

  const guiltyCount = votes.filter(v => v.vote === "guilty").length;
  const innocentCount = votes.filter(v => v.vote === "innocent").length;
  const isTie = guiltyCount === innocentCount;
  const majorityGuilty = guiltyCount > innocentCount;

  const majorityCorrect =
    (majorityGuilty && actualGuilty) || (!majorityGuilty && !actualGuilty);

  // On a tie, the judge decides based on the best argument. We compute a
  // simple heuristic: longer + more specific reasons win. This is a fallback
  // in case the LLM fails to parse. The LLM is also instructed to pick.
  let tieWinner: "guilty" | "innocent" | null = null;
  if (isTie) {
    const guiltyVotes = votes.filter(v => v.vote === "guilty");
    const innocentVotes = votes.filter(v => v.vote === "innocent");
    const guiltyScore = guiltyVotes.reduce((sum, v) => sum + Math.min(v.reason.length, 200) / 100, 0);
    const innocentScore = innocentVotes.reduce((sum, v) => sum + Math.min(v.reason.length, 200) / 100, 0);
    tieWinner = guiltyScore >= innocentScore ? "guilty" : "innocent";
  }

  const effectiveGuilty = isTie ? (tieWinner === "guilty") : majorityGuilty;
  const majorityCorrectTie =
    (effectiveGuilty && actualGuilty) || (!effectiveGuilty && !actualGuilty);

  const decision: "freed" | "imprisoned" = effectiveGuilty ? "imprisoned" : "freed";

  const voteSummary = votes.map(v =>
    `- ${v.playerName}: ${v.vote === "guilty" ? "CULPABLE" : "INOCENTE"} — "${v.reason}"`
  ).join("\n");

  const prompt = `Los detectives han votado sobre ${suspectName}:

VOTACIONES (${votes.length} detectives):
${voteSummary}

${isTie
  ? `EMPATE (${guiltyCount} culpable / ${innocentCount} inocente). Como Jueza, TÚ decides el desempate. Analiza cuál detective presentó el MEJOR ARGUMENTO (más específico, basado en evidencia, lógico). El sospechoso ${tieWinner === "guilty" ? "va PRESO" : "queda LIBRE"} según tu análisis del mejor argumento.`
  : `Mayoría: ${majorityGuilty ? "CULPABLE (envían a prisión)" : "INOCENTE (dejan libre)"}`}

RESUMEN DE LA INVESTIGACIÓN:
${conversationSummary}

HISTORIAL DE ESTRÉS DEL SOSPECHOSO:
${stressHistory}

Como Jueza Valeria Cruz, evalúa esta decisión. ¿Los detectives acertaron? ¿El sospechoso debe ir preso o quedar libre?

Recuerda: La REALIDAD del caso es que ${suspectName} ${actualGuilty ? "ES culpable" : "ES inocente"}. Los detectives ${majorityCorrectTie ? "acertaron" : "se equivocaron"}.

Devuelve tu veredicto como JSON.`;

  try {
    const raw = await generateJudgeVerdict(JUDGE_SYSTEM_PROMPT, prompt);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        // majorityCorrect is ALWAYS computed deterministically from the
        // vote vs the actual guilt — never trusted to the LLM. On a tie,
        // uses the tie-breaker (best argument heuristic).
        majorityCorrect: majorityCorrectTie,
        suspectIsGuilty: actualGuilty,
        // decision is also deterministic — based on the vote majority.
        decision,
        guiltyVotes: guiltyCount,
        innocentVotes: innocentCount,
        judgeReasoning: forceStr(parsed.judgeReasoning) || "La corte ha tomado su decisión.",
        judgesComment: forceStr(parsed.judgesComment) || "Justicia ha sido servida.",
      };
    }

    return {
      majorityCorrect: majorityCorrectTie,
      suspectIsGuilty: actualGuilty,
      decision,
      guiltyVotes: guiltyCount,
      innocentVotes: innocentCount,
      judgeReasoning: raw.slice(0, 300) || "La corte ha deliberado.",
      judgesComment: "La justicia tiene sus propios tiempos.",
    };
  } catch (err) {
    console.error("[judge] evaluation failed:", err);
    return {
      majorityCorrect: majorityCorrectTie,
      suspectIsGuilty: actualGuilty,
      decision,
      guiltyVotes: guiltyCount,
      innocentVotes: innocentCount,
      judgeReasoning: "La corte encontró un error procesal. La decisión no pudo ser evaluada completamente.",
      judgesComment: "La justicia tarda, pero llega.",
    };
  }
}
