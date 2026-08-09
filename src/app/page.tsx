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
const EVIDENCE_REVIEW_SECONDS = 90;
const QUICK_QUESTIONS: Array<{ category: "neutral" | "amenazante" | "empatia" | "enganio"; label: string; text: string }> = [
  // NEUTRAL — informativas, directas
  { category: "neutral", label: "Coartada", text: "¿Dónde estabas el día del crimen?" },
  { category: "neutral", label: "Relación", text: "¿Conocías a la víctima?" },
  { category: "neutral", label: "Versión", text: "¿Puedes describir tu versión de los hechos?" },
  { category: "neutral", label: "Testigos", text: "¿Alguien puede confirmar tu historia?" },
  { category: "neutral", label: "Movimiento", text: "¿A qué hora llegaste al lugar?" },
  { category: "neutral", label: "Identificación", text: "¿Puedes identificarte con tu nombre completo?" },
  // AMENAZANTE — presión, consecuencias
  { category: "amenazante", label: "Directa", text: "¿Tienes algo que esconder?" },
  { category: "amenazante", label: "Castaño", text: "Sabemos que mientes. ¿Qué ganaste con esto?" },
  { category: "amenazante", label: "Consecuencia", text: "¿Entiendes lo que te puede pasar si sigues mintiendo?" },
  { category: "amenazante", label: "Acusación", text: "Las pruebas te señalan. ¿Vas a confesar o esperamos al juez?" },
  { category: "amenazante", label: "Ultimátum", text: "Esta es tu última oportunidad. Habla ahora o cállate para siempre." },
  // EMPATÍA — softer, building trust
  { category: "empatia", label: "Confianza", text: "Puedes confiar en mí. Cuéntame qué pasó de verdad." },
  { category: "empatia", label: "Comprensión", text: "Entiendo que sea difícil hablar. Tómate tu tiempo." },
  { category: "empatia", label: "Apoyo", text: "Si cooperas, puedo ayudarte. ¿Qué te preocupa?" },
  { category: "empatia", label: "Escucha", text: "Estoy aquí para escucharte, no para juzgarte." },
  // ENGAÑO — bluffing, false info
  { category: "enganio", label: "Falsa evidencia", text: "Encontramos tus huellas en la escena. ¿Cómo explicarlo?" },
  { category: "enganio", label: "Testigo falso", text: "Ya tenemos un testigo que te vio. ¿Lo niegas?" },
  { category: "enganio", label: "Confesión ajena", text: "Tu cómplice ya confesó. ¿Quieres agregar algo?" },
  { category: "enganio", label: "Cámara", text: "Las cámaras te grabaron. ¿Vamos a verlas juntos?" },
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
  if (typeof v === "string") return convertEmojiShortcodes(v);
  if (v === null || v === undefined) return "";
  try { return JSON.stringify(v); }
  catch { return String(v); }
}

/* Common emoji shortcodes → unicode. LLMs sometimes output :smile: instead
 * of the actual emoji, which looks broken. This converts the most common
 * ones so the UI always shows a real emoji. */
const EMOJI_MAP: Record<string, string> = {
  ":smile:": "😄", ":grin:": "😁", ":sad:": "😢", ":cry:": "😭",
  ":angry:": "😠", ":rage:": "😡", ":fear:": "😨", ":sweat:": "😰",
  ":thinking:": "🤔", ":neutral:": "😐", ":confused:": "😕",
  ":wink:": "😉", ":joy:": "😂", ":rofl:": "🤣", ":cool:": "😎",
  ":heart:": "❤", ":broken_heart:": "💔", ":fire:": "🔥", ":star:": "⭐",
  ":check:": "✓", ":x:": "✗", ":warning:": "⚠", ":info:": "ℹ",
  ":lock:": "🔒", ":key:": "🔑", ":door:": "🚪", ":eye:": "👁",
  ":money:": "💰", ":bomb:": "💣", ":knife:": "🔪", ":gun:": "🔫",
  ":pill:": "💊", ":syringe:": "💉", ":smoking:": "🚬", ":coffee:": "☕",
  ":beer:": "🍺", ":wine:": "🍷", ":skull:": "💀", ":ghost:": "👻",
  ":detective:": "🕵", ":cop:": "👮", ":judge:": "⚖", ":lawyer:": "⚖",
  ":briefcase:": "💼", ":file:": "📄", ":page:": "📃", ":memo:": "📝",
  ":phone:": "📞", ":email:": "📧", ":clock:": "🕐", ":hourglass:": "⏳",
  ":bulb:": "💡", ":camera:": "📷", ":microscope:": "🔬", ":test_tube:": "🧪",
  ":dna:": "🧬", ":bandage:": "🩹", ":tooth:": "🦷", ":bone:": "🦴",
  ":magnifier:": "🔍", ":search:": "🔍", ":bookmark:": "🔖", ":link:": "🔗",
  ":shield:": "🛡", ":crown:": "👑", ":ring:": "💍", ":gem:": "💎",
};

function convertEmojiShortcodes(text: string): string {
  return text.replace(/:[a-z_]+:/gi, (match) => EMOJI_MAP[match.toLowerCase()] ?? match);
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
  const [musicEnabled, setMusicEnabled] = useState<"on" | "off">("on");
  const [sfxEnabled, setSfxEnabled] = useState<"on" | "off">("on");
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [lobbyPlayers, setLobbyPlayers] = useState<
    Array<{ id: string; username: string; isHost: boolean }>
  >([]);
  const [error, setError] = useState("");
  const [muted, setMutedState] = useState(SFX.isMuted());
  const [loading, setLoading] = useState(false);

  /* Sync audio settings (voz/musica/sfx) with the sound engine. */
  useEffect(() => {
    SFX.setVoiceMuted(aiVoice === "off");
  }, [aiVoice]);
  useEffect(() => {
    SFX.setMusicMuted(musicEnabled === "off");
  }, [musicEnabled]);
  useEffect(() => {
    SFX.setSfxMuted(sfxEnabled === "off");
    setMutedState(sfxEnabled === "off");
  }, [sfxEnabled]);

  const [showTutorial, setShowTutorial] = useState(false);
  const [showAudioModal, setShowAudioModal] = useState(false);
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

  /* Turn-based interrogation system (propose → approve/edit/reject). */
  const [turnState, setTurnState] = useState<{
    status: "idle" | "proposing" | "reviewing" | "approved";
    proposerId: string | null;
    proposerName: string | null;
    proposedText: string;
    timerEndsAt: number | null;
  }>({ status: "idle", proposerId: null, proposerName: null, proposedText: "", timerEndsAt: null });

  /* Detective typing indicator (chat privado) + suspect responding indicator. */
  const [otherTyping, setOtherTyping] = useState(false);
  const [suspectResponding, setSuspectResponding] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* Separate ref for throttling our OWN typing broadcasts (sender side).
   * typingTimeoutRef above is used by the receiver to reset otherTyping. */
  const typingBroadcastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [detectiveUnreadCount, setDetectiveUnreadCount] = useState(0);

  /* Evidence */
  const [evidenceItems, setEvidenceItems] = useState<EvidenceItem[]>([]);
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceItem | null>(null);

  /* Technique */
  const [technique, setTechnique] = useState<InterrogationTechnique>("neutral");

  /* Right panel & mobile tabs */
  const [rightTab, setRightTab] = useState<
    "expediente" | "evidencia" | "notas" | "timeline" | "detectives" | "herramientas"
  >("evidencia");
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
  /* Frozen at the moment we enter the vote phase. lobbyPlayers can change
   * mid-game (e.g. the second detective's lobby.join arrives late), which
   * used to make requiredVotes jump from 1 to 2 AFTER the first vote was
   * already cast — leaving the game stuck in "Esperando al otro detective..."
   * forever. Freezing prevents that. */
  const [frozenRequiredVotes, setFrozenRequiredVotes] = useState(1);

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
  const [evidencePopup, setEvidencePopup] = useState<EvidenceItem | null>(null);

  /* Refs */
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const aiTickRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delibTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const evidenceReviewTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nervousnessRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseRef = useRef<GamePhase>(phase);
  const lobbyPlayersRef = useRef(lobbyPlayers);
  const timeRemainingRef = useRef(timeRemaining);
  const totalTimeRef = useRef(totalTime);
  const verdictRef = useRef<typeof verdict>(verdict);
  const seenMsgIds = useRef<Set<string>>(new Set());
  const interrogatingRef = useRef(false);
  /* Guards against duplicate game.start fetches when the host's retry
   * broadcasts arrive. Reset on playAgain / leaveRoom. */
  const gameStartReceivedRef = useRef(false);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { lobbyPlayersRef.current = lobbyPlayers; }, [lobbyPlayers]);
  useEffect(() => { timeRemainingRef.current = timeRemaining; }, [timeRemaining]);
  useEffect(() => { totalTimeRef.current = totalTime; }, [totalTime]);
  useEffect(() => { verdictRef.current = verdict; }, [verdict]);

  const channels = session ? channelIdsFor(session.roomCode) : null;

  /* ═══ CHANNEL SUBSCRIPTIONS ═══ */

  const { send: sendGame, presence } = useChannel({
    channelId: channels?.game ?? "__empty__",
    history: (phase === "playing" || phase === "evidence_review") ? 30 : "none",
    // Always enable the channel whenever we have a session — even in
    // join_by_link / case_intro / verdict / revelation / results phases.
    // Disabling on phase change caused the channel to disconnect/reconnect
    // and miss messages (especially game.start and lobby.join).
    enabled: !!channels,
    onMessage: (msg: any) => {
      try {
        const type = msg?.type ?? msg?.content?.type;
        const payload = msg?.content ?? msg;

        // Lobby join — when another detective joins, broadcast their info.
        // This is how the host learns about new players in real-time.
        if (type === "lobby.join") {
          const joinerId = payload.playerId as string;
          const joinerName = payload.username as string;
          const joinerIsHost = !!payload.isHost;
          if (joinerId && joinerName) {
            setLobbyPlayers((prev) => {
              if (prev.some((p) => p.id === joinerId)) return prev;
              return [...prev, { id: joinerId, username: joinerName, isHost: joinerIsHost }];
            });
            // If I'm the host, reply with my own lobby.presence so the
            // joiner can see me too.
            if (session?.isHost) {
              try {
                sendGame({
                  type: "lobby.presence",
                  content: { type: "lobby.presence", playerId, username: session.username, isHost: true },
                });
              } catch { /* ignore */ }
            }
          }
        }
        if (type === "lobby.presence") {
          const pid = payload.playerId as string;
          const pname = payload.username as string;
          const phost = !!payload.isHost;
          if (pid && pname) {
            setLobbyPlayers((prev) => {
              if (prev.some((p) => p.id === pid)) return prev;
              return [...prev, { id: pid, username: pname, isHost: phost }];
            });
          }
        }
        // Propose question system — turn-based interrogation.
        if (type === "question.propose") {
          setTurnState((prev) => ({
            ...prev,
            proposerId: payload.proposerId as string,
            proposerName: payload.proposerName as string,
            proposedText: payload.text as string,
            status: "reviewing",
            timerEndsAt: Date.now() + 10_000,
          }));
        }
        if (type === "question.approve") {
          // The other detective approved. ONLY the proposer runs the
          // interrogation (the approver just resets state). This prevents
          // duplicate messages from both detectives calling the API.
          setTurnState((cur) => {
            if (cur.proposerId === playerId && cur.proposedText) {
              const text = cur.proposedText;
              setTimeout(() => runInterrogation(text), 0);
            }
            return { status: "idle", proposerId: null, proposerName: null, proposedText: "", timerEndsAt: null };
          });
        }
        if (type === "question.reject") {
          setTurnState((prev) => ({ ...prev, status: "idle" as const, proposedText: "", proposerId: null, proposerName: null }));
        }
        if (type === "question.edit") {
          setTurnState((prev) => ({ ...prev, proposedText: payload.text as string }));
        }
        // Detectives typing indicator — show "respondiendo..." to the other.
        if (type === "detective.typing") {
          setOtherTyping(true);
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => setOtherTyping(false), 3000);
        }
        // Suspect responding indicator — broadcast to both detectives.
        if (type === "suspect.responding") {
          setSuspectResponding(true);
        }
        if (type === "suspect.idle") {
          setSuspectResponding(false);
        }

        if (type === "game.chat" || type === "detective.question" || type === "suspect.answer" || type === "suspect.autonomous" || type === "system.event") {
          const gameMsg = payload as GameMessage;
          const msgId = `${gameMsg.senderId}-${gameMsg.timestamp}`;
          if (seenMsgIds.current.has(msgId)) return;
          seenMsgIds.current.add(msgId);
          setChatMessages((prev) => [...prev.slice(-80), gameMsg]);
          // When a suspect.answer arrives, the suspect is no longer
          // responding — reset the typing indicator. This is a safety net
          // in case the suspect.idle broadcast was lost.
          if (type === "suspect.answer") {
            setSuspectResponding(false);
          }
        }

        if (type === "stress.update") {
          const su = payload as StressUpdate;
          setStress({ stress: su.stress, confidence: su.confidence, hostility: su.hostility, trigger: su.trigger });
        }

        // Evidence unlock broadcast — the other detective unlocked evidence
        // via their question, sync our local state.
        if (type === "evidence.unlock") {
          const ids = (payload.ids as string[]) ?? [];
          if (ids.length > 0) {
            setEvidenceItems((prev) => prev.map(ev => ids.includes(ev.id) ? { ...ev, isLocked: false } : ev));
            SFX.soundEvidenceUnlock();
          }
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
          if (seed && !currentCase && !gameStartReceivedRef.current) {
            // Mark as received so we don't trigger duplicate fetches when
            // the host's retry broadcasts arrive.
            gameStartReceivedRef.current = true;
            // Non-host: fetch the generated case using the seed, with retry
            // in case the generate-case API is rate-limited or cold.
            const loadCase = async (attempt: number) => {
              try {
                const res = await fetch("/api/generate-case", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ seed }),
                });
                if (!res.ok) {
                  console.error(`[game.start] Failed to fetch case for seed (attempt ${attempt + 1}):`, seed, res.status);
                  if (attempt < 5) {
                    setTimeout(() => loadCase(attempt + 1), 1500 * (attempt + 1));
                  }
                  return;
                }
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
                if (attempt < 5) {
                  setTimeout(() => loadCase(attempt + 1), 1500 * (attempt + 1));
                }
              }
            };
            loadCase(0);
          }
        }

        if (type === "game.phase") {
          const newPhase = payload.phase as GamePhase;
          if ("generating_case,playing,evidence_review,deliberation,vote,verdict,revelation,results".split(",").includes(newPhase)) {
            setPhase(newPhase);
            // Sync requiredVotes when transitioning to vote phase so both
            // detectives use the same threshold.
            if (newPhase === "vote" && typeof payload.requiredVotes === "number") {
              setFrozenRequiredVotes(payload.requiredVotes as number);
            }
            // Sync timer when transitioning to playing phase so the non-host
            // starts with the correct time (doesn't have to wait for the
            // 5s game.timer broadcast).
            if (newPhase === "playing") {
              const t = payload.timeRemaining as number;
              const tt = payload.totalTime as number;
              if (typeof t === "number" && t > 0) setTimeRemaining(t);
              if (typeof tt === "number" && tt > 0) setTotalTime(tt);
            }
          }
        }

        // Timer sync — host broadcasts timeRemaining every 5s. Non-host
        // accepts the value to keep the clock in sync. Host ignores its
        // own echoes (it's the source of truth).
        if (type === "game.timer" && !session?.isHost) {
          const t = payload.timeRemaining as number;
          const tt = payload.totalTime as number;
          if (typeof t === "number" && t >= 0) setTimeRemaining(t);
          if (typeof tt === "number" && tt > 0) setTotalTime(tt);
        }

        if (type === "vote.cast") {
          const vp = payload as VotePayload;
          setVotes((prev) => {
            if (prev.some((v) => v.playerId === vp.playerId)) return prev;
            return [...prev, { playerId: vp.playerId, playerName: vp.playerName, vote: vp.vote, reason: vp.reason, votedAt: vp.votedAt }];
          });
        }

        // Verdict broadcast — host computed the verdict via the judge API
        // and broadcasts it. Non-host receives it and jumps to the verdict
        // screen without calling the API (avoids duplicate calls + ensures
        // both detectives see the same result).
        if (type === "game.verdict") {
          const v = payload.verdict;
          const e = payload.ending;
          if (v) {
            // Only accept the verdict if we haven't progressed past it
            // (revelation / results). The host's retry broadcasts (5 attempts)
            // can arrive AFTER the user pressed "REVELAR LA VERDAD" and
            // would yank them back to the verdict screen.
            const pastVerdict = phaseRef.current === "revelation" || phaseRef.current === "results";
            if (!pastVerdict) {
              setVerdict(v);
              setShakeKey((prev) => prev + 1);
              if (e) setEnding(e);
              setPhase("verdict");
              setLoading(false);
            } else {
              // Still capture the verdict data in case we don't have it yet.
              if (!verdictRef.current) {
                setVerdict(v);
                if (e) setEnding(e);
              }
            }
          }
        }
      } catch { /* ignore */ }
    },
  });

  /* Presence polling — every 2s while in the lobby, broadcast our presence
   * so the other detective sees us even if the initial lobby.join was lost.
   * This is a robust fallback against Portal SDK connection timing issues. */
  useEffect(() => {
    if (phase !== "lobby" || !session) return;
    const announce = () => {
      try {
        sendGame({
          type: "lobby.presence",
          content: {
            type: "lobby.presence",
            playerId,
            username: session.username,
            isHost: session.isHost,
          },
        });
      } catch { /* ignore */ }
    };
    // Announce immediately, then every 2s.
    announce();
    const interval = setInterval(announce, 2000);
    return () => clearInterval(interval);
  }, [phase, session, playerId, sendGame]);

  const { send: sendDetective } = useChannel({
    channelId: channels?.detectives ?? "__empty__",
    history: (phase === "playing" || phase === "deliberation" || phase === "evidence_review") ? 30 : "none",
    // Always enable when we have a session — same rationale as the game channel.
    enabled: !!channels,
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
          // Increment unread count if the user is not currently viewing the
          // detectives tab — shows as a badge in the tab label.
          if (rightTab !== "detectives") {
            setDetectiveUnreadCount((c) => c + 1);
          }
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
    // Broadcast phase change so the other detective transitions too.
    try { sendGame({ type: "game.phase", content: { type: "game.phase", phase: "deliberation" } }); } catch { /* ignore */ }
  }, [sendGame]);

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
    // Only the host calls the judge API. The non-host waits for the
    // game.verdict broadcast. This prevents both detectives from making
    // duplicate API calls (which wastes rate limit quota) and ensures
    // both see the same verdict.
    if (!session?.isHost) {
      setPhase("verdict");
      setLoading(true);
      return;
    }
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

      // Broadcast the verdict + ending to the non-host with retry.
      const broadcastVerdict = (attempt: number) => {
        try {
          sendGame({
            type: "game.verdict",
            content: { type: "game.verdict", verdict: data, ending: end },
          });
        } catch { /* ignore */ }
        if (attempt < 5) setTimeout(() => broadcastVerdict(attempt + 1), 400 * (attempt + 1));
      };
      broadcastVerdict(0);
    } catch (err) {
      console.error("[judge] failed:", err);
      setError("Error del juez. Veredicto pendiente.");
    } finally {
      setLoading(false);
    }
  }, [currentCase, votes, conversationHistory, stress, maxStress, lobbyPlayers.length, questionsAsked, timeRemaining, totalTime, unlockAchievement, session?.isHost, sendGame]);

  /* ═══ EFFECTS ═══ */

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages.length, detectiveMessages.length]);

  useEffect(() => {
    if (typeof window === "undefined" || tutorialChecked) return;
    setTutorialChecked(true);
    const urlCode = getRoomCodeFromURL();
    if (urlCode) { setRoomCode(urlCode); setPhase("join_by_link"); return; }
    // Don't restore the saved session on page load — always start at the
    // welcome screen. The previous behavior (restoring to lobby) caused
    // confusion when the host reloaded mid-game and landed in a stale lobby.
    // Clear any saved session so it doesn't linger.
    clearSession();
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

  /* Timer sync — host broadcasts timeRemaining every 5s so the non-host's
   * clock stays in sync. Uses refs (not state) inside the interval so the
   * effect doesn't restart every second when timeRemaining changes — that
   * would reset the 5s interval and the broadcast would never fire. */
  useEffect(() => {
    if (phase !== "playing" || !session?.isHost) return;
    const syncTimer = setInterval(() => {
      try {
        sendGame({
          type: "game.timer",
          content: {
            type: "game.timer",
            timeRemaining: timeRemainingRef.current,
            totalTime: totalTimeRef.current,
            timestamp: Date.now(),
          },
        });
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(syncTimer);
  }, [phase, session?.isHost, sendGame]);

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
        if (prev <= 1) {
          if (delibTimerRef.current) clearInterval(delibTimerRef.current);
          // Freeze the required vote count when the deliberation timer
          // expires and we auto-transition to the vote phase.
          setFrozenRequiredVotes(Math.max(1, lobbyPlayersRef.current.length));
          setPhase("vote");
          // Broadcast phase change so both detectives transition together.
          try { sendGame({ type: "game.phase", content: { type: "game.phase", phase: "vote" } }); } catch { /* ignore */ }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (delibTimerRef.current) clearInterval(delibTimerRef.current); };
  }, [phase, sendGame]);

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

  /* Check all votes in — uses frozenRequiredVotes (captured at vote-phase
   * entry) so late-arriving lobby.join messages don't deadlock the vote. */
  const requiredVotes = frozenRequiredVotes;
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
      // Broadcast lobby.join so the host sees us. Retry several times with
      // backoff because the channel subscription may not be ready the instant
      // setPhase fires — the Portal SDK takes a moment to establish the
      // websocket connection after `enabled` flips to true.
      const uname = username.trim();
      const broadcastJoin = (attempt: number) => {
        try {
          sendGame({
            type: "lobby.join",
            content: { type: "lobby.join", playerId, username: uname, isHost: false },
          });
        } catch { /* ignore */ }
        if (attempt < 5) {
          setTimeout(() => broadcastJoin(attempt + 1), 500 * (attempt + 1));
        }
      };
      broadcastJoin(0);
    } catch { setError("Error al unirse a la sala"); } finally { setLoading(false); }
  }, [username, roomCode, playerId, sendGame]);

  const handleJoinByLink = useCallback(async () => { await handleJoinRoom(); }, [handleJoinRoom]);

  const handleStartGame = useCallback(async () => {
    if (!session?.isHost || !channels) return;
    try { await fetch(`/api/rooms/${session.roomCode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start" }) }); } catch { /* ok */ }
    setPhase("generating_case");
    // Broadcast phase change so the non-host also sees the "generating case" screen.
    try { sendGame({ type: "game.phase", content: { type: "game.phase", phase: "generating_case" } }); } catch { /* ignore */ }
    SFX.soundWhoosh();
  }, [session, channels, sendGame]);

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
    //
    // Retry the broadcast several times with backoff — the non-host may
    // not be fully connected to the channel yet when the host finishes
    // generating the case, and a single send could be lost.
    const broadcastStart = (attempt: number) => {
      try {
        sendGame({ type: "game.start", content: { type: "game.start", seed: generated.seed } });
      } catch { /* ignore */ }
      if (attempt < 8) {
        setTimeout(() => broadcastStart(attempt + 1), 400 * (attempt + 1));
      }
    };
    broadcastStart(0);
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
    // Reset vote state so the previous case's vote reason doesn't leak in.
    setVotes([]); setHasVoted(false); setVoteChoice(""); setVoteReason(""); setAllVotesIn(false);
    setVerdict(null); setEnding(null); setRevelation(null);
    setTurnState({ status: "idle", proposerId: null, proposerName: null, proposedText: "", timerEndsAt: null });
    // Reset ALL labels/state that could leak from a previous round.
    setError(""); setChatDraft(""); setDetectiveDraft("");
    setSuspectResponding(false); setOtherTyping(false);
    setDetectiveUnreadCount(0); setEvidencePopup(null);
    setFrozenRequiredVotes(1); setLobbyPlayers([]);
    // Re-add ourselves to lobbyPlayers so the count is correct.
    if (session) setLobbyPlayers([{ id: playerId, username: session.username, isHost: session.isHost }]);
    const rt = roundTime * 60;
    setTimeRemaining(rt);
    setTotalTime(rt);
    setPhase("playing");
    // Broadcast phase change WITH the timer values so the non-host starts
    // playing with the correct time immediately (doesn't have to wait 5s
    // for the first game.timer sync broadcast).
    try {
      sendGame({
        type: "game.phase",
        content: { type: "game.phase", phase: "playing", timeRemaining: rt, totalTime: rt },
      });
    } catch { /* ignore */ }
    SFX.soundWhoosh();
  }, [currentCase, roundTime, sendGame, session, playerId]);

  /* ═══ TURN-BASED INTERROGATION ═══
   * With 2 detectives, one PROPOSES a question, the other can APPROVE / EDIT /
   * REJECT / propose a different one. When approved (or after a 10s consenso
   * timer with no objection), the proposed question is sent to the suspect.
   * With a single detective, the question is sent directly (no proposal needed).
   */
  const isMultiplayer = lobbyPlayers.length >= 2;

  const runInterrogation = useCallback(async (questionText: string) => {
    // Core interrogation logic — used by both the direct-send (1-detective)
    // and the proposal-approved (2-detective) flows.
    if (!questionText.trim() || !currentCase || !session) return;
    if (interrogatingRef.current) return;
    interrogatingRef.current = true;
    setChatDraft("");
    setPending(true);
    setQuestionsAsked((prev) => prev + 1);
    SFX.soundSendQuestion();
    stopSpeaking();

    const text = questionText.trim();
    const qMsg: GameMessage = { type: "detective.question", senderType: "detective", senderId: playerId, senderName: session.username, text, timestamp: Date.now() };
    setChatMessages((prev) => [...prev.slice(-80), qMsg]);
    const newTurn: ConversationTurn = { role: "detective", text, detectiveName: session.username, timestamp: Date.now() };
    try { await sendGame({ type: "detective.question", content: qMsg }); } catch { /* ok */ }

    // Evidence unlocks (regex + keyword fallback)
    const qLower = text.toLowerCase();
    const unlockedIds: string[] = [];
    setEvidenceItems((prev) => prev.map(ev => {
      if (!ev.isLocked) return ev;
      if (ev.unlockTopic) {
        try { if (new RegExp(ev.unlockTopic, "i").test(qLower)) { unlockedIds.push(ev.id); return { ...ev, isLocked: false }; } } catch { /* invalid regex */ }
      }
      const keywordSource = `${ev.label} ${ev.description}`.toLowerCase();
      const keywords = keywordSource
        .split(/[^a-záéíóúñ]+/)
        .filter(w => w.length >= 4 && !["para","como","cuando","donde","porque","tiene","esto","esos","este","con","sin","sobre","tras","desde","hasta","entre"].includes(w));
      const uniqueKeywords = [...new Set(keywords)].slice(0, 8);
      for (const kw of uniqueKeywords) {
        if (qLower.includes(kw)) { unlockedIds.push(ev.id); return { ...ev, isLocked: false }; }
      }
      return ev;
    }));
    if (unlockedIds.length > 0) {
      SFX.soundEvidenceUnlock();
      // Show popup with the first unlocked evidence item.
      const firstUnlocked = evidenceItems.find(ev => unlockedIds.includes(ev.id));
      if (firstUnlocked) {
        setEvidencePopup(firstUnlocked);
        setTimeout(() => setEvidencePopup(null), 4000);
      }
      // Broadcast evidence unlocks to the other detective.
      try {
        sendGame({ type: "evidence.unlock", content: { type: "evidence.unlock", ids: unlockedIds } });
      } catch { /* ignore */ }
    }

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

      // Broadcast "suspect.responding" BEFORE the fetch so BOTH detectives
      // see the typing indicator simultaneously while the API call is
      // in-flight. Previously this was after the fetch, so the other
      // detective never saw the indicator (the response arrived first).
      try { sendGame({ type: "suspect.responding", content: { type: "suspect.responding" } }); } catch { /* ok */ }

      const res = await fetch("/api/interrogate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        try { sendGame({ type: "suspect.idle", content: { type: "suspect.idle" } }); } catch { /* ok */ }
        if (res.status === 429 || errBody.error === "rate_limited") {
          const rateLimitMsg: GameMessage = {
            type: "suspect.answer", senderType: "suspect", senderId: "system", senderName: "SISTEMA",
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
      try { await sendGame({ type: "suspect.idle", content: { type: "suspect.idle" } }); } catch { /* ok */ }

      const answerText = data.answer?.text || "No tengo nada que decir.";
      const aMsg: GameMessage = { type: "suspect.answer", senderType: "suspect", senderId: currentCase.suspect.id, senderName: currentCase.suspect.name, text: answerText, timestamp: Date.now(), flagged: data.answer?.flagged };
      // Mark this message as seen locally so the retry broadcasts from
      // our own sendGame don't create duplicates. The OTHER detective
      // doesn't have this msgId in their seenMsgIds, so they WILL add it.
      const aMsgId = `${aMsg.senderId}-${aMsg.timestamp}`;
      seenMsgIds.current.add(aMsgId);
      setChatMessages((prev) => [...prev.slice(-80), aMsg]);
      // Broadcast suspect.answer with retry — the other detective MUST see
      // the response, so we send it multiple times to survive packet loss.
      const broadcastAnswer = (attempt: number) => {
        try { sendGame({ type: "suspect.answer", content: aMsg }); } catch { /* ignore */ }
        if (attempt < 4) setTimeout(() => broadcastAnswer(attempt + 1), 300 * (attempt + 1));
      };
      broadcastAnswer(0);
      setConversationHistory((prev) => [...prev.slice(-40), newTurn, { role: "suspect", text: answerText, timestamp: Date.now() }]);

      const prevStressLevel = stress?.stress ?? 0;
      const newStressLevel = data.stress?.stress ?? prevStressLevel;
      if (newStressLevel > prevStressLevel + 5) {
        setTimeout(() => SFX.soundStressRise(newStressLevel), 200);
      }
      if (data.stress) {
        setStress(data.stress);
        if (data.stress.stress > maxStress) setMaxStress(data.stress.stress);
        // Broadcast stress update so the other detective's stress bars sync.
        try {
          sendGame({
            type: "stress.update",
            content: {
              type: "stress.update",
              suspectId: currentCase.suspect.id,
              stress: data.stress.stress,
              confidence: data.stress.confidence,
              hostility: data.stress.hostility,
              trigger: data.stress.trigger,
              timestamp: Date.now(),
            },
          });
        } catch { /* ignore */ }
      }
      if (data.answer?.flagged) {
        setFlaggedCount((prev) => prev + 1);
        unlockAchievement("gotcha");
        setTimeout(() => SFX.soundLieDetected(), 150);
      }
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

  const handleProposeQuestion = useCallback(() => {
    const text = chatDraft.trim();
    if (!text || !session) return;
    if (!isMultiplayer) {
      runInterrogation(text);
      return;
    }
    setTurnState({
      status: "reviewing",
      proposerId: playerId,
      proposerName: session.username,
      proposedText: text,
      timerEndsAt: Date.now() + 10_000,
    });
    try {
      sendGame({
        type: "question.propose",
        content: {
          type: "question.propose",
          proposerId: playerId,
          proposerName: session.username,
          text,
        },
      });
    } catch { /* ignore */ }
  }, [chatDraft, session, playerId, isMultiplayer, sendGame, runInterrogation]);

  // Form-submit handler — uses chatDraft (the input field value).
  // NOTE: handleProposeQuestion is defined above to avoid a TDZ
  // (temporal dead zone) ReferenceError at build time.
  const handleInterrogate = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatDraft.trim();
    if (!text) return;
    // In multiplayer mode, the form's submit button PROPOSES instead of
    // sending directly. The actual send happens after approval.
    if (isMultiplayer) {
      handleProposeQuestion();
      return;
    }
    runInterrogation(text);
  }, [chatDraft, isMultiplayer, handleProposeQuestion, runInterrogation]);

  const handleApproveProposal = useCallback(() => {
    if (turnState.status !== "reviewing" || !turnState.proposedText) return;
    // The approver does NOT run the interrogation locally — only the
    // proposer does (after receiving question.approve). This prevents
    // duplicate messages: both detectives calling runInterrogation for
    // the same question would create two API calls and two suspect
    // answers, resulting in doubled chat messages.
    try { sendGame({ type: "question.approve", content: { type: "question.approve" } }); } catch { /* ignore */ }
    setTurnState({ status: "idle", proposerId: null, proposerName: null, proposedText: "", timerEndsAt: null });
  }, [turnState, sendGame]);

  const handleRejectProposal = useCallback(() => {
    try { sendGame({ type: "question.reject", content: { type: "question.reject" } }); } catch { /* ignore */ }
    setTurnState({ status: "idle", proposerId: null, proposerName: null, proposedText: "", timerEndsAt: null });
  }, [sendGame]);

  const handleEditProposal = useCallback((newText: string) => {
    if (turnState.status !== "reviewing") return;
    setTurnState((prev) => ({ ...prev, proposedText: newText, timerEndsAt: Date.now() + 10_000 }));
    try {
      sendGame({ type: "question.edit", content: { type: "question.edit", text: newText } });
    } catch { /* ignore */ }
  }, [turnState.status, sendGame]);

  // Consenso timer — auto-approve after 10s if nobody objects.
  // Only the PROPOSER runs the interrogation when the timer expires.
  // The approver just resets the state (the proposer will broadcast
  // suspect.answer + stress.update afterwards).
  useEffect(() => {
    if (turnState.status !== "reviewing" || !turnState.timerEndsAt) return;
    const remaining = turnState.timerEndsAt - Date.now();
    if (remaining <= 0) {
      // Timer already expired. Only the proposer sends.
      if (turnState.proposerId === playerId && turnState.proposedText) {
        const text = turnState.proposedText;
        setTurnState({ status: "idle", proposerId: null, proposerName: null, proposedText: "", timerEndsAt: null });
        runInterrogation(text);
      } else {
        setTurnState({ status: "idle", proposerId: null, proposerName: null, proposedText: "", timerEndsAt: null });
      }
      return;
    }
    const t = setTimeout(() => {
      setTurnState((cur) => {
        if (cur.status === "reviewing") {
          // Only the proposer executes the interrogation.
          if (cur.proposerId === playerId && cur.proposedText) {
            const text = cur.proposedText;
            // Defer runInterrogation so the state reset happens first.
            setTimeout(() => runInterrogation(text), 0);
          }
          return { status: "idle", proposerId: null, proposerName: null, proposedText: "", timerEndsAt: null };
        }
        return cur;
      });
    }, remaining);
    return () => clearTimeout(t);
  }, [turnState.status, turnState.timerEndsAt, turnState.proposerId, turnState.proposedText, playerId, runInterrogation]);

  /* (Legacy handleInterrogate body removed — replaced by runInterrogation above.) */

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

  const skipToVote = useCallback(() => {
    if (delibTimerRef.current) clearInterval(delibTimerRef.current);
    // Freeze the required vote count at this moment so late lobby.join
    // broadcasts don't change the threshold mid-vote.
    const req = Math.max(1, lobbyPlayers.length);
    setFrozenRequiredVotes(req);
    setPhase("vote");
    // Broadcast phase change with requiredVotes so the non-host uses the
    // same threshold (avoids the host thinking 2 votes needed while the
    // non-host thinks 1).
    try { sendGame({ type: "game.phase", content: { type: "game.phase", phase: "vote", requiredVotes: req } }); } catch { /* ignore */ }
  }, [lobbyPlayers.length, sendGame]);

  const handleSubmitVote = useCallback(async () => {
    if (!voteChoice || !session) return;
    const vote: DetectiveVote = { playerId, playerName: session.username, vote: voteChoice, reason: voteReason.trim(), votedAt: Date.now() };
    setVotes((prev) => [...prev, vote]); setHasVoted(true);
    // Broadcast vote with retry — the other detective MUST receive it,
    // otherwise they'll wait forever for a vote that never arrives.
    const broadcastVote = (attempt: number) => {
      try { sendGame({ type: "vote.cast", content: { ...vote, type: "vote.cast" } }); } catch { /* ignore */ }
      if (attempt < 5) setTimeout(() => broadcastVote(attempt + 1), 400 * (attempt + 1));
    };
    broadcastVote(0);
    SFX.soundVerdict();
  }, [voteChoice, voteReason, session, playerId, sendGame]);

  const playAgain = useCallback(() => {
    clearSession(); setSession(null); setRoomCode(""); setUsername(""); setCurrentCase(null); setGeneratedCaseRaw(null);
    setChatMessages([]); setDetectiveMessages([]); setVotes([]); setHasVoted(false);
    setVerdict(null); setEnding(null); setUnlockedAchievements([]);
    setTimeRemaining(0); setTotalTime(0); setEvidenceItems([]);
    setRevelation(null);
    gameStartReceivedRef.current = false;
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
    gameStartReceivedRef.current = false;
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

  const EvidencePopupOverlay = evidencePopup ? (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 achievement-popup">
      <div className="pixel-frame p-4 max-w-sm" style={bodyFont}>
        <div className="flex items-center gap-3">
          <span className="text-2xl">📄</span>
          <div>
            <div className="text-xs font-bold text-[var(--primary)] tracking-wider">EVIDENCIA DESBLOQUEADA</div>
            <div className="text-sm text-[var(--foreground)] font-bold mt-1">{safeRender(evidencePopup.label)}</div>
            <div className="text-xs text-[var(--muted-foreground)] mt-0.5">{safeRender(evidencePopup.description)}</div>
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
        {AchievementOverlay}{EvidencePopupOverlay}
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
        {AchievementOverlay}{EvidencePopupOverlay}
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
        {AchievementOverlay}{EvidencePopupOverlay}
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
            label="VOZ DEL SOSPECHOSO"
            value={aiVoice}
            onChange={setAiVoice}
            sectionKey="aiVoice"
            options={[
              { value: "on", label: "ACTIVADA", emoji: "[GREEN]" },
              { value: "off", label: "DESACTIVADA", emoji: "[GRAY]" },
            ]}
          />

          <OptionSelector
            label="MÚSICA AMBIENTAL"
            value={musicEnabled}
            onChange={setMusicEnabled}
            sectionKey="musicEnabled"
            options={[
              { value: "on", label: "ACTIVADA", emoji: "[GREEN]" },
              { value: "off", label: "DESACTIVADA", emoji: "[GRAY]" },
            ]}
          />

          <OptionSelector
            label="EFECTOS DE SONIDO"
            value={sfxEnabled}
            onChange={setSfxEnabled}
            sectionKey="sfxEnabled"
            options={[
              { value: "on", label: "ACTIVADOS", emoji: "[GREEN]" },
              { value: "off", label: "DESACTIVADOS", emoji: "[GRAY]" },
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
        {AchievementOverlay}{EvidencePopupOverlay}
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
        {AchievementOverlay}{EvidencePopupOverlay}
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
        {AchievementOverlay}{EvidencePopupOverlay}
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
              <span className="text-[var(--primary)] font-bold">{aiVoice === "on" ? "ACTIVADA" : "DESACTIVADA"}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[var(--muted-foreground)]">MÚSICA:</span>
              <span className="text-[var(--primary)] font-bold">{musicEnabled === "on" ? "ACTIVADA" : "DESACTIVADA"}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[var(--muted-foreground)]">EFECTOS:</span>
              <span className="text-[var(--primary)] font-bold">{sfxEnabled === "on" ? "ACTIVADOS" : "DESACTIVADOS"}</span>
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
        {AchievementOverlay}{EvidencePopupOverlay}
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
              <ul className="space-y-1">{evidenceItems.slice(0, 6).map((ev, i) => <li key={i} className="text-xs text-[var(--foreground)] flex gap-2" style={bodyFont}><span className={cn("shrink-0", ev.isRedHerring ? "text-[var(--destructive)]" : "text-[#4ec9b0]")}>{ev.isLocked ? "🔒" : "▸"}</span><span>{safeRender(ev.label) || "Evidencia"}</span></li>)}</ul>
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
        {AchievementOverlay}{EvidencePopupOverlay}
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

    const rightTabsContent = (() => {
      const tabList = [
        { key: "evidencia" as const, label: `EVIDENCIA (${unlockedCount}/${totalEvCount})` },
        { key: "detectives" as const, label: detectiveUnreadCount > 0 && rightTab !== "detectives" ? `DETECTIVES (${detectiveUnreadCount})` : "DETECTIVES", showTyping: otherTyping && rightTab !== "detectives" },
        { key: "herramientas" as const, label: "HERRAMIENTAS" },
      ] as const;
      return (
        <div className="flex flex-col h-full">
          {/* Tabs — larger, more readable, two-row wrap */}
          <div className="flex border-b-2 border-[var(--border)] flex-wrap shrink-0">
            {tabList.map((tab) => (
              <button
                key={tab.key}
                onClick={() => { setRightTab(tab.key); SFX.soundTab(); if (tab.key === "detectives") setDetectiveUnreadCount(0); }}
                className={cn(
                  "px-2.5 py-2 text-[12px] tracking-wider transition-all cursor-pointer border-b-2 flex items-center gap-1.5",
                  rightTab === tab.key
                    ? "text-[var(--primary)] border-[var(--primary)] bg-[var(--primary)]/12 font-bold"
                    : "text-[var(--muted-foreground)] border-transparent hover:text-[var(--foreground)] hover:bg-[var(--accent)]/50"
                )}
                style={bodyFont}
              >
                {tab.label}
                {"showTyping" in tab && tab.showTyping && <TypingIndicator />}
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
                    {suspect.knownFacts.length === 0 && <div className="text-xs text-[var(--muted-foreground)] italic">Sin hechos conocidos.</div>}
                    {suspect.knownFacts.map((f, i) => (
                      <div key={i} className="text-xs text-[var(--foreground)] flex gap-2 leading-relaxed">
                        <span className="text-[var(--primary)] shrink-0">▸</span>
                        <span>{safeRender(f)}</span>
                      </div>
                    ))}
                    {/* Add the case situation as an extra fact so the panel
                        doesn't look empty when the LLM produced few facts. */}
                    {currentCase.stakes && (
                      <div className="text-xs text-[var(--foreground)] flex gap-2 leading-relaxed pt-2 border-t border-[var(--border)]">
                        <span className="text-[var(--destructive)] shrink-0">⚠</span>
                        <span><span className="text-[var(--destructive)] font-bold">EN JUEGO:</span> {safeRender(currentCase.stakes)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            {rightTab === "evidencia" && (
              <div className="space-y-2">
                <div className="text-xs text-[var(--primary)] font-bold">EVIDENCIA</div>
                <div className="text-[11px] text-[var(--muted-foreground)] italic mb-2 leading-relaxed">
                  Las pruebas se desbloquean mientras indagues más en el caso. Haz preguntas sobre coartada, testigos, ubicación, móviles...
                </div>
                {evidenceItems.length === 0 ? <div className="text-xs text-[var(--muted-foreground)] italic py-4 text-center">Sin evidencia</div> : (
                  <div className="space-y-2">
                    {evidenceItems.map((ev) => (
                      <div key={ev.id} className={cn("pixel-frame p-2 transition-all cursor-pointer hover:translate-y-[-2px]", ev.isLocked && "opacity-50", selectedEvidence?.id === ev.id && "pixel-frame-active")} onClick={() => { if (!ev.isLocked) { SFX.soundClick(); setSelectedEvidence(ev === selectedEvidence ? null : ev); } }}>
                        <div className="flex items-center gap-2">
                          <span className="text-sm shrink-0">{ev.isRedHerring && !ev.isLocked ? "🔴" : ev.isLocked ? "🔒" : "📄"}</span>
                          <span className="text-[13px] font-bold text-[var(--foreground)] tracking-wider">{safeRender(ev.label) || "Evidencia"}</span>
                        </div>
                        {!ev.isLocked && <div className="text-[13px] text-[var(--muted-foreground)] mt-1">{safeRender(ev.description)}</div>}
                        {ev.isLocked && <div className="text-[10px] text-[var(--primary)]/60 mt-1 italic">Pregúntale sobre este tema para revelarla</div>}
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
            {rightTab === "detectives" && (
              <div className="flex flex-col" style={{ height: "calc(100vh - 220px)", minHeight: "260px" }}>
                <div className="text-xs text-[var(--primary)] font-bold mb-2 flex items-center gap-2">
                  <span>CHAT PRIVADO — DETECTIVES</span>
                  {otherTyping && <span className="text-[10px] text-[var(--muted-foreground)] italic flex items-center gap-1"><TypingIndicator /> escribiendo...</span>}
                </div>
                <div className="flex-1 pixel-scroll-hide overflow-y-auto space-y-2 mb-2 border border-[var(--border)] p-2 min-h-[120px]">
                  {detectiveMessages.map((dm, i) => (
                    <div key={i} className={cn("text-xs", dm.detectiveId === playerId ? "text-right" : "text-left")}>
                      {dm.detectiveId !== playerId && <span className="text-[var(--primary)] font-bold">[{safeRender(dm.detectiveName)}]: </span>}
                      <span className="text-[var(--foreground)]">{safeRender(dm.text)}</span>
                    </div>
                  ))}
                  {otherTyping && (
                    <div className="text-left">
                      <div className="inline-block pixel-frame p-2 text-xs text-[var(--muted-foreground)]"><TypingIndicator /></div>
                    </div>
                  )}
                  {detectiveMessages.length === 0 && <div className="text-xs text-[var(--muted-foreground)] italic text-center py-4">Sin mensajes privados</div>}
                </div>
                <form onSubmit={handleSendDetective} className="flex gap-2 shrink-0 items-stretch">
                  <input
                    value={detectiveDraft}
                    onChange={(e) => {
                      setDetectiveDraft(e.target.value);
                      // Broadcast typing indicator (throttled by 1.5s).
                      try {
                        if (!typingBroadcastRef.current) {
                          sendGame({ type: "detective.typing", content: { type: "detective.typing", playerId } });
                          typingBroadcastRef.current = setTimeout(() => { typingBroadcastRef.current = null; }, 1500);
                        }
                      } catch { /* ignore */ }
                    }}
                    className="pixel-input flex-1 text-xs min-w-0"
                    placeholder="Mensaje al otro detective..."
                  />
                  <button type="submit" className="pixel-btn text-xs px-3 py-2 shrink-0 self-stretch">ENVIAR</button>
                </form>
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
                {(["neutral", "amenazante", "empatia", "enganio"] as const).map((cat) => (
                  <div key={cat} className="mb-3">
                    <div className={cn(
                      "text-[11px] tracking-wider font-bold mb-1.5 px-1 py-0.5",
                      cat === "neutral" && "text-[var(--muted-foreground)]",
                      cat === "amenazante" && "text-[var(--destructive)]",
                      cat === "empatia" && "text-[#4ec9b0]",
                      cat === "enganio" && "text-[#fbbf24]"
                    )}>
                      {cat === "neutral" ? "□ NEUTRAL" : cat === "amenazante" ? "⚠ AMENAZANTE" : cat === "empatia" ? "♥ EMPATÍA" : "◆ ENGAÑO"}
                    </div>
                    {QUICK_QUESTIONS.filter(q => q.category === cat).map((q) => (
                      <button
                        key={q.label}
                        onClick={() => {
                          SFX.soundClick();
                          insertQuickQuestion(q.text);
                          // Also set the matching technique automatically.
                          if (cat === "amenazante") setTechnique("amenaza");
                          else if (cat === "empatia") setTechnique("empatia");
                          else if (cat === "enganio") setTechnique("enganio");
                          else setTechnique("neutral");
                        }}
                        className="pixel-frame w-full p-2 text-left hover:bg-[var(--primary)]/10 transition-all cursor-pointer mb-1"
                      >
                        <div className="text-[12px] text-[var(--primary)] tracking-wider font-bold">{q.label.toUpperCase()}</div>
                        <div className="text-xs text-[var(--foreground)] mt-0.5">"{q.text}"</div>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    })();

    return (
      <div className="h-screen flex flex-col pixel-fade-in overflow-hidden" style={bodyFont}>
        {AchievementOverlay}{EvidencePopupOverlay}
        <header className="border-b border-[var(--border)] bg-[var(--card)] px-2 sm:px-4 py-2 flex items-center justify-between shrink-0 gap-2">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            <span className="text-[var(--primary)] pixel-live-dot shrink-0" />
            <span className="hidden sm:inline text-sm tracking-wider text-[var(--foreground)] font-bold">INTERROGACION</span>
            <span className="hidden sm:inline pixel-badge text-xs">PREGUNTAS: {questionsAsked}</span>
          </div>
          <div className="flex items-center gap-1 sm:gap-4 shrink-0">
            <span className={cn("text-sm font-bold", timeRemaining <= 60 ? "text-[var(--destructive)] pixel-timer-warning" : "text-[var(--primary)]")} style={headFont}>{formatTime(timeRemaining)}</span>
            <button onClick={() => { SFX.soundClick(); setShowAudioModal(true); }} className="pixel-btn-secondary text-[10px] sm:text-xs py-1 px-2 sm:px-3" title="Configuración de audio">
              AUDIO
            </button>
            <button onClick={() => { SFX.soundClick(); enterDeliberation(); }} className="pixel-btn-danger text-[10px] sm:text-xs py-1 px-2 sm:px-3">DELIBERAR</button>
          </div>
        </header>

        {/* Phase stepper navigation */}
        <div className="border-b border-[var(--border)] bg-[var(--card)] px-4 py-1.5 shrink-0 overflow-x-auto">
          <PhaseIndicator current="playing" />
        </div>

        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* LEFT: Suspect panel — wider so the portrait + telemetry fill the space */}
          <aside className="hidden md:flex flex-col w-64 border-r-2 border-[var(--border)] bg-[var(--card)] shrink-0">
            <div className="pixel-header"><span>SOSPECHOSO</span></div>
            <div className="p-3 space-y-3 flex-1 overflow-y-auto pixel-scroll">
              {/* Portrait + identity card — bigger portrait to fill space */}
              <div className="text-center">
                <div className={cn("flex justify-center mb-3", portraitShake && "pixel-portrait-shake")} style={{ filter: portraitTint }}>
                  <SuspectPortrait seed={currentCase?.id?.replace("gen_", "") ?? "default"} gender={recallGender(currentCase?.id?.replace("gen_", "") ?? "default")} avatar={suspect.avatar} size="xl" />
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
                <div className="space-y-2 pixel-scroll-hide max-h-40 overflow-y-auto">
                  {suspect.knownFacts.map((f, i) => (
                    <div key={i} className="text-xs text-[var(--foreground)] flex gap-2 leading-relaxed">
                      <span className="text-[var(--primary)] shrink-0">▸</span>
                      <span>{safeRender(f)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Session stats — fills the sidebar with useful live data */}
              <div className="pixel-frame p-3 space-y-2">
                <div className="text-xs tracking-[0.18em] text-[var(--muted-foreground)] uppercase mb-1">Sesión</div>
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="border border-[var(--border)] p-1.5">
                    <div className="text-sm font-bold text-[var(--primary)]" style={headFont}>{questionsAsked}</div>
                    <div className="text-[10px] text-[var(--muted-foreground)] tracking-wider">PREGUNTAS</div>
                  </div>
                  <div className="border border-[var(--border)] p-1.5">
                    <div className="text-sm font-bold text-[var(--destructive)]" style={headFont}>{flaggedCount}</div>
                    <div className="text-[10px] text-[var(--muted-foreground)] tracking-wider">ADMITIDOS</div>
                  </div>
                  <div className="border border-[var(--border)] p-1.5">
                    <div className="text-sm font-bold text-[var(--primary)]" style={headFont}>{unlockedCount}/{totalEvCount}</div>
                    <div className="text-[10px] text-[var(--muted-foreground)] tracking-wider">EVIDENCIA</div>
                  </div>
                  <div className="border border-[var(--border)] p-1.5">
                    <div className="text-sm font-bold text-[var(--destructive)]" style={headFont}>{maxStress}%</div>
                    <div className="text-[10px] text-[var(--muted-foreground)] tracking-wider">ESTRÉS MÁX</div>
                  </div>
                </div>
              </div>
            </div>
          </aside>

          {/* CENTER: Chat — fills available width, messages anchor to bottom */}
          <section className={cn("flex-1 flex flex-col min-h-0 bg-[var(--background)]", mobileTab !== "chat" && "hidden md:flex")}>
            <div className="flex-1 overflow-y-auto pixel-scroll-hide p-3 flex flex-col justify-end gap-2 pixel-chat-compact">
              {chatMessages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center space-y-3 pixel-fade-in py-8">
                  <div className="text-3xl mb-2 opacity-50">{safeRender(suspect.avatar)}</div>
                  <div className="text-xs text-[var(--muted-foreground)]">El sospechoso espera en la sala de interrogación.</div>
                  <div className="text-xs text-[var(--primary)]">Formula tu primera pregunta para comenzar.</div>
                </div>
              )}
              <div className="space-y-2">
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
              {(pending || suspectResponding) && (
                <div className="flex justify-end">
                  <div className="max-w-[80%] pixel-message-in">
                    <div className="text-[13px] text-[var(--muted-foreground)] tracking-wider mb-1 text-right flex items-center justify-end gap-2">
                      <span className="pixel-badge">SOSPECHOSO</span>
                      <span className="text-[var(--primary)]">escribiendo...</span>
                    </div>
                    <div className="pixel-frame p-2.5 text-sm text-[var(--muted-foreground)] border-r-2 border-r-[#2a2a44]">
                      <TypingIndicator />
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
              </div>
            </div>
            {/* PROPOSAL REVIEW UI — shown when the other detective proposed a question */}
            {turnState.status === "reviewing" && (
              <div className="border-t-2 border-[var(--primary)] bg-[var(--primary)]/5 p-3 space-y-2 shrink-0">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-[var(--primary)] font-bold tracking-wider">
                    PROPUESTA DE {safeRender(turnState.proposerName).toUpperCase()}
                  </div>
                  <div className="text-[10px] text-[var(--muted-foreground)]">
                    Auto-envío en {turnState.timerEndsAt ? Math.max(0, Math.ceil((turnState.timerEndsAt - Date.now()) / 1000)) : 0}s
                  </div>
                </div>
                <div className="pixel-frame p-2 text-xs text-[var(--foreground)] italic">"{safeRender(turnState.proposedText)}"</div>
                {turnState.proposerId === playerId ? (
                  <div className="text-[11px] text-[var(--muted-foreground)] italic text-center">Esperando aprobación del otro detective (o auto-envío en 10s)...</div>
                ) : (
                  <div className="flex gap-2">
                    <button onClick={() => { SFX.soundClick(); handleApproveProposal(); }} className="pixel-btn flex-1 text-xs py-2">APROBAR Y ENVIAR</button>
                    <button onClick={() => { SFX.soundClick(); handleRejectProposal(); }} className="pixel-btn-danger flex-1 text-xs py-2">✕ RECHAZAR</button>
                  </div>
                )}
              </div>
            )}
            {/* Typing indicator — shows when the other detective is writing a question */}
            {isMultiplayer && otherTyping && turnState.status !== "reviewing" && (
              <div className="px-3 py-1 border-t border-[var(--border)] bg-[var(--card)] text-[10px] text-[var(--muted-foreground)] italic flex items-center gap-2 shrink-0">
                <TypingIndicator />
                <span>El otro detective está escribiendo...</span>
              </div>
            )}
            <form onSubmit={handleInterrogate} className="border-t-2 border-[var(--border)] bg-[var(--card)] p-2 flex gap-2 shrink-0 items-stretch">
              {selectedEvidence && <div className="flex items-center gap-1 px-2 border border-[var(--destructive)] bg-[var(--destructive)]/10 shrink-0"><span className="text-xs text-[var(--destructive)] whitespace-nowrap">📎 {safeRender(selectedEvidence.label)}</span><button type="button" onClick={() => { SFX.soundClick(); setSelectedEvidence(null); }} className="text-[var(--destructive)] hover:text-white text-xs">✕</button></div>}
              <input ref={chatInputRef} value={chatDraft} onChange={(e) => {
                setChatDraft(e.target.value);
                // Broadcast typing indicator to the other detective (throttled).
                if (isMultiplayer) {
                  try {
                    if (!typingBroadcastRef.current) {
                      sendGame({ type: "detective.typing", content: { type: "detective.typing", playerId } });
                      typingBroadcastRef.current = setTimeout(() => { typingBroadcastRef.current = null; }, 1500);
                    }
                  } catch { /* ignore */ }
                }
              }} className="pixel-input flex-1 text-xs min-w-0" placeholder={selectedEvidence ? "Presentando evidencia..." : technique !== "neutral" ? `[${technique.toUpperCase()}] Pregunta...` : isMultiplayer ? "Propón una pregunta..." : "Pregunta al sospechoso..."} disabled={pending || suspectResponding || turnState.status === "reviewing"} />
              <button type="submit" disabled={pending || suspectResponding || !chatDraft.trim() || turnState.status === "reviewing"} className="pixel-btn text-xs px-3 sm:px-4 shrink-0 self-stretch">{pending || suspectResponding ? "..." : isMultiplayer ? "PROPONER" : "ENVIAR"}</button>
            </form>
          </section>

          {/* RIGHT: Tabbed panel */}
          <aside className="hidden md:flex flex-col w-72 border-l-2 border-[var(--border)] bg-[var(--card)] shrink-0">{rightTabsContent}</aside>

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
          <div className={cn("md:hidden flex-1 overflow-hidden flex flex-col", mobileTab !== "panel" && "hidden")}>{rightTabsContent}</div>
        </div>

        <div className="md:hidden flex border-t-2 border-[var(--border)] bg-[var(--card)]">
          {[{ key: "chat" as const, label: "💬 CHAT" }, { key: "sospechoso" as const, label: `${safeRender(suspect.avatar)} SOSPECHOSO` }, { key: "panel" as const, label: "📋 PANEL" }].map((tab) => (
            <button key={tab.key} onClick={() => { setMobileTab(tab.key); SFX.soundTab(); }} className={cn("flex-1 py-2 text-xs tracking-wider transition-colors cursor-pointer", mobileTab === tab.key ? "text-[var(--primary)] bg-[var(--primary)]/5 border-b-2 border-[var(--primary)]" : "text-[var(--muted-foreground)]")} style={bodyFont}>{tab.label}</button>
          ))}
        </div>

        {/* Audio settings modal */}
        {showAudioModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowAudioModal(false)}>
            <div className="pixel-frame max-w-sm w-full p-6 space-y-5 pixel-scale-in" style={bodyFont} onClick={(e) => e.stopPropagation()}>
              <div className="pixel-header"><span>CONFIGURACIÓN DE AUDIO</span></div>

              <div className="space-y-4">
                <div className="pixel-frame p-3">
                  <div className="text-xs text-[var(--foreground)] tracking-wider font-bold mb-2">EFECTOS DE SONIDO</div>
                  <div className="text-[11px] text-[var(--muted-foreground)] mb-3">Clicks, blips, estrés, logros</div>
                  <div className="flex gap-2">
                    <button onClick={() => { SFX.soundClick(); setSfxEnabled("on"); }} className={cn("pixel-frame flex-1 py-2 text-xs cursor-pointer", sfxEnabled === "on" && "pixel-frame-active")}>ACTIVADOS</button>
                    <button onClick={() => { setSfxEnabled("off"); }} className={cn("pixel-frame flex-1 py-2 text-xs cursor-pointer", sfxEnabled === "off" && "pixel-frame-active")}>DESACTIVADOS</button>
                  </div>
                </div>

                <div className="pixel-frame p-3">
                  <div className="text-xs text-[var(--foreground)] tracking-wider font-bold mb-2">MÚSICA AMBIENTAL</div>
                  <div className="text-[11px] text-[var(--muted-foreground)] mb-3">Música de fondo detective</div>
                  <div className="flex gap-2">
                    <button onClick={() => { SFX.soundClick(); setMusicEnabled("on"); }} className={cn("pixel-frame flex-1 py-2 text-xs cursor-pointer", musicEnabled === "on" && "pixel-frame-active")}>ACTIVADA</button>
                    <button onClick={() => { setMusicEnabled("off"); }} className={cn("pixel-frame flex-1 py-2 text-xs cursor-pointer", musicEnabled === "off" && "pixel-frame-active")}>DESACTIVADA</button>
                  </div>
                </div>

                <div className="pixel-frame p-3">
                  <div className="text-xs text-[var(--foreground)] tracking-wider font-bold mb-2">VOZ DEL SOSPECHOSO</div>
                  <div className="text-[11px] text-[var(--muted-foreground)] mb-3">El sospechoso habla en voz alta</div>
                  <div className="flex gap-2">
                    <button onClick={() => { SFX.soundClick(); setAiVoice("on"); }} className={cn("pixel-frame flex-1 py-2 text-xs cursor-pointer", aiVoice === "on" && "pixel-frame-active")}>ACTIVADA</button>
                    <button onClick={() => { setAiVoice("off"); }} className={cn("pixel-frame flex-1 py-2 text-xs cursor-pointer", aiVoice === "off" && "pixel-frame-active")}>DESACTIVADA</button>
                  </div>
                </div>
              </div>

              <button onClick={() => { SFX.soundClick(); setShowAudioModal(false); }} className="pixel-btn w-full py-3" style={headFont}>CERRAR</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ═══ RENDER: DELIBERATION ═══ */
  if (phase === "deliberation") {
    const unlockedEvidence = evidenceItems.filter((e) => !e.isLocked);
    return (
      <div className="h-screen flex flex-col overflow-hidden" style={bodyFont}>
        {AchievementOverlay}{EvidencePopupOverlay}
        <header className="border-b-2 border-[var(--border)] bg-[var(--card)] px-4 py-3 flex items-center justify-between">
          <div><div className="text-sm font-bold text-[var(--primary)] tracking-widest" style={headFont}>DELIBERACIÓN</div><div className="text-xs text-[var(--muted-foreground)] tracking-wider">Discute con tu compañero antes de votar</div></div>
          <div className="flex items-center gap-3"><PhaseIndicator current="deliberation" /><div className="text-xl font-bold text-[var(--primary)]" style={headFont}>⏱ {formatTime(delibTimeRemaining)}</div></div>
        </header>
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* LEFT — Evidence unlocked during interrogation */}
          <aside className="hidden md:flex flex-col w-80 border-r-2 border-[var(--border)] bg-[var(--card)] p-4 space-y-3 shrink-0">
            <div className="pixel-header"><span>EVIDENCIA DESCUBIERTA</span></div>
            <div className="space-y-2 pixel-scroll overflow-y-auto flex-1">
              {unlockedEvidence.length === 0 ? (
                <div className="text-xs text-[var(--muted-foreground)] italic text-center py-6">No desbloquearon evidencia.</div>
              ) : (
                unlockedEvidence.map((ev) => (
                  <div key={ev.id} className={cn("pixel-frame p-2", ev.isRedHerring && "border-l-2 border-[var(--destructive)]")}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm">{ev.isRedHerring ? "🔴" : "📄"}</span>
                      <span className="text-[13px] font-bold text-[var(--foreground)] tracking-wider">{safeRender(ev.label)}</span>
                    </div>
                    <p className="text-[12px] text-[var(--muted-foreground)] leading-relaxed">{safeRender(ev.description)}</p>
                  </div>
                ))
              )}
              <div className="border-t border-[var(--border)] pt-3 mt-2">
                <div className="text-[11px] text-[var(--muted-foreground)] tracking-wider mb-2">SOSPECHOSO</div>
                <div className="text-xs text-[var(--foreground)] flex items-center gap-2">
                  <span className="text-lg">{safeRender(currentCase?.suspect.avatar)}</span>
                  <div>
                    <div className="font-bold">{safeRender(currentCase?.suspect.name)}</div>
                    <div className="text-[12px] text-[var(--muted-foreground)]">{safeRender(currentCase?.suspect.role)}</div>
                  </div>
                </div>
              </div>
            </div>
            <button onClick={() => { SFX.soundClick(); skipToVote(); }} className="pixel-btn w-full py-3 mt-auto" style={headFont}>VOTAR AHORA</button>
          </aside>
          {/* RIGHT — Detective private chat (restored for deliberation) */}
          <section className="flex-1 flex flex-col min-h-0">
            <div className="px-3 py-2 border-b border-[var(--border)] bg-[var(--card)]">
              <div className="text-xs text-[var(--primary)] font-bold tracking-wider flex items-center gap-2">
                <span>CHAT PRIVADO — DETECTIVES</span>
                {otherTyping && <span className="text-[10px] text-[var(--muted-foreground)] italic flex items-center gap-1"><TypingIndicator /> escribiendo...</span>}
              </div>
              <div className="text-[10px] text-[var(--muted-foreground)] italic">Discutan sus conclusiones antes de votar</div>
            </div>
            <div className="flex-1 overflow-y-auto pixel-scroll-hide p-3 space-y-2">
              {detectiveMessages.length === 0 && <div className="text-center text-xs text-[var(--muted-foreground)] italic py-8">Sin mensajes todavía. Empieza la discusión...</div>}
              {detectiveMessages.map((dm, i) => (
                <div key={i} className={cn("flex flex-col", dm.detectiveId === playerId ? "items-end" : "items-start")}>
                  <div className="text-[12px] text-[var(--primary)] tracking-wider mb-1">[{safeRender(dm.detectiveName)}]</div>
                  <div className={cn("pixel-frame p-2.5 text-xs text-[var(--foreground)] max-w-[80%]", dm.detectiveId === playerId && "pixel-frame-active")}>{safeRender(dm.text)}</div>
                </div>
              ))}
              {otherTyping && (
                <div className="flex items-start">
                  <div className="pixel-frame p-2.5 text-xs text-[var(--muted-foreground)]">
                    <TypingIndicator />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <form onSubmit={handleSendDetective} className="border-t-2 border-[var(--border)] bg-[var(--card)] p-3 flex gap-2 shrink-0 items-stretch">
              <input
                value={detectiveDraft}
                onChange={(e) => {
                  setDetectiveDraft(e.target.value);
                  try {
                    if (!typingBroadcastRef.current) {
                      sendGame({ type: "detective.typing", content: { type: "detective.typing", playerId } });
                      typingBroadcastRef.current = setTimeout(() => { typingBroadcastRef.current = null; }, 1500);
                    }
                  } catch { /* ignore */ }
                }}
                className="pixel-input flex-1 text-xs min-w-0"
                placeholder="Mensaje al otro detective..."
                autoFocus
              />
              <button type="submit" className="pixel-btn text-xs px-4 py-2 shrink-0 self-stretch">ENVIAR</button>
            </form>
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
        {AchievementOverlay}{EvidencePopupOverlay}
        <div className="pixel-frame max-w-2xl w-full p-6 space-y-6 max-h-[90vh] overflow-y-auto pixel-scroll">
          <div className="pixel-header"><span>FASE DE VOTACIÓN</span></div>
          <div className="text-center">
            <div className="text-sm font-bold text-[var(--primary)] tracking-widest" style={headFont}>¿Es {safeRender(currentCase?.suspect.name)} culpable o inocente?</div>
            <div className="text-xs text-[var(--muted-foreground)] mt-1">Tu voto es definitivo. Revisa tu evidencia antes de decidir.</div>
          </div>

          {/* Evidence + stats summary so detectives can make an informed vote.
              Hidden on mobile to keep the vote screen focused. */}
          <div className="hidden md:grid grid-cols-4 gap-2">
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
              <div className="text-lg font-bold text-[var(--primary)]">{unlockedEvidence.length}</div>
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
              <div className="text-xs text-[var(--muted-foreground)] animate-pulse tracking-widest">
                {requiredVotes <= 1
                  ? "Procesando tu voto... la jueza deliberará en breve."
                  : `Esperando al otro detective... (${votes.length}/${requiredVotes})`}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => { SFX.soundClick(); setVoteChoice("guilty"); }} className={cn("p-4 text-center border-2 transition-all cursor-pointer", voteChoice === "guilty" ? "border-[var(--destructive)] bg-[var(--destructive)]/20 pixel-vote-glow" : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--destructive)]")}> <div className="text-2xl">⚖</div><div className="text-sm font-bold tracking-widest mt-2 text-[var(--destructive)]" style={headFont}>CULPABLE</div><div className="text-[12px] text-[var(--muted-foreground)] mt-1">Va a prisión</div></button>
                <button onClick={() => { SFX.soundClick(); setVoteChoice("innocent"); }} className={cn("p-4 text-center border-2 transition-all cursor-pointer", voteChoice === "innocent" ? "border-[#4ec9b0] bg-[#4ec9b0]/20 pixel-vote-glow" : "border-[var(--border)] bg-[var(--card)] hover:border-[#4ec9b0]")}><div className="text-2xl">🕊</div><div className="text-sm font-bold tracking-widest mt-2 text-[#4ec9b0]" style={headFont}>INOCENTE</div><div className="text-[12px] text-[var(--muted-foreground)] mt-1">Queda libre</div></button>
              </div>
              <div><label className="text-xs text-[var(--foreground)] tracking-wider block mb-1">RAZÓN DE TU VOTO</label><textarea value={voteReason} onChange={(e) => setVoteReason(e.target.value)} className="pixel-input w-full min-h-[80px] resize-none text-xs" placeholder="¿Por qué? Basa tu respuesta en la evidencia..." /></div>
              <div className="text-center pixel-scroll-arrow text-[var(--primary)] text-lg">▼</div>
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
        {AchievementOverlay}{EvidencePopupOverlay}
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
              <button onClick={() => { setPhase("revelation"); generateRevelation(); try { sendGame({ type: "game.phase", content: { type: "game.phase", phase: "revelation" } }); } catch { /* ignore */ } }} className="pixel-btn py-3 px-8" style={headFont}>REVELAR LA VERDAD</button>
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
    // Map culpability enum → human-readable Spanish labels (used in resumen table).
    const culpabilityLabels: Record<string, { label: string; color: string }> = {
      guilty:    { label: "CULPABLE",  color: "text-[var(--destructive)]" },
      innocent:  { label: "INOCENTE",  color: "text-[#4ec9b0]" },
      accomplice:{ label: "CÓMPLICE",  color: "text-[#fbbf24]" },
      witness:   { label: "TESTIGO",   color: "text-[#60a5fa]" },
    };
    const culp = revelation ? culpabilityLabels[revelation.culpability] ?? culpabilityLabels.innocent : culpabilityLabels.innocent;

    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-4" style={bodyFont}>
        {AchievementOverlay}{EvidencePopupOverlay}
        <div className="max-w-2xl w-full space-y-5 text-center">
          <div className="pixel-header"><span>LA VERDAD COMPLETA</span></div>

          {revelationLoading ? (
            <div className="pixel-frame p-8"><div className="text-sm text-[var(--primary)] animate-pulse tracking-widest">REVELANDO LA VERDAD...</div></div>
          ) : revelation && verdict ? (
            <>
              {/* BANNER — acertaron o se equivocaron (sin tick) */}
              <div className={cn("pixel-frame p-6 border-2", verdict.majorityCorrect ? "border-[#4ec9b0] bg-[#4ec9b0]/5" : "border-[var(--destructive)] bg-[var(--destructive)]/5")}>
                <div className={cn("text-2xl md:text-3xl font-bold tracking-widest", verdict.majorityCorrect ? "text-[#4ec9b0]" : "text-[var(--destructive)]")} style={headFont}>
                  {verdict.majorityCorrect ? "ACERTARON" : "SE EQUIVOCARON"}
                </div>
              </div>

              {/* Resumen — decision vs realidad (sin título grande de CÓMPLICE) */}
              <div className="pixel-frame p-4">
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
                <div className="text-xs text-[var(--primary)] mb-2 tracking-wider" style={headFont}>LO QUE REALMENTE SUCEDIÓ</div>
                <p className="text-sm text-[var(--foreground)] leading-relaxed">{safeRender(revelation.truth)}</p>
              </div>

              {/* Coartada */}
              {revelation.alibiClaimed && revelation.alibiActual && (
                <div className="pixel-frame p-5 text-left">
                  <div className="text-xs text-[var(--primary)] mb-3 tracking-wider" style={headFont}>COARTADA</div>
                  <div className="space-y-3">
                    <div>
                      <div className="text-[11px] text-[var(--muted-foreground)] tracking-wider mb-1">LO QUE DECLARÓ</div>
                      <p className="text-xs text-[var(--foreground)] leading-relaxed italic">"{safeRender(revelation.alibiClaimed)}"</p>
                    </div>
                    <div className="border-t border-[var(--border)] pt-3">
                      <div className="text-[11px] text-[var(--destructive)] tracking-wider mb-1">LO QUE REALMENTE HACÍA</div>
                      <p className="text-xs text-[var(--foreground)] leading-relaxed italic">"{safeRender(revelation.alibiActual)}"</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Evidencia */}
              {revelation.evidence.length > 0 && (
                <div className="pixel-frame p-5 text-left">
                  <div className="text-xs text-[var(--primary)] mb-3 tracking-wider" style={headFont}>EVIDENCIA ({revelation.evidence.length})</div>
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

              <button onClick={() => { setPhase("results"); try { sendGame({ type: "game.phase", content: { type: "game.phase", phase: "results" } }); } catch { /* ignore */ } }} className="pixel-btn py-3 px-8" style={headFont}>VER RESULTADOS</button>
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
        {AchievementOverlay}{EvidencePopupOverlay}
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

          <button onClick={() => { SFX.soundClick(); playAgain(); }} className="pixel-btn py-3 px-8" style={headFont}>JUGAR DE NUEVO</button>
        </div>
      </main>
    );
  }

  return <main className="min-h-screen flex items-center justify-center" style={bodyFont}><div className="pixel-frame p-6 text-center"><div className="text-xs text-[var(--muted-foreground)]">Cargando...</div></div></main>;
}
