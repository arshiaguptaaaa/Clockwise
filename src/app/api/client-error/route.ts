import { NextRequest, NextResponse } from "next/server";
import { logError } from "@/lib/error-log";
import { getCurrentUserId } from "@/lib/session";

// Browser error beacon (render errors from error.tsx / global-error.tsx and uncaught errors). Capped sizes, no auth
// needed, and one row per call, so the worst a caller can do is add noise to a counter.
export async function POST(request: NextRequest) {
  try {
    const b = (await request.json()) as { message?: unknown; digest?: unknown; stack?: unknown; path?: unknown };
    const message = typeof b.message === "string" ? b.message : "";
    if (!message) return NextResponse.json({ ok: false }, { status: 400 });
    await logError({
      source: "CLIENT",
      message,
      digest: typeof b.digest === "string" ? b.digest : null,
      stack: typeof b.stack === "string" ? b.stack : null,
      path: typeof b.path === "string" ? b.path : null,
      userId: await getCurrentUserId(),
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
