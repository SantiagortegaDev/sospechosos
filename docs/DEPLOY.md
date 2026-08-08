# Deploy guide — weekend hackathon

This guide takes you from a fresh checkout to a running demo in under an hour, then to a production-shaped deploy.

## Part 1 — Local dev (≤ 10 minutes)

### Prerequisites

- Node.js 20+ (or Bun 1.x)
- A Portal account → grab your **publishable key** (`pk_…`) from [useportal.co](https://useportal.co)
- Two browser profiles (or two browsers, or a teammate) to test the multiplayer feel

### Steps

```bash
# 1. Clone (or unzip the boilerplate)
git clone https://github.com/SantiagortegaDev/sospechosos.git
cd sospechosos

# 2. Install deps
bun install     # or: npm install

# 3. Configure Portal
cp .env.example .env.local
# Edit .env.local → NEXT_PUBLIC_PORTAL_API_KEY=pk_your_publishable_key

# 4. Run
bun run dev     # or: npm run dev
```

Open the preview in **two browser tabs**. Both land in the same case room. You should see:
- The other tab's cursor moving on the evidence board (Col 3 top).
- Your messages appear in the interrogation feed (Col 2) on both tabs.
- Private notes in the detective channel (Col 3 bottom) on both tabs.

Pick a suspect, type a question, hit `PRESS`. The AI replies; both tabs see the reply and the biometric bars update.

### If something's broken

| Symptom | Likely cause | Fix |
|---|---|---|
| "MISSING KEY" banner | `NEXT_PUBLIC_PORTAL_API_KEY` not set | Edit `.env.local`, restart `bun run dev` |
| Channels stuck in `connecting` | Wrong key, or Portal env not yet provisioned | Verify the `pk_` prefix; check the [Portal dashboard](https://useportal.co) |
| AI replies with "I'd like to speak with my attorney…" | LLM call failing (sandboxed `z-ai-web-dev-sdk` unreachable, or quota) | Swap `src/lib/ai/llm.ts` to OpenAI/Groq — see Part 2 |
| Cursur laggy | You're on a slow connection; throttle is 250 ms | Lower `METADATA_THROTTLE_MS` in `src/hooks/use-cursors.ts` |

## Part 2 — Swap the AI provider (≤ 10 minutes)

The default uses the in-environment `z-ai-web-dev-sdk`. To use OpenAI or Groq instead, edit only `src/lib/ai/llm.ts`:

### OpenAI

```bash
bun add openai
```

```ts
// src/lib/ai/llm.ts
import OpenAI from "openai";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function generateSuspectReply(input: GenerateReplyInput): Promise<GenerateReplyOutput> {
  const t0 = Date.now();
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: input.systemPrompt },
      ...input.history,
      { role: "user", content: input.question },
    ],
    temperature: 0.7,
    max_tokens: 220,
  });
  return {
    text: completion.choices[0]?.message?.content?.trim() ?? "No comment.",
    ms: Date.now() - t0,
  };
}
```

Add `OPENAI_API_KEY=sk-...` to `.env.local`.

### Groq (recommended for ultra-low latency)

```bash
bun add groq-sdk
```

```ts
import Groq from "groq-sdk";
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });

export async function generateSuspectReply(input: GenerateReplyInput): Promise<GenerateReplyOutput> {
  const t0 = Date.now();
  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: input.systemPrompt },
      ...input.history,
      { role: "user", content: input.question },
    ],
    temperature: 0.7,
    max_tokens: 220,
  });
  return {
    text: completion.choices[0]?.message?.content?.trim() ?? "No comment.",
    ms: Date.now() - t0,
  };
}
```

Add `GROQ_API_KEY=gsk_...` to `.env.local`.

**The rest of the system doesn't care which provider you use.** The wrapper is the only file that touches the SDK.

## Part 3 — Deploy Portal config (webhooks + authz)

The `portal.config.ts` at the project root defines channel patterns, authz rules, and webhook URL. To activate it:

```bash
# Install the Portal CLI (one-time)
npm install -g @portalsdk/config

# Log in (opens browser)
portal login

# Deploy the config
portal deploy
```

`portal deploy` validates the webhook URL (https only — `http://localhost` is accepted for local dev) before uploading. The first deploy with a webhook mints a per-environment signing secret; fetch it with:

```bash
curl -H "Authorization: Bearer sk_your_secret_key" \
  https://api.useportal.co/v1/webhooks/secret
# → { "secret": "whsec_..." }
```

Add that secret to your production env as `PORTAL_WEBHOOK_SECRET` (the webhook handler verifies against this).

## Part 4 — Deploy the app

### Vercel (recommended for Next.js)

```bash
# 1. Push to GitHub (done already if you cloned from there)
# 2. Import the repo in Vercel
# 3. Set env vars in the Vercel dashboard:
#      NEXT_PUBLIC_PORTAL_API_KEY  = pk_...
#      PORTAL_SECRET_KEY           = sk_...
#      OPENAI_API_KEY  or  GROQ_API_KEY  = ...
# 4. Deploy
```

Vercel handles the Next.js build automatically. The webhook URL in `portal.config.ts` should point to `https://your-app.vercel.app/api/portal-webhook` — update it and re-run `portal deploy`.

### Self-hosted (Docker)

```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build
EXPOSE 3000
CMD ["bun", "run", "start"]
```

```bash
docker build -t sospechosos .
docker run -p 3000:3000 \
  -e NEXT_PUBLIC_PORTAL_API_KEY=pk_... \
  -e PORTAL_SECRET_KEY=sk_... \
  -e OPENAI_API_KEY=sk-... \
  sospechosos
```

## Part 5 — Production hardening checklist

Before showing this to judges / real users:

- [ ] Set `anonymous: false` on `detectives:*` and `clandestine:*` in `portal.config.ts`; gate via `authz` role claims.
- [ ] Stand up `/api/portal-token` returning a Portal-signed JWT identifying the detective.
- [ ] Pass `token={fetchPortalToken}` to `<PortalProvider>`.
- [ ] Move AI response publishing from the client to the server (use `serverPublish()` from `src/lib/portal/server-publish.ts`) so the AI's `sender.id` is the suspect, not the detective.
- [ ] Add per-suspect conversation history persistence (DB or Portal channel state) so multi-turn pressure actually builds.
- [ ] Verify webhook signatures in production (currently dev-skipped when `PORTAL_SECRET_KEY` is unset).
- [ ] Add rate limiting on `/api/interrogate` (1 req/sec per IP) to prevent LLM cost runaway.
- [ ] Rotate any keys that were ever pasted into chat (yes, this includes the GitHub PAT and Portal keys you shared while setting this up).
