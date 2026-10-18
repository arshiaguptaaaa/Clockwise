"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { verifyAdminPassword, createAdminSession, clearAdminSession, isAdminConfigured } from "@/lib/admin-auth";
import { clientKey, hitBucket, peekBucket, resetBucket } from "@/lib/rate-limit";
import { LOGIN_MAX_FAILS_PER_IP, LOGIN_WINDOW_MS, loginGate, waitText } from "@/lib/rate-limit-core";

// Counters live in Postgres so every Vercel instance shares them. Failures are counted per client address (stored only
// as a salted hash) and across everyone. While a counter is over its limit, sign-in is refused WITHOUT looking at the
// password, so a correct guess made during a lockout does not succeed.
const GLOBAL_KEY = "admin-login:global";

async function clientAddress(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-vercel-forwarded-for") ?? h.get("x-forwarded-for") ?? "";
  return fwd.split(",")[0].trim() || h.get("x-real-ip") || "unknown";
}

// Shaped for useActionState (previous state first) so the login form posts to this action even before JavaScript loads.
export async function adminLogin(_prev: { error: string } | null, formData: FormData): Promise<{ error: string } | null> {
  const password = String(formData.get("password") ?? "");
  if (!isAdminConfigured()) return { error: "Admin sign-in is disabled on this deployment." };

  const ipKey = clientKey("admin-login:ip", await clientAddress(), process.env.ADMIN_PASSWORD ?? "");
  try {
    const gate = loginGate(await peekBucket(ipKey), await peekBucket(GLOBAL_KEY), new Date());
    if (gate.blocked) return { error: `Too many failed attempts. Try again in ${waitText(gate.retryAfterSeconds)}.` };
  } catch (err) {
    // If the counters cannot be read, do not let sign-in through unthrottled.
    console.error("admin login rate-limit check failed:", err);
    return { error: "Sign-in is temporarily unavailable. Try again shortly." };
  }

  const ok = await verifyAdminPassword(password);
  if (!ok) {
    try {
      const ip = await hitBucket(ipKey, LOGIN_WINDOW_MS);
      await hitBucket(GLOBAL_KEY, LOGIN_WINDOW_MS);
      if (ip.count >= LOGIN_MAX_FAILS_PER_IP) return { error: `Incorrect password. Too many failed attempts: locked for ${waitText(LOGIN_WINDOW_MS / 1000)}.` };
    } catch (err) {
      console.error("admin login rate-limit write failed:", err);
    }
    return { error: "Incorrect password." };
  }
  await resetBucket(ipKey).catch(() => undefined);
  await createAdminSession();
  redirect("/admin/waitlist");
}

export async function adminLogout(): Promise<void> {
  await clearAdminSession();
  redirect("/admin/login");
}
