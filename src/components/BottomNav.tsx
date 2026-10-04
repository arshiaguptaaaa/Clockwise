"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, User, ClipboardList, Wallet, MoreHorizontal } from "lucide-react";

const TABS = [
  { segment: "room", label: "Trip Room", icon: Home },
  { segment: "agent", label: "My Agent", icon: User },
  { segment: "plan", label: "Plan", icon: ClipboardList },
  { segment: "budget", label: "Budget", icon: Wallet },
  { segment: "more", label: "More", icon: MoreHorizontal },
] as const;

export function BottomNav({ tripId }: { tripId: string }) {
  const pathname = usePathname();

  return (
    <nav className="sticky bottom-0 z-20 mx-auto flex w-full shrink-0 max-w-lg items-stretch border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:max-w-2xl lg:border-x">
      <div className="flex w-full items-stretch">
        {TABS.map((tab) => {
          const href = `/trips/${tripId}/${tab.segment}`;
          const active = pathname.startsWith(href);
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
