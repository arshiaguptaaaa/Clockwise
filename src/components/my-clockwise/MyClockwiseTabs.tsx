"use client";

import { usePathname } from "next/navigation";
import { SubTabs } from "@/components/SubTabs";

// YOU holds what is yours: Home, Journey, Ready?, Saved, Budget. (Around is its own tab, so no sub-tabs there.)
export function MyClockwiseTabs({ tripId }: { tripId: string }) {
  const pathname = usePathname();
  // Around is its own tab; the organiser/developer views (trace, evidence) are not part of the traveller's own space.
  if (pathname.startsWith(`/trips/${tripId}/agent/around`) || pathname.startsWith(`/trips/${tripId}/agent/trace`)) return null;
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
