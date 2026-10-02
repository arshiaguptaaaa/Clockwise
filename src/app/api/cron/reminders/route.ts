import { NextRequest, NextResponse } from "next/server";
import { processDueJobs } from "@/lib/reminder-worker";

export const maxDuration = 60;

// The worker entry point. Anything may call it, any number of times: it only
// ever processes jobs that are already DUE, claims each atomically, and
// returns counts (no personal data). It cannot create or reschedule work, so
// there is no scheduling control to abuse. If CRON_SECRET is set, callers must
// present it (Vercel Cron sends it automatically as a Bearer token).
async function run(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? request.headers.get("x-cron-secret");
    if (given !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const summary = await processDueJobs();
  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), ...summary });
}

export const GET = run;
export const POST = run;
