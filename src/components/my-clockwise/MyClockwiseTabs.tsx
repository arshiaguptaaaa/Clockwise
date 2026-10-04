import { SubTabs } from "@/components/SubTabs";

// My Clockwise holds everything that is yours: Journey, Ready?, Around you, Saved, Budget.
export function MyClockwiseTabs({ tripId }: { tripId: string }) {
  const base = `/trips/${tripId}/agent`;
  return (
    <SubTabs
      tabs={[
        { href: base, label: "Home" },
        { href: `${base}/journey`, label: "Journey" },
        { href: `${base}/ready`, label: "Ready?" },
        { href: `${base}/around`, label: "Around" },
        { href: `${base}/saved`, label: "Saved" },
        { href: `/trips/${tripId}/budget`, label: "Budget" },
      ]}
    />
  );
}
