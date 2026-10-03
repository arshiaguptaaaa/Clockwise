import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";

// Signed-in trip members only. Shows, for the trip's recent emails:
//   INTENDED RECIPIENT -> ACTUAL DELIVERY RECIPIENT -> Resend's own last_event
// so "Invitation sent" is never inferred from an Invite row. Provider status is
// fetched live from Resend by message id.
export async function GET(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const tripId = request.nextUrl.searchParams.get("tripId") ?? "";
  const member = await prisma.tripMember.findFirst({ where: { tripId, userId }, select: { id: true } });
  if (!member) return NextResponse.json({ error: "Not on this trip." }, { status: 403 });

  const rows = await prisma.emailLog.findMany({ where: { tripId }, orderBy: { createdAt: "desc" }, take: 10 });
  const key = process.env.RESEND_API_KEY;
  const out = [];
  for (const r of rows) {
    let providerStatus: string | null = null;
    let providerTo: string[] | null = null;
    if (key && r.providerMessageId) {
      try {
        const res = await fetch(`https://api.resend.com/emails/${r.providerMessageId}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
        const e = (await res.json().catch(() => ({}))) as { last_event?: string; to?: string[] };
        providerStatus = res.ok ? (e.last_event ?? "unknown") : `lookup_http_${res.status}`;
        providerTo = e.to ?? null;
      } catch {
        providerStatus = "lookup_failed";
      }
    }
    out.push({
      kind: r.kind,
      intendedRecipient: r.intendedRecipient,
      deliveryRecipient: r.deliveryRecipient,
      redirected: r.overridden,
      ourStatus: r.status,
      failureReason: r.failureReason,
      providerMessageId: r.providerMessageId,
      resendTo: providerTo,
      resendLastEvent: providerStatus,
      createdAt: r.createdAt,
    });
  }
  return NextResponse.json({
    deliveryOverrideActive: Boolean(process.env.EMAIL_DELIVERY_OVERRIDE?.trim() || process.env.WAITLIST_EMAIL_TEST_RECIPIENT?.trim()),
    emails: out,
  });
}
