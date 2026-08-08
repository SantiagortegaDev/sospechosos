"use client";

/**
 * useBiometricStream — single-subscriber hook for the biometrics channel.
 *
 * Only ONE useChannel call per channel. The hook owns both:
 *   - `publish(sample)` — send an ephemeral biometric sample to the channel
 *     AND update local state immediately (Portal does not echo ephemeral sends
 *     back to the sender, so we update local state ourselves; other tabs
 *     receive the sample via onMessage).
 *   - `biometrics` — local React state, updated by publish() (local) and
 *     onMessage (cross-tab).
 */

import { useState, useCallback } from "react";
import { useChannel } from "@portalsdk/react";
import { MessageType, type BiometricSample, type ChannelBundle } from "@/lib/portal/channels";

export type BiometricMap = Record<string, BiometricSample>;

function applySample(prev: BiometricMap, sample: BiometricSample): BiometricMap {
  return { ...prev, [sample.suspectId]: sample };
}

export function useBiometricStream(channels: ChannelBundle) {
  const [biometrics, setBiometrics] = useState<BiometricMap>({});

  const { send } = useChannel<BiometricSample>({
    channelId: channels.biometrics,
    history: "none",
    onMessage: (msg) => {
      if (msg.type !== MessageType.Biometric) return;
      const sample = msg.content as BiometricSample;
      setBiometrics((current) => applySample(current, sample));
    },
  });

  const publish = useCallback(
    async (sample: BiometricSample) => {
      setBiometrics((current) => applySample(current, sample));
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
