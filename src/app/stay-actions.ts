"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/session";
import { findStays, proposeStay, saveStay, savedStayIds, markStayBooked, type StayFinding, type StayRef } from "@/lib/stays";
import { parseMajorToMinor } from "@/lib/budget/money";

export async function findStaysAction(tripId: string, wants: string[]): Promise<(StayFinding & { saved?: string[] }) | { ok: false; error: string }> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Sign in first." };
  const r = await findStays(tripId, wants);
  if (!r.ok) return r;
  return { ...r, saved: await savedStayIds(tripId, userId) };
}

export async function saveStayAction(tripId: string, stay: StayRef): Promise<{ ok: boolean; saved?: boolean }> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false };
  const r = await saveStay(tripId, userId, stay);
  return { ok: r.ok, saved: r.saved };
}

export async function proposeStayAction(tripId: string, stay: StayRef): Promise<{ ok: boolean; error?: string; duplicate?: boolean }> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Sign in first." };
  const r = await proposeStay(tripId, userId, stay);
  revalidatePath(`/trips/${tripId}/room`);
  return r.ok ? { ok: true, duplicate: r.duplicate } : { ok: false, error: r.error };
}

export async function markStayBookedAction(bookingId: string, amount?: string, currency?: string): Promise<{ ok: boolean; error?: string }> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Sign in first." };
  const minor = amount && amount.trim() ? parseMajorToMinor(amount) : null;
  if (amount && amount.trim() && minor == null) return { ok: false, error: "That amount isn't a valid number." };
  const r = await markStayBooked(bookingId, userId, minor ? { amountMinor: minor, currency: (currency || "INR").toUpperCase() } : undefined);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}


export async function savedStayIdsAction(tripId: string): Promise<string[]> {
  const userId = await getCurrentUserId();
  return userId ? savedStayIds(tripId, userId) : [];
}
