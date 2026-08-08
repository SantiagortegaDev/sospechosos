"use client";

/**
 * SubjectPanel — Column 1.
 *
 * Renders the active suspect's identity block + their live biometric telemetry
 * (stress / bpm / coherence). The biometric values come from the parent, which
 * subscribes to the biometrics channel — so when one detective interrogates,
 * both detectives' Column 1 updates in real time.
 */

import { SUSPECTS } from "@/lib/ai/suspects";
import type { BiometricMap } from "@/hooks/use-biometric-stream";
import { BiometricBar } from "./biometric-bar";
import { cn } from "@/lib/utils";

interface Props {
  suspectId: string;
  biometrics: BiometricMap;
}

export function SubjectPanel({ suspectId, biometrics }: Props) {
  const suspect = SUSPECTS.find((s) => s.id === suspectId);
  if (!suspect) return null;

  const bio = biometrics[suspectId];
  const stress = bio?.stress ?? suspect.baseline.stress;
  const bpm = bio?.bpm ?? suspect.baseline.bpm;
  const coherence = bio?.coherence ?? suspect.baseline.coherence;
  const trigger = bio?.trigger;

  const stressSeverity =
    stress < 30 ? "STABLE" : stress < 60 ? "ELEVATED" : stress < 85 ? "AGITATED" : "CRITICAL";

  return (
    <div className="noir-frame flex flex-col h-full">
      <div className="noir-header">
        <span>SUBJECT // TELEMETRY</span>
        <span className="ml-auto text-red-500 normal-case tracking-normal text-[10px] flex items-center gap-1">
          <span className="noir-live-dot" />
          REC
        </span>
      </div>

      {/* Identity block */}
      <div className="p-4 border-b border-border flex items-center gap-4">
        <div
          className={cn(
            "w-16 h-16 flex items-center justify-center text-2xl font-bold border-2",
            stress > 70
              ? "bg-red-500/10 text-red-500 border-red-500/50"
              : "bg-zinc-900 text-amber-500 border-amber-500/50"
          )}
        >
          {suspect.avatar}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-bold tracking-widest text-foreground">
            {suspect.name}
          </div>
          <div className="text-[10px] text-muted-foreground tracking-wider mt-0.5">
            {suspect.role}
          </div>
          <div className="text-[10px] text-amber-500 tracking-widest mt-2">
            STATUS: <span className="font-bold">{stressSeverity}</span>
          </div>
        </div>
      </div>

      {/* Biometric telemetry */}
      <div className="p-4 space-y-4 flex-1">
        <BiometricBar
          label="Stress"
          value={stress}
          min={0}
          max={100}
          unit="%"
          polarity="low-good"
          trigger={trigger}
        />
        <BiometricBar
          label="Heart Rate"
          value={bpm}
          min={50}
          max={180}
          unit="BPM"
          polarity="low-good"
        />
        <BiometricBar
          label="Coherence"
          value={coherence}
          min={0}
          max={100}
          unit="%"
          polarity="high-good"
        />

        {/* Baseline reference */}
        <div className="pt-3 mt-3 border-t border-border text-[10px] text-muted-foreground space-y-1">
          <div className="tracking-[0.18em]">▸ BASELINE (RESTING)</div>
          <div className="grid grid-cols-3 gap-2 tabular-nums">
            <span>S {suspect.baseline.stress}%</span>
            <span>{suspect.baseline.bpm} BPM</span>
            <span>C {suspect.baseline.coherence}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
