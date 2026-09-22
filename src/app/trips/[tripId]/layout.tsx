import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/trip";
import { formatDateRange } from "@/lib/format";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";

export default async function TripShellLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  const session = await getCurrentMember(tripId);
  if (!session) {
    redirect("/");
  }
  const { trip, member } = session;

  const dateRange =
    trip.coreStartDate && trip.coreEndDate
      ? `${formatDateRange(trip.coreStartDate, trip.coreEndDate)} ${trip.coreEndDate.getUTCFullYear()}`
      : "dates not set yet";
  const subtitle = `${trip.members.length} ${trip.members.length === 1 ? "traveller" : "travellers"} · ${dateRange}`;

  return (
    <div className="flex h-screen flex-col bg-page">
      <TopBar
        title={trip.name}
        subtitle={subtitle}
        currentUserName={member.user.name}
      />
      <div className="mx-auto flex w-full min-h-0 max-w-lg flex-1 flex-col bg-surface lg:max-w-2xl lg:border-x lg:border-border lg:shadow-sm">
        {children}
      </div>
      <BottomNav tripId={tripId} />
    </div>
  );
}
