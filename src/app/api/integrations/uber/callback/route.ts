import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exchangeCodeForToken } from "@/lib/uber/oauth";
import { getProfile } from "@/lib/uber/client";
import { encryptToken } from "@/lib/uber/crypto";

const STATE_COOKIE = "uber_oauth_state";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const returnedState = request.nextUrl.searchParams.get("state");
  const oauthError = request.nextUrl.searchParams.get("error");

  const stateCookie = request.cookies.get(STATE_COOKIE)?.value;
  let saved: { state: string; tripId: string; userId: string } | null = null;
  try {
    saved = stateCookie ? JSON.parse(stateCookie) : null;
  } catch {
    saved = null;
  }

  const fallbackRedirect = new URL("/", request.url);
  if (!saved) {
    return NextResponse.redirect(fallbackRedirect);
  }

  const redirectTo = new URL(`/trips/${saved.tripId}/agent`, request.url);
  const response = NextResponse.redirect(redirectTo);
  response.cookies.delete(STATE_COOKIE);

  if (oauthError) {
    redirectTo.searchParams.set("uber", "denied");
    return NextResponse.redirect(redirectTo, { headers: response.headers });
  }

  if (!code || !returnedState || returnedState !== saved.state) {
    redirectTo.searchParams.set("uber", "error");
    return NextResponse.redirect(redirectTo, { headers: response.headers });
  }

  try {
    const token = await exchangeCodeForToken(code);
    const profile = await getProfile(token.access_token);

    await prisma.mobilityConnection.upsert({
      where: { userId_provider: { userId: saved.userId, provider: "uber" } },
      create: {
        userId: saved.userId,
        provider: "uber",
        providerUserId: profile.uuid,
        providerName: [profile.first_name, profile.last_name].filter(Boolean).join(" "),
        providerEmail: profile.email,
        scope: token.scope,
        encryptedAccessToken: encryptToken(token.access_token),
        encryptedRefreshToken: token.refresh_token ? encryptToken(token.refresh_token) : null,
        expiresAt: new Date(Date.now() + token.expires_in * 1000),
      },
      update: {
        providerUserId: profile.uuid,
        providerName: [profile.first_name, profile.last_name].filter(Boolean).join(" "),
        providerEmail: profile.email,
        scope: token.scope,
        encryptedAccessToken: encryptToken(token.access_token),
        encryptedRefreshToken: token.refresh_token ? encryptToken(token.refresh_token) : null,
        expiresAt: new Date(Date.now() + token.expires_in * 1000),
        revokedAt: null,
      },
    });

    redirectTo.searchParams.set("uber", "connected");
    return NextResponse.redirect(redirectTo, { headers: response.headers });
  } catch (err) {
    // Real failure, surfaced honestly — never a silent "connected" state
    // when the token exchange or profile fetch actually failed.
    console.error("Uber OAuth callback failed:", err);
    redirectTo.searchParams.set("uber", "error");
    return NextResponse.redirect(redirectTo, { headers: response.headers });
  }
}
