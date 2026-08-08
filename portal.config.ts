/**
 * portal.config.ts — Portal project-level configuration.
 *
 * Deploy with `npx portal deploy` (requires `@portalsdk/config` installed
 * globally and `PORTAL_SECRET_KEY` exported). See docs/DEPLOY.md.
 *
 * This file is loaded by Portal's CLI at deploy time; it is NOT imported by
 * the Next.js app at runtime. It configures:
 *   - channel patterns & authz rules
 *   - webhooks (server-to-server event delivery)
 *   - notify bridges (in-app notifications)
 *
 * For the hackathon we keep it minimal: anonymous mode allowed everywhere
 * (the demo runs without a token endpoint), plus a webhook pointing at our
 * /api/portal-webhook endpoint for audit logging.
 */

import { defineConfig } from "@portalsdk/config";

export default defineConfig({
  // ─────────── Channels ───────────
  // Patterns use `*` wildcards. We define one pattern per case-prefixed family.
  channels: {
    // Central interrogation chat — both detectives press the active AI suspect here.
    "interrogation:*": {
      // Anonymous mode allowed: the demo runs without a backend JWT endpoint.
      // Tighten to `anonymous: false` once you wire real auth.
      anonymous: true,
    },

    // Private conspiracy channel between the two humans.
    // In production, set `anonymous: false` and gate membership to detective
    // role claims via `authz`. For the hackathon we keep it open so any two
    // tabs can conspire.
    "detectives:*": {
      anonymous: true,
    },

    // Background whispers between AI suspects. Detectives sniff via late-join
    // backfill. In production you'd `authz` this so only server-published
    // messages land here (no client sends).
    "clandestine:*": {
      anonymous: true,
    },

    // Evidence board + collaborative cursors on the same channel.
    // Cursors are ephemeral sends; pins are persistent.
    "evidence:*": {
      anonymous: true,
    },

    // Biometric stream — ephemeral only, no history.
    "biometrics:*": {
      anonymous: true,
    },
  },

  // ─────────── Webhooks ───────────
  // Portal POSTs every persisted message to this URL. Set it to your deployed
  // origin. For local dev, Portal accepts http://localhost:3000 — see DEPLOY.md.
  webhooks: {
    url: process.env.PORTAL_WEBHOOK_URL ?? "https://sospechosos.example.com/api/portal-webhook",
  },

  // ─────────── Notifications (optional, for inbox) ───────────
  // If you want flagged AI admissions to surface as inbox items, add a notify
  // bridge here that matches `interrogation.answer` messages with `flagged:true`.
  // channels: {
  //   "interrogation:*": {
  //     notify: (ctx) => {
  //       if (ctx.message.type !== "interrogation.answer") return null;
  //       const a = ctx.message.content as { flagged?: boolean };
  //       if (!a.flagged) return null;
  //       return {
  //         title: "ADMISSION DETECTED",
  //         data: a,
  //         to: ctx.message.to,
  //       };
  //     },
  //   },
  // },
});
