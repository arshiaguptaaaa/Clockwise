"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { ClockwiseWordmark } from "@/components/ClockwiseWordmark";

function extractToken(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const marker = "/invite/";
  const idx = trimmed.indexOf(marker);
  const token = idx >= 0 ? trimmed.slice(idx + marker.length) : trimmed;
  // Tokens are always uppercase-alphanumeric — normalize here too (not
  // just at the destination page) so a pasted lowercase link/code works
  // immediately rather than depending on the next page to fix it.
  return token.toUpperCase().replace(/[^A-Z0-9]/g, "") || null;
}

export default function JoinByCodePage() {
  const router = useRouter();
  const [value, setValue] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const token = extractToken(value);
    if (token) {
      router.push(`/invite/${token}`);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-page px-6 py-16">
      <div className="w-full max-w-sm text-center">
        <ClockwiseWordmark className="justify-center" />
        <p className="mt-3 text-lg font-medium text-foreground">
          Got an invite?
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste the link or code someone sent you.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-2">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="clockwise.../invite/X8K2P9"
            autoFocus
            className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-center text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            disabled={!value.trim()}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            Continue <ArrowRight className="size-4" />
          </button>
        </form>
      </div>
    </main>
  );
}
