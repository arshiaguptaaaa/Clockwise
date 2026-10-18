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
    sameSite: "lax",
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

export async function clearAdminSession(): Promise<void> {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
}
