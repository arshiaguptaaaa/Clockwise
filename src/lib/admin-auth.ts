import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";

// Single shared password (ADMIN_PASSWORD), appropriate for this MVP's one
// operator. The session cookie is HMAC-signed with that same password so
// it's tamper-evident even though it's also httpOnly — cheap defense in
// depth, no separate secret to manage.
const ADMIN_COOKIE = "clockwise_admin";
const MAX_AGE = 60 * 60 * 8; // 8 hours

function sign(value: string): string {
  const secret = process.env.ADMIN_PASSWORD ?? "";
  return createHmac("sha256", secret).update(value).digest("hex");
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || !password) return false;
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function createAdminSession(): Promise<void> {
  const store = await cookies();
  const token = "admin";
  store.set(ADMIN_COOKIE, `${token}.${sign(token)}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function isAdminAuthenticated(): Promise<boolean> {
  const store = await cookies();
  const raw = store.get(ADMIN_COOKIE)?.value;
  if (!raw) return false;
  const [token, signature] = raw.split(".");
  if (!token || !signature) return false;
  return signature === sign(token);
}

export async function clearAdminSession(): Promise<void> {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
}
