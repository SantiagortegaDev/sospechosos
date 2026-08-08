# THE INTERROGATION ROOM // `sospechosos`

> Realtime collaborative AI interrogation. Two human detectives, two AI suspects, one truth buried under lies. Built on [Portal](https://useportal.co) realtime infrastructure + [Groq](https://groq.com) for ultra-low-latency LLM inference.

A hackathon project — Cyber-Noir / Brutalist Digital aesthetic. Detectives log in with a shared **room code**, then collaborate on a 3-column dashboard: interrogate AI suspects in a central live chat, conspire in a private back-channel, hold-to-intercept AI-to-AI whispers, drop evidence pins on a multiplayer board with live cursors, and watch the suspects' biometric telemetry (stress / BPM / coherence) spike as questions land — plus the suspects produce autonomous thoughts/interjections/questions on their own.

---

## Quick start

### 1. Configure Portal origins (REQUIRED — fixes the "origin not registered" error)

Portal requires every domain that connects to the SDK to be registered per environment. Run these once:

```bash
# Install the Portal CLI (one-time)
npm install -g @portalsdk/config

# Login (opens browser)
portal login

# Register your Vercel production URL
portal origins add https://sospechosos.vercel.app --env env_10a3611e3f81448db51b2d3df8a61dc5

# Register localhost for local dev
portal origins add http://localhost:3000 --env env_10a3611e3f81448db51b2d3df8a61dc5
```

### 2. Install & configure

```bash
bun install   # or: npm install

cp .env.example .env.local
# Edit .env.local:
#   NEXT_PUBLIC_PORTAL_API_KEY=pk_...        (Portal publishable key)
#   GROQ_API_KEY=gsk_...                     (https://console.groq.com/keys)
#   PORTAL_SECRET_KEY=sk_...                 (optional, for webhook verification)
```

### 3. Run

```bash
bun run dev   # or: npm run dev
```

Open the app — it shows a **login screen**. Enter:
- **Detective handle**: e.g. `HARLOW` (displayed to your partner and the subjects)
- **Room code**: e.g. `case-001` (share this with your partner so they join the same room)

Open a second browser tab (or share the link with a teammate using the same room code). Both detectives land in the same room — you'll see each other's cursor on the evidence board, your messages in the interrogation feed, and each other's notes in the private detectives' channel.

Pick a suspect, type a question, hit `PRESS`. The AI replies in-character via Groq (Llama 3.3 70B); both detectives see the answer and the biometric bars update simultaneously.

### Try these pressure points

| Suspect | Try asking | Watch |
|---|---|---|
| **ELENA VOSS** | "Do you know Kestrel Holdings?" | Stress spikes (OFFSHORE_TRIGGER) |
| **ELENA VOSS** | "Where were you on July 14th after 9pm?" | Stress + BPM rise (TIMELINE_PRESSURE) |
| **RICHARD HALE** | "What happened to Martin Reyes?" | All three metrics redline (REYES_PRESSURE) |
| **RICHARD HALE** | "Did Elena Voss authorize the wire?" | Coherence drops (VOSS_MENTION) |

---

## Features

### Realtime (Portal)
- **5 channels per room**: `interrogation`, `detectives`, `clandestine`, `evidence`, `biometrics`, `ai-events`
- **Live cursors** on the evidence board (Portal's two-channel pattern: ephemeral sends + throttled `setMetadata` fallback)
- **Presence** — the header shows how many detectives are online
- **Ephemeral biometric stream** — stress / BPM / coherence update in real time across both detectives
- **AI events stream** — autonomous thoughts/interjections/questions

### AI layer (Groq)
- **2 AI suspects** with role-played system prompts, secrets, and explicit lies they will tell
- **Deterministic biometric delta engine** — no LLM round-trip needed for telemetry updates; the suspect's `stressRules` (regex on the question) drive the deltas
- **Autonomous AI events** — every ~25s, the host detective triggers `/api/ai-tick`, which generates a spontaneous output (thought / interjection / question) for a random suspect and publishes it to the ai-events channel. The SubjectPanel shows the latest event as "INTERNAL STATE"
- **Swap-friendly LLM wrapper** — `src/lib/ai/llm.ts` is the only file that imports the Groq SDK. Swap to OpenAI / Anthropic / whatever by editing one file

### Mechanics
- **Login screen** — username + room code. The room code is what makes two detectives on different networks meet in the same room.
- **Hold-to-intercept** — the clandestine AI-to-AI back-channel is only visible while a detective HOLDS DOWN the INTERCEPT button. Releasing it stops the live feed; whispers received while not intercepting are counted as "missed".
- **Host / guest** — the first detective to join the room becomes "host" and runs the AI tick loop. The footer shows `HOST · AI TICK ON` or `GUEST · LISTENING`. This avoids both detectives double-firing AI events.
- **SubjectPanel with INTERNAL STATE** — each suspect's panel shows their name, role, status, biometric telemetry (stress / BPM / coherence), baseline reference, AND the latest autonomous event (thought/interjection/question) as their internal monologue.

---

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 16 (App Router), TypeScript 5, Tailwind 4, shadcn/ui |
| Realtime | Portal — `@portalsdk/core` + `@portalsdk/react` |
| AI / LLM | Groq SDK (`groq-sdk`) — Llama 3.3 70B Versatile |
| Biometrics | Deterministic delta engine (`src/lib/ai/biometrics.ts`) — no LLM needed |
| Webhooks | Portal → `/api/portal-webhook` (HMAC-SHA256 verified) |

---

## Project structure

```
src/
├── app/
│   ├── layout.tsx                          # PortalClientProvider wrapper
│   ├── page.tsx                            # mounts DashboardShell
│   ├── globals.css                         # Cyber-Noir theme (#0a0a0a / amber / mono)
│   └── api/
│       ├── interrogate/route.ts            # POST: question → LLM → answer + biometrics
│       ├── clandestine/route.ts            # POST: AI → AI whisper
│       ├── ai-tick/route.ts                # POST: autonomous AI event generator
│       └── portal-webhook/route.ts         # Portal webhook receiver (HMAC verified)
├── components/
│   └── interrogation/
│       ├── login-screen.tsx                # username + room code entry
│       ├── dashboard-shell.tsx             # orchestrates everything; runs AI tick if host
│       ├── case-header.tsx                 # status bar (room + detective + subject + presence + clock)
│       ├── suspect-selector.tsx            # left roster list (2 suspects)
│       ├── subject-panel.tsx               # Col 1: identity + biometric telemetry + internal state
│       ├── biometric-bar.tsx               # animated horizontal metric
│       ├── interrogation-feed.tsx          # Col 2: central chat
│       ├── evidence-board.tsx              # Col 3 top: cursors + pins
│       ├── clandestine-sniffer.tsx         # Col 3 mid: HOLD TO INTERCEPT AI whispers
│       ├── private-detective-chat.tsx      # Col 3 bottom: detective back-channel
│       └── portal-client-provider.tsx      # client-only Portal client construction
├── hooks/
│   ├── use-cursors.ts                      # ephemeral + throttled setMetadata
│   ├── use-biometric-stream.ts             # single-subscriber biometric channel
│   ├── use-ai-events.ts                    # autonomous AI event subscriber
│   └── use-is-host.ts                      # determines host detective via presence
└── lib/
    ├── portal/
    │   ├── channels.ts                     # channelIdsFor(room) + content-type contracts
    │   └── server-publish.ts               # optional REST publish (sk_ key)
    └── ai/
        ├── llm.ts                          # Groq SDK wrapper (swap-friendly)
        ├── suspects.ts                     # 2 suspects + system prompts + stress rules
        └── biometrics.ts                   # delta engine (relax + clamp)

portal.config.ts                            # Portal project config (channels + webhooks + ai-events)
docs/
├── ARCHITECTURE.md                         # full data-flow + channel map
└── DEPLOY.md                               # weekend deploy guide
```

---

## Weekend roadmap

See [`docs/DEPLOY.md`](docs/DEPLOY.md) for the full guide. Recommended order:

1. **Hour 0–1** — local demo running with 2 tabs in the same room code, both detectives' cursors + chat working.
2. **Hour 1–2** — register Portal origins for your Vercel URL + localhost.
3. **Hour 2–3** — add per-suspect conversation history (currently stateless) by storing turns in Portal channel state or a DB.
4. **Hour 3–4** — `portal deploy` your `portal.config.ts` so webhook + authz rules take effect.
5. **Hour 4+** — polish: more suspects, evidence relationships, end-of-case scoring.

---

## Security notes

- The Portal **publishable key** (`pk_…`) is safe in the browser bundle.
- The Portal **secret key** (`sk_…`) and **Groq API key** (`gsk_…`) are server-only. Never commit them. `.env.local` is git-ignored.
- AI suspects' system prompts (their secrets, lies, personality) live server-side in `src/lib/ai/suspects.ts` and are never sent to the browser. Only the LLM's *reply* reaches the client.
- In production, gate `clandestine:*` and `detectives:*` channels via `authz` in `portal.config.ts` so client-side spoofing can't inject whispers or read the detective channel as a non-detective.

---

## License

MIT — go win the hackathon.
