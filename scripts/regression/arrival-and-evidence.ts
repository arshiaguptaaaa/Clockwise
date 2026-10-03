// Regression lock: own-arrival rules, suggested time, and rail-evidence redaction.
import assert from "node:assert/strict";
import { resolveNewArrival, ceilToQuarter } from "../../src/lib/traveller/arrival-rules";

process.env.PINELABS_CLIENT_SECRET = "pine-secret-value-98765";
process.env.GNANI_SPEECH_API_KEY = "gnani-key-value-12345";
import { sanitize, maskEmail } from "../../src/lib/rails/evidence";

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`PASS ${name}`);
};
const OLD = "2026-12-12T18:30";

ok("a later evening arrival (20:15) is accepted", () => {
  const r = resolveNewArrival(OLD, { arrivalTime: "20:15" });
  assert.ok(r.ok && r.newLocal === "2026-12-12T20:15" && r.movedMinutes === 105);
});
ok("an arrival that jumps 10 hours EARLIER (08:15) is refused — ask AM/PM, change nothing", () => {
  const r = resolveNewArrival(OLD, { arrivalTime: "08:15" });
  assert.ok(!r.ok && /EARLIER/.test(r.ask));
});
ok("the same time is not a change", () => assert.ok(!resolveNewArrival(OLD, { arrivalTime: "18:30" }).ok));
ok("a malformed time asks instead of guessing", () => {
  assert.ok(!resolveNewArrival(OLD, { arrivalTime: "8:15pm" }).ok);
  assert.ok(!resolveNewArrival(OLD, {}).ok);
});
ok("a day change (lands after midnight) is accepted when the date is given", () => {
  const r = resolveNewArrival(OLD, { arrivalTime: "00:30", arrivalDate: "2026-12-13" });
  assert.ok(r.ok && r.newLocal === "2026-12-13T00:30");
});
ok("no old arrival requires an explicit date", () => assert.ok(!resolveNewArrival(null, { arrivalTime: "20:15" }).ok));
ok("suggested commitment time rounds UP to the next quarter hour", () => {
  assert.equal(ceilToQuarter("2026-12-12T21:19"), "2026-12-12T21:30");
  assert.equal(ceilToQuarter("2026-12-12T21:30"), "2026-12-12T21:30");
  assert.equal(ceilToQuarter("2026-12-12T23:50"), "2026-12-13T00:00");
});
ok("rail evidence: auth-shaped keys are redacted by name", () => {
  const out = sanitize({ headers: { Authorization: "Bearer abc", "X-API-Key-ID": "k", "Request-ID": "r1" }, body: { client_secret: "s", client_id: "i", access_token: "t", grant_type: "client_credentials" } }) as { headers: Record<string, string>; body: Record<string, string> };
  assert.equal(out.headers.Authorization, "[REDACTED]");
  assert.equal(out.headers["X-API-Key-ID"], "[REDACTED]");
  assert.equal(out.headers["Request-ID"], "r1");
  assert.equal(out.body.client_secret, "[REDACTED]");
  assert.equal(out.body.access_token, "[REDACTED]");
  assert.equal(out.body.grant_type, "client_credentials");
});
ok("rail evidence: configured secret VALUES are scrubbed wherever they appear", () => {
  const out = JSON.stringify(sanitize({ note: "echo pine-secret-value-98765 and gnani-key-value-12345 here" }));
  assert.ok(!out.includes("pine-secret-value-98765") && !out.includes("gnani-key-value-12345"));
});
ok("rail evidence: contact details are masked", () => {
  const out = sanitize({ customer: { email_id: "eva.sharma@gmail.com", mobile_number: "+919876543210" } }) as { customer: Record<string, string> };
  assert.equal(out.customer.email_id, maskEmail("eva.sharma@gmail.com"));
  assert.ok(!out.customer.email_id.includes("eva.sharma"));
  assert.ok(out.customer.mobile_number.endsWith("10") && !out.customer.mobile_number.includes("98765"));
});
console.log(`\n${n} arrival/evidence regression checks passed`);
