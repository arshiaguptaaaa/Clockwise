// THE ONLY place a rupee amount becomes a Pine Labs amount.
//
// Pine Labs' create-payment-link request takes amount.value as an INTEGER in the smallest currency unit
// (paise for INR): Rs 10 = 1000, Rs 100 = 10000, Rs 1,000 = 100000, and the API rejects anything below 100
// (its own message: "Amount value must be an Integer greater than or equal to 1" - what a missing, NaN,
// zero or fractional value produces). UI and agent code must never build that number themselves.
//
// Integer arithmetic only: "10.50" is parsed as text (10 * 100 + 50), never 10.5 * 100, so there is no
// floating-point drift and no NaN can reach the provider.
export const PINE_MIN_MINOR = 100; // Rs 1.00
export const PINE_MAX_MINOR = 100_000_00; // Rs 1,00,000 - a sanity ceiling for a single link

// "10", "₹10", "Rs. 1,000", "10.50", 10, 10.5 -> paise. Anything else -> null (never a guess).
export function rupeesToPaise(input: unknown): number | null {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input <= 0) return null;
    const scaled = input * 100;
    const rounded = Math.round(scaled);
    // 10.504 is not a rupee amount: more than two decimals is refused, not rounded.
    if (Math.abs(scaled - rounded) > 1e-6) return null;
    return Number.isSafeInteger(rounded) ? rounded : null;
  }
  if (typeof input !== "string") return null;
  const cleaned = input.replace(/^\s*(rs\.?|inr|₹)\s*/i, "").replace(/[,\s]/g, "").replace(/(rupees?|rs|inr|₹)$/i, "");
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
  const paise = whole * 100 + frac;
  return Number.isSafeInteger(paise) && paise > 0 ? paise : null;
}

export type PineAmountCheck = { ok: true; minor: number } | { ok: false; reason: string };

// Called immediately before any Pine request. Pine is never sent a value that would be rejected.
export function validatePineMinor(minor: unknown, currency = "INR"): PineAmountCheck {
  if (currency !== "INR") return { ok: false, reason: `Unsupported currency ${String(currency).slice(0, 8)}` };
  if (typeof minor !== "number" || !Number.isFinite(minor)) return { ok: false, reason: "Amount is not a number" };
  if (!Number.isInteger(minor)) return { ok: false, reason: "Amount is not a whole number of paise" };
  if (minor < PINE_MIN_MINOR) return { ok: false, reason: `Amount is below Pine Labs' minimum (${PINE_MIN_MINOR} paise)` };
  if (minor > PINE_MAX_MINOR) return { ok: false, reason: "Amount is above the single-payment limit" };
  return { ok: true, minor };
}

// What a traveller is allowed to see when a payment can't be created. The provider's own text stays in
// Developer Evidence and the obligation's lastError; it never reaches the interface.
export const PAYMENT_FAILED_TITLE = "Couldn't create that payment";
export const PAYMENT_FAILED_BODY = "Nothing was charged. Try again in a moment.";
