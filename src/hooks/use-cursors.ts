"use client";

/**
 * useCursors — collaborative cursor hook over the evidence channel.
 *
 * Implements the two-channel pattern documented in Portal's Live cursors guide:
 *   1. `send({ ephemeral: true, type: CURSOR_TYPE, content })` on every pointermove
 *      for smooth, non-persisted live movement.
 *   2. `setMetadata({ cursor })` throttled to ~4Hz, so a freshly-joined viewer
 *      sees a "last known position" fallback for everyone already in the room.
 *
 * Returns:
 *   - cursors: live ephemeral positions keyed by user id
 *   - fallback: presence-derived last-known positions (for newly joined users
 *     and for sessions where the live stream hasn't yet ticked)
 *   - onPointerMove: attach to the shared surface's onPointerMove
 */

import { useRef, useState, useCallback } from "react";
import type { PointerEvent } from "react";
import { useChannel } from "@portalsdk/react";
import { channelIds, CURSOR_TYPE, type CursorPayload } from "@/lib/portal/channels";

const METADATA_THROTTLE_MS = 250;

export interface CursorEntry {
  id: string;
  position: CursorPayload;
  /** True if the position is from a live ephemeral send; false if from presence fallback. */
  live: boolean;
}

export function useCursors() {
  const [cursors, setCursors] = useState<Record<string, CursorPayload>>({});
  const lastMetadataSend = useRef(0);

  const { send, setMetadata, presence } = useChannel<CursorPayload>({
    channelId: channelIds.evidence,
    history: "none",
    onMessage: (msg) => {
      // Filter to cursor-type ephemeral traffic only — anything else on this
      // channel (e.g. evidence pins) is ignored here.
      if (!msg.ephemeral || msg.type !== CURSOR_TYPE) return;
      setCursors((current) => ({
        ...current,
        [msg.sender.id]: msg.content as CursorPayload,
      }));
    },
  });

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      // Normalize to 0..1 relative to the surface — coordinates are reusable
      // across different viewport sizes.
      const target = e.currentTarget;
      const rect = target.getBoundingClientRect();
      const position: CursorPayload = {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
      };

      // Live stream — every move.
      void send({ ephemeral: true, type: CURSOR_TYPE, content: position });

      // Throttled fallback — into presence metadata.
      const now = Date.now();
      if (now - lastMetadataSend.current > METADATA_THROTTLE_MS) {
        lastMetadataSend.current = now;
        setMetadata({ cursor: position });
      }
    },
    [send, setMetadata]
  );

  // Build the fallback list from presence. Detailed presence carries metadata
  // per participant; aggregate presence (large channels) gives us only a count
  // and we skip fallback entirely.
  const fallback: CursorEntry[] = [];
  if (presence?.kind === "detailed") {
    for (const p of presence.participants) {
      const cursor = p.metadata?.cursor as CursorPayload | undefined;
      if (cursor) {
        fallback.push({ id: p.id, position: cursor, live: false });
      }
    }
  }

  // Merge: live cursors win over fallback for the same user id.
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
