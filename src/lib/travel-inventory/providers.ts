// TRAVEL INVENTORY: hotels, flights, rail and bus. The abstraction every live-inventory integration plugs into, and an
// honest statement of what is connected TODAY.
//
// Rules (never relaxed): prices and availability come from a provider response with its retrieval time, never from
// Gemini, a scrape, or a cache presented as live. A mode with no connected provider gets a legitimate HANDOFF to a
// booking site, labelled as one: Clockwise does not claim to have searched, priced or ticketed anything it didn't.
// Credentials are never invented; each provider names the env vars it would need.
export type Mode = "hotel" | "flight" | "rail" | "bus";
export type Capability = "search" | "livePrice" | "liveAvailability" | "booking" | "ticketIssuance";

export type InventoryProvider = {
  id: string;
  mode: Mode;
  name: string;
  // What the provider can do once connected (from its own documentation).
  caps: Record<Capability, boolean>;
  // Env vars that would connect it. Connected only if every one is set.
  credentialsRequired: string[];
  // Plain-words status in this deployment.
  note: string;
};

const none: Record<Capability, boolean> = { search: false, livePrice: false, liveAvailability: false, booking: false, ticketIssuance: false };

export const PROVIDERS: InventoryProvider[] = [
  { id: "expedia-rapid", mode: "hotel", name: "Expedia Rapid (Lodging)", caps: { search: true, livePrice: true, liveAvailability: true, booking: true, ticketIssuance: false }, credentialsRequired: ["EXPEDIA_RAPID_API_KEY", "EXPEDIA_RAPID_SECRET"], note: "Needs an Expedia Partner Solutions account. Shopping API returns live rooms, rates, fees and cancellation terms; Booking API reserves after a price check." },
  { id: "amadeus-hotels", mode: "hotel", name: "Amadeus Hotels", caps: { search: true, livePrice: true, liveAvailability: true, booking: true, ticketIssuance: false }, credentialsRequired: ["AMADEUS_CLIENT_ID", "AMADEUS_CLIENT_SECRET"], note: "Self-service test keys exist; production needs approval. Real-time hotel offers plus a Hotel Booking API." },
  { id: "amadeus-flights", mode: "flight", name: "Amadeus Flights", caps: { search: true, livePrice: true, liveAvailability: true, booking: true, ticketIssuance: false }, credentialsRequired: ["AMADEUS_CLIENT_ID", "AMADEUS_CLIENT_SECRET"], note: "Flight Offers Search → Price → Create Orders. Production ticketing may need an airline consolidator." },
  { id: "travelport", mode: "flight", name: "Travelport Flights", caps: { search: true, livePrice: true, liveAvailability: true, booking: true, ticketIssuance: true }, credentialsRequired: ["TRAVELPORT_CLIENT_ID", "TRAVELPORT_CLIENT_SECRET"], note: "Commercial agreement required. Supports search and the reservation + ticketing workflow." },
  { id: "irctc-partner", mode: "rail", name: "Indian Railways via an IRCTC-authorised provider", caps: none, credentialsRequired: ["RAIL_PARTNER_API_KEY"], note: "IRCTC operates through authorised principal service providers; no direct IRCTC endpoint is used or invented. Needs a commercial partnership." },
  { id: "redbus-partner", mode: "bus", name: "redBus (partner access)", caps: none, credentialsRequired: ["REDBUS_API_KEY"], note: "Bus inventory needs a partnership with redBus or another aggregator." },
];

export type ProviderStatus = InventoryProvider & { connected: boolean; missing: string[] };

export function providerStatuses(env: Record<string, string | undefined> = process.env): ProviderStatus[] {
  return PROVIDERS.map((p) => {
    const missing = p.credentialsRequired.filter((k) => !env[k]);
    return { ...p, connected: missing.length === 0, missing };
  });
}

export const connectedFor = (mode: Mode, env?: Record<string, string | undefined>) => providerStatuses(env).filter((p) => p.mode === mode && p.connected);

// ---- Honest handoffs ----------------------------------------------------------------------------------
export type Handoff = { mode: Mode; label: string; url: string; provider: string };
const slug = (s: string) => s.trim().toLowerCase().replace(/\bairport\b|\bjunction\b|\brailway station\b|\bstation\b|\bbus stand\b/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export function handoffs(p: { origin: string; destination: string; date?: string | null }): Handoff[] {
  const when = p.date ? ` on ${p.date}` : "";
  return [
    { mode: "flight", provider: "Google Flights", label: "Compare flights", url: `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${p.origin} to ${p.destination}${when}`)}` },
    { mode: "rail", provider: "IRCTC", label: "Search trains on IRCTC", url: "https://www.irctc.co.in/nget/train-search" },
    { mode: "bus", provider: "redBus", label: "Find buses on redBus", url: `https://www.redbus.in/bus-tickets/${slug(p.origin)}-to-${slug(p.destination)}` },
  ];
}
