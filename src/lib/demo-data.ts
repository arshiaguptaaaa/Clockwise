// The canonical demo trip: four friends on a trip to Bengaluru. Names, dates and
// the first conversation are scenario background, not provider data. Everything
// that has to be TRUE about the world (the destination's coordinates, the stay,
// the airport, every route) is resolved from the real providers when the scenario
// is set up (src/lib/demo/bengaluru-scenario.ts), never written in here.

export const TRIP_NAME = "Bengaluru Girls Trip";
export const CORE_START_DATE = "2026-12-13T00:00:00.000Z";
export const CORE_END_DATE = "2026-12-15T00:00:00.000Z";

// Clockwise is a real User row (not a TripMember) so agent-authored
// messages have a valid senderId to join against.
export const CLOCKWISE_SENDER_NAME = "Clockwise";

export const DESTINATION = {
  name: "Bengaluru",
  displayName: "Bengaluru, Karnataka, India",
  country: "India",
  startDate: "2026-12-13",
  endDate: "2026-12-15",
} as const;

export type DemoTraveller = {
  name: string;
  departureCity: string;
  role: "ORGANIZER" | "TRAVELLER";
  // Scenario background: a flight landing at the destination's airport on 13 Dec (local time).
  arrivesLocal: string;
};

export const TRAVELLERS: DemoTraveller[] = [
  { name: "Arshia", departureCity: "Delhi", role: "ORGANIZER", arrivesLocal: "2026-12-13T14:45" },
  { name: "Shreya", departureCity: "Delhi", role: "TRAVELLER", arrivesLocal: "2026-12-13T17:30" },
  { name: "Harnoor", departureCity: "Delhi", role: "TRAVELLER", arrivesLocal: "2026-12-13T18:30" },
  { name: "Eva", departureCity: "Delhi", role: "TRAVELLER", arrivesLocal: "2026-12-13T16:15" },
];

// Rooming: two twin rooms. Editable, not a rule.
export const ROOM_PAIRS: [string, string][] = [
  ["Arshia", "Eva"],
  ["Shreya", "Harnoor"],
];

// The one shared commitment the whole story turns on (local wall clock).
export const DINNER = { name: "Dinner", localTime: "2026-12-13T20:00", location: "Indiranagar, Bengaluru" } as const;

// Where the stay is searched: a neighbourhood the provider resolves, then the
// provider's own accommodation results near it. Nothing here names a hotel.
export const STAY_NEIGHBOURHOOD = "Indiranagar, Bengaluru";

// PRIVATE Vibe Check answers (TravellerPreference, never shown to the group).
// Values are the option ids used by the Vibe Check questions.
export const VIBES: Record<string, { energy: string[]; nearby: string[]; pace: string; food?: string }> = {
  Arshia: { energy: ["FOOD", "PRETTY", "CAFES", "SHOPPING"], nearby: ["cafe", "shopping", "restaurant"], pace: "BALANCED", food: "VEGETARIAN" },
  Shreya: { energy: ["HIDDEN_GEMS", "NIGHTLIFE", "FOOD"], nearby: ["nightlife", "restaurant"], pace: "PACKED" },
  Harnoor: { energy: ["CAFES", "SHOPPING", "PRETTY", "SLOW_MORNINGS"], nearby: ["cafe", "shopping"], pace: "SLOW" },
  Eva: { energy: ["FOOD", "CLASSICS", "NATURE", "SHOPPING"], nearby: ["restaurant", "park", "attraction", "shopping"], pace: "BALANCED" },
};

// The opening Trip Room conversation. Ordered. No expense is pre-created: the
// "I paid ₹6,000 for dinner" message is typed live so Clockwise catches it.
export const SEED_MESSAGES: { sender: string; content: string }[] = [
  { sender: "Arshia", content: "Girls, Bengaluru 13 to 15 Dec?" },
  { sender: "Shreya", content: "Yes! Finally." },
  { sender: "Eva", content: "Count me in. I want good food and a bit of shopping." },
  { sender: "Harnoor", content: "I'm in. Can we please do a slow cafe morning at some point?" },
  { sender: "Arshia", content: "Dinner on the 13th at 8?" },
  { sender: "Shreya", content: "Works for me. I land around 5:30." },
  { sender: "Harnoor", content: "Works." },
  { sender: "Eva", content: "In." },
];
