"use client";

/**
 * CaseHeader — top status bar.
 *
 * Shows the room code, the active suspect, the connection status of the
 * interrogation channel, and a count of detectives currently present.
 */

import { useChannel } from "@portalsdk/react";
import type { ChannelBundle } from "@/lib/portal/channels";
import { SUSPECTS } from "@/lib/ai/suspects";

interface Props {
  channels: ChannelBundle;
  activeSuspectId: string;
  username: string;
  roomCode: string;
}

export function CaseHeader({ channels, activeSuspectId, username, roomCode }: Props) {
  const { status, presence } = useChannel({
    channelId: channels.interrogation,
    history: "none",
  });

  const suspect = SUSPECTS.find((s) => s.id === activeSuspectId);
  const detectiveCount =
    presence?.kind === "detailed"
      ? presence.count
      : presence?.kind === "aggregate"
      ? presence.count
      : 0;

  return (
    <header className="noir-frame flex items-stretch justify-between text-xs">
      <div className="flex items-stretch">
        <div className="px-4 py-2 border-r border-border flex flex-col justify-center">
          <div className="text-[10px] tracking-[0.2em] text-muted-foreground">
            ROOM
          </div>
          <div className="text-sky-500 font-bold tracking-widest">
            {roomCode.toUpperCase()}
          </div>
        </div>
        <div className="px-4 py-2 border-r border-border flex flex-col justify-center">
          <div className="text-[10px] tracking-[0.2em] text-muted-foreground">
            DETECTIVE
          </div>
          <div className="text-foreground font-bold tracking-widest">
            {username.toUpperCase()}
          </div>
        </div>
        <div className="px-4 py-2 border-r border-border flex flex-col justify-center">
          <div className="text-[10px] tracking-[0.2em] text-muted-foreground">
            SUBJECT
          </div>
          <div className="text-foreground font-bold tracking-widest">
            {suspect?.name ?? "—"}{" "}
            <span className="text-muted-foreground">{"// "}{suspect?.role}</span>
          </div>
        </div>
      </div>

      <div className="flex items-stretch">
        <StatusIndicator label="INTR" status={status} />
        <PresenceIndicator count={detectiveCount} />
        <ClockIndicator />
      </div>
    </header>
  );
}

function StatusIndicator({ label, status }: { label: string; status: string }) {
  const color =
    status === "ready"
      ? "bg-emerald-500/20 text-emerald-400"
      : status === "connecting" || status === "reconnecting"
      ? "bg-sky-500/20 text-sky-500"
      : status === "blocked"
      ? "bg-red-500/20 text-red-500"
      : "bg-zinc-700/40 text-zinc-500";
  return (
    <div className="px-3 py-2 border-l border-border flex flex-col justify-center min-w-[80px]">
      <div className="text-[9px] tracking-[0.2em] text-muted-foreground">
        {label}
      </div>
      <div className={`text-[10px] tracking-wider font-bold ${color}`}>
        <span className="noir-live-dot inline-block mr-1.5 align-middle" />
        {status.toUpperCase().slice(0, 7)}
      </div>
    </div>
  );
}

function PresenceIndicator({ count }: { count: number }) {
  return (
    <div className="px-3 py-2 border-l border-border flex flex-col justify-center min-w-[80px]">
      <div className="text-[9px] tracking-[0.2em] text-muted-foreground">
        DETECTIVES
      </div>
      <div className="text-[10px] tracking-wider font-bold text-sky-500">
        {count} ONLINE
      </div>
    </div>
  );
}

function ClockIndicator() {
  const now = new Date();
  const time = now.toLocaleTimeString("en-GB", { hour12: false });
  return (
    <div className="px-3 py-2 border-l border-border flex flex-col justify-center min-w-[80px]">
      <div className="text-[9px] tracking-[0.2em] text-muted-foreground">
        LOCAL
      </div>
      <div className="text-[10px] tracking-wider font-bold text-foreground">
        {time}
      </div>
    </div>
  );
}
