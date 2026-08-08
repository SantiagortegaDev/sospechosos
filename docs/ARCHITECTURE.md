# Architecture — The Interrogation Room

## 1. Data flow at a glance

```
 ┌─────────────────────────────┐                 ┌─────────────────────────────┐
 │   Detective browser A       │                 │   Detective browser B       │
 │   (Next.js Client + Portal  │                 │   (Next.js Client + Portal  │
 │    SDK, anonymous identity) │                 │    SDK, anonymous identity) │
 └──────────────┬──────────────┘                 └──────────────┬──────────────┘
                │ publishable key (pk_…)                         │
                │ WebSocket                                     │
                ▼                                               ▼
        ┌─────────────────────────────────────────────────────────────┐
        │                    Portal realtime cloud                    │
        │  (per-channel message broker + presence + history store)    │
        └─────────────────────────────────────────────────────────────┘
                              │▲
                              ││  HTTP webhook (message.published, message.retracted)
                              ││  HMAC-SHA256 signed
                              ▼│
                       ┌──────────────────┐
                       │  Next.js API     │
                       │  /api/           │
                       │  portal-webhook  │   (audit log / future server-side logic)
                       └──────────────────┘


 AI round-trip (one detective interrogates, both see the result):

   Det A types "Do you know Kestrel?" in Col 2 composer
       │
       ├──(1)──▶ send({ type: interrogation.question, content }) to Portal
       │         │
       │         └──▶ Det B's useChannel onMessage fires → Col 2 renders the question
       │
       ├──(2)──▶ POST /api/interrogate { suspectId, question, previousBiometrics }
       │         │
       │         ├──(2a) biometric delta engine (deterministic, no LLM):
       │         │       nextBiometric(suspect, question, prev) → {state, trigger}
       │         │
       │         ├──(2b) LLM call (z-ai-web-dev-sdk / OpenAI / Groq):
       │         │       generateSuspectReply({ systemPrompt, history, question })
       │         │       → text reply
       │         │
       │         └──(2c) detectFlag(reply.text) → boolean
       │
       ├──(3)──◀ response: { answer, biometrics, trigger, ms }
       │
       ├──(4)──▶ send({ type: interrogation.answer, content: answer }) to Portal
       │         │
       │         └──▶ Det B sees the AI's reply in Col 2
       │
       └──(5)──▶ send({ type: biometrics.update, ephemeral: true, content: sample })
                 │
                 └──▶ Det A + Det B's useBiometricStream onMessage fires
                     → Col 1 SubjectPanel bars animate to new values
```

## 2. Channel map

Five channels per case. All derive from a single `CASE_ID` (`case_001` in the hackathon) so two tabs collide into the same room.

| Channel ID | Content type | Persistent? | Purpose |
|---|---|---|---|
| `interrogation:{caseId}` | `interrogation.question` / `interrogation.answer` | yes (history: 30) | Central chat where detectives press the AI |
| `detectives:{caseId}` | `detectives.note` | yes (history: 30) | Private conspiracy channel between the two humans |
| `clandestine:{caseId}` | `clandestine.whisper` | yes (history: 30) | AI ↔ AI back-channel; detectives sniff via late-join backfill |
| `evidence:{caseId}` | `evidence.pin` (persistent) + `cursor` (ephemeral) | mixed | Shared multiplayer surface: pins + live cursors on one channel |
| `biometrics:{caseId}` | `biometrics.update` | **ephemeral only** | Live telemetry stream; only the latest sample matters |

### Why one channel for both pins and cursors?

Following Portal's [Live cursors guide](https://docs.useportal.co/guides/live-cursors) — cursors are ephemeral sends (`ephemeral: true`), pins are persistent sends. The channel's `type` field discriminates them at the consumer side. Sharing the channel means a single WebSocket subscription serves both signals, halving the connection count.

### Why ephemeral for biometrics?

Biometric samples are a "latest value wins" signal — history of past stress values isn't useful in the UI. Marking them `ephemeral: true` means:
- No `seq`, no persistence, no history replay on reconnect.
- No webhook delivery (Portal skips ephemeral messages in webhooks).
- Lower overhead on the channel store.

## 3. The two-channel cursor pattern

Portal's docs describe this exactly; we implement it in `src/hooks/use-cursors.ts`:

| Signal | Mechanism | Why |
|---|---|---|
| Live movement | `send({ ephemeral: true, type: "cursor", content })` on every `pointermove` | Smooth, no persistence overhead, no history replay |
| Last-known position | `setMetadata({ cursor })` throttled to ~4 Hz | New joiners see something immediately via the presence snapshot |

`setMetadata` re-broadcasts the whole presence bag every call — that's why we hand-throttle to 250 ms. The ephemeral stream carries the in-between frames.

The merge logic: live cursors win over fallback for the same user id. A freshly-joined detective sees everyone's last-known position immediately (fallback), then their cursors start moving (live).

## 4. AI layer

### Stateless by design

The `/api/interrogate` endpoint is stateless. The biometric "previous state" is passed in by the client (kept in React state in `DashboardShell`). This means:
- Any detective can pick up the interrogation where the other left off — the biometric state is shared via the ephemeral channel, not stored server-side.
- For multi-turn LLM context, the client should pass prior Q&A as `history` (currently empty in the hackathon — easy extension point).

### Biometric delta engine (`src/lib/ai/biometrics.ts`)

Deterministic, no LLM round-trip:

1. Start from `previous` (or suspect's `baseline` if first turn).
2. **Relax** 8% of the gap back toward baseline — so telemetry decays naturally between aggressive questions.
3. Apply the first matching `stressRule` from the suspect definition (regex against the lowercase question). Rules are ordered most-specific-first.
4. Clamp to physical ranges (stress 0–100, bpm 50–180, coherence 0–100).

### LLM wrapper (`src/lib/ai/llm.ts`)

Single function: `generateSuspectReply({ systemPrompt, history, question })`. The rest of the codebase never imports the SDK directly, so swapping providers is a one-file change:

```ts
// To switch to OpenAI:
import OpenAI from "openai";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const completion = await openai.chat.completions.create({
  messages: [{ role: "system", content: input.systemPrompt }, ...input.history, { role: "user", content: input.question }],
  temperature: 0.7,
  max_tokens: 220,
});
return { text: completion.choices[0].message.content, ms: Date.now() - t0 };
```

Same shape for Groq (`groq-sdk`).

## 5. Webhooks

Portal relays every persisted message to `/api/portal-webhook` once `webhooks.url` is set in `portal.config.ts`. For the hackathon the endpoint just verifies the signature and logs. Production uses:

- **Audit log**: persist every question + answer to a DB for post-game review.
- **Server-side biometric publishing**: instead of having the detective's browser publish the biometric update (current pattern), the webhook handler can call `serverPublish()` to publish from the backend — hiding the biometric computation entirely from the client.
- **Anti-cheat**: detect anomaly patterns (e.g. a "detective" sending `interrogation.answer` messages) and reject them at the authz layer.

Signature verification follows Portal's spec:
- Header: `portal-signature: t=<unix-seconds>,v1=<hex-hmac-sha256>`
- Plaintext: `{t}.{rawBody}`
- Secret: per-environment, fetched via `GET /v1/webhooks/secret` with `Authorization: Bearer sk_…`

The handler is raw-body-aware (signature verification MUST use the exact bytes Portal sent, not a re-serialized JSON parse). See `src/app/api/portal-webhook/route.ts`.

## 6. Anonymous mode vs. identified detectives

For the hackathon we run in **anonymous mode** — every browser gets a stable anonymous identity across refreshes, no token endpoint required. This is what makes the demo "open two tabs and go."

To upgrade to identified detectives:

1. Stand up `/api/portal-token` that authenticates the request (NextAuth, your own JWT, whatever) and returns a Portal-signed JWT.
2. Pass it to `<PortalProvider client={portal} token={fetchPortalToken}>`.
3. In `portal.config.ts`, set `anonymous: false` on the channels you want to gate.
4. Use `authz` rules to enforce role claims (e.g. only `role: "detective"` can join `detectives:*`).

See Portal's [Quickstart → Add real users](https://docs.useportal.co/) and [Authoring portal.config.ts](https://docs.useportal.co/) for the full token flow.
