import { cookies } from "next/headers";
import {
  ADMIN_COOKIE,
  ADMIN_SESSION_SECONDS,
  adminSecret,
  makeSessionValue,
  passwordMatches,
  sessionIsValid,
} from "@/lib/admin-auth-core";

// Single shared password (ADMIN_PASSWORD), appropriate for this MVP's one operator. The session cookie is
// HMAC-signed with that same password and carries its own expiry. If ADMIN_PASSWORD is not configured, admin access
// is disabled completely (see admin-auth-core.ts): no login succeeds and no cookie is ever accepted.
const secret = () => adminSecret(process.env.ADMIN_PASSWORD);

export function isAdminConfigured(): boolean {
  return secret() !== null;
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  return passwordMatches(password, secret());
}

export async function createAdminSession(): Promise<void> {
  const value = makeSessionValue(secret());
  if (!value) return;
  const store = await cookies();
  store.set(ADMIN_COOKIE, value, {
    httpOnly: true,
    // Strict: the admin cookie is never sent on any cross-site request, which is CSRF defence in depth.
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_SESSION_SECONDS,
  });
}

export async function isAdminAuthenticated(): Promise<boolean> {
  const key = secret();
  if (!key) return false;
  const store = await cookies();
  return sessionIsValid(store.get(ADMIN_COOKIE)?.value, key);
}

// The raw session cookie, only if it is a valid, unexpired admin session. Used to bind CSRF tokens to the session.
export async function getAdminSessionValue(): Promise<string | null> {
  const key = secret();
  if (!key) return null;
  const raw = (await cookies()).get(ADMIN_COOKIE)?.value;
  return sessionIsValid(raw, key) ? (raw ?? null) : null;
}

export function adminSecretForCsrf(): string | null {
  return secret();
}

export async function clearAdminSession(): Promise<void> {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
}
