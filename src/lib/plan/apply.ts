// The ONLY door through which chat changes the Plan. Every function persists, then READS THE ROW BACK from the
// database, and only a successful read-back is reported as success. Clockwise's chat acknowledgement is built
// from what this returns, never from what the model hoped happened.
//
//   message -> parsePlanCommand -> (authority) -> write -> read back -> TripEvent -> notify -> recompute
//
// Authority: anyone may ADD a plan item. MOVING or CANCELLING an item that other people are part of needs the
// organiser (who is the final authority everywhere else too) or a vote: for anyone else, Clockwise opens a group
// proposal and the Plan stays untouched until it is agreed and confirmed. A person may change their own personal
// items directly.
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notifications";
import { createProposal } from "@/lib/proposals";
import { getClockwiseUserId } from "@/lib/clockwise";
import { recomputeRendezvous } from "@/lib/rendezvous";
import { timeLabel } from "@/lib/traveller/journey";
import { humanMoment, localNow } from "@/lib/when";
import { getTripStay } from "@/lib/stays";
import { getTripById } from "@/lib/trip";
import { parsePlanCommand, type PlanCommand, type PlanCtx, matchCommitment } from "./parse";

const toDate = (local: string) => new Date(`${local}:00.000Z`);
const localOf = (d: Date) => d.toISOString().slice(0, 16);

export type ApplyResult =
  | { ok: true; changed: true; verb: "added" | "moved" | "cancelled"; commitmentId: string; name: string; at: string; before?: string; reply: string; persisted: { name: string; at: string; status: string } }
  | { ok: true; changed: false; verb: "already" | "proposed" | "asked"; reply: string; proposalId?: string }
  | { ok: false; reply: string };

export async function buildPlanCtx(tripId: string, speakerId: string): Promise<PlanCtx> {
  const trip = await getTripById(tripId);
  const [rows, stay] = await Promise.all([prisma.commitment.findMany({ where: { tripId, status: { not: "CANCELLED" } }, orderBy: { targetTime: "asc" } }), getTripStay(tripId)]);
  const dest = [...trip.destinations].sort((a, b) => a.order - b.order)[0];
  return {
    now: localNow(),
    window: { start: trip.coreStartDate ? trip.coreStartDate.toISOString().slice(0, 10) : null, end: trip.coreEndDate ? trip.coreEndDate.toISOString().slice(0, 10) : null },
    speakerId,
    members: trip.members.map((m) => ({ userId: m.userId, name: m.user.name })),
    commitments: rows.map((c) => ({ id: c.id, name: c.name, target: localOf(c.targetTime), participantIds: safeIds(c.participantIds) })),
    defaultLocation: stay?.placeName ?? dest?.name ?? "To be decided",
  };
}

function safeIds(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function event(tripId: string, kind: string, actorUserId: string, sourceMessageId: string | null, payload: Record<string, unknown>) {
  await prisma.tripEvent
    .create({
      data: {
        tripId,
        kind,
        scope: "GROUP",
        actorUserId,
        sourceChannel: "GROUP",
        sourceMessageId,
        confidence: "HIGH",
        payload: JSON.stringify(payload),
        propagation: JSON.stringify(["plan", "chat", "live-sync", "notifications"]),
      },
    })
    .catch(() => undefined);
}

async function tellOthers(tripId: string, actorId: string, title: string, body: string) {
  const members = await prisma.tripMember.findMany({ where: { tripId }, select: { userId: true } });
  await notify({ tripId, recipientIds: members.map((m) => m.userId).filter((id) => id !== actorId), severity: "IMPORTANT", kind: "PLAN_UPDATED", title, body, href: `/trips/${tripId}/plan` });
}

const who = async (id: string) => (await prisma.user.findUnique({ where: { id }, select: { name: true } }))?.name?.split(" ")[0] ?? "Someone";

export async function createCommitmentChecked(params: { tripId: string; actorId: string; name: string; local: string; location: string; participantIds: string[] | null; sourceMessageId?: string | null; guessed?: boolean; dayAssumed?: boolean }): Promise<ApplyResult> {
  const { tripId, actorId } = params;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(params.local) || Number.isNaN(toDate(params.local).getTime())) return { ok: false, reply: "I couldn't read that date and time, so I haven't changed the Plan. When exactly?" };
  const name = params.name.trim().slice(0, 80);
  if (!name) return { ok: false, reply: "What's it called? I haven't added anything to the Plan yet." };

  // The same item at the same moment is already there: say so instead of adding it twice.
  const existing = await prisma.commitment.findMany({ where: { tripId, status: { not: "CANCELLED" }, targetTime: toDate(params.local) } });
  const dupe = existing.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (dupe) return { ok: true, changed: false, verb: "already", reply: `${dupe.name} is already in the Plan for ${humanMoment(params.local)}.` };

  let created;
  try {
    created = await prisma.commitment.create({ data: { tripId, name, targetTime: toDate(params.local), location: params.location.trim().slice(0, 120) || "To be decided", participantIds: JSON.stringify(params.participantIds ?? []) } });
  } catch (err) {
    console.error("[plan] create failed:", err instanceof Error ? err.message : err);
    return { ok: false, reply: "I couldn't update the Plan, so nothing was added. Try again in a moment." };
  }
  // READ-BACK: the claim below is made from the database row, not from the input.
  const stored = await prisma.commitment.findUnique({ where: { id: created.id } });
  if (!stored || stored.status === "CANCELLED") return { ok: false, reply: "I couldn't confirm that the Plan changed, so I'm not going to say it did. Please check the Plan and try again." };
  const at = localOf(stored.targetTime);

  const by = await who(actorId);
  await event(tripId, "COMMITMENT_ADDED", actorId, params.sourceMessageId ?? null, { commitmentId: stored.id, name: stored.name, at, location: stored.location, by, via: "chat", participants: params.participantIds ?? "everyone", readBack: true });
  await tellOthers(tripId, actorId, `${stored.name} added`, `${by} added ${stored.name} · ${humanMoment(at)}.`);
  await recomputeRendezvous(tripId).catch(() => undefined);

  const note = params.dayAssumed ? ` I took that as ${humanMoment(at).split(",")[0]}; tell me if you meant another day.` : "";
  return {
    ok: true,
    changed: true,
    verb: "added",
    commitmentId: stored.id,
    name: stored.name,
    at,
    reply: `Added to the Plan: ${stored.name} · ${humanMoment(at)}. It's saved and everyone can see it.${note}`,
    persisted: { name: stored.name, at, status: stored.status },
  };
}

async function organiserOf(tripId: string) {
  return (await prisma.trip.findUnique({ where: { id: tripId }, select: { createdBy: true } }))?.createdBy ?? null;
}

export async function moveCommitmentChecked(params: { tripId: string; actorId: string; commitmentId: string; local: string; sourceMessageId?: string | null; guessed?: boolean; forceProposal?: boolean }): Promise<ApplyResult> {
  const { tripId, actorId } = params;
  const c = await prisma.commitment.findUnique({ where: { id: params.commitmentId } });
  if (!c || c.tripId !== tripId || c.status === "CANCELLED") return { ok: false, reply: "That isn't in the Plan any more, so there's nothing to move." };
  const before = localOf(c.targetTime);
  if (before === params.local) return { ok: true, changed: false, verb: "already", reply: `${c.name} is already at ${humanMoment(before)}.` };
  if (Number.isNaN(toDate(params.local).getTime())) return { ok: false, reply: "I couldn't read that time, so nothing moved." };

  const organiser = await organiserOf(tripId);
  const participants = safeIds(c.participantIds);
  const personal = participants.length > 0 && participants.every((id) => id === actorId);
  if (params.forceProposal || (actorId !== organiser && !personal)) {
    const clockwiseId = await getClockwiseUserId();
    const by = await who(actorId);
    const open = await prisma.proposal.findMany({ where: { tripId, status: { in: ["AWAITING_APPROVAL", "APPROVED"] } }, select: { id: true, payload: true } });
    const dup = open.find((p) => {
      try {
        const r = (JSON.parse(p.payload) as { reschedule?: { commitmentId: string; newTime: string } }).reschedule;
        return r?.commitmentId === c.id && r.newTime === params.local;
      } catch {
        return false;
      }
    });
    if (dup) return { ok: true, changed: false, verb: "asked", reply: `That move is already waiting for everyone's vote.`, proposalId: dup.id };
    const because = `${by} asked for it`;
    const proposal = await createProposal({
      tripId,
      type: "OTHER",
      title: `Move ${c.name} to ${timeLabel(params.local)}?`,
      summary: `${by} would like ${c.name} at ${timeLabel(params.local)} instead of ${timeLabel(before)}.`,
      payload: { timing: `${timeLabel(before)} → ${timeLabel(params.local)}`, reschedule: { commitmentId: c.id, commitmentName: c.name, oldTime: before, newTime: params.local, because } },
      createdBy: clockwiseId,
    });
    const msg = await prisma.message.create({ data: { tripId, senderId: clockwiseId, channel: "GROUP", content: `Proposal: ${proposal.title}` } });
    await prisma.proposal.update({ where: { id: proposal.id }, data: { groupMessageId: msg.id } });
    await event(tripId, "COMMITMENT_RESCHEDULE_PROPOSED", actorId, params.sourceMessageId ?? null, { commitment: c.name, commitmentId: c.id, oldTime: before, proposedTime: params.local, because, proposalId: proposal.id, via: "chat" });
    return { ok: true, changed: false, verb: "proposed", proposalId: proposal.id, reply: `${c.name} is shared, so I've put "${proposal.title}" to the group instead of changing it. The Plan stays at ${timeLabel(before)} until everyone's in and ${await who(organiser ?? actorId)} confirms.` };
  }

  try {
    await prisma.commitment.update({ where: { id: c.id }, data: { targetTime: toDate(params.local) } });
  } catch (err) {
    console.error("[plan] move failed:", err instanceof Error ? err.message : err);
    return { ok: false, reply: "I couldn't update the Plan, so nothing moved. Try again in a moment." };
  }
  const stored = await prisma.commitment.findUnique({ where: { id: c.id } });
  if (!stored || localOf(stored.targetTime) !== params.local) return { ok: false, reply: "I couldn't confirm that the Plan changed, so I'm not going to say it did. Please check the Plan and try again." };
  const by = await who(actorId);
  await event(tripId, "COMMITMENT_RESCHEDULED", actorId, params.sourceMessageId ?? null, { commitment: stored.name, commitmentId: stored.id, oldTime: before, newTime: params.local, why: "asked in chat by the organiser", via: "chat", readBack: true });
  await tellOthers(tripId, actorId, `${stored.name} moved to ${timeLabel(params.local)}`, `${by} moved it from ${timeLabel(before)}.`);
  await recomputeRendezvous(tripId).catch(() => undefined);
  return { ok: true, changed: true, verb: "moved", commitmentId: stored.id, name: stored.name, at: params.local, before, reply: `Moved ${stored.name} from ${timeLabel(before)} to ${humanMoment(params.local)}. It's saved in the Plan.`, persisted: { name: stored.name, at: params.local, status: stored.status } };
}

export async function cancelCommitmentChecked(params: { tripId: string; actorId: string; commitmentId: string; sourceMessageId?: string | null }): Promise<ApplyResult> {
  const { tripId, actorId } = params;
  const c = await prisma.commitment.findUnique({ where: { id: params.commitmentId } });
  if (!c || c.tripId !== tripId || c.status === "CANCELLED") return { ok: false, reply: "That isn't in the Plan any more." };
  const at = localOf(c.targetTime);
  const organiser = await organiserOf(tripId);
  const participants = safeIds(c.participantIds);
  const personal = participants.length > 0 && participants.every((id) => id === actorId);
  if (actorId !== organiser && !personal) {
    const clockwiseId = await getClockwiseUserId();
    const by = await who(actorId);
    const proposal = await createProposal({
      tripId,
      type: "OTHER",
      title: `Cancel ${c.name}?`,
      summary: `${by} would like to cancel ${c.name} (${timeLabel(at)}).`,
      payload: { timing: timeLabel(at), cancel: { commitmentId: c.id, commitmentName: c.name, at } },
      createdBy: clockwiseId,
    });
    const msg = await prisma.message.create({ data: { tripId, senderId: clockwiseId, channel: "GROUP", content: `Proposal: ${proposal.title}` } });
    await prisma.proposal.update({ where: { id: proposal.id }, data: { groupMessageId: msg.id } });
    return { ok: true, changed: false, verb: "proposed", proposalId: proposal.id, reply: `${c.name} is a shared plan, so I've asked the group rather than removing it. It stays in the Plan until it's agreed and confirmed.` };
  }
  try {
    await prisma.commitment.update({ where: { id: c.id }, data: { status: "CANCELLED" } });
  } catch (err) {
    console.error("[plan] cancel failed:", err instanceof Error ? err.message : err);
    return { ok: false, reply: "I couldn't update the Plan, so nothing was cancelled. Try again in a moment." };
  }
  const stored = await prisma.commitment.findUnique({ where: { id: c.id } });
  if (!stored || stored.status !== "CANCELLED") return { ok: false, reply: "I couldn't confirm that the Plan changed, so I'm not going to say it did." };
  const by = await who(actorId);
  await event(tripId, "COMMITMENT_CANCELLED", actorId, params.sourceMessageId ?? null, { commitment: stored.name, commitmentId: stored.id, at, via: "chat", readBack: true });
  await tellOthers(tripId, actorId, `${stored.name} cancelled`, `${by} took it out of the Plan.`);
  return { ok: true, changed: true, verb: "cancelled", commitmentId: stored.id, name: stored.name, at, reply: `Cancelled ${stored.name} (${humanMoment(at)}). It's out of the Plan.`, persisted: { name: stored.name, at, status: stored.status } };
}

// The deterministic router. Returns null when the message isn't a plan command (the model then handles it).
export async function runPlanCommand(tripId: string, speakerId: string, text: string, sourceMessageId: string | null): Promise<{ command: PlanCommand; result: ApplyResult | null } | null> {
  const ctx = await buildPlanCtx(tripId, speakerId);
  const cmd = parsePlanCommand(text, ctx);
  if (!cmd) return null;
  if (cmd.kind === "clarify" || cmd.kind === "ambiguous") return { command: cmd, result: { ok: true, changed: false, verb: "asked", reply: cmd.question } };
  if (cmd.kind === "create") {
    return { command: cmd, result: await createCommitmentChecked({ tripId, actorId: speakerId, name: cmd.name, local: `${cmd.date}T${cmd.time}`, location: cmd.location, participantIds: cmd.participantIds, sourceMessageId, guessed: cmd.guessed, dayAssumed: cmd.dayAssumed }) };
  }
  if (cmd.kind === "move") {
    return { command: cmd, result: await moveCommitmentChecked({ tripId, actorId: speakerId, commitmentId: cmd.commitmentId, local: `${cmd.date}T${cmd.time}`, sourceMessageId, guessed: cmd.guessed }) };
  }
  return { command: cmd, result: await cancelCommitmentChecked({ tripId, actorId: speakerId, commitmentId: cmd.commitmentId, sourceMessageId }) };
}

export { matchCommitment };
