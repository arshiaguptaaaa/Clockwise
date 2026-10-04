// FLIGHT DELAY -> PHYSICAL CONSEQUENCE -> PROACTIVE ACTION.
//
//   WHAT CHANGED?            her arrival                                 (journey, scheduled kept separately)
//   WHERE MUST SHE GET TO?   stay -> meeting point -> next commitment's place (never the city centre by default)
//   WHEN CAN SHE BE THERE?   LANDS AT != AVAILABLE AT: landing + bags & exits (labelled) + PROVIDER route
//   WHAT DOES THAT BREAK?    shared commitments she is part of, read from the stored Plan
//   WHO DOES IT AFFECT?      the commitment's own participants, nobody else
//   WHAT CAN CLOCKWISE DO?   say so, suggest a time that works for the people it can measure, offer INFORM / CANCEL / LEAVE
//   WHAT NEEDS A HUMAN?      moving or cancelling a shared commitment: a vote + the organiser, or the organiser's own word
//
// Everything numeric here is stored state or a provider route; the model only understood the human message.
import { prisma } from "@/lib/prisma";
import { postActionCard } from "@/lib/action-cards";
import { getClockwiseUserId } from "@/lib/clockwise";
import { notify } from "@/lib/notifications";
import { updateMyArrival } from "@/lib/traveller/arrival";
import { resolveNewArrival, ceilToQuarter } from "@/lib/traveller/arrival-rules";
import { buildRendezvousView, appliesTo, ARRIVAL_BUFFER_MIN, recomputeRendezvous, genericLocations } from "@/lib/rendezvous";
import { checkFeasibility } from "@/lib/personal-state";
import { moveCommitmentChecked, cancelCommitmentChecked } from "@/lib/plan/apply";
import { resolveTripLocationText, isResolveFailure } from "@/lib/travel/resolve";
import { humanMoment } from "@/lib/when";
import { timeLabel } from "@/lib/traveller/journey";
import { isAgreement } from "@/lib/pointers/extract";

const toMs = (l: string) => new Date(`${l}:00.000Z`).getTime();
const toLocal = (ms: number) => new Date(ms).toISOString().slice(0, 16);
const first = (n: string) => n.split(/\s+/)[0] ?? n;
const providerName = (p: string | null) => (p === "delhivery" ? "Delhivery" : p === "geoapify" ? "Geoapify" : "the routing provider");
const anchorWords = (kind: string | null, label: string | null) => (kind === "stay" || !kind ? "the stay" : label ?? "the meeting point");

async function ev(tripId: string, kind: string, actorUserId: string | null, subjectUserId: string | null, sourceMessageId: string | null, payload: Record<string, unknown>, propagation: string[] = ["plan", "chat"]) {
  await prisma.tripEvent
    .create({ data: { tripId, kind, scope: "GROUP", actorUserId, subjectUserId, sourceChannel: "GROUP", sourceMessageId, confidence: "HIGH", payload: JSON.stringify(payload), propagation: JSON.stringify(propagation) } })
    .catch(() => undefined);
}

const ids = (json: string): string[] => {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

// ---- answers, in plain words ------------------------------------------------------------------------------

export type ClashAnswer = "AGREE" | "INFORM" | "CANCEL" | "LATER" | "LEAVE";

// "Yeah." answers Clockwise's own question; so do "inform them", "cancel it", "move it later", "leave it".
export function classifyClashAnswer(text: string): ClashAnswer | null {
  const t = text.toLowerCase().replace(/[^\p{L}\p{N}\s:']/gu, " ").replace(/\s+/g, " ").trim();
  if (!t || t.length > 80) return null;
  if (/\b(cancel|call it off|scrap (it|dinner|lunch))\b/.test(t)) return "CANCEL";
  if (/\b(inform|tell them|tell everyone|let them know|let everyone know|notify|warn them|give them a heads up)\b/.test(t)) return "INFORM";
  if (/\b(later|another time|different time|other options|other time|push it|find a later)\b/.test(t)) return "LATER";
  if (/\b(leave it|leave as is|never ?mind|nvm|ignore|keep it|keep dinner|keep lunch|it'?s fine|its fine|don'?t (move|change))\b/.test(t) || /^no\b/.test(t) || /^nope\b/.test(t) || /^not now\b/.test(t)) return "LEAVE";
  if (isAgreement(text) || /^(yeah|yes|yep|yup|sure|ok|okay|do it|go ahead|go for it|please do|sounds good|works|that works|perfect|great|good idea|yes please|yeah please)\b/.test(t) || /\bpropose\b/.test(t)) return "AGREE";
  return null;
}

// ---- the chain ---------------------------------------------------------------------------------------------

export type DisruptionResult = { reply: string | null; clashIds: string[]; resolved: string[] };

async function say(tripId: string, text: string) {
  const clockwiseId = await getClockwiseUserId();
  await prisma.message.create({ data: { tripId, senderId: clockwiseId, channel: "GROUP", content: text } });
}

async function feasibleSuggestion(tripId: string, affected: string[], earliestLocal: string): Promise<{ suggested: string | null; options: string[] }> {
  const good: string[] = [];
  let t = ceilToQuarter(earliestLocal);
  for (let i = 0; i < 16 && good.length < 3; i++, t = toLocal(toMs(t) + 15 * 60_000)) {
    const hhmm = t.slice(11);
    const fz = await checkFeasibility(tripId, hhmm, new Date(`${t.slice(0, 10)}T00:00:00.000Z`), 60).catch(() => ({ conflicts: [] as { userId: string }[] }));
    if (fz.conflicts.some((c) => affected.includes(c.userId))) continue;
    // keep the first, then spaced options at least 30 minutes apart
    if (good.length === 0 || toMs(t) - toMs(good[good.length - 1]) >= 30 * 60_000) good.push(t);
  }
  return { suggested: good[0] ?? null, options: good.slice(1) };
}

// Re-reads the stored Plan against everyone's measured clocks for ONE traveller and raises (or clears) clashes.
export async function evaluateConsequences(p: { tripId: string; userId: string; sourceMessageId: string | null; announce?: boolean }): Promise<DisruptionResult> {
  const { tripId, userId, sourceMessageId } = p;
  const out: DisruptionResult = { reply: null, clashIds: [], resolved: [] };
  const [view, user, commitments, members, trip] = await Promise.all([
    buildRendezvousView(tripId),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    prisma.commitment.findMany({ where: { tripId, status: { not: "CANCELLED" } }, orderBy: { targetTime: "asc" } }),
    prisma.tripMember.findMany({ where: { tripId }, include: { user: { select: { id: true, name: true } } } }),
    prisma.trip.findUnique({ where: { id: tripId }, select: { createdBy: true } }),
  ]);
  const name = user?.name ?? "A traveller";
  const me = first(name);
  const clock = view.clocks.find((c) => c.userId === userId);
  if (!clock) return out;
  const nameOf = new Map(members.map((m) => [m.userId, m.user.name]));
  const mine = commitments.filter((c) => appliesTo(c.participantIds)(userId));

  // WHERE MUST THEY GET TO?
  await ev(tripId, "NEXT_ANCHOR_RESOLVED", userId, userId, sourceMessageId, { traveller: name, anchor: view.stayName, anchorKind: view.anchorKind, order: ["confirmed stay", "meeting point the group named", "location of the next shared commitment"], note: view.anchorKind ? "Never defaults to the city centre." : "No usable anchor yet. Asked instead of guessing." });
  if (clock.status === "NO_STAY") {
    const next = mine[0];
    out.reply = `Where are you heading after the airport, ${me}? I need that to check whether you can still make ${next ? next.name : "the plans"}.`;
    await ev(tripId, "ANCHOR_QUESTION_ASKED", userId, userId, sourceMessageId, { traveller: name, forCommitment: next?.name ?? null });
    return out;
  }
  if (clock.status !== "KNOWN") {
    await ev(tripId, "ROUTE_CALCULATED", userId, userId, sourceMessageId, { traveller: name, ok: false, reason: clock.status, to: view.stayName });
    out.reply = `I couldn't measure the trip from ${clock.arrivalPlace?.replace(/ International Airport$/, "") ?? "where you land"} to ${anchorWords(view.anchorKind, view.stayName)} just now, so I can't tell whether you'll make ${mine[0]?.name ?? "the plans"}. I haven't guessed; I'll check again when a route comes back.`;
    return out;
  }

  // WHEN CAN THEY REALISTICALLY BE THERE?
  const readyAt = clock.hotelBy!;
  const anchorLabel = anchorWords(view.anchorKind, view.stayName);
  await ev(tripId, "ROUTE_CALCULATED", userId, userId, sourceMessageId, { traveller: name, ok: true, provider: clock.routeProvider, from: clock.arrivalPlace, to: view.stayName, anchorKind: view.anchorKind, minutes: clock.routeMinutes, km: clock.routeKm });
  await ev(tripId, "REALISTIC_READY_TIME_UPDATED", userId, userId, sourceMessageId, { traveller: name, concept: "LANDS AT ≠ AVAILABLE AT", landsAt: clock.arriveLocal, scheduledArrival: clock.scheduledArrive, allowanceMin: clock.allowanceMin, allowanceNote: "bags and exits: a stated assumption", routeMinutes: clock.routeMinutes, routeProvider: clock.routeProvider, readyAt, anchor: view.stayName });

  // WHAT DOES THAT BREAK?
  const checks = view.commitments.filter((c) => c.late.some((l) => l.name === name));
  const stillOpen = await prisma.tripClash.findMany({ where: { tripId, travellerId: userId, status: { in: ["OPEN", "INFORMED", "PROPOSED"] } } });
  // a clash that no longer holds (arrival earlier, or the Plan moved) is closed, out loud
  for (const old of stillOpen) {
    if (!checks.some((c) => c.id === old.commitmentId)) {
      await prisma.tripClash.update({ where: { id: old.id }, data: { status: "RESOLVED" } });
      out.resolved.push(old.commitmentName);
    }
  }
  if (out.resolved.length) out.reply = `${me} is back in time for ${out.resolved.join(" and ")} ✓. Nothing needs to move.`;

  for (const chk of checks) {
    const c = commitments.find((x) => x.id === chk.id);
    if (!c) continue;
    const targetLocal = toLocal(c.targetTime.getTime());
    const affectedIds = ids(c.participantIds).length ? ids(c.participantIds) : members.map((m) => m.userId);
    const affectedNames = affectedIds.map((i) => first(nameOf.get(i) ?? "Someone"));
    await ev(tripId, "COMMITMENT_CONFLICT_DETECTED", userId, userId, sourceMessageId, { traveller: name, commitment: c.name, commitmentId: c.id, target: targetLocal, readyAt, slackMinutes: Math.round((toMs(targetLocal) - toMs(readyAt)) / 60_000) });
    await ev(tripId, "AFFECTED_TRAVELLERS_IDENTIFIED", userId, userId, sourceMessageId, { commitment: c.name, affected: affectedNames, ofTrip: members.length, note: ids(c.participantIds).length ? "the commitment's own participants" : "everyone (no participant list)" });

    // the earliest time that works for everyone we can measure, checked against stated limits
    const clocks = view.clocks.filter((k) => affectedIds.includes(k.userId) && k.status === "KNOWN");
    const latestReady = clocks.map((k) => k.hotelBy!).sort().at(-1) ?? readyAt;
    const { suggested, options } = await feasibleSuggestion(tripId, affectedIds, latestReady);
    const unmeasured = view.clocks.filter((k) => affectedIds.includes(k.userId) && k.status !== "KNOWN").map((k) => first(k.name)).concat(members.filter((m) => affectedIds.includes(m.userId) && !view.clocks.some((k) => k.userId === m.userId)).map((m) => first(m.user.name)));

    const prior = stillOpen.find((o) => o.commitmentId === c.id);
    if (prior && prior.status !== "PROPOSED" && prior.readyAt === readyAt && prior.targetLocal === targetLocal) continue; // nothing new to say
    if (prior && prior.status === "PROPOSED") continue; // the group is already deciding it
    if (prior) await prisma.tripClash.update({ where: { id: prior.id }, data: { status: "SUPERSEDED" } });

    const clash = await prisma.tripClash.create({
      data: {
        tripId,
        commitmentId: c.id,
        travellerId: userId,
        commitmentName: c.name,
        targetLocal,
        landsAt: clock.arriveLocal ?? "",
        allowanceMin: clock.allowanceMin,
        routeMinutes: clock.routeMinutes ?? 0,
        routeProvider: clock.routeProvider,
        anchorKind: view.anchorKind ?? "stay",
        anchorLabel: view.stayName ?? "the stay",
        readyAt,
        suggestedLocal: suggested,
        options: JSON.stringify(options),
        affectedIds: JSON.stringify(affectedIds),
      },
    });
    await ev(tripId, "RESOLUTION_SUGGESTED", userId, userId, sourceMessageId, { commitment: c.name, suggested, options, basis: "latest realistic ready time among the people affected, rounded up to a quarter hour, checked against stated time limits", notMeasured: unmeasured, clashId: clash.id, stage: "SUGGESTION", note: "Nothing has moved. A human decides." });

    const context = [
      `${me} won't make the ${timeLabel(targetLocal)} ${c.name}.`,
      `${me}'s flight now lands around ${timeLabel(clock.arriveLocal!)}. After ${clock.allowanceMin} min for bags and exits and about ${clock.routeMinutes} min to ${anchorLabel} (${providerName(clock.routeProvider)}), ${me} can realistically be there around ${timeLabel(readyAt)}.`,
      suggested ? `I can move ${c.name} to ${timeLabel(suggested)}, which works for ${unmeasured.length ? "everyone I can measure" : "everyone"}${unmeasured.length ? ` (not yet measured: ${unmeasured.join(", ")})` : ""}. Should I propose that?` : `I couldn't find a time that works for everyone's stated limits. What should I do?`,
    ].join(" ");
    const msg = await postActionCard({ tripId, channel: "GROUP", type: "DECISION", status: "PENDING", data: { title: "CLOCKWISE CAUGHT A CLASH ✦", context, clash: { clashId: clash.id } } });
    await prisma.tripClash.update({ where: { id: clash.id }, data: { messageId: msg.id } });
    out.clashIds.push(clash.id);
  }
  void trip;
  return out;
}

// One casual message in, the whole chain out. `ready` is "I'll reach the hotel around 10": the implied landing is
// worked back from the stored route and the allowance, never guessed.
export async function handleArrivalChange(p: { tripId: string; userId: string; arrivalTime?: string; arrivalDate?: string; readyTime?: string; readyDate?: string; place?: string; sourceMessageId: string | null }): Promise<DisruptionResult> {
  const { tripId, userId, sourceMessageId } = p;
  const journey = await prisma.travellerJourney.findFirst({ where: { tripId, userId, status: "CONFIRMED" }, orderBy: { createdAt: "desc" } });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  const name = user?.name ?? "A traveller";
  if (!journey) return { reply: `I can't check what that does to the plans until your journey is confirmed. Add it under You → Journey and I'll take it from there.`, clashIds: [], resolved: [] };

  // A different arrival point: resolve it with the same provider logic as everywhere else, then re-measure.
  if (p.place) {
    const r = await resolveTripLocationText(p.place, tripId);
    if (isResolveFailure(r)) return { reply: `I couldn't find "${p.place}" on the map, so I haven't changed where you land. Which airport or station exactly?`, clashIds: [], resolved: [] };
    await prisma.travellerJourney.update({ where: { id: journey.id }, data: { arrivalPlaceName: r.label.split(",")[0], arrivalLat: r.point.lat, arrivalLng: r.point.lng, routeToStayMeters: null, routeToStaySeconds: null, routeComputedAt: null } });
    await ev(tripId, "JOURNEY_UPDATED", userId, userId, sourceMessageId, { traveller: name, change: "arrival point", to: r.label.split(",")[0] });
  }

  let arrivalTime = p.arrivalTime;
  let arrivalDate = p.arrivalDate;
  if (p.readyTime) {
    if (journey.routeToStaySeconds == null) return { reply: `I don't have a measured route to work that back from yet, so I can't turn "at the hotel by ${timeLabel(`2000-01-01T${p.readyTime}`)}" into a landing time. When does your flight land?`, clashIds: [], resolved: [] };
    const date = p.readyDate ?? journey.arriveLocal?.slice(0, 10) ?? "";
    const landMs = toMs(`${date}T${p.readyTime}`) - (ARRIVAL_BUFFER_MIN * 60 + journey.routeToStaySeconds) * 1000;
    arrivalTime = toLocal(landMs).slice(11);
    arrivalDate = toLocal(landMs).slice(0, 10);
  }

  if (arrivalTime) {
    const d = resolveNewArrival(journey.arriveLocal, { arrivalTime, arrivalDate });
    if (!d.ok) return { reply: d.ask.startsWith("That is the arrival time already") ? `That's already the time I have for you.` : `Just to be sure about that time: do you mean morning or evening?`, clashIds: [], resolved: [] };
    await ev(tripId, "TRAVELLER_DELAY_DETECTED", userId, userId, sourceMessageId, { traveller: name, direction: d.movedMinutes >= 0 ? "later" : "earlier", movedMinutes: d.movedMinutes, from: journey.arriveLocal, to: d.newLocal, scheduled: journey.scheduledArriveLocal ?? journey.arriveLocal, recognisedFrom: "an ordinary group message, no @Clockwise needed", stage: "TRIP_STATE_UPDATE" });
    const r = await updateMyArrival({ tripId, userId, arrivalTime, arrivalDate, sourceMessageId, sourceChannel: "GROUP" });
    if (!r.ok) return { reply: `I couldn't update your arrival: ${r.error.replace(/^They /, "You ").slice(0, 160)}`, clashIds: [], resolved: [] };
    await ev(tripId, "JOURNEY_UPDATED", userId, userId, sourceMessageId, { traveller: name, scheduledArrival: journey.scheduledArriveLocal ?? journey.arriveLocal, expectedArrival: r.newArrival, note: "The ticket's scheduled arrival is kept separately; this is a disruption, not an edit." });
  } else if (p.place) {
    await recomputeRendezvous(tripId).catch(() => undefined);
  }
  return evaluateConsequences({ tripId, userId, sourceMessageId });
}

// ---- acting on a clash -----------------------------------------------------------------------------------

async function loadClash(id: string) {
  return prisma.tripClash.findUnique({ where: { id } });
}

export async function proposeClash(clashId: string, actorId: string, chosenLocal?: string | null): Promise<{ ok: boolean; reply: string }> {
  const c = await loadClash(clashId);
  if (!c) return { ok: false, reply: "That clash isn't there any more." };
  if (c.status === "PROPOSED" && c.proposalId) return { ok: true, reply: "That's already with the group for a vote." };
  if (["RESOLVED", "SUPERSEDED"].includes(c.status)) return { ok: false, reply: "That one's already sorted." };
  const allowed = [c.suggestedLocal, ...ids(c.options)].filter(Boolean) as string[];
  const local = chosenLocal && allowed.includes(chosenLocal) ? chosenLocal : c.suggestedLocal;
  if (!local) return { ok: false, reply: "I couldn't find a time that works for everyone's stated limits, so there's nothing I can responsibly propose. You could inform them or cancel it." };
  const traveller = first((await prisma.user.findUnique({ where: { id: c.travellerId }, select: { name: true } }))?.name ?? "A traveller");
  const affected = ids(c.affectedIds);
  const because = `${traveller}'s flight now lands around ${timeLabel(c.landsAt)}, so ${traveller} can realistically reach ${c.anchorKind === "stay" ? "the stay" : c.anchorLabel} around ${timeLabel(c.readyAt)}`;
  const r = await moveCommitmentChecked({ tripId: c.tripId, actorId, commitmentId: c.commitmentId, local, sourceMessageId: null, forceProposal: true, because, voterUserIds: affected });
  if (!r.ok) return { ok: false, reply: r.reply };
  if (r.changed || r.verb !== "proposed") return { ok: true, reply: r.reply };
  await prisma.tripClash.update({ where: { id: c.id }, data: { status: "PROPOSED", proposalId: r.proposalId ?? null, suggestedLocal: local } });
  const names = (await prisma.user.findMany({ where: { id: { in: affected } }, select: { id: true, name: true } })).map((u) => first(u.name));
  await ev(c.tripId, "GROUP_PROPOSAL_CREATED", actorId, c.travellerId, null, { proposalId: r.proposalId, commitment: c.commitmentName, from: c.targetLocal, to: local, voters: names, because, stage: "PROPOSAL", note: "Only the people the commitment involves vote. The Plan changes after they agree and the organiser confirms." }, ["proposals", "notifications", "chat"]);
  return { ok: true, reply: `PROPOSED TO GROUP ✦ Move ${c.commitmentName} to ${timeLabel(local)}. ${names.join(", ")} can accept or decline; ${c.commitmentName} stays at ${timeLabel(c.targetLocal)} until they agree and the organiser confirms.` };
}

export async function informClash(clashId: string, actorId: string): Promise<{ ok: boolean; reply: string }> {
  const c = await loadClash(clashId);
  if (!c) return { ok: false, reply: "That clash isn't there any more." };
  const traveller = first((await prisma.user.findUnique({ where: { id: c.travellerId }, select: { name: true } }))?.name ?? "A traveller");
  const recipients = ids(c.affectedIds).filter((i) => i !== c.travellerId && i !== actorId);
  if (recipients.length === 0) return { ok: true, reply: `There's nobody else on ${c.commitmentName} to tell, so I've left it as it is. You could still propose a new time or cancel it.` };
  await notify({
    tripId: c.tripId,
    recipientIds: recipients,
    severity: "IMPORTANT",
    kind: "CLASH_HEADS_UP",
    title: `${traveller} may not make ${c.commitmentName}`,
    body: `${traveller}'s flight lands around ${timeLabel(c.landsAt)}; the earliest they'd realistically reach ${c.anchorKind === "stay" ? "the stay" : c.anchorLabel} is about ${timeLabel(c.readyAt)}. ${c.commitmentName} is at ${timeLabel(c.targetLocal)}. Nothing has been changed.`,
    href: `/trips/${c.tripId}/room`,
  });
  if (!["PROPOSED", "RESOLVED"].includes(c.status)) await prisma.tripClash.update({ where: { id: c.id }, data: { status: "INFORMED" } });
  const names = (await prisma.user.findMany({ where: { id: { in: recipients } }, select: { name: true } })).map((u) => first(u.name));
  await ev(c.tripId, "AFFECTED_INFORMED", actorId, c.travellerId, null, { commitment: c.commitmentName, informed: names, note: "Only the people the commitment involves. Nothing was moved or cancelled." }, ["notifications"]);
  const place = await prisma.commitment.findUnique({ where: { id: c.commitmentId }, select: { location: true } });
  const generic = await genericLocations(c.tripId);
  const external = place && place.location && !generic.has(place.location.toLowerCase()) && place.location.toLowerCase() !== c.anchorLabel.toLowerCase();
  return { ok: true, reply: `Told ${names.length ? names.join(" and ") : "the people involved"} that ${traveller} may not make ${c.commitmentName}. Nothing has moved.${external ? ` ${place!.location} may also need to know. I can't contact them (no messaging connector is connected), so that part's on you.` : ""}` };
}

export async function leaveClash(clashId: string, actorId: string): Promise<{ ok: boolean; reply: string }> {
  const c = await loadClash(clashId);
  if (!c) return { ok: false, reply: "That clash isn't there any more." };
  if (!["PROPOSED", "RESOLVED"].includes(c.status)) await prisma.tripClash.update({ where: { id: c.id }, data: { status: "LEFT" } });
  await ev(c.tripId, "CLASH_LEFT_AS_IS", actorId, c.travellerId, null, { commitment: c.commitmentName, note: "A human chose to leave the Plan as it is." }, ["chat"]);
  return { ok: true, reply: `Leaving ${c.commitmentName} at ${timeLabel(c.targetLocal)}. It stays flagged on the Plan.` };
}

export async function cancelClash(clashId: string, actorId: string): Promise<{ ok: boolean; reply: string }> {
  const c = await loadClash(clashId);
  if (!c) return { ok: false, reply: "That clash isn't there any more." };
  const r = await cancelCommitmentChecked({ tripId: c.tripId, actorId, commitmentId: c.commitmentId });
  if (r.ok && r.changed) {
    await prisma.tripClash.updateMany({ where: { commitmentId: c.commitmentId, status: { in: ["OPEN", "INFORMED", "PROPOSED"] } }, data: { status: "RESOLVED" } });
    await ev(c.tripId, "PLAN_UPDATED", actorId, null, null, { change: "cancelled", commitment: c.commitmentName, by: "the organiser", readBack: true }, ["plan", "rendezvous"]);
  }
  return { ok: r.ok, reply: r.reply };
}

export async function laterClash(clashId: string): Promise<{ ok: boolean; reply: string }> {
  const c = await loadClash(clashId);
  if (!c) return { ok: false, reply: "That clash isn't there any more." };
  const opts = ids(c.options);
  if (opts.length === 0) return { ok: true, reply: `That's the latest slot I can check against everyone's stated limits (${c.suggestedLocal ? timeLabel(c.suggestedLocal) : "none"}). You could inform them or leave it.` };
  const [next, ...rest] = opts;
  await prisma.tripClash.update({ where: { id: c.id }, data: { suggestedLocal: next, options: JSON.stringify(rest) } });
  return { ok: true, reply: `How about ${timeLabel(next)} instead? Should I propose that?` };
}

// "Yeah." Natural answers to the question Clockwise just asked. Returns null when nothing is waiting.
export async function answerClashFromChat(tripId: string, userId: string, text: string): Promise<{ reply: string } | null> {
  const answer = classifyClashAnswer(text);
  if (!answer) return null;
  // "cancel tomorrow's breakfast" / "move dinner to 10" name another day or time: that is a plan command, not an answer.
  if (/\b(tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\d/.test(text)) return null;
  const open = await prisma.tripClash.findMany({ where: { tripId, status: { in: ["OPEN", "INFORMED"] }, updatedAt: { gt: new Date(Date.now() - 6 * 3600_000) } }, orderBy: { createdAt: "desc" } });
  if (open.length === 0) return null;
  let target = open[0];
  if (open.length > 1) {
    const named = open.filter((c) => text.toLowerCase().includes(c.commitmentName.toLowerCase().split(" ").pop() ?? "~"));
    if (named.length === 1) target = named[0];
    else return { reply: `Which one: ${open.map((c) => `${c.commitmentName} (${timeLabel(c.targetLocal)})`).join(" or ")}?` };
  }
  const r = answer === "AGREE" ? await proposeClash(target.id, userId) : answer === "INFORM" ? await informClash(target.id, userId) : answer === "CANCEL" ? await cancelClash(target.id, userId) : answer === "LATER" ? await laterClash(target.id) : await leaveClash(target.id, userId);
  return { reply: r.reply };
}

export { humanMoment };
