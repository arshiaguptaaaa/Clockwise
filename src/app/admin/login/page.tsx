"use client";

import { useState, useTransition } from "react";
import { ClockwiseWordmark } from "@/components/ClockwiseWordmark";
import { adminLogin } from "@/app/admin/admin-actions";

export default function AdminLoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await adminLogin(formData);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-page px-6 py-16">
      <div className="w-full max-w-sm text-center">
        <ClockwiseWordmark className="justify-center" />
        <p className="mt-6 text-lg font-medium text-foreground">Admin</p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-2">
          <input
            type="password"
            name="password"
            required
            placeholder="Password"
            autoFocus
            className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-center text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            disabled={isPending}
            className="flex w-full cursor-pointer items-center justify-center rounded-xl bg-accent px-4 py-3 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "Checking…" : "Sign in"}
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </div>
    </main>
  );
}
