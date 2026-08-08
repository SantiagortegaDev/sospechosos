"use client";

/**
 * SuspectSelector — sidebar of selectable suspects.
 *
 * Clicking a suspect switches the active subject in the dashboard. The
 * selection lives in parent state (the dashboard shell) — Portal channels
 * don't need to know which suspect is "active" because each interrogate API
 * call carries the suspectId explicitly.
 */

import { SUSPECTS } from "@/lib/ai/suspects";
import type { BiometricMap } from "@/hooks/use-biometric-stream";
import { cn } from "@/lib/utils";

interface Props {
  activeSuspectId: string;
  onSelect: (id: string) => void;
  biometrics: BiometricMap;
}

export function SuspectSelector({ activeSuspectId, onSelect, biometrics }: Props) {
  return (
    <div className="noir-frame">
      <div className="noir-header">
        <span>SUBJECTS // ROSTER</span>
      </div>
      <ul className="divide-y divide-border">
        {SUSPECTS.map((s) => {
          const bio = biometrics[s.id];
          const isActive = s.id === activeSuspectId;
          const stress = bio?.stress ?? s.baseline.stress;
          return (
            <li key={s.id}>
              <button
                onClick={() => onSelect(s.id)}
                className={cn(
                  "w-full text-left px-3 py-3 flex items-center gap-3 transition-colors",
                  isActive
                    ? "bg-amber-500/10 border-l-2 border-l-amber-500"
                    : "hover:bg-zinc-900/60 border-l-2 border-l-transparent"
                )}
              >
                <div
                  className={cn(
                    "w-8 h-8 flex items-center justify-center text-sm font-bold border",
                    isActive
                      ? "bg-amber-500 text-zinc-950 border-amber-500"
                      : "bg-zinc-900 text-amber-500 border-zinc-700"
                  )}
                >
                  {s.avatar}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={cn(
                    "text-xs font-bold tracking-widest truncate",
                    isActive ? "text-amber-500" : "text-foreground"
                  )}>
                    {s.name}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {s.role}
                  </div>
                </div>
                <StressPip stress={stress} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StressPip({ stress }: { stress: number }) {
  const level =
    stress < 30 ? "low" : stress < 60 ? "med" : stress < 85 ? "high" : "crit";
  const color =
    level === "low"
      ? "bg-emerald-500"
      : level === "med"
      ? "bg-amber-500"
      : level === "high"
      ? "bg-orange-500"
      : "bg-red-500";
  return (
    <div className="flex flex-col items-end gap-0.5">
      <div className={cn("w-1.5 h-1.5 rounded-full", color, level === "crit" && "noir-pulse")} />
      <div className="text-[9px] text-muted-foreground">
        {Math.round(stress)}%
      </div>
    </div>
  );
}
