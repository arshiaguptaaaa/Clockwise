"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, User, ClipboardList, MoreHorizontal } from "lucide-react";

const TABS = [
  { segment: "room", label: "Trip Room", icon: Home },
  { segment: "agent", label: "My Agent", icon: User },
  { segment: "plan", label: "Plan", icon: ClipboardList },
  { segment: "more", label: "More", icon: MoreHorizontal },
] as const;

export function BottomNav({ tripId }: { tripId: string }) {
  const pathname = usePathname();

  return (
    <nav className="sticky bottom-0 z-20 mx-auto flex w-full shrink-0 max-w-lg items-stretch border-t border-border bg-surface/95 backdrop-blur lg:max-w-2xl lg:border-x">
      <div className="flex w-full items-stretch">
        {TABS.map((tab) => {
          const href = `/trips/${tripId}/${tab.segment}`;
          const active = pathname.startsWith(href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.segment}
              href={href}
              className={`flex flex-1 cursor-pointer flex-col items-center gap-1 px-2 py-2.5 text-center transition-colors ${
                active
                  ? "text-accent"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="size-5" strokeWidth={active ? 2.25 : 1.75} />
              <span className="text-[11px] font-medium">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
