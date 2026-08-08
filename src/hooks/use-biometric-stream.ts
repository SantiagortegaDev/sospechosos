"use client";

/**
 * useBiometricStream — single-subscriber hook for the biometrics channel.
 *
 * Architecture: only ONE useChannel call per channel. The hook owns both:
 *   - `publish(sample)` — send an ephemeral biometric sample to the channel
 *     AND update local state immediately (Portal does not echo ephemeral sends
 *     back to the sender, so we update local state ourselves; other tabs
 *     receive the sample via onMessage).
 *   - `biometrics` — local React state, updated by publish() (local) and
 *     onMessage (cross-tab).
 *
 * Why single-subscriber: Portal's React binding routes `onMessage` per
 * `useChannel` registration. With two subscriptions on the same channel id,
 * the send-side subscriber's `onMessage` is the one that fires for its own
 * sends — the receiver-side subscriber's onMessage does NOT fire for messages
 * it didn't send itself. Consolidating to one subscription makes both send
 * and receive reliable on the same client, and across clients.
 *
 * Consumers:
 *   - DashboardShell calls this hook and passes `biometrics` to SubjectPanel.
 *   - DashboardShell also passes `publish` to InterrogationFeed so the feed
 *     can emit a sample after each API round-trip.
 *   - SubjectPanel just reads the map.
 */

import { useState, useCallback } from "react";
import { useChannel } from "@portalsdk/react";
import { channelIds, MessageType, type BiometricSample } from "@/lib/portal/channels";

export type BiometricMap = Record<string, BiometricSample>;

function applySample(prev: BiometricMap, sample: BiometricSample): BiometricMap {
  return {
    ...prev,
    [sample.suspectId]: sample,
  };
}

export function useBiometricStream() {
  const [biometrics, setBiometrics] = useState<BiometricMap>({});

  const { send } = useChannel<BiometricSample>({
    channelId: channelIds.biometrics,
    history: "none",
    onMessage: (msg) => {
      // Cross-tab delivery: another client published a sample.
      if (msg.type !== MessageType.Biometric) return;
      const sample = msg.content as BiometricSample;
      setBiometrics((current) => applySample(current, sample));
    },
  });

  const publish = useCallback(
    async (sample: BiometricSample) => {
      // 1. Update local state immediately — Portal does not echo ephemeral
      //    sends back to the sender, so without this the local SubjectPanel
      //    wouldn't update until another tab sent.
      setBiometrics((current) => applySample(current, sample));
      // 2. Publish to the channel so other tabs update.
      await send({
        type: MessageType.Biometric,
        content: sample,
        ephemeral: true,
      });
    },
    [send]
  );

  const reset = useCallback(() => setBiometrics({}), []);

  return { biometrics, publish, reset };
}
