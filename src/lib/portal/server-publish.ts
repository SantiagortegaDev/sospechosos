/**
 * Optional server-side publish to Portal.
 *
 * For the hackathon we publish AI responses from the **browser** (the API route returns
 * the LLM output and the client posts it to the channel), because it works with just
 * the publishable key and no extra auth.
 *
 * For production you'd swap to the pattern below: your backend holds the Portal secret
 * key (`sk_...`) and POSTs to the REST publish endpoint. The Portal wire-protocol /
 * REST surface accepts the same envelope shape that webhooks deliver
 * (see `docs/ARCHITECTURE.md`).
 *
 * Endpoint shape (v1, public surface):
 *   POST  https://api.useportal.co/v1/channels/{channelId}/messages
 *   Authorization: Bearer sk_...
 *   body: { type, kind: "text", content }
 *
 * Keep this module import-safe on the server only — never import it from a Client
 * Component. The secret key lives in `PORTAL_SECRET_KEY` and must never reach the
 * browser bundle.
 */

import "server-only";

const PORTAL_API_BASE = "https://api.useportal.co/v1";

interface ServerPublishInput {
  channelId: string;
  type?: string;
  content: unknown;
  to?: string;
}

export async function serverPublish(input: ServerPublishInput): Promise<void> {
  const secret = process.env.PORTAL_SECRET_KEY;
  if (!secret || secret === "sk_replace_me") {
     
    console.warn(
      "[portal/server-publish] PORTAL_SECRET_KEY not set — skipping server publish."
    );
    return;
  }

  const res = await fetch(
    `${PORTAL_API_BASE}/channels/${encodeURIComponent(input.channelId)}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        type: input.type ?? "message",
        kind: "text",
        content: input.content,
        to: input.to,
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `[portal/server-publish] ${res.status} ${res.statusText}: ${text}`
    );
  }
}
