import { createHmac, createHash, timingSafeEqual } from "crypto";

// Pure admin-auth logic (no Next.js imports) so it can be tested without a request.
//
// FAIL CLOSED: the signing key is the ADMIN_PASSWORD itself. If it is missing, empty or only whitespace there is
// no safe key (a cookie signed with an empty key can be computed by anyone), so nothing is ever valid and no
// session is ever issued. Every function below returns false/null in that case.
export const ADMIN_COOKIE = "clockwise_admin";
export const ADMIN_SESSION_SECONDS = 60 * 60 * 8; // 8 hours

// Returns the usable secret, or null when none is configured.
export function adminSecret(value: string | undefined | null): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  return value;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

// Constant-time comparison of two strings of any length (compares fixed-size digests).
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function passwordMatches(input: string, secret: string | null): boolean {
  if (!secret || !input) return false;
  return safeEqual(input, secret);
}

// Cookie value: "<expiresAtEpochSeconds>.<hmac of 'admin:<expiresAt>'>". The expiry is inside the signed payload, so a
// copied cookie stops working after 8 hours even if the browser keeps it, and changing the password invalidates
// every cookie. Cookies from the old format ("admin.<sig>") fail to parse and are rejected.
export function makeSessionValue(secret: string | null, nowMs: number = Date.now()): string | null {
  if (!secret) return null;
  const exp = Math.floor(nowMs / 1000) + ADMIN_SESSION_SECONDS;
  return `${exp}.${sign(`admin:${exp}`, secret)}`;
}

export function sessionIsValid(raw: string | undefined | null, secret: string | null, nowMs: number = Date.now()): boolean {
  if (!secret || !raw) return false;
  const parts = raw.split(".");
  if (parts.length !== 2) return false;
  const [expText, signature] = parts;
  if (!/^\d{1,12}$/.test(expText) || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const exp = Number(expText);
  if (exp <= Math.floor(nowMs / 1000)) return false;
  return safeEqual(signature, sign(`admin:${exp}`, secret));
}
