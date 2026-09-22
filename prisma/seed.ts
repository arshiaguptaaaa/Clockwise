import { PrismaClient } from "@prisma/client";
import {
  TRIP_NAME,
  CORE_START_DATE,
  CORE_END_DATE,
  ROUTE,
  TRAVELLERS,
  ROOM_PAIRS,
  SINGLE_ROOMS,
  PRIVATE_BUDGETS,
  DOCUMENT_STATUS,
  SEED_MESSAGES,
  CLOCKWISE_SENDER_NAME,
  DINNER_DEPARTURE_TRAVELLERS,
  VIENNA_HOTEL_PAYER,
  VIENNA_HOTEL_AMOUNT,
  VIENNA_HOTEL_CURRENCY,
  VIENNA_HOTEL_ROOMS,
  VIENNA_HOTEL_NIGHTS,
} from "../src/lib/demo-data";
import { encodeCard } from "../src/lib/action-cards";
import { getPendingDocumentTravellers } from "../src/lib/document-readiness";

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

  for (const dest of ROUTE) {
    await prisma.destination.create({
      data: {
        tripId: trip.id,
        name: dest.name,
        country: dest.country,
        order: dest.order,
        startDate: dest.startDate ? new Date(dest.startDate) : null,
        endDate: dest.endDate ? new Date(dest.endDate) : null,
      },
    });
  }

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
        participationStart: new Date(traveller.participationStart),
        participationEnd: new Date(traveller.participationEnd),
        departureCity: traveller.departureCity,
        role: traveller.role,
      },
    });

    const isSingle = SINGLE_ROOMS.includes(traveller.name);
    const roomSharingWith = roomFor[traveller.name];
    const budgetCeiling = PRIVATE_BUDGETS[traveller.name];
    const doc = DOCUMENT_STATUS[traveller.name];

    await prisma.privateProfile.create({
      data: {
        tripId: trip.id,
        userId: user.id,
        budgetCeiling: budgetCeiling ?? null,
        budgetVisibility: "AGENT_ONLY",
        roomPreference: isSingle ? "SINGLE" : "TWIN",
        roomSharingWith: roomSharingWith ?? null,
        passportStatus: doc?.passportStatus ?? null,
        visaStatus: doc?.visaStatus ?? null,
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

  // Clockwise's transport action card — real TransportPlan/Commitment rows
  // back it (not baked-in mock numbers), so "Check rides"/"Confirm &
  // request rides" on this card make genuine Uber Sandbox API calls once
  // the organiser (Arshia) connects Uber. Everything from here on is live,
  // not scripted.
  const departureIds = DINNER_DEPARTURE_TRAVELLERS.map((name) => users.get(name)!.id);
  const laterIds = TRAVELLERS.map((t) => users.get(t.name)!.id).filter(
    (id) => !departureIds.includes(id)
  );

  const dinnerTargetTime = new Date(CORE_START_DATE);
  dinnerTargetTime.setUTCDate(dinnerTargetTime.getUTCDate() + 1); // an evening during the Vienna leg
  dinnerTargetTime.setUTCHours(20, 0, 0, 0);

  const dinnerCommitment = await prisma.commitment.create({
    data: {
      tripId: trip.id,
      name: "Dinner",
      targetTime: dinnerTargetTime,
      location: "Mariahilf, Vienna",
      participantIds: JSON.stringify([...departureIds, ...laterIds]),
    },
  });

  const transportPlan = await prisma.transportPlan.create({
    data: {
      tripId: trip.id,
      commitmentId: dinnerCommitment.id,
      createdBy: clockwiseUser.id,
      pickup: "Innere Stadt, Vienna",
      destination: "Mariahilf, Vienna",
      partySize: departureIds.length,
      status: "DRAFT",
    },
  });

  const demoTripMembers = await prisma.tripMember.findMany({ where: { tripId: trip.id } });
  const tripMemberIdByUserId = new Map(demoTripMembers.map((m) => [m.userId, m.id]));

  await prisma.transportParticipant.createMany({
    data: [
      ...departureIds.map((userId) => ({
        transportPlanId: transportPlan.id,
        tripMemberId: tripMemberIdByUserId.get(userId)!,
        status: "CONFIRMED",
      })),
      ...laterIds.map((userId) => ({
        transportPlanId: transportPlan.id,
        tripMemberId: tripMemberIdByUserId.get(userId)!,
        status: "LEAVING_LATER",
      })),
    ],
  });

  ts = new Date(ts.getTime() + 60_000);
  await prisma.message.create({
    data: {
      tripId: trip.id,
      senderId: clockwiseUser.id,
      channel: "GROUP",
      content: `${departureIds.length} of ${TRAVELLERS.length} are leaving at 7:15 for dinner. Who's leaving together?`,
      timestamp: ts,
      cardType: "TRANSPORT",
      cardStatus: "PENDING",
      cardData: encodeCard({
        title: `${departureIds.length} of ${TRAVELLERS.length} travellers are leaving at 7:15.`,
        context: "Confirm who's leaving together, then I can check real Uber rides.",
        affectedTravellerIds: departureIds,
        transportPlanId: transportPlan.id,
      }),
    },
  });

  // Vienna hotel payment scenario — GROUP-visible booking card plus the
  // linked PRIVATE authorisation card in the payer's My Agent inbox. Only
  // Arshia (the payer) can act on the private card; the group card is
  // informational for everyone else. See spec correction on consequential
  // authorisation routing.
  const payerId = users.get(VIENNA_HOTEL_PAYER)!.id;
  ts = new Date(ts.getTime() + 60_000);
  const groupBookingCard = await prisma.message.create({
    data: {
      tripId: trip.id,
      senderId: clockwiseUser.id,
      channel: "GROUP",
      content: "Vienna hotel is ready to confirm.",
      timestamp: ts,
      cardType: "BOOKING",
      cardStatus: "PENDING",
      cardData: encodeCard({
        title: "Vienna hotel is ready to confirm.",
        context: `${VIENNA_HOTEL_PAYER} has offered to pay for this booking.`,
        values: [
          { label: "Rooms", value: String(VIENNA_HOTEL_ROOMS) },
          { label: "Nights", value: String(VIENNA_HOTEL_NIGHTS) },
          { label: "Total", value: `€${VIENNA_HOTEL_AMOUNT}` },
        ],
        payerId,
        amount: VIENNA_HOTEL_AMOUNT,
        currency: VIENNA_HOTEL_CURRENCY,
      }),
    },
  });

  ts = new Date(ts.getTime() + 30_000);
  const privatePaymentCard = await prisma.message.create({
    data: {
      tripId: trip.id,
      senderId: clockwiseUser.id,
      channel: "PRIVATE",
      recipientId: payerId,
      content: "Vienna Hotel — €" + VIENNA_HOTEL_AMOUNT,
      timestamp: ts,
      cardType: "PAYMENT",
      cardStatus: "PENDING",
      cardData: encodeCard({
        title: `Vienna Hotel — €${VIENNA_HOTEL_AMOUNT}`,
        context: "Authorisation applies only to this transaction.",
        values: [{ label: "Paying as", value: VIENNA_HOTEL_PAYER }],
        payerId,
        amount: VIENNA_HOTEL_AMOUNT,
        currency: VIENNA_HOTEL_CURRENCY,
        linkedMessageId: groupBookingCard.id,
      }),
    },
  });

  await prisma.message.update({
    where: { id: groupBookingCard.id },
    data: {
      cardData: encodeCard({
        title: "Vienna hotel is ready to confirm.",
        context: `${VIENNA_HOTEL_PAYER} has offered to pay for this booking.`,
        values: [
          { label: "Rooms", value: String(VIENNA_HOTEL_ROOMS) },
          { label: "Nights", value: String(VIENNA_HOTEL_NIGHTS) },
          { label: "Total", value: `€${VIENNA_HOTEL_AMOUNT}` },
        ],
        payerId,
        amount: VIENNA_HOTEL_AMOUNT,
        currency: VIENNA_HOTEL_CURRENCY,
        linkedMessageId: privatePaymentCard.id,
      }),
    },
  });

  // Travel-document dependency card — derived from real PrivateProfile
  // data (whoever has visaStatus PENDING), not a hardcoded name. The group
  // never learns who; the affected traveller gets the real detail privately.
  const pendingDocTravellers = await getPendingDocumentTravellers(trip.id);
  if (pendingDocTravellers.length > 0) {
    ts = new Date(ts.getTime() + 60_000);
    await prisma.message.create({
      data: {
        tripId: trip.id,
        senderId: clockwiseUser.id,
        channel: "GROUP",
        content: "One traveller still has a travel-document dependency that affects the flight booking.",
        timestamp: ts,
        cardType: "DOCUMENT",
        cardStatus: "PENDING",
        cardData: encodeCard({
          title: "One traveller still has a travel-document dependency that affects the flight booking.",
          context: "I'll follow up with them privately.",
          informational: true,
        }),
      },
    });

    for (const traveller of pendingDocTravellers) {
      ts = new Date(ts.getTime() + 10_000);
      await prisma.message.create({
        data: {
          tripId: trip.id,
          senderId: clockwiseUser.id,
          channel: "PRIVATE",
          recipientId: traveller.userId,
          content: "Your visa application is still pending.",
          timestamp: ts,
          cardType: "DOCUMENT",
          cardStatus: "PENDING",
          cardData: encodeCard({
            title: "Your visa application is still pending.",
            context: "This may affect the current travel-document requirement for the flight booking.",
          }),
        },
      });
    }
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
