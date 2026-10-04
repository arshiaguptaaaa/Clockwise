// Regression lock for the location-aware layer. Pure functions only (no DB, no network).
// Run: npm run test:regression
import assert from "node:assert/strict";
import { resolveAnchor, toAroundPlace, whyPicked } from "../../src/lib/travel/around";
import { groupOverlaps } from "../../src/lib/travel/saved-overlap";
import { spareMinutes, rainInWindow, addMinutes, STAY_MIN, BUFFER_MIN } from "../../src/lib/travel/window";
import { pickPassengerAirport } from "../../src/lib/travel/airport-pick";
import { hoursAt, hoursCoverVisit } from "../../src/lib/travel/hours";
import { orderCategories } from "../../src/lib/travel/around";
import { AROUND_CATEGORIES, countWord } from "../../src/lib/travel/around-categories";

let n = 0;
const ok = async (name: string, fn: () => void | Promise<void>) => {
  await fn();
  n++;
  console.log(`PASS ${name}`);
};

const row = (userId: string, id = "p1", name = "Café X") => ({ userId, provider: "geoapify", providerPlaceId: id, name, address: null, kind: "CAFE" });

async function main() {
  await ok("ME without a browser fix is refused, never replaced by another anchor", async () => {
    const r = await resolveAnchor("trip", "user", "me", null);
    assert.equal(r.ok, false);
    const bad = await resolveAnchor("trip", "user", "me", { lat: 999, lng: 10 });
    assert.equal(bad.ok, false);
  });
  await ok("ME with a valid fix resolves to the current location only", async () => {
    const r = await resolveAnchor("trip", "user", "me", { lat: 48.2082, lng: 16.3738 });
    assert.ok(r.ok && r.anchor.kind === "me" && r.anchor.label === "where you are");
  });
  await ok("provider opening hours are never invented", () => {
    const base = { providerId: "x", name: "A", formattedAddress: null, categories: [], latitude: 1, longitude: 2, distanceMeters: 10, provider: "geoapify", retrievedAt: "2026-10-04T00:00:00Z" };
    assert.equal(toAroundPlace(base).openingHours, null);
    assert.equal(toAroundPlace({ ...base, openingHours: "Mo-Su 08:00-21:00" }).openingHours, "Mo-Su 08:00-21:00");
  });
  await ok("every displayed place keeps provider + id + coordinates + categories + retrievedAt", () => {
    const p = toAroundPlace({ providerId: "pid", name: "A", formattedAddress: "St 1", categories: ["catering.cafe"], latitude: 1, longitude: 2, distanceMeters: 10, provider: "geoapify", retrievedAt: "2026-10-04T00:00:00Z" });
    assert.ok(p.provider === "geoapify" && p.providerPlaceId === "pid" && p.lat === 1 && p.lng === 2 && p.categories[0] === "catering.cafe" && p.retrievedAt);
  });
  await ok("'why' only echoes the traveller's own picks; nothing qualitative", () => {
    const w = whyPicked("cafe", { energy: ["CAFES", "SLOW_MORNINGS"], nearby: ["cafe"] });
    assert.ok(w && /cafés/.test(w) && /picks\.$/.test(w));
    assert.ok(!/amazing|best|locals|love|famous|cozy/i.test(w!));
    assert.equal(whyPicked("pharmacy", { energy: ["CAFES"], nearby: ["cafe"] }), null);
  });
  await ok("overlap is a count and is invisible to people who did not save the place", () => {
    const rows = [row("a"), row("b"), row("c"), row("a", "p2", "Café Y")];
    const forA = groupOverlaps(rows, "a", 3);
    assert.equal(forA.length, 1);
    assert.equal(forA[0].count, 3);
    assert.ok(!JSON.stringify(forA).includes('"b"') && !("userIds" in forA[0]));
    assert.equal(groupOverlaps([row("a"), row("b")], "c", 3).length, 0, "a non-saver must learn nothing");
    assert.equal(groupOverlaps([row("a")], "a", 3).length, 0, "one saver is not an overlap");
  });
  await ok("Around You offers Coffee, Food, Things to do, Convenience, Pharmacy, Shopping, ATM", () => {
    const labels = Object.values(AROUND_CATEGORIES).map((c) => c.label);
    for (const l of ["Coffee", "Food", "Things to do", "Convenience", "Pharmacy", "Shopping", "ATM"]) assert.ok(labels.includes(l), l);
    assert.equal(countWord(3), "THREE");
  });
  await ok("feasibility: 90 min window, 8 min there, 45 there, 22 on, 10 buffer fits with 5 spare", () => {
    assert.equal(spareMinutes(90, BUFFER_MIN, 8, 45, 22), 5);
  });
  await ok("feasibility: an option that does not fit the window is negative (never offered)", () => {
    assert.ok(spareMinutes(60, BUFFER_MIN, 20, STAY_MIN.museum, 25) < 0);
  });
  await ok("rain: only hours overlapping the window with >=50% count; outside hours are ignored", () => {
    const h = { utcOffsetSeconds: 0, provider: "open-meteo" as const, retrievedAt: "", hours: [
      { time: "2026-10-04T15:00", precipitationProbability: 20, precipitationMm: 0 },
      { time: "2026-10-04T16:00", precipitationProbability: 70, precipitationMm: 1 },
      { time: "2026-10-04T19:00", precipitationProbability: 90, precipitationMm: 2 },
    ] };
    const r = rainInWindow(h, "2026-10-04T15:30", "2026-10-04T17:30");
    assert.equal(r?.probability, 70);
    assert.equal(rainInWindow(h, "2026-10-04T15:00", "2026-10-04T15:59"), null);
    assert.equal(addMinutes("2026-10-04T19:30", -45), "2026-10-04T18:45");
  });
  await ok("Vibe Check ordering: cafés/shopping/pretty first, never drops a category", () => {
    const all = Object.keys(AROUND_CATEGORIES);
    const o = orderCategories(all, { nearby: ["cafe", "shopping"], energy: ["PRETTY"] });
    assert.deepEqual(o.slice(0, 3), ["cafe", "shopping", "attraction"]);
    for (const c of all) assert.ok(o.includes(c), c);
  });
  await ok("provider hours: closed at 00:25 Sunday, open at 10:00, never guessed when missing or unparseable", () => {
    const z = (s: string) => new Date(`${s}:00Z`);
    const raw = "Mo-Sa 08:00-20:00; Su 09:00-18:00";
    assert.equal(hoursAt(raw, z("2026-10-04T00:25")).state, "closed");
    assert.deepEqual(hoursAt(raw, z("2026-10-04T10:00")), { state: "open", until: "18:00" });
    assert.equal(hoursAt(null, z("2026-10-04T10:00")).state, "unknown");
    assert.equal(hoursAt("not hours ???", z("2026-10-04T10:00")).state, "unknown");
  });
  await ok("free time: a visit that runs past closing is not offered as open", () => {
    const z = (s: string) => new Date(`${s}:00Z`);
    assert.equal(hoursCoverVisit("Mo-Su 09:00-12:00", z("2026-10-05T11:30"), 45).state, "closed");
    assert.equal(hoursCoverVisit("Mo-Su 09:00-12:00", z("2026-10-05T11:00"), 45).state, "open");
  });
  await ok("airport choice: the passenger airport beats the nearer old/private/heliport POIs", () => {
    const c = (name: string, distanceMeters: number, categories: string[] = ["airport"], iata: string | null = null) => ({ name, placeId: name, lat: 0, lng: 0, categories, iata, icao: null, distanceMeters });
    const pick = pickPassengerAirport([c("HAL Airport", 8400), c("Hospital Heliport", 3000, ["airport.heliport"]), c("Kempegowda International Airport", 31000, ["airport", "airport.international"], "BLR")]);
    assert.equal(pick?.name, "Kempegowda International Airport");
    assert.equal(pickPassengerAirport([c("Vienna International Airport", 18000, ["airport.international"])])?.name, "Vienna International Airport");
    assert.equal(pickPassengerAirport([c("Some Heliport", 1000)]), null);
  });
  console.log(`${n} location-aware checks passed`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
