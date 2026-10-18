import { prisma } from "@/lib/prisma";

// Writes one ErrorLog row. Never throws: error logging must not become a second error.
export async function logError(input: { source: "CLIENT" | "SERVER"; message: string; digest?: string | null; stack?: string | null; path?: string | null; userId?: string | null }): Promise<void> {
  try {
    await prisma.errorLog.create({
      data: {
        source: input.source,
        message: input.message.slice(0, 500),
        digest: input.digest?.slice(0, 100) ?? null,
        stack: input.stack?.slice(0, 2000) ?? null,
        path: input.path?.slice(0, 300) ?? null,
        userId: input.userId ?? null,
      },
    });
  } catch (err) {
    console.error("logError failed:", err);
  }
}
