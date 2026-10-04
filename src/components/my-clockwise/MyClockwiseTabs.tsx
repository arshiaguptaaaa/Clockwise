"use client";

import { usePathname } from "next/navigation";
import { SubTabs } from "@/components/SubTabs";

// YOU holds what is yours: Home, Journey, Ready?, Saved, Budget. (Around is its own tab, so no sub-tabs there.)
export function MyClockwiseTabs({ tripId }: { tripId: string }) {
  const pathname = usePathname();
  if (pathname.startsWith(`/trips/${tripId}/agent/around`)) return null;
  const base = `/trips/${tripId}/agent`;
  return (
    <SubTabs
      tabs={[
        { href: base, label: "Home" },
        { href: `${base}/journey`, label: "Journey" },
        { href: `${base}/ready`, label: "Ready?" },
        { href: `${base}/saved`, label: "Saved" },
        { href: `/trips/${tripId}/budget`, label: "Budget" },
      ]}
    />
  );
}
