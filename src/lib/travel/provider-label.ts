// The provider that ACTUALLY produced a number, in words. A fallback is always labelled as one, with the reason the first
// choice did not answer, and a Geoapify number is never described as Delhivery.
export function fallbackReason(fellBackFrom: string | null | undefined): string | null {
  if (!fellBackFrom) return null;
  if (/RATE_LIMITED|429/i.test(fellBackFrom)) return "Delhivery rate-limited · 429 cool-down";
  if (/TOKEN_REJECTED|401/i.test(fellBackFrom)) return "Delhivery rejected the token";
  if (/CREDENTIALS|not configured/i.test(fellBackFrom)) return "Delhivery not configured";
  return "Delhivery did not answer";
}

export function providerLabel(provider: string | null | undefined, fellBackFrom?: string | null): string {
  if (provider === "delhivery") return "Delhivery";
  if (provider === "geoapify") {
    const why = fallbackReason(fellBackFrom);
    return why ? `Geoapify · FALLBACK (${why})` : "Geoapify";
  }
  return "provider route";
}
