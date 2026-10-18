import { prisma } from "@/lib/prisma";

// Aggregations behind /admin/insights. The maths is in pure functions over plain rows so it can be tested without
// a database; getInsights() only fetches the rows.
export type EventRow = { name: string; userId: string | null; experiment: string | null; variant: string | null; props: string | null; createdAt: Date };

function propsOf(e: EventRow): Record<string, unknown> {
  try {
    return e.props ? (JSON.parse(e.props) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export type FunnelStep = { key: string; label: string; count: number; fromPrev: number | null };

// The disruption loop, counted per clash so one clash is one unit all the way down:
// detected -> proposed -> at least one vote -> plan updated.
export function buildFunnel(events: EventRow[]): FunnelStep[] {
  const detected = new Set<string>();
  const proposed = new Set<string>();
  const voted = new Set<string>();
  const updated = new Set<string>();
  for (const e of events) {
    const p = propsOf(e);
    const clashId = typeof p.clashId === "string" ? p.clashId : null;
    if (!clashId) continue;
    if (e.name === "clash_detected") detected.add(clashId);
    else if (e.name === "clash_proposed") proposed.add(clashId);
    else if (e.name === "vote_cast") voted.add(clashId);
    else if (e.name === "plan_updated") updated.add(clashId);
  }
  const steps: [string, string, number][] = [
    ["clash_detected", "Clash noticed", detected.size],
    ["clash_proposed", "Fix proposed", proposed.size],
    ["vote_cast", "Someone voted", voted.size],
    ["plan_updated", "Plan updated", updated.size],
  ];
  return steps.map(([key, label, count], i) => ({ key, label, count, fromPrev: i === 0 ? null : steps[i - 1][2] === 0 ? null : count / steps[i - 1][2] }));
}

export type VariantResult = { variant: string; exposed: number; converted: number; rate: number | null };

// Exposure = distinct viewers who saw the button; conversion = distinct viewers who then proposed from that card.
export function abResults(events: EventRow[], experiment: string): VariantResult[] {
  const exposed = new Map<string, Set<string>>();
  const converted = new Map<string, Set<string>>();
  for (const e of events) {
    if (e.experiment !== experiment || !e.variant || !e.userId) continue;
    if (e.name === "experiment_exposure") (exposed.get(e.variant) ?? exposed.set(e.variant, new Set()).get(e.variant)!).add(e.userId);
    if (e.name === "clash_proposed") (converted.get(e.variant) ?? converted.set(e.variant, new Set()).get(e.variant)!).add(e.userId);
  }
  const variants = [...new Set([...exposed.keys(), ...converted.keys()])].sort();
  return variants.map((variant) => {
    const ex = exposed.get(variant)?.size ?? 0;
    // Only people who were exposed can count as converted for the rate.
    const conv = [...(converted.get(variant) ?? [])].filter((u) => exposed.get(variant)?.has(u)).length;
    return { variant, exposed: ex, converted: conv, rate: ex === 0 ? null : conv / ex };
  });
}

// Honest read-out of an A/B result. A handful of users cannot show a winner, and the page says so.
export const MIN_PER_VARIANT = 30;
export function abVerdict(results: VariantResult[]): string {
  if (results.length < 2 || results.some((r) => r.exposed === 0)) return "Not enough data: both variants need exposures.";
  if (results.some((r) => r.exposed < MIN_PER_VARIANT)) return `Too early to call: fewer than ${MIN_PER_VARIANT} people per variant. This proves the measurement works, not that a variant wins.`;
  return "Enough exposures to compare. Treat a difference of a few points as noise unless it holds up over time.";
}

export function errorsPer100(errors: number, activeUsers: number): number | null {
  return activeUsers === 0 ? null : (errors / activeUsers) * 100;
}

export async function getInsights(days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);
  const [events, errors, feedback, errorGroups] = await Promise.all([
    prisma.productEvent.findMany({ where: { createdAt: { gte: since } }, select: { name: true, userId: true, experiment: true, variant: true, props: true, createdAt: true } }),
    prisma.errorLog.groupBy({ by: ["source"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.feedback.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.errorLog.groupBy({ by: ["message"], where: { createdAt: { gte: since } }, _count: { _all: true }, orderBy: { _count: { message: "desc" } }, take: 8 }),
  ]);
  const activeUsers = new Set(events.map((e) => e.userId).filter(Boolean)).size;
  const errorTotal = errors.reduce((n, g) => n + g._count._all, 0);
  const rated = feedback.filter((f) => f.rating !== null);
  const count = (name: string) => events.filter((e) => e.name === name).length;
  return {
    days,
    funnel: buildFunnel(events),
    ab: abResults(events, "clash_cta"),
    activeUsers,
    errorTotal,
    errorsBySource: Object.fromEntries(errors.map((g) => [g.source, g._count._all])),
    errorsPer100: errorsPer100(errorTotal, activeUsers),
    topErrors: errorGroups.map((g) => ({ message: g.message, count: g._count._all })),
    pwa: { prompted: count("pwa_install_prompted"), accepted: count("pwa_install_accepted"), installed: count("pwa_installed") },
    feedback: { count: feedback.length, avg: rated.length ? rated.reduce((n, f) => n + (f.rating ?? 0), 0) / rated.length : null, recent: feedback.slice(0, 10) },
  };
}
