"use client";

import { useState, useTransition } from "react";
import { MessageSquareText } from "lucide-react";
import { submitFeedbackAction } from "@/app/analytics-actions";

// One-tap rating plus an optional note. It goes to the Feedback table that /admin/insights reads; it is not
// forwarded to anyone else automatically.
export function FeedbackForm({ tripId }: { tripId: string }) {
  const [rating, setRating] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function send() {
    setError(null);
    start(async () => {
      const r = await submitFeedbackAction({ tripId, page: "more", rating, message });
      if (r.ok) setDone(true);
      else setError("Pick a rating or write a note first.");
    });
  }

  return (
    <section className="rounded-[18px] border border-border bg-surface px-4 py-4" data-feedback-form>
      <p className="eyebrow flex items-center gap-1.5"><MessageSquareText className="size-3.5" /> Feedback</p>
      {done ? (
        <p className="mt-2 text-[14.5px]">Thanks. That&apos;s saved for the team.</p>
      ) : (
        <>
          <p className="mt-2 text-[14.5px] leading-snug">How useful was Clockwise on this trip?</p>
          <div className="mt-2 flex gap-2" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                onClick={() => setRating(n)}
                className={`flex size-11 items-center justify-center rounded-full border text-[14px] font-semibold ${rating === n ? "border-transparent bg-accent text-accent-foreground" : "border-border"}`}
              >
                {n}
              </button>
            ))}
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="What was confusing, or what would you change? (optional)"
            className="mt-3 w-full rounded-xl border border-border bg-surface px-3 py-2 text-[14px]"
          />
          {error && <p className="mt-1 text-[11.5px] text-danger">{error}</p>}
          <button type="button" disabled={pending} onClick={send} className="btn btn-primary mt-3">{pending ? "Sending…" : "Send feedback"}</button>
        </>
      )}
    </section>
  );
}
