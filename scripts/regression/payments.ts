// Payment amounts and splits. Pure; no network. Pine's contract (amount.value = integer paise, >= 100) is pinned here.
import assert from "node:assert/strict";
import { rupeesToPaise, validatePineMinor, PINE_MIN_MINOR } from "../../src/lib/payments/amount";
import { uberDeeplink } from "../../src/lib/uber/deeplink";
import { parseDiscoveryQuery } from "../../src/lib/travel/discovery-query";
import { rangeSummary, resolvedMoment } from "../../src/lib/dates";
import { computeObligations } from "../../src/lib/payments/obligations-math";

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`PASS ${name}`);
};

ok("rupees become integer paise: 1, 10, 10.50, 100, 1,000", () => {
  assert.equal(rupeesToPaise(1), 100);
  assert.equal(rupeesToPaise(10), 1000);
  assert.equal(rupeesToPaise("10"), 1000);
  assert.equal(rupeesToPaise("₹10"), 1000);
  assert.equal(rupeesToPaise(10.5), 1050);
  assert.equal(rupeesToPaise("10.50"), 1050);
  assert.equal(rupeesToPaise("10.5"), 1050);
  assert.equal(rupeesToPaise(100), 10000);
  assert.equal(rupeesToPaise("Rs. 1,000"), 100000);
  assert.equal(rupeesToPaise("₹3,000"), 300000);
  assert.equal(rupeesToPaise(1000), 100000);
});
ok("no floating-point drift (10.1, 0.29, 19.99)", () => {
  assert.equal(rupeesToPaise(10.1), 1010);
  assert.equal(rupeesToPaise("0.29"), 29);
  assert.equal(rupeesToPaise(19.99), 1999);
  assert.equal(rupeesToPaise("1129.35"), 112935);
});
ok("garbage never becomes an amount", () => {
  for (const bad of [undefined, null, NaN, Infinity, -5, 0, "", "abc", "₹", "10.505", "1e3", {}, [], "ten", 10.004]) assert.equal(rupeesToPaise(bad), null, String(bad));
});
ok("Pine validation: integers >= 100 only, never NaN/float/string/undefined", () => {
  assert.deepEqual(validatePineMinor(1000), { ok: true, minor: 1000 });
  assert.equal(validatePineMinor(PINE_MIN_MINOR).ok, true);
  for (const bad of [99, 0, -1, NaN, undefined, null, "1000", 10.5, Infinity]) assert.equal(validatePineMinor(bad as unknown as number).ok, false, String(bad));
  assert.equal(validatePineMinor(1000, "USD").ok, false);
});
ok("Rs 3,000 between three is exactly Rs 1,000 each", () => {
  const r = computeObligations({ totalMinor: 300000, people: [{ userId: "a", name: "Arshia" }, { userId: "e", name: "Eva" }, { userId: "v", name: "Vasudha" }] });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.lines.map((l) => l.amountMinor), [100000, 100000, 100000]);
});
ok("remainder paise are handed out deterministically and the sum is exact (Rs 100 / 3)", () => {
  const r = computeObligations({ totalMinor: 10000, people: [{ userId: "a", name: "A" }, { userId: "b", name: "B" }, { userId: "c", name: "C" }] });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.lines.reduce((s, l) => s + l.amountMinor, 0), 10000);
    assert.deepEqual(r.lines.map((l) => l.amountMinor), [3334, 3333, 3333]);
  }
});
ok("Rs 500 from Eva and the rest between us: 1,250 / 500 / 1,250", () => {
  const r = computeObligations({ totalMinor: 300000, people: [{ userId: "a", name: "Arshia" }, { userId: "e", name: "Eva" }, { userId: "v", name: "Vasudha" }], fixed: { e: 50000 } });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.lines.map((l) => [l.name, l.amountMinor]), [["Arshia", 125000], ["Eva", 50000], ["Vasudha", 125000]]);
});
ok("a fixed amount larger than the total is refused", () => {
  const r = computeObligations({ totalMinor: 100000, people: [{ userId: "a", name: "A" }, { userId: "b", name: "B" }], fixed: { a: 80000, b: 80000 } });
  assert.equal(r.ok, false);
});
ok("everyone fixed but the sum is wrong is refused (never silently adjusted)", () => {
  const r = computeObligations({ totalMinor: 100000, people: [{ userId: "a", name: "A" }, { userId: "b", name: "B" }], fixed: { a: 40000, b: 40000 } });
  assert.equal(r.ok, false);
});
ok("a share below Pine's minimum is refused with a plain reason", () => {
  const r = computeObligations({ totalMinor: 150, people: [{ userId: "a", name: "A" }, { userId: "b", name: "B" }] });
  assert.equal(r.ok, false);
});
ok("already paid: counts toward the total, needs no link", () => {
  const r = computeObligations({ totalMinor: 300000, people: [{ userId: "a", name: "Arshia" }, { userId: "e", name: "Eva" }, { userId: "v", name: "Vasudha" }], alreadyPaid: ["a"] });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.lines[0].alreadyPaid, true);
    assert.equal(r.lines.reduce((s, l) => s + l.amountMinor, 0), 300000);
  }
});
ok("a single-person Rs 10 payment is one obligation of 1000 paise", () => {
  const r = computeObligations({ totalMinor: 1000, people: [{ userId: "s", name: "Shreya" }] });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.lines.map((l) => l.amountMinor), [1000]);
});
ok("Uber deeplink: official universal link, pickup and dropoff pre-filled, nothing claimed", () => {
  const u = new URL(uberDeeplink({ pickup: { latitude: 12.97, longitude: 77.6, label: "Hotel" }, dropoff: { latitude: 12.9763, longitude: 77.5929, label: "Cubbon Park" } }));
  assert.equal(u.origin + u.pathname, "https://m.uber.com/ul/");
  assert.equal(u.searchParams.get("action"), "setPickup");
  assert.equal(u.searchParams.get("dropoff[nickname]"), "Cubbon Park");
  assert.equal(u.searchParams.get("pickup[latitude]"), "12.970000");
  assert.equal(new URL(uberDeeplink({ pickup: "my_location", dropoff: { label: "X" } })).searchParams.get("pickup"), "my_location");
});
ok("discovery: category and place are read from the words alone (no preferences involved)", () => {
  assert.deepEqual(parseDiscoveryQuery("coffee in Gurgaon"), { category: "cafe", place: "Gurgaon" });
  assert.deepEqual(parseDiscoveryQuery("shopping in Gurgaon"), { category: "shopping", place: "Gurgaon" });
  assert.deepEqual(parseDiscoveryQuery("cafes in Gurgaon"), { category: "cafe", place: "Gurgaon" });
  assert.deepEqual(parseDiscoveryQuery("things to do in Gurgaon"), { category: "attraction", place: "Gurgaon" });
  assert.deepEqual(parseDiscoveryQuery("coffee in Bangalore"), { category: "cafe", place: "Bangalore" });
  assert.deepEqual(parseDiscoveryQuery("shopping in Bangalore"), { category: "shopping", place: "Bangalore" });
  assert.deepEqual(parseDiscoveryQuery("things to do near Indiranagar?"), { category: "attraction", place: "Indiranagar" });
  assert.deepEqual(parseDiscoveryQuery("Gurgaon coffee"), { category: "cafe", place: "Gurgaon" });
  assert.deepEqual(parseDiscoveryQuery("Hawa Mahal"), { category: null, place: "Hawa Mahal" });
  assert.deepEqual(parseDiscoveryQuery("restaurants"), { category: "restaurant", place: null });
});
ok("dates: a range reads '12–15 DEC · 3 NIGHTS' and a moment reads 'SAT, 12 DEC · 8:00 PM'", () => {
  assert.equal(rangeSummary("2026-12-12", "2026-12-15"), "12–15 DEC · 3 NIGHTS");
  assert.equal(rangeSummary("2026-12-30", "2027-01-02"), "30 DEC – 2 JAN · 3 NIGHTS");
  assert.equal(rangeSummary("2026-12-12", "2026-12-12"), "12–12 DEC · SAME DAY");
  assert.equal(resolvedMoment("2026-12-12T20:00"), "SAT, 12 DEC · 8:00 PM");
  assert.equal(resolvedMoment("2026-12-13T00:15"), "SUN, 13 DEC · 12:15 AM");
  assert.equal(resolvedMoment("2026-12-13T12:00"), "SUN, 13 DEC · 12:00 PM");
});
console.log(`${n} payment checks passed`);
