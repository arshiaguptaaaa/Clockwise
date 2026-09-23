"use client";

import { useState, useTransition } from "react";
import { X, Link2, Check, Share2, Loader2 } from "lucide-react";
import { createInvite } from "@/app/invite-actions";

type CreatedInvite = { token: string; label: string };

// Copy Link must work even when Resend/email is unavailable — email is an
// optional delivery rail on top of the same Invite row, never a
// requirement to obtain a shareable URL (see createAndEmailInvite:
// email failure never removes the invite).
export function InviteTravellersPanel({
  tripId,
  isOrganiser,
  onClose,
}: {
  tripId: string;
  isOrganiser: boolean;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInvite[]>([]);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  function inviteUrl(token: string) {
    return `${window.location.origin}/invite/${token}`;
  }

  function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      const result = await createInvite(tripId, trimmed, trimmed);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCreated((c) => [{ token: result.token, label: trimmed }, ...c]);
      setEmail("");
    });
  }

  function generateLink() {
    setError(null);
    startTransition(async () => {
      const result = await createInvite(tripId, "Traveller", "");
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCreated((c) => [{ token: result.token, label: "Shareable link" }, ...c]);
    });
  }

  async function copyLink(token: string) {
    await navigator.clipboard.writeText(inviteUrl(token));
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  }

  async function shareLink(token: string) {
    const url = inviteUrl(token);
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ url, title: "Join our trip on Clockwise" });
      } catch {
        // User cancelled the native share sheet — not an error.
      }
    } else {
      await copyLink(token);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-t-2xl bg-surface p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-base font-medium text-foreground">Invite your group</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-full p-1 text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        {!isOrganiser ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Only the trip organiser can invite new travellers.
          </p>
        ) : (
          <>
            <form onSubmit={submitEmail} className="mt-4">
              <p className="text-xs font-medium text-muted-foreground">Email</p>
              <div className="mt-1.5 flex gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="friend@email.com"
                  disabled={isPending}
                  className="flex-1 rounded-xl border border-border bg-page px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={isPending || !email.trim()}
                  className="flex shrink-0 cursor-pointer items-center justify-center rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isPending ? <Loader2 className="size-4 animate-spin" /> : "Send invite"}
                </button>
              </div>
            </form>

            <div className="mt-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <p className="text-xs text-muted-foreground">or share a link</p>
              <div className="h-px flex-1 bg-border" />
            </div>

            <button
              type="button"
              onClick={generateLink}
              disabled={isPending}
              className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Link2 className="size-4" /> Generate invite link
            </button>

            {error && <p className="mt-2 text-xs text-danger">{error}</p>}

            {created.length > 0 && (
              <div className="mt-4 flex flex-col gap-2">
                {created.map((invite) => (
                  <div key={invite.token} className="rounded-xl border border-border px-3.5 py-2.5">
                    <p className="text-xs text-muted-foreground">{invite.label}</p>
                    <p className="mt-0.5 truncate text-xs text-foreground">{inviteUrl(invite.token)}</p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => copyLink(invite.token)}
                        className="flex cursor-pointer items-center gap-1 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-accent hover:text-accent"
                      >
                        {copiedToken === invite.token ? <Check className="size-3" /> : <Link2 className="size-3" />}
                        {copiedToken === invite.token ? "Copied" : "Copy link"}
                      </button>
                      <button
                        type="button"
                        onClick={() => shareLink(invite.token)}
                        className="flex cursor-pointer items-center gap-1 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-accent hover:text-accent"
                      >
                        <Share2 className="size-3" /> Share
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
