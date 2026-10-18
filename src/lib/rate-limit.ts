import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import type { Bucket } from "@/lib/rate-limit-core";

// Counters in Postgres, not in memory: Vercel runs many instances and they come and go, so only a shared store gives
// one consistent count. The increment is a single atomic INSERT ... ON CONFLICT, so concurrent requests cannot lose counts.
export async function hitBucket(key: string, windowMs: number, now: Date = new Date()): Promise<{ count: number; windowStart: Date }> {
  const cutoff = new Date(now.getTime() - windowMs);
  // The columns are `timestamp` (no zone) and Prisma stores UTC wall-clock time in them. A raw query binds a Date as
  // timestamptz, which Postgres would convert using the SESSION time zone, so every value is pinned to UTC explicitly.
  const rows = await prisma.$queryRaw<{ count: number; windowStart: Date }[]>`
    INSERT INTO "RateLimitBucket" ("key", "count", "windowStart", "updatedAt")
    VALUES (${key}, 1, (${now}::timestamptz AT TIME ZONE 'UTC'), (${now}::timestamptz AT TIME ZONE 'UTC'))
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."windowStart" < (${cutoff}::timestamptz AT TIME ZONE 'UTC') THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimitBucket"."windowStart" < (${cutoff}::timestamptz AT TIME ZONE 'UTC') THEN (${now}::timestamptz AT TIME ZONE 'UTC') ELSE "RateLimitBucket"."windowStart" END,
      "updatedAt" = (${now}::timestamptz AT TIME ZONE 'UTC')
    RETURNING "count", "windowStart"`;
  return { count: Number(rows[0].count), windowStart: rows[0].windowStart };
}

export async function peekBucket(key: string): Promise<Bucket> {
  const r = await prisma.rateLimitBucket.findUnique({ where: { key }, select: { count: true, windowStart: true } });
  return r ?? null;
}

export async function resetBucket(key: string): Promise<void> {
  await prisma.rateLimitBucket.deleteMany({ where: { key } });
}

// Client addresses are stored only as a salted hash, never raw.
export function clientKey(prefix: string, ip: string, salt: string): string {
  return `${prefix}:${createHash("sha256").update(`${salt}|${ip}`).digest("hex").slice(0, 32)}`;
}
