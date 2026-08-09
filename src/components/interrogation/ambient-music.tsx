"use client";

/**
 * AmbientMusic — plays the detective spy music on loop in the background.
 *
 * Uses a single <audio> element with loop=true. The music starts on the
 * first user gesture (browser autoplay policy) and persists across screen
 * transitions because it's rendered at the root layout level.
 *
 * Volume is kept low (0.35) so it's ambient — doesn't compete with the SFX
 * or the TTS voice.
 *
 * Mute state is shared with the sound engine's mute flag. When the user
 * mutes (via the sound button in the playing header), the music also stops.
 */

import { useEffect, useRef, useState } from "react";
import { isMuted } from "@/lib/audio/sound-engine";

export function AmbientMusic() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [muted, setMuted] = useState(isMuted());

  // Sync mute state with the sound engine.
  useEffect(() => {
    const checkMuted = () => {
      const m = isMuted();
      setMuted(m);
      if (audioRef.current) {
        audioRef.current.muted = m;
        if (m) {
          audioRef.current.pause();
        } else {
          // Only resume if we've already started (don't autoplay before gesture).
          if (audioRef.current.dataset.started === "true") {
            void audioRef.current.play().catch(() => {});
          }
        }
      }
    };

    // Poll for mute state changes (the sound engine uses a module-level flag,
    // not a React state, so we poll). 200ms is cheap and responsive enough.
    const interval = setInterval(checkMuted, 250);
    return () => clearInterval(interval);
  }, []);

  // Start music on first user gesture (browser autoplay policy).
  useEffect(() => {
    const startMusic = () => {
      if (isMuted()) return;
      if (audioRef.current && audioRef.current.dataset.started !== "true") {
        audioRef.current.dataset.started = "true";
        audioRef.current.volume = 0.35;
        void audioRef.current.play().catch(() => {
          // Autoplay blocked — will retry on next gesture.
          audioRef.current!.dataset.started = "false";
        });
      }
    };

    // Any user gesture counts: click, touch, keypress.
    window.addEventListener("click", startMusic, { once: false });
    window.addEventListener("touchstart", startMusic, { once: false });
    window.addEventListener("keydown", startMusic, { once: false });

    return () => {
      window.removeEventListener("click", startMusic);
      window.removeEventListener("touchstart", startMusic);
      window.removeEventListener("keydown", startMusic);
    };
  }, []);

  return (
    <audio
      ref={audioRef}
      src="/detective-music.mp3"
      loop
      preload="auto"
      muted={muted}
      // Don't autoplay — wait for gesture. The effect above handles it.
       
      playsInline
    />
  );
}
