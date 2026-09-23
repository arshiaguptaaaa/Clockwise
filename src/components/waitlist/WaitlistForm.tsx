"use client";

import { useEffect, useState, useTransition } from "react";
import { ClockwiseWordmark } from "@/components/ClockwiseWordmark";
import { joinWaitlist, type JoinWaitlistResult } from "@/app/waitlist-actions";

export function WaitlistForm() {
  const [result, setResult] = useState<JoinWaitlistResult | null>(null);
  const [unexpectedError, setUnexpectedError] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Captures UTM/source attribution for people who land here directly
  // (a shared /waitlist?utm_source=... link) rather than via the
  // homepage — cookies can only be written from a Route Handler/Server
  // Action, not during this page's Server Component render, so this goes
  // through the same /api/track endpoint the homepage CTAs use.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("event", "waitlist_page_view");
    fetch(`/api/track?${params.toString()}`, {
      method: "POST",
      keepalive: true,
    }).catch(() => {});
  }, []);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setUnexpectedError(false);
    startTransition(async () => {
      // Previously uncaught: if joinWaitlist() threw for any reason
      // (e.g. a failure in code that runs after the DB write but before
      // the email sends), the rejection was unhandled inside this
      // transition — no visible error, the button just silently stops
      // "loading" with no state change. Now surfaced explicitly so a
      // real failure is never mistaken for a form that did nothing.
      try {
        const res = await joinWaitlist(formData);
        setResult(res);
      } catch {
        setUnexpectedError(true);
      }
    });
  }

  const isDone = result?.status === "joined" || result?.status === "already_on_list";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-page px-6 py-16">
      <div className="w-full max-w-sm text-center">
        <ClockwiseWordmark className="justify-center" />

        {isDone ? (
          <div className="mt-10">
            <p className="text-lg font-medium text-foreground">
              {result?.status === "joined" ? "You're on the list." : "You're already on the list."}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              We&apos;ll let you know when Clockwise opens for early access.
            </p>
          </div>
        ) : (
          <>
            <p className="mt-6 text-lg font-medium text-foreground">Get early access to Clockwise.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Planning a group trip shouldn&apos;t require one friend to become the operations manager.
              Join the early-access list and we&apos;ll let you know when Clockwise opens up.
            </p>

            <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-2">
              <input
                type="email"
                name="email"
                required
                placeholder="Email address"
                autoFocus
                className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-center text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
              />
              <button
                type="submit"
                disabled={isPending}
                className="flex w-full cursor-pointer items-center justify-center rounded-xl bg-accent px-4 py-3 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPending ? "Joining…" : "Join waitlist"}
              </button>
            </form>
            {result?.status === "invalid_email" && (
              <p className="mt-2 text-sm text-danger">Enter a valid email address.</p>
            )}
            {unexpectedError && (
              <p className="mt-2 text-sm text-danger">Something went wrong — please try again.</p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
