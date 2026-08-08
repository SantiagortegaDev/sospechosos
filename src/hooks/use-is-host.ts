"use client";

/**
 * useIsHost — determines whether the local user is the "host" detective.
 *
 * The host is the detective with the smallest presence join order in the
 * interrogation channel — i.e. the first one who joined. We use presence's
 * participant list (which is ordered by join time, earliest first) and check
 * whether `me.id` matches the first participant's id.
 *
 * Returns:
 *   - isHost: true if this client should run the AI autonomous tick loop
 *   - meId: the local user's Portal anonymous id (for debugging)
 *
 * The host responsibility: run /api/ai-tick on a timer and publish the
 * resulting event. Non-hosts just listen. This avoids both detectives
 * double-firing AI events.
 */

import { useChannel } from "@portalsdk/react";
import { useMemo } from "react";
import type { ChannelBundle } from "@/lib/portal/channels";

export function useIsHost(channels: ChannelBundle) {
  const { presence, me } = useChannel({
    channelId: channels.interrogation,
    history: "none",
  });

  // Derive host status synchronously from presence + me — no setState in effect.
  const { isHost, meId } = useMemo(() => {
    const id = me?.id ?? null;
    if (!id) return { isHost: false, meId: null };
    if (presence?.kind !== "detailed") return { isHost: false, meId: id };

    const sorted = [...presence.participants].sort((a, b) =>
      String(a.id).localeCompare(String(b.id))
    );
    // Host = the participant whose id sorts first among currently online.
    // (Portal's anonymous ids are u_XXXXXX — lexical sort is a stable proxy
    // for "first to join" without exposing join timestamps in v1.)
    const host = sorted.length > 0 && sorted[0].id === id;
    return { isHost: host, meId: id };
  }, [presence, me]);

  return { isHost, meId };
}
