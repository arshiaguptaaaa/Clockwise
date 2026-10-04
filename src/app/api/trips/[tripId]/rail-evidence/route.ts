import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { loadRailEvidence } from "@/lib/rails/view";

// Organiser-only JSON export of the sanitised rail calls, for the Ken submission.
export async function GET(_req: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const userId = await getCurrentUserId();
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { createdBy: true } });
  if (!userId || !trip || trip.createdBy !== userId) return NextResponse.json({ error: "Organiser only." }, { status: 403 });
  return NextResponse.json({ note: "Sanitised: keys, Authorization headers, client secrets, tokens and cookies are redacted; contact details are masked.", calls: await loadRailEvidence(tripId) });
}
