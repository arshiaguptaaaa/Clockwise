"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessagesSquare, CalendarRange, User } from "lucide-react";

// Three places, no more: the group's room, the shared plan, and everything that is yours.
const TABS = [
  { segment: "room", also: [] as string[], label: "Trip", icon: MessagesSquare },
  { segment: "plan", also: [] as string[], label: "Plan", icon: CalendarRange },
  { segment: "agent", also: ["budget"], label: "My Clockwise", icon: User },
] as const;

export function BottomNav({ tripId }: { tripId: string }) {
  const pathname = usePathname();

  return (
    <nav className="sticky bottom-0 z-20 mx-auto flex w-full shrink-0 max-w-lg items-stretch border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:max-w-2xl lg:border-x">
      <div className="flex w-full items-stretch">
        {TABS.map((tab) => {
          const href = `/trips/${tripId}/${tab.segment}`;
          const active = [tab.segment, ...tab.also].some((seg) => pathname.startsWith(`/trips/${tripId}/${seg}`));
          const Icon = tab.icon;
          return (
            <Link
              key={tab.segment}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`relative flex flex-1 cursor-pointer flex-col items-center gap-0.5 px-2 pb-2 pt-2.5 text-center transition-colors ${active ? "text-accent" : "text-muted-foreground hover:text-foreground"}`}
            >
              <span className={`absolute inset-x-5 top-0 h-[2px] rounded-full transition-colors ${active ? "bg-accent" : "bg-transparent"}`} />
              <Icon className="size-[20px]" strokeWidth={active ? 2 : 1.6} />
              <span className={`text-[10.5px] tracking-wide ${active ? "font-semibold" : "font-medium"}`}>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
