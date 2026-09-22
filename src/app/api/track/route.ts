import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureVisitorId } from "@/lib/visitor";
import { captureAttribution, getStoredAttribution } from "@/lib/attribution";

// Fire-and-forget analytics beacon (called with `keepalive: true` from
// client components) — logs one PageView-shaped row per event:
// landing_view, plan_trip_clicked, join_trip_clicked, waitlist_clicked,
// demo_clicked, waitlist_submitted. Never blocks navigation, never throws
// visibly to the caller.
export async function POST(request: NextRequest) {
  const event = request.nextUrl.searchParams.get("event");
  if (!event) {
    return NextResponse.json({ error: "Missing event" }, { status: 400 });
  }

  try {
    const referrer = request.headers.get("referer");
    await captureAttribution(request.nextUrl.searchParams, referrer);

    const visitorId = await ensureVisitorId();
    const attribution = await getStoredAttribution();

    await prisma.pageView.create({
      data: {
        page: event,
        visitorId,
        source: attribution.source,
        medium: attribution.medium,
        campaign: attribution.campaign,
        referrer: attribution.referrer,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Event tracking failed:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
