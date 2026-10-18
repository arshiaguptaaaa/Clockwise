import { prisma } from "@/lib/prisma";

// Product analytics for the disruption loop. Fire-and-forget: a failed write is logged and swallowed so
// analytics can never break a trip action. Props are small counters and ids, never message text.
export const LOOP_EVENTS = ["clash_detected", "clash_proposed", "vote_cast", "plan_updated"] as const;
export type LoopEvent = (typeof LOOP_EVENTS)[number];

type TrackInput = {
  userId?: string | null;
  tripId?: string | null;
  experiment?: string | null;
  variant?: string | null;
  props?: Record<string, string | number | boolean | null>;
  // Set to count something once per subject, e.g. `${clashId}:${userId}` for an exposure.
  dedupeKey?: string;
};

// A proposal that came from a clash card belongs to the disruption loop; any other proposal is tracked too, but
// the funnel on /admin/insights only counts the ones with a clashId.
export async function clashIdForProposal(proposalId: string): Promise<string | null> {
  try {
    return (await prisma.tripClash.findFirst({ where: { proposalId }, select: { id: true } }))?.id ?? null;
  } catch {
    return null;
  }
}

export async function trackEvent(name: string, input: TrackInput = {}): Promise<void> {
  try {
    await prisma.productEvent.create({
      data: {
        name,
        userId: input.userId ?? null,
        tripId: input.tripId ?? null,
        experiment: input.experiment ?? null,
        variant: input.variant ?? null,
        props: input.props ? JSON.stringify(input.props) : null,
        dedupeKey: input.dedupeKey ? `${name}:${input.dedupeKey}` : null,
      },
    });
  } catch (err) {
    // A duplicate dedupeKey (P2002) is the normal "already counted" case.
    if ((err as { code?: string })?.code !== "P2002") console.error("trackEvent failed:", name, err);
  }
}
