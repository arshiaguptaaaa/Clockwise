import { prisma } from "@/lib/prisma";
import { postActionCard } from "@/lib/action-cards";
import { mobilityProvider } from "@/lib/providers/mobility";
import { getOrganiserAuth, resolveRoute, isFailure } from "@/lib/transport";
import {
  searchHotels as geoapifySearchHotels,
  searchNearby as geoapifySearchNearby,
  searchPlaceByText,
  getRoute as geoapifyGetRoute,
  isGeoapifyConfigured,
  NEARBY_CATEGORIES,
} from "@/lib/travel/geoapify-provider";
import { getWeather as fetchWeather } from "@/lib/travel/open-meteo-weather";
import {
  resolveTripCityPoint,
  resolveTripLocationText,
  resolveWeatherLocation,
  isResolveFailure,
} from "@/lib/travel/resolve";
import { computeReadinessStatus } from "@/lib/readiness";
import type { LatLng, TravelMode } from "@/lib/travel/types";
import type { AgentContext } from "./context";
import type { AgentToolSchema } from "./provider";
import type { Trip } from "@/lib/trip";

const TERMINAL_RIDE_STATUSES = ["COMPLETED", "RIDER_CANCELLED", "DRIVER_CANCELLED", "FAILED"];

// Best-effort "where is the group right now" for defaulting a transport
// plan's pickup city — never fabricated, just read from real
// Destination.startDate/endDate windows already on the trip.
function inferCurrentCity(trip: Trip): string | undefined {
  const now = new Date();
  const current = trip.destinations.find(
    (d) => d.startDate && d.endDate && d.startDate <= now && now <= d.endDate
  );
  if (current) return current.name;
  return [...trip.destinations].sort((a, b) => a.order - b.order)[0]?.name;
}

export const AGENT_TOOLS: AgentToolSchema[] = [
  {
    name: "stay_silent",
    description:
      "Call this INSTEAD of replying with text when the message is normal conversation that does not need a response from you — no other tool should be called alongside this one.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "One short internal note on why no reply is needed (never shown to users)" },
      },
      required: ["reason"],
    },
  },
  {
    name: "prepare_transport",
    description:
      "Prepare (NOT book) a real Uber transport plan for a specific list of travellers going somewhere together. Always produces a pending card requiring human confirmation and the trip organiser's connected Uber account — never requests a ride itself.",
    parameters: {
      type: "object",
      properties: {
        travellerNames: {
          type: "array",
          items: { type: "string" },
          description: "Names of travellers leaving together, from the known traveller list",
        },
        destination: { type: "string", description: "Where they're going, e.g. 'the restaurant' or an area name" },
        pickup: { type: "string", description: "Where they're leaving from, e.g. 'the hotel'; omit to default to the hotel" },
      },
      required: ["travellerNames", "destination"],
    },
  },
  {
    name: "get_transport_options",
    description:
      "Read-only: fetch REAL current Uber product/price options for the trip's pending transport plan, using the organiser's connected Uber account. Never creates or requests anything.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_transport_status",
    description:
      "Read-only: check the real current status of any Uber rides already requested for this trip (e.g. accepted, arriving, in progress). Never creates, requests, or cancels anything.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "prepare_payment",
    description:
      "Prepare (NOT charge) a payment card for a specific booking. Always produces a pending group card plus a private authorisation card for the payer — never charges anything itself.",
    parameters: {
      type: "object",
      properties: {
        payerName: { type: "string", description: "Name of the traveller paying, from the known traveller list" },
        amount: { type: "number" },
        currency: { type: "string", description: "e.g. EUR" },
        purpose: { type: "string", description: "What this payment is for, e.g. 'Vienna hotel'" },
      },
      required: ["payerName", "amount", "currency", "purpose"],
    },
  },
  {
    name: "create_commitment",
    description:
      "Log a shared or personal commitment (a time-bound plan the group or one traveller needs to keep) into structured trip state.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        targetTimeIso: { type: "string", description: "ISO timestamp for when this needs to happen" },
        location: { type: "string" },
        participantNames: {
          type: "array",
          items: { type: "string" },
          description: "Who this applies to; omit for a personal commitment for the current traveller only",
        },
      },
      required: ["name", "targetTimeIso", "location"],
    },
  },
  {
    name: "update_trip_decision",
    description: "Record a decision the group has reached (e.g. route order, hotel choice) into structured trip state.",
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", description: "What kind of decision, e.g. 'route', 'hotel'" },
        value: { type: "string", description: "The decided value" },
        confidence: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
      },
      required: ["type", "value", "confidence"],
    },
  },
  {
    name: "check_readiness",
    description:
      "Deterministically check whether a logged commitment is ON_TRACK, AT_RISK, or MISSED by comparing its target time to now. Read-only — never guess this yourself, always call this tool.",
    parameters: {
      type: "object",
      properties: {
        commitmentName: { type: "string", description: "Name of the commitment to check; omit to check the soonest upcoming one" },
      },
    },
  },
  {
    name: "update_participation_window",
    description:
      "Change the current traveller's own participation start/end dates. Only usable in that traveller's own private room, never on behalf of someone else.",
    parameters: {
      type: "object",
      properties: {
        participationStartIso: { type: "string" },
        participationEndIso: { type: "string" },
      },
      required: ["participationStartIso", "participationEndIso"],
    },
  },
  {
    name: "find_next_checkpoint",
    description:
      "Look up the next shared meeting point for a traveller who may miss a rendezvous during an active journey. Returns honestly if no live journey is active yet.",
    parameters: {
      type: "object",
      properties: {
        missedCommitmentName: { type: "string" },
      },
    },
  },
  {
    name: "search_places",
    description:
      "Read-only: look up a specific named place (a landmark, square, street, address) and get its REAL location. Use for 'where is X' questions. Never guess a location yourself — always call this.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The place name to look up, e.g. 'Stephansplatz'" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_hotels",
    description:
      "Read-only: find REAL hotels near a place — returns names/addresses/locations only, never a fabricated price, rating, or availability. Use for 'where should we stay' / 'hotels near X' questions.",
    parameters: {
      type: "object",
      properties: {
        near: {
          type: "string",
          description: "Area/landmark to search near, e.g. 'Stephansplatz' or 'our hotel'; omit to use the trip's current destination",
        },
      },
    },
  },
  {
    name: "search_nearby",
    description:
      "Read-only: find real places of a given category near a location — e.g. 'coffee near us', 'pharmacy near the hotel', 'restaurants near Stephansplatz'.",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: Object.keys(NEARBY_CATEGORIES),
          description: "The kind of place being searched for",
        },
        near: {
          type: "string",
          description: "Area/landmark/'our hotel' to search near; omit to use the trip's current destination",
        },
      },
      required: ["category"],
    },
  },
  {
    name: "get_route",
    description:
      "Read-only: get the REAL distance and travel time between two places (walking, driving, or transit). Use for any 'how far'/'how long' question. Never estimate this yourself — always call this tool.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "Starting point, e.g. 'our hotel', a commitment name, or a place name" },
        to: { type: "string", description: "Destination, e.g. 'the restaurant', a commitment name, or a place name" },
        mode: {
          type: "string",
          enum: ["walk", "drive", "transit", "bicycle"],
          description: "Defaults to walk for short in-city distances; use drive for longer/inter-city routes",
        },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_weather",
    description: "Read-only: get the REAL current weather and short forecast for a place.",
    parameters: {
      type: "object",
      properties: {
        location: { type: "string", description: "Place/city to check; omit to use the trip's current destination" },
      },
    },
  },
];

export type ToolExecutionResult = { output: string; posted?: boolean };

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: AgentContext
): Promise<ToolExecutionResult> {
  switch (name) {
    case "prepare_transport":
      return prepareTransport(input, ctx);
    case "get_transport_options":
      return getTransportOptions(ctx);
    case "get_transport_status":
      return getTransportStatus(ctx);
    case "prepare_payment":
      return preparePayment(input, ctx);
    case "create_commitment":
      return createCommitment(input, ctx);
    case "update_trip_decision":
      return updateTripDecision(input, ctx);
    case "check_readiness":
      return checkReadiness(input, ctx);
    case "update_participation_window":
      return updateParticipationWindow(input, ctx);
    case "find_next_checkpoint":
      return findNextCheckpoint();
    case "search_places":
      return searchPlacesTool(input, ctx);
    case "search_hotels":
      return searchHotelsTool(input, ctx);
    case "search_nearby":
      return searchNearbyTool(input, ctx);
    case "get_route":
      return getRouteTool(input, ctx);
    case "get_weather":
      return getWeatherTool(input, ctx);
    default:
      return { output: `Unknown tool: ${name}` };
  }
}

function resolveTravellerIds(names: string[], ctx: AgentContext) {
  return ctx.trip.members
    .filter((m) => names.some((n) => n.toLowerCase() === m.user.name.toLowerCase()))
    .map((m) => m.userId);
}

async function prepareTransport(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  const travellerNames = (input.travellerNames as string[]) ?? [];
  const ids = resolveTravellerIds(travellerNames, ctx);
  if (ids.length === 0) {
    return { output: "Could not match any of those names to known travellers — ask for clarification." };
  }

  const destination = (input.destination as string)?.trim();
  if (!destination) {
    return { output: "A destination is required to prepare transport — ask where they're going." };
  }
  const pickup = ((input.pickup as string) || "the hotel").trim();

  const tripMemberByUserId = new Map(ctx.trip.members.map((m) => [m.userId, m]));
  const goingNowIds = ids
    .map((userId) => tripMemberByUserId.get(userId)?.id)
    .filter((id): id is string => Boolean(id));
  const goingLaterIds = ctx.trip.members
    .filter((m) => !ids.includes(m.userId))
    .map((m) => m.id);

  const plan = await prisma.transportPlan.create({
    data: {
      tripId: ctx.trip.id,
      createdBy: ctx.clockwiseUserId,
      pickup,
      destination,
      partySize: ids.length,
      status: "DRAFT",
    },
  });

  await prisma.transportParticipant.createMany({
    data: [
      ...goingNowIds.map((tripMemberId) => ({
        transportPlanId: plan.id,
        tripMemberId,
        status: "CONFIRMED",
      })),
      ...goingLaterIds.map((tripMemberId) => ({
        transportPlanId: plan.id,
        tripMemberId,
        status: "LEAVING_LATER",
      })),
    ],
  });

  await postActionCard({
    tripId: ctx.trip.id,
    channel: "GROUP",
    type: "TRANSPORT",
    status: "PENDING",
    data: {
      title: `${ids.length} travellers — I can check real Uber rides to ${destination}.`,
      context: "Confirm who's leaving together, then check rides.",
      affectedTravellerIds: ids,
      transportPlanId: plan.id,
    },
  });

  return {
    output: `Prepared a pending transport plan for ${ids.length} traveller(s) to ${destination}. This requires the trip organiser's connected Uber account and an explicit human confirmation before any ride is requested — I cannot request it myself.`,
    posted: true,
  };
}

async function getTransportOptions(ctx: AgentContext): Promise<ToolExecutionResult> {
  const plan = await prisma.transportPlan.findFirst({
    where: { tripId: ctx.trip.id, status: { in: ["DRAFT", "OPTIONS_READY"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!plan) {
    return { output: "No transport plan is currently pending for this trip." };
  }

  const auth = await getOrganiserAuth(ctx.trip.id);
  if (isFailure(auth)) return { output: auth.error };

  const route = await resolveRoute(plan, inferCurrentCity(ctx.trip));
  if (isFailure(route)) return { output: route.error };

  const options = await mobilityProvider.getEstimate(auth, route, plan.partySize);
  if (options.length === 0) {
    return { output: "Uber has no ride options available for this route right now." };
  }

  const summary = options
    .map(
      (o) =>
        `${o.vehiclesNeeded}× ${o.displayName} (${o.currency}${o.lowEstimate}-${o.highEstimate})`
    )
    .join("; ");
  return {
    output: `Real Uber options for ${plan.partySize} traveller(s), ${plan.pickup} → ${plan.destination}: ${summary}. A human still needs to review and confirm before any ride is requested.`,
  };
}

async function getTransportStatus(ctx: AgentContext): Promise<ToolExecutionResult> {
  const plan = await prisma.transportPlan.findFirst({
    where: { tripId: ctx.trip.id },
    orderBy: { createdAt: "desc" },
    include: { rideOrders: true },
  });
  if (!plan || plan.rideOrders.length === 0) {
    return { output: "No Uber rides have been requested for this trip yet." };
  }

  const auth = await getOrganiserAuth(ctx.trip.id);

  const summaries: string[] = [];
  for (const ride of plan.rideOrders) {
    let status = ride.status;
    if (!isFailure(auth) && ride.providerRideId && !TERMINAL_RIDE_STATUSES.includes(ride.status)) {
      try {
        const live = await mobilityProvider.getRide(auth, ride.providerRideId);
        if (live.status !== ride.status) {
          await prisma.rideOrder.update({ where: { id: ride.id }, data: { status: live.status } });
        }
        status = live.status;
      } catch {
        // Keep the last known status rather than failing the whole read.
      }
    }
    summaries.push(`${ride.productName ?? "Ride"}: ${status}`);
  }

  return { output: summaries.join("; ") };
}

async function preparePayment(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  const payerName = input.payerName as string;
  const payer = ctx.trip.members.find((m) => m.user.name.toLowerCase() === payerName?.toLowerCase());
  if (!payer) {
    return { output: `Could not find a traveller named "${payerName}" — ask for clarification.` };
  }

  const amount = Number(input.amount);
  const currency = (input.currency as string) ?? "EUR";
  const purpose = (input.purpose as string) ?? "a booking";

  const groupCard = await postActionCard({
    tripId: ctx.trip.id,
    channel: "GROUP",
    type: "BOOKING",
    status: "PENDING",
    data: {
      title: `${purpose} is ready to confirm.`,
      context: `${payer.user.name} has offered to pay for this booking.`,
      values: [{ label: "Total", value: `${currency === "EUR" ? "€" : currency}${amount}` }],
      payerId: payer.userId,
      amount,
      currency,
    },
  });

  await postActionCard({
    tripId: ctx.trip.id,
    channel: "PRIVATE",
    recipientId: payer.userId,
    type: "PAYMENT",
    status: "PENDING",
    data: {
      title: `${purpose} — ${currency === "EUR" ? "€" : currency}${amount}`,
      context: "Authorisation applies only to this transaction.",
      values: [{ label: "Paying as", value: payer.user.name }],
      payerId: payer.userId,
      amount,
      currency,
      linkedMessageId: groupCard.id,
    },
  });

  return {
    output: `Prepared a payment card pair: ${payer.user.name} will see a private authorisation request for ${currency}${amount}. The group sees only that a booking is ready and who offered to pay — no amount details are exposed to non-payers beyond the total already stated.`,
    posted: true,
  };
}

async function createCommitment(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  const name = input.name as string;
  const targetTime = new Date(input.targetTimeIso as string);
  const location = input.location as string;
  const participantNames = (input.participantNames as string[] | undefined) ?? [ctx.actingUserName];

  if (isNaN(targetTime.getTime())) {
    return { output: "The target time given was not a valid date/time — ask for clarification." };
  }

  const participantIds =
    participantNames.length > 0
      ? resolveTravellerIds(participantNames, ctx)
      : [ctx.actingUserId];

  await prisma.commitment.create({
    data: {
      tripId: ctx.trip.id,
      name,
      targetTime,
      location,
      participantIds: JSON.stringify(participantIds.length > 0 ? participantIds : [ctx.actingUserId]),
    },
  });

  return { output: `Logged commitment "${name}" at ${location}, target time ${targetTime.toISOString()}.` };
}

async function updateTripDecision(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  const type = input.type as string;
  const value = input.value as string;
  const confidence = (input.confidence as string) ?? "MEDIUM";

  await prisma.decision.create({
    data: {
      tripId: ctx.trip.id,
      type: "DECISION",
      value: JSON.stringify({ type, value }),
      confidence,
      status: confidence === "HIGH" ? "CONFIRMED" : "CANDIDATE",
      sourceMessageIds: "[]",
      confirmedBy: confidence === "HIGH" ? ctx.actingUserId : null,
    },
  });

  return { output: `Recorded decision: ${type} = ${value} (confidence ${confidence}).` };
}

async function checkReadiness(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  const name = input.commitmentName as string | undefined;

  const commitment = name
    ? await prisma.commitment.findFirst({ where: { tripId: ctx.trip.id, name: { contains: name } } })
    : await prisma.commitment.findFirst({
        where: { tripId: ctx.trip.id, targetTime: { gte: new Date() } },
        orderBy: { targetTime: "asc" },
      });

  if (!commitment) {
    return { output: "No logged commitment found to check readiness against — none has been created yet." };
  }

  const now = new Date();
  const minutesUntil = Math.round((commitment.targetTime.getTime() - now.getTime()) / 60_000);
  const status = computeReadinessStatus(commitment);

  await prisma.commitment.update({ where: { id: commitment.id }, data: { status } });

  return {
    output: `Commitment "${commitment.name}" at ${commitment.location}, target ${commitment.targetTime.toISOString()}. Status: ${status} (${minutesUntil} minutes from now).`,
  };
}

async function updateParticipationWindow(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  if (ctx.mode !== "PRIVATE") {
    return {
      output: "Refused: participation windows can only be changed inside the traveller's own private My Clockwise room, not from Trip Room.",
    };
  }

  const start = new Date(input.participationStartIso as string);
  const end = new Date(input.participationEndIso as string);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { output: "The dates given were not valid — ask for clarification." };
  }

  await prisma.tripMember.updateMany({
    where: { tripId: ctx.trip.id, userId: ctx.actingUserId },
    data: { participationStart: start, participationEnd: end },
  });

  return { output: `Updated ${ctx.actingUserName}'s participation window to ${start.toDateString()} – ${end.toDateString()}.` };
}

async function findNextCheckpoint(): Promise<ToolExecutionResult> {
  return {
    output:
      "No Live Journey is currently active for this trip, so there is no next checkpoint to compute yet. This capability activates once a journey between destinations is underway.",
  };
}

function cardChannel(ctx: AgentContext) {
  return ctx.mode === "PRIVATE"
    ? ({ channel: "PRIVATE" as const, recipientId: ctx.actingUserId })
    : ({ channel: "GROUP" as const });
}

async function searchPlacesTool(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  const query = (input.query as string)?.trim();
  if (!query) return { output: "A place name is required." };
  if (!isGeoapifyConfigured()) {
    return { output: "Live place search is temporarily unavailable — I can only reason from stored trip state right now." };
  }

  const cityPoint = await resolveTripCityPoint(ctx.trip);
  let results;
  try {
    results = await searchPlaceByText(query, cityPoint?.point);
  } catch (err) {
    return { output: `Live place search failed: ${err instanceof Error ? err.message : "unknown error"}.` };
  }

  if (results.length === 0) {
    return { output: `Couldn't find a real location for "${query}".` };
  }

  await postActionCard({
    tripId: ctx.trip.id,
    ...cardChannel(ctx),
    type: "PLACES",
    status: "CONFIRMED",
    data: {
      title: query,
      places: results.map((r) => ({
        name: r.name,
        formattedAddress: r.formattedAddress,
        distanceMeters: r.distanceMeters,
        latitude: r.latitude,
        longitude: r.longitude,
      })),
      provider: results[0].provider,
      retrievedAt: results[0].retrievedAt,
    },
  });

  return {
    output: `Found "${query}" at ${results[0].formattedAddress ?? `${results[0].latitude}, ${results[0].longitude}`} (source: Geoapify, just now).`,
    posted: true,
  };
}

async function resolveSearchPoint(
  near: string | undefined,
  ctx: AgentContext
): Promise<{ point: LatLng; label: string } | { error: string }> {
  const cityPoint = await resolveTripCityPoint(ctx.trip);
  if (!near) {
    if (!cityPoint) return { error: "I don't know which destination to search near yet — ask for a place or destination." };
    return cityPoint;
  }
  const resolved = await resolveTripLocationText(near, ctx.trip.id, cityPoint?.point);
  if (isResolveFailure(resolved)) return resolved;
  return resolved;
}

async function searchHotelsTool(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  if (!isGeoapifyConfigured()) {
    return { output: "Live hotel search is temporarily unavailable." };
  }
  const located = await resolveSearchPoint((input.near as string | undefined)?.trim(), ctx);
  if ("error" in located) return { output: located.error };

  let results;
  try {
    results = await geoapifySearchHotels(located.point);
  } catch (err) {
    return { output: `Live hotel search failed: ${err instanceof Error ? err.message : "unknown error"}.` };
  }

  await postActionCard({
    tripId: ctx.trip.id,
    ...cardChannel(ctx),
    type: "PLACES",
    status: "CONFIRMED",
    data: {
      title: `Hotels near ${located.label}`,
      context: "Real names and locations only — live room rates/availability aren't connected yet.",
      places: results.map((r) => ({
        name: r.name,
        formattedAddress: r.formattedAddress,
        distanceMeters: r.distanceMeters,
        latitude: r.latitude,
        longitude: r.longitude,
      })),
      provider: results[0]?.provider,
      retrievedAt: results[0]?.retrievedAt,
    },
  });

  if (results.length === 0) {
    return { output: `No hotels found near ${located.label}.`, posted: true };
  }
  return {
    output: `Found ${results.length} real hotel(s) near ${located.label} (source: Geoapify, just now) — names/locations only, no live pricing or availability.`,
    posted: true,
  };
}

async function searchNearbyTool(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  if (!isGeoapifyConfigured()) {
    return { output: "Live nearby search is temporarily unavailable." };
  }
  const category = (input.category as string)?.trim();
  if (!category || !(category in NEARBY_CATEGORIES)) {
    return { output: `Unrecognised place category "${category}".` };
  }

  const located = await resolveSearchPoint((input.near as string | undefined)?.trim(), ctx);
  if ("error" in located) return { output: located.error };

  let results;
  try {
    results = await geoapifySearchNearby(category, located.point);
  } catch (err) {
    return { output: `Live nearby search failed: ${err instanceof Error ? err.message : "unknown error"}.` };
  }

  await postActionCard({
    tripId: ctx.trip.id,
    ...cardChannel(ctx),
    type: "PLACES",
    status: "CONFIRMED",
    data: {
      title: `${category[0].toUpperCase()}${category.slice(1)} near ${located.label}`,
      places: results.map((r) => ({
        name: r.name,
        formattedAddress: r.formattedAddress,
        distanceMeters: r.distanceMeters,
        latitude: r.latitude,
        longitude: r.longitude,
      })),
      provider: results[0]?.provider,
      retrievedAt: results[0]?.retrievedAt,
    },
  });

  if (results.length === 0) {
    return { output: `No ${category} found near ${located.label}.`, posted: true };
  }
  return { output: `Found ${results.length} ${category}(s) near ${located.label} (source: Geoapify, just now).`, posted: true };
}

async function getRouteTool(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  if (!isGeoapifyConfigured()) {
    return { output: "Live routing is temporarily unavailable — I can't measure real distance/time right now." };
  }
  const fromText = (input.from as string)?.trim();
  const toText = (input.to as string)?.trim();
  const mode = ((input.mode as string) || "walk") as TravelMode;
  if (!fromText || !toText) {
    return { output: "Both a starting point and a destination are required to get a route." };
  }

  const cityPoint = await resolveTripCityPoint(ctx.trip);
  const from = await resolveTripLocationText(fromText, ctx.trip.id, cityPoint?.point);
  if (isResolveFailure(from)) return { output: from.error };
  const to = await resolveTripLocationText(toText, ctx.trip.id, cityPoint?.point);
  if (isResolveFailure(to)) return { output: to.error };

  let route;
  try {
    route = await geoapifyGetRoute(from.point, to.point, mode);
  } catch (err) {
    return { output: `Live routing failed: ${err instanceof Error ? err.message : "unknown error"}.` };
  }

  await postActionCard({
    tripId: ctx.trip.id,
    ...cardChannel(ctx),
    type: "ROUTE",
    status: "CONFIRMED",
    data: {
      title: `${from.label} → ${to.label}`,
      route: {
        mode,
        fromLabel: from.label,
        toLabel: to.label,
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        from: from.point,
        to: to.point,
        geometry: route.geometry,
      },
      provider: route.provider,
      retrievedAt: route.retrievedAt,
    },
  });

  const km = (route.distanceMeters / 1000).toFixed(1);
  const minutes = Math.round(route.durationSeconds / 60);
  return {
    output: `${from.label} to ${to.label} by ${mode}: ${km} km, about ${minutes} minutes (source: Geoapify, just now — no live traffic data).`,
    posted: true,
  };
}

async function getWeatherTool(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  const locationText = (input.location as string | undefined)?.trim();
  let point: LatLng;
  let label: string;

  if (locationText) {
    // Deliberately Geoapify-independent — weather only ever needs Open-Meteo.
    const resolved = await resolveWeatherLocation(locationText, ctx.trip.id);
    if (isResolveFailure(resolved)) return { output: resolved.error };
    point = resolved.point;
    label = resolved.label;
  } else {
    const cityPoint = await resolveTripCityPoint(ctx.trip);
    if (!cityPoint) return { output: "I don't know which destination to check weather for yet." };
    point = cityPoint.point;
    label = cityPoint.label;
  }

  let weather;
  try {
    weather = await fetchWeather(point);
  } catch (err) {
    return { output: `Live weather lookup failed: ${err instanceof Error ? err.message : "unknown error"}.` };
  }

  await postActionCard({
    tripId: ctx.trip.id,
    ...cardChannel(ctx),
    type: "WEATHER",
    status: "CONFIRMED",
    data: {
      title: `Weather in ${label}`,
      weather: { temperatureC: weather.temperatureC, forecast: weather.forecast },
      provider: weather.provider,
      retrievedAt: weather.retrievedAt,
    },
  });

  return { output: `${label}: ${Math.round(weather.temperatureC)}°C now (source: Open-Meteo, just now).`, posted: true };
}
