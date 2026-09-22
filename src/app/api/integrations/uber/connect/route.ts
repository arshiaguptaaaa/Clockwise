import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { buildAuthorizeUrl, isUberConfigured } from "@/lib/uber/oauth";

const STATE_COOKIE = "uber_oauth_state";

// Starts the rider-authorization OAuth flow. The connecting Clockwise user
// becomes the "requester/payer" for their trip's transport plans (see
// approved architecture — one authorised organiser per multi-car plan).
// Enforced server-side, not just hidden in the UI: only the trip's
// organiser (Trip.createdBy) may ever start this flow for a given trip.
export async function GET(request: NextRequest) {
  const tripId = request.nextUrl.searchParams.get("tripId");
  if (!tripId) {
    return NextResponse.json({ error: "Missing tripId" }, { status: 400 });
  }

  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.redirect(new URL(`/trips/${tripId}/agent`, request.url));
  }

  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip || trip.createdBy !== userId) {
    return NextResponse.redirect(
      new URL(`/trips/${tripId}/agent?uber=not_organiser`, request.url)
    );
  }

  if (!isUberConfigured()) {
    return NextResponse.redirect(
      new URL(`/trips/${tripId}/agent?uber=not_configured`, request.url)
    );
  }

  const state = randomBytes(16).toString("hex");
  const response = NextResponse.redirect(buildAuthorizeUrl(state));
  response.cookies.set(STATE_COOKIE, JSON.stringify({ state, tripId, userId }), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });
  return response;
}
