import { SubTabs } from "@/components/SubTabs";

// My Clockwise: the traveller's private control centre. Budget has its own tab.
export default async function MyClockwiseLayout({ children, params }: { children: React.ReactNode; params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const base = `/trips/${tripId}/agent`;
  const tabs = [
    { href: base, label: "Clockwise" },
    { href: `${base}/journey`, label: "✈ Journey" },
    { href: `${base}/ready`, label: "Ready?" },
    { href: `${base}/around`, label: "◎ Around you" },
    { href: `${base}/saved`, label: "♡ Saved" },
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SubTabs tabs={tabs} />
      {children}
    </div>
  );
}
