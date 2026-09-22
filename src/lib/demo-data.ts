// Fixed demo trip constants. These describe the ONE Central Europe '26 trip
// used throughout Clockwise — names, dates, and route are not placeholders
// and should not be changed while building.

export const TRIP_NAME = "Central Europe '26";
export const CORE_START_DATE = "2026-12-12T00:00:00.000Z";
export const CORE_END_DATE = "2026-12-20T00:00:00.000Z";

// Clockwise is a real User row (not a TripMember) so agent-authored
// messages have a valid senderId to join against.
export const CLOCKWISE_SENDER_NAME = "Clockwise";

export const ROUTE: {
  name: string;
  country: string;
  order: number;
  startDate: string | null;
  endDate: string | null;
}[] = [
  { name: "Delhi", country: "India", order: 0, startDate: "2026-12-12", endDate: "2026-12-12" },
  { name: "Vienna", country: "Austria", order: 1, startDate: "2026-12-12", endDate: "2026-12-14" },
  { name: "Salzburg", country: "Austria", order: 2, startDate: "2026-12-14", endDate: "2026-12-15" },
  { name: "Hallstatt", country: "Austria", order: 3, startDate: "2026-12-15", endDate: "2026-12-17" },
  { name: "Budapest", country: "Hungary", order: 4, startDate: "2026-12-17", endDate: "2026-12-20" },
  { name: "Delhi", country: "India", order: 5, startDate: "2026-12-20", endDate: "2026-12-20" },
];

export type DemoTraveller = {
  name: string;
  departureCity: string;
  participationStart: string;
  participationEnd: string;
  role: "ORGANIZER" | "TRAVELLER";
};

export const TRAVELLERS: DemoTraveller[] = [
  {
    name: "Arshia",
    departureCity: "Delhi",
    participationStart: CORE_START_DATE,
    participationEnd: CORE_END_DATE,
    role: "ORGANIZER",
  },
  {
    // Late joiner — see spec §12. Joins the group directly in Vienna on 13 Dec.
    name: "Japnit",
    departureCity: "Delhi",
    participationStart: "2026-12-13T00:00:00.000Z",
    participationEnd: CORE_END_DATE,
    role: "TRAVELLER",
  },
  {
    name: "Mallika",
    departureCity: "Delhi",
    participationStart: CORE_START_DATE,
    participationEnd: CORE_END_DATE,
    role: "TRAVELLER",
  },
  {
    name: "Shreya",
    departureCity: "Delhi",
    participationStart: CORE_START_DATE,
    participationEnd: CORE_END_DATE,
    role: "TRAVELLER",
  },
  {
    name: "Tanya",
    departureCity: "Delhi",
    participationStart: CORE_START_DATE,
    participationEnd: CORE_END_DATE,
    role: "TRAVELLER",
  },
  {
    name: "Jasnoor",
    departureCity: "Delhi",
    participationStart: CORE_START_DATE,
    participationEnd: CORE_END_DATE,
    role: "TRAVELLER",
  },
  {
    name: "Harnoor",
    departureCity: "Delhi",
    participationStart: CORE_START_DATE,
    participationEnd: CORE_END_DATE,
    role: "TRAVELLER",
  },
];

// Rooming demo data — see spec §21. Editable, not a hard rule.
export const ROOM_PAIRS: [string, string][] = [
  ["Arshia", "Tanya"],
  ["Mallika", "Shreya"],
  ["Jasnoor", "Harnoor"],
];
export const SINGLE_ROOMS: string[] = ["Japnit"];

// Private budget demo data — see spec §14. Never surfaced to the group.
export const PRIVATE_BUDGETS: Record<string, number> = {
  Shreya: 160000, // INR, hard ceiling, AGENT_ONLY visibility
};

// Travel-document demo data — see spec §20. Static, no real verification.
export const DOCUMENT_STATUS: Record<
  string,
  { passportStatus: string; visaStatus: string }
> = {
  Arshia: { passportStatus: "VALID", visaStatus: "APPROVED" },
  Japnit: { passportStatus: "VALID", visaStatus: "APPROVED" },
  Mallika: { passportStatus: "VALID", visaStatus: "APPROVED" },
  Shreya: { passportStatus: "VALID", visaStatus: "APPROVED" },
  Tanya: { passportStatus: "VALID", visaStatus: "APPROVED" },
  Jasnoor: { passportStatus: "VALID", visaStatus: "APPROVED" },
  Harnoor: { passportStatus: "VALID", visaStatus: "PENDING" }, // makes group state "6/7 ready"
};

// The exact opening Trip Room exchange from spec §10 — preloaded so Trip
// Room has real conversational history the moment it opens. Ordered.
export const SEED_MESSAGES: { sender: string; content: string }[] = [
  { sender: "Arshia", content: "Guys what about Vienna, Salzburg, Hallstatt and Budapest?" },
  { sender: "Japnit", content: "Vienna and Budapest definitely." },
  { sender: "Mallika", content: "I really want to do Hallstatt." },
  { sender: "Shreya", content: "Works for me." },
  { sender: "Tanya", content: "I'm in." },
  { sender: "Jasnoor", content: "Can we do Salzburg too?" },
  { sender: "Harnoor", content: "Yes." },
  { sender: "Arshia", content: "Dinner at 8?" },
  { sender: "Mallika", content: "Yes. Leave at 7:15?" },
  { sender: "Shreya", content: "Works." },
  { sender: "Tanya", content: "Sounds good." },
  { sender: "Jasnoor", content: "In." },
  { sender: "Japnit", content: "Can we do 7:45 instead? Need a bit longer." },
  { sender: "Harnoor", content: "Same, I'll go with Japnit." },
  { sender: "Arshia", content: "I'll pay for the Vienna hotel, you can all settle up with me later." },
  { sender: "Mallika", content: "Sounds good, thank you!" },
  { sender: "Tanya", content: "Works for me." },
];

// Vienna hotel payment scenario — see spec correction on consequential
// authorisation routing to My Agent. Arshia offered to pay in the
// conversation above; the amount/room split is fixed demo data.
export const VIENNA_HOTEL_PAYER = "Arshia";
export const VIENNA_HOTEL_AMOUNT = 1840;
export const VIENNA_HOTEL_CURRENCY = "EUR";
export const VIENNA_HOTEL_ROOMS = 4;
export const VIENNA_HOTEL_NIGHTS = 2;

// The five who confirmed the 7:15 departure — Japnit and Harnoor opted for
// 30 minutes later. Deliberately a fixed roster for this demo scene rather
// than something parsed live from the messages above (that's Phase 4/6
// work) — this is the "Clockwise has already evaluated the known
// commitment" starting point the transport card builds from.
export const DINNER_DEPARTURE_TRAVELLERS = ["Arshia", "Mallika", "Shreya", "Tanya", "Jasnoor"];
