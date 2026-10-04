// Location-intelligence parsing and decisions. Pure; shapes follow the documented formats (Google geocoding
// format for /rvg, GeoJSON for /isochrone, sources_to_targets for /matrix). These prove the maths and the parsing,
// NOT that Delhivery answers: that is only proven by a real response (see Developer Evidence).
import assert from "node:assert/strict";
import { parseReverse, parseIsochrone, pointInIsochrone, parseMatrix, parseSuggestions } from "../../src/lib/delhivery/client";
import { rankMeetup } from "../../src/lib/travel/meetup";
import { fitVerdict } from "../../src/lib/travel/fit";

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`PASS ${name}`);
};

ok("reverse geocode: locality, city and state from Google-format components", () => {
  const r = parseReverse({ results: [{ formatted_address: "12th Main, Indiranagar, Bengaluru, Karnataka 560038", address_components: [{ long_name: "Indiranagar", types: ["sublocality_level_1", "sublocality"] }, { long_name: "Bengaluru", types: ["locality"] }, { long_name: "Karnataka", types: ["administrative_area_level_1"] }] }] });
  assert.equal(r?.locality, "Indiranagar");
  assert.equal(r?.city, "Bengaluru");
  assert.equal(r?.state, "Karnataka");
});
ok("reverse geocode: nothing readable => null (never a made-up place)", () => {
  assert.equal(parseReverse({ results: [] }), null);
  assert.equal(parseReverse({}), null);
});
ok("isochrone: inside the polygon, outside it, and inside a hole", () => {
  const poly = parseIsochrone({ features: [{ geometry: { type: "Polygon", coordinates: [[[77.0, 12.0], [78.0, 12.0], [78.0, 13.0], [77.0, 13.0], [77.0, 12.0]], [[77.4, 12.4], [77.6, 12.4], [77.6, 12.6], [77.4, 12.6], [77.4, 12.4]]] } }] });
  assert.ok(poly);
  assert.equal(pointInIsochrone({ lat: 12.2, lng: 77.2 }, poly!), true);
  assert.equal(pointInIsochrone({ lat: 14.0, lng: 77.2 }, poly!), false);
  assert.equal(pointInIsochrone({ lat: 12.5, lng: 77.5 }, poly!), false);
});
ok("isochrone: MultiPolygon and a missing geometry", () => {
  const m = parseIsochrone({ features: [{ geometry: { type: "MultiPolygon", coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]], [[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]]] } }] });
  assert.equal(pointInIsochrone({ lat: 5.5, lng: 5.5 }, m!), true);
  assert.equal(parseIsochrone({ features: [] }), null);
});
ok("matrix: seconds grid, missing cells stay null", () => {
  const g = parseMatrix({ sources_to_targets: [[{ time: 600, distance: 3 }, { distance: 4 }], [{ time: 900 }, { time: 300 }]] }, 2, 2);
  assert.deepEqual(g, [[600, null], [900, 300]]);
});
ok("autosuggest: tolerant of common shapes, never invents a coordinate", () => {
  const a = parseSuggestions({ results: [{ name: "Indiranagar", address: "Bengaluru, Karnataka", lat: 12.97, lng: 77.64 }, { title: "Indiranagar Metro" }] });
  assert.equal(a.length, 2);
  assert.equal(a[0].point?.lat, 12.97);
  assert.equal(a[1].point, null);
  assert.deepEqual(parseSuggestions({ results: [] }), []);
});
ok("meet-up: smallest worst journey wins, not the smallest total", () => {
  const cands = [{ providerPlaceId: "a", name: "A", lat: 0, lng: 0 }, { providerPlaceId: "b", name: "B", lat: 0, lng: 0 }];
  // A: 5,5,40 (total 50, worst 40). B: 15,15,15 (total 45, worst 15).
  const ranked = rankMeetup(cands, ["x", "y", "z"], [[300, 900], [300, 900], [2400, 900]]);
  assert.equal(ranked[0].candidate.name, "B");
  assert.equal(ranked[0].worst, 15);
});
ok("meet-up: a place with a missing journey time is dropped, not guessed", () => {
  const cands = [{ providerPlaceId: "a", name: "A", lat: 0, lng: 0 }, { providerPlaceId: "b", name: "B", lat: 0, lng: 0 }];
  const ranked = rankMeetup(cands, ["x", "y"], [[300, 600], [null, 600]]);
  assert.deepEqual(ranked.map((r) => r.candidate.name), ["B"]);
});
ok("fit: the one rule (>=15 spare is yes, 0-14 tight, negative no, outside reach no)", () => {
  assert.equal(fitVerdict(30, true), "YES");
  assert.equal(fitVerdict(15, null), "YES");
  assert.equal(fitVerdict(5, null), "TIGHT");
  assert.equal(fitVerdict(-1, null), "NO");
  assert.equal(fitVerdict(60, false), "NO");
});
console.log(`${n} delhivery location checks passed`);
