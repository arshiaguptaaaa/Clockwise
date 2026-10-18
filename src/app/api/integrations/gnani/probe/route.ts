import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-request";

// Read-only capability probe (admin only): does the configured
// GNANI_API_KEY authenticate against the Agent Builder Platform API, which is
// where outbound calls live? Calls List Agents (GET) and reports only the HTTP
// status and a short sanitised body — never the key. A 401/403 here means the
// Speech key doesn't carry Platform access.
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const key = process.env.GNANI_PLATFORM_API_KEY;
  if (!key) return NextResponse.json({ configured: false, error: "GNANI_PLATFORM_API_KEY is not set (GNANI_API_KEY is the Speech key and is deliberately not used here)." }, { status: 503 });
  try {
    const res = await fetch("https://api.inya.ai/platform/v1/agents", {
      headers: { "x-api-key": key, "User-Agent": "Clockwise/1.0 (+https://clockwise-lemon.vercel.app)" },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.text()).split(key).join("[redacted]").slice(0, 300);
    return NextResponse.json({
      configured: true,
      endpoint: "api.inya.ai/platform/v1/agents (List Agents, GET)",
      httpStatus: res.status,
      body,
      botIdConfigured: Boolean(process.env.GNANI_BOT_ID),
    });
  } catch (err) {
    return NextResponse.json({ configured: true, error: err instanceof Error ? err.name : "request failed" }, { status: 502 });
  }
}
