// Opening-hours status from the PROVIDER's own string (OSM syntax, passed through by
// Geoapify). Nothing here invents hours: no string, or one that doesn't parse, is
// "unknown" and is shown as "Hours unavailable" / the raw text. Times are the place's
// local wall clock, passed in as a Z-convention Date (UTC fields = local clock), which
// is the same convention the rest of Clockwise uses for commitments. We read the
// UTC fields explicitly, so the server's own timezone never matters.
import OpeningHours from "opening_hours";

export type HoursStatus = { state: "open" | "closed" | "unknown"; until?: string; opensAt?: string };

const toFake = (d: Date) => new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

function parse(raw: string | null | undefined): OpeningHours | null {
  if (!raw || !raw.trim()) return null;
  try {
    const oh = new OpeningHours(raw);
    // Rules that depend on public holidays or sun events need data we don't have: treat as unknown.
    if (oh.getWarnings().length > 0 && /PH|SH|sunrise|sunset|week|easter/i.test(raw)) return null;
    return oh;
  } catch {
    return null;
  }
}

// Open at one instant? ("localZ" = the local wall clock in Z convention.)
export function hoursAt(raw: string | null | undefined, localZ: Date): HoursStatus {
  const oh = parse(raw);
  if (!oh) return { state: "unknown" };
  const at = toFake(localZ);
  const open = oh.getState(at);
  const next = oh.getNextChange(at);
  if (open) return { state: "open", until: next ? hhmm(next) : undefined };
  return { state: "closed", opensAt: next ? hhmm(next) : undefined };
}

// Open for the WHOLE visit [start, start+minutes]? Sampled every 10 minutes.
export function hoursCoverVisit(raw: string | null | undefined, startLocalZ: Date, minutes: number): HoursStatus {
  if (!parse(raw)) return { state: "unknown" };
  for (let m = 0; m <= minutes; m += 10) {
    const s = hoursAt(raw, new Date(startLocalZ.getTime() + m * 60000));
    if (s.state === "closed") return s;
  }
  const end = hoursAt(raw, new Date(startLocalZ.getTime() + minutes * 60000));
  return end.state === "unknown" ? end : { state: "open", until: end.until };
}

// Travel feasibility and venue availability are different questions. The route says whether you CAN get there in time;
// opening hours say whether it is open when you do. Hours are only ever the provider's own string, never assumed.
export function hoursNote(openingHours: string | null | undefined, leaveLocal: string, toMin: number | null): string {
  if (!openingHours) return "That is travel time only: I don't have opening hours for it, so I haven't checked it is open then. ";
  const visit = new Date(`${leaveLocal}:00.000Z`);
  if (toMin != null) visit.setUTCMinutes(visit.getUTCMinutes() + toMin);
  const h = hoursAt(openingHours, visit);
  if (h.state === "open") return `Its listed hours say open at that time${h.until ? ` (until ${h.until})` : ""}. `;
  if (h.state === "closed") return `But its listed hours say closed at that time${h.opensAt ? ` (opens ${h.opensAt})` : ""}, so the route working doesn't make it a good idea. `;
  return "That is travel time only: its hours couldn't be read, so I haven't checked it is open then. ";
}

