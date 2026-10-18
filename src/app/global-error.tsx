"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/report-client-error";

// Last resort: renders outside the root layout, so it brings its own <html> and plain styles.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError({ message: error.message, digest: error.digest, stack: error.stack });
  }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "flex", minHeight: "100dvh", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24, background: "#f7f8f6", color: "#163a2c" }}>
        <div>
          <p style={{ fontSize: 22, marginBottom: 8 }}>Something went wrong on our side.</p>
          <p style={{ fontSize: 14, opacity: 0.7, marginBottom: 16 }}>Your trip is safe.</p>
          <button type="button" onClick={reset} style={{ background: "#163a2c", color: "#fff", border: 0, borderRadius: 999, padding: "10px 20px", fontSize: 14 }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
