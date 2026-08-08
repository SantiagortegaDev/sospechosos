"use client";

/**
 * DashboardShell — wires the three-column layout together.
 *
 * State ownership:
 *   - activeSuspectId: which suspect is currently being interrogated. Local.
 *   - previousBiometrics: the latest biometric state per suspect, lifted here so
 *     the InterrogationFeed can pass it to the backend as "previous" for delta
 *     calc, and the SubjectPanel can render it instantly.
 *
 * The detective's display name is derived from a stable random handle so two
 * browser tabs in the same room get different names. (Portal's anonymous
 * identity is separate — it's the wire-level sender id.)
 */

import { useState, useMemo, useEffect } from "react";
import { CaseHeader } from "./case-header";
import { SuspectSelector } from "./suspect-selector";
import { SubjectPanel } from "./subject-panel";
import { InterrogationFeed } from "./interrogation-feed";
import { EvidenceBoard } from "./evidence-board";
import { ClandestineSniffer } from "./clandestine-sniffer";
import { PrivateDetectiveChat } from "./private-detective-chat";
import { useBiometricStream } from "@/hooks/use-biometric-stream";
import { SUSPECTS } from "@/lib/ai/suspects";
import type { BiometricState } from "@/lib/ai/biometrics";

const DETECTIVE_NAMES = [
  "DETECTIVE-HARLOW",
  "DETECTIVE-OKONKWO",
  "DETECTIVE-REYES",
  "DETECTIVE-VOSS-2",
];
const DETECTIVE_COLORS = ["#ffb000", "#4ec9b0"];

export function DashboardShell() {
  const [activeSuspectId, setActiveSuspectId] = useState(SUSPECTS[0].id);
  const [previousBiometrics, setPreviousBiometrics] = useState<
    BiometricState | undefined
  >();

  const { biometrics, publish: publishBiometric } = useBiometricStream();

  // Pick a stable detective name per browser tab (sessionStorage so refresh
  // keeps the same identity within the tab's lifetime).
  const { name, color } = useMemo(() => {
    if (typeof window === "undefined") {
      return { name: DETECTIVE_NAMES[0], color: DETECTIVE_COLORS[0] };
    }
    let idx = Number(sessionStorage.getItem("sospechosos:det-idx"));
    if (!Number.isFinite(idx) || idx < 0 || idx >= DETECTIVE_NAMES.length) {
      idx = Math.floor(Math.random() * DETECTIVE_NAMES.length);
      sessionStorage.setItem("sospechosos:det-idx", String(idx));
    }
    return {
      name: DETECTIVE_NAMES[idx],
      color: DETECTIVE_COLORS[idx % DETECTIVE_COLORS.length],
    };
  }, []);

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

  return (
    <div className="min-h-screen flex flex-col p-2 gap-2">
      <CaseHeader activeSuspectId={activeSuspectId} />

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[260px_1fr_1fr] gap-2 min-h-0">
        {/* Column 1 — subject roster + telemetry */}
        <div className="flex flex-col gap-2 min-h-0">
          <SuspectSelector
            activeSuspectId={activeSuspectId}
            onSelect={setActiveSuspectId}
            biometrics={biometrics}
          />
          <div className="flex-1 min-h-0">
            <SubjectPanel suspectId={activeSuspectId} biometrics={biometrics} />
          </div>
        </div>

        {/* Column 2 — central interrogation feed */}
        <div className="min-h-0">
          <InterrogationFeed
            activeSuspectId={activeSuspectId}
            detectiveName={name}
            previousBiometrics={previousBiometrics}
            onBiometricsUpdate={(state) => setPreviousBiometrics(state)}
            publishBiometric={publishBiometric}
          />
        </div>

        {/* Column 3 — evidence board + clandestine sniffer + private chat */}
        <div className="grid grid-rows-[1.4fr_0.6fr_1fr] gap-2 min-h-0">
          <EvidenceBoard detectiveName={name} color={color} />
          <ClandestineSniffer activeSuspectId={activeSuspectId} />
          <PrivateDetectiveChat detectiveName={name} />
        </div>
      </div>

      <Footer />
    </div>
  );
}

function Footer() {
  return (
    <footer className="text-[9px] tracking-[0.2em] text-muted-foreground flex items-center justify-between px-2 py-1 border-t border-border">
      <span>THE INTERROGATION ROOM // v0.1 // PORTAL REALTIME</span>
      <span>
        2 DETECTIVES · 3 SUSPECTS · 1 TRUTH
      </span>
    </footer>
  );
}
