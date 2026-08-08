"use client";

/**
 * TypewriterText — reveals text letter-by-letter with a blinking pixel cursor.
 *
 * Used for AI responses so the text "types itself out" like a retro terminal.
 * The cursor (▮) blinks at the end while typing, then stays blinking briefly
 * before disappearing.
 *
 * Props:
 *   - text: the full string to reveal
 *   - speed: ms per character (default 25 — fast enough to not feel slow,
 *     slow enough to read)
 *   - onDone: callback when the full text is revealed
 *   - className: optional extra classes for the wrapper
 *
 * Implementation: we slice the text to a `visible` substring that grows on
 * an interval. We don't animate width via CSS because we want word-wrap to
 * work naturally. The cursor is a separate animated element appended after
 * the visible text.
 */

import { useState, useEffect, useRef } from "react";

interface Props {
  text: string;
  speed?: number;
  onDone?: () => void;
  className?: string;
}

export function TypewriterText({
  text,
  speed = 25,
  onDone,
  className,
}: Props) {
  const [visibleCount, setVisibleCount] = useState(0);
  const doneRef = useRef(false);

  useEffect(() => {
    // Reset when text changes
    setVisibleCount(0);
    doneRef.current = false;

    if (!text) {
      doneRef.current = true;
      onDone?.();
      return;
    }

    let i = 0;
    const interval = setInterval(() => {
      i++;
      setVisibleCount(i);
      if (i >= text.length) {
        clearInterval(interval);
        if (!doneRef.current) {
          doneRef.current = true;
          onDone?.();
        }
      }
    }, speed);

    return () => clearInterval(interval);
     
  }, [text, speed]);

  const isDone = visibleCount >= text.length;
  const visible = text.slice(0, visibleCount);

  return (
    <span className={className}>
      {visible}
      <span className="pixel-typewriter-cursor" aria-hidden="true" />
      {/* When done, we keep the cursor for a moment then it just keeps blinking —
          that's fine, it sells the "terminal" feel. If you want it to disappear,
          add a setTimeout that toggles a state. */}
      {isDone && <span className="sr-only">{text.slice(visibleCount)}</span>}
    </span>
  );
}
