// When someone can't make a proposed time, Clockwise coordinates the disagreement
// instead of just counting a "no".
//   1. Gemini only INTERPRETS the traveller's own words into a structured limit
//      (latest end / earliest start / a time they'd rather have).
//   2. Deterministic code does the rest: it stores the limit as a PRIVATE
//      constraint, then searches for the earliest time that works for every
//      traveller's provider-computed clock AND every active limit.
// The group sees the EFFECT ("Eva is unavailable after 10:30 PM"), never the cause
// or the traveller's words (see personal-state.ts groupSafeLine).
import { GoogleGenAI } from "@google/genai";
import { prisma } from "./prisma";
import { getClockwiseUserId } from "./clockwise";
import { buildRendezvousView, appliesTo } from "./rendezvous";
import { ceilToQuarter } from "./traveller/arrival-rules";
import { timeLabel } from "./traveller/journey";
import { conflictsAt, formatTime12, groupSafeLine, parseHHMM, recordPersonalConstraint, type ConstraintKind } from "./personal-state";
import { castApprovalVote, createProposal, decodeProposalPayload } from "./proposals";

// A labelled assumption, not a fact: how long a shared sitting (dinner etc.) takes.
export const SITTING_MINUTES = 60;

export type DeclineReading = { kind: ConstraintKind | null; time: string | null; preferred: string | null; source: "gemini" | "rules" };

// "9:30", "9.30pm", "930 pm" -> HH:MM, with am/pm disambiguated against the proposed time
// (an evening proposal means an unmarked "10:30" is 22:30).
export function toHHMM(raw: string, proposedHHMM: string): string | null {
  const m = /(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i.exec(raw);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 24 || min > 59) return null;
  const mer = m[3]?.toLowerCase().replace(/\./g, "");
  if (mer === "pm" && h < 12) h += 12;
  else if (mer === "am" && h === 12) h = 0;
  else if (!mer && h <= 12) {
    const proposedH = Number(proposedHHMM.slice(0, 2));
    if (proposedH >= 12 && h < 12) h += 12;
  }
  if (h === 24) h = 0;
  const out = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  return parseHHMM(out) == null ? null : out;
}

// Deterministic fallback reading, used when Gemini is unavailable or returns junk.
export function readDeclineByRules(reason: string, proposedHHMM: string): DeclineReading {
  const text = reason.toLowerCase();
  const time = /(\d{1,2}(?:[:.]\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)/.exec(text)?.[1];
  const hhmm = time ? toHHMM(time, proposedHHMM) : null;
  if (!hhmm) return { kind: null, time: null, preferred: null, source: "rules" };
  if (/\b(make it|how about|can we do|could we do|instead)\b/.test(text)) return { kind: null, time: null, preferred: hhmm, source: "rules" };
  if (/\b(not before|not until|can'?t (do )?before|cannot (do )?before|earliest|only after)\b/.test(text)) return { kind: "EARLIEST_START", time: hhmm, preferred: null, source: "rules" };
  if (/\b(leave|gotta go|go home|out by|done by|before|by|until|till|no later than|at most)\b/.test(text)) return { kind: "LATEST_END", time: hhmm, preferred: null, source: "rules" };
  if (/\b(after|from)\b/.test(text)) return { kind: "EARLIEST_START", time: hhmm, preferred: null, source: "rules" };
  return { kind: null, time: null, preferred: null, source: "rules" };
}

export async function interpretDeclineReason(reason: string, proposedHHMM: string): Promise<DeclineReading> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL || "gemini-flash-lite-latest",
        config: { responseMimeType: "application/json" },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `A traveller was asked to accept a plan at ${proposedHHMM} (24-hour). They replied: "${reason.slice(0, 300)}".
Return JSON with EXACTLY these keys: {"kind":"LATEST_END"|"EARLIEST_START"|null,"time":"HH:MM"|null,"preferred":"HH:MM"|null}
- LATEST_END: they must be finished/leave by "time" (24-hour).
- EARLIEST_START: they can't start before "time".
- preferred: a time they ASKED for instead ("make it 9:30").
Use 24-hour times; an unmarked clock time in the evening is PM. Use null when the reply states no time. Output nothing else.`,
              },
            ],
          },
        ],
      });
      const o = JSON.parse(response.text ?? "") as Record<string, unknown>;
      const t = (v: unknown) => (typeof v === "string" && parseHHMM(v) != null ? v.padStart(5, "0") : null);
      const kind = o.kind === "LATEST_END" || o.kind === "EARLIEST_START" ? (o.kind as ConstraintKind) : null;
      const reading: DeclineReading = { kind: kind && t(o.time) ? kind : null, time: kind ? t(o.time) : null, preferred: t(o.preferred), source: "gemini" };
      if (reading.kind || reading.preferred) return reading;
    } catch {
      // fall through to rules
    }
  }
  return readDeclineByRules(reason, proposedHHMM);
}

export type CounterResult =
  | { ok: true; time: string; floor: string | null; assumption: string }
  | { ok: false; blockers: string[] };

// Earliest quarter-hour time, after every applicable traveller's provider-computed
// "at the stay by" time, that also respects every active limit, skipping times that
// were already put to the group.
export async function findCounterTime(tripId: string, commitmentId: string, skipTimes: string[], preferred?: string | null): Promise<CounterResult> {
  const commitment = await prisma.commitment.findUnique({ where: { id: commitmentId } });
  if (!commitment || commitment.tripId !== tripId) return { ok: false, blockers: ["That plan item no longer exists."] };
  const target = commitment.targetTime.toISOString().slice(0, 16);
  const day = target.slice(0, 10);
  const view = await buildRendezvousView(tripId);
  const applies = appliesTo(commitment.participantIds);
  const clocks = view.clocks.filter((c) => applies(c.userId) && c.status === "KNOWN");
  const floor = clocks.length ? ceilToQuarter(clocks.map((c) => c.hotelBy!).sort().at(-1)!) : null;

  const constraints = await prisma.travellerConstraint.findMany({ where: { tripId, status: "ACTIVE" } });
  const names = new Map((await prisma.user.findMany({ where: { id: { in: constraints.map((c) => c.userId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const date = new Date(`${day}T00:00:00.000Z`);
  const mine = constraints.filter((c) => applies(c.userId));

  // Never earlier than the original time (moving it earlier helps nobody) or than
  // the moment the last traveller can be at the stay.
  const from = floor && floor.slice(0, 10) === day && floor > target ? floor : target;
  const startMs = Date.parse(`${from}:00.000Z`);
  const tryTime = (ms: number) => new Date(ms).toISOString().slice(0, 16);
  const works = (local: string) => !skipTimes.includes(local) && local >= (floor ?? "") && conflictsAt(mine, local.slice(11), date, SITTING_MINUTES).length === 0;

  if (preferred) {
    const local = `${day}T${preferred}`;
    if (works(local)) return { ok: true, time: local, floor, assumption: `assuming a ${SITTING_MINUTES}-minute sitting` };
  }
  for (let ms = startMs; ms < startMs + 6 * 3600_000; ms += 15 * 60_000) {
    const local = tryTime(ms);
    if (local.slice(0, 10) !== day) break;
    if (works(local)) return { ok: true, time: local, floor, assumption: `assuming a ${SITTING_MINUTES}-minute sitting` };
  }
  const blockers = [
    ...clocks.filter((c) => c.hotelBy! > target).map((c) => `${c.name} can't be at the stay before ${timeLabel(c.hotelBy!)}`),
    ...mine.map((c) => groupSafeLine(names.get(c.userId) ?? "Someone", c.kind, c.localTime)),
  ];
  return { ok: false, blockers: [...new Set(blockers)] };
}

// Records a traveller's limit privately, then proposes another time if one works.
// Returns a line for the person who objected (private) and, if a counter exists, its id.
export async function handleDecline(params: { proposalId: string; userId: string; reason: string }): Promise<{ privateReply: string; counterProposalId: string | null }> {
  const proposal = await prisma.proposal.findUnique({ where: { id: params.proposalId } });
  if (!proposal) return { privateReply: "I couldn't find that proposal.", counterProposalId: null };
  const payload = decodeProposalPayload(proposal.payload);
  const r = payload.reschedule;
  const clockwiseId = await getClockwiseUserId();
  const user = await prisma.user.findUnique({ where: { id: params.userId }, select: { name: true } });
  const firstName = (user?.name ?? "Someone").split(" ")[0];
  const proposedHHMM = r ? r.newTime.slice(11) : "20:00";

  const reading = await interpretDeclineReason(params.reason, proposedHHMM);
  let learned = "";
  if (reading.kind && reading.time) {
    const day = r ? new Date(`${r.newTime.slice(0, 10)}T00:00:00.000Z`) : null;
    const saved = await recordPersonalConstraint({
      tripId: proposal.tripId,
      subjectUserId: params.userId,
      actorUserId: params.userId,
      channel: "PRIVATE",
      kind: reading.kind,
      localTime: reading.time,
      onDate: day,
      note: params.reason.slice(0, 300),
      sourceMessageId: null,
      confidence: "MEDIUM",
    });
    if (saved.ok) learned = reading.kind === "LATEST_END" ? `I've noted you need to be done by ${formatTime12(reading.time)}.` : `I've noted you can't start before ${formatTime12(reading.time)}.`;
  }

  if (!r) {
    return { privateReply: learned ? `${learned} The group sees only that you can't make it.` : "Noted. The group sees that you can't make it.", counterProposalId: null };
  }

  // Times already put to the group in this chain are not offered again.
  const skip = new Set<string>([r.newTime]);
  let cursor = proposal.supersedesId;
  while (cursor) {
    const prior = await prisma.proposal.findUnique({ where: { id: cursor } });
    if (!prior) break;
    try {
      const pr = decodeProposalPayload(prior.payload).reschedule;
      if (pr) skip.add(pr.newTime);
    } catch {
      // ignore
    }
    cursor = prior.supersedesId;
  }

  const counter = await findCounterTime(proposal.tripId, r.commitmentId, [...skip], reading.preferred);
  if (!counter.ok) {
    await prisma.message.create({
      data: {
        tripId: proposal.tripId,
        senderId: clockwiseId,
        channel: "GROUP",
        content: `${firstName} can't make ${timeLabel(r.newTime)}, and I can't find a time that works for everyone yet${counter.blockers.length ? `: ${counter.blockers.join("; ")}` : ""}. Worth a quick chat — tell me a time and I'll check it.`,
      },
    });
    return { privateReply: `${learned} I couldn't find a time that works for everyone yet — I've told the group, without your reason.`.trim(), counterProposalId: null };
  }

  const old = proposal;
  const created = await createProposal({
    tripId: proposal.tripId,
    type: "OTHER",
    title: `Move ${r.commitmentName} to ${timeLabel(counter.time)}?`,
    summary: `${firstName} can't make ${timeLabel(r.newTime)}. ${timeLabel(counter.time)} works for everyone's clocks${counter.floor ? ` (the last traveller is at the stay by ${timeLabel(counter.floor)})` : ""}, ${counter.assumption}.`,
    payload: {
      timing: `${timeLabel(r.oldTime)} → ${timeLabel(counter.time)}`,
      reschedule: { commitmentId: r.commitmentId, commitmentName: r.commitmentName, oldTime: r.oldTime, newTime: counter.time, because: r.because },
    },
    createdBy: clockwiseId,
    supersedesId: old.id,
  });
  const message = await prisma.message.create({
    data: { tripId: proposal.tripId, senderId: clockwiseId, channel: "GROUP", content: `Proposal: ${created.title} — one more try.` },
  });
  await prisma.proposal.update({ where: { id: created.id }, data: { groupMessageId: message.id } });
  // The earlier ask is replaced, not left open beside the new one.
  await prisma.proposal.updateMany({ where: { id: old.id, status: { in: ["AWAITING_APPROVAL", "APPROVED", "REJECTED"] } }, data: { status: "CANCELLED" } });
  await prisma.auditLog.create({
    data: { tripId: proposal.tripId, actorId: clockwiseId, actionType: "PROPOSAL_COUNTER_PROPOSED", payloadSummary: `"${old.title}" (${old.id}) replaced by "${created.title}" (${created.id}) after an objection.` },
  });
  await prisma.tripEvent.create({
    data: {
      tripId: proposal.tripId,
      kind: "COMMITMENT_RESCHEDULE_COUNTER",
      scope: "GROUP",
      actorUserId: params.userId,
      sourceChannel: "SYSTEM",
      confidence: "HIGH",
      payload: JSON.stringify({ commitment: r.commitmentName, rejectedTime: r.newTime, proposedTime: counter.time, reasonSource: reading.source, proposalId: created.id }),
      propagation: JSON.stringify(["proposals", "notifications"]),
    },
  });
  return { privateReply: `${learned} I've asked the group about ${timeLabel(counter.time)} instead — they'll see that you couldn't do ${timeLabel(r.newTime)}, not why.`.trim(), counterProposalId: created.id };
}

// The whole "I can't" path: the vote is recorded first and always stands; the reason (the
// traveller's own words) is optional, stays private to them and to Clockwise's maths, and
// Clockwise then looks for another time that works for everyone.
export async function declineWithReason(proposalId: string, userId: string, reason: string) {
  const text = reason.trim();
  const vote = await castApprovalVote(proposalId, userId, "REJECTED", text || null);
  if (!vote.ok) return vote;
  let counterProposalId: string | null = null;
  let privateReply: string | null = null;
  if (text) {
    const handled = await handleDecline({ proposalId, userId, reason: text });
    counterProposalId = handled.counterProposalId;
    privateReply = handled.privateReply;
    const proposal = await prisma.proposal.findUnique({ where: { id: proposalId }, select: { tripId: true } });
    if (proposal) {
      await prisma.message.create({
        data: { tripId: proposal.tripId, senderId: await getClockwiseUserId(), channel: "PRIVATE", recipientId: userId, content: handled.privateReply },
      });
    }
  }
  return { ok: true as const, proposalStatus: vote.proposalStatus, counterProposalId, privateReply };
}
