"use client";

/**
 * LoginScreen — entry gate.
 *
 * Asks for:
 *   - A username (detective handle, displayed in chats + cursors)
 *   - A room code (so two detectives on different networks meet in the same room)
 *
 * Both are stored in sessionStorage so a refresh keeps you in the same room.
 * The room code is what the channel IDs derive from — see channelIdsFor().
 *
 * The "JOIN" button is disabled until both fields are non-empty. The room
 * code is sanitized (lowercased, alphanumerics + dash/underscore, max 32 chars)
 * at the channel-id layer, so "Case-001" and "case_001" both work.
 */

import { useState, type FormEvent } from "react";

interface Props {
  onJoin: (username: string, roomCode: string) => void;
}

export function LoginScreen({ onJoin }: Props) {
  const [username, setUsername] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [touched, setTouched] = useState(false);

  const canJoin = username.trim().length >= 2 && roomCode.trim().length >= 2;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!canJoin) return;
    onJoin(username.trim(), roomCode.trim());
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Title block */}
        <div className="text-center mb-8">
          <div className="text-[10px] tracking-[0.4em] text-muted-foreground mb-2">
            MERIDIAN HOLDINGS // INTERNAL INVESTIGATION UNIT
          </div>
          <h1 className="text-2xl font-bold tracking-[0.3em] text-sky-500">
            THE INTERROGATION ROOM
          </h1>
          <div className="text-[10px] tracking-[0.2em] text-muted-foreground mt-2">
            v0.2 · PORTAL REALTIME · GROQ INFERENCE
          </div>
        </div>

        <form onSubmit={onSubmit} className="noir-frame">
          <div className="noir-header">
            <span>ACCESS CREDENTIALS</span>
            <span className="ml-auto text-red-500 normal-case tracking-normal text-[10px] flex items-center gap-1">
              <span className="noir-live-dot" />
              SECURE
            </span>
          </div>

          <div className="p-5 space-y-5">
            <Field
              label="DETECTIVE HANDLE"
              hint="Displayed to your partner and the subjects."
              value={username}
              onChange={setUsername}
              placeholder="e.g. HARLOW"
              maxLength={24}
              error={
                touched && username.trim().length < 2
                  ? "Handle must be at least 2 characters."
                  : undefined
              }
              autoFocus
            />

            <Field
              label="ROOM CODE"
              hint="Share this code with your partner so they join the same room."
              value={roomCode}
              onChange={setRoomCode}
              placeholder="e.g. case-001"
              maxLength={32}
              error={
                touched && roomCode.trim().length < 2
                  ? "Room code must be at least 2 characters."
                  : undefined
              }
              mono
            />

            <button
              type="submit"
              disabled={!canJoin}
              className="w-full py-2.5 text-xs tracking-[0.25em] font-bold bg-sky-500 text-zinc-950 hover:bg-sky-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              ▸ ENTER ROOM
            </button>

            <div className="pt-3 border-t border-border text-[10px] text-muted-foreground space-y-1">
              <div className="tracking-[0.18em]">▸ PROTOCOL</div>
              <p className="leading-relaxed">
                Two detectives. Two AI suspects. One truth buried under lies.
                Coordinate via the private channel; press the subjects in the
                central feed; pin evidence on the shared board.
              </p>
            </div>
          </div>
        </form>

        <div className="text-center mt-4 text-[10px] tracking-[0.18em] text-muted-foreground">
          2 DETECTIVES · 2 SUSPECTS · 1 TRUTH
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  maxLength,
  error,
  autoFocus,
  mono,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  error?: string;
  autoFocus?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[10px] tracking-[0.2em] text-sky-500">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        autoFocus={autoFocus}
        className={`w-full bg-zinc-950 border border-border px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-sky-500 transition-colors ${
          mono ? "font-mono" : ""
        }`}
      />
      <p className="text-[10px] text-muted-foreground leading-snug">{hint}</p>
      {error && (
        <p className="text-[10px] text-red-500 tracking-wider">⚠ {error}</p>
      )}
    </div>
  );
}
