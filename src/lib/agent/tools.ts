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
import { computeReadinessStatus, recordReadinessReminder, checkEscalationReadiness } from "@/lib/readiness";
import { performEscalation } from "@/lib/voice-escalation/perform-escalation";
import { createProposal } from "@/lib/proposals";
import { applyRouteChange, type RouteOp } from "@/lib/trip-route";
import { recomputeTravellerReadiness } from "@/lib/readiness-engine";
import { recordPersonalConstraint, checkFeasibility, parseHHMM, groupSafeLine, type ConstraintKind } from "@/lib/personal-state";
import { TripUnderstandingSchema, resolveDecisionFields, resolveAffectedUserIds } from "./decision-schema";
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
    name: "report_delay",
    description:
      "Record that the CURRENT traveller says they will be late (or no longer late) for a logged commitment — e.g. \"I'll be 20 minutes late\", \"running behind, flight landed late\". Deterministically recomputes their readiness and shows the group only a status (on track / at risk / late by ~N min), never the reason. Pass minutesLate=0 if they say they're no longer delayed. Do not use for anyone but the speaker.",
    parameters: {
      type: "object",
      properties: {
        minutesLate: { type: "number", description: "Minutes late versus the commitment time (0 clears a delay)" },
        commitmentName: { type: "string", description: "Which commitment; omit for the soonest upcoming one they are part of" },
      },
      required: ["minutesLate"],
    },
  },
  {
    name: "record_trip_understanding",
    description:
      "Record ONE piece of structured understanding from the conversation into persistent trip memory — this is how facts survive beyond the recent-message window, not a decision-making action itself. Call this whenever the conversation reveals something worth remembering, but classify it honestly by claimType: PREFERENCE (soft, flexible — 'anything under 30k works'), SOFT_CONSTRAINT (a real but negotiable limit), HARD_CONSTRAINT (a genuine blocker — 'I cannot leave before the 12th'), DECISION_CANDIDATE (multiple people appear to be converging, but nobody has explicitly confirmed — do NOT invent agreement that wasn't said), CONFIRMED_DECISION (the group has explicitly and unambiguously agreed), CONFLICT (two claims are in tension — record the tension, do not pick a winner), PARTICIPATION_CHANGE (someone's dates/availability changed after being established), BOOKING_INTENT (someone wants to book something, before it's group-ready). Never mark something CONFIRMED_DECISION from silence or from only one person speaking — silence is not consent, and the organiser does not automatically speak for the group.",
    parameters: {
      type: "object",
      properties: {
        claimType: {
          type: "string",
          enum: [
            "PREFERENCE",
            "SOFT_CONSTRAINT",
            "HARD_CONSTRAINT",
            "DECISION_CANDIDATE",
            "CONFIRMED_DECISION",
            "CONFLICT",
            "PARTICIPATION_CHANGE",
            "BOOKING_INTENT",
          ],
        },
        category: { type: "string", description: "What this is about, e.g. 'flight', 'hotel', 'dates', 'budget'" },
        value: { type: "string", description: "The actual content in plain language, e.g. 'Delhi to Bali, 10 Dec morning, ~₹28k/person'" },
        confidence: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
        affectedTravellerNames: {
          type: "array",
          items: { type: "string" },
          description:
            "Exact trip-roster names of EVERY traveller this specifically concerns. Be narrow, not generous: 'I can't leave before 5' concerns only the speaker — omit this field entirely rather than listing everyone. 'Vasudha and I will take a separate cab' concerns exactly those two. Only leave this empty for a DECISION_CANDIDATE/CONFIRMED_DECISION/CONFLICT that genuinely affects the whole group (e.g. the trip's core dates) — those default to everyone when omitted, every other claimType defaults to the speaker alone.",
        },
      },
      required: ["claimType", "category", "value", "confidence"],
    },
  },
  {
    name: "record_personal_constraint",
    description:
      "Record ONE scheduling limit that belongs to a single traveller, as structured state: that they must be back/finished by a time (LATEST_END, e.g. \"I have to be back by 10:30\") or can't start before a time (EARLIEST_START, e.g. \"I can't leave before 5\"). In a PRIVATE room it saves to that traveller's own private state — the group is never told it, or why; the group only ever sees a neutral sentence if and when a concrete plan time conflicts (see check_group_feasibility). In the GROUP room it records a limit someone stated openly (pass travellerName if it's about someone else; omit it when they're talking about themselves). Always convert the time to 24-hour HH:MM yourself (10:30 PM -> \"22:30\"). Use this instead of record_trip_understanding for any time-of-day limit. A newer limit of the same kind replaces the older one.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["LATEST_END", "EARLIEST_START"] },
        time: { type: "string", description: "24-hour HH:MM, e.g. '22:30'" },
        date: { type: "string", description: "ISO date (YYYY-MM-DD) if the limit is only for one day; omit if it applies every day" },
        travellerName: { type: "string", description: "GROUP room only: exact roster name of the traveller this is about, if not the speaker" },
        note: { type: "string", description: "Optional short private context in the traveller's own terms. Stored privately; never shown to the group." },
        confidence: { type: "string", enum: ["MEDIUM", "HIGH"] },
      },
      required: ["kind", "time", "confidence"],
    },
  },
  {
    name: "check_group_feasibility",
    description:
      "Deterministically check whether a specific time works for the travellers, using every traveller's recorded limits (including private ones) on the server. Returns ONLY neutral group-safe sentences like \"Eva is unavailable after 10:30 PM\" — never a reason, never a raw private value. Call this before proposing or agreeing a concrete time for something several people attend. A result of no conflicts only means no CONFLICTING limit is on record; say so, never claim everyone is free.",
    parameters: {
      type: "object",
      properties: {
        time: { type: "string", description: "24-hour HH:MM start time to check" },
        date: { type: "string", description: "ISO date YYYY-MM-DD if known" },
        durationMinutes: { type: "number", description: "How long it lasts, if known" },
      },
      required: ["time"],
    },
  },
  {
    name: "update_trip_route",
    description:
      "Change the trip's shared ROUTE — the ordered list of cities/regions the group travels through. Use this (not propose_itinerary_change) when the GROUP states, as a decided fact, that a city or region is added to, removed from, swapped in the route, or re-ordered within it: \"we'll go to Udaipur after Jaipur\" (ADD), \"let's drop Agra\" (REMOVE), \"do Goa before Mumbai\" (MOVE), \"actually let's do Udaipur instead\" / \"change Jaipur to Udaipur\" (REPLACE — ONE call, never ADD then REMOVE). It changes the real saved route immediately — the map, Plan and Itinerary all read it — so only call it for a clear, committed statement from a participant in Trip Room, never for a question (\"should we visit Udaipur?\"), a maybe/idea (\"might be cool to add Udaipur\"), or a specific activity/venue (use propose_itinerary_change for those). Not available in a private room: a private suggestion that needs the group's agreement goes through propose_itinerary_change instead. Do NOT also call record_trip_understanding for the same route change — this tool already records it.",
    parameters: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["ADD", "REMOVE", "MOVE", "REPLACE"] },
        place: {
          type: "string",
          description:
            "The city/region being added, removed or moved, as the group said it, e.g. 'Udaipur'. For REPLACE: the CURRENT stop being swapped out (e.g. 'Jaipur'); may be omitted only when the route has exactly one stop.",
        },
        replaceWith: { type: "string", description: "REPLACE only: the new city/region that takes its place, e.g. 'Udaipur'." },
        after: {
          type: "string",
          description: "ADD: which existing stop it comes after ('Jaipur'); omit to append at the end. MOVE: required — the stop it should come after.",
        },
        confidence: { type: "string", enum: ["MEDIUM", "HIGH"], description: "HIGH only if the speaker clearly stated it as decided. If you'd rate it LOW, don't call this tool — ask one short question instead." },
      },
      required: ["operation", "place", "confidence"],
    },
  },
  {
    name: "propose_itinerary_change",
    description:
      "Propose a specific place, venue or activity (e.g. a fort, restaurant, day trip) for the WHOLE GROUP to vote on — NOT a city-level change to the trip's route: when the group states that a city is added/removed/re-ordered, use update_trip_route instead. Propose adding or changing a stop for the group to vote on, in either GROUP or PRIVATE conversation — a private hint ('might be nice to see Salzburg') can still produce a group proposal. This does NOT change the Plan directly: it posts a group-visible proposal that travellers vote on and the organiser must explicitly hard-confirm before anything is added. Only call this for a genuinely concrete, specific idea the conversation is ready to consider — never for vague brainstorming ('somewhere fun?', 'maybe a beach?') and never twice for the same idea in one turn. If a specific time is mentioned or agreed (e.g. '9:30', 'morning', 'the 14th'), resolve it yourself into real ISO 8601 datetimes using the trip's actual core dates from the structured state above, and pass startTime/endTime — this is what lets a later correction ('actually make it 10 instead') update the SAME plan item instead of creating a duplicate, because execution matches on the place, not on wording.",
    parameters: {
      type: "object",
      properties: {
        destination: { type: "string", description: "The place name to add, e.g. 'Salzburg, Austria' — as specific as the conversation gave you" },
        timing: { type: "string", description: "Free-text display version of when, if mentioned, e.g. 'as a day trip on the 14th'" },
        startTime: { type: "string", description: "ISO 8601 datetime you resolved from timing + the trip's real core dates, e.g. '2026-12-14T09:30:00.000Z'. Omit if genuinely unknown — never guess a date the conversation didn't support." },
        endTime: { type: "string", description: "ISO 8601 datetime for when this ends, if known. Omit if unknown." },
        summary: { type: "string", description: "One plain sentence explaining the proposal to the group" },
      },
      required: ["destination", "summary"],
    },
  },
  {
    name: "propose_uber_ride",
    description:
      "Propose requesting a real Uber ride for the group, from either GROUP or PRIVATE conversation. This does NOT request a ride — it posts a group-visible proposal; only the organiser's explicit hard-confirmation actually requests a real (sandbox) Uber ride. Only call this when pickup, destination and who's going are all reasonably clear from the conversation.",
    parameters: {
      type: "object",
      properties: {
        pickup: { type: "string", description: "Where the ride starts, as specific as the conversation gave you" },
        destination: { type: "string", description: "Where the ride is going" },
        timing: { type: "string", description: "When, if mentioned" },
        peopleAffected: {
          type: "array",
          items: { type: "string" },
          description: "Traveller names taking this ride; omit if unclear",
        },
        summary: { type: "string", description: "One plain sentence explaining the proposal to the group" },
      },
      required: ["pickup", "destination", "summary"],
    },
  },
  {
    name: "propose_payment_request",
    description:
      "Propose that a real payment is needed to secure something for the trip (e.g. an activity deposit), from either GROUP or PRIVATE conversation. This does NOT create or send a payment link — it posts a group-visible proposal; only the organiser's explicit hard-confirmation actually creates a real Pine Labs payment link. Only call this when a concrete amount and what it's for are both clear from the conversation — never guess an amount that wasn't stated.",
    parameters: {
      type: "object",
      properties: {
        purpose: { type: "string", description: "What the payment is for, e.g. 'Sunset boat ride deposit'" },
        amount: { type: "number", description: "The amount in whole currency units (e.g. 6000 for ₹6,000) — exactly as stated in the conversation, never estimated" },
        currency: { type: "string", description: "ISO currency code, e.g. 'INR'. Defaults to INR if the conversation is in rupees and doesn't say." },
        summary: { type: "string", description: "One plain sentence explaining the proposal to the group" },
      },
      required: ["purpose", "amount", "summary"],
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
    name: "send_readiness_reminder",
    description:
      "Record that you're sending a low-friction nudge to a SPECIFIC traveller who hasn't checked in for a shared commitment (e.g. they haven't confirmed they're ready for departure, and it's getting close). Call this, then write the actual nudge yourself in your reply in the same friendly tone as the rest of this conversation (e.g. 'Arjun, alive? 👀 We leave in 30.') — this tool only logs that the reminder moment happened, it is not what the traveller sees. Use check_readiness first if you haven't already, to confirm this commitment is actually AT_RISK or MISSED — never nudge someone over nothing.",
    parameters: {
      type: "object",
      properties: {
        travellerName: { type: "string", description: "Exact trip-roster name of the traveller who hasn't checked in" },
        commitmentName: { type: "string", description: "Name of the commitment they haven't checked in for" },
      },
      required: ["travellerName", "commitmentName"],
    },
  },
  {
    name: "escalate_via_voice_call",
    description:
      "Independently decide to place a real outbound voice call (via Gnani) to a traveller who was already reminded (send_readiness_reminder) and has NOT responded or checked in since, when a shared commitment's hard deadline is genuinely at risk. This is YOUR decision to make from the evidence — never wait for a human to say 'call them'. It will be refused if no unacknowledged reminder is on record for this traveller, if they haven't opted into voice escalation, or if a call is already in progress. Only call this when escalation is genuinely warranted — not as a first response to silence.",
    parameters: {
      type: "object",
      properties: {
        travellerName: { type: "string", description: "Exact trip-roster name of the traveller to call" },
        commitmentName: { type: "string", description: "Name of the commitment this escalation is about" },
        reason: { type: "string", description: "One short phrase for the audit trail, e.g. 'no response 12 min after reminder, departure in 15'" },
      },
      required: ["travellerName", "commitmentName", "reason"],
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
    case "report_delay":
      return reportDelay(input, ctx);
    case "record_trip_understanding":
      return recordTripUnderstanding(input, ctx);
    case "update_trip_route":
      return updateTripRoute(input, ctx);
    case "record_personal_constraint":
      return recordPersonalConstraintTool(input, ctx);
    case "check_group_feasibility":
      return checkGroupFeasibilityTool(input, ctx);
    case "propose_payment_request":
      return proposePaymentRequest(input, ctx);
    case "propose_itinerary_change":
      return proposeItineraryChange(input, ctx);
    case "propose_uber_ride":
      return proposeUberRide(input, ctx);
    case "check_readiness":
      return checkReadiness(input, ctx);
    case "send_readiness_reminder":
      return sendReadinessReminder(input, ctx);
    case "escalate_via_voice_call":
      return escalateViaVoiceCall(input, ctx);
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

// A stated delay is just another readiness signal: it goes through the same
// deterministic engine a GPS fix does. The reason (if any) is never stored or
// passed on — the group-visible result is a status and a minute count.
async function reportDelay(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  const minutes = Number(input.minutesLate);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 24 * 60) {
    return { output: "Need minutesLate as a number of minutes (0 to clear a delay) — ask how late they expect to be." };
  }
  const name = (input.commitmentName as string | undefined)?.trim().toLowerCase();
  const sourceMessageId = [...ctx.history].reverse().find((h) => !h.isClockwise)?.id ?? null;
  const views = await recomputeTravellerReadiness(ctx.trip.id, ctx.actingUserId, {
    statedLateMinutes: Math.round(minutes),
    sourceChannel: ctx.mode === "PRIVATE" ? "PRIVATE" : "GROUP",
    sourceMessageId,
    actorUserId: ctx.actingUserId,
  });
  const picked = name ? views.filter((v) => v.commitmentName.toLowerCase().includes(name)) : views.slice(0, 1);
  if (picked.length === 0) {
    return { output: "No logged commitment includes this traveller, so there is nothing to attach the delay to — suggest logging the commitment first (create_commitment)." };
  }
  return {
    output:
      picked.map((v) => `${v.line} (${v.status}, confidence ${v.confidence}).`).join(" ") +
      (ctx.mode === "PRIVATE" ? " Only this status is visible to the group — not the reason." : ""),
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

// Real Zod validation, not just a JSON-schema hint the model might
// ignore — malformed args are rejected here, never partially applied.
// sourceMessageIds is derived from ctx.history's own real message ids
// (never asked of the model, so it can never hallucinate a source) —
// the last few turns of whichever conversation this tool was called
// from, which is genuinely what caused Clockwise to record this.
//
// CONFIRMED_DECISION previously used to be settable purely from the
// model's own self-reported "confidence: HIGH" — a real bug (fixed
// here, not just refactored): that let the LLM mark something
// consequential as approved with no actual group-agreement check
// behind it. CONFIRMED here still only means "this claim is on record
// as settled" for MEMORY purposes — it is NOT the same as, and never
// substitutes for, organiser hard-confirmation on a Proposal (Stage
// 2A/2B's own separate gate, untouched by this).
async function recordTripUnderstanding(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  const parsed = TripUnderstandingSchema.safeParse(input);
  if (!parsed.success) {
    return { output: `Couldn't record that — malformed input: ${parsed.error.issues.map((i) => i.message).join("; ")}` };
  }
  const { claimType, category, value, confidence, affectedTravellerNames } = parsed.data;
  const { type, status } = resolveDecisionFields(claimType);

  const sourceMessageIds = ctx.history
    .filter((h) => !h.isClockwise)
    .slice(-3)
    .map((h) => h.id);

  const affectedUserIds = resolveAffectedUserIds(
    claimType,
    affectedTravellerNames,
    ctx.actingUserId,
    ctx.trip.members
  );

  // A private room's understanding must never become a shared Decision row:
  // Decisions are read into the GROUP agent's context and listed on Agent
  // Trace for every member. Keep it as a PERSONAL event only its subject
  // can see, and let privateStateLines feed it back to that traveller's own
  // private agent.
  if (ctx.mode === "PRIVATE") {
    await prisma.tripEvent.create({
      data: {
        tripId: ctx.trip.id,
        kind: "PERSONAL_UNDERSTANDING",
        scope: "PERSONAL",
        actorUserId: ctx.actingUserId,
        subjectUserId: ctx.actingUserId,
        sourceChannel: "PRIVATE",
        sourceMessageId: sourceMessageIds[sourceMessageIds.length - 1] ?? null,
        confidence,
        payload: JSON.stringify({ claimType, category, value }),
        propagation: JSON.stringify([]),
      },
    });
    return { output: `Saved privately [${claimType}] ${category}: ${value}. This was NOT shared with the group.` };
  }

  await prisma.decision.create({
    data: {
      tripId: ctx.trip.id,
      type,
      value: `${category}: ${value}`,
      confidence,
      status,
      sourceMessageIds: JSON.stringify(sourceMessageIds),
      confirmedBy: status === "CONFIRMED" ? ctx.actingUserId : null,
      actorUserId: ctx.actingUserId,
      affectedUserIds: JSON.stringify(affectedUserIds),
    },
  });

  // The actual silent-understanding fix: previously, a claim could be
  // recorded (visible only on Agent Trace) with zero trace in the chat
  // the group actually reads. Only surfaces for GROUP-sourced claims
  // (the triggering message was already said in the open, so there is no
  // private cause being exposed — see PRIVATE's own handling below) and
  // only for claim types that represent an actual shift worth a human
  // noticing, never every minor preference, to avoid turning ordinary
  // chat into a stream of system cards.
  const GROUP_WORTH_SURFACING: typeof claimType[] = [
    "CONFIRMED_DECISION",
    "CONFLICT",
    "PARTICIPATION_CHANGE",
    "HARD_CONSTRAINT",
  ];
  if (ctx.mode === "GROUP" && GROUP_WORTH_SURFACING.includes(claimType)) {
    await postActionCard({
      tripId: ctx.trip.id,
      channel: "GROUP",
      type: "DECISION",
      status: "CONFIRMED",
      data: {
        title: "Clockwise updated the trip",
        context: value,
        informational: true,
      },
    });
  }
  // Deliberately NOT mirrored for PRIVATE-mode claims: the brief requires
  // the group to see EFFECT, not private CAUSE, and this tool only
  // records an understanding — it doesn't yet know what downstream effect
  // (if any) that understanding will have on the shared plan. Surfacing
  // something here would risk exposing that an unnamed traveller has a
  // private constraint without the actual plan-level consequence to show
  // for it. A real "private insight -> safe group effect" announcement
  // belongs on whatever deterministic step later acts on this decision
  // (e.g. a future readiness recalculation), not on the raw recording.

  return { output: `Recorded [${claimType}] ${category}: ${value}.` };
}

// The one place chat conversation (either channel) turns into a real
// Proposal — see src/lib/proposals.ts. Deliberately does NOT touch
// Destination/Booking itself: this only ever creates an
// AWAITING_APPROVAL proposal and posts the group-visible card:
// approvals and the organiser's hard-confirm (src/app/proposal-actions.ts,
// rendered by ProposalCard.tsx) are what can eventually make it real Plan
// state, never this tool call by itself.
// Shared by every propose_* tool: creates the Proposal, posts the
// announcing GROUP message, and links them via groupMessageId. The only
// place a group-visible proposal gets created from conversation.
async function postProposal(
  ctx: AgentContext,
  params: { type: "ITINERARY_CHANGE" | "UBER_RIDE" | "BOOKING"; title: string; summary: string; payload: Parameters<typeof createProposal>[0]["payload"] }
) {
  const proposal = await createProposal({
    tripId: ctx.trip.id,
    type: params.type,
    title: params.title,
    summary: params.summary,
    payload: params.payload,
    createdBy: ctx.clockwiseUserId,
  });

  const message = await prisma.message.create({
    data: {
      tripId: ctx.trip.id,
      senderId: ctx.clockwiseUserId,
      channel: "GROUP",
      content: `Proposal: ${proposal.title} — ${params.summary}`,
    },
  });
  await prisma.proposal.update({ where: { id: proposal.id }, data: { groupMessageId: message.id } });

  return proposal;
}

async function recordPersonalConstraintTool(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  const kind = input.kind === "LATEST_END" || input.kind === "EARLIEST_START" ? (input.kind as ConstraintKind) : null;
  const time = (input.time as string | undefined)?.trim();
  if (!kind || !time || parseHHMM(time) == null) {
    return { output: "Need a kind (LATEST_END or EARLIEST_START) and a 24-hour HH:MM time — convert it yourself (10:30 PM = 22:30) and try again." };
  }
  const dateRaw = (input.date as string | undefined)?.trim();
  const onDate = dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? new Date(`${dateRaw}T00:00:00.000Z`) : null;

  // The subject is always the person speaking in a private room; only in
  // the shared room (where it's already public) can it be about someone else.
  let subjectUserId = ctx.actingUserId;
  if (ctx.mode === "GROUP") {
    const named = (input.travellerName as string | undefined)?.trim();
    if (named) {
      const member = ctx.trip.members.find((m) => m.user.name.toLowerCase() === named.toLowerCase());
      if (!member) return { output: `"${named}" isn't on this trip's roster — not recorded.` };
      subjectUserId = member.userId;
    }
  }

  const sourceMessageId = [...ctx.history].reverse().find((h) => !h.isClockwise)?.id ?? null;
  const result = await recordPersonalConstraint({
    tripId: ctx.trip.id,
    subjectUserId,
    actorUserId: ctx.actingUserId,
    channel: ctx.mode === "PRIVATE" ? "PRIVATE" : "GROUP",
    kind,
    localTime: time,
    onDate,
    note: (input.note as string | undefined)?.trim() || null,
    sourceMessageId,
    confidence: input.confidence === "HIGH" ? "HIGH" : "MEDIUM",
  });
  if (!result.ok) return { output: result.error };

  const who = ctx.trip.members.find((m) => m.userId === subjectUserId)?.user.name ?? "That traveller";
  return {
    output:
      ctx.mode === "PRIVATE"
        ? `Saved privately for ${who}. The group has NOT been told${result.replacedPrevious ? " (this replaced their earlier limit)" : ""}. Do not repeat it in the group; it will only ever surface as a neutral line if a concrete plan time conflicts.`
        : `Recorded: ${groupSafeLine(who, kind, time)}${result.replacedPrevious ? " (replacing the earlier limit)" : ""}.`,
  };
}

async function checkGroupFeasibilityTool(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  const time = (input.time as string | undefined)?.trim();
  if (!time || parseHHMM(time) == null) return { output: "Need a 24-hour HH:MM time to check." };
  const dateRaw = (input.date as string | undefined)?.trim();
  const date = dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? new Date(`${dateRaw}T00:00:00.000Z`) : null;
  const duration = Number(input.durationMinutes);
  const result = await checkFeasibility(ctx.trip.id, time, date, Number.isFinite(duration) ? duration : 0);

  const basis = `Based only on limits travellers have told Clockwise (${result.withKnownLimits} of ${result.travellersChecked} have shared any).`;
  if (result.conflicts.length === 0) return { output: `No conflicting limit on record for ${time}. ${basis}` };
  return { output: `Conflicts at ${time}: ${result.conflicts.map((c) => c.line).join("; ")}. ${basis}` };
}

// Direct route mutation — see src/lib/trip-route.ts. GROUP-only on purpose:
// a private-room statement is private by default, and the existing privacy
// model routes anything that needs the group's agreement through a
// Proposal. Everything else about the change (provenance, what re-derived,
// the visible card) is recorded by applyRouteChange / below.
async function updateTripRoute(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  if (ctx.mode !== "GROUP") {
    return {
      output:
        "Refused: the shared route can only be changed from Trip Room, where the group can see it. If this came up privately and needs the group's agreement, use propose_itinerary_change.",
    };
  }
  const operation = input.operation;
  let place = (input.place as string | undefined)?.trim();
  const replaceWith = (input.replaceWith as string | undefined)?.trim();
  const after = (input.after as string | undefined)?.trim() || undefined;
  const confidence = input.confidence === "HIGH" ? "HIGH" : "MEDIUM";
  if (operation === "REPLACE" && !place && ctx.trip.destinations.length === 1) {
    place = ctx.trip.destinations[0].name;
  }
  if (!place || (operation !== "ADD" && operation !== "REMOVE" && operation !== "MOVE" && operation !== "REPLACE")) {
    return { output: "Need an operation (ADD, REMOVE, MOVE or REPLACE) and a place to change the route. If several stops are on the route and it's unclear which one is being replaced, ask which." };
  }
  if (operation === "REPLACE" && !replaceWith) {
    return { output: "To replace a stop I need to know what it's being replaced with." };
  }
  if (operation === "MOVE" && !after) {
    return { output: "To move a stop I need to know which stop it should come after." };
  }

  const change: RouteOp =
    operation === "ADD"
      ? { op: "ADD", place, after }
      : operation === "REMOVE"
        ? { op: "REMOVE", place }
        : operation === "REPLACE"
          ? { op: "REPLACE", place, with: replaceWith! }
          : { op: "MOVE", place, after: after! };

  const sourceMessageId = [...ctx.history].reverse().find((h) => !h.isClockwise)?.id ?? null;
  const result = await applyRouteChange(
    { tripId: ctx.trip.id, actorUserId: ctx.actingUserId, sourceChannel: "GROUP", sourceMessageId, confidence },
    change
  );
  if (!result.ok) return { output: result.error };

  if (result.changed) {
    await postActionCard({
      tripId: ctx.trip.id,
      channel: "GROUP",
      type: "DECISION",
      status: "CONFIRMED",
      data: {
        title: operation === "REPLACE" ? "Destination changed" : "Route updated",
        context: result.route.join(" → "),
        informational: true,
      },
    });
  }
  return { output: result.summary };
}

// Posts a BOOKING-type proposal carrying a real amount — the proposal/vote/
// organiser-hard-confirm pipeline it goes through is identical to every
// other proposal type; the only thing specific to payments happens later,
// in executeBooking (proposal-execution.ts), which routes an amount-
// bearing BOOKING proposal to createTripPaymentRequest (Pine Labs) instead
// of marking it confirmed outright. Gemini never creates or sees a
// payment link itself — it only ever proposes that one is needed.
async function proposePaymentRequest(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  const purpose = (input.purpose as string | undefined)?.trim();
  const summary = (input.summary as string | undefined)?.trim();
  const amount = Number(input.amount);
  const currency = (input.currency as string | undefined)?.trim() || "INR";

  if (!purpose || !summary || !Number.isFinite(amount) || amount <= 0) {
    return { output: "Need a purpose, a positive amount, and a one-sentence summary to post a payment proposal." };
  }

  await postProposal(ctx, {
    type: "BOOKING",
    title: `Payment needed: ${purpose}`,
    summary,
    payload: { amount, currency },
  });

  return {
    output: `Posted a payment proposal for ${currency} ${amount} (${purpose}) — travellers can discuss, and only the organiser's final confirmation actually creates a real payment link.`,
    posted: true,
  };
}

// A malformed/un-parseable datetime string from the model is dropped
// silently rather than failing the whole proposal — destination+summary
// are the actual required content; timing is a nice-to-have that's
// still useful as free text even when the ISO value didn't parse.
function parseIsoDatetime(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

async function proposeItineraryChange(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  const destination = (input.destination as string | undefined)?.trim();
  const summary = (input.summary as string | undefined)?.trim();
  const timing = (input.timing as string | undefined)?.trim();
  const startTime = parseIsoDatetime(input.startTime);
  const endTime = parseIsoDatetime(input.endTime);

  if (!destination || !summary) {
    return { output: "Need both a destination and a one-sentence summary to post this as a group proposal." };
  }

  await postProposal(ctx, {
    type: "ITINERARY_CHANGE",
    title: `Add ${destination}?`,
    summary,
    payload: {
      destination,
      timing,
      startTime: startTime?.toISOString(),
      endTime: endTime?.toISOString(),
    },
  });

  return {
    output: `Posted a group proposal to add ${destination}${timing ? ` (${timing})` : ""} — travellers can vote in Trip Room, and the organiser can give final confirmation once ready.`,
    posted: true,
  };
}

async function proposeUberRide(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  const pickup = (input.pickup as string | undefined)?.trim();
  const destination = (input.destination as string | undefined)?.trim();
  const summary = (input.summary as string | undefined)?.trim();
  const timing = (input.timing as string | undefined)?.trim();
  const peopleAffected = (input.peopleAffected as string[] | undefined)?.filter((n) => n?.trim());

  if (!pickup || !destination || !summary) {
    return { output: "Need a pickup, destination, and one-sentence summary to post this as a group proposal." };
  }

  await postProposal(ctx, {
    type: "UBER_RIDE",
    title: `Uber: ${pickup} → ${destination}?`,
    summary,
    payload: { pickup, destination, timing, peopleAffected },
  });

  return {
    output: `Posted a group proposal for an Uber from ${pickup} to ${destination} — travellers can vote, and only the organiser's final confirmation actually requests the (sandbox) ride.`,
    posted: true,
  };
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

function resolveTravellerByName(name: string, ctx: AgentContext) {
  return ctx.trip.members.find((m) => m.user.name.toLowerCase() === name.toLowerCase());
}

async function resolveCommitmentByName(name: string, tripId: string) {
  return prisma.commitment.findFirst({ where: { tripId, name: { contains: name } } });
}

// Deliberately does NOT write the reminder text itself — Gemini writes
// that in its own reply in the same conversational voice as everything
// else; this only creates the real, checkable record that a reminder
// moment occurred (see recordReadinessReminder / the REMINDED status
// EscalationEvent was always meant to have).
async function sendReadinessReminder(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  const travellerName = (input.travellerName as string | undefined)?.trim();
  const commitmentName = (input.commitmentName as string | undefined)?.trim();
  if (!travellerName || !commitmentName) {
    return { output: "Need both a traveller name and a commitment name to record a reminder." };
  }

  const traveller = resolveTravellerByName(travellerName, ctx);
  if (!traveller) {
    return { output: `"${travellerName}" doesn't match anyone on this trip — not recording a reminder.` };
  }
  const commitment = await resolveCommitmentByName(commitmentName, ctx.trip.id);
  if (!commitment) {
    return { output: `No commitment matching "${commitmentName}" was found — not recording a reminder.` };
  }

  await recordReadinessReminder(ctx.trip.id, commitment.id, traveller.userId);
  return { output: `Recorded a reminder to ${traveller.user.name} for "${commitment.name}". Write the actual nudge in your reply.` };
}

// The real gate against an arbitrary "Gemini decides to call someone":
// checkEscalationReadiness (readiness.ts) must find a genuine,
// unacknowledged reminder already on record, opted-in consent, and a
// phone number — all real rows, nothing taken on the model's word.
async function escalateViaVoiceCall(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  const travellerName = (input.travellerName as string | undefined)?.trim();
  const commitmentName = (input.commitmentName as string | undefined)?.trim();
  const reason = (input.reason as string | undefined)?.trim();
  if (!travellerName || !commitmentName || !reason) {
    return { output: "Need a traveller name, commitment name, and a reason to consider escalating." };
  }

  const traveller = resolveTravellerByName(travellerName, ctx);
  if (!traveller) {
    return { output: `"${travellerName}" doesn't match anyone on this trip — refusing to escalate.` };
  }
  const commitment = await resolveCommitmentByName(commitmentName, ctx.trip.id);
  if (!commitment) {
    return { output: `No commitment matching "${commitmentName}" was found — refusing to escalate.` };
  }

  const readiness = await checkEscalationReadiness(ctx.trip.id, commitment.id, traveller.userId);
  if (!readiness.ok) {
    return { output: `Not escalating: ${readiness.reason}` };
  }

  const result = await performEscalation(commitment.id, traveller.userId, {
    actorId: ctx.clockwiseUserId,
    source: "AGENT",
    reason,
  });

  if (!result.ok) {
    return { output: `Tried to call ${traveller.user.name} but it failed: ${result.error}` };
  }
  return {
    output:
      result.mode === "REAL"
        ? `Placed a real call to ${traveller.user.name} via Gnani.`
        : `Gnani isn't configured in this environment — simulated a demo escalation call to ${traveller.user.name} instead of a real one.`,
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
