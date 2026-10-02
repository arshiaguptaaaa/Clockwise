import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Serverless runs many short-lived instances, each opening its own pool. With
// Prisma's default (2 x CPUs + 1) a burst of instances can exceed the database's
// connection limit, and every DB-backed page then fails together until idle
// connections time out (~2 minutes). Bound each instance's pool and make it
// wait, instead of failing, when it's briefly saturated. An explicit
// connection_limit / pool_timeout already in DATABASE_URL always wins. (Observed
// in production: "too many connections for role prisma_migration" — a direct
// Prisma Postgres connection with a small per-role limit. A pooled connection
// string is the proper fix; this keeps each instance to one connection until then.)
function tunedDatasourceUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (!url.searchParams.has("connection_limit")) url.searchParams.set("connection_limit", process.env.DB_CONNECTION_LIMIT ?? "1");
    if (!url.searchParams.has("pool_timeout")) url.searchParams.set("pool_timeout", "20");
    return url.toString();
  } catch {
    return raw;
  }
}

const datasourceUrl = tunedDatasourceUrl();

export const prisma = globalForPrisma.prisma ?? new PrismaClient(datasourceUrl ? { datasourceUrl } : undefined);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
