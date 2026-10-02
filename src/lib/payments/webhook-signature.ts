// Pine Labs webhook signature check, per the documented scheme:
//   headers  webhook-id, webhook-timestamp (unix seconds), webhook-signature (base64)
//   signed   `${webhook-id}.${webhook-timestamp}.${raw body}` with HMAC-SHA256
//   key      the dashboard secret, base64-decoded
// The header may carry several space-separated signatures, optionally
// prefixed "v1,"; any match passes. Timestamps outside the tolerance are
// rejected to blunt replays.
import { createHmac, timingSafeEqual } from "crypto";

const TOLERANCE_SECONDS = 5 * 60;

export function verifyPineLabsSignature(args: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signatureHeader: string | null;
  rawBody: string;
  nowSeconds?: number;
}): boolean {
  const { secret, id, timestamp, signatureHeader, rawBody } = args;
  if (!id || !timestamp || !signatureHeader) return false;
  const ts = Number(timestamp);
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();
  return signatureHeader
    .split(" ")
    .map((s) => s.replace(/^v1,/, ""))
    .some((candidate) => {
      const got = Buffer.from(candidate, "base64");
      return got.length === expected.length && timingSafeEqual(got, expected);
    });
}
