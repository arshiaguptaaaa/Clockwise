import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Captures UTM/source attribution synchronously on the very first request
// to a landing page — before any client JS runs — rather than relying on a
// fire-and-forget client beacon to set the cookie in time. That client
// beacon (src/lib/attribution.ts's captureAttribution, called from
// /api/track) still runs too, as a harmless backup for pages this proxy
// doesn't cover.
const ATTRIBUTION_COOKIE = "clockwise_attribution";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function proxy(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const source = searchParams.get("source") ?? searchParams.get("utm_source");
  const medium = searchParams.get("utm_medium");
  const campaign = searchParams.get("utm_campaign");

  if (!source && !medium && !campaign) {
    return NextResponse.next();
  }

  const response = NextResponse.next();
  response.cookies.set(
    ATTRIBUTION_COOKIE,
    JSON.stringify({ source, medium, campaign, referrer: request.headers.get("referer") }),
    { httpOnly: true, sameSite: "lax", path: "/", maxAge: MAX_AGE }
  );
  return response;
}

export const config = {
  matcher: ["/", "/waitlist"],
};
