import { NextResponse } from "next/server";
import { currentCsrfToken, requireAdmin } from "@/lib/admin-request";

// Admin-only. Returns the CSRF token for the current admin session (never cached).
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return NextResponse.json({ token: await currentCsrfToken() }, { headers: { "Cache-Control": "no-store" } });
}
