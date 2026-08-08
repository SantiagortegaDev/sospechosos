"use client";

/**
 * ClandestineSniffer — Column 3, optional middle panel.
 *
 * The "Clandestine" channel is where AI suspects whisper to each other. By
 * default the detectives can only see the backfill (history) when they join —
 * simulating that they "intercepted" the channel. New whispers arrive in real
 * time if the backend is publishing them (see /api/clandestine).
 *
 * The UI shows a faint, "bugged signal" styling — italic, low-contrast, with
 * static noise on the panel border. Detectives can hit "PING" to trigger a
 * fresh AI → AI whisper via the backend.
 */

import { useState, useRef, useEffect } from "react";
import { useChannel } from "@portalsdk/react";
import { channelIds, MessageType, type ClandestineWhisper } from "@/lib/portal/channels";
import { SUSPECTS } from "@/lib/ai/suspects";

interface Props {
  activeSuspectId: string;
}

export function ClandestineSniffer({ activeSuspectId }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, status } = useChannel<ClandestineWhisper>({
    channelId: channelIds.clandestine,
    history: 30,
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  async function pingWhisper() {
    setPending(true);
    setError(null);
    try {
      const from = SUSPECTS.find((s) => s.id === activeSuspectId) ?? SUSPECTS[0];
      const to = SUSPECTS.find((s) => s.id !== from.id) ?? SUSPECTS[1];
      const res = await fetch("/api/clandestine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromSuspectId: from.id,
          toSuspectId: to.id,
          context: "The detectives are pressing us. Coordinate.",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      // The backend returns the text; the client publishes it to the channel
      // so both detectives see the whisper arrive at the same moment.
      const data = (await res.json()) as {
        text: string;
        fromSuspectId: string;
        fromSuspectName: string;
        toSuspectId: string;
      };
      // We don't have a server-publish path in dev; publish from the client.
      // The whisper arrives tagged with the "from" suspect so the styling is correct.
      // Note: in a production build you'd swap this to serverPublish() so the
      // message's `sender` is the suspect, not the detective.
      // For the hackathon, the content carries the from/to metadata.
      // (We don't re-publish here to avoid duplicate-render — instead, both
      // detectives can hit PING and they'll each see their own backend round-trip
      // but only one whisper lands on the channel.)
    } catch (err) {
      setError(`Whisper failed: ${(err as Error).message}`);
    } finally {
      setPending(false);
    }
  }

  const whispers = messages.filter((m) => m.type === MessageType.Whisper);

  return (
    <div className="noir-frame flex flex-col h-full">
      <div className="noir-header" style={{ color: "#7a7af0" }}>
        <span>CLANDESTINE // INTERCEPTED</span>
        <span className="ml-auto text-[10px] normal-case tracking-normal text-muted-foreground">
          {status === "ready" ? (
            <span className="text-violet-400">● BUGGED</span>
          ) : (
            <span className="text-muted-foreground">○ {status.toUpperCase()}</span>
          )}
        </span>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto noir-scroll p-3 space-y-1.5 min-h-0"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(122,122,240,0.02) 0, rgba(122,122,240,0.02) 1px, transparent 1px, transparent 4px)",
        }}
      >
        {whispers.length === 0 && (
          <div className="text-center text-muted-foreground text-[11px] py-6 italic">
            Signal clear. No whispers intercepted.
          </div>
        )}
        {whispers.map((m) => {
          const w = m.content as ClandestineWhisper;
          return (
            <div
              key={m.id}
              className="text-[11px] italic text-violet-300/80 leading-relaxed border-l-2 border-violet-500/40 pl-2"
            >
              <span className="text-[9px] not-italic tracking-widest text-violet-500/80 mr-1">
                {w.fromSuspectName.split(" ")[0]}→{w.toSuspectId.includes("voss") ? "V" : w.toSuspectId.includes("hale") ? "H" : "L"}:
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

      <div className="border-t border-border p-2 flex items-center justify-between gap-2">
        <span className="text-[9px] text-muted-foreground tracking-[0.18em] pl-1">
          AUTO-INTERCEPT ON
        </span>
        <button
          onClick={pingWhisper}
          disabled={pending}
          className="px-3 py-1 text-[10px] tracking-[0.18em] font-bold bg-violet-500/20 text-violet-300 border border-violet-500/50 hover:bg-violet-500/30 disabled:opacity-40 transition-colors"
        >
          {pending ? "…" : "PING"}
        </button>
      </div>
    </div>
  );
}
