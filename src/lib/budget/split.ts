// Deterministic split arithmetic. No model is involved anywhere in here: the
// agent only INTERPRETS "split between us" into a method and participants;
// these functions compute every paisa, and the shares always sum exactly to the
// total (largest-remainder rounding, so no paisa is ever lost or invented).
export type SplitMethod = "EQUAL" | "EXACT" | "PERCENT" | "SHARES" | "SELECT";

export type SplitParticipant = {
  userId: string;
  // EXACT: amount in minor units. PERCENT: percent (0-100). SHARES: weight. EQUAL/SELECT: ignored.
  value?: number;
};

export type SplitResult =
  | { ok: true; shares: { userId: string; shareMinor: number; inputValue: number | null }[] }
  | { ok: false; error: string };

// Distributes `total` across `weights` (all > 0) so the parts sum to exactly
// `total`: floor each proportional part, then hand the leftover units to the
// largest fractional remainders (ties broken by input order — deterministic).
function distribute(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (total * w) / sum);
  const floors = exact.map((x) => Math.floor(x));
  let leftover = total - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (leftover <= 0) break;
    floors[i] += 1;
    leftover -= 1;
  }
  return floors;
}

export function computeShares(method: SplitMethod, totalMinor: number, participants: SplitParticipant[]): SplitResult {
  if (!Number.isInteger(totalMinor) || totalMinor <= 0) return { ok: false, error: "The amount must be greater than zero." };
  const people = participants.filter((p, i, all) => all.findIndex((q) => q.userId === p.userId) === i);
  if (people.length === 0) return { ok: false, error: "Pick at least one person to split between." };

  if (method === "EQUAL" || method === "SELECT") {
    const parts = distribute(totalMinor, people.map(() => 1));
    return { ok: true, shares: people.map((p, i) => ({ userId: p.userId, shareMinor: parts[i], inputValue: null })) };
  }

  const values = people.map((p) => p.value);
  if (values.some((v) => v == null || !Number.isFinite(v) || v < 0)) {
    return { ok: false, error: "Enter a value for everyone in the split." };
  }
  const nums = values as number[];

  if (method === "EXACT") {
    const parts = nums.map((v) => Math.round(v));
    const sum = parts.reduce((a, b) => a + b, 0);
    if (sum !== totalMinor) {
      const diff = totalMinor - sum;
      return { ok: false, error: `The amounts add up to ${(sum / 100).toFixed(2)}, which is ${(Math.abs(diff) / 100).toFixed(2)} ${diff > 0 ? "short of" : "over"} the total.` };
    }
    return { ok: true, shares: people.map((p, i) => ({ userId: p.userId, shareMinor: parts[i], inputValue: nums[i] })) };
  }

  if (method === "PERCENT") {
    const sum = nums.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 100) > 0.005) return { ok: false, error: `The percentages add up to ${sum.toFixed(2)}%, not 100%.` };
    const parts = distribute(totalMinor, nums.map((n) => (n > 0 ? n : 0)).map((n) => n || 1e-12));
    // zero-percent participants must get exactly zero
    const fixed = parts.map((x, i) => (nums[i] === 0 ? 0 : x));
    const drift = totalMinor - fixed.reduce((a, b) => a + b, 0);
    if (drift !== 0) {
      const target = nums.findIndex((n) => n > 0);
      fixed[target] += drift;
    }
    return { ok: true, shares: people.map((p, i) => ({ userId: p.userId, shareMinor: fixed[i], inputValue: nums[i] })) };
  }

  if (method === "SHARES") {
    if (nums.every((n) => n === 0)) return { ok: false, error: "At least one person needs a share greater than zero." };
    const parts = distribute(totalMinor, nums.map((n) => (n > 0 ? n : 1e-12)));
    const fixed = parts.map((x, i) => (nums[i] === 0 ? 0 : x));
    const drift = totalMinor - fixed.reduce((a, b) => a + b, 0);
    if (drift !== 0) fixed[nums.findIndex((n) => n > 0)] += drift;
    return { ok: true, shares: people.map((p, i) => ({ userId: p.userId, shareMinor: fixed[i], inputValue: nums[i] })) };
  }

  return { ok: false, error: "Unknown split method." };
}
