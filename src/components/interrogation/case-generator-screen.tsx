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
 *        "Caso listo ✓"
 *   4. When the API responds, we show a 1.5s "Caso listo" beat, then call
 *      onCaseReady(case) so the parent can transition to the case intro.
 *
 * The seed is visible at the top: "SEED: 4827193". The user can click
 * "GENERAR NUEVO CASO" to reroll, or type a specific seed.
 */

import { useState, useEffect, useRef, useCallback, type FormEvent } from "react";
import type { GeneratedCase } from "@/lib/ai/generated-case";
import { randomSeedString } from "@/lib/ai/rng";

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
  { label: "Caso listo ✓", duration: 800 },
];

export function CaseGeneratorScreen({ initialSeed, onCaseReady, onBack }: Props) {
  const [seed, setSeed] = useState(initialSeed || randomSeedString());
  const [seedInput, setSeedInput] = useState("");
  const [stepIdx, setStepIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0); // 0..100 pixel bar
  const caseReceivedRef = useRef<GeneratedCase | null>(null);
  const stepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSteps = useCallback(() => {
    setStepIdx(0);
    setProgress(0);
    let elapsed = 0;
    const totalDuration = STEPS.reduce((s, st) => s + st.duration, 0);

    const advance = (idx: number) => {
      if (idx >= STEPS.length) {
        // All steps done — if we have the case, hand it off.
        // If not, wait for it (the effect below will fire onCaseReady).
        return;
      }
      setStepIdx(idx);
      elapsed += STEPS[idx].duration;
      setProgress(Math.min(100, Math.round((elapsed / totalDuration) * 100)));
      stepTimerRef.current = setTimeout(() => advance(idx + 1), STEPS[idx].duration);
    };
    advance(0);
  }, []);

  const generate = useCallback(
    async (seedToUse: string) => {
      setLoading(true);
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
              "Límite de tokens de Groq alcanzado (100k/día en tier gratuito). Espera ~20 minutos o usa una seed ya generada anteriormente — las seeds cacheadas no consumen tokens."
            );
          }
          throw new Error(errBody.error || errBody.detail || `HTTP ${res.status}`);
        }
        const data = (await res.json()) as GeneratedCase;
        caseReceivedRef.current = data;

        // Wait until the visual steps finish before handing off — so the
        // "Caso listo ✓" beat is visible even if the API was fast.
        const waitForSteps = () => {
          if (stepIdx >= STEPS.length - 1) {
            // Steps basically done — give the final beat a moment.
            setTimeout(() => {
              if (caseReceivedRef.current) {
                onCaseReady(caseReceivedRef.current);
              }
              setLoading(false);
            }, 600);
          } else {
            setTimeout(waitForSteps, 200);
          }
        };
        waitForSteps();
      } catch (err) {
        setError(`No se pudo generar el caso: ${(err as Error).message}`);
        setLoading(false);
        if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
      }
    },
    [runSteps, onCaseReady, stepIdx]
  );

  // Kick off generation on mount.
  useEffect(() => {
    void generate(seed);
    return () => {
      if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
    };
     
  }, []);

  function reroll() {
    if (loading) return;
    const next = randomSeedString();
    setSeed(next);
    void generate(next);
  }

  function useTypedSeed(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    const s = seedInput.trim();
    if (!s) return;
    setSeed(s);
    void generate(s);
    setSeedInput("");
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 relative">
      <div className="w-full max-w-xl">
        {/* Seed display */}
        <div className="text-center mb-6">
          <div className="text-[10px] tracking-[0.4em] text-[var(--muted-foreground)] mb-2">
            SEMILLA DEL CASO
          </div>
          <div className="text-3xl tracking-[0.2em] text-[#7dd3fc] font-bold pixel-text-glow">
            {seed}
          </div>
        </div>

        {/* Generation panel */}
        <div className="pixel-frame p-6">
          <div className="pixel-header mb-4">
            <span>{loading ? "GENERANDO CASO" : "CASO GENERADO"}</span>
          </div>

          {/* Steps list */}
          <div className="space-y-2 mb-4 min-h-[180px]">
            {STEPS.map((step, i) => {
              const isDone = i < stepIdx;
              const isCurrent = i === stepIdx && loading;
              const isPending = i > stepIdx;
              return (
                <div
                  key={i}
                  className={`flex items-center gap-3 text-xs transition-opacity ${
                    isPending ? "opacity-30" : "opacity-100"
                  }`}
                >
                  <span
                    className={`w-4 h-4 flex items-center justify-center text-[10px] ${
                      isDone
                        ? "text-[#4ec9b0]"
                        : isCurrent
                        ? "text-[#7dd3fc]"
                        : "text-[var(--muted-foreground)]"
                    }`}
                  >
                    {isDone ? "✓" : isCurrent ? "▮" : "·"}
                  </span>
                  <span
                    className={
                      isDone
                        ? "text-[#4ec9b0] line-through"
                        : isCurrent
                        ? "text-[#7dd3fc]"
                        : "text-[var(--muted-foreground)]"
                    }
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
              style={{ width: `${progress}%`, transition: "width 0.3s steps(4)" }}
            />
          </div>

          {error && (
            <div className="text-[11px] text-red-400 mb-4 p-2 border border-red-500/40 bg-red-500/10">
              ⚠ {error}
            </div>
          )}

          {/* Seed controls */}
          <div className="space-y-3 pt-3 border-t-2 border-[var(--border)]">
            <button
              onClick={reroll}
              disabled={loading}
              className="pixel-btn w-full py-3 text-xs"
            >
              {loading ? "GENERANDO..." : "🎲 GENERAR NUEVO CASO"}
            </button>

            <form onSubmit={useTypedSeed} className="flex gap-2">
              <input
                value={seedInput}
                onChange={(e) => setSeedInput(e.target.value)}
                placeholder="Escribe una semilla..."
                disabled={loading}
                className="pixel-input flex-1 text-xs"
                maxLength={32}
              />
              <button
                type="submit"
                disabled={loading || !seedInput.trim()}
                className="pixel-btn-secondary text-xs px-4"
              >
                USAR
              </button>
            </form>
          </div>
        </div>

        <div className="text-center mt-4">
          <button
            onClick={onBack}
            disabled={loading}
            className="text-[10px] text-[var(--muted-foreground)] hover:text-[#7dd3fc] tracking-widest transition-colors"
          >
            ◂ VOLVER
          </button>
        </div>

        <div className="text-center mt-3 text-[9px] text-[var(--muted-foreground)]/40 tracking-widest">
          MISMA SEMILLA = MISMO CASO
        </div>
      </div>
    </main>
  );
}
