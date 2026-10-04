import { prisma } from "@/lib/prisma";
import { postActionCard } from "@/lib/action-cards";
import { mobilityProvider } from "@/lib/providers/mobility";
import { getOrganiserAuth, resolveRoute, isFailure } from "@/lib/transport";
import {
  searchNearby as geoapifySearchNearby,
  getRoute as geoapifyGetRoute,
  nearestMappedPlace,
  isGeoapifyConfigured,
  NEARBY_CATEGORIES,
  searchPlaceByText,
} from "@/lib/travel/geoapify-provider";
import { getWeather as fetchWeather } from "@/lib/travel/open-meteo-weather";
import {
  resolveTripCityPoint,
  tripAnchors,
  resolveTripLocationText,
  resolveWeatherLocation,
  isResolveFailure,
} from "@/lib/travel/resolve";
import { computeReadinessStatus, recordReadinessReminder, checkEscalationReadiness } from "@/lib/readiness";
import { performEscalation } from "@/lib/voice-escalation/perform-escalation";
import { createProposal } from "@/lib/proposals";
import { createExpense } from "@/lib/budget/ledger";
import { formatMoney, parseMajorToMinor, isCategory, CATEGORY_LABEL } from "@/lib/budget/money";
import { applyRouteChange, type RouteOp } from "@/lib/trip-route";
import { recomputeTravellerReadiness } from "@/lib/readiness-engine";
import { hotelProvider } from "@/lib/travel/hotel-provider";
import { checkRoutePlausibility } from "@/lib/location/plausibility";
import { updateMyArrival } from "@/lib/traveller/arrival";
import { ceilToQuarter } from "@/lib/traveller/arrival-rules";
import { buildRendezvousView, appliesTo } from "@/lib/rendezvous";
import { timeLabel } from "@/lib/traveller/journey";
import { brandSearch, anchorsFor, orderCategories, ladderSearch } from "@/lib/travel/around";
import { freeTimeOptions } from "@/lib/travel/window";
import { doesThisFit } from "@/lib/travel/fit";
import { resolvedMoment } from "@/lib/dates";
import { handoffs, connectedFor } from "@/lib/travel-inventory/providers";
import { rupeesToPaise, PINE_MIN_MINOR } from "@/lib/payments/amount";
import { computeObligations } from "@/lib/payments/obligations-math";
import { driveRoute } from "@/lib/travel/route-provider";
import { getPrefs } from "@/lib/traveller/vibe";
import { savedOverlaps, savedByEveryone } from "@/lib/travel/saved-overlap";
import { tripWindow } from "@/lib/stays";
import { recordPersonalConstraint, checkFeasibility, parseHHMM, groupSafeLine, type ConstraintKind } from "@/lib/personal-state";
import { createCommitmentChecked, moveCommitmentChecked, cancelCommitmentChecked, buildPlanCtx } from "@/lib/plan/apply";
import { matchCommitment } from "@/lib/plan/parse";
import { parseDay, parseTime, localNow, stripMatched } from "@/lib/when";
import { recordPointer, rememberDiet } from "@/lib/pointers/store";
import { validateModelPointer } from "@/lib/pointers/extract";
import { statedAmounts } from "@/lib/private-tell";
import { groundedTitle } from "@/lib/budget/titles";
import { buildIdea, tripDayWindow } from "@/lib/ideas";
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
        purpose: { type: "string", description: "What this payment is for, e.g. 'the hotel'" },
      },
      required: ["payerName", "amount", "currency", "purpose"],
    },
  },
  {
    name: "create_commitment",
    description:
      "Add a shared or personal plan item to the Plan (dinner, a visit, coffee). The day and time are read in CODE from the words you pass, so pass them as the traveller said them: day = 'tomorrow' / 'saturday' / '12 Dec' / '2026-12-12', time = '8 PM' / '20:00' / '5'. Do NOT compute a date yourself. The result states what was actually saved and read back from the database; speak only from it. If it reports it could not update the Plan, say so — never say it was added.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short title, e.g. 'Birthday dinner'" },
        day: { type: "string", description: "The day as said: 'tomorrow', 'saturday', '12 Dec', '2026-12-12'." },
        time: { type: "string", description: "The time as said: '8 PM', '20:00', 'at 5'." },
        location: { type: "string", description: "Where, if stated" },
        participantNames: { type: "array", items: { type: "string" }, description: "Only if the plan is for specific people ('Ridhima and I'); omit for a plan for the whole group." },
      },
      required: ["name", "day", "time"],
    },
  },
  {
    name: "move_commitment",
    description:
      "Change the time (and/or day) of a plan item that is already in the Plan: 'move birthday dinner to 10', 'let's do dinner at 9 instead'. The tool applies it only if the speaker has the authority (the organiser, or their own personal item); otherwise it opens a group proposal and the Plan stays unchanged. Speak ONLY from its result.",
    parameters: {
      type: "object",
      properties: {
        commitmentName: { type: "string", description: "Which plan item, as the traveller named it" },
        newTime: { type: "string", description: "New time as said: '10', '9 PM', '21:30'" },
        newDay: { type: "string", description: "Only if a different day was named" },
      },
      required: ["commitmentName", "newTime"],
    },
  },
  {
    name: "cancel_commitment",
    description: "Remove a plan item from the Plan: 'cancel tomorrow's breakfast'. Organiser (or the item's own owner) only; for a shared item anyone else triggers a group proposal instead. Speak ONLY from its result.",
    parameters: {
      type: "object",
      properties: { commitmentName: { type: "string", description: "Which plan item, as named, e.g. 'tomorrow's breakfast'" } },
      required: ["commitmentName"],
    },
  },
  {
    name: "note_trip_pointer",
    description:
      "QUIETLY remember something a traveller said about THEMSELVES or plainly wants, without replying: a diet ('I'm vegetarian'), something they want to do or eat ('I want dosa', 'Cubbon Park also pls'), something they love, a must-have ('X is non-negotiable'), or a window to keep free. This is memory only — it NEVER adds anything to the Plan. Do not use it for passing moods, jokes, or anything about another person. Do not infer anything that wasn't said.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["DIET", "LIKE", "WANT", "MUST", "AVOID", "WINDOW"] },
        subject: { type: "string", description: "The thing, lower case, e.g. 'dosa', 'cubbon park', 'vegetarian', 'saturday evening'" },
      },
      required: ["kind", "subject"],
    },
  },
  {
    name: "build_idea",
    description:
      "Connect what the group has said they want (picked-up pointers) with a real free stretch of the Plan and real provider places into ONE suggestion, posted as a 'CLOCKWISE HAS AN IDEA' card with PROPOSE TO GROUP / NOT NOW buttons. Use for 'what should we do Saturday afternoon?'. It changes nothing in the Plan and asks nobody to vote. Pass the day/part-of-day as said.",
    parameters: { type: "object", properties: { when: { type: "string", description: "e.g. 'Saturday afternoon'" } }, required: ["when"] },
  },
  {
    name: "find_places",
    description:
      "Find REAL places for a request in the traveller's own words — 'dosa places in Bengaluru', 'vegetarian dosa in Indiranagar', 'coffee near our hotel', 'things to do around Cubbon Park', 'shopping near where Ridhima lands'. Pass the request VERBATIM: the place, dish and anchor are read from it in code, and an explicit place in the words always wins. Posts a card of provider-sourced places. Prefer this over search_nearby for any place request.",
    parameters: { type: "object", properties: { request: { type: "string", description: "The traveller's request, verbatim" } }, required: ["request"] },
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
        amount: { type: "number", description: "The TOTAL to collect, in whole rupees (e.g. 3000 for ₹3,000), exactly as stated in the conversation, never estimated. Pass a plain number: no symbols." },
        currency: { type: "string", description: "ISO currency code, e.g. 'INR'. Defaults to INR if the conversation is in rupees and doesn't say." },
        summary: { type: "string", description: "One plain sentence explaining the proposal to the group" },
        participants: { type: "array", items: { type: "string" }, description: "Traveller names who pay. Omit for everyone on the trip. For a personal payment ('make a payment of ₹10', 'I'll pay ₹500') pass ONLY the speaker's name. Use first names exactly as on the roster." },
        exclude: { type: "array", items: { type: "string" }, description: "Travellers NOT included ('don't include Shreya')." },
        fixedAmounts: { type: "array", items: { type: "object", properties: { name: { type: "string" }, amount: { type: "number" } }, required: ["name", "amount"] }, description: "A stated fixed share in rupees ('₹500 from Eva and the rest between us' => [{name:'Eva',amount:500}]). Everyone else splits the remainder equally." },
        alreadyPaid: { type: "array", items: { type: "string" }, description: "Travellers who already paid outside Clockwise ('Arshia already paid')." },
      },
      required: ["purpose", "amount", "summary"],
    },
  },
  {
    name: "propose_expense",
    description:
      "Use when someone states that money was SPENT or PAID for the trip (\"I paid 6k for dinner, split between us\", \"Eva covered the cab, 800\"). It does NOT record anything: it posts a \"Clockwise caught that\" card the speaker confirms, so no one is ever silently given a debt. Only call it when an amount and what it was for are both stated — never guess an amount. By default the person speaking is the payer and everyone on the trip shares equally; only name participants if the message restricts it (\"just me and Eva\"). In a PRIVATE room the card stays private to the speaker. Never use this for a future cost or a proposed booking (use propose_payment_request).",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "What it was for, e.g. 'Dinner'" },
        amount: { type: "number", description: "Whole currency units exactly as stated (6k = 6000)" },
        currency: { type: "string", description: "ISO code; INR if rupees or unstated in an Indian-rupee conversation" },
        paidBy: { type: "string", description: "Traveller name who paid; omit if the speaker paid" },
        participants: { type: "array", items: { type: "string" }, description: "Traveller names sharing the cost; omit to split equally among everyone on the trip" },
        category: { type: "string", description: "STAYS, TRANSPORT, FOOD, ACTIVITIES, SHOPPING or OTHER" },
      },
      required: ["title", "amount"],
    },
  },
  {
    name: "update_my_arrival",
    description:
      "Use when the SPEAKER says THEIR OWN arrival at the destination has changed (\"my flight is delayed, I'll reach around 8:15\", \"we landed early\"). It updates only the speaker's own confirmed journey, recomputes everyone's clocks against the confirmed stay with provider routes, and returns which shared commitments are now at risk with a suggested time. Pass the new time in 24-hour HH:MM (convert yourself: 8:15 in the evening = 20:15). If it is unclear whether they mean morning or evening, or which day, DO NOT call this — ask ONE short question instead. Never use it for anyone but the speaker, and never to change a commitment.",
    parameters: {
      type: "object",
      properties: {
        arrivalTime: { type: "string", description: "New arrival time, 24-hour HH:MM" },
        arrivalDate: { type: "string", description: "YYYY-MM-DD, only if the day changed (e.g. a very late flight lands after midnight); omit to keep the current arrival day" },
      },
      required: ["arrivalTime"],
    },
  },
  {
    name: "propose_commitment_reschedule",
    description:
      "After update_my_arrival (or a delay report) shows a shared commitment is at risk, post a GROUP proposal to move that commitment to the suggested time. It does NOT move anything: members vote and the organiser confirms before the Plan changes. Use the time update_my_arrival suggested; the tool refuses a time that still leaves someone unable to make it. Never move a commitment any other way.",
    parameters: {
      type: "object",
      properties: {
        commitmentName: { type: "string", description: "The commitment's name as logged, e.g. 'Dinner'" },
        newTime: { type: "string", description: "New time, 24-hour HH:MM, same day as the commitment" },
      },
      required: ["commitmentName", "newTime"],
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
        query: { type: "string", description: "The place name to look up, e.g. 'Indiranagar'" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_hotels",
    description:
      "Read-only: find REAL places to stay near a place — posts a card of names/addresses/locations with Save and Propose buttons. There is NO price, rating or availability data; never state any. Use for 'where should we stay' / 'hotels in X' questions. Never name a hotel yourself.",
    parameters: {
      type: "object",
      properties: {
        near: {
          type: "string",
          description: "Area/landmark to search near, e.g. 'Indiranagar' or 'our hotel'; omit to use the trip's current destination",
        },
      },
    },
  },
  {
    name: "search_nearby",
    description:
      "Read-only: find real places of a given category near a location — e.g. 'coffee near us', 'pharmacy near the hotel', 'restaurants near Indiranagar'.",
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
          description: "A NAMED area or landmark to search near (e.g. 'Indiranagar'). Do not put 'me' or 'our hotel' here; use `anchor`. Omit only when the user named no place and no anchor applies (the card then says it is centred on the destination).",
        },
        anchor: {
          type: "string",
          enum: ["user_location", "hotel", "arrival"],
          description: "user_location = 'near me / what's open near me / pharmacy near me' (the traveller's CURRENT location, which Clockwise only has when they press USE MY LOCATION in Around You, so this never returns places). hotel = 'our hotel / around the hotel / near us / around us / pharmacy near us' (the group's CONFIRMED stay only; never substituted by the destination centre). arrival = 'near the airport/station' for the speaker's own confirmed arrival point.",
        },
        maxMinutes: {
          type: "number",
          description: "Set for 'within N minutes' requests ('coffee within 10 minutes', 'vegetarian food within a 15 minute walk'). Candidate places are routed on foot with Geoapify and only those whose real walking time is at most this many minutes are returned. Never convert distance to minutes yourself.",
        },
        brand: {
          type: "string",
          description: "A specific store or chain the user named (e.g. '7-Eleven'). Searches the provider's convenience stores and supermarkets for that name; if none match it returns the closest real alternatives. Never claim a brand exists nearby unless this returns it.",
        },
        diet: {
          type: "string",
          enum: ["vegetarian", "vegan", "halal"],
          description: "Set when the user asks for vegetarian/vegan/halal places — filters on the provider's own dietary tags. Without it, never describe results as vegetarian.",
        },
      },
      required: ["category"],
    },
  },
  {
    name: "free_time_options",
    description:
      "Read-only: 'what can we do in the next 90 minutes?', 'what can we do before dinner?', 'something to do while it rains'. Deterministically finds real places (Geoapify) that FIT the time window: real walking routes there and on to the next commitment, with rain from Open-Meteo steering toward indoor places. Gemini must not decide what fits; call this and report what it returns.",
    parameters: {
      type: "object",
      properties: {
        minutes: { type: "number", description: "The window in minutes if the user stated one (e.g. 90). Omit for 'before dinner' so the window runs to the next commitment." },
        anchor: { type: "string", enum: ["user_location", "hotel", "arrival", "destination"], description: "Where from. 'user_location' (near me) is not available in chat: it returns a prompt to use USE MY LOCATION. Default: hotel when there is a confirmed stay, else the destination (stated on the card)." },
      },
    },
  },
  {
    name: "travel_options",
    description:
      "Use when someone asks for TICKETS or how to get from A to B between cities ('get me tickets Delhi to Amritsar', 'flights Delhi to Amritsar on 12 Dec after 4', 'how do I get from the airport to Amritsar'). Clockwise has NO live fare, seat or timetable feed connected for flights, trains or buses yet, and never invents one. This tool posts honest handoff buttons to each mode's own booking page and returns the connected-provider status. If the user did not name a mode, it is deliberately ambiguous (an airport origin does not mean a flight): present FLIGHT · TRAIN · BUS and let them choose. Never state a price, timing, seat or availability.",
    parameters: {
      type: "object",
      properties: {
        origin: { type: "string", description: "Where from, as stated (e.g. 'Delhi', 'Indira Gandhi Airport')." },
        destination: { type: "string", description: "Where to (e.g. 'Amritsar')." },
        date: { type: "string", description: "YYYY-MM-DD if the user gave a clear date; omit otherwise. Never guess one." },
        mode: { type: "string", enum: ["flight", "train", "bus"], description: "Only if the user named a mode." },
      },
      required: ["origin", "destination"],
    },
  },
  {
    name: "does_this_fit",
    description:
      "Read-only: 'can we do Cubbon Park before dinner?', 'is Nandi Hills doable today?'. Decides, deterministically, whether ONE named real place fits before the traveller's next shared commitment: Delhivery drive time there and back (traffic-aware for the departure time), the area reachable in the time left (Delhivery IsoSuite), and a stated time-at-place assumption. Returns YES / TIGHT / NO with a leave-by time. Never judge this yourself and never name a leave-by time that this tool did not return.",
    parameters: {
      type: "object",
      properties: {
        placeName: { type: "string", description: "The place, as the user named it, e.g. 'Cubbon Park'." },
        category: { type: "string", enum: ["park", "attraction", "museum", "cafe", "restaurant", "shopping"], description: "What kind of place it is, for the time-at-place assumption. Default attraction." },
      },
      required: ["placeName"],
    },
  },
  {
    name: "find_saved_overlap",
    description:
      "Read-only: 'find somewhere all of us saved'. Looks at places travellers saved PRIVATELY in Around You and reports overlap as a COUNT only. In the group chat it returns only places EVERY traveller saved; never who saved what.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "arrival_to_stay",
    description:
      "Read-only: 'how long will Shreya take to reach our stay after she lands?'. Returns the traveller's confirmed arrival, the provider-measured arrival-point -> stay route (with which provider produced it), and the earliest realistic time they can be at the stay. Numbers come from the stored provider route; never estimate them yourself.",
    parameters: {
      type: "object",
      properties: { travellerName: { type: "string", description: "Which traveller. Omit for the person asking." } },
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

// finalReply: the exact, truthful sentence to send as Clockwise's answer when a state change was attempted (so a
// model can never claim success the database didn't confirm).
export type ToolExecutionResult = { output: string; posted?: boolean; finalReply?: string };

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
    case "move_commitment":
      return moveCommitmentTool(input, ctx);
    case "cancel_commitment":
      return cancelCommitmentTool(input, ctx);
    case "note_trip_pointer":
      return noteTripPointerTool(input, ctx);
    case "build_idea":
      return buildIdeaTool(input, ctx);
    case "find_places":
      return findPlacesTool(input, ctx);
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
    case "propose_expense":
      return proposeExpense(input, ctx);
    case "update_my_arrival":
      return updateMyArrivalTool(input, ctx);
    case "propose_commitment_reschedule":
      return proposeCommitmentReschedule(input, ctx);
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
    case "arrival_to_stay":
      return arrivalToStayTool(input, ctx);
    case "free_time_options":
      return freeTimeTool(input, ctx);
    case "does_this_fit":
      return doesThisFitTool(input, ctx);
    case "travel_options":
      return travelOptionsTool(input, ctx);
    case "find_saved_overlap":
      return findSavedOverlapTool(ctx);
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

const currencySymbol = (c: string) => (c === "INR" ? "₹" : c === "EUR" ? "€" : c === "USD" ? "$" : `${c} `);

async function preparePayment(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  const payerName = input.payerName as string;
  const payer = ctx.trip.members.find((m) => m.user.name.toLowerCase() === payerName?.toLowerCase());
  if (!payer) {
    return { output: `Could not find a traveller named "${payerName}" — ask for clarification.` };
  }

  const amountMinorChecked = rupeesToPaise(input.amount);
  if (amountMinorChecked == null) return { output: "I need a clear rupee amount (digits, at most two decimals) before preparing a payment. Ask for it; don't guess." };
  const amount = amountMinorChecked / 100;
  const currency = (input.currency as string) ?? "INR";
  const purpose = (input.purpose as string) ?? "a booking";

  const groupCard = await postActionCard({
    tripId: ctx.trip.id,
    channel: "GROUP",
    type: "BOOKING",
    status: "PENDING",
    data: {
      title: `${purpose} is ready to confirm.`,
      context: `${payer.user.name} has offered to pay for this booking.`,
      values: [{ label: "Total", value: `${currencySymbol(currency)}${amount}` }],
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
      title: `${purpose} — ${currencySymbol(currency)}${amount}`,
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

const lastHumanId = (ctx: AgentContext) => [...ctx.history].reverse().find((h) => !h.isClockwise)?.id ?? null;

async function createCommitment(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  const name = String(input.name ?? "").trim();
  const now = localNow();
  const win = await tripDayWindow(ctx.trip.id);
  let local: string | null = null;
  if (typeof input.targetTimeIso === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(input.targetTimeIso)) local = input.targetTimeIso.slice(0, 16);
  else {
    const day = parseDay(String(input.day ?? ""), now, win);
    const time = parseTime(String(input.time ?? ""), name);
    if (day && time) local = `${day.date}T${time.time}`;
  }
  if (!local) return { output: "I couldn't work out the exact day and time, so nothing was added. Ask for the day and time in one short question.", finalReply: "What day and time should I put that in the Plan for? I haven't added anything yet." };
  const participantNames = (input.participantNames as string[] | undefined) ?? [];
  const participantIds = participantNames.length ? resolveTravellerIds(participantNames, ctx) : null;
  const plan = await buildPlanCtx(ctx.trip.id, ctx.actingUserId);
  const r = await createCommitmentChecked({ tripId: ctx.trip.id, actorId: ctx.actingUserId, name: name.replace(/^./, (c) => c.toUpperCase()), local, location: String(input.location ?? "").trim() || plan.defaultLocation, participantIds: participantIds && participantIds.length ? participantIds : null, sourceMessageId: lastHumanId(ctx) });
  return { output: `${r.reply} (Verified by reading the saved row back. Say this and nothing different.)`, finalReply: r.reply };
}

async function moveCommitmentTool(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  const plan = await buildPlanCtx(ctx.trip.id, ctx.actingUserId);
  const { hit, candidates } = matchCommitment(String(input.commitmentName ?? ""), plan.commitments);
  if (!hit) {
    const reply = candidates.length > 1 ? `Which one should I move: ${candidates.map((c) => c.name).join(" or ")}?` : `I can't find "${String(input.commitmentName ?? "").trim()}" in the Plan, so nothing was changed.`;
    return { output: reply, finalReply: reply };
  }
  const day = input.newDay ? parseDay(String(input.newDay), plan.now, plan.window) : null;
  const rawTime = String(input.newTime ?? "");
  const time = parseTime(/^\d{1,2}([:.]\d{2})?$/.test(rawTime.trim()) ? `at ${rawTime.trim()}` : rawTime, hit.name);
  if (!time) return { output: "Couldn't read the new time.", finalReply: `What time should ${hit.name} move to? I haven't changed anything.` };
  const r = await moveCommitmentChecked({ tripId: ctx.trip.id, actorId: ctx.actingUserId, commitmentId: hit.id, local: `${day?.date ?? hit.target.slice(0, 10)}T${time.time}`, sourceMessageId: lastHumanId(ctx) });
  return { output: `${r.reply} (Verified. Say this and nothing different.)`, finalReply: r.reply };
}

async function cancelCommitmentTool(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  const plan = await buildPlanCtx(ctx.trip.id, ctx.actingUserId);
  const phrase = String(input.commitmentName ?? "");
  const day = parseDay(phrase, plan.now, plan.window);
  const { hit, candidates } = matchCommitment(stripMatched(phrase, day?.matched), plan.commitments, day?.date);
  if (!hit) {
    const reply = candidates.length > 1 ? `Which one should I cancel: ${candidates.map((c) => c.name).join(" or ")}?` : `I can't find "${phrase.trim()}" in the Plan, so nothing was cancelled.`;
    return { output: reply, finalReply: reply };
  }
  const r = await cancelCommitmentChecked({ tripId: ctx.trip.id, actorId: ctx.actingUserId, commitmentId: hit.id, sourceMessageId: lastHumanId(ctx) });
  return { output: `${r.reply} (Verified. Say this and nothing different.)`, finalReply: r.reply };
}

const POINTER_VERB: Record<string, string> = { DIET: "is", LIKE: "likes", WANT: "wants", MUST: "says a must:", AVOID: "isn't keen on", WINDOW: "wants to keep open:" };
async function noteTripPointerTool(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  if (ctx.mode !== "GROUP") return { output: "Pointers are only captured from the group room." };
  const kind = String(input.kind ?? "");
  const subject = String(input.subject ?? "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 60);
  if (!POINTER_VERB[kind] || !subject) return { output: "Not noted: need a kind and a subject." };
  // The model proposes, code decides: only what the speaker said about THEMSELVES is stored (see validateModelPointer).
  const spoken = [...ctx.history].reverse().find((h) => !h.isClockwise)?.content ?? "";
  const verdict = validateModelPointer(spoken, kind, subject, ctx.trip.members.filter((m) => m.userId !== ctx.actingUserId).map((m) => m.user.name.split(" ")[0]));
  if (!verdict.ok) return { output: `Not noted. ${verdict.reason} Do not reply to the group about it.` };
  const label = kind === "WANT" ? `wants ${subject}` : `${POINTER_VERB[kind]} ${subject}`;
  const r = await recordPointer({ tripId: ctx.trip.id, userId: ctx.actingUserId, messageId: lastHumanId(ctx), kind: kind as never, subject, label });
  if (kind === "DIET") await rememberDiet(ctx.trip.id, ctx.actingUserId, subject);
  return { output: `Noted quietly (${kind}: ${subject}). It is memory only and NOT in the Plan. Do not reply to the group about it.` };
}

async function buildIdeaTool(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  const out = await buildIdea({ tripId: ctx.trip.id, userId: ctx.actingUserId, when: String(input.when ?? "") });
  if (!out.ok) return { output: out.reason, finalReply: out.reason };
  const reply = `CLOCKWISE HAS AN IDEA ✦ ${out.card.title}. ${out.card.why} Want me to propose it to the group? Nothing changes in the Plan unless everyone's in.`;
  return { output: `Posted an idea card. ${reply}`, finalReply: reply, posted: true };
}

async function findPlacesTool(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  const { runPlaceRequest } = await import("./router");
  const request = String(input.request ?? "").trim();
  if (!request) return { output: "Need the request in the traveller's words." };
  const r = await runPlaceRequest(ctx, request, ctx.mode === "PRIVATE" ? "PRIVATE" : "GROUP");
  return { output: r.reply, finalReply: r.reply, posted: r.outcome.ok && r.outcome.places.length > 0 };
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
  params: { type: "ITINERARY_CHANGE" | "UBER_RIDE" | "BOOKING" | "OTHER"; title: string; summary: string; payload: Parameters<typeof createProposal>[0]["payload"] }
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

// A money statement heard in chat becomes a PROPOSED expense + a card the
// speaker confirms. Nothing touches balances (or anyone's obligations) until
// confirmation; amounts are taken verbatim, never estimated.
async function proposeExpense(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  const title = String(input.title ?? "").trim();
  const amountMinor = parseMajorToMinor(Number(input.amount));
  if (!title || amountMinor == null) return { output: "Need what it was for and a stated amount — ask the person, don't guess." };
  const currency = String(input.currency ?? "INR").toUpperCase().slice(0, 3);

  // The amount must be one the speaker actually WROTE in this message. "Pay her the remaining amount" states no
  // figure, so nothing is invented from earlier chat; and the same payment is never proposed twice under a new title.
  const spoken = [...ctx.history].reverse().find((h) => !h.isClockwise)?.content ?? "";
  if (!statedAmounts(spoken).includes(amountMinor)) return { output: "Not recorded: that amount isn't in what they just said. Ask them for the amount; do not infer it from earlier messages." };

  const byName = (n: string) => ctx.trip.members.find((m) => m.user.name.toLowerCase().startsWith(n.trim().toLowerCase()));
  let payerId = ctx.actingUserId;
  if (typeof input.paidBy === "string" && input.paidBy.trim()) {
    const m = byName(input.paidBy);
    if (!m) return { output: `"${input.paidBy}" isn't on this trip's roster — not recorded.` };
    payerId = m.userId;
  }
  let participantIds = ctx.trip.members.map((m) => m.userId).filter((id) => id !== ctx.clockwiseUserId);
  if (Array.isArray(input.participants) && input.participants.length > 0) {
    const ids: string[] = [];
    for (const n of input.participants as string[]) {
      const m = byName(String(n));
      if (!m) return { output: `"${n}" isn't on this trip's roster — not recorded.` };
      ids.push(m.userId);
    }
    participantIds = [...new Set(ids)];
  }
  if (participantIds.length === 0) return { output: "Nobody to split with." };

  const sourceMessageId = [...ctx.history].reverse().find((h) => !h.isClockwise)?.id ?? null;
  const dup = await prisma.expense.findFirst({ where: { tripId: ctx.trip.id, amountMinor, paidByUserId: payerId, status: "PROPOSED", createdAt: { gt: new Date(Date.now() - 2 * 3600_000) } }, select: { id: true } });
  if (dup) return { output: "That expense was already caught a moment ago, so nothing new was added." };
  const category = typeof input.category === "string" && isCategory(input.category.toUpperCase()) ? (input.category.toUpperCase() as keyof typeof CATEGORY_LABEL) : undefined;
  const payerFirst = (ctx.trip.members.find((m) => m.userId === payerId)?.user.name ?? "someone").split(" ")[0];
  const named = groundedTitle(spoken, title, payerFirst);
  const created = await createExpense({
    tripId: ctx.trip.id,
    actorUserId: ctx.actingUserId,
    title: named.title,
    category,
    amountMinor,
    currency,
    stage: "PAID",
    status: "PROPOSED",
    paidByUserId: payerId,
    source: "CHAT",
    sourceReferenceId: sourceMessageId,
    splitMethod: "EQUAL",
    participants: participantIds.map((userId) => ({ userId })),
    idempotencyKey: sourceMessageId ? `chat:${sourceMessageId}:${named.title.toLowerCase()}:${amountMinor}` : null,
  });
  if (!created.ok) return { output: created.error };
  if (created.duplicate) return { output: "That expense was already caught from this message." };

  const nameOf = (id: string) => ctx.trip.members.find((m) => m.userId === id)?.user.name ?? "Someone";
  const each = Math.floor(amountMinor / participantIds.length);
  await postActionCard({
    tripId: ctx.trip.id,
    channel: ctx.mode === "PRIVATE" ? "PRIVATE" : "GROUP",
    recipientId: ctx.mode === "PRIVATE" ? ctx.actingUserId : undefined,
    type: "DECISION",
    status: "PENDING",
    data: {
      title: "Clockwise caught that ✦",
      context: `${nameOf(payerId)} paid ${formatMoney(amountMinor, currency)}${named.grounded ? ` for ${named.title}` : ""}, split ${participantIds.length} ways (about ${formatMoney(each, currency)} each).${named.grounded ? "" : " You didn't say what it was for, so it has no description yet: tap Edit to name it."} Nothing is added until it's confirmed.`,
      values: [
        { label: "Paid by", value: nameOf(payerId) },
        { label: "Split between", value: participantIds.map(nameOf).join(", ") },
      ],
      expenseId: created.expenseId,
      proposerId: ctx.actingUserId,
      payerId,
    },
  });
  return { output: `Posted a confirmation card for ${formatMoney(amountMinor, currency)} ${named.title}. Nothing is recorded until ${ctx.actingUserName} (or the payer) confirms it; say so in one short line.` };
}

// The speaker's OWN journey only: the acting user id comes from the session, never
// from a name in the model's arguments, so one traveller can't change another's.
async function updateMyArrivalTool(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  const { handleArrivalChange } = await import("@/lib/disruption");
  const r = await handleArrivalChange({
    tripId: ctx.trip.id,
    userId: ctx.actingUserId,
    arrivalTime: typeof input.arrivalTime === "string" ? input.arrivalTime : undefined,
    arrivalDate: typeof input.arrivalDate === "string" ? input.arrivalDate : undefined,
    sourceMessageId: [...ctx.history].reverse().find((h) => !h.isClockwise)?.id ?? null,
  });
  if (r.reply && !r.clashIds.length) return { output: `${r.reply} (Say this and nothing different.)`, finalReply: r.reply };
  return { output: r.clashIds.length ? "Updated the arrival, measured the route with the provider, found a clash and posted a 'Clockwise caught a clash' card with the options. Do not repeat the card in text; the group decides." : "Updated the arrival. No shared plan is affected. Reply with one very short confirmation or nothing." };
}

async function proposeCommitmentReschedule(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  const name = String(input.commitmentName ?? "").trim();
  const newTime = String(input.newTime ?? "").trim();
  if (!name || !/^([01]\d|2[0-3]):[0-5]\d$/.test(newTime)) return { output: "Need the commitment's name and the new time in 24-hour HH:MM." };
  const commitments = await prisma.commitment.findMany({ where: { tripId: ctx.trip.id, status: { not: "CANCELLED" } } });
  const c = commitments.find((x) => x.name.toLowerCase() === name.toLowerCase()) ?? commitments.find((x) => x.name.toLowerCase().includes(name.toLowerCase()));
  if (!c) return { output: `There's no logged commitment called "${name}", so there is nothing to reschedule.` };
  const oldTime = c.targetTime.toISOString().slice(0, 16);
  const newLocal = `${oldTime.slice(0, 10)}T${newTime}`;
  if (newLocal === oldTime) return { output: "That is the time it already has." };

  // Deterministic: the new time must actually resolve the clash for everyone we can measure.
  const view = await buildRendezvousView(ctx.trip.id);
  const applies = appliesTo(c.participantIds);
  const stillLate = view.clocks.filter((k) => applies(k.userId) && k.status === "KNOWN" && k.hotelBy! > newLocal);
  if (stillLate.length > 0) {
    const need = ceilToQuarter(stillLate.map((k) => k.hotelBy!).sort().at(-1)!);
    return { output: `Refused: at ${timeLabel(newLocal)} ${stillLate.map((k) => `${k.name} (at the stay by ${timeLabel(k.hotelBy!)})`).join(", ")} still couldn't make it. The earliest workable time is ${need.slice(11)} — propose that instead.` };
  }
  const late = view.commitments.find((x) => x.id === c.id)?.late ?? [];
  if (late.length === 0) return { output: `${c.name} isn't at risk for anyone right now, so I won't propose moving it.` };

  const open = await prisma.proposal.findMany({ where: { tripId: ctx.trip.id, type: "OTHER", status: { in: ["AWAITING_APPROVAL", "APPROVED"] } } });
  const dup = open.find((p) => {
    try {
      const r = (JSON.parse(p.payload) as { reschedule?: { commitmentId: string; newTime: string } }).reschedule;
      return r?.commitmentId === c.id && r.newTime === newLocal;
    } catch {
      return false;
    }
  });
  if (dup) return { output: "That reschedule is already waiting for the group's vote." };

  const because = late.map((l) => `${l.name}'s arrival means they can't be at the stay before ${timeLabel(l.hotelBy)}`).join("; ");
  const proposal = await postProposal(ctx, {
    type: "OTHER",
    title: `Move ${c.name} to ${timeLabel(newLocal)}?`,
    summary: `${because}, but ${c.name} is at ${timeLabel(oldTime)}. Moving it to ${timeLabel(newLocal)} lets everyone make it.`,
    payload: { timing: `${timeLabel(oldTime)} → ${timeLabel(newLocal)}`, reschedule: { commitmentId: c.id, commitmentName: c.name, oldTime, newTime: newLocal, because } },
  });
  await prisma.tripEvent.create({
    data: {
      tripId: ctx.trip.id,
      kind: "COMMITMENT_RESCHEDULE_PROPOSED",
      scope: "GROUP",
      actorUserId: ctx.actingUserId,
      sourceChannel: ctx.mode,
      sourceMessageId: [...ctx.history].reverse().find((h) => !h.isClockwise)?.id ?? null,
      confidence: "HIGH",
      payload: JSON.stringify({ commitment: c.name, commitmentId: c.id, oldTime, proposedTime: newLocal, because, proposalId: proposal.id }),
      propagation: JSON.stringify(["proposals", "notifications"]),
    },
  });
  return { output: `Posted a group proposal to move ${c.name} from ${timeLabel(oldTime)} to ${timeLabel(newLocal)}. Nothing changes until the group votes and the organiser confirms. Tell the group in one short line.` };
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
  // A request for information is never a decision. Enforced in code: "Clockwise
  // find hotels in Udaipur" once added Udaipur to the saved route.
  const lastHumanText = [...ctx.history].reverse().find((h) => !h.isClockwise)?.content ?? "";
  if (/^\s*@?(clockwise[,:]?\s*)?(please\s+)?(find|search|show|look|get|suggest|recommend|list|give|tell|how|what|where|which|can you|could you|any)\b/i.test(lastHumanText) || /\?\s*$/.test(lastHumanText)) {
    return { output: "Refused: that message is a request or a question, not a decision to change the route. Answer it (search/lookup tools) instead." };
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
  const currency = ((input.currency as string | undefined)?.trim() || "INR").toUpperCase();
  // The one conversion from rupees to the integer Pine Labs needs; a value that isn't a clean rupee amount is refused here, not later at the provider.
  const totalMinor = rupeesToPaise(input.amount);
  if (!purpose || !summary || totalMinor == null) {
    return { output: "Need a purpose, a clear rupee amount (digits only, at most two decimals) and a one-sentence summary to post a payment proposal. Ask the person for the amount; don't guess." };
  }
  if (currency !== "INR") return { output: "Collecting payments works in rupees only right now. Say so." };
  if (totalMinor < PINE_MIN_MINOR) return { output: "The smallest payment Pine Labs accepts is ₹1. Say so." };

  const roster = ctx.trip.members.filter((m) => m.userId !== ctx.clockwiseUserId).map((m) => ({ userId: m.userId, name: m.user.name }));
  const byName = (n: unknown) => {
    const q = String(n ?? "").trim().toLowerCase();
    if (!q) return null;
    if (/^(me|myself|i)$/.test(q)) return roster.find((r) => r.userId === ctx.actingUserId) ?? null;
    const exact = roster.filter((r) => r.name.toLowerCase() === q || r.name.split(" ")[0].toLowerCase() === q);
    return exact.length === 1 ? exact[0] : null;
  };
  const names = (arr: unknown): { ok: true; list: { userId: string; name: string }[] } | { ok: false; bad: string } => {
    const list: { userId: string; name: string }[] = [];
    for (const n of Array.isArray(arr) ? arr : []) {
      const hit = byName(n);
      if (!hit) return { ok: false, bad: String(n) };
      list.push(hit);
    }
    return { ok: true, list };
  };
  const inc = Array.isArray(input.participants) && input.participants.length ? names(input.participants) : { ok: true as const, list: roster };
  const exc = names(input.exclude);
  const paid = names(input.alreadyPaid);
  if (!inc.ok || !exc.ok || !paid.ok) return { output: `"${(!inc.ok ? inc.bad : !exc.ok ? exc.bad : (paid as { bad: string }).bad)}" doesn't match exactly one traveller on this trip. Ask who they mean; never pick for them.` };
  const people = inc.list.filter((p) => !exc.list.some((e) => e.userId === p.userId));
  const fixed: Record<string, number> = {};
  for (const f of Array.isArray(input.fixedAmounts) ? (input.fixedAmounts as { name?: unknown; amount?: unknown }[]) : []) {
    const who = byName(f.name);
    const minor = rupeesToPaise(f.amount);
    if (!who || minor == null) return { output: `I couldn't read the fixed amount for "${String(f.name)}". Ask for a clear name and rupee amount.` };
    fixed[who.userId] = minor;
  }
  const split = computeObligations({ totalMinor, people, fixed, alreadyPaid: paid.list.map((p) => p.userId) });
  if (!split.ok) return { output: `That split doesn't work: ${split.error} Tell the person plainly and ask how they'd like to split it.` };

  const rupees = (m: number) => `₹${(m / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  await postProposal(ctx, {
    type: "BOOKING",
    title: `Payment needed: ${purpose}`,
    summary: `${summary} Split: ${split.lines.map((l) => `${l.name.split(" ")[0]} ${rupees(l.amountMinor)}${l.alreadyPaid ? " (already paid)" : ""}`).join(", ")}. Total ${rupees(totalMinor)}.`,
    payload: { amount: totalMinor / 100, currency, split: { totalMinor, lines: split.lines } },
  });

  return {
    output: `Posted a payment proposal for ${rupees(totalMinor)} (${purpose}), split exactly: ${split.lines.map((l) => `${l.name.split(" ")[0]} ${rupees(l.amountMinor)}`).join(", ")}. The group sees the split BEFORE anything is created. Nothing is charged and no link exists until the organiser confirms (CREATE PAYMENT); then each person gets their own pay button. Tell them in one short line.`,
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
    return { output: "Live place search is temporarily unavailable — I can only reason from stored trip state right now. Do not name any places from memory." };
  }

  const resolved = await resolveTripLocationText(query, ctx.trip.id);
  if (isResolveFailure(resolved)) return { output: resolved.error };
  const results = [{ name: resolved.label.split(",")[0], formattedAddress: resolved.label, latitude: resolved.point.lat, longitude: resolved.point.lng, distanceMeters: null as number | null, provider: "geoapify", retrievedAt: new Date().toISOString(), providerId: "" }];

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

  await recordLookup(ctx, "PLACES_SEARCH_COMPLETED", { tool: "search_places", provider: "geoapify", retrievedAt: results[0].retrievedAt, near: query, resultCount: 1, anchor: "named place" });
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

// Provider-backed answers leave evidence in Agent Trace: which provider, when it
// was fetched, what was asked, how many results (or the measured numbers).
// Gemini only narrates these; it never supplies them.
async function recordLookup(ctx: AgentContext, kind: "PLACES_SEARCH_COMPLETED" | "ROUTE_COMPLETED" | "ROUTE_PLAUSIBILITY_FAILED" | "FIT_CHECKED", payload: Record<string, unknown>) {
  await prisma.tripEvent
    .create({
      data: {
        tripId: ctx.trip.id,
        kind,
        scope: ctx.mode === "PRIVATE" ? "PERSONAL" : "GROUP",
        actorUserId: ctx.actingUserId,
        subjectUserId: ctx.mode === "PRIVATE" ? ctx.actingUserId : null,
        sourceChannel: ctx.mode === "PRIVATE" ? "PRIVATE" : "GROUP",
        confidence: "HIGH",
        payload: JSON.stringify(payload),
        propagation: JSON.stringify(["chat-card"]),
      },
    })
    .catch(() => undefined);
}

async function searchHotelsTool(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  if (!hotelProvider.isConfigured()) {
    return { output: "Live stay search isn't connected in this environment yet, so I can't list real hotels. Don't name any hotels from memory." };
  }
  const located = await resolveSearchPoint((input.near as string | undefined)?.trim(), ctx);
  if ("error" in located) return { output: located.error };

  let results;
  try {
    results = await hotelProvider.search(located.point, { radiusMeters: 5000, limit: 8 });
  } catch (err) {
    return { output: `Live hotel search failed: ${err instanceof Error ? err.message : "unknown error"}.` };
  }
  const { dates, nights } = tripWindow(ctx.trip);

  await postActionCard({
    tripId: ctx.trip.id,
    ...cardChannel(ctx),
    type: "PLACES",
    status: "CONFIRMED",
    data: {
      title: `Stays near ${located.label}`,
      context: "Real places from Geoapify. Live rates and availability aren't connected — each stay says so.",
      stays: results,
      stayContext: { destination: located.label, dates, nights, travellers: ctx.trip.members.length },
      provider: results[0]?.provider,
      retrievedAt: results[0]?.retrievedAt,
    },
  });

  await recordLookup(ctx, "PLACES_SEARCH_COMPLETED", { tool: "search_hotels", provider: hotelProvider.name, retrievedAt: results[0]?.retrievedAt ?? new Date().toISOString(), near: located.label, point: located.point, resultCount: results.length, providerPlaceIds: results.map((r) => r.providerPlaceId), rates: "not connected" });
  if (results.length === 0) {
    return { output: `No stays found near ${located.label}.`, posted: true };
  }
  return {
    output: `Posted ${results.length} real stay(s) near ${located.label} (source: Geoapify, just now) as a card with Save / Propose buttons. Names and locations only — NO prices, ratings or availability exist; do not state any. Do not list them again in text; just say the card is above.`,
    posted: true,
  };
}

async function searchNearbyTool(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  if (!isGeoapifyConfigured()) {
    return { output: "Live nearby search is temporarily unavailable. Do not name any restaurants, places or travel times from memory — tell the user live search is not connected." };
  }
  const category = (input.category as string)?.trim();
  if (!category || !(category in NEARBY_CATEGORIES)) {
    return { output: `Unrecognised place category "${category}".` };
  }

  // Current location, confirmed stay and arrival point are DIFFERENT anchors; none stands in for another.
  const nearText = ((input.near as string | undefined) ?? "").trim();
  let anchorKind = (["user_location", "hotel", "arrival"] as const).find((a) => a === input.anchor);
  if (!anchorKind && /^(me|my location|where i am|here|near me|my place)$/i.test(nearText)) anchorKind = "user_location";
  if (!anchorKind && /^(our|the|my) (hotel|stay)$|^hotel$|^(us|around us|near us)$/i.test(nearText)) anchorKind = "hotel";
  if (anchorKind === "user_location") {
    return { output: `Clockwise can't see anyone's current location unless they press USE MY LOCATION themselves (the browser asks permission; it stays private to them). Do NOT search, name any place, or guess where they are. Say exactly: "I'd need your location for that. Open My Clockwise, then Around You, and tap USE MY LOCATION. It stays private to you. Or name a place or area and I'll search around that."` };
  }
  let located: { point: LatLng; label: string } | { error: string };
  if (anchorKind === "hotel" || anchorKind === "arrival") {
    const a = await anchorsFor(ctx.trip.id, ctx.actingUserId);
    const picked = anchorKind === "hotel" ? a.stay : a.arrival;
    located = picked ? { point: picked.point, label: picked.label } : { error: anchorKind === "hotel" ? "There's no confirmed stay yet, so there's no hotel to search around. Say so; do not search the destination centre instead unless the user asks for that." : "This traveller hasn't confirmed an arrival point yet. Say so and ask which airport or station, or offer the hotel." };
  } else {
    located = await resolveSearchPoint(nearText || undefined, ctx);
  }
  if ("error" in located) return { output: located.error };

  const brandText = typeof input.brand === "string" ? input.brand.trim().slice(0, 60) : "";
  if (brandText) {
    const b = await brandSearch(ctx.trip.id, brandText, { kind: "destination", label: located.label, point: located.point });
    if (!b.ok) return { output: b.error };
    await postActionCard({
      tripId: ctx.trip.id,
      ...cardChannel(ctx),
      type: "PLACES",
      status: "CONFIRMED",
      data: {
        title: b.found.length ? `${brandText} near ${located.label}` : `Convenience stores near ${located.label}`,
        context: b.note ?? "Matched by name in the provider's convenience-store and supermarket data. Being nearby doesn't mean a product is in stock.",
        places: b.places.map((r) => ({ name: r.name, formattedAddress: r.address, distanceMeters: r.distanceMeters, latitude: r.lat, longitude: r.lng })),
        provider: b.places[0]?.provider ?? "geoapify",
        retrievedAt: b.retrievedAt,
      },
    });
    await recordLookup(ctx, "PLACES_SEARCH_COMPLETED", { tool: "search_nearby", provider: "geoapify", retrievedAt: b.retrievedAt, category: "convenience+supermarket", brand: brandText, near: located.label, point: located.point, resultCount: b.places.length, matchedBrand: b.found.length > 0 });
    return {
      output: b.found.length
        ? `Found ${b.found.length} place(s) named like "${brandText}" in the provider's data near ${located.label}. The card shows them; don't list them again.`
        : `No place named "${brandText}" was found near ${located.label} in the provider's data. Say exactly: "I couldn't find a nearby ${brandText}, but here are the closest convenience stores." The card shows the real alternatives. Never imply the brand exists nearby.`,
      posted: true,
    };
  }

  const diet = (["vegetarian", "vegan", "halal"] as const).find((d) => d === input.diet);
  const maxMinutes = typeof input.maxMinutes === "number" && input.maxMinutes > 0 ? Math.min(60, Math.round(input.maxMinutes)) : null;
  let results;
  let widenedNote = "";
  let walkById = new Map<string, number>();
  try {
    if (maxMinutes) {
      results = await geoapifySearchNearby(category, located.point, Math.min(5000, Math.max(800, maxMinutes * 110)), 15, diet);
    } else {
      // Same widening as Around You: a city name must not return nothing just because the centre has few cafés within 1.5 km.
      const ladder = await ladderSearch(category, located.point, { diet, limit: 10 });
      results = ladder.raw;
      widenedNote = ladder.broadened || ladder.usedRadius > 1500 ? ` The search was widened to ${ladder.usedRadius / 1000} km${ladder.broadened ? " and to related place types" : ""} to find real places; say so briefly.` : "";
    }
    if (maxMinutes) {
      // Real routes, then filter on the provider's own duration; no straight-line conversion.
      const timed = await Promise.all(
        results.slice(0, 12).map(async (r) => {
          try {
            const rt = await geoapifyGetRoute(located.point, { lat: r.latitude, lng: r.longitude }, "walk");
            return [r, Math.max(1, Math.round(rt.durationSeconds / 60))] as const;
          } catch {
            return [r, null] as const;
          }
        })
      );
      const fit = timed.filter(([, m]) => m != null && m <= maxMinutes).sort((a, b) => a[1]! - b[1]!);
      walkById = new Map(fit.map(([r, m]) => [r.providerId, m!]));
      results = fit.map(([r]) => r);
    }
  } catch (err) {
    return { output: `Live nearby search failed: ${err instanceof Error ? err.message : "unknown error"}.` };
  }
  // A street-only POI with no name is real but not useful; drop those unless little else came back.
  const namedResults = results.filter((r) => r.name !== "Unnamed place");
  if (namedResults.length >= 3) results = namedResults;

  await postActionCard({
    tripId: ctx.trip.id,
    ...cardChannel(ctx),
    type: "PLACES",
    status: "CONFIRMED",
    data: {
      title: `${category[0].toUpperCase()}${category.slice(1)} ${maxMinutes ? `within ${maxMinutes} min of` : "near"} ${located.label}`,
      context: diet
        ? `Found using Geoapify's ${diet} search. That is a provider filter, not a check of each place — individual menus aren't verified.`
        : "No dietary filter applied — nothing here is claimed to be vegetarian, vegan or halal.",
      places: results.map((r) => ({
        name: r.name,
        formattedAddress: r.formattedAddress,
        distanceMeters: r.distanceMeters,
        latitude: r.latitude,
        longitude: r.longitude,
        walkMinutes: walkById.get(r.providerId) ?? null,
      })),
      provider: results[0]?.provider,
      retrievedAt: results[0]?.retrievedAt,
    },
  });

  await recordLookup(ctx, "PLACES_SEARCH_COMPLETED", { tool: "search_nearby", provider: results[0]?.provider ?? "geoapify", retrievedAt: results[0]?.retrievedAt ?? new Date().toISOString(), category, diet: diet ?? null, near: located.label, point: located.point, resultCount: results.length, providerPlaceIds: results.map((r) => r.providerId) });
  if (results.length === 0) {
    return { output: maxMinutes ? `No ${category} within a ${maxMinutes}-minute walk of ${located.label} in the provider's data (real walking routes checked). Say so; offer a longer time. Never name one from memory.` : `No ${category} found near ${located.label}.`, posted: true };
  }
  return {
    output: `Found ${results.length} ${category}(s) near ${located.label} (source: Geoapify, just now)${diet ? `, found using the provider's ${diet} search — a filter only: do NOT say any individual place IS ${diet}, never infer it from names or cuisine, and say "found using Geoapify's ${diet} search"` : ". NOT filtered by diet — do not call any of them vegetarian/vegan/halal"}. The card shows them; don't list them again.${widenedNote}${diet ? ` Reply with this sentence only: "I ran Geoapify's ${diet} search near ${located.label} — the card shows what it returned." Do NOT call the places ${diet}, ${diet}-friendly or similar.` : ""}`,
    posted: true,
  };
}

async function findSavedOverlapTool(ctx: AgentContext): Promise<ToolExecutionResult> {
  // GROUP chat: only a place every member saved may be named (nothing is leaked by naming it).
  // PRIVATE chat: overlap of two or more including this traveller, as a count.
  if (ctx.mode === "GROUP") {
    const all = await savedByEveryone(ctx.trip.id);
    if (all.length === 0) return { output: "No place has been saved by every traveller yet. Say only that; do not hint at who saved anything or how many saved what." };
    return { output: `Places every traveller saved (provider ids from Geoapify): ${all.map((p) => `${p.name}${p.address ? ` (${p.address})` : ""}`).join("; ")}. Name them; say nothing about who saved them first or when.` };
  }
  const mine = await savedOverlaps(ctx.trip.id, ctx.actingUserId);
  if (mine.length === 0) return { output: "None of this traveller's saved places has been saved by anyone else yet. Do not say who else saved anything." };
  return { output: `Overlap with this traveller's own saves (counts only, never names of people): ${mine.map((o) => `${o.name} - ${o.count} of ${o.members} travellers saved it`).join("; ")}. Offer nothing about who. Proposing to the group isn't available yet.` };
}

async function freeTimeTool(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  if (!isGeoapifyConfigured()) return { output: "Live place search isn't connected, so I can't work out what fits. Do not name any places from memory." };
  if (input.anchor === "user_location") {
    return { output: `Clockwise can't see anyone's current location unless they press USE MY LOCATION. Say exactly: "I'd need your location for that. Open My Clockwise, then Around You, and tap USE MY LOCATION, then WHAT CAN I DO NOW? It stays private to you. Or I can work it out from your hotel or the destination."` };
  }
  const a = await anchorsFor(ctx.trip.id, ctx.actingUserId);
  const want = input.anchor === "arrival" ? a.arrival : input.anchor === "destination" ? a.destination : (a.stay ?? a.destination);
  if (!want) return { output: "There's no stay, arrival point or destination to measure from yet. Say so." };
  const prefs = await getPrefs(ctx.trip.id, ctx.actingUserId);
  const minutes = typeof input.minutes === "number" && input.minutes > 0 ? Math.round(input.minutes) : undefined;
  const r = await freeTimeOptions(ctx.trip.id, ctx.actingUserId, want, { minutes, categoryOrder: orderCategories(Object.keys(NEARBY_CATEGORIES), prefs), prefs: { energy: prefs.energy, nearby: prefs.nearby, food: prefs.food } });
  if (!r.ok) return { output: r.error };
  await postActionCard({
    tripId: ctx.trip.id,
    ...cardChannel(ctx),
    type: "PLACES",
    status: "CONFIRMED",
    data: {
      title: `YOU'VE GOT ${r.windowMinutes} MIN${r.rainyMode ? " · RAINY WINDOW" : ""}`,
      context: `From ${want.kind === "stay" ? "your hotel" : want.label}. Each place fits the window including the real walks. ${r.assumptions}`,
      places: r.options.map((o) => ({ name: o.place.name, formattedAddress: o.place.address, distanceMeters: o.place.distanceMeters, latitude: o.place.lat, longitude: o.place.lng, walkMinutes: o.walkToMin })),
      provider: "geoapify",
      retrievedAt: r.retrievedAt,
    },
  });
  await recordLookup(ctx, "PLACES_SEARCH_COMPLETED", { tool: "free_time_options", provider: "geoapify", weather: "open-meteo", retrievedAt: r.retrievedAt, category: "free-time", anchorType: want.kind, near: want.label, resultCount: r.options.length, windowMinutes: r.windowMinutes, rainyMode: r.rainyMode, considered: r.considered });
  if (r.options.length === 0) return { output: `Nothing real that I checked fits ${r.windowMinutes} minutes (${r.considered} places routed). Say so plainly and suggest a longer window. Never invent an option.`, posted: true };
  return {
    output: `Posted ${r.options.length} option(s) that fit a ${r.windowMinutes}-minute window${r.rainyMode ? " (rain likely, so indoor-type places only)" : ""}. Each includes real walking time there and onward. Say in ONE short line how long the window is and that the card shows what fits; do not list places or add any that are not on the card. Time at each place is an assumption; say so if asked.`,
    posted: true,
  };
}

async function travelOptionsTool(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  const origin = String(input.origin ?? "").trim().slice(0, 80);
  const destination = String(input.destination ?? "").trim().slice(0, 80);
  if (!origin || !destination) return { output: "Need where from and where to. Ask." };
  const date = typeof input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : null;
  const want = input.mode === "flight" || input.mode === "train" || input.mode === "bus" ? (input.mode === "train" ? "rail" : input.mode) : null;
  const all = handoffs({ origin, destination, date });
  const shown = want ? all.filter((h) => h.mode === want) : all;
  const live = (["flight", "rail", "bus"] as const).filter((m) => connectedFor(m).length > 0);
  await postActionCard({
    tripId: ctx.trip.id,
    ...cardChannel(ctx),
    type: "ROUTE",
    status: "CONFIRMED",
    data: {
      title: `${origin.toUpperCase()} → ${destination.toUpperCase()}`,
      context: `${want ? "" : "How do you want to get there? "}Clockwise has no live fares or timetables for this yet, so these open each provider's own booking page. You'll book there.`,
      values: date ? [{ label: "Date", value: resolvedMoment(`${date}T00:00`).split(" · ")[0] }] : [{ label: "Date", value: "Pick one when you search" }],
      links: shown.map((h) => ({ label: h.label, url: h.url, provider: h.provider })),
    },
  });
  await prisma.tripEvent.create({
    data: { tripId: ctx.trip.id, kind: "TRAVEL_BOOKING_HANDOFF", scope: ctx.mode === "PRIVATE" ? "PERSONAL" : "GROUP", actorUserId: ctx.actingUserId, subjectUserId: ctx.mode === "PRIVATE" ? ctx.actingUserId : null, sourceChannel: ctx.mode === "PRIVATE" ? "PRIVATE" : "GROUP", confidence: "HIGH", payload: JSON.stringify({ origin, destination, date, modes: shown.map((h) => h.provider), liveInventoryConnected: live, note: "no live fare/availability feed; handoff only" }), propagation: JSON.stringify(["chat-card"]) },
  }).catch(() => undefined);
  return {
    output: `Posted ${shown.length} handoff button(s) for ${origin} → ${destination}${date ? ` on ${date}` : ""}. NO live prices, timings or seat availability are connected for ${live.length ? "the other modes" : "flights, trains or buses"}, so state none. ${want ? "" : "Say in ONE line that it depends on whether they want to fly, take the train or the bus, and that the buttons open each booking page. "}Never say "check another provider" as a dismissal: the buttons are the next step. Do not claim you searched or booked anything.`,
    posted: true,
  };
}

async function doesThisFitTool(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  const name = String(input.placeName ?? "").trim();
  if (!name) return { output: "Need the place's name." };
  const a = await anchorsFor(ctx.trip.id, ctx.actingUserId);
  const origin = a.stay ?? a.destination;
  if (!origin) return { output: "There's no stay or destination to measure from yet. Say so." };
  const found = await searchPlaceByText(name, origin.point).catch(() => []);
  if (!found[0]) return { output: `I couldn't find "${name}" on the map, so I can't say whether it fits. Say so; don't guess.` };
  const place = found[0];
  const kind = typeof input.category === "string" ? input.category : "attraction";
  const r = await doesThisFit({ tripId: ctx.trip.id, userId: ctx.actingUserId, place: { name: place.name, lat: place.latitude, lng: place.longitude }, kind, origin: { label: origin.kind === "stay" ? "the hotel" : origin.label, point: origin.point } });
  if (!r.ok) return { output: r.error };
  await recordLookup(ctx, "FIT_CHECKED", { place: r.place, verdict: r.verdict, routeProvider: r.routeProvider, reachChecked: r.reach.checked, reachInside: r.reach.inside, reachProvider: r.reach.provider, toMin: r.toMin, onMin: r.onMin, spareMin: r.spareMin, commitment: r.commitment?.name ?? null, whatIf: r.whatIf, evidenceIds: r.evidenceIds, tool: "does_this_fit" });
  const t12 = (l: string) => timeLabel(l);
  return {
    output: `${r.verdict} for ${r.place}${r.commitment ? ` before ${r.commitment.name} at ${t12(r.commitment.targetLocal)}` : ""}. ${r.reason} ${r.toMin != null ? `${r.toMin} min there from ${r.originLabel}${r.onMin != null ? `, ${r.onMin} min back` : ""}. ` : ""}${r.verdict !== "NO" && r.leaveByLocal ? `Leave by ${t12(r.leaveByLocal)}. ` : ""}${r.reach.checked ? `IsoSuite: ${r.reach.inside ? "inside" : "outside"} the ${r.reach.budgetMin}-minute reach. ` : ""}${r.whatIf ? `This is a what-if for setting off at ${t12(r.leaveLocal)}, because the next plan is far off; say so. ` : ""}Basis: ${r.basis.join(" ")} Report this in two short sentences; use only these numbers.`,
  };
}

async function arrivalToStayTool(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  const named = typeof input.travellerName === "string" ? input.travellerName.trim().toLowerCase() : "";
  const view = await buildRendezvousView(ctx.trip.id);
  const clock = named ? view.clocks.find((c) => c.name.toLowerCase() === named || c.name.toLowerCase().startsWith(named)) : view.clocks.find((c) => c.userId === ctx.actingUserId);
  if (!clock) return { output: named ? `${input.travellerName} hasn't confirmed a journey, so there's no arrival to measure from. Say so.` : "You haven't confirmed a journey yet. Say so." };
  if (clock.status !== "KNOWN") return { output: `No stay-time yet for ${clock.name}: ${clock.status === "NO_STAY" ? "the group has no confirmed stay" : clock.status === "NO_ROUTE" ? "no provider route has been measured yet" : clock.status === "NO_ARRIVAL_POINT" ? "their arrival point isn't resolved" : "no arrival time"}. Say exactly that; do not estimate.` };
  const provider = clock.routeProvider === "delhivery" ? "Delhivery Maps (a traffic-aware, hour-of-day estimate for the time they would leave the airport, not live traffic)" : clock.routeProvider === "geoapify" ? "Geoapify (a free-flow driving route, no traffic model)" : "the route provider";
  return {
    output: `${clock.name} lands at ${clock.arrivalPlace ?? "their arrival point"} at ${timeLabel(clock.arriveLocal)}. ${provider} measures ${clock.routeKm} km, about ${clock.routeMinutes} minutes to ${view.stayName}. With a 15-minute allowance for bags and exits, the earliest realistic time at the stay is ${timeLabel(clock.hotelBy)}. State these numbers and the provider's own basis in one or two sentences; do not call it live traffic.`,
  };
}

async function getRouteTool(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolExecutionResult> {
  if (!isGeoapifyConfigured()) {
    return { output: "Live routing is temporarily unavailable — I can't measure real distance/time right now. Do not estimate any travel time or distance." };
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
  let fromUsed = from;
  let toUsed = to;
  const snapNotes: string[] = [];
  try {
    if (mode === "drive") {
      // India drives are measured by Delhivery Maps when available (stated on the card); elsewhere Geoapify.
      const d = await driveRoute(from.point, to.point, { decision: "Route question asked in chat", tripId: ctx.trip.id, userId: ctx.actingUserId });
      route = { mode, distanceMeters: d.distanceMeters, durationSeconds: d.durationSeconds, provider: d.provider, retrievedAt: d.retrievedAt };
      if (d.provider === "delhivery") snapNotes.push(d.basis);
    } else {
      route = await geoapifyGetRoute(from.point, to.point, mode);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    // The router rejected a raw point (typically the centre of a lake, park or
    // water body). Retry from the closest mapped place and say so plainly.
    if (!msg.includes("(400)")) return { output: `Live routing failed: ${msg}.` };
    const [snapFrom, snapTo] = await Promise.all([nearestMappedPlace(from.point, 300), nearestMappedPlace(to.point, 300)]);
    if (!snapFrom && !snapTo) return { output: `Live routing failed: ${msg}. Do not estimate the time yourself.` };
    if (snapFrom) {
      fromUsed = { point: snapFrom.point, label: from.label };
      snapNotes.push(`start measured from the nearest mapped place, ${snapFrom.name}`);
    }
    if (snapTo) {
      toUsed = { point: snapTo.point, label: to.label };
      snapNotes.push(`end measured to the nearest mapped place, ${snapTo.name}`);
    }
    try {
      route = await geoapifyGetRoute(fromUsed.point, toUsed.point, mode);
    } catch (err2) {
      return { output: `Live routing failed: ${err2 instanceof Error ? err2.message : "unknown error"}. Do not estimate the time yourself.` };
    }
  }

  // Deterministic sanity check BEFORE anything is shown: the guard never invents a
  // replacement number, it only withholds a route whose endpoints can't be right.
  const anchors = await tripAnchors(ctx.trip.id);
  const plausibility = checkRoutePlausibility({ from: { label: from.label, point: fromUsed.point }, to: { label: to.label, point: toUsed.point }, distanceMeters: route.distanceMeters, anchors });
  if (!plausibility.ok) {
    await recordLookup(ctx, "ROUTE_PLAUSIBILITY_FAILED", { tool: "get_route", provider: route.provider, retrievedAt: route.retrievedAt, from: from.label, to: to.label, reason: plausibility.reason, distanceMeters: route.distanceMeters });
    return {
      output: `Route withheld: ${plausibility.reason}. One of "${from.label}" / "${to.label}" probably resolved to the wrong place. Do NOT give a distance or time. Tell the user which two places were matched and ask them to confirm or name the right one.`,
    };
  }

  await postActionCard({
    tripId: ctx.trip.id,
    ...cardChannel(ctx),
    type: "ROUTE",
    status: "CONFIRMED",
    data: {
      title: `${from.label} → ${to.label}`,
      context: snapNotes.length ? `${snapNotes.join("; ")}.` : undefined,
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
  await recordLookup(ctx, "ROUTE_COMPLETED", { tool: "get_route", provider: route.provider, retrievedAt: route.retrievedAt, from: from.label, to: to.label, fromPoint: fromUsed.point, toPoint: toUsed.point, mode, distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds, snapped: snapNotes });
  return {
    output: `${from.label} to ${to.label} by ${mode}: ${km} km, about ${minutes} minutes (source: Geoapify, just now — no live traffic data).${snapNotes.length ? ` Note: ${snapNotes.join("; ")}. Say so.` : ""}`,
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
