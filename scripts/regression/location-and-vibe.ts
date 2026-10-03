// Regression lock for the verified location baseline + vibe-check skipping. Pure
// functions only. Run: npm run test:regression
import assert from "node:assert/strict";
import { checkRoutePlausibility } from "../../src/lib/location/plausibility";
import { questionsToAsk, QUESTIONS } from "../../src/lib/traveller/vibe";
import type { Anchor } from "../../src/lib/travel/resolve";

const anchors: Anchor[] = [
  { label: "Hotel Trident", point: { lat: 24.5896, lng: 73.7027 }, kind: "stay" },
  { label: "Udaipur, Rajasthan", point: { lat: 24.5787, lng: 73.6863 }, kind: "destination" },
];
let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`PASS ${name}`);
};

ok("same-name wrong place (Udaipur, Jhunjhunun) is withheld", () => {
  const r = checkRoutePlausibility({ from: { label: "Udaipur, Jhunjhunun", point: { lat: 28.0, lng: 75.4 } }, to: { label: "Hotel Trident", point: anchors[0].point }, distanceMeters: 496_000, anchors });
  assert.equal(r.ok, false);
});
ok("Maharana Pratap Airport → Hotel Trident (28 km) is plausible", () => {
  const r = checkRoutePlausibility({ from: { label: "Maharana Pratap Airport", point: { lat: 24.6183, lng: 73.8966 } }, to: { label: "Hotel Trident", point: anchors[0].point }, distanceMeters: 28_100, anchors });
  assert.equal(r.ok, true);
});
ok("a legitimate intercity route (Jaipur → Udaipur) is NOT blocked", () => {
  const r = checkRoutePlausibility({ from: { label: "Jaipur, RJ, India", point: { lat: 26.9, lng: 75.8 } }, to: { label: "Udaipur, RJ, India", point: anchors[1].point }, distanceMeters: 395_000, anchors });
  assert.equal(r.ok, true);
});
ok("an airport > 100 km from the stay is not a local transfer", () => {
  const r = checkRoutePlausibility({ from: { label: "Some Airport", point: { lat: 24.9, lng: 73.0 } }, to: { label: "Hotel Trident", point: anchors[0].point }, distanceMeters: 130_000, anchors });
  assert.equal(r.ok, false);
});
ok("vibe check skips questions Clockwise already knows", () => {
  const asks = questionsToAsk({ food: ["VEGETARIAN"] }, { origin: "Delhi", mode: "FLIGHT" }).map((q) => q.id);
  assert.ok(!asks.includes("origin") && !asks.includes("mode") && !asks.includes("food"));
  assert.ok(asks.includes("energy") && asks.includes("hardNo"));
});
ok("vibe check asks everything when nothing is known", () => {
  assert.equal(questionsToAsk({}, {}).length, QUESTIONS.length);
});
console.log(`\n${n} location/vibe regression checks passed`);
