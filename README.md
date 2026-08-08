# THE INTERROGATION ROOM // `sospechosos`

> Realtime collaborative interrogation. Two human detectives, three AI suspects, one truth buried under lies. Built on [Portal](https://useportal.co) realtime infrastructure.

A hackathon project — Cyber-Noir / Brutalist Digital aesthetic. Detectives collaborate on a shared dashboard: they interrogate AI suspects in a central live chat, conspire in a private back-channel, drop evidence pins on a multiplayer board with live cursors, and watch the suspects' biometric telemetry (stress / BPM / coherence) spike as questions land.

---

## Quick start

```bash
# 1. Install deps
bun install   # or: npm install

# 2. Configure Portal
cp .env.example .env.local
# Edit .env.local → set NEXT_PUBLIC_PORTAL_API_KEY=pk_...  (your Portal publishable key)

# 3. Run
bun run dev   # or: npm run dev
```

Open the app in **two browser tabs** (or two browsers, or share the link with a teammate). Both tabs land in the same case room (`case_001`) and you'll see each other's cursor on the evidence board, your messages in the interrogation feed, and each other's notes in the private detectives' channel.

Pick a suspect, type a question, hit `PRESS`. The AI replies in-character; both detectives see the answer and the biometric bars update simultaneously.

### Try these pressure points

| Suspect | Try asking | Watch |
|---|---|---|
| **ELENA VOSS** | "Do you know Kestrel Holdings?" | Stress spikes (OFFSHORE_TRIGGER) |
| **ELENA VOSS** | "Where were you on July 14th after 9pm?" | Stress + BPM rise (TIMELINE_PRESSURE) |
| **RICHARD HALE** | "What happened to Martin Reyes?" | All three metrics redline (REYES_PRESSURE) |
| **MARA LIN** | "Did Richard Hale pressure you?" | Coherence collapses (HALE_FEAR) |

---

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full data-flow diagram and channel map. Short version:

```
                ┌────────────────────────┐
                │  Detective browser A   │
                │  (Next.js + Portal SDK)│
                └──────────┬─────────────┘
                           │ publishable key (pk_…)
                           ▼
                     ┌───────────┐  ◀──── WebSocket ────┐
                     │  Portal   │                       │
                     │ realtime  │                       │
                     └─────┬─────┘                       │
                           │ channels                    │
                ┌──────────┴─────────────┐               │
                │  Detective browser B   │───────────────┘
                │  (Next.js + Portal SDK)│
                └────────────────────────┘

  AI layer (server-only):
                ┌────────────────────────┐
                │  Detective browser A   │
                │  posts question ───────┼──▶ POST /api/interrogate
                └────────────────────────┘         │
                                                   ▼
                                          ┌─────────────────┐
                                          │ biometric engine│
                                          │ + LLM (z-ai SDK)│
                                          └────────┬────────┘
                                                   │
                                    answer + new biometric state
                                                   │
                                                   ▼
                                          browser publishes to
                                          interrogation + biometrics
                                          channels → both tabs see it
```

---

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 16 (App Router), TypeScript 5, Tailwind 4, shadcn/ui |
| Realtime | Portal — `@portalsdk/core` + `@portalsdk/react` |
| AI | `z-ai-web-dev-sdk` (sandboxed default). Swap to OpenAI / Groq by editing `src/lib/ai/llm.ts` |
| Biometrics | Deterministic delta engine (`src/lib/ai/biometrics.ts`) — no LLM needed |
| Webhooks | Portal → `/api/portal-webhook` (HMAC-SHA256 verified) |

---

## Project structure

```
src/
├── app/
│   ├── layout.tsx                          # PortalProvider wrapper + missing-key banner
│   ├── page.tsx                            # mounts DashboardShell
│   ├── globals.css                         # Cyber-Noir theme (#0a0a0a / amber / mono)
│   └── api/
│       ├── interrogate/route.ts            # POST: question → LLM → answer + biometrics
│       ├── clandestine/route.ts            # POST: AI → AI whisper
│       └── portal-webhook/route.ts         # Portal webhook receiver (HMAC verified)
├── components/
│   └── interrogation/
│       ├── dashboard-shell.tsx             # 3-column layout
│       ├── case-header.tsx                 # status bar (channel status + presence + clock)
│       ├── suspect-selector.tsx            # left roster list
│       ├── subject-panel.tsx               # Col 1: identity + biometric telemetry
│       ├── biometric-bar.tsx               # animated horizontal metric
│       ├── interrogation-feed.tsx          # Col 2: central chat
│       ├── evidence-board.tsx              # Col 3 top: cursors + pins
│       ├── clandestine-sniffer.tsx         # Col 3 mid: intercepted AI whispers
│       └── private-detective-chat.tsx      # Col 3 bottom: detective back-channel
├── hooks/
│   ├── use-cursors.ts                      # ephemeral + throttled setMetadata
│   └── use-biometric-stream.ts             # ephemeral biometric sample subscriber
└── lib/
    ├── portal/
    │   ├── client.ts                       # browser singleton (publishable key)
    │   ├── channels.ts                     # channel IDs + content-type contracts
    │   └── server-publish.ts               # optional REST publish (sk_ key)
    └── ai/
        ├── llm.ts                          # z-ai-web-dev-sdk wrapper (swap-friendly)
        ├── suspects.ts                     # 3 suspects + system prompts + stress rules
        └── biometrics.ts                   # delta engine (relax + clamp)

portal.config.ts                            # Portal project config (channels + webhooks)
docs/
├── ARCHITECTURE.md                         # full data-flow + channel map
└── DEPLOY.md                               # weekend deploy guide
```

---

## Weekend roadmap

See [`docs/DEPLOY.md`](docs/DEPLOY.md) for the full guide. Recommended order:

1. **Hour 0–1** — local demo running with 2 tabs, both detectives cursors + chat working.
2. **Hour 1–2** — wire real AI provider (OpenAI or Groq) by editing `src/lib/ai/llm.ts`.
3. **Hour 2–3** — add per-suspect conversation history (currently stateless) by storing turns in Portal channel state or a DB.
4. **Hour 3–4** — `portal deploy` your `portal.config.ts` so webhook + authz rules take effect.
5. **Hour 4+** — polish: more suspects, evidence relationships, end-of-case scoring.

---

## Security notes

- The Portal **publishable key** (`pk_…`) is safe in the browser bundle.
- The Portal **secret key** (`sk_…`) is server-only. Never commit it. The `.env.example` template marks it; `.env.local` is git-ignored.
- AI suspects' system prompts (their secrets, lies, personality) live server-side in `src/lib/ai/suspects.ts` and are never sent to the browser. Only the LLM's *reply* reaches the client.
- In production, gate `clandestine:*` and `detectives:*` channels via `authz` in `portal.config.ts` so client-side spoofing can't inject whispers or read the detective channel as a non-detective.

---

## License

MIT — go win the hackathon.
