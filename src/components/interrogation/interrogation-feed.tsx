"use client";

/**
 * InterrogationFeed — Column 2.
 *
 * The central chat where both detectives press the active AI suspect.
 *
 *   Detective types question → POST /api/interrogate → on response:
 *     1. publish the answer (InterrogationAnswer) to the interrogation channel
 *     2. publish the new biometric sample (ephemeral) via parent's publishBiometric
 */

import { useState, useRef, useEffect, type FormEvent } from "react";
import { useChannel } from "@portalsdk/react";
import {
  MessageType,
  type InterrogationQuestion,
  type InterrogationAnswer,
  type BiometricSample,
  type ChannelBundle,
} from "@/lib/portal/channels";
import type { BiometricState } from "@/lib/ai/biometrics";
import { cn } from "@/lib/utils";

type FeedMessage = InterrogationQuestion | InterrogationAnswer;

interface Props {
  channels: ChannelBundle;
  activeSuspectId: string;
  detectiveName: string;
  /** Latest biometric state, kept in parent so the SubjectPanel can render it too. */
  previousBiometrics?: BiometricState;
  onBiometricsUpdate: (state: BiometricState) => void;
  /** Publishes a biometric sample to the biometrics channel via the parent's single subscriber. */
  publishBiometric: (sample: BiometricSample) => Promise<void>;
  /** Latest question text — surfaced to the AI-tick context. */
  onQuestionAsked: (text: string) => void;
}

export function InterrogationFeed({
  channels,
  activeSuspectId,
  detectiveName,
  previousBiometrics,
  onBiometricsUpdate,
  publishBiometric,
  onQuestionAsked,
}: Props) {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, send, status, typing } = useChannel<FeedMessage>({
    channelId: channels.interrogation,
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
    if (!text || pending) return;

    const question: InterrogationQuestion = {
      text,
      suspectId: activeSuspectId,
      detectiveId: "self",
      detectiveName,
    };

    try {
      await send({ type: MessageType.Question, content: question });
    } catch (err) {
      setError(`Failed to publish question: ${(err as Error).message}`);
      return;
    }

    // Lift the latest question up so the AI-tick context can reference it.
    onQuestionAsked(text);

    setDraft("");
    setPending(true);
    setError(null);

    try {
      const res = await fetch("/api/interrogate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suspectId: activeSuspectId,
          question: text,
          history: [],
          previousBiometrics,
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }

      const data = (await res.json()) as {
        answer: InterrogationAnswer;
        biometrics: BiometricState;
        trigger?: string;
      };

      await send({ type: MessageType.Answer, content: data.answer });

      const sample: BiometricSample = {
        suspectId: data.biometrics.suspectId,
        stress: data.biometrics.stress,
        bpm: data.biometrics.bpm,
        coherence: data.biometrics.coherence,
        trigger: data.trigger,
      };
      try {
        await publishBiometric(sample);
      } catch (err) {
         
        console.error("[interrogation-feed] publishBiometric failed", err);
      }

      onBiometricsUpdate(data.biometrics);
    } catch (err) {
      setError(`Interrogation failed: ${(err as Error).message}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="noir-frame flex flex-col h-full">
      <div className="noir-header">
        <span>INTERROGATION // LIVE FEED</span>
        <span className="ml-auto text-[10px] normal-case tracking-normal text-muted-foreground">
          {status === "ready" ? (
            <span className="text-emerald-400">● LINK</span>
          ) : (
            <span className="text-sky-500">○ {status.toUpperCase()}</span>
          )}
        </span>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto noir-scroll p-3 space-y-2 min-h-0"
      >
        {messages.length === 0 && (
          <div className="text-center text-muted-foreground text-xs py-12 italic">
            No transmissions yet. Press the subject.
          </div>
        )}
        {messages.map((m) => {
          const content = m.content as FeedMessage;
          const isQuestion = m.type === MessageType.Question;
          const isAnswer = m.type === MessageType.Answer;

          if (isQuestion) {
            const q = content as InterrogationQuestion;
            const mine = q.detectiveName === detectiveName;
            return (
              <div
                key={m.id}
                className={cn(
                  "flex flex-col gap-0.5",
                  mine ? "items-end" : "items-start"
                )}
              >
                <div className="text-[9px] tracking-[0.18em] text-muted-foreground">
                  DET. {q.detectiveName.toUpperCase()} ▸ {q.suspectId}
                </div>
                <div
                  className={cn(
                    "px-3 py-2 max-w-[85%] border text-sm",
                    mine
                      ? "bg-sky-500/10 border-sky-500/50 text-sky-100"
                      : "bg-zinc-900 border-zinc-700 text-foreground"
                  )}
                >
                  {q.text}
                </div>
              </div>
            );
          }

          if (isAnswer) {
            const a = content as InterrogationAnswer;
            return (
              <div key={m.id} className="flex flex-col gap-0.5 items-start">
                <div className="text-[9px] tracking-[0.18em] text-red-500">
                  {a.suspectName} ▸ SUBJECT
                </div>
                <div
                  className={cn(
                    "px-3 py-2 max-w-[85%] border text-sm bg-zinc-950 border-red-500/30 text-foreground",
                    a.flagged && "noir-flagged border-red-500"
                  )}
                >
                  {a.flagged && (
                    <div className="text-[9px] tracking-[0.2em] text-red-500 mb-1">
                      [!] ADMISSION DETECTED
                    </div>
                  )}
                  {a.text}
                </div>
              </div>
            );
          }

          return null;
        })}
      </div>

      {typing.length > 0 && (
        <div className="px-3 py-1 text-[10px] text-muted-foreground italic">
          {typing.join(", ")} typing…
        </div>
      )}

      {error && (
        <div className="px-3 py-2 text-[10px] text-red-500 bg-red-500/10 border-t border-red-500/30">
          {error}
        </div>
      )}

      <form
        onSubmit={onSubmit}
        className="border-t border-border p-2 flex items-center gap-2"
      >
        <span className="text-sky-500 text-xs tracking-widest pl-1">
          {detectiveName}&gt;
        </span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={pending}
          placeholder={pending ? "subject is responding…" : "ask the subject"}
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none px-2 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending || !draft.trim()}
          className="px-4 py-1.5 text-xs tracking-[0.18em] font-bold bg-sky-500 text-zinc-950 hover:bg-sky-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {pending ? "…" : "PRESS"}
        </button>
      </form>
    </div>
  );
}
