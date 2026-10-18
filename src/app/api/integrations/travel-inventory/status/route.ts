import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-request";
import { providerStatuses } from "@/lib/travel-inventory/providers";

// Admin-only, read-only: which live-inventory providers could power hotels, flights, rail and bus, what each can do
// once connected, which credentials it needs, and whether this deployment has them. Values are never shown.
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return NextResponse.json({
    providers: providerStatuses().map((p) => ({ id: p.id, mode: p.mode, name: p.name, connected: p.connected, caps: p.caps, credentialsRequired: p.credentialsRequired, missing: p.missing, note: p.note })),
    rule: "Prices and availability come only from a provider response with its retrieval time. Unconnected modes hand off to the provider's own booking page.",
  });
}
