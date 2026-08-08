/**
 * Ending determination — different endings based on vote results.
 */

export interface EndingResult {
  type: string;
  title: string;
  description: string;
  reference?: string;
  isSpecial: boolean;
}

export function determineEnding(
  majorityCorrect: boolean,
  suspectIsGuilty: boolean,
  playerCount: number,
  questionsAsked: number,
  isUnanimous: boolean,
  timeRatio: number
): EndingResult {
  // Special endings first

  // Lone wolf + correct
  if (playerCount === 1 && majorityCorrect && suspectIsGuilty) {
    return {
      type: "special_lone_wolf",
      title: "LOBO SOLITARIO — JUSTICIA SERVIDA",
      description: "Solo, sin ayuda, desenmascaraste al culpable. Como Solid Snake en una misión imposible, demostraste que un detective vale por mil. El mundo criminal teme tu nombre.",
      reference: "Metal Gear Solid 3 — \"A strong man doesn't need to read the future. He makes his own.\"",
      isSpecial: true,
    };
  }

  // Lone wolf + freed innocent
  if (playerCount === 1 && majorityCorrect && !suspectIsGuilty) {
    return {
      type: "special_mercy",
      title: "MISERICORDIA SOLOITARIA",
      description: "Solo, con todo en contra, elegiste la misericordia sobre la convicción. Dejaste libre a un inocente cuando sería más fácil acusar. Eso requiere más valor que cualquier acusación.",
      reference: "To Kill a Mockingbird — \"The one thing that doesn't abide by majority rule is a person's conscience.\"",
      isSpecial: true,
    };
  }

  // Unanimous + correct
  if (isUnanimous && majorityCorrect) {
    return {
      type: "special_unanimous",
      title: "VEREDICTO UNÁNIME",
      description: "Cada detective, sin excepción, estuvo de acuerdo. La verdad fue tan clara que no dejó espacio para la duda. 12 Angry Men habría estado orgulloso.",
      reference: "12 Angry Men — Unanimous Not Guilty",
      isSpecial: true,
    };
  }

  // No questions + correct
  if (questionsAsked === 0 && majorityCorrect) {
    return {
      type: "special_no_questions",
      title: "EL SILENCIO COMO ARMA",
      description: "Ni una sola pregunta. Dejaste que el silencio hablara, que el estrés del sospechoso se delatara, que la verdad se revelara sola. Paciencia sherlockiana.",
      reference: "Sherlock Holmes — \"To a great mind, nothing is little.\"",
      isSpecial: true,
    };
  }

  // Last second
  if (timeRatio > 0.95 && majorityCorrect) {
    return {
      type: "special_timeout",
      title: "EN EL ÚLTIMO SEGUNDO",
      description: "El reloj corría, el sudor caía, y justo cuando todo parecía perdido... la pieza encajó. Puro cine. Puro suspense.",
      reference: "Ace Attorney — The Turnabout",
      isSpecial: true,
    };
  }

  // Correct — detectives win
  if (majorityCorrect && suspectIsGuilty) {
    return {
      type: "detectives_win",
      title: "CULPABLE — JUSTICIA SERVIDA",
      description: `Los detectives unieron fuerzas y desenmascararon al culpable. La verdad siempre encuentra el camino. El criminal pagará por sus actos.`,
      reference: "L.A. Noire — Case Closed. 5 Stars.",
      isSpecial: false,
    };
  }

  if (majorityCorrect && !suspectIsGuilty) {
    return {
      type: "detectives_win",
      title: "INOCENTE — LIBERTAD RESTAURADA",
      description: "Los detectives vieron a través de las apariencias y dejaron libre a un inocente. La integridad de la justicia está intacta.",
      reference: "Phoenix Wright — NOT GUILTY!",
      isSpecial: false,
    };
  }

  // Wrong verdict — guilty suspect freed
  if (!majorityCorrect && suspectIsGuilty) {
    return {
      type: "special_wrong_verdict",
      title: "CRIMINAL LIBRE",
      description: "Los detectives dejaron libre al culpable. Mientras tanto, el verdadero criminal sonríe en el pasillo del tribunal. La justicia falló esta vez.",
      reference: "Among Us — DEFEAT. The Impostor wins.",
      isSpecial: true,
    };
  }

  // Wrong verdict — innocent imprisoned
  if (!majorityCorrect && !suspectIsGuilty) {
    return {
      type: "criminals_win",
      title: "INOCENTE ENCADENADO",
      description: "Los detectives encarcelaron a un inocente. Mientras tanto, el verdadero culpable camina libre. La justicia no solo es ciega — a veces ve al revés.",
      reference: "12 Angry Men — Wrong verdict, right intentions.",
      isSpecial: false,
    };
  }

  return {
    type: "criminals_win",
    title: "CASO PERDIDO",
    description: "La verdad se escapó entre las grietas. Mejor suerte la próxima, detective.",
    reference: "Dark Souls — YOU DIED. Try again.",
    isSpecial: false,
  };
}
