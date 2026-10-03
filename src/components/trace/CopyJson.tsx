"use client";

import { useState } from "react";

export function CopyJson({ value, label = "Copy JSON" }: { value: unknown; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="cursor-pointer rounded-full border border-border px-3 py-1 text-[11px] font-semibold"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          // clipboard unavailable
        }
      }}
    >
      {done ? "Copied ✓" : label}
    </button>
  );
}
