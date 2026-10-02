"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SubTabs({
  tabs,
}: {
  tabs: { href: string; label: string }[];
}) {
  const pathname = usePathname();

  return (
    <div className="flex gap-2 overflow-x-auto border-b border-border px-4 py-2.5">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`shrink-0 cursor-pointer rounded-full px-3.5 py-1.5 text-sm transition-colors ${
              active
                ? "bg-accent font-medium text-accent-foreground shadow-sm"
                : "bg-pop-yellow-tint/70 text-muted-foreground hover:bg-pop-yellow-tint hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
