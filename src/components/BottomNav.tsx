"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessagesSquare, CalendarRange, Compass, User } from "lucide-react";

// Four places, no more. Everything else lives inside them: Journey, Ready?, Saved and Budget are under YOU;
// Files is in the Trip Room; the developer views are for organisers only.
const TABS = [
  { key: "trip", label: "Trip", icon: MessagesSquare, href: (t: string) => `/trips/${t}/room`, match: (p: string, t: string) => p.startsWith(`/trips/${t}/room`) },
  { key: "plan", label: "Plan", icon: CalendarRange, href: (t: string) => `/trips/${t}/plan`, match: (p: string, t: string) => p.startsWith(`/trips/${t}/plan`) },
  { key: "around", label: "Around", icon: Compass, href: (t: string) => `/trips/${t}/agent/around`, match: (p: string, t: string) => p.startsWith(`/trips/${t}/agent/around`) },
  { key: "you", label: "You", icon: User, href: (t: string) => `/trips/${t}/agent`, match: (p: string, t: string) => (p.startsWith(`/trips/${t}/agent`) && !p.startsWith(`/trips/${t}/agent/around`)) || p.startsWith(`/trips/${t}/budget`) },
] as const;

export function BottomNav({ tripId, waiting = 0 }: { tripId: string; waiting?: number }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Trip" className="sticky bottom-0 z-20 mx-auto flex w-full shrink-0 max-w-lg items-stretch border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:max-w-2xl lg:border-x">
      <div className="flex w-full items-stretch">
        {TABS.map((tab) => {
          const active = tab.match(pathname, tripId);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.key}
              href={tab.href(tripId)}
              aria-current={active ? "page" : undefined}
              className={`relative flex min-h-[54px] flex-1 cursor-pointer flex-col items-center justify-center gap-1 px-2 pb-1.5 pt-2 text-center transition-colors duration-150 ${active ? "text-accent" : "text-muted-foreground hover:text-foreground"}`}
            >
              <span className={`absolute inset-x-6 top-0 h-[2px] rounded-full transition-colors duration-200 ${active ? "bg-accent" : "bg-transparent"}`} />
              <span className="relative">
                <Icon className="size-[22px]" strokeWidth={active ? 2 : 1.6} />
                {tab.key === "trip" && waiting > 0 && (
                  <span aria-label={`${waiting} decision${waiting === 1 ? "" : "s"} waiting`} className="pop absolute -right-2.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-danger text-[9px] font-bold text-white">
                    {waiting}
                  </span>
                )}
              </span>
              <span className={`text-[10px] uppercase tracking-[0.16em] ${active ? "font-semibold" : "font-medium"}`}>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
