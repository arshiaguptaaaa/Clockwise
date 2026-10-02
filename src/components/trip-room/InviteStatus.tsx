"use client";

import { useState, useTransition } from "react";
import { Loader2, Check } from "lucide-react";
import { sendInviteEmailAction } from "@/app/invite-actions";

export type InviteJobView = { eventType: string; status: string; scheduledFor: string };

function when(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · ${d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true })}`;
}

// What the organiser sees for each person who hasn't joined yet — only real,
// persisted state: the provider-accepted send time, the follow-up jobs'
// statuses, and a resend that is rate-limited on the server.
export function InviteStatus({
  tripId,
  inviteId,
  inviteeName,
  hasEmail,
  lastSentAt,
  sendCount,
  jobs,
  canResend,
}: {
  tripId: string;
  inviteId: string;
  inviteeName: string;
  hasEmail: boolean;
  lastSentAt: string | null;
  sendCount: number;
  jobs: InviteJobView[];
  canResend: boolean;
}) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reminder = jobs.find((j) => j.eventType === "INVITE_REMINDER_EMAIL");
  const call = jobs.find((j) => j.eventType === "INVITE_ESCALATION_CALL");

  function resend() {
    setNote(null);
    setError(null);
    start(async () => {
      const r = await sendInviteEmailAction(tripId, inviteId);
      if (r.ok) setNote("Invitation resent ✓");
      else setError(r.error);
    });
  }

  return (
    <div className="mt-1.5 text-xs">
      {!hasEmail ? (
        <p className="text-muted-foreground">No email yet — share the link instead.</p>
      ) : lastSentAt ? (
        <p className="text-foreground">
          Invitation {sendCount > 1 ? "resent" : "sent"} <span className="text-accent">✓</span>
          <span className="text-muted-foreground"> · {when(lastSentAt)}</span>
        </p>
      ) : (
        <p className="text-muted-foreground">Invitation not sent yet.</p>
      )}
      <p className="mt-0.5 text-muted-foreground">
        ○ Waiting for {inviteeName}
        {reminder?.status === "SCHEDULED" && ` · reminder ${when(reminder.scheduledFor)}`}
        {reminder?.status === "SENT" && " · reminder email sent"}
        {reminder?.status === "FAILED" && " · reminder failed"}
        {call?.status === "SENT" && " · called ☎"}
        {call?.status === "FAILED" && " · call not placed"}
      </p>
      {canResend && hasEmail && (
        <div className="mt-1.5 flex items-center gap-2">
          <button
            type="button"
            onClick={resend}
            disabled={pending}
            className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-border px-2.5 py-1 font-medium text-muted-foreground transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? <Loader2 className="size-3 animate-spin" /> : null}
            {lastSentAt ? "Resend invitation" : "Send invitation"}
          </button>
          {note && (
            <span className="inline-flex items-center gap-1 text-accent">
              <Check className="size-3" /> {note}
            </span>
          )}
          {error && <span className="text-danger">{error}</span>}
        </div>
      )}
    </div>
  );
}
