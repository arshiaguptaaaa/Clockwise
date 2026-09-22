import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const POLL_MS = 300;
const MAX_WAIT_MS = 30_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function conversationLockKey(tripId: string, channel: "GROUP" | "PRIVATE", recipientId?: string | null) {
  return `${tripId}:${channel}:${channel === "PRIVATE" ? recipientId : "group"}`;
}

// Waits for and acquires the lock (insert-to-acquire — the primary key's
// uniqueness is the actual mutex). If a previous holder crashed without
// releasing, a lock older than MAX_WAIT_MS is treated as stale and
// force-cleared rather than wedging the conversation forever.
async function acquireAgentLock(key: string): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      await prisma.agentLock.create({ data: { key } });
      return;
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") throw err;

      if (Date.now() - start > MAX_WAIT_MS) {
        const existing = await prisma.agentLock.findUnique({ where: { key } });
        if (existing && Date.now() - existing.lockedAt.getTime() > MAX_WAIT_MS) {
          await prisma.agentLock.deleteMany({ where: { key } });
          continue;
        }
        throw new Error("Timed out waiting for a previous Clockwise turn to finish.");
      }
      await sleep(POLL_MS);
    }
  }
}

async function releaseAgentLock(key: string): Promise<void> {
  await prisma.agentLock.deleteMany({ where: { key } });
}

// Runs `fn` with the named conversation's lock held — a second call for
// the SAME conversation waits here instead of running concurrently, then
// proceeds against fully up-to-date state once the first finishes.
export async function withAgentLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  await acquireAgentLock(key);
  try {
    return await fn();
  } finally {
    await releaseAgentLock(key);
  }
}
