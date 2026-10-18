// Funnel, A/B and error-rate maths behind /admin/insights. Pure; no network, no database.
import assert from "node:assert/strict";
import { buildFunnel, abResults, abVerdict, errorsPer100, MIN_PER_VARIANT, type EventRow } from "../../src/lib/insights";
import { variantFor, clashCtaLabel, EXPERIMENTS } from "../../src/lib/experiments";

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`PASS ${name}`);
};
const ev = (name: string, userId: string | null, props: Record<string, unknown> | null, extra: Partial<EventRow> = {}): EventRow => ({
  name, userId, experiment: null, variant: null, props: props ? JSON.stringify(props) : null, createdAt: new Date(), ...extra,
});

ok("funnel counts each clash once per step, and ignores proposals that did not come from a clash", () => {
  const f = buildFunnel([
    ev("clash_detected", "a", { clashId: "c1" }),
    ev("clash_detected", "a", { clashId: "c2" }),
    ev("clash_proposed", "a", { clashId: "c1" }),
    ev("vote_cast", "b", { clashId: "c1" }),
    ev("vote_cast", "c", { clashId: "c1" }), // two votes on one clash still count one clash
    ev("plan_updated", "a", { clashId: "c1" }),
    ev("vote_cast", "b", { clashId: null }), // an ordinary proposal, not the disruption loop
    ev("plan_updated", "a", {}),
  ]);
  assert.deepEqual(f.map((s) => s.count), [2, 1, 1, 1]);
  assert.equal(f[0].fromPrev, null);
  assert.equal(f[1].fromPrev, 0.5);
  assert.equal(f[3].fromPrev, 1);
});
ok("an empty funnel is zeros with no divide-by-zero", () => {
  const f = buildFunnel([]);
  assert.deepEqual(f.map((s) => s.count), [0, 0, 0, 0]);
  assert.ok(f.every((s) => s.fromPrev === null));
});
ok("a variant is stable for a user and both variants are used", () => {
  assert.equal(variantFor("clash_cta", "user-1"), variantFor("clash_cta", "user-1"));
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) seen.add(variantFor("clash_cta", `u${i}`));
  assert.deepEqual([...seen].sort(), [...EXPERIMENTS.clash_cta.variants].sort());
  // roughly even split
  let direct = 0;
  for (let i = 0; i < 1000; i++) if (variantFor("clash_cta", `u${i}`) === "direct") direct++;
  assert.ok(direct > 400 && direct < 600, `split was ${direct}/1000`);
});
ok("button wording: control keeps the old label, direct says who it goes to", () => {
  assert.equal(clashCtaLabel("control", "8:30 PM"), "Propose 8:30 PM");
  assert.equal(clashCtaLabel("direct", "8:30 PM"), "Yes, propose 8:30 PM to the group");
  assert.equal(clashCtaLabel("anything-else", "8:30 PM"), "Propose 8:30 PM");
});
ok("A/B: exposure and conversion are per distinct viewer; a conversion without an exposure does not count", () => {
  const x = (u: string, v: string) => ev("experiment_exposure", u, null, { experiment: "clash_cta", variant: v });
  const c = (u: string, v: string) => ev("clash_proposed", u, { clashId: "c" }, { experiment: "clash_cta", variant: v });
  const r = abResults([x("a", "control"), x("a", "control"), x("b", "control"), x("c", "direct"), c("a", "control"), c("c", "direct"), c("z", "direct")], "clash_cta");
  assert.deepEqual(r, [
    { variant: "control", exposed: 2, converted: 1, rate: 0.5 },
    { variant: "direct", exposed: 1, converted: 1, rate: 1 },
  ]);
});
ok("A/B verdict never calls a winner on a handful of users", () => {
  assert.match(abVerdict([]), /Not enough data/);
  const small = [{ variant: "control", exposed: 3, converted: 1, rate: 1 / 3 }, { variant: "direct", exposed: 2, converted: 2, rate: 1 }];
  assert.match(abVerdict(small), /Too early to call/);
  const big = small.map((r) => ({ ...r, exposed: MIN_PER_VARIANT }));
  assert.doesNotMatch(abVerdict(big), /Too early/);
});
ok("errors per 100 active travellers", () => {
  assert.equal(errorsPer100(3, 12), 25);
  assert.equal(errorsPer100(0, 12), 0);
  assert.equal(errorsPer100(5, 0), null);
});
console.log(`${n} insights checks passed`);
