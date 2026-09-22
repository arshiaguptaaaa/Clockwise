import { SubTabs } from "@/components/SubTabs";

export default async function PlanLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  const base = `/trips/${tripId}/plan`;
  const tabs = [
    { href: base, label: "Overview" },
    { href: `${base}/itinerary`, label: "Itinerary" },
    { href: `${base}/travellers`, label: "Travellers" },
    { href: `${base}/tasks`, label: "Tasks" },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SubTabs tabs={tabs} />
      {children}
    </div>
  );
}
