import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { providerStatuses } from "@/lib/travel-inventory/providers";

// Signed-in, read-only: which live-inventory providers could power hotels, flights, rail and bus, what each can do
// once connected, which credentials it needs, and whether this deployment has them. Values are never shown.
export async function GET() {
  if (!(await getCurrentUserId())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  return NextResponse.json({
    providers: providerStatuses().map((p) => ({ id: p.id, mode: p.mode, name: p.name, connected: p.connected, caps: p.caps, credentialsRequired: p.credentialsRequired, missing: p.missing, note: p.note })),
    rule: "Prices and availability come only from a provider response with its retrieval time. Unconnected modes hand off to the provider's own booking page.",
  });
}
