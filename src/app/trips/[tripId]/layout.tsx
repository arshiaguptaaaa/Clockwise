import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/trip";
import { formatDateRange } from "@/lib/format";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { VibeCheck } from "@/components/vibe/VibeCheck";
import { getVibeStatus, getPrefs, questionsToAsk } from "@/lib/traveller/vibe";
import { prisma } from "@/lib/prisma";

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
  // Private vibe check: offered once, right after joining (and again on request).
  const vibeStatus = await getVibeStatus(tripId, member.userId);
  let vibe: React.ReactNode = null;
  if (vibeStatus === "NONE") {
    const [prefs, journey] = await Promise.all([getPrefs(tripId, member.userId), prisma.travellerJourney.findFirst({ where: { tripId, userId: member.userId, status: "CONFIRMED" } })]);
    const asks = questionsToAsk(prefs, { origin: journey?.originName, mode: journey?.mode });
    const known = [journey?.originName ? `you're coming from ${journey.originName}` : null, journey?.mode ? `you're travelling by ${journey.mode.toLowerCase()}` : null].filter(Boolean).join(" and ");
    vibe = <VibeCheck tripId={tripId} firstName={member.user.name.split(" ")[0]} questions={asks} knownLine={known || null} />;
  }

  const subtitle = `${trip.members.length} ${trip.members.length === 1 ? "traveller" : "travellers"} · ${dateRange}`;

  return (
    <div className="flex h-screen flex-col bg-trip-canvas">
      <TopBar
        title={trip.name}
        subtitle={subtitle}
        currentUserName={member.user.name}
        tripId={tripId}
        isOrganiser={member.userId === trip.createdBy}
      />
      <div className="mx-auto flex w-full min-h-0 max-w-lg flex-1 flex-col bg-surface lg:max-w-2xl lg:border-x lg:border-border lg:shadow-sm">
        {children}
      </div>
      <BottomNav tripId={tripId} />
      {vibe}
    </div>
  );
}
