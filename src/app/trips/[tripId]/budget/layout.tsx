import { MyClockwiseTabs } from "@/components/my-clockwise/MyClockwiseTabs";

// Budget lives under My Clockwise: the tabs stay put, so it reads as one place.
export default async function BudgetLayout({ children, params }: { children: React.ReactNode; params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MyClockwiseTabs tripId={tripId} />
      {children}
    </div>
  );
}
