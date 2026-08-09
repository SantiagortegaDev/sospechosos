"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  channelIdsFor,
  type GameMessage,
  type DetectiveMessage,
  type StressUpdate,
  type AIEventPayload,
  type VotePayload,
} from "@/lib/portal/channels";
import {
  SUSPECTS,
  findSuspect,
  type Suspect,
  type CaseInfo,
} from "@/lib/ai/suspects";
import { adaptGeneratedCase, rememberGender, recallGender } from "@/lib/ai/adapt-generated";
import type { GeneratedCase } from "@/lib/ai/generated-case";
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_MESSAGES,
  type Achievement,
} from "@/lib/ai/achievements";
import { determineEnding, type EndingResult } from "@/lib/ai/endings";
import { useChannel } from "@portalsdk/react";
import { cn } from "@/lib/utils";
import { TypewriterText } from "@/components/interrogation/typewriter-text";
import { TypingIndicator } from "@/components/interrogation/typing-indicator";
import { CaseGeneratorScreen } from "@/components/interrogation/case-generator-screen";
import { SuspectPortrait } from "@/components/interrogation/suspect-portrait";
import * as SFX from "@/lib/audio/sound-engine";
import { speak, stopSpeaking } from "@/lib/audio/tts";
import type {
  GamePhase,
  Session,
  StressState,
  DetectiveVote,
  ConversationTurn,
  DetectiveNote,
  TimelineEntry,
  EvidenceItem,
  InterrogationTechnique,
  DetectiveRating,
} from "@/lib/types/game";

/* ═══════════════════════════════════════════════════════════════════════
 * CONSTANTS
 * ═══════════════════════════════════════════════════════════════════════ */

const STORAGE_KEY = "sospechosos:session";
const TUTORIAL_KEY = "sospechosos:tutorial_seen";
const AI_TICK_MS = 40_000;
const DELIBERATION_SECONDS = 120;
const EVIDENCE_REVIEW_SECONDS = 60;
const QUICK_QUESTIONS = [
  { label: "Coartada", text: "¿Dónde estabas el día del crimen?" },
  { label: "Relación", text: "¿Conocías a la víctima?" },
  { label: "Motivo", text: "¿Tienes algún motivo?" },
  { label: "Versión", text: "¿Puedes describir tu versión de los hechos?" },
  { label: "Testigos", text: "¿Alguien puede confirmar tu historia?" },
  { label: "Directa", text: "¿Tienes algo que esconder?" },
];

const TECHNIQUES: Array<{ key: InterrogationTechnique; label: string; emoji: string }> = [
  { key: "neutral", label: "NEUTRAL", emoji: "" },
  { key: "amenaza", label: "AMENAZA", emoji: "" },
  { key: "empatia", label: "EMPATÍA", emoji: "" },
  { key: "enganio", label: "ENGAÑO", emoji: "" },
];

const SUSPECT_TELLS = [
  { emoji: "", label: "Gotas de sudor", minStress: 40 },
  { emoji: "", label: "Parpadeo rápido", minStress: 50 },
  { emoji: "", label: "Puño cerrado", minStress: 60 },
  { emoji: "", label: "Respiración agitada", minStress: 70 },
  { emoji: "", label: "Mirada esquiva", minStress: 80 },
  { emoji: "", label: "Al borde del colapso", minStress: 90 },
];

/* ═══ Session helpers ═══ */

function loadSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function saveSession(s: Session) {
  if (typeof window !== "undefined")
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}
function clearSession() {
  if (typeof window !== "undefined") sessionStorage.removeItem(STORAGE_KEY);
}
function getRoomCodeFromURL(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get("room") || null;
}
function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function getDetectiveRating(
  correct: boolean,
  questionsAsked: number,
  evidenceUnlocked: number,
  totalEvidence: number,
  timeRatio: number
): DetectiveRating {
  let score = 0;
  if (correct) score += 40;
  if (questionsAsked >= 15) score += 15;
  else if (questionsAsked >= 10) score += 10;
  else if (questionsAsked >= 5) score += 5;
  if (totalEvidence > 0 && evidenceUnlocked / totalEvidence >= 0.8) score += 20;
  else if (totalEvidence > 0 && evidenceUnlocked / totalEvidence >= 0.5) score += 10;
  if (timeRatio < 0.5) score += 15;
  else if (timeRatio < 0.75) score += 10;
  else score += 5;

  if (score >= 85) return "S";
  if (score >= 70) return "A";
  if (score >= 55) return "B";
  if (score >= 40) return "C";
  return "D";
}

function getPhaseSteps(currentPhase: GamePhase): Array<{ key: string; label: string }> {
  const all = [
    { key: "evidence_review", label: "EVIDENCIA" },
    { key: "playing", label: "INTERROGATORIO" },
    { key: "deliberation", label: "DELIBERACIÓN" },
    { key: "vote", label: "VOTO" },
    { key: "verdict", label: "VEREDICTO" },
  ];
  return all;
}

/** Defense-in-depth: coerce any value to a safe React-renderable string. */
function safeRender(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  try { return JSON.stringify(v); }
  catch { return String(v); }
}

/* ═══════════════════════════════════════════════════════════════════════
 * MAIN COMPONENT
 * ═══════════════════════════════════════════════════════════════════════ */

export default function Home() {
  const [playerId] = useState<string>(
    () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)
  );

  const [phase, setPhase] = useState<GamePhase>("welcome");

  const [session, setSession] = useState<Session | null>(null);
  const [username, setUsername] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [roundTime, setRoundTime] = useState<number>(5);
  const [maxDetectives, setMaxDetectives] = useState<number>(2);
  const [difficulty, setDifficulty] = useState<"facil" | "normal" | "dificil">("normal");
  const [crimeTheme, setCrimeTheme] = useState<"random" | "fraude" | "robo" | "asesinato" | "sabotaje">("random");
  const [aiVoice, setAiVoice] = useState<"on" | "off">("off");
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [lobbyPlayers, setLobbyPlayers] = useState<
    Array<{ id: string; username: string; isHost: boolean }>
  >([]);
  const [error, setError] = useState("");
  const [muted, setMutedState] = useState(SFX.isMuted());
  const [loading, setLoading] = useState(false);

  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialChecked, setTutorialChecked] = useState(false);

  /* Welcome flash */
  const [welcomeFlash, setWelcomeFlash] = useState(false);
  /* Welcome mounted */
  const [welcomeMounted, setWelcomeMounted] = useState(false);
  useEffect(() => { if (phase === 'welcome') { requestAnimationFrame(() => setWelcomeMounted(true)); } }, [phase]);

  /* Case & intro */
  const [currentCase, setCurrentCase] = useState<CaseInfo | null>(null);
  const [generatedCaseRaw, setGeneratedCaseRaw] = useState<GeneratedCase | null>(null);
  const [caseIntroStep, setCaseIntroStep] = useState(0);

  /* Timer */
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [totalTime, setTotalTime] = useState(0);

  /* Playing */
  const [chatMessages, setChatMessages] = useState<GameMessage[]>([]);
  const [detectiveMessages, setDetectiveMessages] = useState<DetectiveMessage[]>([]);
  const [stress, setStress] = useState<StressState>({
    stress: 30,
    confidence: 70,
    hostility: 20,
  });
  const [nervousness, setNervousness] = useState(30);
  const [conversationHistory, setConversationHistory] = useState<ConversationTurn[]>([]);
  const [notes, setNotes] = useState("");
  const [timelineEntries, setTimelineEntries] = useState<TimelineEntry[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [detectiveDraft, setDetectiveDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [questionsAsked, setQuestionsAsked] = useState(0);
  const [flaggedCount, setFlaggedCount] = useState(0);
  const [maxStress, setMaxStress] = useState(0);

  /* Evidence */
  const [evidenceItems, setEvidenceItems] = useState<EvidenceItem[]>([]);
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceItem | null>(null);

  /* Technique */
  const [technique, setTechnique] = useState<InterrogationTechnique>("neutral");

  /* Right panel & mobile tabs */
  const [rightTab, setRightTab] = useState<
    "expediente" | "evidencia" | "notas" | "timeline" | "detectives" | "herramientas"
  >("expediente");
  const [mobileTab, setMobileTab] = useState<
    "chat" | "sospechoso" | "panel"
  >("chat");

  /* Evidence review */
  const [evidenceReviewTime, setEvidenceReviewTime] = useState(EVIDENCE_REVIEW_SECONDS);

  /* Deliberation */
  const [delibTimeRemaining, setDelibTimeRemaining] = useState(DELIBERATION_SECONDS);

  /* Vote */
  const [votes, setVotes] = useState<DetectiveVote[]>([]);
  const [hasVoted, setHasVoted] = useState(false);
  const [voteChoice, setVoteChoice] = useState<"guilty" | "innocent" | "">("");
  const [voteReason, setVoteReason] = useState("");
  const [allVotesIn, setAllVotesIn] = useState(false);

  /* Verdict & results */
  const [verdict, setVerdict] = useState<{
    decision: "freed" | "imprisoned";
    judgeReasoning: string;
    judgesComment: string;
    suspectIsGuilty: boolean;
    majorityCorrect: boolean;
    guiltyVotes: number;
    innocentVotes: number;
  } | null>(null);
  const [ending, setEnding] = useState<EndingResult | null>(null);
  const [shakeKey, setShakeKey] = useState(0);

  /* Revelation — structured truth object rendered as separate cards. */
  const [revelation, setRevelation] = useState<{
    suspectName: string;
    culpability: "guilty" | "innocent" | "accomplice" | "witness";
    truth: string;
    alibiClaimed?: string;
    alibiActual?: string;
    alibiWitnesses?: string[];
    evidence: Array<{ label: string; description: string; isRedHerring: boolean }>;
    timeline: Array<{ time: string; event: string }>;
  } | null>(null);
  const [revelationLoading, setRevelationLoading] = useState(false);

  /* Achievements */
  const [unlockedAchievements, setUnlockedAchievements] = useState<Achievement[]>([]);
  const [achievementPopup, setAchievementPopup] = useState<Achievement | null>(null);

  /* Refs */
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const aiTickRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delibTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const evidenceReviewTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nervousnessRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseRef = useRef<GamePhase>(phase);
  const seenMsgIds = useRef<Set<string>>(new Set());
  const interrogatingRef = useRef(false);

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const channels = session ? channelIdsFor(session.roomCode) : null;

  /* ═══ CHANNEL SUBSCRIPTIONS ═══ */

  const { send: sendGame, presence } = useChannel({
    channelId: channels?.game ?? "__empty__",
    history: (phase === "playing" || phase === "evidence_review") ? 30 : "none",
    enabled:
      (phase === "playing" || phase === "deliberation" || phase === "vote" || phase === "evidence_review") &&
      !!channels,
    onMessage: (msg: any) => {
      try {
        const type = msg?.type ?? msg?.content?.type;
        const payload = msg?.content ?? msg;

        if (type === "game.chat" || type === "detective.question" || type === "suspect.answer" || type === "suspect.autonomous" || type === "system.event") {
          const gameMsg = payload as GameMessage;
          const msgId = `${gameMsg.senderId}-${gameMsg.timestamp}`;
          if (seenMsgIds.current.has(msgId)) return;
          // Skip echo: if this is a suspect.answer that we already added locally,
          // don't add it again. The local handleInterrogate already adds it.
          if (type === "suspect.answer" && currentCase && gameMsg.senderId === currentCase.suspect.id) {
            // Check if we already have this exact answer text recently
            seenMsgIds.current.add(msgId);
            return;
          }
          seenMsgIds.current.add(msgId);
          setChatMessages((prev) => [...prev.slice(-80), gameMsg]);
        }

        if (type === "stress.update") {
          const su = payload as StressUpdate;
          setStress({ stress: su.stress, confidence: su.confidence, hostility: su.hostility, trigger: su.trigger });
        }

        if (type === "ai.event") {
          const evt = payload as AIEventPayload;
          const aiMsg: GameMessage = {
            type: "suspect.autonomous",
            senderType: "suspect",
            senderId: evt.suspectId,
            senderName: evt.suspectName,
            text: evt.text,
            timestamp: evt.timestamp,
          };
          const msgId = `ai-${evt.timestamp}-${evt.suspectId}`;
          if (!seenMsgIds.current.has(msgId)) {
            seenMsgIds.current.add(msgId);
            setChatMessages((prev) => [...prev.slice(-80), aiMsg]);
          }
        }

        if (type === "game.start") {
          // Host sends only the seed — non-host must fetch the case from API.
          // This avoids sending RegExp objects through the Portal SDK which
          // caused React #310 (InterpretGeneratorResume crash).
          const seed = payload.seed as string | undefined;
          if (seed && !currentCase) {
            // Non-host: fetch the generated case using the seed
            const loadCase = async () => {
              try {
                const res = await fetch("/api/generate-case", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ seed }),
                });
                if (!res.ok) { console.error("[game.start] Failed to fetch case for seed:", seed); return; }
                const generated = await res.json() as GeneratedCase;
                rememberGender(generated.seed, generated.suspect?.gender ?? "man");
                setGeneratedCaseRaw(generated);
                const caseInfo = adaptGeneratedCase(generated);
                setCurrentCase(caseInfo);
                if (caseInfo.evidence && caseInfo.evidence.length > 0) {
                  setEvidenceItems(caseInfo.evidence.map(e => ({ ...e, isLocked: !!e.unlockTopic })));
                }
                setPhase("case_intro");
                setCaseIntroStep(0);
                SFX.soundCaseReady();
              } catch (err) {
                console.error("[game.start] Failed to load case:", err);
              }
            };
            loadCase();
          }
        }

        if (type === "game.phase") {
          const newPhase = payload.phase as GamePhase;
          if ("evidence_review,deliberation,vote,verdict,revelation,results".split(",").includes(newPhase)) {
            setPhase(newPhase);
          }
        }

        if (type === "vote.cast") {
          const vp = payload as VotePayload;
          setVotes((prev) => {
            if (prev.some((v) => v.playerId === vp.playerId)) return prev;
            return [...prev, { playerId: vp.playerId, playerName: vp.playerName, vote: vp.vote, reason: vp.reason, votedAt: vp.votedAt }];
          });
        }
      } catch { /* ignore */ }
    },
  });

  const { send: sendDetective } = useChannel({
    channelId: channels?.detectives ?? "__empty__",
    history: (phase === "playing" || phase === "deliberation" || phase === "evidence_review") ? 30 : "none",
    enabled: (phase === "playing" || phase === "deliberation" || phase === "evidence_review") && !!channels,
    onMessage: (msg: any) => {
      try {
        const payload = msg?.content ?? msg;
        if (payload?.type === "detective.note" || payload?.detectiveId) {
          const dm: DetectiveMessage = {
            type: "detective.note",
            detectiveId: payload.detectiveId,
            detectiveName: payload.detectiveName,
            text: payload.text,
            timestamp: payload.timestamp ?? Date.now(),
          };
          setDetectiveMessages((prev) => [...prev.slice(-50), dm]);
        }
      } catch { /* ignore */ }
    },
  });

  /* ═══ CALLBACKS ═══ */

  const enterDeliberation = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (nervousnessRef.current) clearInterval(nervousnessRef.current);
    setDelibTimeRemaining(DELIBERATION_SECONDS);
    setPhase("deliberation");
  }, []);

  const unlockAchievement = useCallback(
    (id: string) => {
      if (unlockedAchievements.some((a) => a.id === id)) return;
      const ach = ACHIEVEMENTS.find((a) => a.id === id);
      if (!ach) return;
      setUnlockedAchievements((prev) => [...prev, { ...ach, unlocked: true, unlockedAt: Date.now() }]);
      setAchievementPopup({ ...ach, unlocked: true, unlockedAt: Date.now() });
      setTimeout(() => setAchievementPopup(null), 4000);
      SFX.soundAchievement();
    },
    [unlockedAchievements]
  );

  const callJudge = useCallback(async () => {
    if (!currentCase || votes.length === 0) return;
    setPhase("verdict");
    setLoading(true);
    try {
      const suspect = currentCase.suspect;
      const convSummary = conversationHistory
        .slice(-30)
        .map((t) => `[${t.role === "detective" ? t.detectiveName || "Detective" : suspect.name}]: ${t.text}`)
        .join("\n");
      const stressSummary = `Estrés: ${stress.stress}% | Confianza: ${stress.confidence}% | Hostilidad: ${stress.hostility}% | Máximo estrés: ${maxStress}%`;

      const res = await fetch("/api/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suspectId: suspect.id, suspectName: suspect.name, suspectIsGuilty: suspect.isGuilty, votes: votes.map((v) => ({ playerName: v.playerName, vote: v.vote, reason: v.reason })), conversationSummary: convSummary, stressHistory: stressSummary }),
      });
      const data = await res.json();
      setVerdict(data);
      setShakeKey((prev) => prev + 1);

      const isUnanimous = votes.every((v) => v.vote === "guilty") || votes.every((v) => v.vote === "innocent");
      const end = determineEnding(data.majorityCorrect, data.suspectIsGuilty, lobbyPlayers.length || 1, questionsAsked, isUnanimous, 1 - timeRemaining / totalTime);
      setEnding(end);

      if (data.majorityCorrect && data.suspectIsGuilty) unlockAchievement("criminal_caught");
      if (data.majorityCorrect && !data.suspectIsGuilty) unlockAchievement("correct_acquittal");
      if (!data.majorityCorrect) unlockAchievement("wrong_verdict");
      if (isUnanimous && data.majorityCorrect) unlockAchievement("unanimous");
      if (lobbyPlayers.length === 1 && data.majorityCorrect) unlockAchievement("lobo_solitario");
    } catch (err) {
      console.error("[judge] failed:", err);
      setError("Error del juez. Veredicto pendiente.");
    } finally {
      setLoading(false);
    }
  }, [currentCase, votes, conversationHistory, stress, maxStress, lobbyPlayers.length, questionsAsked, timeRemaining, totalTime, unlockAchievement]);

  /* ═══ EFFECTS ═══ */

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages.length, detectiveMessages.length]);

  useEffect(() => {
    if (typeof window === "undefined" || tutorialChecked) return;
    setTutorialChecked(true);
    const urlCode = getRoomCodeFromURL();
    if (urlCode) { setRoomCode(urlCode); setPhase("join_by_link"); return; }
    const saved = loadSession();
    if (saved) { setSession(saved); setRoomCode(saved.roomCode); setUsername(saved.username); setPhase("lobby"); return; }
    const seen = localStorage.getItem(TUTORIAL_KEY);
    if (!seen) setShowTutorial(true);
  }, [tutorialChecked]);

  /* Playing timer */
  useEffect(() => {
    if (phase !== "playing" || timeRemaining <= 0) return;
    timerRef.current = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) { if (timerRef.current) clearInterval(timerRef.current); enterDeliberation(); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase, enterDeliberation]);

  /* Nervousness fluctuation during playing */
  useEffect(() => {
    if (phase !== "playing") {
      if (nervousnessRef.current) clearInterval(nervousnessRef.current);
      return;
    }
    nervousnessRef.current = setInterval(() => {
      setNervousness((prev) => {
        const delta = (Math.random() - 0.5) * 20;
        return Math.max(5, Math.min(95, Math.round(prev + delta)));
      });
    }, 12_000);
    return () => { if (nervousnessRef.current) clearInterval(nervousnessRef.current); };
  }, [phase]);

  /* Stress / confidence / hostility micro-fluctuation during playing.
   * Between questions, the suspect's vitals "breathe" — small ±3 wobbles
   * every 8s, with a slow drift back toward baseline. This makes the bars
   * feel alive instead of frozen between questions. */
  const vitalsRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const baselineRef = useRef<StressState>({ stress: 30, confidence: 70, hostility: 20 });
  useEffect(() => {
    if (phase !== "playing") {
      if (vitalsRef.current) clearInterval(vitalsRef.current);
      return;
    }
    // Remember the baseline so we know what to drift toward.
    if (currentCase) {
      baselineRef.current = {
        stress: currentCase.suspect.baseline.stress,
        confidence: currentCase.suspect.baseline.confidence,
        hostility: currentCase.suspect.baseline.hostility,
      };
    }
    vitalsRef.current = setInterval(() => {
      setStress((prev) => {
        const b = baselineRef.current;
        // Each value drifts 10% toward baseline + a small random wobble.
        const wobble = () => Math.round((Math.random() - 0.5) * 6); // ±3
        const drift = (cur: number, base: number) => Math.round(cur + (base - cur) * 0.1);
        return {
          stress: Math.max(0, Math.min(100, drift(prev.stress, b.stress) + wobble())),
          confidence: Math.max(0, Math.min(100, drift(prev.confidence, b.confidence) + wobble())),
          hostility: Math.max(0, Math.min(100, drift(prev.hostility, b.hostility) + wobble())),
          trigger: prev.trigger,
        };
      });
    }, 8_000);
    return () => { if (vitalsRef.current) clearInterval(vitalsRef.current); };
  }, [phase, currentCase]);

  /* BPM — derives from stress and fluctuates every 2s like a real heartbeat.
   * Higher stress = higher BPM. Range: 60 (calm) to 160 (panicking).
   * The ±4 wobble makes it feel like a live pulse, not a static number. */
  const [bpm, setBpm] = useState(72);
  const bpmRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (phase !== "playing") {
      if (bpmRef.current) clearInterval(bpmRef.current);
      return;
    }
    bpmRef.current = setInterval(() => {
      setStress((curr) => {
        // Base BPM from stress: 60 + stress * 1.0 (60..160)
        const base = 60 + curr.stress;
        const wobble = Math.round((Math.random() - 0.5) * 8); // ±4
        setBpm(Math.max(50, Math.min(180, base + wobble)));
        return curr; // don't change stress, just read it
      });
    }, 2_000);
    return () => { if (bpmRef.current) clearInterval(bpmRef.current); };
  }, [phase]);

  /* Deliberation timer */
  useEffect(() => {
    if (phase !== "deliberation" || delibTimeRemaining <= 0) return;
    delibTimerRef.current = setInterval(() => {
      setDelibTimeRemaining((prev) => {
        if (prev <= 1) { if (delibTimerRef.current) clearInterval(delibTimerRef.current); setPhase("vote"); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => { if (delibTimerRef.current) clearInterval(delibTimerRef.current); };
  }, [phase]);

  /* Evidence review timer */
  useEffect(() => {
    if (phase !== "evidence_review" || evidenceReviewTime <= 0) return;
    evidenceReviewTimerRef.current = setInterval(() => {
      setEvidenceReviewTime((prev) => {
        if (prev <= 1) { if (evidenceReviewTimerRef.current) clearInterval(evidenceReviewTimerRef.current); setPhase("playing"); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => { if (evidenceReviewTimerRef.current) clearInterval(evidenceReviewTimerRef.current); };
  }, [phase, evidenceReviewTime]);

  /* AI tick — LOCAL ONLY, no API calls to save rate limit quota.
   * Generates autonomous suspect events (thoughts, nervous tics) based
   * on stress level. These are pre-written, not LLM-generated. */
  const LOCAL_THOUGHTS = [
    "¿Por qué siguen preguntando lo mismo?",
    "Necesito calmarme... no puedo demostrar nerviosismo.",
    "Si me preguntan sobre esa noche, debo mantener mi historia.",
    "Esto está tardando demasiado...",
    "¿Estarán creyéndome?",
    "No debería haber dicho eso antes.",
    "Una pregunta más y podré salir de aquí.",
    "Estoy sudando demasiado, seguro se nota.",
    "¿Saben algo que yo no?",
    "Debo mantener la calma.",
    "Mi historia es sólida, no tienen nada contra mí.",
    "¿Esa pregunta fue una trampa?",
  ];
  const LOCAL_NERVOUS = [
    "Se le ve un temblor en las manos.",
    "Evita el contacto visual por unos segundos.",
    "Se seca la boca nerviosamente.",
    "Tapa brevemente su boca con la mano.",
    "Ajusta su posición incómodamente en la silla.",
    "Se le tensa la mandíbula visiblemente.",
    "Mira hacia la puerta como buscando una salida.",
    "Se cruza y descruza los brazos repetidamente.",
  ];
  const LOCAL_COMMENTS = [
    "¿Ya vamos a terminar con esto?",
    "¿Puedo tomar agua?",
    "No tengo nada más que agregar sobre eso.",
    "Estoy cansado de repetir lo mismo.",
    "¿Podemos hacer una pausa?",
    "No sé qué más quieren que diga.",
  ];

  useEffect(() => {
    if (phase !== "playing" || !currentCase) return;
    const runTick = () => {
      if (phaseRef.current !== "playing") return;
      // Only fire ~30% of the time to keep it sparse
      if (Math.random() > 0.35) return;
      const s = stress.stress;
      const kind = s > 70 ? (Math.random() > 0.5 ? "nervous" : "comment") : "thought";
      let text: string;
      if (kind === "nervous") {
        text = LOCAL_NERVOUS[Math.floor(Math.random() * LOCAL_NERVOUS.length)];
      } else if (kind === "comment") {
        text = LOCAL_COMMENTS[Math.floor(Math.random() * LOCAL_COMMENTS.length)];
      } else {
        text = LOCAL_THOUGHTS[Math.floor(Math.random() * LOCAL_THOUGHTS.length)];
      }
      const evt = { kind, text };
      if (channels && sendGame) {
        try {
          sendGame({ type: "ai.event", content: { type: "ai.event", suspectId: currentCase.suspect.id, suspectName: currentCase.suspect.name, kind: evt.kind, text: evt.text, timestamp: Date.now() } });
        } catch { /* ok */ }
      }
    };
    const firstTimeout = setTimeout(runTick, 8000);
    const tickInterval = setInterval(() => { if (phaseRef.current === "playing") runTick(); }, AI_TICK_MS);
    return () => { clearTimeout(firstTimeout); clearInterval(tickInterval); };
  }, [phase, currentCase, channels, sendGame, stress.stress]);

  /* Check all votes in — solo player proceeds immediately */
  const requiredVotes = Math.max(1, lobbyPlayers.length);
  useEffect(() => {
    if (votes.length >= requiredVotes && !allVotesIn) { setAllVotesIn(true); setTimeout(() => callJudge(), 1500); }
  }, [votes.length, allVotesIn, callJudge, requiredVotes]);

  /* Case intro auto-advance timer.
   * MUST live at the top level of the component — placing it inside the
   * `if (phase === "case_intro")` block violates the Rules of Hooks and
   * triggers React error #310 ("Rendered more hooks than during the
   * previous render") when navigating into / out of the case_intro phase. */
  const CASE_INTRO_TOTAL_STEPS = 7;
  useEffect(() => {
    if (phase !== "case_intro") return;
    if (caseIntroStep >= CASE_INTRO_TOTAL_STEPS - 1) return;
    const timer = setTimeout(() => setCaseIntroStep((p) => p + 1), 2200);
    return () => clearTimeout(timer);
  }, [phase, caseIntroStep]);

  /* ═══ HANDLERS ═══ */

  const closeTutorial = () => { localStorage.setItem(TUTORIAL_KEY, "1"); setShowTutorial(false); SFX.soundClick(); };

  const handleCreateRoom = useCallback(async () => {
    if (!username.trim()) { setError("Ingresa un nombre de detective"); return; }
    setError(""); setLoading(true);
    try {
      const res = await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hostId: playerId, hostUsername: username.trim(), settings: { roundTimeMinutes: roundTime, maxDetectives: 2 } }) });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      const newSession: Session = { username: username.trim(), roomCode: data.code, isHost: true };
      saveSession(newSession); setSession(newSession); setRoomCode(data.code);
      setLobbyPlayers([{ id: playerId, username: username.trim(), isHost: true }]);
      setPhase("lobby");
      SFX.soundConnect();
    } catch { setError("Error al crear la sala"); SFX.soundError(); } finally { setLoading(false); }
  }, [username, roundTime, playerId]);

  const handleJoinRoom = useCallback(async () => {
    if (!username.trim()) { setError("Ingresa un nombre de detective"); return; }
    if (!roomCode.trim()) { setError("Ingresa el código de la sala"); return; }
    setError(""); setLoading(true);
    try {
      const res = await fetch(`/api/rooms/${roomCode.trim().toLowerCase()}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "join", playerId: playerId, username: username.trim() }) });
      const data = await res.json();
      if (data.error) { setError(data.error); SFX.soundError(); return; }
      const newSession: Session = { username: username.trim(), roomCode: data.code, isHost: false };
      saveSession(newSession); setSession(newSession); setRoomCode(data.code);
      setLobbyPlayers((prev) => [...prev, { id: playerId, username: username.trim(), isHost: false }]);
      setPhase("lobby");
      SFX.soundConnect();
    } catch { setError("Error al unirse a la sala"); } finally { setLoading(false); }
  }, [username, roomCode, playerId]);

  const handleJoinByLink = useCallback(async () => { await handleJoinRoom(); }, [handleJoinRoom]);

  const handleStartGame = useCallback(async () => {
    if (!session?.isHost || !channels) return;
    try { await fetch(`/api/rooms/${session.roomCode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start" }) }); } catch { /* ok */ }
    setPhase("generating_case");
    SFX.soundWhoosh();
  }, [session, channels]);

  const handleCaseReady = useCallback(async (generated: GeneratedCase) => {
    rememberGender(generated.seed, generated.suspect.gender);
    setGeneratedCaseRaw(generated);
    const caseInfo = adaptGeneratedCase(generated);
    setCurrentCase(caseInfo);
    // Initialize evidence items
    if (caseInfo.evidence && caseInfo.evidence.length > 0) {
      setEvidenceItems(caseInfo.evidence.map(e => ({ ...e, isLocked: !!e.unlockTopic })));
    }
    // Only send the seed via Portal SDK — NOT the full CaseInfo.
    // CaseInfo contains RegExp objects in stressRules[].match which are
    // non-serializable and cause React #310 inside the Portal SDK's
    // async generator internals (InterpretGeneratorResume).
    // The non-host will fetch the case from /api/generate-case using the seed.
    try { await sendGame({ type: "game.start", content: { type: "game.start", seed: generated.seed } }); } catch { /* ok */ }
    setPhase("case_intro"); setCaseIntroStep(0);
    SFX.soundCaseReady();
  }, [sendGame]);

  const handleStartInterrogation = useCallback(() => {
    if (!currentCase) return;
    setStress({ stress: currentCase.suspect.baseline.stress, confidence: currentCase.suspect.baseline.confidence, hostility: currentCase.suspect.baseline.hostility });
    setNervousness(currentCase.suspect.baseline.stress + (Math.random() - 0.5) * 20);
    // Initialize BPM from the baseline stress so it starts realistic.
    setBpm(60 + currentCase.suspect.baseline.stress + Math.round((Math.random() - 0.5) * 8));
    setTimeRemaining(roundTime * 60);
    setTotalTime(roundTime * 60);
    setChatMessages([]); setDetectiveMessages([]); setConversationHistory([]);
    setQuestionsAsked(0); setFlaggedCount(0); setMaxStress(currentCase.suspect.baseline.stress);
    setSelectedEvidence(null); setTechnique("neutral");
    setPhase("playing");
    SFX.soundWhoosh();
  }, [currentCase, roundTime]);

  const handleInterrogate = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatDraft.trim();
    if (!text || pending || !currentCase || !session) return;
    if (interrogatingRef.current) return; // Prevent double-fire from React re-renders
    interrogatingRef.current = true;
    setChatDraft(""); setPending(true); setQuestionsAsked((prev) => prev + 1);
    // SFX: send question blip (ascending square wave)
    SFX.soundSendQuestion();
    // Stop any in-progress TTS from a previous answer.
    stopSpeaking();

    const qMsg: GameMessage = { type: "detective.question", senderType: "detective", senderId: playerId, senderName: session.username, text, timestamp: Date.now() };
    setChatMessages((prev) => [...prev.slice(-80), qMsg]);

    const newTurn: ConversationTurn = { role: "detective", text, detectiveName: session.username, timestamp: Date.now() };
    try { await sendGame({ type: "detective.question", content: qMsg }); } catch { /* ok */ }

    // Check for evidence unlocks — two strategies:
    // 1. unlockTopic regex (if the case generator provided one)
    // 2. FALLBACK: keyword match on the evidence label + description.
    //    This guarantees evidence is always unlockable even if the LLM
    //    generated a bad unlockTopic regex that never matches.
    const qLower = text.toLowerCase();
    let unlockedSomething = false;
    setEvidenceItems((prev) => prev.map(ev => {
      if (!ev.isLocked) return ev;
      // Strategy 1: explicit unlockTopic regex.
      if (ev.unlockTopic) {
        try { if (new RegExp(ev.unlockTopic, "i").test(qLower)) { unlockedSomething = true; return { ...ev, isLocked: false }; } } catch { /* invalid regex */ }
      }
      // Strategy 2: fallback — extract keywords from label + description
      // and check if the question contains any of them.
      const keywordSource = `${ev.label} ${ev.description}`.toLowerCase();
      const keywords = keywordSource
        .split(/[^a-záéíóúñ]+/)
        .filter(w => w.length >= 4 && !["para","como","cuando","donde","porque","tiene","tiene","esto","esos","este","essa","essa","con","sin","sobre","tras","desde","hasta","entre","para"].includes(w));
      const uniqueKeywords = [...new Set(keywords)].slice(0, 8); // max 8 keywords
      for (const kw of uniqueKeywords) {
        if (qLower.includes(kw)) {
          unlockedSomething = true;
          return { ...ev, isLocked: false };
        }
      }
      return ev;
    }));
    if (unlockedSomething) SFX.soundEvidenceUnlock();

    try {
      const stressRulesRaw = currentCase.suspect.stressRules.map(r => ({
        match: r.match.source,
        stressDelta: r.stressDelta,
        coherenceDelta: r.confidenceDelta,
        bpmDelta: r.hostilityDelta * 2,
        label: r.label,
      }));
      const body: any = {
        suspectId: currentCase.suspect.id,
        suspectName: currentCase.suspect.name,
        suspectAvatar: currentCase.suspect.avatar,
        systemPrompt: currentCase.suspect.systemPrompt,
        stressRules: stressRulesRaw,
        question: text,
        history: conversationHistory.slice(-20).map(t => ({
            role: t.role === "detective" ? "user" as const : "assistant" as const,
            content: t.text,
          })),
        previousStress: stress,
      };
      if (selectedEvidence) { body.presentedEvidence = { label: selectedEvidence.label, description: selectedEvidence.description }; }
      if (technique !== "neutral") { body.technique = technique; }

      const res = await fetch("/api/interrogate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        if (res.status === 429 || errBody.error === "rate_limited") {
          // Rate limited — show a clear message in the chat so the user
          // knows it's a quota issue, not a game bug. Still update stress
          // (the question was asked, even if the suspect won't answer).
          const rateLimitMsg: GameMessage = {
            type: "suspect.answer",
            senderType: "suspect",
            senderId: "system",
            senderName: "SISTEMA",
            text: "[Límite de la API alcanzado. El sospechoso guarda silencio. Espera unos minutos.]",
            timestamp: Date.now(),
          };
          setChatMessages((prev) => [...prev.slice(-80), rateLimitMsg]);
          setError("Límite de API alcanzado — espera unos minutos.");
          SFX.soundError();
          return;
        }
        throw new Error(errBody.error || errBody.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();

      const answerText = data.answer?.text || "No tengo nada que decir.";
      const aMsg: GameMessage = { type: "suspect.answer", senderType: "suspect", senderId: currentCase.suspect.id, senderName: currentCase.suspect.name, text: answerText, timestamp: Date.now(), flagged: data.answer?.flagged };
      setChatMessages((prev) => [...prev.slice(-80), aMsg]);
      try { await sendGame({ type: "suspect.answer", content: aMsg }); } catch { /* ok */ }

      setConversationHistory((prev) => [...prev.slice(-40), newTurn, { role: "suspect", text: answerText, timestamp: Date.now() }]);

      // SFX: stress rise — compare previous stress to new stress.
      const prevStressLevel = stress?.stress ?? 0;
      const newStressLevel = data.stress?.stress ?? prevStressLevel;
      if (newStressLevel > prevStressLevel + 5) {
        // Delay slightly so it lands as the answer appears.
        setTimeout(() => SFX.soundStressRise(newStressLevel), 200);
      }

      if (data.stress) {
        setStress(data.stress);
        if (data.stress.stress > maxStress) setMaxStress(data.stress.stress);
      }

      // SFX: lie detected (glitch) + TTS for the suspect's answer.
      if (data.answer?.flagged) {
        setFlaggedCount((prev) => prev + 1);
        unlockAchievement("gotcha");
        setTimeout(() => SFX.soundLieDetected(), 150);
      }
      // TTS: speak the suspect's answer aloud IN SYNC with the typewriter.
      // No delay — the voice starts the moment the message renders and the
      // typewriter begins revealing characters. Voice gender matches the
      // suspect's gender so men sound male and women sound female.
      const suspectGender = recallGender(currentCase?.id?.replace("gen_", "") ?? "default");
      speak(answerText, suspectGender);

      if (questionsAsked === 0) unlockAchievement("first_blood");
      if (data.stress?.stress >= 90) unlockAchievement("pressure_cooker");
      if (questionsAsked + 1 >= 20) unlockAchievement("cross_examine");

      setSelectedEvidence(null);
      setTechnique("neutral");
    } catch (err) {
      console.error("[interrogate] failed:", err);
      setError("Error en la interrogación");
      SFX.soundError();
    } finally { setPending(false); interrogatingRef.current = false; }
  }, [chatDraft, pending, currentCase, session, playerId, conversationHistory, stress, sendGame, maxStress, questionsAsked, unlockAchievement, selectedEvidence, technique]);

  const handleSendDetective = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const text = detectiveDraft.trim();
    if (!text || !session) return;
    setDetectiveDraft("");
    const dm: DetectiveMessage = { type: "detective.note", detectiveId: playerId, detectiveName: session.username, text, timestamp: Date.now() };
    setDetectiveMessages((prev) => [...prev.slice(-50), dm]);
    try { await sendDetective({ type: "detective.note", content: dm }); } catch { /* ok */ }
  }, [detectiveDraft, session, playerId, sendDetective]);

  const insertQuickQuestion = (text: string) => { setChatDraft(text); chatInputRef.current?.focus(); };

  const addTimelineEntry = () => {
    const label = prompt("Etiqueta del evento:"); if (!label) return;
    const desc = prompt("Descripción:"); if (!desc) return;
    setTimelineEntries((prev) => [...prev, { id: `tl_${Date.now()}`, label, description: desc, addedBy: playerId, addedByName: username || "Detective", createdAt: Date.now() }]);
  };

  const skipToVote = useCallback(() => { if (delibTimerRef.current) clearInterval(delibTimerRef.current); setPhase("vote"); }, []);

  const handleSubmitVote = useCallback(async () => {
    if (!voteChoice || !session) return;
    const vote: DetectiveVote = { playerId, playerName: session.username, vote: voteChoice, reason: voteReason.trim(), votedAt: Date.now() };
    setVotes((prev) => [...prev, vote]); setHasVoted(true);
    try { await sendGame({ type: "vote.cast", content: { ...vote, type: "vote.cast" } }); } catch { /* ok */ }
    SFX.soundVerdict();
  }, [voteChoice, voteReason, session, playerId, sendGame]);

  const playAgain = useCallback(() => {
    clearSession(); setSession(null); setRoomCode(""); setUsername(""); setCurrentCase(null); setGeneratedCaseRaw(null);
    setChatMessages([]); setDetectiveMessages([]); setVotes([]); setHasVoted(false);
    setVerdict(null); setEnding(null); setUnlockedAchievements([]);
    setTimeRemaining(0); setTotalTime(0); setEvidenceItems([]);
    setRevelation(null);
    // Reset welcome screen state so the flash animation doesn't get stuck
    // and the mount animation replays cleanly.
    setWelcomeFlash(false);
    setWelcomeMounted(false);
    setPhase("welcome");
  }, []);

  const leaveRoom = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (delibTimerRef.current) clearInterval(delibTimerRef.current);
    clearSession(); setSession(null); setRoomCode(""); setUsername("");
    setWelcomeFlash(false); setWelcomeMounted(false);
    setPhase("welcome");
  }, []);

  const copyInviteLink = useCallback(() => { navigator.clipboard.writeText(`${window.location.origin}?room=${roomCode}`).catch(() => {}); }, [roomCode]);

  const generateRevelation = useCallback(async () => {
    if (!currentCase) return;
    setRevelationLoading(true);
    try {
      // Use the stored raw generated case to build the structured truth object.
      // Do NOT re-call /api/generate-case — the in-memory cache may be lost
      // on serverless cold starts, and temperature=0.9 means we'd get a
      // completely different case.
      if (generatedCaseRaw) {
        const s = generatedCaseRaw.suspect;
        setRevelation({
          suspectName: safeRender(s.name),
          culpability: s.culpability,
          truth: safeRender(s.truth),
          alibiClaimed: s.alibi ? safeRender(s.alibi.claimed) : undefined,
          alibiActual: s.alibi ? safeRender(s.alibi.actual) : undefined,
          alibiWitnesses: s.alibi?.witnesses?.map(w => safeRender(w)) ?? [],
          evidence: (generatedCaseRaw.evidence ?? []).map(ev => ({
            label: safeRender(ev.label),
            description: safeRender(ev.description),
            isRedHerring: !!ev.isRedHerring,
          })),
          timeline: (generatedCaseRaw.timeline ?? []).map(t => ({
            time: safeRender(t.time),
            event: safeRender(t.event),
          })),
        });
      } else {
        // Fallback for hardcoded cases that have no generatedCaseRaw.
        const s = currentCase.suspect;
        setRevelation({
          suspectName: safeRender(s.name),
          culpability: s.isGuilty ? "guilty" : "innocent",
          truth: currentCase.briefing ? safeRender(currentCase.briefing) : "La verdad no pudo ser recuperada.",
          evidence: [],
          timeline: [],
        });
      }
    } catch {
      setRevelation({
        suspectName: safeRender(currentCase.suspect.name),
        culpability: currentCase.suspect.isGuilty ? "guilty" : "innocent",
        truth: "No se pudo generar la revelación.",
        evidence: [],
        timeline: [],
      });
    } finally { setRevelationLoading(false); }
  }, [currentCase, generatedCaseRaw]);

  /* ═══ SHARED UI ═══ */

  const bodyFont = { fontFamily: "var(--font-pixel-body), monospace" as const };
  const headFont = { fontFamily: "var(--font-pixel), monospace" as const };

  const ErrorBanner = error ? (
    <div className="border-2 border-[var(--destructive)] bg-[var(--destructive)]/10 p-2 text-xs text-[var(--destructive)] mb-4" style={bodyFont}>{error}</div>
  ) : null;

  const BackBtn = ({ target, label = "◂ VOLVER" }: { target: GamePhase; label?: string }) => (
    <button onClick={() => { setPhase(target); setError(""); SFX.soundClick(); }} className="pixel-btn-secondary w-full py-2 text-xs" style={bodyFont}>{label}</button>
  );

  const PhaseIndicator = ({ current }: { current: GamePhase }) => {
    const steps = getPhaseSteps(current);
    const phaseOrder = ["evidence_review", "playing", "deliberation", "vote", "verdict"];
    const currentIdx = phaseOrder.indexOf(current);
    return (
      <div className="pixel-phase-bar">
        {steps.map((step, i) => (
          <span key={step.key}>
            <span className={cn("pixel-phase-item", i < currentIdx && "completed", i === currentIdx && "active")}>{step.label}</span>
            {i < steps.length - 1 && <span className="pixel-phase-arrow mx-1">▸</span>}
          </span>
        ))}
      </div>
    );
  };

  const DifficultyBadge = ({ difficulty }: { difficulty?: string }) => {
    const config: Record<string, { label: string; cls: string }> = {
      facil: { label: "FÁCIL", cls: "success" },
      medio: { label: "MEDIO", cls: "" },
      dificil: { label: "DIFÍCIL", cls: "danger" },
    };
    const c = config[difficulty?.toLowerCase() ?? ""] ?? config.medio;
    return <span className={cn("pixel-badge", c.cls && `pixel-badge.${c.cls}`)}>{c.label}</span>;
  };

  const AchievementOverlay = achievementPopup ? (
    <div className="fixed top-4 right-4 z-50 achievement-popup">
      <div className="pixel-frame p-4 max-w-xs" style={bodyFont}>
        <div className="flex items-center gap-3">
          <span className="text-2xl">{achievementPopup.icon}</span>
          <div>
            <div className="text-xs font-bold text-[var(--primary)] tracking-wider">LOGRO DESBLOQUEADO</div>
            <div className="text-sm text-[var(--foreground)] font-bold mt-1">{achievementPopup.name}</div>
            <div className="text-xs text-[var(--muted-foreground)] mt-0.5">{achievementPopup.description}</div>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  const TimeSlider = ({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) => {
    const fillPercent = ((value - 3) / (15 - 3)) * 100;
    const marks = [3, 5, 7, 10, 15];
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs text-[var(--foreground)] tracking-wider font-bold">TIEMPO DE RONDA</label>
          <div className="pixel-frame px-3 py-1">
            <span className="text-lg font-bold text-[var(--primary)] transition-all duration-150" style={headFont}>{value}</span>
            <span className="text-[13px] text-[var(--muted-foreground)] ml-1">MIN</span>
          </div>
        </div>
        <input
          type="range"
          min={3}
          max={15}
          step={1}
          value={value}
          onChange={(e) => { onChange(Number(e.target.value)); SFX.soundClick(); }}
          disabled={disabled}
          className="pixel-slider w-full"
          style={{ '--slider-fill': `${fillPercent}%`, touchAction: 'none' } as React.CSSProperties}
        />
        <div className="flex justify-between px-0.5">
          {marks.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { if (!disabled) { onChange(m); SFX.soundClick(); } }}
              disabled={disabled}
              className={cn(
                "text-[12px] transition-all duration-150 cursor-pointer px-1",
                value === m
                  ? "text-[var(--primary)] font-bold scale-110"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:scale-105",
                disabled && "cursor-not-allowed opacity-30"
              )}
            >{m}</button>
          ))}
        </div>
      </div>
    );
  };

  /* ─── Collapsible option selector — accordion style ─── */
  const OptionSelector = <T extends string | number>({
    label,
    value,
    options,
    onChange,
    disabled,
    sectionKey,
  }: {
    label: string;
    value: T;
    options: Array<{ value: T; label: string; emoji?: string }>;
    onChange: (v: T) => void;
    disabled?: boolean;
    sectionKey: string;
  }) => {
    const isOpen = openSection === sectionKey;
    const selectedOpt = options.find((o) => o.value === value);
    const emojiColorMap: Record<string, string> = { "[GREEN]": "text-green-400", "[YELLOW]": "text-yellow-400", "[RED]": "text-red-400", "[BLUE]": "text-blue-400", "[GRAY]": "text-gray-400" };
    const summary = selectedOpt
      ? `${selectedOpt.emoji ? "●" : ""} ${selectedOpt.label}`.trim()
      : "—";
    const summaryColor = selectedOpt?.emoji ? (emojiColorMap[selectedOpt.emoji] ?? "text-[var(--muted-foreground)]") : "text-[var(--muted-foreground)]";
    return (
      <div className={cn("pixel-frame overflow-hidden", isOpen && "pixel-frame-active")}>
        {/* Header — click to toggle */}
        <button
          type="button"
          onClick={() => {
            if (disabled) return;
            setOpenSection(isOpen ? null : sectionKey);
            SFX.soundTab();
          }}
          disabled={disabled}
          className={cn(
            "w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors cursor-pointer",
            !isOpen && "hover:bg-[var(--primary)]/5",
            disabled && "cursor-not-allowed opacity-40"
          )}
        >
          <span className="text-xs text-[var(--foreground)] tracking-wider font-bold">
            {label}
          </span>
          <span className="flex items-center gap-2">
            <span className={cn("text-[13px] tracking-wider font-bold", summaryColor)}>
              {summary}
            </span>
            <span className={cn("text-[var(--primary)] transition-transform", isOpen && "rotate-90")}>
              ▸
            </span>
          </span>
        </button>
        {/* Body — collapsible */}
        {isOpen && (
          <div className="px-3 pb-3 pt-1 grid grid-cols-2 gap-2 pixel-scale-in">
            {options.map((opt) => (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() => {
                  if (disabled) return;
                  onChange(opt.value);
                  SFX.soundClick();
                }}
                disabled={disabled}
                className={cn(
                  "pixel-frame p-2 text-center transition-all cursor-pointer",
                  value === opt.value && "pixel-frame-active",
                  disabled && "cursor-not-allowed opacity-40"
                )}
              >
                {opt.emoji && <div className={cn("text-sm mb-0.5", emojiColorMap[opt.emoji] ?? "text-[var(--muted-foreground)]")}>●</div>}
                <div className="text-[13px] tracking-wider text-[var(--foreground)]">{opt.label}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  /* ═══ RENDER: TUTORIAL ═══ */
  if (showTutorial) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        {AchievementOverlay}
        <div className="pixel-frame max-w-md w-full p-6 space-y-5">
          <div className="pixel-header"><span>COMO JUGAR</span></div>
          <img src="/sospechosos-logo.png" alt="LOS SOSPECHOSOS" className="mx-auto w-full max-w-[280px] pixel-logo" draggable={false} />
          <div className="space-y-3" style={bodyFont}>
            {["Como Detective, tu misión es interrogar al sospechoso y descubrir si es CULPABLE o INOCENTE.", "Haz preguntas inteligentes. Observa sus indicadores de estrés. Busca contradicciones.", "Al final, vota con tu compañero: CULPABLE (va preso) o INOCENTE (queda libre).", "El juez decidirá el destino final."]
              .map((step, i) => (
                <div key={i} className="flex gap-3 text-xs text-[var(--foreground)]"><span className="text-[var(--primary)] font-bold shrink-0">{i + 1}.</span><span>{step}</span></div>
              ))}
          </div>
          <button onClick={closeTutorial} className="pixel-btn w-full py-3 text-xs tracking-widest font-bold" style={headFont}>EMPEZAR</button>
        </div>
      </div>
    );
  }

  /* ═══ RENDER: WELCOME ═══ */
  if (phase === "welcome") {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center cursor-pointer select-none relative"
        onClick={() => { setWelcomeFlash(true); SFX.soundWhoosh(); setTimeout(() => setPhase("create_or_join"), 600); }}>
        {welcomeFlash && <div className="fixed inset-0 bg-white z-50 pointer-events-none pixel-screen-flash" />}
        <div className={cn("text-center space-y-8 relative z-10 transition-all duration-700", welcomeMounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6")}>
          <img src="/sospechosos-logo.png" alt="LOS SOSPECHOSOS" className="mx-auto w-full max-w-xl pixel-logo pixel-float" draggable={false} />
          <div className="text-xl text-white pixel-text-glow-white mt-12 pixel-breathe tracking-widest" style={{ ...bodyFont, animationDelay: '1.2s' }}>PRESIONA PARA EMPEZAR</div>
        </div>
      </main>
    );
  }

  /* ═══ RENDER: CREATE_OR_JOIN ═══ */
  if (phase === "create_or_join") {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-4">
        {AchievementOverlay}
        <div className="pixel-frame max-w-lg w-full p-6 space-y-6 pixel-scale-in">
          <div className="pixel-header"><span>SALA DE INTERROGACIÓN</span></div>
          <div className="grid gap-4 pixel-stagger">
            <button onClick={() => { setPhase("create"); setUsername(""); setError(""); SFX.soundClick(); }} className="pixel-frame pixel-frame-interactive p-4 text-left">
              <div className="text-[var(--primary)] font-bold tracking-widest text-sm" style={headFont}>CREAR SALA</div>
              <div className="text-[var(--muted-foreground)] text-xs mt-1" style={bodyFont}>Genera un código para que otro detective se una</div>
            </button>
            <button onClick={() => { setPhase("join"); setUsername(""); setRoomCode(""); setError(""); SFX.soundClick(); }} className="pixel-frame pixel-frame-interactive p-4 text-left">
              <div className="text-[var(--primary)] font-bold tracking-widest text-sm" style={headFont}>UNIRSE A SALA</div>
              <div className="text-[var(--muted-foreground)] text-xs mt-1" style={bodyFont}>Ingresa un código de sala existente</div>
            </button>
          </div>
        </div>
      </main>
    );
  }

  /* ═══ RENDER: CREATE ═══ */
  if (phase === "create") {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-4">
        {AchievementOverlay}
        <div className="pixel-frame max-w-lg w-full p-6 space-y-5 pixel-scale-in" style={bodyFont}>
          <div className="pixel-header"><span>CREAR SALA</span></div>
          {ErrorBanner}

          <div>
            <label className="text-xs text-[var(--foreground)] tracking-wider block mb-1">TU NOMBRE DE DETECTIVE</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} maxLength={20} className="pixel-input w-full" placeholder="ej: Holmes" autoFocus />
          </div>

          <TimeSlider value={roundTime} onChange={setRoundTime} />

          <OptionSelector
            label="DETECTIVES MÁXIMOS"
            value={maxDetectives}
            onChange={setMaxDetectives}
            sectionKey="maxDetectives"
            options={[
              { value: 2, label: "2 DETECTIVES", emoji: "[BLUE]" },
              { value: 3, label: "3 DETECTIVES", emoji: "[BLUE]" },
              { value: 4, label: "4 DETECTIVES", emoji: "[BLUE]" },
            ]}
          />

          <OptionSelector
            label="DIFICULTAD DEL CASO"
            value={difficulty}
            onChange={setDifficulty}
            sectionKey="difficulty"
            options={[
              { value: "facil", label: "FÁCIL", emoji: "[GREEN]" },
              { value: "normal", label: "NORMAL", emoji: "[YELLOW]" },
              { value: "dificil", label: "DIFÍCIL", emoji: "[RED]" },
            ]}
          />

          <OptionSelector
            label="TEMA DEL CRIMEN"
            value={crimeTheme}
            onChange={setCrimeTheme}
            sectionKey="crimeTheme"
            options={[
              { value: "random", label: "ALEATORIO", emoji: "[GRAY]" },
              { value: "fraude", label: "FRAUDE", emoji: "[YELLOW]" },
              { value: "robo", label: "ROBO", emoji: "[RED]" },
              { value: "asesinato", label: "ASESINATO", emoji: "[RED]" },
              { value: "sabotaje", label: "SABOTAJE", emoji: "[YELLOW]" },
            ]}
          />

          <OptionSelector
            label="VOZ DEL SOSPECHOSO (BETA)"
            value={aiVoice}
            onChange={setAiVoice}
            sectionKey="aiVoice"
            options={[
              { value: "on", label: "ACTIVADA", emoji: "[GREEN]" },
              { value: "off", label: "SILENCIADA", emoji: "[GRAY]" },
            ]}
          />

          <button onClick={() => { SFX.soundClick(); handleCreateRoom(); }} disabled={loading || !username.trim()} className="pixel-btn w-full py-3" style={headFont}>{loading ? "CREANDO SALA..." : "CREAR SALA"}</button>
          <BackBtn target="create_or_join" />
        </div>
      </main>
    );
  }

  /* ═══ RENDER: JOIN ═══ */
  if (phase === "join") {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-4">
        {AchievementOverlay}
        <div className="pixel-frame max-w-md w-full p-6 space-y-4 pixel-scale-in" style={bodyFont}>
          <div className="pixel-header"><span>INGRESAR A SALA</span></div>
          {ErrorBanner}
          <div><label className="text-xs text-[var(--foreground)] tracking-wider block mb-1">TU NOMBRE DE DETECTIVE</label><input value={username} onChange={(e) => setUsername(e.target.value)} maxLength={20} className="pixel-input w-full" placeholder="ej: Watson" /></div>
          <div><label className="text-xs text-[var(--foreground)] tracking-wider block mb-1">CÓDIGO DE SALA</label><input value={roomCode} onChange={(e) => setRoomCode(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ""))} maxLength={8} className="pixel-input w-full uppercase tracking-widest" placeholder="abc123" autoFocus /></div>
          <button onClick={() => { SFX.soundClick(); handleJoinRoom(); }} disabled={loading || !username.trim() || !roomCode.trim()} className="pixel-btn w-full py-3" style={headFont}>{loading ? "VERIFICANDO..." : "UNIRSE"}</button>
          <BackBtn target="create_or_join" />
        </div>
      </main>
    );
  }

  /* ═══ RENDER: JOIN_BY_LINK ═══ */
  if (phase === "join_by_link") {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-4">
        {AchievementOverlay}
        <div className="pixel-frame max-w-md w-full p-6 space-y-4 pixel-scale-in" style={bodyFont}>
          <div className="pixel-header"><span>INVITACIÓN A SALA</span></div>
          <div className="text-center text-xs text-[var(--foreground)] tracking-wider">CÓDIGO: <span className="text-[var(--primary)] text-sm">{roomCode.toUpperCase()}</span></div>
          {ErrorBanner}
          <div><label className="text-xs text-[var(--foreground)] tracking-wider block mb-1">TU NOMBRE DE DETECTIVE</label><input value={username} onChange={(e) => setUsername(e.target.value)} maxLength={20} className="pixel-input w-full" placeholder="ej: Watson" autoFocus /></div>
          <button onClick={() => { SFX.soundClick(); handleJoinByLink(); }} disabled={loading || !username.trim()} className="pixel-btn w-full py-3" style={headFont}>{loading ? "UNIÉNDOSE..." : "ENTRAR A LA SALA"}</button>
        </div>
      </main>
    );
  }

  /* ═══ RENDER: LOBBY ═══ */
  if (phase === "lobby") {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-4">
        {AchievementOverlay}
        <div className="pixel-frame max-w-lg w-full p-6 space-y-6 pixel-scale-in" style={bodyFont}>
          <div className="pixel-header"><span>LOBBY // SALA: {roomCode.toUpperCase()}</span></div>
          <div className="text-center">
            <div className="text-xs text-[var(--foreground)] tracking-wider">CÓDIGO DE SALA</div>
            <div className="text-2xl font-bold tracking-[0.3em] text-[var(--primary)] mt-1" style={headFont}>{roomCode.toUpperCase()}</div>
            <button onClick={() => { SFX.soundClick(); copyInviteLink(); }} className="text-xs text-[var(--muted-foreground)] hover:text-[var(--primary)] mt-2 transition-colors">📋 COPIAR LINK DE INVITACIÓN</button>
          </div>
          <div>
            <div className="text-xs text-[var(--foreground)] tracking-wider mb-2">DETECTIVES EN SALA ({lobbyPlayers.length}/2)</div>
            {lobbyPlayers.map((p) => (
              <div key={p.id} className="flex items-center gap-2 py-1 border-b border-[var(--border)] text-xs">
                <span className="text-[var(--primary)]">{p.isHost ? "[HOST]" : "🔍"}</span>
                <span className={cn(p.isHost ? "text-[var(--primary)] font-bold" : "text-[var(--foreground)]")}>{p.username}</span>
                {p.isHost && <span className="text-[12px] text-[var(--muted-foreground)] ml-auto tracking-wider">ANFITRIÓN</span>}
              </div>
            ))}
          </div>
          <div className="pixel-frame p-3 space-y-1">
            <div className="text-xs text-[var(--foreground)] tracking-wider mb-2">CONFIGURACION</div>
            <div className="flex justify-between text-xs">
              <span className="text-[var(--muted-foreground)]">DIFICULTAD:</span>
              <span className="text-[var(--primary)] font-bold">{difficulty.toUpperCase()}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[var(--muted-foreground)]">TEMA:</span>
              <span className="text-[var(--primary)] font-bold">{crimeTheme === "random" ? "ALEATORIO" : crimeTheme.toUpperCase()}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[var(--muted-foreground)]">VOZ IA:</span>
              <span className="text-[var(--primary)] font-bold">{aiVoice === "on" ? "ACTIVADA" : "SILENCIADA"}</span>
            </div>
          </div>
          {session?.isHost && <button onClick={() => { SFX.soundClick(); handleStartGame(); }} className="pixel-btn w-full py-3" style={headFont}>COMENZAR</button>}
          {!session?.isHost && <div className="text-center text-xs text-[var(--muted-foreground)] italic animate-pulse">Esperando al anfitrión para empezar...</div>}
          <button onClick={() => { SFX.soundError(); leaveRoom(); }} className="pixel-btn-danger w-full py-2 text-xs">SALIR DE LA SALA</button>
        </div>
      </main>
    );
  }

  /* ═══ RENDER: GENERATING_CASE ═══ */
  if (phase === "generating_case") {
    return <CaseGeneratorScreen onCaseReady={handleCaseReady} onBack={() => setPhase("lobby")} />;
  }

  /* ═══ RENDER: CASE_INTRO ═══ */
  if (phase === "case_intro" && currentCase) {
    const c = currentCase; const s = c.suspect; const totalSteps = CASE_INTRO_TOTAL_STEPS;

    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-6 select-none pixel-fade-in cursor-pointer"
        onClick={() => { if (caseIntroStep >= totalSteps - 1) { SFX.soundClick(); handleStartInterrogation(); } else { setCaseIntroStep(p => Math.min(p + 1, totalSteps - 1)); } }}>
        {AchievementOverlay}
        <div className="max-w-2xl w-full space-y-5 text-center">
          {caseIntroStep >= 0 && (
            <div className={cn("transition-all duration-700", caseIntroStep === 0 ? "opacity-100 translate-y-0" : "opacity-40")}>
              <div className="flex items-center justify-center gap-3 mb-2">{c.difficulty && <DifficultyBadge difficulty={c.difficulty} />}</div>
              <h1 className="text-2xl md:text-4xl font-bold text-[var(--primary)] tracking-widest" style={headFont}>{safeRender(c.title)}</h1>
              <div className="text-xs text-[var(--muted-foreground)] mt-2" style={bodyFont}>{safeRender(c.subtitle)}</div>
            </div>
          )}
          {caseIntroStep >= 1 && (
            <div className={cn("transition-all duration-700 delay-100", caseIntroStep === 1 ? "opacity-100 translate-y-0" : "opacity-40")}>
              <div className="text-sm text-[var(--primary)] tracking-widest" style={bodyFont}>{c.date}</div>
              <div className="text-xs text-[var(--muted-foreground)] tracking-widest mt-1" style={bodyFont}>{c.location}</div>
              <div className="text-xs text-[var(--destructive)] tracking-wider mt-2" style={bodyFont}>{safeRender(c.stakes)}</div>
            </div>
          )}
          {caseIntroStep >= 2 && (
            <div className={cn("pixel-frame p-4 transition-all duration-700 delay-200", caseIntroStep === 2 ? "opacity-100 translate-y-0" : "opacity-40")}>
              <p className="text-sm text-[var(--foreground)] leading-relaxed text-left" style={bodyFont}>{safeRender(c.briefing)}</p>
            </div>
          )}
          {caseIntroStep >= 3 && (
            <div className={cn("pixel-frame p-4 transition-all duration-700 delay-200", caseIntroStep === 3 ? "opacity-100 translate-y-0" : "opacity-40")}>
              <div className="text-xs text-[var(--foreground)] tracking-wider mb-3" style={bodyFont}>SOSPECHOSO</div>
              <div className="flex items-center gap-4">
                <div className="text-4xl">{safeRender(s.avatar)}</div>
                <div className="text-left">
                  <div className="text-sm font-bold text-[var(--primary)] tracking-wider" style={headFont}>{safeRender(s.name)}</div>
                  <div className="text-xs text-[var(--muted-foreground)] mt-1" style={bodyFont}>{s.age ? `${s.age} anos · ` : ""}{safeRender(s.role)}</div>
                </div>
              </div>
            </div>
          )}
          {caseIntroStep >= 4 && (
            <div className={cn("pixel-frame p-4 text-left transition-all duration-700 delay-300", caseIntroStep === 4 ? "opacity-100 translate-y-0" : "opacity-40")}>
              <div className="text-xs text-[var(--foreground)] tracking-wider mb-3" style={bodyFont}>HECHOS CONOCIDOS</div>
              <ul className="space-y-1">{s.knownFacts.map((f, i) => <li key={i} className="text-xs text-[var(--foreground)] flex gap-2" style={bodyFont}><span className="text-[var(--primary)] shrink-0">-</span>{safeRender(f)}</li>)}</ul>
            </div>
          )}
          {caseIntroStep >= 5 && evidenceItems.length > 0 && (
            <div className={cn("pixel-frame p-4 text-left transition-all duration-700 delay-300", caseIntroStep === 5 ? "opacity-100 translate-y-0" : "opacity-40")}>
              <div className="text-xs text-[var(--foreground)] tracking-wider mb-3" style={bodyFont}>EVIDENCIA ({evidenceItems.length} PIEZAS)</div>
              <ul className="space-y-1">{evidenceItems.slice(0, 6).map((ev, i) => <li key={i} className="text-xs text-[var(--foreground)] flex gap-2" style={bodyFont}><span className={cn("shrink-0", ev.isRedHerring ? "text-[var(--destructive)]" : "text-[#4ec9b0]")}>-</span><span>{safeRender(ev.label)}{ev.isLocked ? " (BLOQUEADA)" : ""}</span></li>)}</ul>
            </div>
          )}
          {caseIntroStep >= totalSteps - 1 ? (
            <div className="text-sm text-[var(--primary)] tracking-widest animate-pulse mt-4" style={bodyFont}>PRESIONA EN CUALQUIER LUGAR PARA EMPEZAR</div>
          ) : (
            <div className="text-xs text-[var(--muted-foreground)]/50 tracking-wider mt-4" style={bodyFont}>PRESIONA PARA CONTINUAR</div>
          )}
        </div>
      </main>
    );
  }

  /* ═══ RENDER: EVIDENCE_REVIEW ═══ */
  if (phase === "evidence_review" && currentCase) {
    return (
      <div className="min-h-screen flex flex-col" style={bodyFont}>
        {AchievementOverlay}
        <header className="border-b-2 border-[var(--border)] bg-[var(--card)] px-4 py-3 flex items-center justify-between shrink-0">
          <div>
            <div className="text-sm font-bold text-[var(--primary)] tracking-widest" style={headFont}>REVISIÓN DE EVIDENCIA</div>
            <div className="text-xs text-[var(--muted-foreground)] tracking-wider">Estudia el caso antes del interrogatorio</div>
          </div>
          <div className={cn("text-xl font-bold", evidenceReviewTime <= 10 ? "text-[var(--destructive)] pixel-timer-warning" : "text-[var(--primary)]")} style={headFont}>⏱ {formatTime(evidenceReviewTime)}</div>
        </header>

        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Left: Evidence & Timeline */}
          <section className="flex-1 p-4 pixel-scroll overflow-y-auto space-y-4">
            <div className="pixel-frame p-4">
              <div className="text-xs text-[var(--primary)] tracking-wider font-bold mb-3">EVIDENCIA DEL CASO</div>
              {evidenceItems.length === 0 ? (
                <div className="text-xs text-[var(--muted-foreground)] italic py-4 text-center">Sin evidencia disponible</div>
              ) : (
                <div className="grid gap-2">
                  {evidenceItems.map((ev) => {
                    // Build a hint from the label keywords so detectives
                    // know what to ask about to unlock this evidence.
                    const hintKeywords = ev.label
                      .toLowerCase()
                      .split(/[^a-záéíóúñ]+/)
                      .filter(w => w.length >= 4)
                      .slice(0, 3);
                    const hint = hintKeywords.length > 0
                      ? `Pregunta sobre: ${hintKeywords.join(", ")}`
                      : "Pregunta sobre el tema relacionado";
                    return (
                    <div key={ev.id} className={cn("pixel-frame p-3 transition-all", ev.isLocked && "opacity-60")}>
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{ev.isRedHerring ? "🔴" : ev.isLocked ? "🔒" : "📄"}</span>
                        <span className="text-xs font-bold text-[var(--foreground)] tracking-wider">{safeRender(ev.label)}</span>
                        {ev.isRedHerring && <span className="pixel-badge danger text-xs">PISTA FALSA</span>}
                      </div>
                      {!ev.isLocked && <div className="text-xs text-[var(--muted-foreground)] mt-1">{safeRender(ev.description)}</div>}
                      {ev.isLocked && <div className="text-[13px] text-[var(--primary)]/70 mt-1 italic">💡 {hint}</div>}
                    </div>
                    );
                  })}
                </div>
              )}
            </div>

            {currentCase.timeline && currentCase.timeline.length > 0 && (
              <div className="pixel-frame p-4">
                <div className="text-xs text-[var(--primary)] tracking-wider font-bold mb-3">LÍNEA TEMPORAL</div>
                <div className="space-y-2">
                  {currentCase.timeline.map((t, i) => (
                    <div key={i} className="flex gap-3 text-xs">
                      <span className="text-[var(--primary)] font-bold shrink-0">[{safeRender(t.time)}]</span>
                      <span className={t.isPublic ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)] italic"}>{safeRender(t.event)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Right: Private detective chat */}
          <aside className="w-full md:w-80 border-t-2 md:border-t-0 md:border-l-2 border-[var(--border)] bg-[var(--card)] flex flex-col shrink-0">
            <div className="pixel-header"><span>CHAT PRIVADO</span></div>
            <div className="flex-1 p-3 pixel-scroll overflow-y-auto space-y-2 min-h-0">
              {detectiveMessages.map((dm, i) => (
                <div key={i} className="text-xs"><span className="text-[var(--primary)] font-bold">[{safeRender(dm.detectiveName)}]:</span> <span className="text-[var(--foreground)]">{safeRender(dm.text)}</span></div>
              ))}
              {detectiveMessages.length === 0 && <div className="text-xs text-[var(--muted-foreground)] italic text-center py-4">Discute la evidencia con tu compañero...</div>}
            </div>
            <form onSubmit={handleSendDetective} className="border-t-2 border-[var(--border)] p-3 flex gap-2 shrink-0">
              <input value={detectiveDraft} onChange={(e) => setDetectiveDraft(e.target.value)} className="pixel-input flex-1 text-xs" placeholder="Mensaje privado..." />
              <button type="submit" className="pixel-btn text-xs px-2">ENVIAR</button>
            </form>
          </aside>
        </div>

        <div className="p-3 border-t-2 border-[var(--border)] bg-[var(--card)]">
          <button onClick={() => { SFX.soundWhoosh(); handleStartInterrogation(); }} className="pixel-btn w-full py-3" style={headFont}>COMENZAR INTERROGATORIO ▶</button>
        </div>
      </div>
    );
  }

  /* ═══ RENDER: PLAYING ═══ */
  if (phase === "playing" && currentCase) {
    const suspect = currentCase.suspect;
    const unlockedCount = evidenceItems.filter(e => !e.isLocked).length;
    const totalEvCount = evidenceItems.length;
    const activeTells = SUSPECT_TELLS.filter(t => stress.stress >= t.minStress);
    const portraitShake = stress.stress >= 80;
    const portraitTint = stress.stress >= 70 ? "hue-rotate(340deg) brightness(0.9)" : stress.stress >= 50 ? "hue-rotate(350deg)" : "none";

    const getStressLabel = (value: number, label: string): { text: string; trend: string } => {
      if (label === "ESTRÉS" || label === "NERVIOSISMO" || label === "HOSTILIDAD") {
        if (value >= 85) return { text: "EXTREMO", trend: "▲▲▲" };
        if (value >= 65) return { text: "ALTO", trend: "▲▲" };
        if (value >= 45) return { text: "MODERADO", trend: "▲" };
        if (value >= 25) return { text: "BAJO", trend: "—" };
        return { text: "MÍNIMO", trend: "—" };
      } else {
        // CONFIANZA — inverted: high = good
        if (value >= 75) return { text: "SEGuro", trend: "▲▲" };
        if (value >= 55) return { text: "CALMADO", trend: "▲" };
        if (value >= 35) return { text: "INSEGURO", trend: "▼" };
        if (value >= 15) return { text: "NERVIOSO", trend: "▼▼" };
        return { text: "COLAPSANDO", trend: "▼▼▼" };
      }
    };

    const StressBar = ({ label, value, colorClass, emoji }: { label: string; value: number; colorClass: string; emoji: string }) => {
      const { text, trend } = getStressLabel(value, label);
      return (
        <div className="space-y-1">
          <div className="flex justify-between text-[12px]" style={bodyFont}>
            <span className="text-[var(--foreground)]">{emoji} {label}</span>
            <span className={cn(
              value >= 75 && (label !== "CONFIANZA") ? "text-[var(--destructive)] font-bold" : "",
              value >= 75 && label === "CONFIANZA" ? "text-[#4ec9b0] font-bold" : "",
              value < 25 && label === "CONFIANZA" ? "text-[var(--destructive)] font-bold" : "",
            )}>{text} <span className="text-[13px] opacity-60">{trend}</span></span>
          </div>
          <div className="pixel-stress-bar"><div className={cn("pixel-stress-bar-fill", colorClass)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>
        </div>
      );
    };

    const RightTabs = () => {
      const tabList = [
        { key: "expediente" as const, label: "EXPEDIENTE" },
        { key: "evidencia" as const, label: `EVIDENCIA (${unlockedCount}/${totalEvCount})` },
        { key: "notas" as const, label: "NOTAS" },
        { key: "timeline" as const, label: "TIMELINE" },
        { key: "detectives" as const, label: "DETECTIVES" },
        { key: "herramientas" as const, label: "HERRAMIENTAS" },
      ];
      return (
        <div className="flex flex-col h-full">
          {/* Tabs — larger, more readable, two-row wrap */}
          <div className="flex border-b-2 border-[var(--border)] flex-wrap shrink-0">
            {tabList.map((tab) => (
              <button
                key={tab.key}
                onClick={() => { setRightTab(tab.key); SFX.soundTab(); }}
                className={cn(
                  "px-2.5 py-2 text-[12px] tracking-wider transition-all cursor-pointer",
                  rightTab === tab.key
                    ? "text-[var(--primary)] border-b-2 border-[var(--primary)] bg-[var(--primary)]/8"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                )}
                style={bodyFont}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {/* Content — more padding, better hierarchy */}
          <div className="p-4 pixel-scroll flex-1 overflow-y-auto" style={bodyFont}>
            {rightTab === "expediente" && (
              <div className="space-y-4">
                <div className="pixel-frame p-3">
                  <div className="text-[13px] tracking-[0.18em] text-[var(--muted-foreground)] uppercase mb-2">Resumen del caso</div>
                  <p className="text-xs text-[var(--foreground)] leading-relaxed">{safeRender(currentCase.briefing)}</p>
                  {currentCase.difficulty && <div className="mt-3"><DifficultyBadge difficulty={currentCase.difficulty} /></div>}
                </div>
                <div className="pixel-frame p-3">
                  <div className="text-[13px] tracking-[0.18em] text-[var(--muted-foreground)] uppercase mb-2">Sospechoso</div>
                  <div className="text-xs text-[var(--foreground)] flex items-center gap-2">
                    <span className="text-lg">{safeRender(suspect.avatar)}</span>
                    <div>
                      <div className="font-bold">{safeRender(suspect.name)}</div>
                      <div className="text-[13px] text-[var(--muted-foreground)]">{safeRender(suspect.role)}</div>
                    </div>
                  </div>
                </div>
                <div className="pixel-frame p-3">
                  <div className="text-xs tracking-[0.18em] text-[var(--muted-foreground)] uppercase mb-2">Hechos conocidos</div>
                  <div className="space-y-2">
                    {suspect.knownFacts.map((f, i) => (
                      <div key={i} className="text-xs text-[var(--foreground)] flex gap-2 leading-relaxed">
                        <span className="text-[var(--primary)] shrink-0">▸</span>
                        <span>{safeRender(f)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {rightTab === "evidencia" && (
              <div className="space-y-2">
                <div className="text-xs text-[var(--primary)] font-bold">EVIDENCIA</div>
                {evidenceItems.length === 0 ? <div className="text-xs text-[var(--muted-foreground)] italic py-4 text-center">Sin evidencia</div> : (
                  <div className="space-y-2">
                    {evidenceItems.map((ev) => (
                      <div key={ev.id} className={cn("pixel-frame p-2 transition-all cursor-pointer hover:translate-y-[-2px]", ev.isLocked && "opacity-40", selectedEvidence?.id === ev.id && "pixel-frame-active")} onClick={() => { if (!ev.isLocked) { SFX.soundClick(); setSelectedEvidence(ev === selectedEvidence ? null : ev); } }}>
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{ev.isRedHerring ? "🔴" : ev.isLocked ? "[LOCK]" : "[DOC]"}</span>
                          <span className="text-[13px] font-bold text-[var(--foreground)] tracking-wider">{safeRender(ev.label)}</span>
                        </div>
                        {!ev.isLocked && <div className="text-[13px] text-[var(--muted-foreground)] mt-1">{safeRender(ev.description)}</div>}
                      </div>
                    ))}
                  </div>
                )}
                {selectedEvidence && !selectedEvidence.isLocked && (
                  <div className="mt-3 border-t-2 border-[var(--border)] pt-3">
                    <div className="text-[13px] text-[var(--destructive)] tracking-wider mb-2">EVIDENCIA SELECCIONADA PARA PRESENTAR</div>
                    <div className="pixel-frame-active p-2 mb-2"><div className="text-xs text-[var(--foreground)]">{safeRender(selectedEvidence.description)}</div></div>
                  </div>
                )}
              </div>
            )}
            {rightTab === "notas" && (
              <div className="space-y-2">
                <div className="text-xs text-[var(--primary)] font-bold">NOTAS COMPARTIDAS</div>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="pixel-input w-full min-h-[200px] resize-none text-xs" placeholder="Escribe tus notas aquí..." />
              </div>
            )}
            {rightTab === "timeline" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between"><div className="text-xs text-[var(--primary)] font-bold">LÍNEA TEMPORAL</div><button onClick={() => { SFX.soundClick(); addTimelineEntry(); }} className="pixel-btn-secondary text-xs py-1 px-2">+ AGREGAR</button></div>
                {timelineEntries.length === 0 ? <div className="text-xs text-[var(--muted-foreground)] italic py-4 text-center">Sin eventos</div> : (
                  <div className="space-y-2">{timelineEntries.map((entry) => (<div key={entry.id} className="pixel-frame p-2"><div className="text-[13px] text-[var(--primary)] font-bold tracking-wider">{entry.label}</div><div className="text-xs text-[var(--foreground)] mt-0.5">{entry.description}</div><div className="text-xs text-[var(--muted-foreground)] mt-1">— {entry.addedByName}</div></div>))}</div>
                )}
              </div>
            )}
            {rightTab === "detectives" && (
              <div className="flex flex-col h-64">
                <div className="text-xs text-[var(--primary)] font-bold mb-2">CHAT PRIVADO — DETECTIVES</div>
                <div className="flex-1 pixel-scroll overflow-y-auto space-y-2 mb-2">
                  {detectiveMessages.map((dm, i) => (<div key={i} className="text-xs"><span className="text-[var(--primary)] font-bold">[{safeRender(dm.detectiveName)}]:</span> <span className="text-[var(--foreground)]">{safeRender(dm.text)}</span></div>))}
                  {detectiveMessages.length === 0 && <div className="text-xs text-[var(--muted-foreground)] italic text-center py-4">Sin mensajes privados</div>}
                </div>
                <form onSubmit={handleSendDetective} className="flex gap-1"><input value={detectiveDraft} onChange={(e) => setDetectiveDraft(e.target.value)} className="pixel-input flex-1 text-xs" placeholder="Mensaje privado..." /><button type="submit" className="pixel-btn text-xs px-2">ENVIAR</button></form>
              </div>
            )}
            {rightTab === "herramientas" && (
              <div className="space-y-2">
                <div className="text-xs text-[var(--primary)] font-bold mb-2">TÉCNICA DE INTERROGACIÓN</div>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {TECHNIQUES.map((t) => (
                    <button key={t.key} onClick={() => { SFX.soundClick(); setTechnique(t.key); }} className={cn("pixel-frame p-2 text-center transition-all cursor-pointer", technique === t.key && "pixel-frame-active")}>
                      <div className="text-sm">{t.emoji}</div>
                      <div className="text-xs text-[var(--foreground)] tracking-wider">{t.label}</div>
                    </button>
                  ))}
                </div>
                <div className="text-xs text-[var(--primary)] font-bold mb-2">PREGUNTAS RÁPIDAS</div>
                {QUICK_QUESTIONS.map((q) => (<button key={q.label} onClick={() => { SFX.soundClick(); insertQuickQuestion(q.text); }} className="pixel-frame w-full p-2 text-left hover:bg-[var(--primary)]/10 transition-all cursor-pointer"><div className="text-[12px] text-[var(--primary)] tracking-wider font-bold">{q.label.toUpperCase()}</div><div className="text-xs text-[var(--foreground)] mt-0.5">"{q.text}"</div></button>))}
              </div>
            )}
          </div>
        </div>
      );
    };

    return (
      <div className="min-h-screen flex flex-col pixel-fade-in" style={bodyFont}>
        {AchievementOverlay}
        <header className="border-b border-[var(--border)] bg-[var(--card)] px-4 py-2 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <span className="text-[var(--primary)] pixel-live-dot" />
            <span className="text-sm tracking-wider text-[var(--foreground)] font-bold">INTERROGACION</span>
            <span className="pixel-badge text-xs">PREGUNTAS: {questionsAsked}</span>
          </div>
          <div className="flex items-center gap-4">
            <span className={cn("text-sm font-bold", timeRemaining <= 60 ? "text-[var(--destructive)] pixel-timer-warning" : "text-[var(--primary)]")} style={headFont}>{formatTime(timeRemaining)}</span>
            <button onClick={() => { const m = SFX.toggleMuted(); setMutedState(m); if (!m) SFX.soundClick(); }} className="pixel-btn-secondary text-xs py-1 px-3" title={muted ? "Activar sonido" : "Silenciar"}>
              {muted ? "[MUTE]" : "[SND]"}
            </button>
            <button onClick={() => { SFX.soundClick(); enterDeliberation(); }} className="pixel-btn-danger text-xs py-1 px-3">DELIBERAR</button>
          </div>
        </header>

        {/* Phase stepper navigation */}
        <div className="border-b border-[var(--border)] bg-[var(--card)] px-4 py-1.5 shrink-0 overflow-x-auto">
          <PhaseIndicator current="playing" />
        </div>

        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* LEFT: Suspect panel */}
          <aside className="hidden md:flex flex-col w-52 border-r-2 border-[var(--border)] bg-[var(--card)] shrink-0">
            <div className="pixel-header"><span>SOSPECHOSO</span></div>
            <div className="p-3 space-y-3 flex-1 overflow-y-auto pixel-scroll">
              {/* Portrait + identity card */}
              <div className="text-center">
                <div className={cn("flex justify-center mb-3", portraitShake && "pixel-portrait-shake")} style={{ filter: portraitTint }}>
                  <SuspectPortrait seed={currentCase?.id?.replace("gen_", "") ?? "default"} gender={recallGender(currentCase?.id?.replace("gen_", "") ?? "default")} avatar={suspect.avatar} size="lg" />
                </div>
                <div className="text-base font-bold text-[var(--primary)] tracking-wider" style={headFont}>{safeRender(suspect.name)}</div>
                <div className="text-xs text-[var(--muted-foreground)] mt-1">{suspect.age ? `${suspect.age} años · ` : ""}{safeRender(suspect.role)}</div>
                {/* Suspect tells */}
                {activeTells.length > 0 && (
                  <div className="flex justify-center gap-1 mt-2">
                    {activeTells.slice(-2).map((t) => <span key={t.id} className="text-lg pixel-evidence-flash" title={t.label}>{t.emoji}</span>)}
                  </div>
                )}
              </div>

              {/* Stress telemetry — thicker bars, more breathing room */}
              <div className="pixel-frame p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs tracking-[0.18em] text-[var(--muted-foreground)] uppercase">Telemetría</div>
                  {/* Live BPM readout — pulses with the heartbeat */}
                  <div className={cn(
                    "flex items-center gap-1.5 px-2 py-0.5 border",
                    bpm > 120 ? "border-[var(--destructive)] text-[var(--destructive)]" : "border-[var(--border)] text-[var(--primary)]",
                    bpm > 140 && "pixel-pulse"
                  )}>
                    <span className="text-sm">❤</span>
                    <span className="text-sm font-bold tabular-nums">{bpm}</span>
                    <span className="text-xs opacity-70">BPM</span>
                  </div>
                </div>
                <StressBar label="ESTRÉS" value={stress.stress} colorClass="stress" emoji="🔵" />
                <StressBar label="NERVIOSISMO" value={nervousness} colorClass="nervousness" emoji="🟡" />
                <StressBar label="CONFIANZA" value={stress.confidence} colorClass="confidence" emoji="🔷" />
                <StressBar label="HOSTILIDAD" value={stress.hostility} colorClass="hostility" emoji="🔺" />
              </div>

              {/* Known facts — card-based, more readable */}
              <div className="pixel-frame p-3">
                <div className="text-xs tracking-[0.18em] text-[var(--muted-foreground)] uppercase mb-2">Hechos conocidos</div>
                <div className="space-y-2 pixel-scroll max-h-40 overflow-y-auto">
                  {suspect.knownFacts.map((f, i) => (
                    <div key={i} className="text-xs text-[var(--foreground)] flex gap-2 leading-relaxed">
                      <span className="text-[var(--primary)] shrink-0">▸</span>
                      <span>{safeRender(f)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </aside>

          {/* CENTER: Chat */}
          <section className={cn("flex-1 flex flex-col min-h-0", mobileTab !== "chat" && "hidden md:flex")}>
            <div className="flex-1 overflow-y-auto pixel-scroll p-3 space-y-2 pixel-chat-compact">
              {chatMessages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center space-y-3 pixel-fade-in">
                  <div className="text-xs text-[var(--muted-foreground)]">El sospechoso espera en la sala de interrogacion.</div>
                  <div className="text-xs text-[var(--primary)]">Formula tu primera pregunta para comenzar.</div>
                </div>
              )}
              {chatMessages.map((msg, i) => {
                const isDetective = msg.senderType === "detective";
                const isSystem = msg.senderType === "system";
                return (
                  <div key={`chat-${i}`} className={cn("flex flex-col", isDetective ? "items-start" : "items-end", isSystem && "items-center")}>
                    {isSystem && <div className="text-[13px] text-[var(--muted-foreground)] italic text-center px-4 py-1.5 border border-[var(--border)] bg-[var(--accent)]">{safeRender(msg.text)}</div>}
                    {isDetective && !isSystem && (
                      <div className="max-w-[80%]">
                        <div className="text-[13px] text-[var(--primary)] tracking-wider mb-1">[Detective {safeRender(msg.senderName)} pregunta]</div>
                        <div className="pixel-frame p-2.5 text-sm text-[var(--foreground)] border-l-2 border-l-[var(--primary)]">{safeRender(msg.text)}</div>
                      </div>
                    )}
                    {msg.senderType === "suspect" && (
                      <div className="max-w-[80%] pixel-message-in">
                        <div className="text-[13px] text-[var(--muted-foreground)] tracking-wider mb-1 text-right flex items-center justify-end gap-2">
                          <span className="pixel-badge">SOSPECHOSO</span>
                          <span>[{safeRender(msg.senderName) || "SOSPECHOSO"}]</span>
                        </div>
                        <div className={cn("pixel-frame p-2.5 text-sm", msg.type === "suspect.autonomous" ? "text-[var(--muted-foreground)] italic border-r-2 border-r-[var(--border)]" : "text-[var(--foreground)] border-r-2 border-r-[#2a2a44]")}>
                          {msg.type === "suspect.autonomous" && <span className="text-xs text-[var(--muted-foreground)] tracking-wider block mb-1">*pensamiento autónomo*</span>}
                          <TypewriterText text={safeRender(msg.text)} speed={22} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {pending && <div className="flex justify-end"><div className="pixel-frame p-2.5 text-xs text-[var(--muted-foreground)]"><TypingIndicator label="El sospechoso está respondiendo" /></div></div>}
              <div ref={chatEndRef} />
            </div>
            <form onSubmit={handleInterrogate} className="border-t-2 border-[var(--border)] bg-[var(--card)] p-2 flex gap-2 shrink-0">
              {selectedEvidence && <div className="flex items-center gap-1 px-2 border border-[var(--destructive)] bg-[var(--destructive)]/10"><span className="text-xs text-[var(--destructive)]">📎 {safeRender(selectedEvidence.label)}</span><button type="button" onClick={() => { SFX.soundClick(); setSelectedEvidence(null); }} className="text-[var(--destructive)] hover:text-white text-xs">✕</button></div>}
              <input ref={chatInputRef} value={chatDraft} onChange={(e) => setChatDraft(e.target.value)} className="pixel-input flex-1 text-xs" placeholder={selectedEvidence ? "Presentando evidencia..." : technique !== "neutral" ? `[${technique.toUpperCase()}] Pregunta al sospechoso...` : "Pregunta al sospechoso..."} disabled={pending} />
              <button type="submit" disabled={pending || !chatDraft.trim()} className="pixel-btn text-xs px-4">{pending ? "..." : "ENVIAR"}</button>
            </form>
          </section>

          {/* RIGHT: Tabbed panel */}
          <aside className="hidden md:flex flex-col w-72 border-l-2 border-[var(--border)] bg-[var(--card)] shrink-0"><RightTabs /></aside>

          {/* MOBILE: Suspect panel */}
          <div className={cn("md:hidden flex-1 overflow-y-auto pixel-scroll p-4", mobileTab !== "sospechoso" && "hidden")}>
            <div className="pixel-frame p-4 space-y-4">
              <div className="text-center">
                <div className={cn("flex justify-center mb-3", portraitShake && "pixel-portrait-shake")} style={{ filter: portraitTint }}><SuspectPortrait seed={currentCase?.id?.replace("gen_", "") ?? "default"} gender={recallGender(currentCase?.id?.replace("gen_", "") ?? "default")} avatar={suspect.avatar} size="lg" /></div>
                <div className="text-sm font-bold text-[var(--primary)] tracking-wider" style={headFont}>{safeRender(suspect.name)}</div>
                <div className="text-xs text-[var(--muted-foreground)] mt-1">{suspect.age ? `${suspect.age} años · ` : ""}{safeRender(suspect.role)}</div>
              </div>
              <div className="space-y-2">
                <StressBar label="ESTRÉS" value={stress.stress} colorClass="stress" emoji="🔵" />
                <StressBar label="NERVIOSISMO" value={nervousness} colorClass="nervousness" emoji="🟡" />
                <StressBar label="CONFIANZA" value={stress.confidence} colorClass="confidence" emoji="🔷" />
                <StressBar label="HOSTILIDAD" value={stress.hostility} colorClass="hostility" emoji="🔺" />
              </div>
            </div>
          </div>

          {/* MOBILE: Panel tab */}
          <div className={cn("md:hidden flex-1 overflow-hidden flex flex-col", mobileTab !== "panel" && "hidden")}><RightTabs /></div>
        </div>

        <div className="md:hidden flex border-t-2 border-[var(--border)] bg-[var(--card)]">
          {[{ key: "chat" as const, label: "💬 CHAT" }, { key: "sospechoso" as const, label: `${safeRender(suspect.avatar)} SOSPECHOSO` }, { key: "panel" as const, label: "📋 PANEL" }].map((tab) => (
            <button key={tab.key} onClick={() => { setMobileTab(tab.key); SFX.soundTab(); }} className={cn("flex-1 py-2 text-xs tracking-wider transition-colors cursor-pointer", mobileTab === tab.key ? "text-[var(--primary)] bg-[var(--primary)]/5 border-b-2 border-[var(--primary)]" : "text-[var(--muted-foreground)]")} style={bodyFont}>{tab.label}</button>
          ))}
        </div>
      </div>
    );
  }

  /* ═══ RENDER: DELIBERATION ═══ */
  if (phase === "deliberation") {
    return (
      <div className="min-h-screen flex flex-col" style={bodyFont}>
        {AchievementOverlay}
        <header className="border-b-2 border-[var(--border)] bg-[var(--card)] px-4 py-3 flex items-center justify-between">
          <div><div className="text-sm font-bold text-[var(--primary)] tracking-widest" style={headFont}>DELIBERACIÓN</div><div className="text-xs text-[var(--muted-foreground)] tracking-wider">Discute con tu compañero antes de votar</div></div>
          <div className="flex items-center gap-3"><PhaseIndicator current="deliberation" /><div className="text-xl font-bold text-[var(--primary)]" style={headFont}>⏱ {formatTime(delibTimeRemaining)}</div></div>
        </header>
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          <aside className="hidden md:flex flex-col w-72 border-r-2 border-[var(--border)] bg-[var(--card)] p-4 space-y-4 shrink-0">
            <div className="pixel-header"><span>RESUMEN</span></div>
            <div className="space-y-3 pixel-scroll overflow-y-auto flex-1">
              <div><div className="text-xs text-[var(--foreground)] tracking-wider">PREGUNTAS</div><div className="text-lg font-bold text-[var(--primary)]">{questionsAsked}</div></div>
              <div><div className="text-xs text-[var(--foreground)] tracking-wider">ESTRÉS MÁXIMO</div><div className="text-lg font-bold text-[var(--destructive)]">{maxStress}%</div></div>
              <div><div className="text-xs text-[var(--foreground)] tracking-wider">FLAGGED</div><div className="text-lg font-bold text-[var(--destructive)]">{flaggedCount}</div></div>
              <div><div className="text-xs text-[var(--foreground)] tracking-wider">EVIDENCIA</div><div className="text-lg font-bold text-[var(--primary)]">{evidenceItems.filter(e => !e.isLocked).length}/{evidenceItems.length}</div></div>
              <div className="border-t border-[var(--border)] pt-2"><div className="text-xs text-[var(--foreground)] mb-1">SOSPECHOSO</div><div className="text-xs text-[var(--foreground)]">{safeRender(currentCase?.suspect.avatar)} {safeRender(currentCase?.suspect.name)} — {safeRender(currentCase?.suspect.role)}</div></div>
            </div>
            <button onClick={() => { SFX.soundClick(); skipToVote(); }} className="pixel-btn w-full py-3 mt-auto" style={headFont}>VOTAR AHORA</button>
          </aside>
          <section className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto pixel-scroll p-3 space-y-2">
              {detectiveMessages.length === 0 && <div className="text-center text-xs text-[var(--muted-foreground)] italic py-8">Discute tus conclusiones...</div>}
              {detectiveMessages.map((dm, i) => (<div key={i} className="flex flex-col items-start"><div className="text-[12px] text-[var(--primary)] tracking-wider">[{safeRender(dm.detectiveName)}]</div><div className="pixel-frame p-2.5 text-xs text-[var(--foreground)] max-w-[80%]">{safeRender(dm.text)}</div></div>))}
              <div ref={chatEndRef} />
            </div>
            <form onSubmit={handleSendDetective} className="border-t-2 border-[var(--border)] bg-[var(--card)] p-3 flex gap-2 shrink-0"><input value={detectiveDraft} onChange={(e) => setDetectiveDraft(e.target.value)} className="pixel-input flex-1 text-xs" placeholder="Mensaje privado..." /><button type="submit" className="pixel-btn text-xs px-4">ENVIAR</button></form>
            <div className="md:hidden p-3 border-t-2 border-[var(--border)] bg-[var(--card)]">
              <button onClick={() => { SFX.soundClick(); skipToVote(); }} className="pixel-btn w-full py-3" style={headFont}>VOTAR AHORA</button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  /* ═══ RENDER: VOTE ═══ */
  if (phase === "vote") {
    const unlockedEvidence = evidenceItems.filter((e) => !e.isLocked);
    const flaggedAnswers = chatMessages.filter((m) => m.type === "suspect.answer" && m.flagged);
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-4" style={bodyFont}>
        {AchievementOverlay}
        <div className="pixel-frame max-w-2xl w-full p-6 space-y-6 max-h-[90vh] overflow-y-auto pixel-scroll">
          <div className="pixel-header"><span>FASE DE VOTACIÓN</span></div>
          <div className="text-center">
            <div className="text-sm font-bold text-[var(--primary)] tracking-widest" style={headFont}>¿Es {safeRender(currentCase?.suspect.name)} culpable o inocente?</div>
            <div className="text-xs text-[var(--muted-foreground)] mt-1">Tu voto es definitivo. Revisa tu evidencia antes de decidir.</div>
          </div>

          {/* Evidence + stats summary so detectives can make an informed vote */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="pixel-frame p-2 text-center">
              <div className="text-[12px] text-[var(--muted-foreground)] tracking-wider">PREGUNTAS</div>
              <div className="text-lg font-bold text-[var(--primary)]">{questionsAsked}</div>
            </div>
            <div className="pixel-frame p-2 text-center">
              <div className="text-[12px] text-[var(--muted-foreground)] tracking-wider">ESTRÉS MÁX</div>
              <div className="text-lg font-bold text-[var(--destructive)]">{maxStress}%</div>
            </div>
            <div className="pixel-frame p-2 text-center">
              <div className="text-[12px] text-[var(--muted-foreground)] tracking-wider">ADMITIDOS</div>
              <div className="text-lg font-bold text-[var(--destructive)]">{flaggedCount}</div>
            </div>
            <div className="pixel-frame p-2 text-center">
              <div className="text-[12px] text-[var(--muted-foreground)] tracking-wider">EVIDENCIA</div>
              <div className="text-lg font-bold text-[var(--primary)]">{unlockedEvidence.length}/{evidenceItems.length}</div>
            </div>
          </div>

          {/* Evidence list */}
          {unlockedEvidence.length > 0 && (
            <div className="pixel-frame p-3">
              <div className="text-[13px] tracking-[0.18em] text-[var(--muted-foreground)] uppercase mb-2">Evidencia recolectada</div>
              <div className="space-y-2 max-h-40 overflow-y-auto pixel-scroll">
                {unlockedEvidence.map((ev) => (
                  <div key={ev.id} className="text-xs text-[var(--foreground)] flex gap-2 leading-relaxed">
                    <span className="text-[var(--primary)] shrink-0">▸</span>
                    <span><strong className="text-[var(--primary)]">{safeRender(ev.label)}:</strong> {safeRender(ev.description)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Flagged admissions — key evidence for the vote */}
          {flaggedAnswers.length > 0 && (
            <div className="pixel-frame p-3 border-[var(--destructive)]/40">
              <div className="text-[13px] tracking-[0.18em] text-[var(--destructive)] uppercase mb-2">⚠ Admisiones detectadas</div>
              <div className="space-y-1.5 max-h-32 overflow-y-auto pixel-scroll">
                {flaggedAnswers.map((m, i) => (
                  <div key={i} className="text-xs text-[var(--foreground)] italic leading-relaxed">
                    "{safeRender(m.text)}"
                  </div>
                ))}
              </div>
            </div>
          )}

          {hasVoted ? (
            <div className="text-center space-y-4">
              <div className="pixel-frame p-4">
                <div className="text-xs text-[var(--muted-foreground)] italic">Tu voto ha sido registrado.</div>
                <div className="text-2xl mt-2">{voteChoice === "guilty" ? "⚖" : "🕊"}</div>
                <div className={cn("text-sm font-bold tracking-widest mt-1", voteChoice === "guilty" ? "text-[var(--destructive)]" : "text-[#4ec9b0]")} style={headFont}>{voteChoice === "guilty" ? "CULPABLE" : "INOCENTE"}</div>
              </div>
              <div className="text-xs text-[var(--muted-foreground)] animate-pulse tracking-widest">{lobbyPlayers.length <= 1 ? "Procesando tu voto..." : `Esperando al otro detective... (${votes.length}/${requiredVotes})`}</div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => { SFX.soundClick(); setVoteChoice("guilty"); }} className={cn("p-4 text-center border-2 transition-all cursor-pointer", voteChoice === "guilty" ? "border-[var(--destructive)] bg-[var(--destructive)]/20 pixel-vote-glow" : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--destructive)]")}> <div className="text-2xl">⚖</div><div className="text-sm font-bold tracking-widest mt-2 text-[var(--destructive)]" style={headFont}>CULPABLE</div><div className="text-[12px] text-[var(--muted-foreground)] mt-1">Va a prisión</div></button>
                <button onClick={() => { SFX.soundClick(); setVoteChoice("innocent"); }} className={cn("p-4 text-center border-2 transition-all cursor-pointer", voteChoice === "innocent" ? "border-[#4ec9b0] bg-[#4ec9b0]/20 pixel-vote-glow" : "border-[var(--border)] bg-[var(--card)] hover:border-[#4ec9b0]")}><div className="text-2xl">🕊</div><div className="text-sm font-bold tracking-widest mt-2 text-[#4ec9b0]" style={headFont}>INOCENTE</div><div className="text-[12px] text-[var(--muted-foreground)] mt-1">Queda libre</div></button>
              </div>
              <div><label className="text-xs text-[var(--foreground)] tracking-wider block mb-1">RAZÓN DE TU VOTO</label><textarea value={voteReason} onChange={(e) => setVoteReason(e.target.value)} className="pixel-input w-full min-h-[80px] resize-none text-xs" placeholder="¿Por qué? Basa tu respuesta en la evidencia..." /></div>
              <button onClick={() => { SFX.soundVerdict(); handleSubmitVote(); }} disabled={!voteChoice} className={cn("w-full py-3 text-xs tracking-widest font-bold cursor-pointer", voteChoice ? (voteChoice === "guilty" ? "pixel-btn-danger" : "pixel-btn") : "pixel-btn-secondary opacity-30")} style={headFont}>REGISTRAR VOTO</button>
            </div>
          )}
        </div>
      </main>
    );
  }

  /* ═══ RENDER: VERDICT ═══ */
  if (phase === "verdict") {
    return (
      <main className={cn("min-h-screen flex flex-col items-center justify-center p-4", shakeKey > 0 && "pixel-shake")} style={bodyFont}>
        {AchievementOverlay}
        <div className="max-w-2xl w-full space-y-6 text-center">
          {loading ? (
            <div className="pixel-frame p-8 space-y-4"><div className="text-4xl">⚖</div><div className="text-sm text-[var(--primary)] tracking-widest animate-pulse" style={headFont}>LA JUEZA VALERIA CRUZ DELIBERA...</div></div>
          ) : verdict ? (
            <>
              <div className="text-xs tracking-[0.3em] text-[var(--muted-foreground)]">JUEZ VALERIA CRUZ · SALA DE JUSTICIA</div>

              {/* Decision de los detectives — grande y claro */}
              <div className="pixel-frame p-8" key={shakeKey}>
                <div className="text-xs text-[var(--muted-foreground)] tracking-wider mb-3">VEREDICTO DE LOS DETECTIVES</div>
                <div className="text-3xl mb-4">{verdict.decision === "imprisoned" ? "[CHAIN]" : "[UNLOCK]"}</div>
                <div className={cn("text-2xl md:text-3xl font-bold tracking-widest", verdict.decision === "imprisoned" ? "text-[var(--destructive)]" : "text-[#4ec9b0]")} style={headFont}>{verdict.decision === "imprisoned" ? "ENCARCELADO" : "EN LIBERTAD"}</div>
                <div className="text-xs text-[var(--muted-foreground)] mt-3 tracking-wider">{safeRender(currentCase?.suspect.name)} {verdict.decision === "imprisoned" ? "fue encontrado CULPABLE por los detectives" : "fue absuelto y puesto en LIBERTAD por los detectives"}</div>
              </div>

              {/* Recuento de votos — compacto */}
              <div className="pixel-frame p-4">
                <div className="text-xs text-[var(--muted-foreground)] mb-3 tracking-wider">RECUENTO DE VOTOS</div>
                <div className="flex justify-center gap-10">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-[var(--destructive)]" style={headFont}>{verdict.guiltyVotes}</div>
                    <div className="text-[12px] text-[var(--muted-foreground)] tracking-wider">CULPABLE</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-[#4ec9b0]" style={headFont}>{verdict.innocentVotes}</div>
                    <div className="text-[12px] text-[var(--muted-foreground)] tracking-wider">INOCENTE</div>
                  </div>
                </div>
              </div>

              {/* Razonamiento de la jueza */}
              <div className="pixel-frame p-4 text-left">
                <div className="text-xs text-[var(--primary)] mb-2 tracking-wider" style={headFont}>⚖ RAZONAMIENTO DE LA JUEZA</div>
                <p className="text-xs text-[var(--foreground)] leading-relaxed italic">"{safeRender(verdict.judgeReasoning)}"</p>
                <div className="text-[11px] text-[var(--muted-foreground)] leading-relaxed italic mt-3 pt-2 border-t border-[var(--border)]">"{safeRender(verdict.judgesComment)}"</div>
              </div>

              <div className="text-[11px] text-[var(--muted-foreground)] tracking-wider animate-pulse">¿ACERTARON O SE EQUIVOCARON? DESCÚBRELO ↓</div>
              <button onClick={() => { setPhase("revelation"); generateRevelation(); }} className="pixel-btn py-3 px-8" style={headFont}>REVELAR LA VERDAD</button>
            </>
          ) : (
            <div className="pixel-frame p-6"><div className="text-xs text-[var(--destructive)]">Error: No se pudo obtener el veredicto.</div><button onClick={() => setPhase("results")} className="pixel-btn mt-4 px-4 py-2 text-xs">CONTINUAR</button></div>
          )}
        </div>
      </main>
    );
  }

  /* ═══ RENDER: REVELATION ═══ */
  if (phase === "revelation") {
    // Map culpability enum → human-readable Spanish labels + subtitle.
    const culpabilityLabels: Record<string, { label: string; subtitle: string; color: string }> = {
      guilty:    { label: "CULPABLE",  subtitle: "Cometió el crimen.", color: "text-[var(--destructive)]" },
      innocent:  { label: "INOCENTE",  subtitle: "No tuvo nada que ver con el crimen.", color: "text-[#4ec9b0]" },
      accomplice:{ label: "CÓMPLICE",  subtitle: "Ayudó al verdadero culpable, pero no lo planeó.", color: "text-[#fbbf24]" },
      witness:   { label: "TESTIGO",   subtitle: "Solo vio o escuchó algo. No participó.", color: "text-[#60a5fa]" },
    };
    const culp = revelation ? culpabilityLabels[revelation.culpability] ?? culpabilityLabels.innocent : culpabilityLabels.innocent;

    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-4" style={bodyFont}>
        {AchievementOverlay}
        <div className="max-w-2xl w-full space-y-5 text-center">
          <div className="pixel-header"><span>LA VERDAD COMPLETA</span></div>

          {revelationLoading ? (
            <div className="pixel-frame p-8"><div className="text-sm text-[var(--primary)] animate-pulse tracking-widest">REVELANDO LA VERDAD...</div></div>
          ) : revelation && verdict ? (
            <>
              {/* BANNER GRANDE — acertaron o se equivocaron */}
              <div className={cn("pixel-frame p-6 border-2", verdict.majorityCorrect ? "border-[#4ec9b0] bg-[#4ec9b0]/5" : "border-[var(--destructive)] bg-[var(--destructive)]/5")}>
                <div className="text-3xl mb-2">{verdict.majorityCorrect ? "✓" : "✗"}</div>
                <div className={cn("text-2xl md:text-3xl font-bold tracking-widest", verdict.majorityCorrect ? "text-[#4ec9b0]" : "text-[var(--destructive)]")} style={headFont}>
                  {verdict.majorityCorrect ? "ACERTARON" : "SE EQUIVOCARON"}
                </div>
                <div className="text-xs text-[var(--muted-foreground)] mt-2 tracking-wider">
                  {verdict.majorityCorrect
                    ? "Los detectives llegaron a la conclusión correcta."
                    : "Los detectives tomaron la decisión equivocada."}
                </div>
              </div>

              {/* Responsabilidad real del sospechoso */}
              <div className="pixel-frame p-5">
                <div className="text-xs text-[var(--muted-foreground)] tracking-wider mb-3">REALIDAD SOBRE {safeRender(revelation.suspectName).toUpperCase()}</div>
                <div className={cn("text-xl md:text-2xl font-bold tracking-widest", culp.color)} style={headFont}>{culp.label}</div>
                <div className="text-xs text-[var(--muted-foreground)] mt-2 italic">{culp.subtitle}</div>
              </div>

              {/* Comparación: decisión vs realidad */}
              <div className="pixel-frame p-4">
                <div className="text-xs text-[var(--muted-foreground)] tracking-wider mb-3">RESUMEN</div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="text-left">
                    <div className="text-[11px] text-[var(--muted-foreground)] tracking-wider">DECISIÓN</div>
                    <div className={cn("font-bold tracking-wider mt-1", verdict.decision === "imprisoned" ? "text-[var(--destructive)]" : "text-[#4ec9b0]")} style={headFont}>
                      {verdict.decision === "imprisoned" ? "ENCARCELADO" : "LIBRE"}
                    </div>
                  </div>
                  <div className="text-left">
                    <div className="text-[11px] text-[var(--muted-foreground)] tracking-wider">REALIDAD</div>
                    <div className={cn("font-bold tracking-wider mt-1", culp.color)} style={headFont}>{culp.label}</div>
                  </div>
                </div>
              </div>

              {/* La verdad — texto largo */}
              <div className="pixel-frame p-5 text-left">
                <div className="text-xs text-[var(--primary)] mb-2 tracking-wider" style={headFont}>📜 LO QUE REALMENTE SUCEDIÓ</div>
                <p className="text-sm text-[var(--foreground)] leading-relaxed">{safeRender(revelation.truth)}</p>
              </div>

              {/* Coartada */}
              {revelation.alibiClaimed && revelation.alibiActual && (
                <div className="pixel-frame p-5 text-left">
                  <div className="text-xs text-[var(--primary)] mb-3 tracking-wider" style={headFont}>🎭 COARTADA</div>
                  <div className="space-y-3">
                    <div>
                      <div className="text-[11px] text-[var(--muted-foreground)] tracking-wider mb-1">LO QUE DECLARÓ</div>
                      <p className="text-xs text-[var(--foreground)] leading-relaxed italic">"{safeRender(revelation.alibiClaimed)}"</p>
                    </div>
                    <div className="border-t border-[var(--border)] pt-3">
                      <div className="text-[11px] text-[var(--destructive)] tracking-wider mb-1">LO QUE REALMENTE HACÍA</div>
                      <p className="text-xs text-[var(--foreground)] leading-relaxed italic">"{safeRender(revelation.alibiActual)}"</p>
                    </div>
                    {revelation.alibiWitnesses && revelation.alibiWitnesses.length > 0 && (
                      <div className="border-t border-[var(--border)] pt-3">
                        <div className="text-[11px] text-[var(--muted-foreground)] tracking-wider mb-1">POSIBLES TESTIGOS</div>
                        <p className="text-xs text-[var(--foreground)] leading-relaxed">{revelation.alibiWitnesses.join(", ")}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Evidencia */}
              {revelation.evidence.length > 0 && (
                <div className="pixel-frame p-5 text-left">
                  <div className="text-xs text-[var(--primary)] mb-3 tracking-wider" style={headFont}>🔍 EVIDENCIA ({revelation.evidence.length})</div>
                  <div className="space-y-2">
                    {revelation.evidence.map((ev, i) => (
                      <div key={i} className={cn("p-2 border-l-2", ev.isRedHerring ? "border-[var(--destructive)] bg-[var(--destructive)]/5" : "border-[#4ec9b0] bg-[#4ec9b0]/5")}>
                        <div className="flex items-baseline gap-2">
                          <span className={cn("text-[10px] font-bold tracking-wider px-1.5 py-0.5", ev.isRedHerring ? "bg-[var(--destructive)]/20 text-[var(--destructive)]" : "bg-[#4ec9b0]/20 text-[#4ec9b0]")}>
                            {ev.isRedHerring ? "PISTA FALSA" : "REAL"}
                          </span>
                          <span className="text-xs font-bold text-[var(--foreground)] tracking-wider">{safeRender(ev.label)}</span>
                        </div>
                        <p className="text-[12px] text-[var(--muted-foreground)] leading-relaxed mt-1">{safeRender(ev.description)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Timeline */}
              {revelation.timeline.length > 0 && (
                <div className="pixel-frame p-5 text-left">
                  <div className="text-xs text-[var(--primary)] mb-3 tracking-wider" style={headFont}>⏰ LÍNEA TEMPORAL REAL</div>
                  <div className="space-y-1.5">
                    {revelation.timeline.map((t, i) => (
                      <div key={i} className="flex gap-3 text-xs">
                        <span className="text-[var(--primary)] font-bold tracking-wider shrink-0 min-w-[55px]">{safeRender(t.time)}</span>
                        <span className="text-[var(--foreground)] leading-relaxed">{safeRender(t.event)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button onClick={() => setPhase("results")} className="pixel-btn py-3 px-8" style={headFont}>VER RESULTADOS</button>
            </>
          ) : (
            <div className="pixel-frame p-6"><div className="text-xs text-[var(--destructive)]">No se pudo generar la revelación.</div></div>
          )}
        </div>
      </main>
    );
  }

  /* ═══ RENDER: RESULTS ═══ */
  if (phase === "results") {
    const unlockedEvCount = evidenceItems.filter(e => !e.isLocked).length;
    const totalEvCount = evidenceItems.length;
    const timeUsed = totalTime > 0 ? (totalTime - timeRemaining) / totalTime : 0;
    const rating = verdict ? getDetectiveRating(verdict.majorityCorrect, questionsAsked, unlockedEvCount, totalEvCount, timeUsed) : "D";
    const ratingColors: Record<string, string> = { S: "text-yellow-300 pixel-text-glow", A: "text-[#4ec9b0]", B: "text-[var(--primary)]", C: "text-[var(--foreground)]", D: "text-[var(--muted-foreground)]" };

    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-4" style={bodyFont}>
        {AchievementOverlay}
        <div className="max-w-2xl w-full space-y-6 text-center">
          {/* Rating */}
          <div className="pixel-frame p-6">
            <div className="text-xs text-[var(--muted-foreground)] tracking-wider mb-2">CALIFICACIÓN DEL DETECTIVE</div>
            <div className={cn("text-4xl font-bold tracking-wider", ratingColors[rating] ?? "")} style={headFont}>{rating}</div>
          </div>

          {ending && (<>
            <div className={cn("text-lg md:text-xl font-bold tracking-widest", ending.isSpecial ? "text-[var(--primary)] pixel-text-glow" : "text-[var(--foreground)]")} style={headFont}>{safeRender(ending.title)}</div>
            <p className="text-sm text-[var(--foreground)] leading-relaxed max-w-lg mx-auto">{safeRender(ending.description)}</p>
            {ending.reference && <div className="text-[12px] text-[var(--muted-foreground)] italic">"{safeRender(ending.reference)}"</div>}
          </>)}

          <div className="border-t-2 border-[var(--border)]" />

          <div className="pixel-frame p-4">
            <div className="text-xs text-[var(--primary)] mb-3 tracking-wider" style={headFont}>🏆 LOGROS ({unlockedAchievements.length})</div>
            {unlockedAchievements.length === 0 ? <div className="text-xs text-[var(--muted-foreground)] italic py-4">Sin logros esta partida.</div> : (
              <div className="grid gap-2">{unlockedAchievements.map((ach) => (<div key={ach.id} className="pixel-frame p-2 flex items-center gap-3 text-left pixel-evidence-flash"><span className="text-xl">{ach.icon}</span><div><div className="text-xs font-bold text-[var(--primary)] tracking-wider">{ach.name}</div><div className="text-[13px] text-[var(--muted-foreground)]">{ach.description}</div></div></div>))}</div>
            )}
          </div>

          <div className="pixel-frame p-4">
            <div className="text-xs text-[var(--muted-foreground)] mb-2 tracking-wider">ESTADÍSTICAS</div>
            <div className="flex justify-center gap-6 text-xs">
              <div className="text-center"><div className="text-sm font-bold text-[var(--primary)]">{questionsAsked}</div><div className="text-[12px] text-[var(--muted-foreground)]">PREGUNTAS</div></div>
              <div className="text-center"><div className="text-sm font-bold text-[var(--destructive)]">{maxStress}%</div><div className="text-[12px] text-[var(--muted-foreground)]">ESTRÉS MAX</div></div>
              <div className="text-center"><div className="text-sm font-bold text-[var(--primary)]">{flaggedCount}</div><div className="text-[12px] text-[var(--muted-foreground)]">FLAGGED</div></div>
              <div className="text-center"><div className="text-sm font-bold text-[var(--foreground)]">{unlockedEvCount}/{totalEvCount}</div><div className="text-[12px] text-[var(--muted-foreground)]">EVIDENCIA</div></div>
              <div className="text-center"><div className="text-sm font-bold text-[var(--foreground)]">{formatTime(totalTime - timeRemaining)}</div><div className="text-[12px] text-[var(--muted-foreground)]">TIEMPO</div></div>
            </div>
          </div>

          <button onClick={() => { SFX.soundClick(); playAgain(); }} className="pixel-btn py-3 px-8" style={headFont}>JUGAR DE NUEVO</button>
        </div>
      </main>
    );
  }

  return <main className="min-h-screen flex items-center justify-center" style={bodyFont}><div className="pixel-frame p-6 text-center"><div className="text-xs text-[var(--muted-foreground)]">Cargando...</div></div></main>;
}
