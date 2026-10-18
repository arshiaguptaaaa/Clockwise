"use client";

import { useActionState } from "react";
import { ClockwiseWordmark } from "@/components/ClockwiseWordmark";
import { adminLogin } from "@/app/admin/admin-actions";

export default function AdminLoginPage() {
  // A real <form action={...}> posts to the server action even before JavaScript has loaded, so the password can never
  // fall back to a GET and end up in the URL, the browser history or request logs.
  const [state, formAction, isPending] = useActionState(adminLogin, null);
  const error = state?.error ?? null;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-page px-6 py-16">
      <div className="w-full max-w-sm text-center">
        <ClockwiseWordmark className="justify-center" />
        <p className="mt-6 text-lg font-medium text-foreground">Admin</p>

        <form action={formAction} className="mt-6 flex flex-col gap-2">
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
