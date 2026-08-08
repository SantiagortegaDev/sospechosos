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
  { key: "neutral", label: "NEUTRAL", emoji: "💬" },
  { key: "amenaza", label: "AMENAZA", emoji: "⚡" },
  { key: "empatia", label: "EMPATÍA", emoji: "🤝" },
  { key: "enganio", label: "ENGAÑO", emoji: "🎭" },
];

const SUSPECT_TELLS = [
  { emoji: "💧", label: "Gotas de sudor", minStress: 40 },
  { emoji: "👁️", label: "Parpadeo rápido", minStress: 50 },
  { emoji: "✊", label: "Puño cerrado", minStress: 60 },
  { emoji: "😰", label: "Respiración agitada", minStress: 70 },
  { emoji: "🫣", label: "Mirada esquiva", minStress: 80 },
  { emoji: "🤯", label: "Al borde del colapso", minStress: 90 },
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
  const [lobbyPlayers, setLobbyPlayers] = useState<
    Array<{ id: string; username: string; isHost: boolean }>
  >([]);
  const [error, setError] = useState("");
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

  /* Revelation */
  const [revelationText, setRevelationText] = useState("");
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
          const caseData = payload.case as CaseInfo;
          if (caseData) setCurrentCase(caseData);
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
      // SFX: achievement_unlock
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
        body: JSON.stringify({ suspectId: suspect.id, votes: votes.map((v) => ({ playerName: v.playerName, vote: v.vote, reason: v.reason })), conversationSummary: convSummary, stressHistory: stressSummary }),
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

  /* AI tick */
  useEffect(() => {
    if (phase !== "playing" || !currentCase) return;
    const runTick = async () => {
      if (phaseRef.current !== "playing") return;
      try {
        const historySlice = conversationHistory.slice(-20);
        const context = historySlice.map((t) => `${t.role === "detective" ? "Detective" : "Sospechoso"}: ${t.text}`).join("\n") || "La sala está en silencio.";
        const res = await fetch("/api/ai-tick", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ suspectId: currentCase.suspect.id, suspectName: currentCase.suspect.name, suspectAvatar: currentCase.suspect.avatar, systemPrompt: currentCase.suspect.systemPrompt, recentContext: context, stressLevel: stress.stress }) });
        if (!res.ok) return;
        const data = await res.json();
        if (data.skipped || !data.event) return;
        const evt = data.event;
        if (channels && sendGame) {
          try { await sendGame({ type: "ai.event", content: { type: "ai.event", suspectId: evt.suspectId, suspectName: evt.suspectName, kind: evt.kind, text: evt.text, timestamp: Date.now() } }); } catch { /* ok */ }
        }
      } catch (err) { console.error("[ai-tick] failed:", err); }
    };
    const firstTimeout = setTimeout(runTick, 5000);
    const tickInterval = setInterval(() => { if (phaseRef.current === "playing") runTick(); }, AI_TICK_MS);
    return () => { clearTimeout(firstTimeout); clearInterval(tickInterval); };
  }, [phase, currentCase, channels, sendGame, conversationHistory, stress.stress]);

  /* Check all votes in */
  useEffect(() => {
    if (votes.length >= 2 && !allVotesIn) { setAllVotesIn(true); setTimeout(() => callJudge(), 1500); }
  }, [votes.length, allVotesIn, callJudge]);

  /* ═══ HANDLERS ═══ */

  const closeTutorial = () => { localStorage.setItem(TUTORIAL_KEY, "1"); setShowTutorial(false); };

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
      // SFX: room_created
    } catch { setError("Error al crear la sala"); } finally { setLoading(false); }
  }, [username, roundTime, playerId]);

  const handleJoinRoom = useCallback(async () => {
    if (!username.trim()) { setError("Ingresa un nombre de detective"); return; }
    if (!roomCode.trim()) { setError("Ingresa el código de la sala"); return; }
    setError(""); setLoading(true);
    try {
      const res = await fetch(`/api/rooms/${roomCode.trim().toLowerCase()}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "join", playerId: playerId, username: username.trim() }) });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      const newSession: Session = { username: username.trim(), roomCode: data.code, isHost: false };
      saveSession(newSession); setSession(newSession); setRoomCode(data.code);
      setLobbyPlayers((prev) => [...prev, { id: playerId, username: username.trim(), isHost: false }]);
      setPhase("lobby");
      // SFX: room_joined
    } catch { setError("Error al unirse a la sala"); } finally { setLoading(false); }
  }, [username, roomCode, playerId]);

  const handleJoinByLink = useCallback(async () => { await handleJoinRoom(); }, [handleJoinRoom]);

  const handleStartGame = useCallback(async () => {
    if (!session?.isHost || !channels) return;
    try { await fetch(`/api/rooms/${session.roomCode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start" }) }); } catch { /* ok */ }
    setPhase("generating_case");
    // SFX: game_start
  }, [session, channels]);

  const handleCaseReady = useCallback(async (generated: GeneratedCase) => {
    rememberGender(generated.seed, generated.suspect.gender);
    const caseInfo = adaptGeneratedCase(generated);
    setCurrentCase(caseInfo);
    // Initialize evidence items
    if (caseInfo.evidence && caseInfo.evidence.length > 0) {
      setEvidenceItems(caseInfo.evidence.map(e => ({ ...e, isLocked: !!e.unlockTopic })));
    }
    try { await sendGame({ type: "game.start", content: { type: "game.start", case: caseInfo } }); } catch { /* ok */ }
    setPhase("case_intro"); setCaseIntroStep(0);
    // SFX: case_ready
  }, [sendGame]);

  const handleStartInterrogation = useCallback(() => {
    if (!currentCase) return;
    setStress({ stress: currentCase.suspect.baseline.stress, confidence: currentCase.suspect.baseline.confidence, hostility: currentCase.suspect.baseline.hostility });
    setNervousness(25 + Math.random() * 20);
    setTimeRemaining(roundTime * 60);
    setTotalTime(roundTime * 60);
    setChatMessages([]); setDetectiveMessages([]); setConversationHistory([]);
    setQuestionsAsked(0); setFlaggedCount(0); setMaxStress(currentCase.suspect.baseline.stress);
    setSelectedEvidence(null); setTechnique("neutral");
    setPhase("playing");
    // SFX: interrogation_start
  }, [currentCase, roundTime]);

  const handleInterrogate = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatDraft.trim();
    if (!text || pending || !currentCase || !session) return;
    setChatDraft(""); setPending(true); setQuestionsAsked((prev) => prev + 1);
    // SFX: send_question

    const qMsg: GameMessage = { type: "detective.question", senderType: "detective", senderId: playerId, senderName: session.username, text, timestamp: Date.now() };
    setChatMessages((prev) => [...prev.slice(-80), qMsg]);

    const newTurn: ConversationTurn = { role: "detective", text, detectiveName: session.username, timestamp: Date.now() };
    try { await sendGame({ type: "detective.question", content: qMsg }); } catch { /* ok */ }

    // Check for evidence unlocks
    const qLower = text.toLowerCase();
    setEvidenceItems((prev) => prev.map(ev => {
      if (ev.isLocked && ev.unlockTopic) {
        try { if (new RegExp(ev.unlockTopic, "i").test(qLower)) { return { ...ev, isLocked: false }; } } catch { /* invalid regex */ }
      }
      return ev;
    }));

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
        history: conversationHistory.slice(-20),
        previousStress: stress,
      };
      if (selectedEvidence) { body.presentedEvidence = { label: selectedEvidence.label, description: selectedEvidence.description }; }
      if (technique !== "neutral") { body.technique = technique; }

      const res = await fetch("/api/interrogate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const errBody = await res.json().catch(() => ({})); throw new Error(errBody.error || `HTTP ${res.status}`); }
      const data = await res.json();

      const aMsg: GameMessage = { type: "suspect.answer", senderType: "suspect", senderId: currentCase.suspect.id, senderName: currentCase.suspect.name, text: data.answer?.text ?? "...", timestamp: Date.now() };
      setChatMessages((prev) => [...prev.slice(-80), aMsg]);
      try { await sendGame({ type: "suspect.answer", content: aMsg }); } catch { /* ok */ }

      setConversationHistory((prev) => [...prev.slice(-40), newTurn, { role: "suspect", text: data.answer?.text ?? "", timestamp: Date.now() }]);

      if (data.stress) {
        setStress(data.stress);
        if (data.stress.stress > maxStress) setMaxStress(data.stress.stress);
      }
      if (data.answer?.flagged) { setFlaggedCount((prev) => prev + 1); unlockAchievement("gotcha"); }
      if (questionsAsked === 0) unlockAchievement("first_blood");
      if (data.stress?.stress >= 90) unlockAchievement("pressure_cooker");
      if (questionsAsked + 1 >= 20) unlockAchievement("cross_examine");

      setSelectedEvidence(null);
      setTechnique("neutral");
      // SFX: suspect_answer
    } catch (err) { console.error("[interrogate] failed:", err); setError("Error en la interrogación"); } finally { setPending(false); }
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
    // SFX: vote_cast
  }, [voteChoice, voteReason, session, playerId, sendGame]);

  const playAgain = useCallback(() => {
    clearSession(); setSession(null); setRoomCode(""); setUsername(""); setCurrentCase(null);
    setChatMessages([]); setDetectiveMessages([]); setVotes([]); setHasVoted(false);
    setVerdict(null); setEnding(null); setUnlockedAchievements([]);
    setTimeRemaining(0); setTotalTime(0); setEvidenceItems([]);
    setRevelationText("");
    setPhase("welcome");
  }, []);

  const leaveRoom = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (delibTimerRef.current) clearInterval(delibTimerRef.current);
    clearSession(); setSession(null); setRoomCode(""); setUsername(""); setPhase("welcome");
  }, []);

  const copyInviteLink = useCallback(() => { navigator.clipboard.writeText(`${window.location.origin}?room=${roomCode}`).catch(() => {}); }, [roomCode]);

  const generateRevelation = useCallback(async () => {
    if (!currentCase) return;
    setRevelationLoading(true);
    try {
      const res = await fetch("/api/generate-case", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seed: currentCase.id.replace("gen_", "") }) });
      if (res.ok) {
        const gen = await res.json();
        const s = gen.suspect;
        let rev = `=== LA VERDAD COMPLETA ===\n\n`;
        rev += `Sospechoso: ${s.name}\n`;
        rev += `Responsabilidad: ${s.culpability === "guilty" ? "CULPABLE" : s.culpability === "innocent" ? "INOCENTE" : s.culpability === "accomplice" ? "CÓMPLICE" : "TESTIGO"}\n\n`;
        rev += `LO QUE REALMENTE SUCEDIÓ:\n${s.truth}\n\n`;
        if (s.alibi) { rev += `COARTADA (MENTIRA): ${s.alibi.claimed}\nCOARTADA (REAL): ${s.alibi.actual}\n\n`; }
        if (gen.evidence) {
          rev += `EVIDENCIA:\n`;
          for (const ev of gen.evidence) { rev += `  ${ev.isRedHerring ? "🔴 FALSA" : "🟢 REAL"}: ${ev.label} — ${ev.description}\n`; }
          rev += "\n";
        }
        if (gen.timeline) {
          rev += `LÍNEA TEMPORAL REAL:\n`;
          for (const t of gen.timeline) { rev += `  [${t.time}] ${t.event}\n`; }
        }
        setRevelationText(rev);
      }
    } catch { setRevelationText("No se pudo generar la revelación."); }
    finally { setRevelationLoading(false); }
  }, [currentCase]);

  /* ═══ SHARED UI ═══ */

  const bodyFont = { fontFamily: "var(--font-pixel-body), monospace" as const };
  const headFont = { fontFamily: "var(--font-pixel), monospace" as const };

  const ErrorBanner = error ? (
    <div className="border-2 border-[var(--destructive)] bg-[var(--destructive)]/10 p-2 text-xs text-[var(--destructive)] mb-4" style={bodyFont}>{error}</div>
  ) : null;

  const BackBtn = ({ target, label = "◂ VOLVER" }: { target: GamePhase; label?: string }) => (
    <button onClick={() => { setPhase(target); setError(""); }} className="pixel-btn-secondary w-full py-2 text-xs" style={bodyFont}>{label}</button>
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
    const marks = [3, 5, 8, 10, 12, 15];
    const fillPercent = ((value - 3) / (15 - 3)) * 100;
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs text-[var(--foreground)] tracking-wider font-bold">TIEMPO DE RONDA</label>
          <div className="pixel-frame px-3 py-1">
            <span className="text-lg font-bold text-[var(--primary)] transition-all duration-150" style={headFont}>{value}</span>
            <span className="text-[10px] text-[var(--muted-foreground)] ml-1">MIN</span>
          </div>
        </div>
        <input
          type="range"
          min={3}
          max={15}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          disabled={disabled}
          className="pixel-slider w-full"
          style={{ '--slider-fill': `${fillPercent}%` } as React.CSSProperties}
        />
        <div className="flex justify-between px-0.5">
          {marks.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => !disabled && onChange(m)}
              disabled={disabled}
              className={cn(
                "text-[9px] transition-all duration-150 cursor-pointer px-1",
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
          <button onClick={closeTutorial} className="pixel-btn w-full py-3 text-xs tracking-widest font-bold" style={headFont}>ENTENDIDO ✓</button>
        </div>
      </div>
    );
  }

  /* ═══ RENDER: WELCOME ═══ */
  if (phase === "welcome") {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center cursor-pointer select-none relative"
        onClick={() => { setWelcomeFlash(true); setTimeout(() => setPhase("create_or_join"), 600); }}>
        {welcomeFlash && <div className="fixed inset-0 bg-white z-50 pointer-events-none pixel-screen-flash" />}
        <div className={cn("text-center space-y-8 relative z-10 transition-all duration-700", welcomeMounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6")}>
          <img src="/sospechosos-logo.png" alt="LOS SOSPECHOSOS" className="mx-auto w-full max-w-xl pixel-logo pixel-float" draggable={false} />
          <div className="text-xs text-white/60 tracking-[0.3em] pixel-breathe" style={bodyFont}>LA VERDAD ESTA EN TUS MANOS</div>
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
            <button onClick={() => { setPhase("create"); setUsername(""); setError(""); }} className="pixel-frame pixel-frame-interactive p-4 text-left">
              <div className="text-[var(--primary)] font-bold tracking-widest text-sm" style={headFont}>CREAR SALA</div>
              <div className="text-[var(--muted-foreground)] text-xs mt-1" style={bodyFont}>Genera un código para que otro detective se una</div>
            </button>
            <button onClick={() => { setPhase("join"); setUsername(""); setRoomCode(""); setError(""); }} className="pixel-frame pixel-frame-interactive p-4 text-left">
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
        <div className="pixel-frame max-w-md w-full p-6 space-y-5 pixel-scale-in" style={bodyFont}>
          <div className="pixel-header"><span>CREAR SALA</span></div>
          {ErrorBanner}
          <div>
            <label className="text-xs text-[var(--foreground)] tracking-wider block mb-1">TU NOMBRE DE DETECTIVE</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} maxLength={20} className="pixel-input w-full" placeholder="ej: Holmes" autoFocus />
          </div>
          <TimeSlider value={roundTime} onChange={setRoundTime} />
          <button onClick={handleCreateRoom} disabled={loading || !username.trim()} className="pixel-btn w-full py-3" style={headFont}>{loading ? "CREANDO SALA..." : "CREAR SALA"}</button>
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
          <button onClick={handleJoinRoom} disabled={loading || !username.trim() || !roomCode.trim()} className="pixel-btn w-full py-3" style={headFont}>{loading ? "VERIFICANDO..." : "UNIRSE"}</button>
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
          <button onClick={handleJoinByLink} disabled={loading || !username.trim()} className="pixel-btn w-full py-3" style={headFont}>{loading ? "UNIÉNDOSE..." : "ENTRAR A LA SALA"}</button>
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
            <button onClick={copyInviteLink} className="text-xs text-[var(--muted-foreground)] hover:text-[var(--primary)] mt-2 transition-colors">📋 COPIAR LINK DE INVITACIÓN</button>
          </div>
          <div>
            <div className="text-xs text-[var(--foreground)] tracking-wider mb-2">DETECTIVES EN SALA ({lobbyPlayers.length}/2)</div>
            {lobbyPlayers.map((p) => (
              <div key={p.id} className="flex items-center gap-2 py-1 border-b border-[var(--border)] text-xs">
                <span className="text-[var(--primary)]">{p.isHost ? "👑" : "🔍"}</span>
                <span className={cn(p.isHost ? "text-[var(--primary)] font-bold" : "text-[var(--foreground)]")}>{p.username}</span>
                {p.isHost && <span className="text-[9px] text-[var(--muted-foreground)] ml-auto tracking-wider">ANFITRIÓN</span>}
              </div>
            ))}
          </div>
          <TimeSlider value={roundTime} onChange={setRoundTime} disabled={!session?.isHost} />
          {session?.isHost && <button onClick={handleStartGame} className="pixel-btn w-full py-3" style={headFont}>COMENZAR</button>}
          {!session?.isHost && <div className="text-center text-xs text-[var(--muted-foreground)] italic animate-pulse">Esperando al anfitrión para empezar...</div>}
          <button onClick={leaveRoom} className="pixel-btn-danger w-full py-2 text-xs">SALIR DE LA SALA</button>
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
    const c = currentCase; const s = c.suspect; const totalSteps = 6;
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-6 select-none pixel-fade-in">
        {AchievementOverlay}
        <div className="max-w-2xl w-full space-y-6 text-center">
          {caseIntroStep >= 0 && (
            <div className={cn("transition-all duration-500", caseIntroStep === 0 ? "opacity-100" : "opacity-50")}>
              <div className="flex items-center justify-center gap-3 mb-2">{c.difficulty && <DifficultyBadge difficulty={c.difficulty} />}</div>
              <h1 className="text-2xl md:text-4xl font-bold text-[var(--primary)] tracking-widest" style={headFont}>{c.title}</h1>
              <div className="text-xs text-[var(--muted-foreground)] mt-2" style={bodyFont}>{c.subtitle}</div>
            </div>
          )}
          {caseIntroStep >= 1 && (
            <div className={cn("transition-all duration-500", caseIntroStep === 1 ? "opacity-100" : "opacity-50")}>
              <div className="text-sm text-[var(--primary)] tracking-widest" style={bodyFont}>📅 {c.date}</div>
              <div className="text-xs text-[var(--muted-foreground)] tracking-widest mt-1" style={bodyFont}>📍 {c.location}</div>
              <div className="text-xs text-[var(--destructive)] tracking-wider mt-2" style={bodyFont}>⚖️ {c.stakes}</div>
            </div>
          )}
          {caseIntroStep >= 2 && (
            <div className={cn("pixel-frame p-4 transition-all duration-500", caseIntroStep === 2 ? "opacity-100" : "opacity-50")}>
              <p className="text-sm text-[var(--foreground)] leading-relaxed text-left" style={bodyFont}>{c.briefing}</p>
            </div>
          )}
          {caseIntroStep >= 3 && (
            <div className={cn("pixel-frame p-4 transition-all duration-500", caseIntroStep === 3 ? "opacity-100" : "opacity-50")}>
              <div className="text-xs text-[var(--foreground)] tracking-wider mb-3" style={bodyFont}>SOSPECHOSO</div>
              <div className="flex items-center gap-4">
                <div className="text-4xl">{s.avatar}</div>
                <div className="text-left">
                  <div className="text-sm font-bold text-[var(--primary)] tracking-wider" style={headFont}>{s.name}</div>
                  <div className="text-xs text-[var(--muted-foreground)] mt-1" style={bodyFont}>{s.age ? `${s.age} años · ` : ""}{s.role}</div>
                </div>
              </div>
            </div>
          )}
          {caseIntroStep >= 4 && (
            <div className={cn("pixel-frame p-4 text-left transition-all duration-500", caseIntroStep === 4 ? "opacity-100" : "opacity-50")}>
              <div className="text-xs text-[var(--foreground)] tracking-wider mb-3" style={bodyFont}>HECHOS CONOCIDOS</div>
              <ul className="space-y-1">{s.knownFacts.map((f, i) => <li key={i} className="text-xs text-[var(--foreground)] flex gap-2" style={bodyFont}><span className="text-[var(--primary)] shrink-0">•</span>{f}</li>)}</ul>
            </div>
          )}
          {caseIntroStep >= totalSteps - 1 ? (
            <button onClick={handleStartInterrogation} className="pixel-btn py-3 px-8 mt-4" style={headFont}>REVISAR EVIDENCIA ▶</button>
          ) : (
            <button onClick={() => setCaseIntroStep((prev) => Math.min(prev + 1, totalSteps - 1))} className="pixel-btn-secondary py-2 px-6 mt-4" style={bodyFont}>CONTINUAR &gt;</button>
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
                  {evidenceItems.map((ev) => (
                    <div key={ev.id} className={cn("pixel-frame p-3 transition-all", ev.isLocked && "opacity-40")}>
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{ev.isRedHerring ? "🔴" : ev.isLocked ? "🔒" : "📄"}</span>
                        <span className="text-xs font-bold text-[var(--foreground)] tracking-wider">{ev.label}</span>
                        {ev.isRedHerring && <span className="pixel-badge danger text-[8px]">PISTA FALSA</span>}
                      </div>
                      {!ev.isLocked && <div className="text-xs text-[var(--muted-foreground)] mt-1">{ev.description}</div>}
                      {ev.isLocked && <div className="text-xs text-[var(--muted-foreground)] mt-1 italic">Bloqueada — pregunta sobre el tema relacionado para desbloquear</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {currentCase.timeline && currentCase.timeline.length > 0 && (
              <div className="pixel-frame p-4">
                <div className="text-xs text-[var(--primary)] tracking-wider font-bold mb-3">LÍNEA TEMPORAL</div>
                <div className="space-y-2">
                  {currentCase.timeline.map((t, i) => (
                    <div key={i} className="flex gap-3 text-xs">
                      <span className="text-[var(--primary)] font-bold shrink-0">[{t.time}]</span>
                      <span className={t.isPublic ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)] italic"}>{t.event}</span>
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
                <div key={i} className="text-xs"><span className="text-[var(--primary)] font-bold">[{dm.detectiveName}]:</span> <span className="text-[var(--foreground)]">{dm.text}</span></div>
              ))}
              {detectiveMessages.length === 0 && <div className="text-xs text-[var(--muted-foreground)] italic text-center py-4">Discute la evidencia con tu compañero...</div>}
            </div>
            <form onSubmit={handleSendDetective} className="border-t-2 border-[var(--border)] p-3 flex gap-2 shrink-0">
              <input value={detectiveDraft} onChange={(e) => setDetectiveDraft(e.target.value)} className="pixel-input flex-1 text-xs" placeholder="Mensaje privado..." />
              <button type="submit" className="pixel-btn text-[8px] px-2">ENVIAR</button>
            </form>
          </aside>
        </div>

        <div className="p-3 border-t-2 border-[var(--border)] bg-[var(--card)]">
          <button onClick={handleStartInterrogation} className="pixel-btn w-full py-3" style={headFont}>COMENZAR INTERROGATORIO ▶</button>
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
          <div className="flex justify-between text-[9px]" style={bodyFont}>
            <span className="text-[var(--foreground)]">{emoji} {label}</span>
            <span className={cn(
              value >= 75 && (label !== "CONFIANZA") ? "text-[var(--destructive)] font-bold" : "",
              value >= 75 && label === "CONFIANZA" ? "text-[#4ec9b0] font-bold" : "",
              value < 25 && label === "CONFIANZA" ? "text-[var(--destructive)] font-bold" : "",
            )}>{text} <span className="text-[7px] opacity-60">{trend}</span></span>
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
                onClick={() => setRightTab(tab.key)}
                className={cn(
                  "px-2.5 py-2 text-[9px] tracking-wider transition-all cursor-pointer",
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
                  <div className="text-[10px] tracking-[0.18em] text-[var(--muted-foreground)] uppercase mb-2">Resumen del caso</div>
                  <p className="text-xs text-[var(--foreground)] leading-relaxed">{currentCase.briefing}</p>
                  {currentCase.difficulty && <div className="mt-3"><DifficultyBadge difficulty={currentCase.difficulty} /></div>}
                </div>
                <div className="pixel-frame p-3">
                  <div className="text-[10px] tracking-[0.18em] text-[var(--muted-foreground)] uppercase mb-2">Sospechoso</div>
                  <div className="text-xs text-[var(--foreground)] flex items-center gap-2">
                    <span className="text-lg">{suspect.avatar}</span>
                    <div>
                      <div className="font-bold">{suspect.name}</div>
                      <div className="text-[10px] text-[var(--muted-foreground)]">{suspect.role}</div>
                    </div>
                  </div>
                </div>
                <div className="pixel-frame p-3">
                  <div className="text-[10px] tracking-[0.18em] text-[var(--muted-foreground)] uppercase mb-2">Hechos conocidos</div>
                  <div className="space-y-2">
                    {suspect.knownFacts.map((f, i) => (
                      <div key={i} className="text-xs text-[var(--foreground)] flex gap-2 leading-relaxed">
                        <span className="text-[var(--primary)] shrink-0">▸</span>
                        <span>{f}</span>
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
                      <div key={ev.id} className={cn("pixel-frame p-2 transition-all cursor-pointer hover:translate-y-[-2px]", ev.isLocked && "opacity-40", selectedEvidence?.id === ev.id && "pixel-frame-active")} onClick={() => !ev.isLocked && setSelectedEvidence(ev === selectedEvidence ? null : ev)}>
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{ev.isRedHerring ? "🔴" : ev.isLocked ? "🔒" : "📄"}</span>
                          <span className="text-[10px] font-bold text-[var(--foreground)] tracking-wider">{ev.label}</span>
                        </div>
                        {!ev.isLocked && <div className="text-[10px] text-[var(--muted-foreground)] mt-1">{ev.description}</div>}
                      </div>
                    ))}
                  </div>
                )}
                {selectedEvidence && !selectedEvidence.isLocked && (
                  <div className="mt-3 border-t-2 border-[var(--border)] pt-3">
                    <div className="text-[10px] text-[var(--destructive)] tracking-wider mb-2">EVIDENCIA SELECCIONADA PARA PRESENTAR</div>
                    <div className="pixel-frame-active p-2 mb-2"><div className="text-xs text-[var(--foreground)]">{selectedEvidence.description}</div></div>
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
                <div className="flex items-center justify-between"><div className="text-xs text-[var(--primary)] font-bold">LÍNEA TEMPORAL</div><button onClick={addTimelineEntry} className="pixel-btn-secondary text-[8px] py-1 px-2">+ AGREGAR</button></div>
                {timelineEntries.length === 0 ? <div className="text-xs text-[var(--muted-foreground)] italic py-4 text-center">Sin eventos</div> : (
                  <div className="space-y-2">{timelineEntries.map((entry) => (<div key={entry.id} className="pixel-frame p-2"><div className="text-[10px] text-[var(--primary)] font-bold tracking-wider">{entry.label}</div><div className="text-xs text-[var(--foreground)] mt-0.5">{entry.description}</div><div className="text-[8px] text-[var(--muted-foreground)] mt-1">— {entry.addedByName}</div></div>))}</div>
                )}
              </div>
            )}
            {rightTab === "detectives" && (
              <div className="flex flex-col h-64">
                <div className="text-xs text-[var(--primary)] font-bold mb-2">CHAT PRIVADO — DETECTIVES</div>
                <div className="flex-1 pixel-scroll overflow-y-auto space-y-2 mb-2">
                  {detectiveMessages.map((dm, i) => (<div key={i} className="text-xs"><span className="text-[var(--primary)] font-bold">[{dm.detectiveName}]:</span> <span className="text-[var(--foreground)]">{dm.text}</span></div>))}
                  {detectiveMessages.length === 0 && <div className="text-xs text-[var(--muted-foreground)] italic text-center py-4">Sin mensajes privados</div>}
                </div>
                <form onSubmit={handleSendDetective} className="flex gap-1"><input value={detectiveDraft} onChange={(e) => setDetectiveDraft(e.target.value)} className="pixel-input flex-1 text-xs" placeholder="Mensaje privado..." /><button type="submit" className="pixel-btn text-[8px] px-2">ENVIAR</button></form>
              </div>
            )}
            {rightTab === "herramientas" && (
              <div className="space-y-2">
                <div className="text-xs text-[var(--primary)] font-bold mb-2">TÉCNICA DE INTERROGACIÓN</div>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {TECHNIQUES.map((t) => (
                    <button key={t.key} onClick={() => setTechnique(t.key)} className={cn("pixel-frame p-2 text-center transition-all cursor-pointer", technique === t.key && "pixel-frame-active")}>
                      <div className="text-sm">{t.emoji}</div>
                      <div className="text-[8px] text-[var(--foreground)] tracking-wider">{t.label}</div>
                    </button>
                  ))}
                </div>
                <div className="text-xs text-[var(--primary)] font-bold mb-2">PREGUNTAS RÁPIDAS</div>
                {QUICK_QUESTIONS.map((q) => (<button key={q.label} onClick={() => insertQuickQuestion(q.text)} className="pixel-frame w-full p-2 text-left hover:bg-[var(--primary)]/10 transition-all cursor-pointer"><div className="text-[9px] text-[var(--primary)] tracking-wider font-bold">{q.label.toUpperCase()}</div><div className="text-xs text-[var(--foreground)] mt-0.5">"{q.text}"</div></button>))}
              </div>
            )}
          </div>
        </div>
      );
    };

    return (
      <div className="min-h-screen flex flex-col pixel-fade-in" style={bodyFont}>
        {AchievementOverlay}
        <header className="border-b border-[var(--border)] bg-[var(--card)] px-3 py-2 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-[var(--primary)] pixel-live-dot" />
            <span className="text-[9px] tracking-wider text-[var(--foreground)]">INTERROGACIÓN EN CURSO</span>
          </div>
          <div className="flex items-center gap-3">
            <PhaseIndicator current="playing" />
            <span className="pixel-badge text-[8px]">PREGUNTAS: {questionsAsked}</span>
            <span className={cn("text-xs font-bold", timeRemaining <= 60 ? "text-[var(--destructive)] pixel-timer-warning" : "text-[var(--primary)]")} style={headFont}>⏱ {formatTime(timeRemaining)}</span>
            <button onClick={enterDeliberation} className="pixel-btn-secondary text-[8px] py-1 px-2">DELIBERAR</button>
          </div>
        </header>

        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* LEFT: Suspect panel */}
          <aside className="hidden md:flex flex-col w-72 border-r-2 border-[var(--border)] bg-[var(--card)] shrink-0">
            <div className="pixel-header"><span>SOSPECHOSO</span></div>
            <div className="p-5 space-y-5 flex-1 overflow-y-auto pixel-scroll">
              {/* Portrait + identity card */}
              <div className="text-center">
                <div className={cn("flex justify-center mb-3", portraitShake && "pixel-portrait-shake")} style={{ filter: portraitTint }}>
                  <SuspectPortrait seed={currentCase?.id?.replace("gen_", "") ?? "default"} gender={recallGender(currentCase?.id?.replace("gen_", "") ?? "default")} avatar={suspect.avatar} size="lg" />
                </div>
                <div className="text-base font-bold text-[var(--primary)] tracking-wider" style={headFont}>{suspect.name}</div>
                <div className="text-xs text-[var(--muted-foreground)] mt-1">{suspect.age ? `${suspect.age} años · ` : ""}{suspect.role}</div>
                {/* Suspect tells */}
                {activeTells.length > 0 && (
                  <div className="flex justify-center gap-1 mt-2">
                    {activeTells.slice(-2).map((t) => <span key={t.id} className="text-lg pixel-evidence-flash" title={t.label}>{t.emoji}</span>)}
                  </div>
                )}
              </div>

              {/* Stress telemetry — thicker bars, more breathing room */}
              <div className="pixel-frame p-3 space-y-3">
                <div className="text-[10px] tracking-[0.18em] text-[var(--muted-foreground)] uppercase">Telemetría</div>
                <StressBar label="ESTRÉS" value={stress.stress} colorClass="stress" emoji="🔵" />
                <StressBar label="NERVIOSISMO" value={nervousness} colorClass="nervousness" emoji="🟡" />
                <StressBar label="CONFIANZA" value={stress.confidence} colorClass="confidence" emoji="🔷" />
                <StressBar label="HOSTILIDAD" value={stress.hostility} colorClass="hostility" emoji="🔺" />
              </div>

              {/* Known facts — card-based, more readable */}
              <div className="pixel-frame p-3">
                <div className="text-[10px] tracking-[0.18em] text-[var(--muted-foreground)] uppercase mb-2">Hechos conocidos</div>
                <div className="space-y-2 pixel-scroll max-h-40 overflow-y-auto">
                  {suspect.knownFacts.map((f, i) => (
                    <div key={i} className="text-xs text-[var(--foreground)] flex gap-2 leading-relaxed">
                      <span className="text-[var(--primary)] shrink-0">▸</span>
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </aside>

          {/* CENTER: Chat */}
          <section className={cn("flex-1 flex flex-col min-h-0", mobileTab !== "chat" && "hidden md:flex")}>
            <div className="flex-1 overflow-y-auto pixel-scroll p-4 space-y-3">
              {chatMessages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center space-y-6 pixel-fade-in">
                  <div className={cn("flex justify-center", portraitShake && "pixel-portrait-shake")} style={{ filter: portraitTint }}>
                    <SuspectPortrait seed={currentCase?.id?.replace("gen_", "") ?? "default"} gender={recallGender(currentCase?.id?.replace("gen_", "") ?? "default")} avatar={suspect.avatar} size="xl" />
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm font-bold text-[var(--primary)] tracking-wider" style={headFont}>{suspect.name}</div>
                    <div className="text-[10px] text-[var(--muted-foreground)] tracking-wider">{suspect.role}</div>
                  </div>
                  <div className="pixel-frame p-3 max-w-xs">
                    <div className="text-[10px] text-[var(--foreground)] leading-relaxed" style={bodyFont}>
                      El sospechoso espera en la sala de interrogación. Formula tu primera pregunta para comenzar.
                    </div>
                  </div>
                  <div className="text-[8px] text-[var(--muted-foreground)] opacity-50 tracking-wider">
                    Selecciona una técnica de interrogación y haz tu pregunta
                  </div>
                </div>
              )}
              {chatMessages.map((msg, i) => {
                const isDetective = msg.senderType === "detective";
                const isSystem = msg.senderType === "system";
                return (
                  <div key={`chat-${i}`} className={cn("flex flex-col", isDetective ? "items-start" : "items-end", isSystem && "items-center")}>
                    {isSystem && <div className="text-[9px] text-[var(--muted-foreground)] italic text-center px-4 py-1 border border-[var(--border)] bg-[var(--accent)]">{msg.text}</div>}
                    {isDetective && !isSystem && (
                      <div className="max-w-[80%]">
                        <div className="text-[9px] text-[var(--primary)] tracking-wider mb-0.5">[Detective {msg.senderName} pregunta]</div>
                        <div className="pixel-frame p-2.5 text-xs text-[var(--foreground)] border-l-2 border-l-[var(--primary)]">{msg.text}</div>
                      </div>
                    )}
                    {msg.senderType === "suspect" && (
                      <div className="max-w-[80%] pixel-message-in">
                        <div className="text-[9px] text-[var(--muted-foreground)] tracking-wider mb-0.5 text-right flex items-center justify-end gap-2">
                          <span className="pixel-badge">SOSPECHOSO</span>
                          <span>[{msg.senderName || "SOSPECHOSO"}]</span>
                        </div>
                        <div className={cn("pixel-frame p-2.5 text-xs", msg.type === "suspect.autonomous" ? "text-[var(--muted-foreground)] italic border-r-2 border-r-[var(--border)]" : "text-[var(--foreground)] border-r-2 border-r-[#2a2a44]")}>
                          {msg.type === "suspect.autonomous" && <span className="text-[8px] text-[var(--muted-foreground)] tracking-wider block mb-1">*pensamiento autónomo*</span>}
                          <TypewriterText text={msg.text} speed={22} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {pending && <div className="flex justify-end"><div className="pixel-frame p-2.5 text-xs text-[var(--muted-foreground)]"><TypingIndicator label="El sospechoso está respondiendo" /></div></div>}
              <div ref={chatEndRef} />
            </div>
            <form onSubmit={handleInterrogate} className="border-t-2 border-[var(--border)] bg-[var(--card)] p-3 flex gap-2 shrink-0">
              {selectedEvidence && <div className="flex items-center gap-1 px-2 border border-[var(--destructive)] bg-[var(--destructive)]/10"><span className="text-[8px] text-[var(--destructive)]">📎 {selectedEvidence.label}</span><button type="button" onClick={() => setSelectedEvidence(null)} className="text-[var(--destructive)] hover:text-white text-xs">✕</button></div>}
              <input ref={chatInputRef} value={chatDraft} onChange={(e) => setChatDraft(e.target.value)} className="pixel-input flex-1 text-xs" placeholder={selectedEvidence ? "Presentando evidencia..." : technique !== "neutral" ? `[${technique.toUpperCase()}] Pregunta al sospechoso...` : "Pregunta al sospechoso..."} disabled={pending} />
              <button type="submit" disabled={pending || !chatDraft.trim()} className="pixel-btn text-xs px-4">{pending ? "..." : "ENVIAR"}</button>
            </form>
          </section>

          {/* RIGHT: Tabbed panel */}
          <aside className="hidden md:flex flex-col w-80 border-l-2 border-[var(--border)] bg-[var(--card)] shrink-0"><RightTabs /></aside>

          {/* MOBILE: Suspect panel */}
          <div className={cn("md:hidden flex-1 overflow-y-auto pixel-scroll p-4", mobileTab !== "sospechoso" && "hidden")}>
            <div className="pixel-frame p-4 space-y-4">
              <div className="text-center">
                <div className={cn("flex justify-center mb-3", portraitShake && "pixel-portrait-shake")} style={{ filter: portraitTint }}><SuspectPortrait seed={currentCase?.id?.replace("gen_", "") ?? "default"} gender={recallGender(currentCase?.id?.replace("gen_", "") ?? "default")} avatar={suspect.avatar} size="lg" /></div>
                <div className="text-sm font-bold text-[var(--primary)] tracking-wider" style={headFont}>{suspect.name}</div>
                <div className="text-xs text-[var(--muted-foreground)] mt-1">{suspect.age ? `${suspect.age} años · ` : ""}{suspect.role}</div>
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
          {[{ key: "chat" as const, label: "💬 CHAT" }, { key: "sospechoso" as const, label: `${suspect.avatar} SOSPECHOSO` }, { key: "panel" as const, label: "📋 PANEL" }].map((tab) => (
            <button key={tab.key} onClick={() => setMobileTab(tab.key)} className={cn("flex-1 py-2 text-[8px] tracking-wider transition-colors cursor-pointer", mobileTab === tab.key ? "text-[var(--primary)] bg-[var(--primary)]/5 border-b-2 border-[var(--primary)]" : "text-[var(--muted-foreground)]")} style={bodyFont}>{tab.label}</button>
          ))}
        </div>
      </div>
    );
  }

  /* ═══ RENDER: DELIBERATION ═══ */
  if (phase === "deliberation") {
    const timeOk = DELIBERATION_SECONDS - delibTimeRemaining >= 30;
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
              <div className="border-t border-[var(--border)] pt-2"><div className="text-xs text-[var(--foreground)] mb-1">SOSPECHOSO</div><div className="text-xs text-[var(--foreground)]">{currentCase?.suspect.avatar} {currentCase?.suspect.name} — {currentCase?.suspect.role}</div></div>
            </div>
            {(timeOk || delibTimeRemaining <= 0) && <button onClick={skipToVote} className="pixel-btn w-full py-3 mt-auto" style={headFont}>VOTAR AHORA ▶</button>}
          </aside>
          <section className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto pixel-scroll p-4 space-y-3">
              {detectiveMessages.length === 0 && <div className="text-center text-xs text-[var(--muted-foreground)] italic py-8">Discute tus conclusiones...</div>}
              {detectiveMessages.map((dm, i) => (<div key={i} className="flex flex-col items-start"><div className="text-[9px] text-[var(--primary)] tracking-wider">[{dm.detectiveName}]</div><div className="pixel-frame p-2.5 text-xs text-[var(--foreground)] max-w-[80%]">{dm.text}</div></div>))}
              <div ref={chatEndRef} />
            </div>
            <form onSubmit={handleSendDetective} className="border-t-2 border-[var(--border)] bg-[var(--card)] p-3 flex gap-2 shrink-0"><input value={detectiveDraft} onChange={(e) => setDetectiveDraft(e.target.value)} className="pixel-input flex-1 text-xs" placeholder="Mensaje privado..." /><button type="submit" className="pixel-btn text-xs px-4">ENVIAR</button></form>
            <div className="md:hidden p-3 border-t-2 border-[var(--border)] bg-[var(--card)]">
              {(timeOk || delibTimeRemaining <= 0) ? <button onClick={skipToVote} className="pixel-btn w-full py-3" style={headFont}>VOTAR AHORA ▶</button> : <div className="text-center text-xs text-[var(--muted-foreground)] italic">Espera 30 segundos... ({formatTime(30 - (DELIBERATION_SECONDS - delibTimeRemaining))})</div>}
            </div>
          </section>
        </div>
      </div>
    );
  }

  /* ═══ RENDER: VOTE ═══ */
  if (phase === "vote") {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-4" style={bodyFont}>
        {AchievementOverlay}
        <div className="pixel-frame max-w-lg w-full p-6 space-y-6">
          <div className="pixel-header"><span>FASE DE VOTACIÓN</span></div>
          <div className="text-center">
            <div className="text-sm font-bold text-[var(--primary)] tracking-widest" style={headFont}>¿Es {currentCase?.suspect.name} culpable o inocente?</div>
            <div className="text-xs text-[var(--muted-foreground)] mt-1">Tu voto es definitivo.</div>
          </div>
          {hasVoted ? (
            <div className="text-center space-y-4">
              <div className="pixel-frame p-4">
                <div className="text-xs text-[var(--muted-foreground)] italic">Tu voto ha sido registrado.</div>
                <div className="text-2xl mt-2">{voteChoice === "guilty" ? "⚖️" : "🕊️"}</div>
                <div className={cn("text-sm font-bold tracking-widest mt-1", voteChoice === "guilty" ? "text-[var(--destructive)]" : "text-[#4ec9b0]")} style={headFont}>{voteChoice === "guilty" ? "CULPABLE" : "INOCENTE"}</div>
              </div>
              <div className="text-xs text-[var(--muted-foreground)] animate-pulse tracking-widest">Esperando al otro detective... ({votes.length}/2)</div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setVoteChoice("guilty")} className={cn("p-4 text-center border-2 transition-all cursor-pointer", voteChoice === "guilty" ? "border-[var(--destructive)] bg-[var(--destructive)]/20 pixel-vote-glow" : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--destructive)]")}> <div className="text-2xl">⚖️</div><div className="text-sm font-bold tracking-widest mt-2 text-[var(--destructive)]" style={headFont}>CULPABLE</div><div className="text-[9px] text-[var(--muted-foreground)] mt-1">Va a prisión</div></button>
                <button onClick={() => setVoteChoice("innocent")} className={cn("p-4 text-center border-2 transition-all cursor-pointer", voteChoice === "innocent" ? "border-[#4ec9b0] bg-[#4ec9b0]/20 pixel-vote-glow" : "border-[var(--border)] bg-[var(--card)] hover:border-[#4ec9b0]")}><div className="text-2xl">🕊️</div><div className="text-sm font-bold tracking-widest mt-2 text-[#4ec9b0]" style={headFont}>INOCENTE</div><div className="text-[9px] text-[var(--muted-foreground)] mt-1">Queda libre</div></button>
              </div>
              <div><label className="text-xs text-[var(--foreground)] tracking-wider block mb-1">RAZÓN DE TU VOTO</label><textarea value={voteReason} onChange={(e) => setVoteReason(e.target.value)} className="pixel-input w-full min-h-[80px] resize-none text-xs" placeholder="¿Por qué?" /></div>
              <button onClick={handleSubmitVote} disabled={!voteChoice} className={cn("w-full py-3 text-xs tracking-widest font-bold cursor-pointer", voteChoice ? (voteChoice === "guilty" ? "pixel-btn-danger" : "pixel-btn") : "pixel-btn-secondary opacity-30")} style={headFont}>REGISTRAR VOTO</button>
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
            <div className="pixel-frame p-8 space-y-4"><div className="text-4xl">⚖️</div><div className="text-sm text-[var(--primary)] tracking-widest animate-pulse" style={headFont}>LA JUEZA VALERIA CRUZ DELIBERA...</div></div>
          ) : verdict ? (
            <>
              <div className="text-xs tracking-[0.3em] text-[var(--muted-foreground)]">JUEZ VALERIA CRUZ · SALA DE JUSTICIA</div>
              <div className="pixel-frame p-8" key={shakeKey}>
                <div className="text-3xl mb-4">{verdict.decision === "imprisoned" ? "🔗" : "🔓"}</div>
                <div className={cn("text-xl md:text-2xl font-bold tracking-widest", verdict.decision === "imprisoned" ? "text-[var(--destructive)]" : "text-[#4ec9b0]")} style={headFont}>{verdict.decision === "imprisoned" ? "ENCARCELADO" : "LIBRE"}</div>
                <div className="text-xs text-[var(--muted-foreground)] mt-2 tracking-wider">{currentCase?.suspect.name} {verdict.decision === "imprisoned" ? "ha sido encontrado culpable" : "ha sido absuelto"}</div>
              </div>
              <div className="pixel-frame p-4 text-left"><div className="text-xs text-[var(--primary)] mb-2" style={headFont}>RAZONAMIENTO DE LA JUEZA</div><p className="text-xs text-[var(--foreground)] leading-relaxed italic">"{verdict.judgeReasoning}"</p></div>
              <div className="pixel-frame p-4 text-left"><div className="text-xs text-[var(--muted-foreground)] mb-2" style={headFont}>COMENTARIO</div><p className="text-xs text-[var(--foreground)] leading-relaxed italic">"{verdict.judgesComment}"</p></div>
              <button onClick={() => { setPhase("revelation"); generateRevelation(); }} className="pixel-btn py-3 px-8 mt-4" style={headFont}>VER LA VERDAD ▶</button>
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
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-4" style={bodyFont}>
        {AchievementOverlay}
        <div className="max-w-2xl w-full space-y-6 text-center">
          <div className="pixel-header"><span>LA VERDAD COMPLETA</span></div>
          {revelationLoading ? (
            <div className="pixel-frame p-8"><div className="text-sm text-[var(--primary)] animate-pulse tracking-widest">REVELANDO LA VERDAD...</div></div>
          ) : (
            <div className="pixel-frame p-6 text-left max-h-[60vh] overflow-y-auto pixel-scroll">
              <pre className="text-xs text-[var(--foreground)] whitespace-pre-wrap leading-relaxed font-[var(--font-pixel-body)]">{revelationText}</pre>
            </div>
          )}
          <button onClick={() => setPhase("results")} className="pixel-btn py-3 px-8" style={headFont}>VER RESULTADOS ▶</button>
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
            <div className={cn("text-lg md:text-xl font-bold tracking-widest", ending.isSpecial ? "text-[var(--primary)] pixel-text-glow" : "text-[var(--foreground)]")} style={headFont}>{ending.isSpecial && "★ "}{ending.title}{ending.isSpecial && " ★"}</div>
            <p className="text-sm text-[var(--foreground)] leading-relaxed max-w-lg mx-auto">{ending.description}</p>
            {ending.reference && <div className="text-[9px] text-[var(--muted-foreground)] italic">"{ending.reference}"</div>}
          </>)}

          <div className="border-t-2 border-[var(--border)]" />

          <div className="pixel-frame p-4">
            <div className="text-xs text-[var(--primary)] mb-3" style={headFont}>🏆 LOGROS ({unlockedAchievements.length})</div>
            {unlockedAchievements.length === 0 ? <div className="text-xs text-[var(--muted-foreground)] italic py-4">Sin logros esta partida.</div> : (
              <div className="grid gap-2">{unlockedAchievements.map((ach) => (<div key={ach.id} className="pixel-frame p-2 flex items-center gap-3 text-left pixel-evidence-flash"><span className="text-xl">{ach.icon}</span><div><div className="text-xs font-bold text-[var(--primary)] tracking-wider">{ach.name}</div><div className="text-[10px] text-[var(--muted-foreground)]">{ach.description}</div></div></div>))}</div>
            )}
          </div>

          {verdict && (
            <div className="pixel-frame p-4">
              <div className="text-xs text-[var(--muted-foreground)] mb-2">RESUMEN DE VOTACIÓN</div>
              <div className="flex justify-center gap-8"><div className="text-center"><div className="text-lg font-bold text-[var(--destructive)]">{verdict.guiltyVotes}</div><div className="text-[9px] text-[var(--muted-foreground)]">CULPABLE</div></div><div className="text-center"><div className="text-lg font-bold text-[#4ec9b0]">{verdict.innocentVotes}</div><div className="text-[9px] text-[var(--muted-foreground)]">INOCENTE</div></div></div>
              <div className="text-[9px] text-[var(--muted-foreground)] mt-2">{verdict.suspectIsGuilty ? "La realidad: el sospechoso SÍ era culpable" : "La realidad: el sospechoso NO era culpable"}</div>
              <div className={cn("text-xs font-bold mt-1", verdict.majorityCorrect ? "text-[#4ec9b0]" : "text-[var(--destructive)]")}>{verdict.majorityCorrect ? "✓ Los detectives acertaron" : "✗ Los detectives se equivocaron"}</div>
            </div>
          )}

          <div className="pixel-frame p-4">
            <div className="text-xs text-[var(--muted-foreground)] mb-2">ESTADÍSTICAS</div>
            <div className="flex justify-center gap-6 text-xs">
              <div className="text-center"><div className="text-sm font-bold text-[var(--primary)]">{questionsAsked}</div><div className="text-[9px] text-[var(--muted-foreground)]">PREGUNTAS</div></div>
              <div className="text-center"><div className="text-sm font-bold text-[var(--destructive)]">{maxStress}%</div><div className="text-[9px] text-[var(--muted-foreground)]">ESTRÉS MAX</div></div>
              <div className="text-center"><div className="text-sm font-bold text-[var(--primary)]">{flaggedCount}</div><div className="text-[9px] text-[var(--muted-foreground)]">FLAGGED</div></div>
              <div className="text-center"><div className="text-sm font-bold text-[var(--foreground)]">{unlockedEvCount}/{totalEvCount}</div><div className="text-[9px] text-[var(--muted-foreground)]">EVIDENCIA</div></div>
              <div className="text-center"><div className="text-sm font-bold text-[var(--foreground)]">{formatTime(totalTime - timeRemaining)}</div><div className="text-[9px] text-[var(--muted-foreground)]">TIEMPO</div></div>
            </div>
          </div>

          <button onClick={playAgain} className="pixel-btn py-3 px-8" style={headFont}>JUGAR DE NUEVO</button>
        </div>
      </main>
    );
  }

  return <main className="min-h-screen flex items-center justify-center" style={bodyFont}><div className="pixel-frame p-6 text-center"><div className="text-xs text-[var(--muted-foreground)]">Cargando...</div></div></main>;
}
