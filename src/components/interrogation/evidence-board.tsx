"use client";

/**
 * EvidenceBoard — Column 3, top panel.
 *
 * A shared multiplayer surface where both detectives see each other's cursors
 * move in real time, and can drop evidence pins at arbitrary positions.
 *
 * Cursors: useCursors() — the two-channel pattern from Portal's Live cursors
 *   guide (ephemeral sends for live movement + throttled setMetadata for the
 *   presence fallback).
 *
 * Pins: persistent messages on the same evidence channel, type `evidence.pin`.
 *   Both detectives see the same pins because they share the channel.
 *
 * Click to drop a pin. Pins are labeled with whatever the detective typed into
 * a small inline prompt — for the hackathon we just use the timestamp.
 */

import { useState, useCallback } from "react";
import { useChannel } from "@portalsdk/react";
import { useCursors } from "@/hooks/use-cursors";
import {
  channelIds,
  MessageType,
  CURSOR_TYPE,
  type EvidencePin,
} from "@/lib/portal/channels";
import { cn } from "@/lib/utils";

interface Props {
  detectiveName: string;
  color: string;
}

export function EvidenceBoard({ detectiveName, color }: Props) {
  const { cursors, onPointerMove } = useCursors();
  const [pinLabel, setPinLabel] = useState("");
  const [pendingPin, setPendingPin] = useState<{ x: number; y: number } | null>(
    null
  );

  // Same channel as cursors — pins are persistent messages on it, cursors are
  // ephemeral. The `type` field discriminates them at the consumer side.
  const { messages, send } = useChannel<EvidencePin>({
    channelId: channelIds.evidence,
    history: 30,
    onMessage: (msg) => {
      // Cursor traffic is handled by useCursors; we ignore it here.
      if (msg.ephemeral && msg.type === CURSOR_TYPE) return;
    },
  });

  // Filter the channel's messages to evidence pins only.
  const pins: EvidencePin[] = messages
    .filter((m) => !m.ephemeral && m.type === MessageType.Pin)
    .map((m) => m.content as EvidencePin);

  const onSurfaceClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      setPendingPin({ x, y });
    },
    []
  );

  async function confirmPin() {
    if (!pendingPin || !pinLabel.trim()) {
      setPendingPin(null);
      setPinLabel("");
      return;
    }
    const pin: EvidencePin = {
      id: `pin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      label: pinLabel.trim().toUpperCase(),
      x: pendingPin.x,
      y: pendingPin.y,
      addedBy: detectiveName,
      color,
    };
    await send({ type: MessageType.Pin, content: pin });
    setPendingPin(null);
    setPinLabel("");
  }

  return (
    <div className="noir-frame flex flex-col h-full">
      <div className="noir-header">
        <span>EVIDENCE BOARD // SHARED</span>
        <span className="ml-auto text-[10px] normal-case tracking-normal text-muted-foreground">
          {pins.length} PIN{pins.length === 1 ? "" : "S"} · {cursors.length} CURSOR{cursors.length === 1 ? "" : "S"}
        </span>
      </div>

      <div
        onPointerMove={onPointerMove}
        onClick={onSurfaceClick}
        className="relative flex-1 overflow-hidden cursor-crosshair bg-zinc-950"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,176,0,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,176,0,0.05) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          backgroundPosition: "-1px -1px",
        }}
      >
        {/* Pins */}
        {pins.map((p) => (
          <Pin key={p.id} pin={p} />
        ))}

        {/* Live cursors */}
        {cursors.map((c) => (
          <Cursor
            key={c.id}
            id={c.id}
            x={c.position.x}
            y={c.position.y}
            live={c.live}
            self={false}
          />
        ))}

        {/* Pending pin placement */}
        {pendingPin && (
          <div
            className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
            style={{
              left: `${pendingPin.x * 100}%`,
              top: `${pendingPin.y * 100}%`,
            }}
          >
            <div className="noir-frame bg-zinc-950 p-2 flex items-center gap-1">
              <input
                autoFocus
                value={pinLabel}
                onChange={(e) => setPinLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmPin();
                  if (e.key === "Escape") {
                    setPendingPin(null);
                    setPinLabel("");
                  }
                }}
                placeholder="label…"
                className="bg-transparent text-xs text-foreground outline-none w-24 px-1"
              />
              <button
                onClick={confirmPin}
                className="text-[10px] px-2 py-0.5 bg-amber-500 text-zinc-950 font-bold tracking-wider"
              >
                PIN
              </button>
            </div>
          </div>
        )}

        {/* Empty-state hint */}
        {pins.length === 0 && cursors.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-muted-foreground text-xs italic text-center">
              Click to pin evidence.
              <br />
              Move to broadcast your cursor.
            </div>
          </div>
        )}
      </div>

      {/* Bottom strip: pin legend / instructions */}
      <div className="border-t border-border px-3 py-1.5 text-[9px] text-muted-foreground tracking-[0.18em] flex items-center justify-between">
        <span>CLICK=PIN · MOVE=CURSOR</span>
        <span style={{ color }} className="font-bold">
          {detectiveName.toUpperCase()}
        </span>
      </div>
    </div>
  );
}

function Pin({ pin }: { pin: EvidencePin }) {
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-full z-10 pointer-events-none"
      style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
    >
      <div className="flex flex-col items-center">
        <div
          className="px-1.5 py-0.5 text-[9px] font-bold tracking-wider border whitespace-nowrap"
          style={{
            backgroundColor: pin.color,
            color: "#0a0a0a",
            borderColor: pin.color,
          }}
        >
          {pin.label}
        </div>
        <div
          className="w-px h-3"
          style={{ backgroundColor: pin.color }}
        />
        <div
          className="w-2 h-2 rotate-45 -mt-1"
          style={{ backgroundColor: pin.color }}
        />
      </div>
    </div>
  );
}

function Cursor({
  id,
  x,
  y,
  live,
  self,
}: {
  id: string;
  x: number;
  y: number;
  live: boolean;
  self: boolean;
}) {
  return (
    <div
      className={cn(
        "absolute pointer-events-none z-10 transition-opacity",
        live ? "opacity-100" : "opacity-40"
      )}
      style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
    >
      <div className="relative">
        {/* Arrow */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          style={{ filter: "drop-shadow(0 0 4px rgba(255,176,0,0.6))" }}
        >
          <path
            d="M0 0 L0 10 L3 7 L5.5 13 L7 12.5 L4.5 6.5 L9 6.5 Z"
            fill="#ffb000"
          />
        </svg>
        <div
          className="noir-cursor-label absolute left-3 top-2"
          data-self={self}
        >
          {id.slice(0, 8)}…
        </div>
      </div>
    </div>
  );
}
