import { PrismaClient } from "@prisma/client";
import {
  TRIP_NAME,
  CORE_START_DATE,
  CORE_END_DATE,
  DESTINATION,
  TRAVELLERS,
  ROOM_PAIRS,
  SEED_MESSAGES,
  CLOCKWISE_SENDER_NAME,
} from "../src/lib/demo-data";

const prisma = new PrismaClient();

async function main() {
  // Re-runnable WITHOUT touching real trips created through the normal
  // product flow: only ever wipe rows that belong to the existing demo
  // trip (found via isDemo, never by name — a real trip's traveller could
  // easily share a name with one of these seed personas). Users are only
  // ever deleted if this specific demo trip's own membership said so.
  const existingDemoTrip = await prisma.trip.findFirst({ where: { isDemo: true } });
  if (existingDemoTrip) {
    const demoMembers = await prisma.tripMember.findMany({
      where: { tripId: existingDemoTrip.id },
      select: { userId: true },
    });
    const demoUserIds = demoMembers.map((m) => m.userId);

    await prisma.auditLog.deleteMany({ where: { tripId: existingDemoTrip.id } });
    // Rows created by using the demo trip (events, proposals, notifications,
    // budget, ...). Without these, re-seeding fails on foreign keys the moment
    // anyone has used the demo, which blocks every deploy.
    const demoTripId = existingDemoTrip.id;
    await prisma.proposalApproval.deleteMany({ where: { proposal: { tripId: demoTripId } } });
    await prisma.proposalReminder.deleteMany({ where: { proposal: { tripId: demoTripId } } });
    await prisma.proposal.deleteMany({ where: { tripId: demoTripId } });
    await prisma.attachment.deleteMany({ where: { tripId: demoTripId } });
    await prisma.escalationEvent.deleteMany({ where: { tripId: demoTripId } });
    await prisma.travellerConstraint.deleteMany({ where: { tripId: demoTripId } });
    await prisma.tripEvent.deleteMany({ where: { tripId: demoTripId } });
    await prisma.invite.deleteMany({ where: { tripId: demoTripId } });
    await prisma.expenseParticipant.deleteMany({ where: { expense: { tripId: demoTripId } } });
    await prisma.expense.deleteMany({ where: { tripId: demoTripId } });
    await prisma.settlement.deleteMany({ where: { tripId: demoTripId } });
    await prisma.tripBudget.deleteMany({ where: { tripId: demoTripId } });
    await prisma.notification.deleteMany({ where: { tripId: demoTripId } });
    await prisma.travellerReadiness.deleteMany({ where: { tripId: demoTripId } });
    await prisma.travellerLocation.deleteMany({ where: { tripId: demoTripId } });
    await prisma.scheduledJob.deleteMany({ where: { tripId: demoTripId } });
    await prisma.emailLog.deleteMany({ where: { tripId: demoTripId } });
    await prisma.savedPlace.deleteMany({ where: { tripId: demoTripId } });
    await prisma.travellerPreference.deleteMany({ where: { tripId: demoTripId } });
    await prisma.vibeCheck.deleteMany({ where: { tripId: demoTripId } });
    await prisma.travellerJourney.deleteMany({ where: { tripId: demoTripId } });
    await prisma.checklistItem.deleteMany({ where: { tripId: demoTripId } });
    await prisma.railCall.deleteMany({ where: { tripId: demoTripId } });
    await prisma.journeyParticipant.deleteMany({ where: { journey: { tripId: existingDemoTrip.id } } });
    await prisma.journey.deleteMany({ where: { tripId: existingDemoTrip.id } });
    // Uber/mobility rows, deleted child-first: TransportParticipant and
    // RideOrder both reference TransportPlan, RideOrder also references
    // Booking, and Journey (already gone above) referenced RideOrder.
    await prisma.transportParticipant.deleteMany({
      where: { transportPlan: { tripId: existingDemoTrip.id } },
    });
    await prisma.rideOrder.deleteMany({ where: { transportPlan: { tripId: existingDemoTrip.id } } });
    await prisma.transportPlan.deleteMany({ where: { tripId: existingDemoTrip.id } });
    await prisma.booking.deleteMany({ where: { tripId: existingDemoTrip.id } });
    await prisma.commitment.deleteMany({ where: { tripId: existingDemoTrip.id } });
    await prisma.decision.deleteMany({ where: { tripId: existingDemoTrip.id } });
    await prisma.message.deleteMany({ where: { tripId: existingDemoTrip.id } });
    await prisma.permission.deleteMany({ where: { tripId: existingDemoTrip.id } });
    await prisma.privateProfile.deleteMany({ where: { tripId: existingDemoTrip.id } });
    await prisma.tripMember.deleteMany({ where: { tripId: existingDemoTrip.id } });
    await prisma.destination.deleteMany({ where: { tripId: existingDemoTrip.id } });
    await prisma.trip.delete({ where: { id: existingDemoTrip.id } });
    // Re-seeding wipes any demo persona's connected Uber account along with
    // the user row — expected; reconnect Uber again after reseeding.
    await prisma.mobilityConnection.deleteMany({ where: { userId: { in: demoUserIds } } });
    // Safe: these users' only relationship to any trip was the demo trip
    // we just deleted, so no other trip's data references them.
    await prisma.user.deleteMany({ where: { id: { in: demoUserIds } } });
  }

  const users = new Map<string, { id: string }>();
  for (const traveller of TRAVELLERS) {
    const user = await prisma.user.create({
      data: { name: traveller.name },
    });
    users.set(traveller.name, user);
  }

  // Clockwise is shared by every trip (real or demo) as the agent's
  // message sender — reuse it if it already exists instead of deleting
  // and recreating, or every real trip's existing Clockwise-authored
  // messages would be left pointing at a deleted user id.
  const clockwiseUser =
    (await prisma.user.findFirst({ where: { name: CLOCKWISE_SENDER_NAME } })) ??
    (await prisma.user.create({ data: { name: CLOCKWISE_SENDER_NAME } }));

  const organizer = TRAVELLERS.find((t) => t.role === "ORGANIZER")!;

  const trip = await prisma.trip.create({
    data: {
      name: TRIP_NAME,
      coreStartDate: new Date(CORE_START_DATE),
      coreEndDate: new Date(CORE_END_DATE),
      status: "PLANNING",
      createdBy: users.get(organizer.name)!.id,
      isDemo: true,
    },
  });

  // The destination is created by NAME only. Its coordinates, region and provider id are
  // resolved from the real provider when the scenario is set up (never typed in here).
  await prisma.destination.create({
    data: {
      tripId: trip.id,
      name: DESTINATION.name,
      displayName: DESTINATION.displayName,
      country: DESTINATION.country,
      order: 0,
      startDate: new Date(DESTINATION.startDate),
      endDate: new Date(DESTINATION.endDate),
    },
  });

  const roomFor: Record<string, string | undefined> = {};
  for (const [a, b] of ROOM_PAIRS) {
    roomFor[a] = b;
    roomFor[b] = a;
  }

  for (const traveller of TRAVELLERS) {
    const user = users.get(traveller.name)!;

    await prisma.tripMember.create({
      data: {
        tripId: trip.id,
        userId: user.id,
        participationStart: new Date(CORE_START_DATE),
        participationEnd: new Date(CORE_END_DATE),
        departureCity: traveller.departureCity,
        role: traveller.role,
      },
    });

    const roomSharingWith = roomFor[traveller.name];

    await prisma.privateProfile.create({
      data: {
        tripId: trip.id,
        userId: user.id,
        budgetVisibility: "AGENT_ONLY",
        roomPreference: "TWIN",
        roomSharingWith: roomSharingWith ?? null,
      },
    });

    // Default permission posture per spec §19 — granular, purpose-bound, revocable.
    await prisma.permission.createMany({
      data: [
        {
          tripId: trip.id,
          userId: user.id,
          permissionType: "CALENDAR",
          visibility: "AGENT_ONLY",
          purpose: "Use availability only; never expose event details",
        },
        {
          tripId: trip.id,
          userId: user.id,
          permissionType: "BUDGET",
          visibility: "AGENT_ONLY",
          purpose: "Use privately to flag consequences; never show amount to group",
        },
        {
          tripId: trip.id,
          userId: user.id,
          permissionType: "PAYMENTS",
          visibility: "AGENT_ONLY",
          purpose: "Ask before every payment authorisation",
        },
        {
          tripId: trip.id,
          userId: user.id,
          permissionType: "PASSPORT",
          visibility: "AGENT_ONLY",
          purpose: "Use for document-readiness checks only",
        },
        {
          tripId: trip.id,
          userId: user.id,
          permissionType: "LOCATION",
          visibility: "AGENT_ONLY",
          purpose: "Ask for every Live Journey",
        },
      ],
    });
  }

  // Anchored to real wall-clock time (not the fictional trip date) so that
  // live messages sent after seeding — timestamped with real `now()` —
  // always sort after this history instead of before it.
  let ts = new Date();
  ts.setUTCHours(ts.getUTCHours() - 2);
  for (const msg of SEED_MESSAGES) {
    ts = new Date(ts.getTime() + 60_000); // stagger by 1 minute each
    await prisma.message.create({
      data: {
        tripId: trip.id,
        senderId: users.get(msg.sender)!.id,
        channel: "GROUP",
        content: msg.content,
        timestamp: ts,
      },
    });
  }

  console.log(`Seeded trip "${trip.name}" (${trip.id}) with ${TRAVELLERS.length} travellers.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
