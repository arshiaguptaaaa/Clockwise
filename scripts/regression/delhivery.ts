// Delhivery parsing + secrecy, against the SHAPES the real API returned. Pure; no network.
import assert from "node:assert/strict";
import { extractRouteSummary, extractMatrixCell, inIndia, compactForEvidence } from "../../src/lib/delhivery/client";
import { sanitize } from "../../src/lib/rails/evidence";

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`PASS ${name}`);
};

ok("route: kilometres -> metres, seconds kept (real /route shape)", () => {
  const r = extractRouteSummary({ recommended_route: { distance: 38.2, duration: 4270.14, legs: [{ summary: { length: 38.2, time: 4270.138 } }] }, alternates: [], status: true });
  assert.ok(r);
  assert.equal(Math.round(r!.distanceMeters), 38200);
  assert.equal(Math.round(r!.durationSeconds), 4270);
});
ok("route: no duration in the response => no number (never guessed)", () => {
  assert.equal(extractRouteSummary({ recommended_route: { distance: 5 } }), null);
  assert.equal(extractRouteSummary({}), null);
});
ok("matrix: first cell, km and seconds (real /matrix shape)", () => {
  const c = extractMatrixCell({ sources_to_targets: [[{ distance: 40.867, time: 3692, from_index: 0, to_index: 0 }]] });
  assert.equal(Math.round(c!.distanceMeters), 40867);
  assert.equal(c!.durationSeconds, 3692);
});
ok("India gate: Bengaluru in, Vienna out", () => {
  assert.equal(inIndia({ lat: 12.97, lng: 77.64 }), true);
  assert.equal(inIndia({ lat: 48.2, lng: 16.37 }), false);
});
ok("evidence: a Bearer JWT is redacted wherever it appears, and long geometry is summarised", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop";
  const s = JSON.stringify(sanitize({ headers: { Authorization: `Bearer ${jwt}` }, note: `token=${jwt}` }));
  assert.ok(!s.includes("eyJhbGciOiJIUzI1NiJ9"));
  const c = JSON.stringify(compactForEvidence({ geometry: "x".repeat(3000) }));
  assert.ok(c.length < 400 && c.includes("chars total"));
});
console.log(`${n} delhivery regression checks passed`);
