import { prisma } from "@/lib/prisma";

// Organiser-only: sanitised rail calls plus the agent decisions each one belongs to.
export async function loadRailEvidence(tripId: string) {
  const rows = await prisma.railCall.findMany({ where: { tripId }, orderBy: { createdAt: "asc" } });
  const out = [];
  for (const r of rows) {
    let decisions: { kind: string; at: string; note?: string }[] = [];
    let related: string | null = null;
    if (r.relatedKind === "MESSAGE" && r.relatedId) {
      const msg = await prisma.message.findUnique({ where: { id: r.relatedId }, select: { timestamp: true } });
      related = `Message sent from this voice note (${msg?.timestamp.toISOString() ?? "?"})`;
      const ev = await prisma.tripEvent.findMany({ where: { tripId, sourceMessageId: r.relatedId }, orderBy: { createdAt: "asc" }, select: { kind: true, createdAt: true } });
      decisions = ev.map((e) => ({ kind: e.kind, at: e.createdAt.toISOString() }));
    } else if (r.relatedKind === "BOOKING" && r.relatedId) {
      const b = await prisma.booking.findUnique({ where: { id: r.relatedId }, select: { status: true, amount: true, currency: true, sourceProposalId: true } });
      related = `Booking ${r.relatedId} (${b?.status ?? "?"}${b?.amount != null ? `, ${b.amount} minor ${b.currency}` : ""})`;
      if (b?.sourceProposalId) {
        const pr = await prisma.proposal.findUnique({ where: { id: b.sourceProposalId }, select: { title: true, status: true } });
        if (pr) decisions.push({ kind: "PROPOSAL", at: "", note: `${pr.title} — ${pr.status}` });
      }
      const ev = await prisma.tripEvent.findMany({ where: { tripId, payload: { contains: r.relatedId } }, orderBy: { createdAt: "asc" }, select: { kind: true, createdAt: true } });
      decisions.push(...ev.map((e) => ({ kind: e.kind, at: e.createdAt.toISOString() })));
    }
    out.push({
      id: r.id,
      at: r.createdAt.toISOString(),
      partner: r.partner,
      operation: r.operation,
      method: r.method,
      endpoint: r.endpoint,
      httpStatus: r.httpStatus,
      providerRequestId: r.providerRequestId,
      durationMs: r.durationMs,
      request: safeParse(r.requestJson),
      response: r.responseJson ? safeParse(r.responseJson) : null,
      decisionNote: r.decision,
      related,
      decisions,
    });
  }
  return out;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
