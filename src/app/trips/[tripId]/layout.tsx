import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/trip";
import { formatDateRange } from "@/lib/format";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { LiveSync } from "@/components/LiveSync";
import { DecisionStrip } from "@/components/decisions/DecisionStrip";
import { getOpenDecisions, waitingOn } from "@/lib/decisions";
import { notesForViewer } from "@/lib/private-notes";
import { NoteToasts } from "@/components/notes/NoteToasts";

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
  // The Vibe Check is no longer part of onboarding: discovery is query-driven and never depends on it. The feature
  // itself stays (Ready? and ?vibe=1 can still offer it); nothing here pops it up.

  const decisions = await getOpenDecisions(tripId, member.userId);
  // Notes another traveller asked Clockwise to pass to this viewer (never group chat content).
  const notes = await notesForViewer(tripId, member.userId).catch(() => []);
  const organiser = trip.members.find((m) => m.userId === trip.createdBy);

  const subtitle = `${trip.members.length} ${trip.members.length === 1 ? "traveller" : "travellers"} · ${dateRange}`;

  return (
    <div className="flex h-dvh flex-col bg-trip-canvas">
      <TopBar
        title={trip.name}
        subtitle={subtitle}
        currentUserName={member.user.name}
        tripId={tripId}
        isOrganiser={member.userId === trip.createdBy}
      />
      <div className="mx-auto flex w-full min-h-0 max-w-lg flex-1 flex-col bg-surface lg:max-w-2xl lg:border-x lg:border-border">
        <DecisionStrip tripId={tripId} viewerId={member.userId} organiserId={trip.createdBy} organiserName={organiser?.user.name ?? "the organiser"} decisions={decisions} />
        {children}
      </div>
      <NoteToasts tripId={tripId} notes={notes} />
      <LiveSync tripId={tripId} />
      <BottomNav tripId={tripId} waiting={waitingOn(decisions).length + (member.userId === trip.createdBy ? decisions.filter((d) => d.stage === "AGREED").length : 0)} />
    </div>
  );
}
