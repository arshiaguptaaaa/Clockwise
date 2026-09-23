"use client";

import { useRef, useState } from "react";
import { MoreVertical, UserPlus } from "lucide-react";
import { switchTraveller } from "@/app/actions";
import { InviteTravellersPanel } from "@/components/trip-room/InviteTravellersPanel";

export function TopBar({
  title,
  subtitle,
  currentUserName,
  tripId,
  isOrganiser,
}: {
  title: string;
  subtitle: string;
  currentUserName: string;
  tripId: string;
  isOrganiser: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <header className="sticky top-0 z-20 mx-auto flex w-full shrink-0 max-w-lg items-start justify-between border-b border-border bg-surface/95 px-4 py-3 backdrop-blur lg:max-w-2xl lg:border-x">
      <div className="flex w-full items-start justify-between">
        <div>
          <p className="text-base font-semibold leading-tight text-foreground">
            {title}
          </p>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="Invite travellers"
            onClick={() => setInviteOpen(true)}
            className="flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-accent hover:text-accent"
          >
            <UserPlus className="size-3.5" /> Invite
          </button>

          {inviteOpen && (
            <InviteTravellersPanel
              tripId={tripId}
              isOrganiser={isOrganiser}
              onClose={() => setInviteOpen(false)}
            />
          )}

        <div ref={containerRef} className="relative">
          <button
            type="button"
            aria-label="Trip menu"
            onClick={() => setOpen((v) => !v)}
            className="cursor-pointer rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
          >
            <MoreVertical className="size-5" />
          </button>

          {open && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setOpen(false)}
              />
              <div className="absolute right-0 top-9 z-20 w-48 rounded-xl border border-border bg-surface p-1.5 shadow-lg">
                <p className="px-2.5 py-1.5 text-xs text-muted-foreground">
                  Viewing as {currentUserName}
                </p>
                <form action={switchTraveller}>
                  <button
                    type="submit"
                    className="w-full cursor-pointer rounded-lg px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface-muted"
                  >
                    Switch traveller
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
        </div>
      </div>
    </header>
  );
}
