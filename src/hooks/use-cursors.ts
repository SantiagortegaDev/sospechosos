"use client";

/**
 * useCursors — collaborative cursor hook over the evidence channel.
 *
 * Implements the two-channel pattern documented in Portal's Live cursors guide:
 *   1. `send({ ephemeral: true, type: CURSOR_TYPE, content })` on every pointermove
 *      for smooth, non-persisted live movement.
 *   2. `setMetadata({ cursor })` throttled to ~4 Hz, so a freshly-joined viewer
 *      sees a "last known position" fallback for everyone already in the room.
 */

import { useRef, useState, useCallback } from "react";
import type { PointerEvent } from "react";
import { useChannel } from "@portalsdk/react";
import { CURSOR_TYPE, type CursorPayload, type ChannelBundle } from "@/lib/portal/channels";

const METADATA_THROTTLE_MS = 250;

export interface CursorEntry {
  id: string;
  position: CursorPayload;
  /** True if the position is from a live ephemeral send; false if from presence fallback. */
  live: boolean;
}

export function useCursors(channels: ChannelBundle) {
  const [cursors, setCursors] = useState<Record<string, CursorPayload>>({});
  const lastMetadataSend = useRef(0);

  const { send, setMetadata, presence } = useChannel<CursorPayload>({
    channelId: channels.evidence,
    history: "none",
    onMessage: (msg) => {
      if (!msg.ephemeral || msg.type !== CURSOR_TYPE) return;
      setCursors((current) => ({
        ...current,
        [msg.sender.id]: msg.content as CursorPayload,
      }));
    },
  });

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      const rect = target.getBoundingClientRect();
      const position: CursorPayload = {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
      };

      void send({ ephemeral: true, type: CURSOR_TYPE, content: position });

      const now = Date.now();
      if (now - lastMetadataSend.current > METADATA_THROTTLE_MS) {
        lastMetadataSend.current = now;
        setMetadata({ cursor: position });
      }
    },
    [send, setMetadata]
  );

  const fallback: CursorEntry[] = [];
  if (presence?.kind === "detailed") {
    for (const p of presence.participants) {
      const cursor = p.metadata?.cursor as CursorPayload | undefined;
      if (cursor) {
        fallback.push({ id: p.id, position: cursor, live: false });
      }
    }
  }

  const live: CursorEntry[] = Object.entries(cursors).map(([id, position]) => ({
    id,
    position,
    live: true,
  }));

  const merged: CursorEntry[] = [
    ...live,
    ...fallback.filter((f) => !(f.id in cursors)),
  ];

  return { cursors: merged, onPointerMove };
}
