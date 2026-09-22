import { cookies } from "next/headers";
import { randomBytes } from "crypto";

const VISITOR_COOKIE = "clockwise_visitor_id";
const MAX_AGE = 60 * 60 * 24 * 365; // 1 year

// Anonymous, non-fingerprinting visitor id — a long-lived random cookie,
// distinct from the trip-member session cookie (clockwise_user_id). Only
// ever used to tell "same browser came back" from "a new page view."
export async function getVisitorId(): Promise<string | null> {
  const store = await cookies();
  return store.get(VISITOR_COOKIE)?.value ?? null;
}

// Must be called from a Server Action or Route Handler — cookies() writes
// aren't allowed during a Server Component render.
export async function ensureVisitorId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(VISITOR_COOKIE)?.value;
  if (existing) return existing;
  const id = randomBytes(16).toString("hex");
  store.set(VISITOR_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
  return id;
}
