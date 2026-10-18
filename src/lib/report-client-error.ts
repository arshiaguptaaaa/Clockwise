// Browser-side: send one error to /api/client-error. Fire-and-forget; a failure here is ignored.
export function reportClientError(e: { message: string; digest?: string; stack?: string }) {
  try {
    void fetch("/api/client-error", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: e.message, digest: e.digest, stack: e.stack, path: typeof location !== "undefined" ? location.pathname : undefined }),
    }).catch(() => undefined);
  } catch {
    // ignore
  }
}
