"use client";

import { useEffect, useState, useTransition } from "react";
import { X, Link2, Check, Mail, MessageSquareOff, Loader2 } from "lucide-react";
import {
  createInvite,
  sendInviteEmailAction,
  getPendingInvites,
  type PendingInviteView,
} from "@/app/invite-actions";

type Row = PendingInviteView & { looksLikeEmail: boolean; looksLikePhone: boolean };

function classifyContact(contact: string | null): { looksLikeEmail: boolean; looksLikePhone: boolean } {
  if (!contact) return { looksLikeEmail: false, looksLikePhone: false };
  if (contact.includes("@")) return { looksLikeEmail: true, looksLikePhone: false };
  return { looksLikeEmail: false, looksLikePhone: /^[+\d][\d\s().-]{5,}$/.test(contact) };
}

// Generating a link must always work independent of Resend/SMS/any
// delivery rail — see createInviteOnly (src/lib/invite.ts), which never
// sends anything itself. Email/SMS are optional delivery channels layered
// on top of an invite that already exists.
export function InviteTravellersPanel({
  tripId,
  isOrganiser,
  onClose,
}: {
  tripId: string;
  isOrganiser: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loadingList, setLoadingList] = useState(isOrganiser);
  const [isCreating, startCreating] = useTransition();
  const [emailState, setEmailState] = useState<Record<string, "sending" | "sent" | "failed">>({});
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOrganiser) return;
    getPendingInvites(tripId)
      .then((list) => setRows(list.map((i) => ({ ...i, ...classifyContact(i.contact) }))))
      .finally(() => setLoadingList(false));
  }, [tripId, isOrganiser]);

  function inviteUrl(token: string) {
    return `${window.location.origin}/invite/${token}`;
  }

  function generate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startCreating(async () => {
      const result = await createInvite(tripId, name, contact);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRows((r) => [
        {
          id: result.inviteId,
          token: result.token,
          inviteeName: name.trim() || "Traveller",
          contact: contact.trim() || null,
          emailSent: false,
          looksLikeEmail: result.looksLikeEmail,
          looksLikePhone: result.looksLikePhone,
        },
        ...r,
      ]);
      setName("");
      setContact("");
    });
  }

  async function copyLink(token: string, id: string) {
    await navigator.clipboard.writeText(inviteUrl(token));
    setCopiedId(id);
    setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 2000);
  }

  function sendEmail(id: string) {
    setEmailState((s) => ({ ...s, [id]: "sending" }));
    startCreating(async () => {
      const result = await sendInviteEmailAction(tripId, id);
      if (result.ok) {
        setEmailState((s) => ({ ...s, [id]: "sent" }));
        setRows((r) => r.map((row) => (row.id === id ? { ...row, emailSent: true } : row)));
      } else {
        setEmailState((s) => ({ ...s, [id]: "failed" }));
        setError(result.error);
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-t-2xl bg-surface p-5 sm:rounded-2xl"
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
            <form onSubmit={generate} className="mt-4 flex flex-col gap-2.5">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Name (optional)</p>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Riya"
                  disabled={isCreating}
                  className="mt-1 w-full rounded-xl border border-border bg-page px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none disabled:opacity-60"
                />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Email or phone number</p>
                <input
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="friend@email.com or +91 98765 43210"
                  disabled={isCreating}
                  className="mt-1 w-full rounded-xl border border-border bg-page px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none disabled:opacity-60"
                />
              </div>
              <button
                type="submit"
                disabled={isCreating}
                className="mt-1 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCreating ? <Loader2 className="size-4 animate-spin" /> : "Generate invite"}
              </button>
            </form>

            {error && <p className="mt-2 text-xs text-danger">{error}</p>}

            <div className="mt-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Pending invites
              </p>

              {loadingList ? (
                <p className="mt-2 text-xs text-muted-foreground">Loading…</p>
              ) : rows.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">No invites yet — generate one above.</p>
              ) : (
                <div className="mt-2 flex flex-col gap-2">
                  {rows.map((row) => {
                    const status =
                      emailState[row.id] === "failed"
                        ? "Email couldn't be sent — copy the link instead."
                        : row.emailSent
                          ? "Invite sent"
                          : "Link created";
                    return (
                      <div key={row.id} className="rounded-xl border border-border px-3.5 py-2.5">
                        <p className="text-sm font-medium text-foreground">{row.inviteeName}</p>
                        {row.contact && (
                          <p className="mt-0.5 text-xs text-muted-foreground">{row.contact}</p>
                        )}
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{inviteUrl(row.token)}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">{status}</p>

                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => copyLink(row.token, row.id)}
                            className="flex cursor-pointer items-center gap-1 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-accent hover:text-accent"
                          >
                            {copiedId === row.id ? <Check className="size-3" /> : <Link2 className="size-3" />}
                            {copiedId === row.id ? "Copied" : "Copy link"}
                          </button>

                          {row.looksLikeEmail && (
                            <button
                              type="button"
                              onClick={() => sendEmail(row.id)}
                              disabled={emailState[row.id] === "sending"}
                              className="flex cursor-pointer items-center gap-1 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {emailState[row.id] === "sending" ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <Mail className="size-3" />
                              )}
                              {emailState[row.id] === "sending" ? "Sending…" : row.emailSent ? "Resend" : "Send by email"}
                            </button>
                          )}

                          {row.looksLikePhone && (
                            <button
                              type="button"
                              disabled
                              title="SMS isn't configured for this deployment yet"
                              className="flex cursor-not-allowed items-center gap-1 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground opacity-50"
                            >
                              <MessageSquareOff className="size-3" /> Send by SMS
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
