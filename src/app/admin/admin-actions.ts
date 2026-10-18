"use server";

import { redirect } from "next/navigation";
import { verifyAdminPassword, createAdminSession, clearAdminSession, isAdminConfigured } from "@/lib/admin-auth";

// Shaped for useActionState (previous state first) so the login form posts to this action even before JavaScript loads.
export async function adminLogin(_prev: { error: string } | null, formData: FormData): Promise<{ error: string } | null> {
  const password = String(formData.get("password") ?? "");
  if (!isAdminConfigured()) return { error: "Admin sign-in is disabled on this deployment." };
  const ok = await verifyAdminPassword(password);
  if (!ok) {
    return { error: "Incorrect password." };
  }
  await createAdminSession();
  redirect("/admin/waitlist");
}

export async function adminLogout(): Promise<void> {
  await clearAdminSession();
  redirect("/admin/login");
}
