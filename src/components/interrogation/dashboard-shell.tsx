"use client";

import { useEffect, useMemo, useState } from "react";
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

const DETECTIVES = ["HARLOW", "OKONKWO", "REYES", "MORA"];
const COLORS = ["#f5b942", "#75b7a9", "#bb9ee8", "#e08b65"];

export function DashboardShell() {
  const [activeSuspectId, setActiveSuspectId] = useState(SUSPECTS[0].id);
  const [previousBiometrics, setPreviousBiometrics] = useState<BiometricState>();
  const { biometrics, publish } = useBiometricStream();
  const detective = useMemo(() => {
    if (typeof window === "undefined") return { name: DETECTIVES[0], color: COLORS[0] };
    const key = "sospechosos:detective";
    let index = Number(sessionStorage.getItem(key));
    if (!Number.isInteger(index) || index < 0 || index >= DETECTIVES.length) { index = Math.floor(Math.random() * DETECTIVES.length); sessionStorage.setItem(key, String(index)); }
    return { name: `DET. ${DETECTIVES[index]}`, color: COLORS[index] };
  }, []);
  useEffect(() => { const live = biometrics[activeSuspectId]; const baseline = SUSPECTS.find((item) => item.id === activeSuspectId)?.baseline; const update = window.setTimeout(() => { if (live) setPreviousBiometrics({ suspectId: live.suspectId, stress: live.stress, bpm: live.bpm, coherence: live.coherence }); else if (baseline) setPreviousBiometrics({ suspectId: activeSuspectId, ...baseline }); }, 0); return () => window.clearTimeout(update); }, [activeSuspectId, biometrics]);

  return <main className="min-h-screen bg-[#0c0f10] p-3 text-stone-100 sm:p-5"><div className="mx-auto grid max-w-7xl gap-3">
    <CaseHeader activeSuspectId={activeSuspectId} />
    <div className="grid min-h-[680px] gap-3 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="space-y-3"><SuspectSelector activeSuspectId={activeSuspectId} onSelect={setActiveSuspectId} biometrics={biometrics} /><div className="hidden lg:block"><SubjectPanel suspectId={activeSuspectId} biometrics={biometrics} /></div></aside>
      <section className="grid min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_300px]"><InterrogationFeed activeSuspectId={activeSuspectId} detectiveName={detective.name} previousBiometrics={previousBiometrics} onBiometricsUpdate={setPreviousBiometrics} publishBiometric={publish} /><aside className="grid grid-rows-[minmax(220px,1fr)_auto_auto] gap-3"><EvidenceBoard detectiveName={detective.name} color={detective.color} /><ClandestineSniffer activeSuspectId={activeSuspectId} /><PrivateDetectiveChat detectiveName={detective.name} /></aside></section>
    </div>
    <div className="lg:hidden"><SubjectPanel suspectId={activeSuspectId} biometrics={biometrics} /></div>
    <footer className="flex flex-wrap justify-between gap-2 px-1 text-xs text-stone-500"><span>LOS SOSPECHOSOS · INTERROGACIÓN COOPERATIVA EN VIVO</span><span>PORTAL · 2+ DETECTIVES · UNA HISTORIA QUE SE ROMPE</span></footer>
  </div></main>;
}
