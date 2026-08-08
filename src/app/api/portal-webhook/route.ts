/**
 * POST /api/portal-webhook
 *
 * Portal relays every channel message here when you set
 * `webhooks.url` in portal.config.ts. For the hackathon this endpoint just
 * verifies the signature and logs the event — it's the foundation you'd build
 * audit logs, "evidence tampering" alarms, or server-side biometric publishing on.
 *
 * See docs/ARCHITECTURE.md → Webhooks for how to fetch the per-environment
 * signing secret and verify the `portal-signature` header.
 *
 * The handler is raw-body aware: signature verification MUST use the exact
 * bytes Portal sent, not a re-serialized JSON parse.
 */

import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCE_SECONDS = 5 * 60;

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signatureHeader = req.headers.get("portal-signature") ?? undefined;
  const secret = process.env.PORTAL_SECRET_KEY;

  // In dev without a real secret, we skip verification and just log.
  if (!secret || secret === "sk_replace_me") {
     
    console.warn("[portal-webhook] skipping signature verification (no secret set)");
    try {
      const evt = JSON.parse(rawBody);
       
      console.log("[portal-webhook] event:", evt.type, "channel:", evt.channelId);
    } catch {
       
      console.log("[portal-webhook] non-JSON body received");
    }
    return NextResponse.json({ ok: true, verified: false });
  }

  try {
    verifyWebhookSignature(rawBody, signatureHeader, secret);
  } catch (err) {
    return NextResponse.json(
      { error: "signature_verification_failed", detail: (err as Error).message },
      { status: 401 }
    );
  }

  // Verified — parse and dispatch.
  try {
    const evt = JSON.parse(rawBody);
     
    console.log("[portal-webhook] verified event:", evt.type, "channel:", evt.channelId);

    // Hook point: persist to DB, push to a SIEM, trigger a workflow, etc.
    // For the hackathon, logging is enough.
  } catch {
     
    console.log("[portal-webhook] verified, but non-JSON body");
  }

  return NextResponse.json({ ok: true, verified: true });
}

function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string
): void {
  if (!signatureHeader) throw new Error("missing portal-signature header");

  const parts = new Map<string, string>();
  for (const pair of signatureHeader.split(",")) {
    const [k, v] = pair.split("=");
    if (k && v) parts.set(k, v);
  }
  const t = parts.get("t");
  const v1 = parts.get("v1");
  if (!t || !v1) throw new Error("malformed portal-signature header");

  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) {
    throw new Error("signature timestamp outside tolerance");
  }

  const expected = createHmac("sha256", secret)
    .update(`${t}.${rawBody}`)
    .digest("hex");
  const expectedBytes = Buffer.from(expected, "hex");
  const providedBytes = Buffer.from(v1, "hex");
  const ok =
    expectedBytes.length === providedBytes.length &&
    timingSafeEqual(expectedBytes, providedBytes);
  if (!ok) throw new Error("signature does not match");
}
