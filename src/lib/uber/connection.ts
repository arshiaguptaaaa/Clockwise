// Resolves a Clockwise user's stored Uber connection into a live, valid
// access token — refreshing and re-persisting it if it's near expiry. This
// is the only place a decrypted Uber access token exists outside a single
// request's memory; callers (server actions, provider) receive the string
// and use it immediately, never store it themselves.
import { prisma } from "@/lib/prisma";
import { encryptToken, decryptToken } from "./crypto";
import { refreshAccessToken } from "./oauth";

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

export async function revokeUberConnection(userId: string) {
  await prisma.mobilityConnection.updateMany({
    where: { userId, provider: "uber", revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
