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
    <div className="flex gap-4 overflow-x-auto border-b border-border px-5 sm:gap-6 [scrollbar-width:none]">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`relative shrink-0 cursor-pointer py-3 text-[13px] tracking-wide sm:text-[13.5px] transition-colors ${
              active ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
            <span className={`absolute inset-x-0 -bottom-px h-[2px] rounded-full transition-colors ${active ? "bg-accent" : "bg-transparent"}`} />
          </Link>
        );
      })}
    </div>
  );
}
