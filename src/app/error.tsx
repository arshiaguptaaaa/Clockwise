"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/report-client-error";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError({ message: error.message, digest: error.digest, stack: error.stack });
  }, [error]);
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-sm flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="font-display text-[24px] leading-tight">Something went wrong on our side.</p>
      <p className="text-[13.5px] text-muted-foreground">Your trip is safe. Try again, and if it keeps happening, tell us with the feedback button.</p>
      <button type="button" onClick={reset} className="btn btn-primary">Try again</button>
    </div>
  );
}
