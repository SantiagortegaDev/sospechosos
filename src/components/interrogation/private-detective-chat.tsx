"use client";

/**
 * PrivateDetectiveChat — Column 3, bottom panel.
 *
 * A conspiracy/notes channel only the two humans share.
 */

import { useState, useRef, useEffect, type FormEvent } from "react";
import { useChannel } from "@portalsdk/react";
import { MessageType, type DetectiveNote, type ChannelBundle } from "@/lib/portal/channels";
import { cn } from "@/lib/utils";

interface Props {
  channels: ChannelBundle;
  detectiveName: string;
}

export function PrivateDetectiveChat({ channels, detectiveName }: Props) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, send, presence } = useChannel<DetectiveNote>({
    channelId: channels.detectives,
    history: 30,
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;

    await send({
      type: MessageType.Note,
      content: { text, detectiveId: "self", detectiveName },
    });
    setDraft("");
  }

  const onlineCount =
    presence?.kind === "detailed" ? presence.count : 0;

  return (
    <div className="noir-frame flex flex-col h-full">
      <div className="noir-header">
        <span>DETECTIVES // PRIVATE</span>
        <span className="ml-auto text-[10px] normal-case tracking-normal text-emerald-400">
          {onlineCount} ONLINE
        </span>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto noir-scroll p-3 space-y-2 min-h-0"
      >
        {messages.length === 0 && (
          <div className="text-center text-muted-foreground text-xs py-8 italic">
            Conspire. The room is bugged, not this channel.
          </div>
        )}
        {messages.map((m) => {
          const note = m.content as DetectiveNote;
          const mine = note.detectiveName === detectiveName;
          return (
            <div
              key={m.id}
              className={cn(
                "flex flex-col gap-0.5",
                mine ? "items-end" : "items-start"
              )}
            >
              <div className="text-[9px] tracking-[0.18em] text-emerald-500">
                {mine ? "YOU" : `DET. ${note.detectiveName.toUpperCase()}`}
              </div>
              <div
                className={cn(
                  "px-3 py-2 max-w-[85%] border text-sm",
                  mine
                    ? "bg-emerald-500/10 border-emerald-500/40 text-foreground"
                    : "bg-zinc-900 border-zinc-700 text-foreground"
                )}
              >
                {note.text}
              </div>
            </div>
          );
        })}
      </div>

      <form
        onSubmit={onSubmit}
        className="border-t border-border p-2 flex items-center gap-2"
      >
        <span className="text-emerald-500 text-xs tracking-widest pl-1">
          NOTE&gt;
        </span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="whisper to your partner"
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none px-2"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="px-3 py-1.5 text-[10px] tracking-[0.18em] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 hover:bg-emerald-500/30 disabled:opacity-40 transition-colors"
        >
          SEND
        </button>
      </form>
    </div>
  );
}
