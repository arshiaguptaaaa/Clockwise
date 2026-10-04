// Sets up the canonical demo AFTER the seed, inside a request, through the same
// product functions real users hit. The seed only creates the trip, the four
// travellers and the chat history. Everything that must be true about the world
// comes from a provider here: destination coordinates (Open-Meteo), the
// neighbourhood and the stay (Geoapify), each traveller's arrival airport
// (Geoapify airport POI), and each airport->stay route (Geoapify routing, via
// recomputeRendezvous). Nothing is typed in as provider data.
//
// Idempotent: guarded by a DEMO_SCENARIO_READY event. Notifications created while
// setting up are cleared at the end so the demo starts with a clean bell. The trace
// keeps a DEMO_SCENARIO_READY event saying exactly what was background setup.
import { prisma } from "@/lib/prisma";
import { destinationSearchProvider } from "@/lib/destination-search/open-meteo-provider";
import { resolveLocationText, searchStays, isGeoapifyConfigured } from "@/lib/travel/geoapify-provider";
import { approveStayFromProposal, markStayBooked } from "@/lib/stays";
import { createPendingJourney, confirmJourney } from "@/lib/traveller/journey";
import { setPref } from "@/lib/traveller/vibe";
import { DINNER, STAY_NEIGHBOURHOOD, TRAVELLERS, VIBES, CORE_START_DATE, CORE_END_DATE } from "@/lib/demo-data";

type Step = { step: string; ok: boolean; detail?: string };

export async function ensureDemoScenario(tripId: string): Promise<{ ready: boolean; steps: Step[] }> {
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, include: { members: { include: { user: true } } } });
  if (!trip?.isDemo) return { ready: false, steps: [{ step: "guard", ok: false, detail: "not the demo trip" }] };
  const done = await prisma.tripEvent.findFirst({ where: { tripId, kind: "DEMO_SCENARIO_READY" } });
  if (done) return { ready: true, steps: [] };
  // One setup at a time: a recent STARTED marker means another request is on it.
  const started = await prisma.tripEvent.findFirst({ where: { tripId, kind: "DEMO_SCENARIO_STARTED", createdAt: { gt: new Date(Date.now() - 3 * 60_000) } } });
  if (started) return { ready: false, steps: [{ step: "guard", ok: false, detail: "setup already running" }] };
  await prisma.tripEvent.create({ data: { tripId, kind: "DEMO_SCENARIO_STARTED", scope: "GROUP", sourceChannel: "SYSTEM", payload: "{}", propagation: "[]" } });

  const steps: Step[] = [];
  const userId = (name: string) => trip.members.find((m) => m.user.name === name)!.userId;
  const organiser = trip.members.find((m) => m.role === "ORGANIZER")!.userId;
  const step = async (name: string, fn: () => Promise<string | void>) => {
    try {
      steps.push({ step: name, ok: true, detail: (await fn()) || undefined });
    } catch (err) {
      steps.push({ step: name, ok: false, detail: err instanceof Error ? err.message.slice(0, 160) : "failed" });
    }
  };

  // 1. The destination really is Bengaluru, Karnataka (Open-Meteo identity), not a typed label.
  await step("destination", async () => {
    const results = await destinationSearchProvider.search("Bengaluru");
    const hit = results.find((r) => /karnataka/i.test(r.region ?? "") && /india/i.test(r.country ?? ""));
    if (!hit) throw new Error("Open-Meteo returned no Bengaluru, Karnataka match");
    await prisma.destination.updateMany({
      where: { tripId },
      data: { name: hit.name, displayName: hit.displayName, city: hit.city, region: hit.region, country: hit.country, countryCode: hit.countryCode, latitude: hit.latitude, longitude: hit.longitude, placeId: hit.providerPlaceId, provider: hit.provider },
    });
    return `${hit.displayName} (${hit.provider})`;
  });

  // 2. The stay: a real Geoapify accommodation result near Indiranagar, booked by the organiser.
  await step("stay", async () => {
    if (!isGeoapifyConfigured()) throw new Error("Geoapify not configured");
    const hood = await resolveLocationText(STAY_NEIGHBOURHOOD);
    if (!hood) throw new Error("could not resolve the neighbourhood");
    const stays = await searchStays({ lat: hood.latitude, lng: hood.longitude }, 2500, 12);
    const pick = stays.find((s) => s.name && s.name !== "Unnamed place");
    if (!pick) throw new Error("no named stay near the neighbourhood");
    const ref = {
      provider: pick.provider,
      providerPlaceId: pick.providerId,
      name: pick.name,
      address: pick.formattedAddress,
      latitude: pick.latitude,
      longitude: pick.longitude,
      retrievedAt: pick.retrievedAt,
      checkIn: CORE_START_DATE,
      checkOut: CORE_END_DATE,
      travellers: trip.members.length,
    };
    const { bookingId } = await approveStayFromProposal({ id: `demo-setup:${tripId}`, tripId, title: `Stay: ${pick.name}` }, ref);
    const booked = await markStayBooked(bookingId, organiser);
    if (!booked.ok) throw new Error(booked.error);
    return `${pick.name} (geoapify ${pick.providerId.slice(0, 10)}…)`;
  });

  // 3. The shared commitment the story turns on: dinner at 8 PM for everyone.
  await step("dinner", async () => {
    const exists = await prisma.commitment.findFirst({ where: { tripId, name: DINNER.name } });
    if (exists) return "already there";
    await prisma.commitment.create({
      data: { tripId, name: DINNER.name, targetTime: new Date(`${DINNER.localTime}:00.000Z`), location: DINNER.location, participantIds: JSON.stringify(trip.members.map((m) => m.userId)) },
    });
    await prisma.tripEvent.create({
      data: { tripId, kind: "COMMITMENT_CREATED", scope: "GROUP", sourceChannel: "SYSTEM", confidence: "HIGH", payload: JSON.stringify({ name: DINNER.name, local: DINNER.localTime, location: DINNER.location, background: true }), propagation: JSON.stringify(["plan"]) },
    });
  });

  // 4. Four arrivals into the destination's airport, each confirmed through the product's own journey path.
  for (const t of TRAVELLERS) {
    await step(`journey:${t.name}`, async () => {
      const uid = userId(t.name);
      const j = await createPendingJourney(tripId, uid, { mode: "FLIGHT", originName: t.departureCity, destinationName: "Bengaluru", arriveLocal: t.arrivesLocal }, "MANUAL");
      const r = await confirmJourney(j.id, uid);
      if (!r.ok) throw new Error(r.error);
      const saved = await prisma.travellerJourney.findUnique({ where: { id: j.id } });
      return `${saved?.arrivalPlaceName ?? "arrival point unresolved"} ${saved?.routeToStaySeconds != null ? `${Math.round(saved.routeToStaySeconds / 60)} min to stay` : "no route yet"}`;
    });
  }

  // 5. Private Vibe Checks: different people, kept private.
  await step("vibes", async () => {
    for (const t of TRAVELLERS) {
      const v = VIBES[t.name];
      const uid = userId(t.name);
      await setPref(tripId, uid, "mode", ["FLIGHT"]);
      await setPref(tripId, uid, "energy", v.energy);
      await setPref(tripId, uid, "nearby", v.nearby);
      await setPref(tripId, uid, "pace", [v.pace]);
      if (v.food) await setPref(tripId, uid, "food", [v.food]);
      await prisma.vibeCheck.upsert({ where: { tripId_userId: { tripId, userId: uid } }, create: { tripId, userId: uid, status: "COMPLETED", completedAt: new Date() }, update: { status: "COMPLETED", completedAt: new Date() } });
    }
  });

  // Start with a clean bell: setup notifications are not part of the story.
  await prisma.notification.deleteMany({ where: { tripId } });
  const failed = steps.filter((s) => !s.ok);
  await prisma.tripEvent.create({
    data: {
      tripId,
      kind: "DEMO_SCENARIO_READY",
      scope: "GROUP",
      sourceChannel: "SYSTEM",
      confidence: failed.length ? "LOW" : "HIGH",
      payload: JSON.stringify({ note: "Scenario background set up before the demo: destination, stay, arrivals, dinner and private vibes. Provider facts were fetched from Open-Meteo and Geoapify at this moment; the travellers' choices are scripted background.", steps }),
      propagation: "[]",
    },
  });
  return { ready: failed.length === 0, steps };
}
