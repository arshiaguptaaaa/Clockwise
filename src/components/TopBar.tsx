"use client";

import { useRef, useState } from "react";
import { MoreVertical, UserPlus } from "lucide-react";
import { switchTraveller } from "@/app/actions";
import { NotificationBell } from "@/components/NotificationBell";
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
    <header className="sticky top-0 z-20 mx-auto flex w-full shrink-0 max-w-lg items-center justify-between bg-surface/95 px-5 pb-1.5 pt-[calc(0.5rem+env(safe-area-inset-top))] backdrop-blur lg:max-w-2xl lg:border-x lg:border-border">
      <div className="flex w-full items-center justify-between">
        <p className="min-w-0 truncate text-[15px] font-medium tracking-[-0.005em] text-foreground">
          <span className="cw-mark mr-1.5">◷</span>
          {title}
          <span className="sr-only"> · {subtitle}</span>
        </p>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="Invite travellers"
            onClick={() => setInviteOpen(true)}
            className="flex size-11 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
          >
            <UserPlus className="size-[18px]" strokeWidth={1.75} />
          </button>

          {inviteOpen && (
            <InviteTravellersPanel
              tripId={tripId}
              isOrganiser={isOrganiser}
              onClose={() => setInviteOpen(false)}
            />
          )}

        <NotificationBell tripId={tripId} />

        <div ref={containerRef} className="relative">
          <button
            type="button"
            aria-label="Trip menu"
            onClick={() => setOpen((v) => !v)}
            className="flex size-11 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
          >
            <MoreVertical className="size-[18px]" strokeWidth={1.75} />
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
