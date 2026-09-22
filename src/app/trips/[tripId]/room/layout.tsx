import { SubTabs } from "@/components/SubTabs";

export default async function RoomLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  const base = `/trips/${tripId}/room`;
  const tabs = [
    { href: base, label: "Chat" },
    { href: `${base}/plan`, label: "Plan" },
    { href: `${base}/tasks`, label: "Tasks" },
    { href: `${base}/files`, label: "Files" },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SubTabs tabs={tabs} />
      {children}
    </div>
  );
}
