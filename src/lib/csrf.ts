import { createHmac, createHash, timingSafeEqual } from "crypto";

// CSRF protection for admin endpoints that change something or spend money (POST-only). Pure; no Next imports.
//
// Two independent checks, both required:
//  1. The request must come from this site. A browser always sends Origin (and Sec-Fetch-Site) on a POST: a request
//     from another site is refused. Tools without a browser (curl) send neither and are judged by check 2 alone.
//  2. The request must carry a token (header "x-csrf-token") that is an HMAC of the admin session cookie, keyed with
//     ADMIN_PASSWORD. Another site can neither read nor guess it, and it stops working when the session ends or the
//     password changes.
export const CSRF_HEADER = "x-csrf-token";

export function csrfTokenFor(sessionValue: string, secret: string): string {
  return createHmac("sha256", secret).update(`csrf:${sessionValue}`).digest("hex");
}

export function csrfTokenValid(token: string | null | undefined, sessionValue: string | null | undefined, secret: string | null): boolean {
  if (!token || !sessionValue || !secret) return false;
  const a = createHash("sha256").update(token).digest();
  const b = createHash("sha256").update(csrfTokenFor(sessionValue, secret)).digest();
  return timingSafeEqual(a, b);
}

export function originAllowed(origin: string | null, host: string | null, secFetchSite: string | null): boolean {
  if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none") return false;
  if (origin) {
    if (!host) return false;
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return true;
}
