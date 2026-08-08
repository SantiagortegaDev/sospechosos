"use client";

/**
 * TypingIndicator — 3 pixel dots bouncing in sequence.
 *
 * Shown while the AI is composing a response. Purely decorative — the actual
 * "pending" state is controlled by the parent. Drop this inside any container
 * where you'd show "El sospechoso está respondiendo...".
 *
 * Usage:
 *   <TypingIndicator label="El sospechoso está respondiendo" />
 *   <TypingIndicator />  // just the dots
 */

interface Props {
  label?: string;
}

export function TypingIndicator({ label }: Props) {
  return (
    <span className="pixel-typing inline-flex items-center gap-2">
      <span className="pixel-typing-dot" />
      <span className="pixel-typing-dot" />
      <span className="pixel-typing-dot" />
      {label && (
        <span className="text-[10px] text-[var(--muted-foreground)] tracking-wider ml-2 italic">
          {label}
        </span>
      )}
    </span>
  );
}
