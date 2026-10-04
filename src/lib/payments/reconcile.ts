// Before Clockwise believes a status fetched from Pine Labs, the answer must be ABOUT the payment it asked for:
// same link, same merchant reference, same amount, same currency. A mismatch is never applied as paid; it is
// recorded for a human and the request stays as it was.
export type LiveFacts = { paymentLinkId: string | null; merchantReference: string | null; amountMinorUnits: number | null; currency: string | null };
export type Expected = { paymentLinkId: string | null; amountMinor: number | null; currency: string | null; references: string[] };
export type Reconciled = { ok: true } | { ok: false; reason: "LINK_MISMATCH" | "REFERENCE_MISMATCH" | "AMOUNT_MISMATCH" | "CURRENCY_MISMATCH"; expected: string; got: string };

export function reconcilePayment(expected: Expected, live: LiveFacts): Reconciled {
  if (expected.paymentLinkId && live.paymentLinkId && expected.paymentLinkId !== live.paymentLinkId) return { ok: false, reason: "LINK_MISMATCH", expected: expected.paymentLinkId, got: live.paymentLinkId };
  if (live.merchantReference && expected.references.length) {
    // retries add a numeric suffix to the base reference
    const base = live.merchantReference.replace(/-\d+$/, "");
    if (!expected.references.some((r) => r === live.merchantReference || r === base)) return { ok: false, reason: "REFERENCE_MISMATCH", expected: expected.references.join(" | "), got: live.merchantReference };
  }
  if (expected.currency && live.currency && expected.currency.toUpperCase() !== live.currency.toUpperCase()) return { ok: false, reason: "CURRENCY_MISMATCH", expected: expected.currency, got: live.currency };
  if (expected.amountMinor != null && live.amountMinorUnits != null && expected.amountMinor !== live.amountMinorUnits) return { ok: false, reason: "AMOUNT_MISMATCH", expected: String(expected.amountMinor), got: String(live.amountMinorUnits) };
  return { ok: true };
}
