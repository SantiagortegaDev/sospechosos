"use client";

/**
 * CaseGeneratorScreen — Minecraft-style "generating world" screen.
 *
 * Flow:
 *   1. User arrives with a seed (random or entered).
 *   2. We POST to /api/generate-case with the seed.
 *   3. While the LLM is generating, we cycle through fake "generation steps"
 *      so the screen feels alive:
 *        "Generando crimen..."
 *        "Generando sospechoso..."
 *        "Generando evidencia..."
 *        "Generando mentiras..."
 *        "Generando tensiones..."
 *        "Caso listo!"
 *   4. When the API responds, we show a "Caso listo" beat, then
 *      auto-transition after a short delay.
 *
 * The seed is visible at the top: "SEED: 4827193". The user can click
 * "GENERAR NUEVO CASO" to reroll, or type a specific seed.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { GeneratedCase } from "@/lib/ai/generated-case";
import { randomSeedString } from "@/lib/ai/rng";
import { cn } from "@/lib/utils";

interface Props {
  initialSeed?: string;
  onCaseReady: (c: GeneratedCase) => void;
  onBack: () => void;
}

const STEPS = [
  { label: "Generando crimen...", duration: 800 },
  { label: "Generando sospechoso...", duration: 1000 },
  { label: "Generando evidencia...", duration: 700 },
  { label: "Generando mentiras...", duration: 900 },
  { label: "Generando tensiones...", duration: 700 },
  { label: "Caso listo!", duration: 800 },
];

export function CaseGeneratorScreen({ initialSeed, onCaseReady, onBack: _onBack }: Props) {
  const [seed, setSeed] = useState(initialSeed || randomSeedString());
  const [stepIdx, setStepIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const caseReceivedRef = useRef<GeneratedCase | null>(null);
  const stepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepIdxRef = useRef(0); // ref to avoid stale closure bug
  const loadingRef = useRef(false);
  const onCaseReadyRef = useRef(onCaseReady);

  // Keep ref in sync
  useEffect(() => { onCaseReadyRef.current = onCaseReady; }, [onCaseReady]);
  useEffect(() => { stepIdxRef.current = stepIdx; }, [stepIdx]);
  useEffect(() => { loadingRef.current = loading; }, [loading]);

  const runSteps = useCallback(() => {
    setStepIdx(0);
    stepIdxRef.current = 0;
    setProgress(0);
    let elapsed = 0;
    const totalDuration = STEPS.reduce((s, st) => s + st.duration, 0);

    const advance = (idx: number) => {
      if (idx >= STEPS.length) {
        // All visual steps done — mark completion and check if case is ready
        stepIdxRef.current = STEPS.length;
        if (caseReceivedRef.current) {
          setTimeout(() => {
            if (caseReceivedRef.current) {
              onCaseReadyRef.current(caseReceivedRef.current);
            }
            setLoading(false);
            loadingRef.current = false;
          }, 500);
        }
        return;
      }
      setStepIdx(idx);
      stepIdxRef.current = idx;
      elapsed += STEPS[idx].duration;
      setProgress(Math.min(100, Math.round((elapsed / totalDuration) * 100)));
      stepTimerRef.current = setTimeout(() => advance(idx + 1), STEPS[idx].duration);
    };
    advance(0);
  }, []);

  const generate = useCallback(
    async (seedToUse: string) => {
      setLoading(true);
      loadingRef.current = true;
      setError(null);
      caseReceivedRef.current = null;
      runSteps();

      try {
        const res = await fetch("/api/generate-case", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seed: seedToUse }),
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          if (res.status === 429 || errBody.error === "rate_limited") {
            throw new Error(
              "Límite de Gemini alcanzado. Espera unos minutos o usa una seed ya generada."
            );
          }
          throw new Error(errBody.error || errBody.detail || `HTTP ${res.status}`);
        }
        const data = (await res.json()) as GeneratedCase;
        caseReceivedRef.current = data;

        // If visual steps already finished (or are on the last one), hand off.
        // Otherwise, the advance() function will check when done.
        if (stepIdxRef.current >= STEPS.length - 1) {
          setTimeout(() => {
            if (caseReceivedRef.current) {
              onCaseReadyRef.current(caseReceivedRef.current);
            }
            setLoading(false);
            loadingRef.current = false;
          }, 500);
        }
      } catch (err) {
        setError(`No se pudo generar el caso: ${(err as Error).message}`);
        setLoading(false);
        loadingRef.current = false;
        if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
      }
    },
    [runSteps]
  );

  // Kick off generation on mount.
  useEffect(() => {
    void generate(seed);
    return () => {
      if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
    };
  }, []);

  function reroll() {
    if (loadingRef.current) return;
    const next = randomSeedString();
    setSeed(next);
    void generate(next);
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 relative pixel-fade-in">
      <div className="w-full max-w-xl">
        {/* Seed display */}
        <div className="text-center mb-4 pixel-slide-in-up">
          <div className="text-sm tracking-[0.3em] text-[var(--primary)] font-bold">
            GENERANDO CASO..
          </div>
          <div className="text-[10px] tracking-[0.3em] text-[var(--muted-foreground)] mt-1">
            SEMILLA: {seed}
          </div>
        </div>

        {/* Generation panel */}
        <div className={cn(
          "pixel-frame p-6 pixel-scale-in",
          caseReceivedRef.current && !loadingRef.current && "pixel-ready-border pixel-ready-flash"
        )}>
          <div className="pixel-header mb-4">
            <span>{loading ? "GENERANDO CASO" : caseReceivedRef.current ? "CASO LISTO" : "ERROR"}</span>
          </div>

          {/* Steps list */}
          <div className="space-y-2 mb-4 min-h-[180px]">
            {STEPS.map((step, i) => {
              const isDone = i < stepIdxRef.current;
              const isCurrent = i === stepIdxRef.current && loading;
              const isPending = i > stepIdxRef.current;
              return (
                <div
                  key={i}
                  className={cn(
                    "flex items-center gap-3 text-xs transition-all duration-300",
                    isPending ? "opacity-20" : "opacity-100",
                    isCurrent && "translate-x-1",
                    isDone && "pixel-evidence-flash"
                  )}
                >
                  <span
                    className={cn(
                      "w-4 h-4 flex items-center justify-center text-[13px] transition-all duration-200",
                      isDone
                        ? "text-[#4ec9b0]"
                        : isCurrent
                        ? "text-[#7dd3fc] pixel-pulse"
                        : "text-[var(--muted-foreground)]"
                    )}
                  >
                    {isDone ? "[OK]" : isCurrent ? "[>]" : "-"}
                  </span>
                  <span
                    className={cn(
                      "transition-all duration-200",
                      isDone
                        ? "text-[#4ec9b0]"
                        : isCurrent
                        ? "text-[#7dd3fc] font-bold"
                        : "text-[var(--muted-foreground)]"
                    )}
                  >
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Pixel progress bar */}
          <div className="pixel-stress-bar mb-4">
            <div
              className="pixel-stress-bar-fill stress"
              style={{ width: `${progress}%` }}
            />
          </div>

          {error && (
            <div className="text-[11px] text-red-400 mb-4 p-2 border border-red-500/40 bg-red-500/10 pixel-scale-in">
              {error}
            </div>
          )}

          {/* Reroll button */}
          <div className="pt-3 border-t border-[var(--border)]">
            <button
              onClick={reroll}
              disabled={loading}
              className="pixel-btn-secondary w-full py-2 text-xs tracking-wider"
            >
              {loading ? "GENERANDO..." : "GENERAR NUEVO CASO"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
