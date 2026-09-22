// Resolves a Clockwise user's stored Uber connection into a live, valid
// access token — refreshing and re-persisting it if it's near expiry. This
// is the only place a decrypted Uber access token exists outside a single
// request's memory; callers (server actions, provider) receive the string
// and use it immediately, never store it themselves.
import { prisma } from "@/lib/prisma";
import { encryptToken, decryptToken } from "./crypto";
import { refreshAccessToken, isUberConfigured } from "./oauth";

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export async function getUberConnection(userId: string) {
  return prisma.mobilityConnection.findUnique({
    where: { userId_provider: { userId, provider: "uber" } },
  });
}

// Returns null (never throws for "not connected") so callers can render an
// honest "connect Uber first" state instead of a crash.
export async function getValidUberAccessToken(userId: string): Promise<string | null> {
  const connection = await getUberConnection(userId);
  if (!connection || connection.revokedAt) return null;

  const expiresInMs = connection.expiresAt.getTime() - Date.now();
  if (expiresInMs > REFRESH_MARGIN_MS) {
    return decryptToken(connection.encryptedAccessToken);
  }

  if (!connection.encryptedRefreshToken) {
    // Expired with no refresh token — the connection is dead; the caller
    // should prompt reconnection rather than silently proceeding.
    return null;
  }

  const refreshed = await refreshAccessToken(decryptToken(connection.encryptedRefreshToken));
  await prisma.mobilityConnection.update({
    where: { id: connection.id },
    data: {
      encryptedAccessToken: encryptToken(refreshed.access_token),
      encryptedRefreshToken: refreshed.refresh_token
        ? encryptToken(refreshed.refresh_token)
        : connection.encryptedRefreshToken,
      expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
      scope: refreshed.scope,
    },
  });

  return refreshed.access_token;
}

export type UberConnectionStatus = "NOT_CONFIGURED" | "NOT_CONNECTED" | "CONNECTED" | "REAUTH_REQUIRED";

// A cheap, read-only status for display (Connected Services, etc.) —
// deliberately does NOT call Uber or attempt a refresh on every render
// (getValidUberAccessToken does that, but has side effects: a real refresh
// API call and a DB write, wrong for something rendered on every page
// load). Instead this reasons from what's already stored: expired with no
// refresh token on file is a dead end with no live call needed to know
// that — the same condition getValidUberAccessToken treats as
// unrecoverable. A refresh token that's expired or been revoked *on
// Uber's side* can only be discovered by actually trying to use it (e.g.
// when a real ride is requested) — this status reflects our own stored
// expectation, not a live Uber-side check.
export async function getUberConnectionStatus(
  userId: string
): Promise<{ status: UberConnectionStatus; connection: Awaited<ReturnType<typeof getUberConnection>> }> {
  if (!isUberConfigured()) {
    return { status: "NOT_CONFIGURED", connection: null };
  }

  const connection = await getUberConnection(userId);
  if (!connection || connection.revokedAt) {
    return { status: "NOT_CONNECTED", connection: null };
  }

  const expired = connection.expiresAt.getTime() <= Date.now();
  if (expired && !connection.encryptedRefreshToken) {
    return { status: "REAUTH_REQUIRED", connection };
  }

  return { status: "CONNECTED", connection };
}

export async function revokeUberConnection(userId: string) {
  await prisma.mobilityConnection.updateMany({
    where: { userId, provider: "uber", revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
