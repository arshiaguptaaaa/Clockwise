import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

// A cheap "has anything changed for me?" fingerprint, polled by <LiveSync/> so a vote or a
// new message shows up on everyone's screen without a manual refresh. It returns counts and
// timestamps only - no content - and only counts what this member may see (group activity
// plus their own private activity). This is short polling, not a socket.
//
// The database has a small per-role connection limit, so this is ONE statement on ONE
// connection (not several parallel aggregates), and identical polls inside a second or two
// share one answer per server instance.
const cache = new Map<string, { at: number; signature: string }>();
const TTL_MS = 1500;

export async function GET(_req: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const me = await getCurrentUserId();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const key = `${tripId}:${me}`;
  const hit = cache.get(key);
  // Membership is part of the cache key's validity: only a cached answer for a verified member is ever reused.
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json({ signature: hit.signature }, { headers: { "Cache-Control": "no-store" } });

  const member = await prisma.tripMember.findUnique({ where: { tripId_userId: { tripId, userId: me } }, select: { id: true } });
  if (!member) return NextResponse.json({ error: "Not a member of this trip." }, { status: 401 });

  const rows = await prisma.$queryRaw<{ sig: string }[]>`
    SELECT concat_ws('.',
      (SELECT COUNT(*) FROM "Message" WHERE "tripId" = ${tripId} AND ("channel"::text = 'GROUP' OR "recipientId" = ${me} OR "senderId" = ${me})),
      (SELECT COALESCE(FLOOR(EXTRACT(EPOCH FROM MAX("timestamp")) * 1000), 0) FROM "Message" WHERE "tripId" = ${tripId} AND ("channel"::text = 'GROUP' OR "recipientId" = ${me} OR "senderId" = ${me})),
      (SELECT COUNT(*) FROM "Proposal" WHERE "tripId" = ${tripId}),
      (SELECT COALESCE(FLOOR(EXTRACT(EPOCH FROM MAX("updatedAt")) * 1000), 0) FROM "Proposal" WHERE "tripId" = ${tripId}),
      (SELECT COUNT(*) FROM "ProposalApproval" a JOIN "Proposal" p ON p."id" = a."proposalId" WHERE p."tripId" = ${tripId} AND a."decision"::text <> 'PENDING'),
      (SELECT COALESCE(FLOOR(EXTRACT(EPOCH FROM MAX(a."respondedAt")) * 1000), 0) FROM "ProposalApproval" a JOIN "Proposal" p ON p."id" = a."proposalId" WHERE p."tripId" = ${tripId}),
      (SELECT COUNT(*) FROM "TripEvent" WHERE "tripId" = ${tripId} AND ("scope"::text = 'GROUP' OR "actorUserId" = ${me} OR "subjectUserId" = ${me})),
      (SELECT COALESCE(FLOOR(EXTRACT(EPOCH FROM MAX("createdAt")) * 1000), 0) FROM "TripEvent" WHERE "tripId" = ${tripId} AND ("scope"::text = 'GROUP' OR "actorUserId" = ${me} OR "subjectUserId" = ${me})),
      (SELECT COUNT(*) FROM "MessageReaction" r JOIN "Message" m ON m."id" = r."messageId" WHERE m."tripId" = ${tripId}),
      (SELECT COUNT(*) FROM "PaymentObligation" WHERE "tripId" = ${tripId} AND "status" = 'PAID'),
      (SELECT COALESCE(FLOOR(EXTRACT(EPOCH FROM MAX("updatedAt")) * 1000), 0) FROM "PaymentObligation" WHERE "tripId" = ${tripId}),
      (SELECT COUNT(*) FROM "Notification" WHERE "tripId" = ${tripId} AND "userId" = ${me}),
      (SELECT COALESCE(md5(string_agg("id" || "targetTime"::text || "status"::text || "location", ',' ORDER BY "id")), '0') FROM "Commitment" WHERE "tripId" = ${tripId}),
      (SELECT COALESCE(FLOOR(EXTRACT(EPOCH FROM MAX("updatedAt")) * 1000), 0) FROM "TripClash" WHERE "tripId" = ${tripId}),
      (SELECT COUNT(*) FROM "TripPointer" WHERE "tripId" = ${tripId}),
      (SELECT COALESCE(FLOOR(EXTRACT(EPOCH FROM MAX("updatedAt")) * 1000), 0) FROM "TripPointer" WHERE "tripId" = ${tripId}),
      (SELECT COALESCE(FLOOR(EXTRACT(EPOCH FROM MAX("updatedAt")) * 1000), 0) FROM "TripSuggestion" WHERE "tripId" = ${tripId}),
      (SELECT COUNT(*) FROM "TravellerJourney" WHERE "tripId" = ${tripId}),
      (SELECT COALESCE(FLOOR(EXTRACT(EPOCH FROM MAX("updatedAt")) * 1000), 0) FROM "TravellerJourney" WHERE "tripId" = ${tripId})
    ) AS sig`;
  const signature = rows[0]?.sig ?? "";
  cache.set(key, { at: Date.now(), signature });
  if (cache.size > 200) cache.clear();
  return NextResponse.json({ signature }, { headers: { "Cache-Control": "no-store" } });
}
