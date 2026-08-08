"use client";

/**
 * SuspectPortrait — renders a suspect's pixel art portrait with fallbacks.
 *
 * The case generator picks a portrait filename from seed + gender. We try
 * multiple format candidates in order (the actual uploaded format first),
 * cascading to the next on <img> onError. If all 404, we fall back to the
 * suspect's emoji avatar in a pixel-avatar div.
 *
 * The image is rendered with image-rendering: pixelated so it stays crisp
 * at any size — matches the pixel art logo treatment.
 *
 * Implementation note: we split into an inner component keyed by seed+gender
 * so React remounts (and resets the candidate index) when the case changes,
 * avoiding setState-in-effect.
 */

import { useState } from "react";
import { portraitFilename, type Gender } from "@/lib/ai/generated-case";
import { cn } from "@/lib/utils";

interface Props {
  seed: string;
  gender: Gender;
  avatar: string; // emoji fallback
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const sizeClasses: Record<NonNullable<Props["size"]>, string> = {
  sm: "w-12 h-12 text-2xl",
  md: "w-16 h-16 text-3xl",
  lg: "w-24 h-24 text-5xl",
  xl: "w-32 h-32 text-6xl",
};

export function SuspectPortrait(props: Props) {
  // Keyed remount when seed or gender changes — resets internal state cleanly.
  return <SuspectPortraitInner key={`${props.seed}|${props.gender}`} {...props} />;
}

function SuspectPortraitInner({ seed, gender, avatar, size = "md", className }: Props) {
  const { primary, fallbacks } = portraitFilename(seed, gender);
  const allCandidates = [primary, ...fallbacks];
  const [candidateIdx, setCandidateIdx] = useState(0);

  // If we've exhausted all image candidates, show the emoji fallback.
  if (candidateIdx >= allCandidates.length) {
    return (
      <div
        className={cn(
          "pixel-avatar flex items-center justify-center overflow-hidden",
          sizeClasses[size],
          className
        )}
      >
        <span className="select-none" aria-label="Sospechoso">
          {avatar}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "pixel-avatar flex items-center justify-center overflow-hidden relative",
        sizeClasses[size],
        className
      )}
    >
      <img
        key={candidateIdx}
        src={allCandidates[candidateIdx]}
        alt="Sospechoso"
        className="w-full h-full object-cover"
        style={{ imageRendering: "pixelated" }}
        onError={() => setCandidateIdx((i) => i + 1)}
        draggable={false}
      />
    </div>
  );
}
