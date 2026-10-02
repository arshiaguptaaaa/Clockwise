import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";

// Read-only capability probe (signed-in only): does the configured
// GNANI_API_KEY authenticate against the Agent Builder Platform API, which is
// where outbound calls live? Calls List Agents (GET) and reports only the HTTP
// status and a short sanitised body — never the key. A 401/403 here means the
// Speech key doesn't carry Platform access.
export async function GET() {
  if (!(await getCurrentUserId())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const key = process.env.GNANI_API_KEY;
  if (!key) return NextResponse.json({ configured: false, error: "GNANI_API_KEY is not visible to this deployment." }, { status: 503 });
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
