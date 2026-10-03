// Regression lock for the location-aware layer. Pure functions only (no DB, no network).
// Run: npm run test:regression
import assert from "node:assert/strict";
import { resolveAnchor, toAroundPlace, whyPicked } from "../../src/lib/travel/around";
import { groupOverlaps } from "../../src/lib/travel/saved-overlap";
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
  console.log(`${n} location-aware checks passed`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
