"use client";

/**
 * BiometricBar — single horizontal metric bar (stress / bpm / coherence).
 *
 * Animated width transitions give the "live telemetry" feel. Color shifts with
 * the severity band so you can read the state at a glance.
 */

import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  /** "low-good" → green at low values, red at high. "high-good" → inverse. */
  polarity: "low-good" | "high-good";
  trigger?: string;
}

export function BiometricBar({
  label,
  value,
  min,
  max,
  unit,
  polarity,
  trigger,
}: Props) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  const normalized = pct / 100; // 0..1

  const severity =
    polarity === "low-good"
      ? normalized < 0.3
        ? "ok"
        : normalized < 0.6
        ? "warn"
        : normalized < 0.85
        ? "high"
        : "crit"
      : 1 - normalized < 0.3
      ? "crit"
      : 1 - normalized < 0.6
      ? "high"
      : 1 - normalized < 0.85
      ? "warn"
      : "ok";

  const barColor =
    severity === "ok"
      ? "bg-emerald-500"
      : severity === "warn"
      ? "bg-amber-500"
      : severity === "high"
      ? "bg-orange-500"
      : "bg-red-500";

  const pulseClass = severity === "crit" ? "noir-pulse" : "";

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
          {label}
        </span>
        <span className="text-xs font-bold tabular-nums text-foreground">
          {Math.round(value)}
          {unit && (
            <span className="ml-1 text-[9px] text-muted-foreground">{unit}</span>
          )}
        </span>
      </div>
      <div className="h-1.5 bg-zinc-900 relative overflow-hidden border border-border">
        <div
          className={cn("h-full transition-all duration-500 ease-out", barColor, pulseClass)}
          style={{ width: `${pct}%` }}
        />
        {/* Tick marks at 25/50/75% */}
        <div className="absolute inset-0 flex justify-between pointer-events-none">
          {[25, 50, 75].map((p) => (
            <div
              key={p}
              className="w-px h-full bg-zinc-700/40"
              style={{ marginLeft: `${p}%` }}
            />
          ))}
        </div>
      </div>
      {trigger && (
        <div className="text-[9px] text-red-500 tracking-widest">
          ▸ {trigger}
        </div>
      )}
    </div>
  );
}
