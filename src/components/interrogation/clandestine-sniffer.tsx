"use client";

/**
 * ClandestineSniffer — Column 3, optional middle panel.
 *
 * The "Clandestine" channel is where AI suspects whisper to each other.
 * Detectives can only intercept these whispers while HOLDING DOWN the
 * INTERCEPT button — releasing it stops the live feed and hides any new
 * whispers (already-rendered ones stay on screen until refresh).
 *
 * This is the "hold to intercept" mechanic: sniping the back-channel is an
 * active, tense action, not passive observation.
 *
 * While intercepting:
 *   - Live onMessage events are appended to the visible list.
 *   - The panel border pulses red and the button label flips to "RELEASE".
 *   - A small noise/static indicator animates.
 *
 * While not intercepting:
 *   - Live onMessage events are dropped (you can't see what you're not listening to).
 *   - The button shows "HOLD TO INTERCEPT" with a subtle scanline animation.
 */

import { useState, useRef, useEffect } from "react";
import { useChannel } from "@portalsdk/react";
import { MessageType, type ClandestineWhisper, type ChannelBundle } from "@/lib/portal/channels";
import { cn } from "@/lib/utils";

interface Props {
  channels: ChannelBundle;
}

export function ClandestineSniffer({ channels }: Props) {
  const [intercepting, setIntercepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [visible, setVisible] = useState<
    Array<{ id: string; whisper: ClandestineWhisper; at: number }>
  >([]);
  // Buffer of whispers received while NOT intercepting — discarded, but counted
  // so the UI can show "X whispers missed".
  const [missed, setMissed] = useState(0);
  const interceptingRef = useRef(false);

  // Keep the ref in sync with state so onMessage (closure-stable) can read it.
  useEffect(() => {
    interceptingRef.current = intercepting;
  }, [intercepting]);

  const { status } = useChannel<ClandestineWhisper>({
    channelId: channels.clandestine,
    history: 0 as unknown as number, // no backfill — you only hear what you intercept live
    onMessage: (msg) => {
      if (msg.type !== MessageType.Whisper) return;
      // If we're intercepting, append. Otherwise, count as missed.
      if (interceptingRef.current) {
        setVisible((current) =>
          [...current, {
            id: msg.id,
            whisper: msg.content as ClandestineWhisper,
            at: msg.timestamp,
          }].slice(-30)
        );
      } else {
        setMissed((m) => m + 1);
      }
    },
  });

  async function pingWhisper() {
    setPending(true);
    setError(null);
    try {
      // Generate a fresh AI→AI whisper. We use the hardcoded case channel
      // for the demo; in production this would be serverPublish() with the
      // suspect as sender. For the hackathon, the detective "trips" the
      // wire by clicking PING — both detectives then see it via onMessage
      // (if intercepting).
      const res = await fetch("/api/clandestine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromSuspectId: "suspect_voss",
          toSuspectId: "suspect_hale",
          context: "The detectives are pressing us. Coordinate.",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      // The /api/clandestine endpoint returns the text but doesn't publish
      // (server-publish requires sk_ key). The host detective should publish
      // via the channel — but we don't have the channel handle here. For the
      // hackathon, the PING just generates and the response is ignored; the
      // autonomous tick + occasional PINGs from the server would be the
      // production path. See ARCHITECTURE.md.
    } catch (err) {
      setError(`Whisper failed: ${(err as Error).message}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className={cn(
        "noir-frame flex flex-col h-full transition-all",
        intercepting && "ring-1 ring-red-500/40"
      )}
    >
      <div className="noir-header" style={{ color: intercepting ? "#c83838" : "#7a7af0" }}>
        <span>
          {intercepting ? "CLANDESTINE // INTERCEPTING" : "CLANDESTINE // OFFLINE"}
        </span>
        <span className="ml-auto text-[10px] normal-case tracking-normal text-muted-foreground">
          {status === "ready" ? (
            <span className={intercepting ? "text-red-500" : "text-violet-400"}>
              {intercepting ? "● LIVE" : "○ READY"}
            </span>
          ) : (
            <span className="text-muted-foreground">○ {status.toUpperCase()}</span>
          )}
        </span>
      </div>

      <div
        ref={(el) => {
          if (el && intercepting) el.scrollTop = el.scrollHeight;
        }}
        className="flex-1 overflow-y-auto noir-scroll p-3 space-y-1.5 min-h-0 relative"
        style={{
          backgroundImage: intercepting
            ? "repeating-linear-gradient(0deg, rgba(200,56,56,0.04) 0, rgba(200,56,56,0.04) 1px, transparent 1px, transparent 4px)"
            : "repeating-linear-gradient(0deg, rgba(122,122,240,0.02) 0, rgba(122,122,240,0.02) 1px, transparent 1px, transparent 4px)",
        }}
      >
        {!intercepting && visible.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="text-muted-foreground text-[11px] italic text-center">
              Channel cold.
              <br />
              Hold INTERCEPT to listen.
              {missed > 0 && (
                <div className="mt-2 text-red-500/70 text-[10px] not-italic tracking-widest">
                  {missed} WHISPER{missed === 1 ? "" : "S"} MISSED
                </div>
              )}
            </div>
          </div>
        )}

        {intercepting && visible.length === 0 && (
          <div className="text-center text-muted-foreground text-[11px] py-6 italic flex items-center justify-center gap-2">
            <span className="noir-live-dot" />
            Listening… signal clear.
          </div>
        )}

        {visible.map((entry) => {
          const w = entry.whisper;
          const fromInitial = w.fromSuspectName.split(" ")[0][0];
          const toInitial = w.toSuspectId.includes("voss") ? "V" : w.toSuspectId.includes("hale") ? "H" : "?";
          return (
            <div
              key={entry.id}
              className="text-[11px] italic text-violet-300/80 leading-relaxed border-l-2 border-violet-500/40 pl-2"
            >
              <span className="text-[9px] not-italic tracking-widest text-violet-500/80 mr-1">
                {fromInitial}→{toInitial}:
              </span>
              {w.text}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="px-3 py-1 text-[10px] text-red-500 bg-red-500/10 border-t border-red-500/30">
          {error}
        </div>
      )}

      <div className="border-t border-border p-2 flex items-center gap-2">
        <button
          onPointerDown={() => setIntercepting(true)}
          onPointerUp={() => setIntercepting(false)}
          onPointerLeave={() => setIntercepting(false)}
          onPointerCancel={() => setIntercepting(false)}
          className={cn(
            "flex-1 py-2 text-[10px] tracking-[0.2em] font-bold border transition-colors select-none",
            intercepting
              ? "bg-red-500/30 text-red-400 border-red-500 noir-pulse"
              : "bg-violet-500/10 text-violet-300 border-violet-500/50 hover:bg-violet-500/20"
          )}
        >
          {intercepting ? "▮▮ RELEASE ▮▮" : "HOLD TO INTERCEPT"}
        </button>
        <button
          onClick={pingWhisper}
          disabled={pending}
          className="px-3 py-2 text-[10px] tracking-[0.18em] font-bold bg-zinc-900 text-violet-300 border border-violet-500/50 hover:bg-violet-500/10 disabled:opacity-40 transition-colors"
          title="Force a suspect whisper (debug)"
        >
          {pending ? "…" : "PING"}
        </button>
      </div>
    </div>
  );
}
