"use client";

/**
 * DashboardShell — wires the three-column layout together.
 *
 * State ownership:
 *   - username: detective handle (from login screen, stored in sessionStorage)
 *   - roomCode: shared room identifier (from login, stored in sessionStorage)
 *   - channels: derived from roomCode via channelIdsFor()
 *   - activeSuspectId: which suspect is currently being interrogated
 *   - previousBiometrics: latest biometric state per suspect, lifted here so
 *     the InterrogationFeed can pass it to the backend as "previous" for delta
 *     calc, and the SubjectPanel can render it instantly.
 *   - latestQuestion: the most recent question text — surfaced to the AI-tick
 *     endpoint as context for autonomous event generation.
 *
 * Host responsibility: the first detective to join runs a setInterval that
 * calls /api/ai-tick every ~25 seconds. The tick returns an autonomous AI
 * event (thought/interjection/question); the host publishes it to the
 * ai-events channel so both detectives see it. Non-hosts just listen.
 */

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { channelIdsFor, type ChannelBundle } from "@/lib/portal/channels";
import { SUSPECTS } from "@/lib/ai/suspects";
import type { BiometricState } from "@/lib/ai/biometrics";
import { LoginScreen } from "./login-screen";
import { CaseHeader } from "./case-header";
import { SuspectSelector } from "./suspect-selector";
import { SubjectPanel } from "./subject-panel";
import { InterrogationFeed } from "./interrogation-feed";
import { EvidenceBoard } from "./evidence-board";
import { ClandestineSniffer } from "./clandestine-sniffer";
import { PrivateDetectiveChat } from "./private-detective-chat";
import { useBiometricStream } from "@/hooks/use-biometric-stream";
import { useAIEvents } from "@/hooks/use-ai-events";
import { useIsHost } from "@/hooks/use-is-host";

const STORAGE_KEY = "sospechosos:session";
const AI_TICK_INTERVAL_MS = 25_000; // autonomous AI event every ~25s
const DETECTIVE_COLORS = ["#ffb000", "#4ec9b0"];

interface Session {
  username: string;
  roomCode: string;
}

function loadSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed.username || !parsed.roomCode) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveSession(s: Session) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

function clearSession() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(STORAGE_KEY);
}

export function DashboardShell() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [activeSuspectId, setActiveSuspectId] = useState(SUSPECTS[0].id);
  const [previousBiometrics, setPreviousBiometrics] = useState<
    BiometricState | undefined
  >();
  const [latestQuestion, setLatestQuestion] = useState<string>("");

  const channels: ChannelBundle | null = useMemo(
    () => (session ? channelIdsFor(session.roomCode) : null),
    [session]
  );

  // Pick a stable color per username so the two detectives have different
  // cursor colors on the evidence board.
  const detectiveColor = useMemo(() => {
    if (!session) return DETECTIVE_COLORS[0];
    // Simple hash → pick one of two colors. Two distinct usernames almost
    // always end up with different colors.
    const h = session.username
      .split("")
      .reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return DETECTIVE_COLORS[h % DETECTIVE_COLORS.length];
  }, [session]);

  if (!session || !channels) {
    return (
      <LoginScreen
        onJoin={(username, roomCode) => {
          saveSession({ username, roomCode });
          setSession({ username, roomCode });
        }}
      />
    );
  }

  return (
    <DashboardInner
      session={session}
      channels={channels}
      detectiveColor={detectiveColor}
      activeSuspectId={activeSuspectId}
      setActiveSuspectId={setActiveSuspectId}
      previousBiometrics={previousBiometrics}
      setPreviousBiometrics={setPreviousBiometrics}
      latestQuestion={latestQuestion}
      setLatestQuestion={setLatestQuestion}
      onLeave={() => {
        clearSession();
        setSession(null);
      }}
    />
  );
}

interface InnerProps {
  session: Session;
  channels: ChannelBundle;
  detectiveColor: string;
  activeSuspectId: string;
  setActiveSuspectId: (id: string) => void;
  previousBiometrics?: BiometricState;
  setPreviousBiometrics: (s: BiometricState) => void;
  latestQuestion: string;
  setLatestQuestion: (s: string) => void;
  onLeave: () => void;
}

function DashboardInner({
  session,
  channels,
  detectiveColor,
  activeSuspectId,
  setActiveSuspectId,
  previousBiometrics,
  setPreviousBiometrics,
  latestQuestion,
  setLatestQuestion,
  onLeave,
}: InnerProps) {
  const { biometrics, publish: publishBiometric } = useBiometricStream(channels);
  const { events: aiEvents, publish: publishAIEvent } = useAIEvents(channels);
  const { isHost } = useIsHost(channels);
  const tickInFlight = useRef(false);

  // When the active suspect changes, refresh the local "previous" biometrics
  // snapshot from the stream map so the delta engine starts from the right state.
  useEffect(() => {
    const live = biometrics[activeSuspectId];
    if (live) {
      setPreviousBiometrics({
        suspectId: live.suspectId,
        stress: live.stress,
        bpm: live.bpm,
        coherence: live.coherence,
      });
    } else {
      const base = SUSPECTS.find((s) => s.id === activeSuspectId)?.baseline;
      if (base) {
        setPreviousBiometrics({
          suspectId: activeSuspectId,
          ...base,
        });
      }
    }
  }, [activeSuspectId, biometrics]);

  // Host-only AI tick loop. Runs every AI_TICK_INTERVAL_MS, calls the
  // /api/ai-tick endpoint, and publishes the resulting event to the ai-events
  // channel. Non-hosts listen via useAIEvents and never run the loop.
  const runTick = useCallback(async () => {
    if (tickInFlight.current) return;
    tickInFlight.current = true;
    try {
      const res = await fetch("/api/ai-tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suspectIds: SUSPECTS.map((s) => s.id),
          recentContext: latestQuestion
            ? `Last question asked: "${latestQuestion}"`
            : "The room has been silent.",
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.skipped) return;
      if (data.event) {
        await publishAIEvent({ ...data.event, at: Date.now() });
      }
    } catch (err) {
       
      console.error("[ai-tick] failed:", err);
    } finally {
      tickInFlight.current = false;
    }
  }, [latestQuestion, publishAIEvent]);

  useEffect(() => {
    if (!isHost) return;
    // First tick after a short delay so the room has time to settle.
    const initialDelay = setTimeout(runTick, 8_000);
    const interval = setInterval(runTick, AI_TICK_INTERVAL_MS);
    return () => {
      clearTimeout(initialDelay);
      clearInterval(interval);
    };
  }, [isHost, runTick]);

  return (
    <div className="min-h-screen flex flex-col p-2 gap-2">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <CaseHeader
            channels={channels}
            activeSuspectId={activeSuspectId}
            username={session.username}
            roomCode={session.roomCode}
          />
        </div>
        <button
          onClick={onLeave}
          className="px-3 py-2 text-[10px] tracking-[0.2em] font-bold border border-zinc-700 text-muted-foreground hover:text-red-500 hover:border-red-500/50 transition-colors noir-frame"
          title="Leave room and return to login"
        >
          ◂ LEAVE
        </button>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[260px_1fr_1fr] gap-2 min-h-0">
        {/* Column 1 — subject roster + telemetry */}
        <div className="flex flex-col gap-2 min-h-0">
          <SuspectSelector
            activeSuspectId={activeSuspectId}
            onSelect={setActiveSuspectId}
            biometrics={biometrics}
            aiEvents={aiEvents}
          />
          <div className="flex-1 min-h-0">
            <SubjectPanel
              suspectId={activeSuspectId}
              biometrics={biometrics}
              aiEvents={aiEvents}
            />
          </div>
        </div>

        {/* Column 2 — central interrogation feed */}
        <div className="min-h-0">
          <InterrogationFeed
            channels={channels}
            activeSuspectId={activeSuspectId}
            detectiveName={session.username}
            previousBiometrics={previousBiometrics}
            onBiometricsUpdate={(state) => setPreviousBiometrics(state)}
            publishBiometric={publishBiometric}
            onQuestionAsked={setLatestQuestion}
          />
        </div>

        {/* Column 3 — evidence board + clandestine sniffer + private chat */}
        <div className="grid grid-rows-[1.4fr_0.6fr_1fr] gap-2 min-h-0">
          <EvidenceBoard
            channels={channels}
            detectiveName={session.username}
            color={detectiveColor}
          />
          <ClandestineSniffer channels={channels} />
          <PrivateDetectiveChat
            channels={channels}
            detectiveName={session.username}
          />
        </div>
      </div>

      <Footer isHost={isHost} />
    </div>
  );
}

function Footer({ isHost }: { isHost: boolean }) {
  return (
    <footer className="text-[9px] tracking-[0.2em] text-muted-foreground flex items-center justify-between px-2 py-1 border-t border-border">
      <span>THE INTERROGATION ROOM // v0.2 // PORTAL REALTIME · GROQ</span>
      <span>
        {isHost ? "HOST · AI TICK ON" : "GUEST · LISTENING"} · 2 DETECTIVES · 2 SUSPECTS · 1 TRUTH
      </span>
    </footer>
  );
}
