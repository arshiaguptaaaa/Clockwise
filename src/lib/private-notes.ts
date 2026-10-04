// Private Ask / Tell Clockwise: a traveller asks Clockwise, in their private room, to pass something on.
//
// What this file does:  PrivateNote rows + notify() + privacy-safe trace events + a plain-language reply.
// What it never does:   post to the group chat (unless the sender said "everyone" and confirmed), create an
//                       Expense, a Settlement or a Pine Labs payment, or put a message body in the Agent Trace.
// A money line is always the SENDER's claim ("Arshia says your share of the hotel is ₹2,000."), never a debt
// Clockwise has verified. It is linked to a shared Expense only when one really matches.
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notifications";
import { getClockwiseUserId } from "@/lib/clockwise";
import { parsePrivateTell, noteHeadline, rupees, type TellIntent } from "@/lib/private-tell";

type TellParsed = Extract<TellIntent, { type: "TELL" }>;
const first = (n: string) => n.trim().split(/\s+/)[0];
const PENDING_WINDOW_MS = 20 * 60_000;

// Trace events carry the KIND of thing that happened and how many people, never the words. PERSONAL scope means
// only the traveller the event is about can open it in their own Agent Trace.
async function trace(tripId: string, kind: string, actorUserId: string, subjectUserId: string, payload: Record<string, unknown>): Promise<string | null> {
  const ev = await prisma.tripEvent
    .create({
      data: { tripId, kind, scope: "PERSONAL", actorUserId, subjectUserId, sourceChannel: "PRIVATE", confidence: "HIGH", payload: JSON.stringify({ ...payload, note: "Message text is not recorded here." }), propagation: "[]" },
      select: { id: true },
    })
    .catch(() => null);
  return ev?.id ?? null;
}

// A shared Expense is only linked when the sender paid it and the recipient's share is exactly the amount claimed.
async function matchingExpense(tripId: string, senderId: string, recipientId: string, amountMinor: number | null, subject: string | null) {
  if (!amountMinor) return null;
  const word = subject?.replace(/^the\s+/i, "").toLowerCase();
  const rows = await prisma.expense.findMany({
    where: { tripId, status: "ACTIVE", paidByUserId: senderId, participants: { some: { userId: recipientId, shareMinor: amountMinor } } },
    select: { id: true, title: true },
    take: 5,
  });
  return rows.find((r) => !word || r.title.toLowerCase().includes(word)) ?? null;
}

async function names(ids: string[]): Promise<Map<string, string>> {
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, first(u.name)]));
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

// One note per recipient, then the in-app notification. notify() never throws.
async function send(tripId: string, senderId: string, t: TellParsed, batchId: string, rowsIds: string[], senderName: string) {
  const rows = await prisma.privateNote.findMany({ where: { id: { in: rowsIds } } });
  const eventId = await trace(tripId, "RECIPIENT_NOTIFICATION_REQUESTED", senderId, senderId, { recipientCount: rows.length, noteKind: t.kind, visibility: rows[0]?.visibility, scope: t.scope, batchId });
  for (const r of rows) {
    await notify({
      tripId,
      recipientIds: [r.recipientId!],
      severity: "IMPORTANT",
      kind: "PRIVATE_NOTE",
      title: `A note from ${first(senderName)}`,
      body: r.headline,
      href: `/trips/${tripId}/agent#notes`,
      eventId,
    });
  }
  await prisma.privateNote.updateMany({ where: { id: { in: rowsIds }, status: "PENDING_CONFIRM" }, data: { status: "SENT" } });
}

async function postToGroup(tripId: string, senderName: string, t: TellParsed) {
  const clockwise = await getClockwiseUserId();
  const line = noteHeadline(senderName, t.message, t.lead, t.kind, t.amountMinor, t.subject);
  // The sender asked for this to be said to everyone; it is attributed to them, not to Clockwise.
  await prisma.message.create({ data: { tripId, senderId: clockwise, channel: "GROUP", content: `${first(senderName)} asked me to pass this on to everyone — ${line}` } });
}

async function createRows(tripId: string, senderId: string, senderName: string, t: TellParsed, status: "SENT" | "PENDING_CONFIRM") {
  const batchId = `b_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const headline = noteHeadline(senderName, t.message, t.lead, t.kind, t.amountMinor, t.subject);
  const visibility = t.scope === "ALL" ? "GROUP_VISIBLE" : "PRIVATE_TO_RECIPIENTS";
  const ids: string[] = [];
  for (const rid of t.recipientIds) {
    const exp = t.kind === "MONEY_TO_SENDER" ? await matchingExpense(tripId, senderId, rid, t.amountMinor, t.subject) : null;
    const row = await prisma.privateNote.create({
      data: { tripId, senderId, recipientId: rid, visibility, kind: t.kind, body: t.message, headline, amountMinor: t.amountMinor, subject: t.subject, expenseId: exp?.id ?? null, status, batchId },
    });
    ids.push(row.id);
  }
  return { batchId, ids, headline };
}

function sentReply(t: TellParsed, rcpt: string[], headline: string, linked: boolean, group: boolean): string {
  const withheld = t.withheld ? " I left out the part you asked me not to mention." : "";
  if (group) return `Done. I've told ${list(rcpt)} and posted it in the Trip Room, with your name on it. They'll read: ${headline}${withheld}`;
  const who = list(rcpt);
  if (t.kind === "NOTE") return `Done. I've sent ${who} a note from you. It isn't in the group chat. They'll read: ${headline}${withheld}`;
  return linked
    ? `Sent to ${who}. They'll read: ${headline} It matches the shared expense in Budget, so I linked it. I haven't asked for a payment.`
    : `Sent to ${who}. They'll read: ${headline} That's your own claim. I haven't created an expense or a payment, and I'm not presenting it to them as a confirmed debt. If it should be in the shared Budget, add it there.`;
}

// What Clockwise keeps for ONE traveller. A PERSONAL-scope event is the same store the private agent already reads
// ("Told privately: ..."); it is visible only to that traveller and never reaches the group.
async function rememberPrivately(tripId: string, userId: string, text: string) {
  await prisma.privateNote.create({ data: { tripId, senderId: userId, recipientId: null, visibility: "PRIVATE_TO_AGENT", kind: "MEMORY", body: text.slice(0, 500), headline: "Kept private", status: "SENT" } });
  await prisma.tripEvent
    .create({ data: { tripId, kind: "PERSONAL_UNDERSTANDING", scope: "PERSONAL", actorUserId: userId, subjectUserId: userId, sourceChannel: "PRIVATE", confidence: "HIGH", payload: JSON.stringify({ category: "PRIVATE_NOTE", value: text.slice(0, 300) }), propagation: "[]" } })
    .catch(() => undefined);
}

// Returns the reply Clockwise should give, or null when this is not a hand-off and the normal private agent
// should answer exactly as before.
export async function handlePrivateTell(tripId: string, senderId: string, text: string): Promise<string | null> {
  const members = await prisma.tripMember.findMany({ where: { tripId }, include: { user: { select: { id: true, name: true } } } });
  const roster = members.map((m) => ({ id: m.userId, name: m.user.name }));
  const me = roster.find((m) => m.id === senderId);
  if (!me) return null;

  const intent = parsePrivateTell(text, roster, senderId);
  if (intent.type === "NONE") return null;

  const pending = await prisma.privateNote.findMany({ where: { tripId, senderId, status: "PENDING_CONFIRM", createdAt: { gt: new Date(Date.now() - PENDING_WINDOW_MS) } }, orderBy: { createdAt: "asc" } });

  if (intent.type === "CONFIRM" || intent.type === "CANCEL") {
    if (pending.length === 0) return null; // a plain "yes" with nothing waiting belongs to the normal agent
    const batchId = pending[0].batchId!;
    const batch = pending.filter((p) => p.batchId === batchId);
    if (intent.type === "CANCEL") {
      await prisma.privateNote.updateMany({ where: { id: { in: batch.map((b) => b.id) } }, data: { status: "CANCELLED" } });
      return "Cancelled. Nothing was sent.";
    }
    const nm = await names(batch.map((b) => b.recipientId!));
    const group = batch[0].visibility === "GROUP_VISIBLE";
    const t = { type: "TELL", scope: group ? "ALL" : "EXCEPT", recipientIds: batch.map((b) => b.recipientId!), excludedIds: [], message: batch[0].body, lead: "says", kind: batch[0].kind as TellParsed["kind"], amountMinor: batch[0].amountMinor, subject: batch[0].subject, needsConfirm: false, withheld: false, keep: null } as TellParsed;
    await send(tripId, senderId, t, batchId, batch.map((b) => b.id), me.name);
    if (group) await postToGroup(tripId, me.name, t);
    return sentReply(t, batch.map((b) => nm.get(b.recipientId!) ?? "them"), batch[0].headline, false, group);
  }

  await trace(tripId, "PRIVATE_AGENT_MESSAGE_RECEIVED", senderId, senderId, { intent: intent.type, ...(intent.type === "TELL" ? { scope: intent.scope, recipientCount: intent.recipientIds.length, noteKind: intent.kind } : {}) });

  if (intent.type === "PROBLEM") {
    if (intent.reason === "SELF") return "That one's to yourself, so there's nobody to pass it to. I'll keep it in mind instead.";
    if (intent.reason === "NO_ONE") return "I couldn't find anyone else to send that to.";
    if (intent.reason === "AMBIGUOUS_NAME") return `Which ${intent.word}: ${list(intent.names)}? I haven't sent anything.`;
    const others = roster.filter((r) => r.id !== senderId).map((r) => first(r.name));
    return `I couldn't match ${list(intent.names)} to anyone on this trip, so I haven't sent anything. On this trip: ${list(others)}.`;
  }

  if (intent.type === "KEEP") {
    if (intent.remember) await rememberPrivately(tripId, senderId, text);
    // "Don't tell anyone" is answered here, in code, so nothing downstream can decide to surface it. A bare
    // "don't tell Ridhima ..." stores nothing and sends nothing.
    if (intent.secret) return intent.remember ? "Understood. That stays between you and me. I won't tell anyone, and I won't bring it up in the group." : "Okay, I won't tell anyone. Nothing was sent and nothing was recorded.";
    return null;
  }

  // TELL
  if (intent.keep) await rememberPrivately(tripId, senderId, intent.keep);
  const keptNote = intent.keep ? " The other thing you said stays private; I haven't passed it on." : "";
  if (pending.length) await prisma.privateNote.updateMany({ where: { id: { in: pending.map((p) => p.id) } }, data: { status: "CANCELLED" } });
  const nm = await names([...intent.recipientIds, ...intent.excludedIds]);
  const rcpt = intent.recipientIds.map((i) => nm.get(i) ?? "them");

  if (intent.needsConfirm) {
    const { headline } = await createRows(tripId, senderId, me.name, intent, "PENDING_CONFIRM");
    if (intent.scope === "ALL") return `This goes to everyone (${list(rcpt)}) and I'll also post it in the Trip Room, so it stops being private. They'd read: ${headline}${keptNote} Send it? Say yes, or cancel.`;
    return `I'll tell ${list(rcpt)}, and only them. ${list(intent.excludedIds.map((i) => nm.get(i) ?? "them"))} won't see it anywhere, and nothing goes in the group chat. They'd read: ${headline}${keptNote} Send it? Say yes, or cancel.`;
  }

  const { batchId, ids, headline } = await createRows(tripId, senderId, me.name, intent, "SENT");
  await send(tripId, senderId, intent, batchId, ids, me.name);
  const linked = (await prisma.privateNote.count({ where: { id: { in: ids }, expenseId: { not: null } } })) > 0;
  return sentReply(intent, rcpt, headline, linked, false) + keptNote;
}

// Called from the private turn runner before the model. True = handled, skip the model.
export async function tryPrivateTell(tripId: string, userId: string): Promise<boolean> {
  try {
    const last = await prisma.message.findFirst({ where: { tripId, channel: "PRIVATE", recipientId: userId }, orderBy: { timestamp: "desc" }, include: { attachments: { select: { id: true } } } });
    if (!last || last.senderId !== userId || last.attachments.length > 0 || last.cardType) return false;
    const reply = await handlePrivateTell(tripId, userId, last.content);
    if (reply === null) return false;
    const clockwise = await getClockwiseUserId();
    await prisma.message.create({ data: { tripId, senderId: clockwise, channel: "PRIVATE", recipientId: userId, content: reply } });
    return true;
  } catch (err) {
    console.error("[private-tell] failed, falling back to the normal private agent:", err instanceof Error ? err.message : err);
    return false;
  }
}

export type NoteForViewer = {
  id: string;
  fromId: string;
  fromName: string;
  kind: string;
  headline: string;
  amountLabel: string | null;
  linked: boolean;
  status: string;
  createdAt: string;
};

export async function notesForViewer(tripId: string, userId: string, opts: { all?: boolean } = {}): Promise<NoteForViewer[]> {
  const rows = await prisma.privateNote.findMany({
    where: opts.all
      ? { tripId, recipientId: userId, status: { in: ["SENT", "DELIVERED", "ACKED", "ASKED"] } }
      : { tripId, recipientId: userId, status: { in: ["SENT", "DELIVERED"] }, createdAt: { gt: new Date(Date.now() - 12 * 3600_000) } },
    orderBy: { createdAt: "desc" },
    take: opts.all ? 12 : 3,
  });
  if (!rows.length) return [];
  const nm = await names(rows.map((r) => r.senderId));
  return rows.map((r) => ({
    id: r.id,
    fromId: r.senderId,
    fromName: nm.get(r.senderId) ?? "Someone",
    kind: r.kind,
    headline: r.headline,
    amountLabel: r.amountMinor ? rupees(r.amountMinor) : null,
    linked: Boolean(r.expenseId),
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function markDelivered(tripId: string, userId: string, ids: string[]) {
  const rows = await prisma.privateNote.findMany({ where: { id: { in: ids }, tripId, recipientId: userId, status: "SENT" } });
  if (!rows.length) return;
  await prisma.privateNote.updateMany({ where: { id: { in: rows.map((r) => r.id) }, status: "SENT" }, data: { status: "DELIVERED" } });
  for (const senderId of [...new Set(rows.map((r) => r.senderId))]) {
    await trace(tripId, "RECIPIENT_NOTIFICATION_DELIVERED", userId, senderId, { surface: "in-app toast", count: rows.filter((r) => r.senderId === senderId).length });
  }
}

export async function acknowledge(tripId: string, userId: string, noteId: string) {
  const row = await prisma.privateNote.findFirst({ where: { id: noteId, tripId, recipientId: userId, status: { in: ["SENT", "DELIVERED"] } } });
  if (!row) return;
  await prisma.privateNote.update({ where: { id: row.id }, data: { status: "ACKED" } });
  await prisma.notification.updateMany({ where: { tripId, userId, kind: "PRIVATE_NOTE", body: row.headline, readAt: null }, data: { readAt: new Date() } });
}

// "ASK ARSHIA": a plain, attributed question back to the sender. It carries the original line and nothing else.
export async function askSender(tripId: string, userId: string, noteId: string) {
  const row = await prisma.privateNote.findFirst({ where: { id: noteId, tripId, recipientId: userId, status: { in: ["SENT", "DELIVERED", "ACKED"] } } });
  if (!row) return;
  const nm = await names([userId, row.senderId]);
  const asker = nm.get(userId) ?? "Someone";
  const headline = `${asker} wants to check this with you: “${row.headline}”`;
  const back = await prisma.privateNote.create({
    data: { tripId, senderId: userId, recipientId: row.senderId, visibility: "PRIVATE_TO_RECIPIENTS", kind: "NOTE", body: headline, headline, status: "SENT", batchId: row.batchId },
  });
  await prisma.privateNote.update({ where: { id: row.id }, data: { status: "ASKED" } });
  const eventId = await trace(tripId, "RECIPIENT_NOTIFICATION_REQUESTED", userId, userId, { recipientCount: 1, noteKind: "NOTE", visibility: "PRIVATE_TO_RECIPIENTS", scope: "PEOPLE", reply: true });
  await notify({ tripId, recipientIds: [row.senderId], severity: "IMPORTANT", kind: "PRIVATE_NOTE", title: `A note from ${asker}`, body: back.headline, href: `/trips/${tripId}/agent#notes`, eventId });
  await prisma.notification.updateMany({ where: { tripId, userId, kind: "PRIVATE_NOTE", body: row.headline, readAt: null }, data: { readAt: new Date() } });
}
