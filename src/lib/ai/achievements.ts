/**
 * Achievement definitions -- video game & classic detective references.
 * Adapted for single-suspect game with voting.
 */

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  reference?: string;
  unlocked: boolean;
  unlockedAt?: number;
  condition: string;
}

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: "first_blood",
    name: "First Blood",
    description: "Haz tu primera pregunta al sospechoso",
    icon: ">>",
    reference: "CS 1.6 -- First Blood",
    unlocked: false,
    condition: "first_question",
  },
  {
    id: "pressure_cooker",
    name: "Under Pressure",
    description: "Lleva el estres del sospechoso al 90%+",
    icon: "[!]",
    reference: "Queen & Bowie -- Under Pressure, 1981",
    unlocked: false,
    condition: "stress_90",
  },
  {
    id: "gotcha",
    name: "GOTCHA!",
    description: "Detecta una admision o resbalon del sospechoso",
    icon: "//",
    reference: "Phoenix Wright -- OBJECTION!",
    unlocked: false,
    condition: "admission_found",
  },
  {
    id: "speed_demon",
    name: "Speed Demon",
    description: "Vota correctamente en los primeros 60 segundos de deliberacion",
    icon: ">>",
    reference: "Doom -- RIP AND TEAR",
    unlocked: false,
    condition: "speed_vote",
  },
  {
    id: "wrong_verdict",
    name: "Wrong Verdict",
    description: "Los detectives votan incorrectamente",
    icon: "[X]",
    reference: "Among Us -- Ejected (Not An Impostor)",
    unlocked: false,
    condition: "wrong_verdict",
  },
  {
    id: "correct_acquittal",
    name: "Beneficio de la Duda",
    description: "Dejan libre a un sospechoso inocente",
    icon: "(~)",
    reference: "12 Angry Men -- Not Guilty",
    unlocked: false,
    condition: "correct_acquittal",
  },
  {
    id: "lobo_solitario",
    name: "Lone Wolf",
    description: "Completa una investigacion jugando solo",
    icon: "[W]",
    reference: "Metal Gear Solid 3 -- Snake Eater",
    unlocked: false,
    condition: "lone_wolf",
  },
  {
    id: "casa_llena",
    name: "Full House",
    description: "Juega con 4 detectives en la sala",
    icon: "[H]",
    reference: "Poker -- Full House",
    unlocked: false,
    condition: "full_house",
  },
  {
    id: "resbalon",
    name: "Slip of the Tongue",
    description: "El sospechoso se delata por su cuenta",
    icon: "?!",
    reference: "You Are Not Evil Enough -- Dr. Evil",
    unlocked: false,
    condition: "caught_slip",
  },
  {
    id: "cross_examine",
    name: "Cross Examination",
    description: "Haz 20+ preguntas en una sola investigacion",
    icon: "[>]",
    reference: "Ace Attorney -- Cross Examination",
    unlocked: false,
    condition: "cross_examiner",
  },
  {
    id: "sherlock",
    name: "Elementary",
    description: "Acuerdan correctamente con un argumento perfecto",
    icon: "[M]",
    reference: "Sherlock Holmes -- Elementary",
    unlocked: false,
    condition: "sherlock",
  },
  {
    id: "unanimous",
    name: "Unanime",
    description: "Todos los detectives votan lo mismo",
    icon: "[*]",
    reference: "12 Angry Men -- Unanimous Verdict",
    unlocked: false,
    condition: "unanimous_verdict",
  },
  {
    id: "tie_breaker",
    name: "Tie Breaker",
    description: "Rompe un empate en la votacion final",
    icon: "[=]",
    reference: "Survivor -- Deadlock Breaker",
    unlocked: false,
    condition: "tie_breaker",
  },
  {
    id: "innocent_freed",
    name: "Inocente Libre",
    description: "Dejan libre a un inocente (el sospechoso era inocente)",
    icon: "[+]",
    reference: "To Kill a Mockingbird -- Atticus Finch",
    unlocked: false,
    condition: "innocent_freed",
  },
  {
    id: "criminal_caught",
    name: "Justice Served",
    description: "Encierran al culpable (el sospechoso era culpable)",
    icon: "[#]",
    reference: "L.A. Noire -- Case Closed",
    unlocked: false,
    condition: "criminal_caught",
  },
  {
    id: "no_notes",
    name: "Memory Palace",
    description: "Gana sin escribir ninguna nota",
    icon: "[P]",
    reference: "Sherlock Holmes -- Mind Palace",
    unlocked: false,
    condition: "no_notes",
  },
  {
    id: "contradiction",
    name: "Gotcha!",
    description: "Detecta una contradiccion en las declaraciones del sospechoso",
    icon: "[!]",
    reference: "Phoenix Wright -- Contradiction Found",
    unlocked: false,
    condition: "contradiction_found",
  },
];

export function getAchievementById(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find(a => a.id === id);
}

export const ACHIEVEMENT_MESSAGES: Record<string, string> = {
  first_blood: ">> First Blood! -- CS 1.6, 2000. Tu primera pregunta. El juego ha comenzado.",
  pressure_cooker: "[!] Under Pressure! -- Queen & Bowie, 1981. Llevaste al limite.",
  gotcha: "// OBJECTION! -- Phoenix Wright: Ace Attorney, 2001. Se delataron.",
  speed_demon: ">> Speed Demon! -- Doom, 1993. RIP AND TEAR! Sin tiempo que perder.",
  wrong_verdict: "[X] Wrong Verdict... -- Among Us, 2018. Ejected. (Not An Impostor)",
  correct_acquittal: "(~) Not Guilty -- 12 Angry Men. La justicia prevalece.",
  lobo_solitario: "[W] Lone Wolf -- MGS3, 2004. Solo contra todos.",
  casa_llena: "[H] Full House -- Poker. 4 detectives, 1 verdad.",
  resbalon: "?! Slip of the Tongue -- Se delataron solos.",
  cross_examine: "[>] Cross Examination -- Ace Attorney. 20 preguntas sin parar.",
  sherlock: "[M] Elementary -- Sherlock Holmes. Un dedo, una conclusion.",
  unanimous: "[*] Unanimous -- 12 Angry Men. Todos de acuerdo.",
  tie_breaker: "[=] Tie Breaker -- Survivor. Tu voto decidio todo.",
  innocent_freed: "[+] Not Guilty -- To Kill a Mockingbird. Atticus Finch estaria orgulloso.",
  criminal_caught: "[#] Case Closed -- L.A. Noire. Justicia servida.",
  no_notes: "[P] Mind Palace -- Sherlock Holmes. Tu mente es tu herramienta.",
  contradiction: "[!] Contradiction! -- Phoenix Wright. Mienten y no lo saben.",
};
