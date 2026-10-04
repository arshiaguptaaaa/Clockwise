import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentMember } from "@/lib/trip";

export const dynamic = "force-dynamic";

// A cheap "has anything changed for me?" fingerprint, polled by <LiveSync/> so a vote
// or a new message shows up on everyone's screen without a manual refresh. It returns
// counts and timestamps only - no content - and only counts what this member may see
// (group activity plus their own private activity). This is short polling, not a
// socket; the interval is chosen in the client.
export async function GET(_req: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const session = await getCurrentMember(tripId);
  if (!session) return NextResponse.json({ error: "Not a member of this trip." }, { status: 401 });
  const me = session.member.userId;

  const [msgs, props, votes, events, notifs, journeys] = await Promise.all([
    prisma.message.aggregate({
      where: { tripId, OR: [{ channel: "GROUP" }, { recipientId: me }, { senderId: me }] },
      _count: true,
      _max: { timestamp: true },
    }),
    prisma.proposal.aggregate({ where: { tripId }, _count: true, _max: { updatedAt: true } }),
    prisma.proposalApproval.aggregate({ where: { proposal: { tripId }, decision: { not: "PENDING" } }, _count: true, _max: { respondedAt: true } }),
    prisma.tripEvent.aggregate({
      where: { tripId, OR: [{ scope: "GROUP" }, { actorUserId: me }, { subjectUserId: me }] },
      _count: true,
      _max: { createdAt: true },
    }),
    prisma.notification.aggregate({ where: { tripId, userId: me }, _count: true }),
    prisma.travellerJourney.aggregate({ where: { tripId }, _count: true, _max: { updatedAt: true } }),
  ]);

  const t = (d: Date | null | undefined) => (d ? d.getTime() : 0);
  const signature = [
    msgs._count, t(msgs._max.timestamp),
    props._count, t(props._max.updatedAt),
    votes._count, t(votes._max.respondedAt),
    events._count, t(events._max.createdAt),
    notifs._count,
    journeys._count, t(journeys._max.updatedAt),
  ].join(".");

  return NextResponse.json({ signature }, { headers: { "Cache-Control": "no-store" } });
}
