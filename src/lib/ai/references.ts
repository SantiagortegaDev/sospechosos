/**
 * Video game & classic references -- used throughout the game for flavor.
 */

export const GAME_REFERENCES = {
  // Shown randomly in loading screens, transitions, etc.
  loadingTips: [
    "\"La verdad es como un puzzle -- cada pieza importa.\" -- Professor Layton",
    "\"OBJECTION!\" -- Phoenix Wright: Ace Attorney, 2001",
    "\"Justice is not something that you just get. It's something that you fight for.\" -- Apollo Justice",
    "\"The world is a giant puzzle, and I intend to solve it.\" -- Hershel Layton",
    "\"Even a broken clock is right twice a day.\" -- Inspector Clouseau",
    "\"To a great mind, nothing is little.\" -- Sherlock Holmes",
    "\"I am the world's greatest detective.\" -- Batman",
    "\"The only thing we have to fear is fear itself.\" -- FDR (good for interrogations)",
    "\"Gotta catch 'em all!\" -- Pokemon (good for catching liars)",
    "\"A jury of your peers.\" -- 12 Angry Men",
    "\"Would you kindly?\" -- Bioshock (mind control reference)",
    "\"The cake is a lie.\" -- Portal (don't trust everything you hear)",
    "\"Stay a while and listen.\" -- Diablo (the suspects have stories)",
    "\"Nothing is true, everything is permitted.\" -- Assassin's Creed",
    "\"War. War never changes.\" -- Fallout (neither do criminals)",
    "\"I used to be an adventurer like you, then I took an arrow to the knee.\" -- Skyrim",
  ],

  // Suspect reactions -- things the AI might reference
  suspectReactions: {
    stressed: [
      "El sospechoso empieza a sudar como Snake en Metal Gear Solid evadiendo guardias.",
      "Nivel de estres critico -- como cuando el Power Running Out suena en FNAF.",
      "El sospechoso se pone nervioso como Mario cuando la musica se acelera.",
    ],
    calm: [
      "El sospechoso esta mas calmado que un NPC de Skyrim esperando tu pregunta.",
      "Nada lo perturba -- tan estoico como Gordon Freeman sin hablar.",
    ],
    caught: [
      "Se delato! Como cuando en Among Us el impostor se auto-reporta.",
      "Error 404: Mentira no encontrada. El sospechoso se contradice.",
      "Plot twist -- como en Sixth Sense cuando descubres la verdad.",
    ],
    dodging: [
      "Esquivando preguntas como Neo esquivando balas en The Matrix.",
      "Mas evasivo que un jefe final de Dark Souls.",
    ],
  },

  // Game over / result screen references
  resultQuotes: [
    "\"The truth will set you free.\" -- John 8:32",
    "\"You can't handle the truth!\" -- A Few Good Men",
    "\"Elementary, my dear Watson.\" -- Sherlock Holmes (attributed)",
    "\"I never guess. It is a capital mistake to theorize before one has data.\" -- Sherlock Holmes",
    "\"Game Over. You have been found guilty... or not. Depends on your skills.\" -- Ace Attorney",
    "\"A winner is you!\" -- Punch-Out!!",
    "\"Thank you, Mario! But our princess is in another castle!\" -- Super Mario Bros",
    "\"Would you be my detective?\" -- Bioshock (parody)",
    "\"War never changes, but criminals do.\" -- Fallout parody",
    "\"FATALITY.\" -- Mortal Kombat (when accusation is perfect)",
    "\"FLAWLESS VICTORY.\" -- Mortal Kombat (when everything goes right)",
    "\"FINISH HIM!\" -- Mortal Kombat (during accusation phase)",
  ],

  // Easter egg messages shown during specific situations
  easterEggs: {
    allSuspectsMaxStress: "[!] MEGA STRESS -- Ambos sospechosos en nivel CRITICO. Como la final de un juego de terror donde todos pierden la cordura. Quien se rompe primero?",
    firstQuestionEverySuspect: "[>] Cross Examination Complete -- Preguntaste a todos. Ahora viene la parte dificil: separar la verdad de las mentiras. Como en 12 Angry Men.",
    tenQuestionsNoAdmission: "[=] Los sospechosos son mas duros que un jefe final sin weak point. Sigue presionando.",
    interceptedFiveWhispers: "[!] You became The Wire. Ahora sabes mas de lo que deberias. Que hacer con esta informacion?",
    aboutToEnd: "[!] ULTIMO MINUTO -- Es ahora o nunca. Como la escena del desactivador de bombas en 24. Tick. Tick. Tick.",
  },
};
