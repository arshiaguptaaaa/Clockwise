import type { Instrumentation } from "next";

// Server-side errors (render, route handler, server action) go to ErrorLog so /admin/insights can show an error rate.
// Node runtime only: the Prisma client is not available at the edge.
export const onRequestError: Instrumentation.onRequestError = async (err, request) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logError } = await import("@/lib/error-log");
  const e = err as { message?: string; digest?: string; stack?: string };
  await logError({ source: "SERVER", message: e?.message ?? String(err), digest: e?.digest, stack: e?.stack, path: request.path });
};
