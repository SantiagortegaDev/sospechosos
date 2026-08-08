"use client";

/**
 * useAIEvents — subscribes to the ai-events channel and surfaces autonomous
 * AI outputs (thoughts / interjections / questions) per suspect.
 *
 * The host detective (first to join the room) periodically calls /api/ai-tick
 * which generates one event for a random suspect and returns it. The host
 * publishes the event to this channel; both detectives' onMessage fires.
 *
 * We also surface the latest event per suspect so SubjectPanel can render
 * an "internal state" line.
 */

import { useState, useCallback } from "react";
import { useChannel } from "@portalsdk/react";
import { MessageType, type AIEventPayload, type ChannelBundle } from "@/lib/portal/channels";

export type AIEventMap = Record<string, AIEventPayload>;

export function useAIEvents(channels: ChannelBundle) {
  const [events, setEvents] = useState<AIEventMap>({});
  const [feed, setFeed] = useState<AIEventPayload[]>([]);

  const { send } = useChannel<AIEventPayload>({
    channelId: channels.aiEvents,
    history: 30,
    onMessage: (msg) => {
      if (msg.type !== MessageType.AIEvent) return;
      const evt = msg.content as AIEventPayload;
      setEvents((current) => ({ ...current, [evt.suspectId]: evt }));
      setFeed((current) => [...current.slice(-49), evt]);
    },
  });

  const publish = useCallback(
    async (evt: AIEventPayload) => {
      // Local update so the host sees its own publish immediately.
      setEvents((current) => ({ ...current, [evt.suspectId]: evt }));
      setFeed((current) => [...current.slice(-49), evt]);
      await send({ type: MessageType.AIEvent, content: evt });
    },
    [send]
  );

  return { events, feed, publish };
}
