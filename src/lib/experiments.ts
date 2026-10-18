// Tiny A/B helper. A user's variant is a stable hash of (experiment, userId), so it never flips between renders,
// devices or deploys, and needs no stored assignment. Exposure and conversion are logged as ProductEvent rows.
export const EXPERIMENTS = {
  // Wording of the main button on the clash card.
  clash_cta: { variants: ["control", "direct"] as const },
} as const;

export type ExperimentName = keyof typeof EXPERIMENTS;

export function variantFor<E extends ExperimentName>(experiment: E, userId: string): (typeof EXPERIMENTS)[E]["variants"][number] {
  const variants = EXPERIMENTS[experiment].variants;
  let h = 2166136261;
  for (const ch of `${experiment}:${userId}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return variants[h % variants.length];
}

export function clashCtaLabel(variant: string, when: string): string {
  return variant === "direct" ? `Yes, propose ${when} to the group` : `Propose ${when}`;
}
