// DB-backed regression: real Prisma, real server code, a THROWAWAY local Postgres, stubbed provider HTTP.
//
//   DATABASE_URL=postgresql://cw@localhost:5499/clockwise_test npx tsx scripts/regression/integration.ts
//
// It refuses to run against anything that is not a local test database, so it can never touch production. Providers
// (Geoapify routing, Pine Labs) are answered by a fetch stub; nothing leaves the machine.
import assert from "node:assert/strict";
import Module from "node:module";

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1):\d+\/[\w-]*test[\w-]*/i.test(url)) {
  console.error("Refusing to run: DATABASE_URL must be a local database whose name contains 'test'.");
  process.exit(2);
}
process.env.GEOAPIFY_API_KEY = "test-key";
// Prisma's client loads .env on import, which would hand these tests real keys. Setting them to "" first means nothing real is
// configured: no email, no push, no Gemini, no Delhivery. (And the fetch stub below refuses every host it doesn't know.)
for (const k of ["DELHIVERY_MAPS_TOKEN", "NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "RESEND_API_KEY", "GEMINI_API_KEY", "GNANI_API_KEY", "GNANI_SPEECH_API_KEY", "UBER_CLIENT_SECRET", "BLOB_READ_WRITE_TOKEN", "WAITLIST_EMAIL_TEST_RECIPIENT"]) process.env[k] = "";
process.env.PINELABS_BASE_URL = "https://pine.test";
process.env.PINELABS_CLIENT_ID = "cid-test";
process.env.PINELABS_CLIENT_SECRET = "csecret-test";
process.env.PINELABS_WEBHOOK_SECRET = Buffer.from("webhook-test-secret").toString("base64");

// next/cache needs a request context; outside one it is a no-op.
let sessionUser: string | null = null; // who "is signed in" for server actions and routes
const M = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const origLoad = M._load;
M._load = function (request: string, ...rest: unknown[]) {
  if (request === "next/headers") return { cookies: async () => ({ get: (n: string) => (n === "clockwise_user_id" && sessionUser ? { value: sessionUser } : undefined), set() {}, delete() {} }), headers: async () => new Headers() };
  if (request === "next/cache") return { revalidatePath() {}, revalidateTag() {}, unstable_cache: (f: unknown) => f };
  return origLoad.call(this, request, ...rest);
};

// ---- provider stubs --------------------------------------------------------------------------------------------
let routeMode: "ok" | "429" | "500" = "ok";
let pineLink: { status: string; amount: number; currency: string; id: string; ref: string | null } | null = null;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = String(input);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  if (u.startsWith("https://api.geoapify.com/v1/routing")) {
    if (routeMode === "429") return json({ message: "rate limited" }, 429);
    if (routeMode === "500") return json({ message: "boom" }, 500);
    return json({ features: [{ properties: { distance: 20000, time: 1920 }, geometry: { type: "LineString", coordinates: [[77.7, 13.2], [77.59, 12.97]] } }] });
  }
  if (u.startsWith("https://api.geoapify.com/v2/places")) {
    const f = (id: string, name: string, cuisine: string, lng: number, lat: number) => ({ properties: { place_id: id, name, formatted: `${name}, Bengaluru`, categories: ["catering.restaurant"], distance: 600, datasource: { raw: { cuisine } } }, geometry: { coordinates: [lng, lat] } });
    return json({ features: [f("p1", "Vidyarthi Bhavan Dosa Corner", "dosa;south_indian", 77.572, 12.943), f("p2", "Koshy's", "continental", 77.601, 12.975), f("p3", "Truffles Burger Cafe", "burger", 77.6, 12.971), f("p4", "Udupi Grand", "south_indian;dosa", 77.58, 12.96)] });
  }
  if (u.startsWith("https://pine.test/api/auth/v1/token")) return json({ access_token: "tok", expires_in: 3600 });
  if (u === "https://pine.test/api/pay/v1/paymentlink" && init?.method === "POST") {
    const body = JSON.parse(String(init.body ?? "{}")) as { merchant_payment_link_reference?: string; amount?: { value?: number; currency?: string } };
    pineLink = { status: "CREATED", amount: body.amount?.value ?? 0, currency: body.amount?.currency ?? "INR", id: `pl-v1-stub-${Math.random().toString(36).slice(2, 8)}`, ref: body.merchant_payment_link_reference ?? null };
    return json({ payment_link_id: pineLink.id, payment_link: `https://pine.test/pay/${pineLink.id}`, status: "CREATED" }, 201);
  }
  if (u.startsWith("https://pine.test/api/pay/v1/paymentlink/") && (init?.method ?? "GET") === "GET" && pineLink) {
    return json({ payment_link_id: pineLink.id, merchant_payment_link_reference: pineLink.ref, status: pineLink.status, amount: { value: pineLink.amount, currency: pineLink.currency } });
  }
  if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u)) return realFetch(input, init);
  // Anything else would leave the machine: refuse it, loudly.
  throw new Error(`network blocked in tests: ${u.slice(0, 80)}`);
}) as typeof fetch;

let passed = 0;
let failed = 0;
async function t(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}\n     ${err instanceof Error ? err.message.split("\n").slice(0, 16).join("\n     ") : String(err)}`);
  }
}

async function main() {
  const { prisma } = await import("../../src/lib/prisma");
  const { localNow } = await import("../../src/lib/when");
  const { handlePrivateTell, notesForViewer, acknowledge, askSender } = await import("../../src/lib/private-notes");
  const { groupDietFor } = await import("../../src/lib/travel/place-search");
  const disruption = await import("../../src/lib/disruption");
  const { handleTravellerStatus } = await import("../../src/lib/traveller/status");
  const { parseTravellerStatus } = await import("../../src/lib/traveller/status-parse");
  const proposals = await import("../../src/lib/proposals");
  const { voteFromChat } = await import("../../src/lib/chat-vote");
  const { payDirectiveReply, selfReportedReply } = await import("../../src/lib/agent/money-talk");
  const { refreshTripPaymentStatus } = await import("../../src/lib/trip-payments");
  const { createExpense } = await import("../../src/lib/budget/ledger");

  // ---- world ---------------------------------------------------------------------------------------------------
  const clockwise = await prisma.user.create({ data: { name: "Clockwise" } });
  const mk = (name: string) => prisma.user.create({ data: { name, email: `${name.toLowerCase()}@example.test` } });
  const [A, R, S] = [await mk("Arshia Gupta"), await mk("Ridhima Sharma"), await mk("Shreya Rao")];
  const trip = await prisma.trip.create({ data: { name: "Test trip", status: "PLANNING", createdBy: A.id, coreStartDate: new Date("2026-10-05"), coreEndDate: new Date("2026-10-11") } });
  for (const u of [A, R, S]) await prisma.tripMember.create({ data: { tripId: trip.id, userId: u.id, role: u.id === A.id ? "ORGANIZER" : "TRAVELLER" } });
  await prisma.destination.create({ data: { tripId: trip.id, name: "Bengaluru", displayName: "Bengaluru, Karnataka, India", country: "India", order: 0, latitude: 12.97, longitude: 77.59, startDate: new Date("2026-10-05"), endDate: new Date("2026-10-11") } });
  const stay = await prisma.booking.create({ data: { tripId: trip.id, type: "STAY", status: "CONFIRMED", participantIds: "[]", provider: "geoapify", placeName: "JW Marriott", latitude: 12.97, longitude: 77.59 } });

  const toLocal = (ms: number) => new Date(ms).toISOString().slice(0, 16);
  const nowL = localNow();
  const nowMs = Date.parse(`${nowL.date}T${nowL.time}:00Z`);
  const journeys: Record<string, string> = {};
  async function journey(u: { id: string }, arriveMs: number, departMs: number) {
    const j = await prisma.travellerJourney.create({
      data: { tripId: trip.id, userId: u.id, mode: "FLIGHT", status: "CONFIRMED", source: "MANUAL", carrier: "IndiGo", originName: "Delhi", destinationName: "Bengaluru", departLocal: toLocal(departMs), arriveLocal: toLocal(arriveMs), scheduledArriveLocal: toLocal(arriveMs), arrivalPlaceName: "Kempegowda", arrivalLat: 13.2, arrivalLng: 77.7, routeToStayMeters: 20000, routeToStaySeconds: 1920, routeProvider: "geoapify", routeComputedAt: new Date(), routeStayBookingId: stay.id },
    });
    journeys[u.id] = j.id;
    return j;
  }
  // Ridhima landed 30 minutes ago (3h flight); dinner is in 40 minutes (she can be at the stay in 17, but not in 47); everyone else is already there.
  await journey(R, nowMs - 30 * 60_000, nowMs - 210 * 60_000);
  await journey(A, nowMs - 5 * 3600_000, nowMs - 8 * 3600_000);
  await journey(S, nowMs - 4 * 3600_000, nowMs - 7 * 3600_000);
  let dinner = await prisma.commitment.create({ data: { tripId: trip.id, name: "Birthday Dinner", targetTime: new Date(`${toLocal(nowMs + 40 * 60_000)}:00.000Z`), location: "Bengaluru", participantIds: "[]" } });
  const setDinner = async (ms: number) => {
    dinner = await prisma.commitment.update({ where: { id: dinner.id }, data: { targetTime: new Date(`${toLocal(ms)}:00.000Z`) } });
  };

  const notifFor = (u: { id: string }) => prisma.notification.findMany({ where: { tripId: trip.id, userId: u.id } });
  const groupMsgs = () => prisma.message.findMany({ where: { tripId: trip.id, channel: "GROUP" }, orderBy: { timestamp: "asc" } });
  const tell = (u: { id: string }, text: string) => handlePrivateTell(trip.id, u.id, text);

  // ============================== 1. PRIVATE TELL: privacy ===============================
  await t("tell: a note reaches ONLY the named person, names the sender, and never touches the group chat", async () => {
    const before = (await groupMsgs()).length;
    const reply = await tell(A, "Tell Ridhima I want vegetarian food for dinner.");
    assert.match(reply ?? "", /sent Ridhima a note/);
    const n = await notifFor(R);
    assert.equal(n.length, 1);
    assert.equal(n[0].title, "A note from Arshia");
    assert.equal(n[0].body, "Arshia wants vegetarian food for dinner.");
    assert.equal((await notifFor(S)).length, 0);
    assert.equal((await notifFor(A)).length, 0);
    assert.equal((await groupMsgs()).length, before);
  });
  await t("tell: trace events carry no message text, are PERSONAL to the sender, and the recipient sees none", async () => {
    const evs = await prisma.tripEvent.findMany({ where: { tripId: trip.id, kind: { in: ["PRIVATE_AGENT_MESSAGE_RECEIVED", "RECIPIENT_NOTIFICATION_REQUESTED"] } } });
    assert.ok(evs.length >= 2);
    for (const e of evs) {
      assert.equal(e.scope, "PERSONAL");
      assert.equal(e.subjectUserId, A.id);
      assert.ok(!/vegetarian|dinner/i.test(e.payload), e.payload);
    }
  });
  await t("tell: money is the sender's claim — no expense, settlement, payment request, or obligation is created", async () => {
    const reply = await tell(A, "Tell Ridhima she owes me ₹2,000 for the hotel.");
    assert.match(reply ?? "", /own claim/);
    const note = (await prisma.privateNote.findMany({ where: { recipientId: R.id, kind: "MONEY_TO_SENDER" } }))[0];
    assert.equal(note.headline, "Arshia says your share of the hotel is ₹2,000.");
    assert.equal(note.expenseId, null);
    assert.equal(await prisma.expense.count({ where: { tripId: trip.id } }), 0);
    assert.equal(await prisma.settlement.count({ where: { tripId: trip.id } }), 0);
    assert.equal(await prisma.paymentObligation.count({ where: { tripId: trip.id } }), 0);
    assert.equal(await prisma.booking.count({ where: { tripId: trip.id, type: "PAYMENT_REQUEST" } }), 0);
  });
  await t("tell: a claim is linked to a shared expense only when one genuinely matches (sender paid, exact share)", async () => {
    const e = await createExpense({ tripId: trip.id, actorUserId: A.id, title: "Hotel", amountMinor: 400000, currency: "INR", stage: "PAID", status: "ACTIVE", paidByUserId: A.id, source: "MANUAL", splitMethod: "EXACT", participants: [{ userId: A.id, value: 200000 }, { userId: R.id, value: 200000 }] });
    assert.ok(e.ok);
    await tell(A, "Tell Ridhima she owes me ₹2,000 for the hotel.");
    const linked = await prisma.privateNote.findMany({ where: { recipientId: R.id, kind: "MONEY_TO_SENDER", expenseId: { not: null } } });
    assert.equal(linked.length, 1);
    // still no NEW financial records from the message itself
    assert.equal(await prisma.settlement.count({ where: { tripId: trip.id } }), 0);
    await prisma.expense.deleteMany({ where: { tripId: trip.id } });
  });
  await t("tell: 'just remember / don't tell anyone' notify NOBODY; a bare 'don't tell Ridhima she owes me' sends and stores nothing", async () => {
    const nR = (await notifFor(R)).length;
    const notes = await prisma.privateNote.count({ where: { tripId: trip.id } });
    assert.equal(await tell(A, "Just remember that I like vegetarian food."), null); // falls through to the private agent
    assert.match((await tell(A, "Don't tell anyone, but remember that I want vegetarian food.")) ?? "", /stays between you and me/);
    assert.match((await tell(A, "Don't tell Ridhima she owes me ₹2,000.")) ?? "", /nothing was recorded/i);
    assert.equal((await notifFor(R)).length, nR);
    assert.equal((await notifFor(S)).length, 0);
    const added = await prisma.privateNote.findMany({ where: { tripId: trip.id, kind: "MEMORY" } });
    assert.equal(added.length, 2); // the two 'remember' lines; the bare 'don't tell' stored nothing
    assert.ok(added.every((a) => a.visibility === "PRIVATE_TO_AGENT" && a.recipientId === null));
    assert.equal(await prisma.privateNote.count({ where: { tripId: trip.id } }) - notes, 2);
    assert.equal(await prisma.expense.count({ where: { tripId: trip.id } }), 0);
  });
  await t("tell: 'but don't mention why' sends only the intended part; the reason is never stored or delivered", async () => {
    await tell(A, "Tell Ridhima I need ten minutes, but don't mention why.");
    const notes = await prisma.privateNote.findMany({ where: { recipientId: R.id }, orderBy: { createdAt: "desc" }, take: 1 });
    assert.equal(notes[0].body, "I need ten minutes");
    assert.equal(notes[0].headline, "Arshia needs ten minutes.");
    const all = JSON.stringify(await prisma.notification.findMany({ where: { tripId: trip.id } })) + JSON.stringify(await prisma.privateNote.findMany({ where: { tripId: trip.id } }));
    assert.ok(!/mention why|don't mention/i.test(all));
  });
  await t("tell: a second, private instruction in the same message stays private", async () => {
    await tell(A, "Tell Ridhima I'm vegetarian. Also remember I hate crowded places.");
    const blob = JSON.stringify(await notifFor(R)) + JSON.stringify(await prisma.privateNote.findMany({ where: { recipientId: R.id } }));
    assert.ok(!/crowded/i.test(blob));
    const mem = await prisma.privateNote.findMany({ where: { senderId: A.id, kind: "MEMORY", body: { contains: "crowded" } } });
    assert.equal(mem.length, 1);
    assert.equal(mem[0].recipientId, null);
    // only the sender's own Agent Trace can carry it (PERSONAL scope, subject = sender)
    const pe = await prisma.tripEvent.findMany({ where: { tripId: trip.id, kind: "PERSONAL_UNDERSTANDING" } });
    assert.ok(pe.length >= 1 && pe.every((e) => e.scope === "PERSONAL" && e.subjectUserId === A.id));
  });
  await t("tell: everyone-except previews the exact recipients, waits for yes, and excludes the left-out person from EVERY surface", async () => {
    const gBefore = (await groupMsgs()).length;
    const nBefore = (await notifFor(R)).length;
    const nS = (await notifFor(S)).length;
    const preview = await tell(A, "Let everyone except Ridhima know we're arranging her birthday surprise");
    assert.match(preview ?? "", /tell Shreya, and only them/);
    assert.match(preview ?? "", /Ridhima won't see it anywhere/);
    assert.equal((await notifFor(S)).length, nS, "nothing is delivered before confirmation");
    const pending = await prisma.privateNote.findMany({ where: { status: "PENDING_CONFIRM" } });
    assert.deepEqual(pending.map((p) => p.recipientId), [S.id]);
    const done = await tell(A, "yes");
    assert.match(done ?? "", /sent Shreya a note/);
    assert.equal((await notifFor(S)).length, nS + 1);
    assert.equal((await notifFor(R)).length, nBefore, "the excluded person gets nothing");
    assert.equal((await groupMsgs()).length, gBefore, "and nothing is posted to the group");
    assert.equal((await notesForViewer(trip.id, R.id, { all: true })).filter((n) => /surprise/i.test(n.headline)).length, 0);
    const rEvents = await prisma.tripEvent.findMany({ where: { tripId: trip.id, OR: [{ subjectUserId: R.id }, { actorUserId: R.id }] } });
    assert.ok(!rEvents.some((e) => /surprise/i.test(e.payload)));
  });
  await t("tell: cancelling the preview sends nothing", async () => {
    const nS = (await notifFor(S)).length;
    await tell(A, "Let everyone except Ridhima know dinner is at 9");
    assert.match((await tell(A, "cancel")) ?? "", /Nothing was sent/);
    assert.equal((await notifFor(S)).length, nS);
  });
  await t("tell: @all is group-visible only after confirmation, attributed to the sender, and posted once", async () => {
    const g0 = (await groupMsgs()).length;
    assert.match((await tell(A, "Tell @all I'll be downstairs at 7.")) ?? "", /stops being private/);
    assert.equal((await groupMsgs()).length, g0);
    await tell(A, "yes");
    const g = await groupMsgs();
    assert.equal(g.length, g0 + 1);
    assert.match(g[g.length - 1].content, /Arshia asked me to pass this on to everyone/);
  });
  await t("tell: unknown or duplicate names are asked about, not guessed; a bare 'yes' with nothing pending is not ours", async () => {
    assert.match((await tell(A, "Tell Priya I'm running late")) ?? "", /couldn't match Priya/);
    assert.equal(await tell(A, "yes"), null);
    assert.match((await tell(A, "Tell Arshia hi")) ?? "", /to yourself/);
  });
  await t("tell: a recipient can only read, acknowledge and ask about THEIR OWN notes", async () => {
    const mine = await notesForViewer(trip.id, R.id, { all: true });
    assert.ok(mine.length >= 3 && mine.every((n) => n.fromId === A.id));
    assert.equal((await notesForViewer(trip.id, A.id, { all: true })).length, 0);
    const theirs = mine[0].id;
    await acknowledge(trip.id, S.id, theirs); // not S's note
    assert.notEqual((await prisma.privateNote.findUnique({ where: { id: theirs } }))?.status, "ACKED");
    await acknowledge(trip.id, R.id, theirs);
    assert.equal((await prisma.privateNote.findUnique({ where: { id: theirs } }))?.status, "ACKED");
    const money = mine.find((n) => n.kind === "MONEY_TO_SENDER")!;
    await askSender(trip.id, R.id, money.id);
    const back = (await notifFor(A)).filter((n) => n.kind === "PRIVATE_NOTE");
    assert.equal(back.length, 1);
    assert.match(back[0].body, /Ridhima wants to check this with you/);
    assert.equal(await prisma.expense.count({ where: { tripId: trip.id } }), 0);
  });
  await t("a private Vibe Check answer never reaches a group explanation; a group-visible one may", async () => {
    await prisma.travellerPreference.create({ data: { tripId: trip.id, userId: S.id, key: "FOOD", value: "VEGETARIAN", visibility: "PRIVATE", source: "VIBE_CHECK" } });
    assert.equal(await groupDietFor(trip.id), null);
    await prisma.travellerPreference.create({ data: { tripId: trip.id, userId: R.id, key: "FOOD", value: "VEGETARIAN", visibility: "GROUP", source: "CHAT" } });
    const g = await groupDietFor(trip.id);
    assert.deepEqual(g?.names, ["Ridhima"]);
    await prisma.travellerPreference.deleteMany({ where: { tripId: trip.id } });
  });

  // ============================== 2. THE CLOCK: stale proposals, corrections ==============================
  const clash = async (status?: string[]) => prisma.tripClash.findMany({ where: { tripId: trip.id, travellerId: R.id, ...(status ? { status: { in: status } } : {}) }, orderBy: { createdAt: "asc" } });

  await t("baseline: Ridhima is on time for dinner (no clash)", async () => {
    const r = await disruption.evaluateConsequences({ tripId: trip.id, userId: R.id, sourceMessageId: null });
    assert.equal(r.clashIds.length, 0);
  });
  await t("tentative / historical delay statements change NOTHING and invent no time", async () => {
    const before = (await prisma.travellerJourney.findUnique({ where: { id: journeys[R.id] } }))!.arriveLocal;
    for (const s of ["Flight might be delayed, nothing confirmed yet.", "My flight was delayed last time too."]) {
      const st = parseTravellerStatus(s, nowL)!;
      assert.ok(st);
      const r = await handleTravellerStatus({ tripId: trip.id, userId: R.id, messageId: null, status: st });
      assert.equal(r.reply, null);
      assert.equal(r.changed, false);
    }
    assert.equal((await prisma.travellerJourney.findUnique({ where: { id: journeys[R.id] } }))!.arriveLocal, before);
    assert.equal((await clash()).length, 0);
    assert.ok((await prisma.tripEvent.count({ where: { tripId: trip.id, kind: "TRAVELLER_STATUS_NOTED" } })) >= 2);
  });
  await t("'still at baggage claim' inside the standard exit allowance changes nothing", async () => {
    await prisma.travellerJourney.update({ where: { id: journeys[R.id] }, data: { arriveLocal: toLocal(nowMs - 5 * 60_000), scheduledArriveLocal: toLocal(nowMs - 5 * 60_000) } });
    const st = parseTravellerStatus("I'm still at baggage claim.", nowL)!;
    const r = await handleTravellerStatus({ tripId: trip.id, userId: R.id, messageId: null, status: st });
    assert.equal(r.reply, null);
    assert.equal((await prisma.travellerJourney.findUnique({ where: { id: journeys[R.id] } }))!.notOutBeforeLocal, null);
    await prisma.travellerJourney.update({ where: { id: journeys[R.id] }, data: { arriveLocal: toLocal(nowMs - 30 * 60_000), scheduledArriveLocal: toLocal(nowMs - 30 * 60_000) } });
  });
  await t("'still at baggage claim' past the allowance: landing time kept, floor = now (not a fresh allowance), labelled an estimate, asks how much longer", async () => {
    const st = parseTravellerStatus("I'm still at baggage claim.", nowL)!;
    const r = await handleTravellerStatus({ tripId: trip.id, userId: R.id, messageId: null, status: st });
    const j = (await prisma.travellerJourney.findUnique({ where: { id: journeys[R.id] } }))!;
    assert.equal(j.arriveLocal, toLocal(nowMs - 30 * 60_000), "the landing time is NOT rewritten");
    assert.equal(j.notOutBeforeLocal, `${nowL.date}T${nowL.time}`);
    assert.match(r.reply ?? "", /30 min past landing/);
    assert.match(r.reply ?? "", /already used up/);
    assert.match(r.reply ?? "", /At the earliest .* an estimate/);
    assert.match(r.reply ?? "", /How much longer/);
    assert.equal((await clash()).length, 0, "the earliest she can arrive (now + 32 min) still makes a dinner 40 min away");
    // the same floor with a nearer dinner IS a clash, and says it is an earliest-possible estimate
    await setDinner(nowMs + 25 * 60_000);
    const e = await disruption.evaluateConsequences({ tripId: trip.id, userId: R.id, sourceMessageId: null });
    assert.equal(e.clashIds.length, 1);
    const card = await prisma.message.findFirst({ where: { tripId: trip.id, cardType: "DECISION", cardData: { contains: "still inside the airport" } } });
    assert.ok(card, "the card explains the floor");
    assert.match(card!.cardData ?? "", /at the earliest, an estimate/);
    assert.equal((await prisma.commitment.findUnique({ where: { id: dinner.id } }))!.targetTime.getTime(), dinner.targetTime.getTime());
  });
  let p1: string;
  await t("a clash proposed to the group freezes the Plan until people decide (nothing moved)", async () => {
    const [c] = await clash(["OPEN"]);
    const r = await disruption.proposeClash(c.id, A.id);
    assert.ok(r.ok, r.reply);
    const after = (await prisma.tripClash.findUnique({ where: { id: c.id } }))!;
    assert.equal(after.status, "PROPOSED");
    p1 = after.proposalId!;
    assert.equal((await prisma.proposal.findUnique({ where: { id: p1 } }))!.status, "AWAITING_APPROVAL");
    assert.equal((await prisma.commitment.findUnique({ where: { id: dinner.id } }))!.targetTime.getTime(), dinner.targetTime.getTime());
    await proposals.castApprovalVote(p1, S.id, "APPROVED");
  });
  await t("a SECOND delay while the first proposal awaits approval supersedes it: old proposal withdrawn, old vote does not carry over", async () => {
    const r = await disruption.handleArrivalChange({ tripId: trip.id, userId: R.id, arrivalTime: toLocal(nowMs + 90 * 60_000).slice(11), arrivalDate: toLocal(nowMs + 90 * 60_000).slice(0, 10), sourceMessageId: null });
    assert.equal(r.clashIds.length, 1, r.reply ?? "no new clash");
    const old = (await prisma.proposal.findUnique({ where: { id: p1 }, include: { approvals: true } }))!;
    assert.equal(old.status, "CANCELLED");
    const clashes = await clash();
    assert.deepEqual(clashes.map((c) => c.status), ["SUPERSEDED", "OPEN"]);
    // the old card is dismissed, and a vote or a confirmation on the old terms is refused
    const oldCard = await prisma.message.findUnique({ where: { id: clashes[0].messageId! } });
    assert.equal(oldCard?.cardStatus, "DISMISSED");
    const late = await proposals.castApprovalVote(p1, R.id, "APPROVED");
    assert.equal(late.ok, false);
    const conf = await proposals.organiserHardConfirm(p1, A.id);
    assert.equal(conf.ok, false);
    assert.equal((await prisma.commitment.findUnique({ where: { id: dinner.id } }))!.targetTime.getTime(), dinner.targetTime.getTime(), "the Plan is untouched");
    const ev = await prisma.tripEvent.count({ where: { tripId: trip.id, kind: "PROPOSAL_SUPERSEDED" } });
    assert.ok(ev >= 1);
  });
  let p2: string;
  await t("two travellers approving at the same moment, and the organiser confirming twice, change the Plan exactly once", async () => {
    const [, c] = await clash();
    const r = await disruption.proposeClash(c.id, A.id);
    assert.ok(r.ok, r.reply);
    p2 = (await prisma.tripClash.findUnique({ where: { id: c.id } }))!.proposalId!;
    assert.notEqual(p2, p1);
    const approvals = await prisma.proposalApproval.findMany({ where: { proposalId: p2 }, include: { tripMember: true } });
    assert.ok(approvals.every((a) => a.decision === "PENDING"), "a new proposal starts with no votes");
    await Promise.all([A, R, S].map((u) => proposals.castApprovalVote(p2, u.id, "APPROVED")));
    assert.equal((await prisma.proposal.findUnique({ where: { id: p2 } }))!.status, "APPROVED");
    const [x, y] = await Promise.all([proposals.organiserHardConfirm(p2, A.id), proposals.organiserHardConfirm(p2, A.id)]);
    assert.ok(x.ok || y.ok, "one of the two confirmations succeeds"); // the loser of the race is refused, never a second execution
    const moved = (await prisma.commitment.findUnique({ where: { id: dinner.id } }))!;
    assert.notEqual(moved.targetTime.getTime(), dinner.targetTime.getTime());
    assert.equal(await prisma.auditLog.count({ where: { tripId: trip.id, actionType: "PROPOSAL_EXECUTED", payloadSummary: { contains: p2 } } }), 1);
  });
  await t("a rejection leaves the confirmed Plan intact and the proposal cannot be forced through afterwards", async () => {
    const before = (await prisma.commitment.findUnique({ where: { id: dinner.id } }))!.targetTime.getTime();
    const r = await disruption.handleArrivalChange({ tripId: trip.id, userId: R.id, arrivalTime: toLocal(nowMs + 4 * 3600_000).slice(11), arrivalDate: toLocal(nowMs + 4 * 3600_000).slice(0, 10), sourceMessageId: null });
    const open = (await clash(["OPEN"]))[0];
    assert.ok(open, r.reply ?? "no clash");
    await disruption.proposeClash(open.id, A.id);
    const pid = (await prisma.tripClash.findUnique({ where: { id: open.id } }))!.proposalId!;
    await proposals.castApprovalVote(pid, S.id, "APPROVED");
    await proposals.castApprovalVote(pid, R.id, "REJECTED");
    await proposals.castApprovalVote(pid, A.id, "APPROVED");
    assert.equal((await prisma.proposal.findUnique({ where: { id: pid } }))!.status, "REJECTED");
    assert.equal((await proposals.organiserHardConfirm(pid, A.id)).ok, false);
    assert.equal((await prisma.commitment.findUnique({ where: { id: dinner.id } }))!.targetTime.getTime(), before);
  });
  const { flightDeps, flightMinutes: flightMin } = await import("../../src/lib/traveller/flight-time");
  flightDeps.geocode = async () => ({ lat: 28.6, lng: 77.2 });
  let tzMode: "same" | "unknown" = "unknown";
  flightDeps.timezoneAt = async () => (tzMode === "same" ? "Asia/Kolkata" : null);
  const meera = await mk("Meera Iyer");
  await prisma.tripMember.create({ data: { tripId: trip.id, userId: meera.id } });
  const mj = await journey(meera, nowMs + 90 * 60_000, nowMs - 90 * 60_000); // ticket: departs 90 min ago, lands in 90 -> a 3h flight
  const wrong = toLocal(nowMs + 30 * 60_000);
  const meeraClash = () => prisma.tripClash.findMany({ where: { tripId: trip.id, travellerId: meera.id }, orderBy: { createdAt: "asc" } });
  await t("'8:15 is take-off': with no reliable zone/duration it does NOT invent a landing; the earlier warning stays as a minimum and it asks", async () => {
    await setDinner(nowMs + 10 * 60_000); // starts before even the (mistaken) landing
    await disruption.handleArrivalChange({ tripId: trip.id, userId: meera.id, arrivalTime: wrong.slice(11), arrivalDate: wrong.slice(0, 10), sourceMessageId: null });
    const before = await meeraClash();
    assert.equal(before.length, 1);
    tzMode = "unknown";
    const st = parseTravellerStatus(`${wrong.slice(11)} is take-off, not landing`, nowL)!;
    assert.equal(st.kind, "TAKEOFF_NOT_LANDING");
    const r = await handleTravellerStatus({ tripId: trip.id, userId: meera.id, messageId: null, status: st });
    assert.match(r.reply ?? "", /I haven't worked out a landing time because I couldn't confirm the time zone/);
    assert.match(r.reply ?? "", /When do you expect to land\?/);
    assert.equal((await prisma.travellerJourney.findUnique({ where: { id: mj.id } }))!.arriveLocal, wrong, "nothing was inferred");
    const after = await meeraClash();
    assert.deepEqual(after.map((c) => c.status), ["OPEN"], "the existing clash was not silently cleared");
  });
  await t("'8:15 is take-off': with both zones known, landing = take-off + the journey's own flight time; the stale card is replaced and labelled an estimate", async () => {
    tzMode = "same";
    const st = parseTravellerStatus(`${wrong.slice(11)} is take-off, not landing`, nowL)!;
    const r = await handleTravellerStatus({ tripId: trip.id, userId: meera.id, messageId: null, status: st });
    const fixed = (await prisma.travellerJourney.findUnique({ where: { id: mj.id } }))!;
    assert.equal(fixed.arriveLocal, toLocal(Date.parse(`${wrong}:00Z`) + 180 * 60_000));
    assert.match(r.reply ?? "", /is take-off, not landing/);
    assert.match(r.reply ?? "", /the flight is 3h/);
    assert.match(r.reply ?? "", /That's an estimate/);
    const cl = await meeraClash();
    assert.deepEqual(cl.map((c) => c.status), ["SUPERSEDED", "OPEN"]);
  });
  await t("flight time is computed in each place's own zone and date (Delhi 07:00 -> Singapore 15:30 is 6h, not 8h30m; it refuses without both zones)", async () => {
    assert.deepEqual(flightMin({ departLocal: "2026-10-05T07:00", departTz: "Asia/Kolkata", arriveLocal: "2026-10-05T15:30", arriveTz: "Asia/Singapore" }), { ok: true, minutes: 360, crossesZones: true });
    assert.deepEqual(flightMin({ departLocal: "2026-10-05T07:00", departTz: "Asia/Kolkata", arriveLocal: "2026-10-05T10:15", arriveTz: "Asia/Kolkata" }), { ok: true, minutes: 195, crossesZones: false });
    // daylight saving: London 2026-03-29 00:30 (GMT) -> 02:30 BST is a 30 minute... the same wall-clock gap is 1h shorter across the change
    assert.equal(flightMin({ departLocal: "2026-03-28T23:30", departTz: "Europe/London", arriveLocal: "2026-03-29T03:30", arriveTz: "Europe/London" }).ok, true);
    assert.equal(flightMin({ departLocal: "2026-10-05T07:00", departTz: null, arriveLocal: "2026-10-05T10:15", arriveTz: "Asia/Kolkata" }).ok, false);
    assert.equal(flightMin({ departLocal: null, departTz: "Asia/Kolkata", arriveLocal: "2026-10-05T10:15", arriveTz: "Asia/Kolkata" }).ok, false);
  });
  await t("'I'll join you directly at dinner': that commitment is no longer measured via the stay, the stale clash is withdrawn, nothing moves", async () => {
    // Ridhima still inside the airport, dinner 25 min away: a stay-based clash exists. Joining directly ends the stay-based reading.
    await setDinner(nowMs + 25 * 60_000);
    await prisma.tripClash.updateMany({ where: { travellerId: R.id, status: { in: ["OPEN", "INFORMED", "PROPOSED"] } }, data: { status: "LEFT" } });
    await prisma.travellerJourney.update({ where: { id: journeys[R.id] }, data: { arriveLocal: toLocal(nowMs - 30 * 60_000), scheduledArriveLocal: toLocal(nowMs - 30 * 60_000), notOutBeforeLocal: `${nowL.date}T${nowL.time}`, directToCommitmentId: null } });
    assert.equal((await disruption.evaluateConsequences({ tripId: trip.id, userId: R.id, sourceMessageId: null })).clashIds.length, 1);
    const before = (await prisma.commitment.findUnique({ where: { id: dinner.id } }))!.targetTime.getTime();
    const st = parseTravellerStatus("Go ahead, I'll join you directly at dinner.", nowL)!;
    const r = await handleTravellerStatus({ tripId: trip.id, userId: R.id, messageId: null, status: st });
    const j = (await prisma.travellerJourney.findUnique({ where: { id: journeys[R.id] } }))!;
    assert.equal(j.directToCommitmentId, dinner.id);
    assert.match(r.reply ?? "", /no longer counting Ridhima's trip via the stay/);
    assert.match(r.reply ?? "", /Where is Birthday Dinner\?/, "no venue address, so it asks instead of routing to the city centre");
    assert.equal((await clash(["OPEN", "INFORMED", "PROPOSED"])).length, 0);
    assert.equal((await prisma.commitment.findUnique({ where: { id: dinner.id } }))!.targetTime.getTime(), before);
  });
  await t("'Kal subah aaungi, aaj nahi': tomorrow morning in the trip calendar; says what it would miss; asks the time; changes nothing yet", async () => {
    const before = (await prisma.travellerJourney.findUnique({ where: { id: journeys[S.id] } }))!.arriveLocal;
    const st = parseTravellerStatus("Kal subah aaungi, aaj nahi.", nowL)!;
    assert.equal(st.kind, "REL_DAY");
    const r = await handleTravellerStatus({ tripId: trip.id, userId: S.id, messageId: null, status: st });
    assert.match(r.reply ?? "", /tomorrow morning/);
    assert.match(r.reply ?? "", /What time does it land\?/);
    assert.equal((await prisma.travellerJourney.findUnique({ where: { id: journeys[S.id] } }))!.arriveLocal, before);
  });

  // ============================== 3. 'Yes' to what? ==============================
  const mkProposal = async (title: string) => {
    const card = await prisma.message.create({ data: { tripId: trip.id, senderId: clockwise.id, channel: "GROUP", content: title } });
    const p = await prisma.proposal.create({ data: { tripId: trip.id, type: "ITINERARY_CHANGE", status: "AWAITING_APPROVAL", title, summary: title, payload: "{}", createdBy: clockwise.id, groupMessageId: card.id } });
    for (const m of await prisma.tripMember.findMany({ where: { tripId: trip.id } })) await prisma.proposalApproval.create({ data: { proposalId: p.id, tripMemberId: m.id, decision: "PENDING" } });
    return p;
  };
  const voted = (pid: string) => prisma.proposalApproval.count({ where: { proposalId: pid, decision: { not: "PENDING" } } });
  await t("a bare 'yes' counts only for the ONE clearly active proposal; with two it asks — recency never decides", async () => {
    await prisma.tripClash.updateMany({ where: { tripId: trip.id, status: { in: ["OPEN", "INFORMED"] } }, data: { status: "LEFT" } });
    await prisma.proposal.updateMany({ where: { tripId: trip.id, status: "AWAITING_APPROVAL" }, data: { status: "CANCELLED" } });
    const a = await mkProposal("Move dinner to 9:30");
    const one = await voteFromChat({ tripId: trip.id, userId: S.id, text: "Yes", messageId: null });
    assert.equal(one.proposalId, a.id, "the only thing waiting on her");
    assert.equal(await voted(a.id), 1);
    await prisma.proposalApproval.updateMany({ where: { proposalId: a.id }, data: { decision: "PENDING", respondedAt: null } });
    // a second proposal, posted AFTER the first and right above the reply: still ambiguous
    const b = await mkProposal("Payment needed: museum tickets");
    const r = await voteFromChat({ tripId: trip.id, userId: S.id, text: "Yes", messageId: null });
    assert.equal(r.handled, true);
    assert.match(r.clarify ?? "", /Which one do you mean, Shreya\?/);
    assert.match(r.clarify ?? "", /Move dinner to 9:30/);
    assert.match(r.clarify ?? "", /museum tickets/);
    for (const x of [a, b]) assert.equal(await voted(x.id), 0);
    // naming it is explicit
    const named = await voteFromChat({ tripId: trip.id, userId: S.id, text: "yes to the museum tickets", messageId: null });
    assert.equal(named.proposalId, b.id);
    assert.equal(await voted(b.id), 1);
    assert.equal(await voted(a.id), 0);
    // a name that fits both (or neither) still asks
    const none = await voteFromChat({ tripId: trip.id, userId: A.id, text: "yes to lunch", messageId: null });
    assert.equal(none.handled, true);
    assert.ok(none.clarify);
    // a conditional is not a yes at all
    const cond = await voteFromChat({ tripId: trip.id, userId: A.id, text: "yes to dinner but only if we're back by 11", messageId: null });
    assert.equal(cond.handled, false);
    await prisma.proposal.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { status: "CANCELLED" } });
  });
  await t("a conditional yes is attached to the proposal it answers, shown as OPEN, never counted; an explicit Accept waives it", async () => {
    const { attachCondition } = await import("../../src/lib/proposal-conditions");
    const a = await mkProposal("Move dinner to 10");
    const reply = await attachCondition({ tripId: trip.id, userId: A.id, accepts: "I'm fine with 10", condition: "we're back by 11", messageId: null });
    assert.match(reply ?? "", /depends on "we're back by 11"/);
    assert.match(reply ?? "", /haven't counted it as approval/);
    assert.match(reply ?? "", /stores when things start, not how long they run/);
    const cs = await prisma.proposalCondition.findMany({ where: { proposalId: a.id } });
    assert.equal(cs.length, 1);
    assert.equal(cs[0].status, "OPEN");
    assert.equal(cs[0].userId, A.id);
    assert.equal(await voted(a.id), 0, "not counted");
    // same words again: no duplicate
    await attachCondition({ tripId: trip.id, userId: A.id, accepts: "I'm fine with 10", condition: "we're back by 11", messageId: null });
    assert.equal(await prisma.proposalCondition.count({ where: { proposalId: a.id } }), 1);
    // with two proposals open and nothing naming one, it asks which and attaches nothing
    const b = await mkProposal("Payment needed: museum tickets");
    const amb = await attachCondition({ tripId: trip.id, userId: S.id, accepts: "I'm fine with that", condition: "it's under 500", messageId: null });
    assert.match(amb ?? "", /Which one do you mean/);
    assert.equal(await prisma.proposalCondition.count({ where: { userId: S.id } }), 0);
    // an explicit Accept is a yes without the condition
    await proposals.castApprovalVote(a.id, A.id, "APPROVED");
    assert.equal((await prisma.proposalCondition.findFirst({ where: { proposalId: a.id } }))!.status, "WAIVED");
    assert.equal(await voted(a.id), 1);
    await prisma.proposal.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { status: "CANCELLED" } });
  });

  // ============================== 4. MONEY ==============================
  await t("'Pay her the remaining amount' creates nothing: it names what the CONFIRMED ledger says, or asks", async () => {
    const none = await payDirectiveReply(trip.id, S.id, { recipientWord: "her", amountMinor: null, remaining: true });
    assert.match(none, /you don't owe anyone/);
    await createExpense({ tripId: trip.id, actorUserId: R.id, title: "Cab", amountMinor: 200000, currency: "INR", stage: "PAID", status: "ACTIVE", paidByUserId: R.id, source: "MANUAL", splitMethod: "EXACT", participants: [{ userId: R.id, value: 100000 }, { userId: S.id, value: 100000 }] });
    const one = await payDirectiveReply(trip.id, S.id, { recipientWord: "her", amountMinor: null, remaining: true });
    assert.match(one, /you owe Ridhima ₹1,000/);
    assert.match(one, /counts as paid only when Pine Labs confirms/);
    const wrong = await payDirectiveReply(trip.id, S.id, { recipientWord: "Ridhima", amountMinor: 50000, remaining: false });
    assert.match(wrong, /Confirmed expenses say you owe Ridhima ₹1,000; you asked for ₹500/);
    const partial = await (await import("../../src/lib/agent/money-talk")).payDirectiveOutcome(trip.id, S.id, { recipientWord: "Ridhima", amountMinor: 50000, remaining: false });
    assert.equal(partial.settlement?.amountMinor, 50000, "the amount said wins; the ledger is only compared");
    assert.equal(await prisma.booking.count({ where: { tripId: trip.id, type: "PAYMENT_REQUEST" } }), 0);
    assert.equal(await prisma.settlement.count({ where: { tripId: trip.id } }), 0);
  });
  await t("'I already paid her outside Clockwise' is recorded as an unconfirmed report: the ledger and settlements do not change", async () => {
    const owedBefore = await payDirectiveReply(trip.id, S.id, { recipientWord: "Ridhima", amountMinor: null, remaining: true });
    const reply = await selfReportedReply(trip.id, S.id, { recipientWord: "her", amountMinor: null, outside: true }, null);
    assert.match(reply, /not a confirmed settlement/);
    assert.equal(await prisma.settlement.count({ where: { tripId: trip.id } }), 0);
    const ev = await prisma.tripEvent.findFirst({ where: { tripId: trip.id, kind: "SETTLEMENT_REPORTED" } });
    assert.ok(ev);
    assert.equal(JSON.parse(ev!.payload).confirmed, false);
    assert.equal(JSON.parse(ev!.payload).ledgerChanged, false);
    assert.equal(await payDirectiveReply(trip.id, S.id, { recipientWord: "Ridhima", amountMinor: null, remaining: true }), owedBefore);
    await prisma.expense.deleteMany({ where: { tripId: trip.id } });
  });

  // ============================== 5. PINE LABS: reconcile, idempotency, abandoned checkout ==============================
  const col = await prisma.paymentCollection.create({ data: { tripId: trip.id, title: "Cab deposit", totalMinor: 10000, currency: "INR", createdBy: A.id } });
  const ob = await prisma.paymentObligation.create({ data: { collectionId: col.id, tripId: trip.id, userId: A.id, amountMinor: 10000, merchantRef: "CW-testref-1", status: "PAYING" } });
  const bk = await prisma.booking.create({ data: { tripId: trip.id, type: "PAYMENT_REQUEST", status: "CREATED", participantIds: "[]", provider: "pinelabs", amount: 10000, currency: "INR", confirmationId: "pl-v1-test", paymentUrl: "https://pine.test/pay/x", payerId: A.id, sourceProposalId: col.id } });
  await prisma.paymentObligation.update({ where: { id: ob.id }, data: { bookingId: bk.id, paymentLinkId: "pl-v1-test" } });
  const obState = async () => (await prisma.paymentObligation.findUnique({ where: { id: ob.id } }))!.status;

  await t("abandoned checkout (link CREATED / CLICKED / PAYMENT_INITIATED) never becomes paid", async () => {
    for (const status of ["CREATED", "CLICKED", "PAYMENT_INITIATED"]) {
      pineLink = { status, amount: 10000, currency: "INR", id: "pl-v1-test", ref: "CW-testref-1" };
      const r = await refreshTripPaymentStatus(bk.id);
      assert.ok(r.ok);
      assert.notEqual(await obState(), "PAID");
    }
    assert.equal(await prisma.expense.count({ where: { tripId: trip.id } }), 0);
  });
  await t("a PROCESSED answer for a DIFFERENT amount, link, reference or currency is never applied", async () => {
    const statusBefore = (await prisma.booking.findUnique({ where: { id: bk.id } }))!.status;
    for (const bad of [
      { amount: 5000, currency: "INR", id: "pl-v1-test", ref: "CW-testref-1" },
      { amount: 10000, currency: "USD", id: "pl-v1-test", ref: "CW-testref-1" },
      { amount: 10000, currency: "INR", id: "pl-OTHER", ref: "CW-testref-1" },
      { amount: 10000, currency: "INR", id: "pl-v1-test", ref: "CW-someone-else" },
    ]) {
      pineLink = { status: "PROCESSED", ...bad };
      const r = await refreshTripPaymentStatus(bk.id);
      assert.equal(r.ok, false);
      assert.notEqual(await obState(), "PAID");
      assert.equal((await prisma.booking.findUnique({ where: { id: bk.id } }))!.status, statusBefore, "the stored status did not move");
    }
    assert.equal(await prisma.tripEvent.count({ where: { tripId: trip.id, kind: "PAYMENT_RECONCILIATION_MISMATCH" } }), 4);
    assert.equal(await prisma.expense.count({ where: { tripId: trip.id } }), 0);
  });
  await t("a matching PROCESSED answer settles the share ONCE, however many times it is repeated", async () => {
    pineLink = { status: "PROCESSED", amount: 10000, currency: "INR", id: "pl-v1-test", ref: "CW-testref-1" };
    await Promise.all([refreshTripPaymentStatus(bk.id), refreshTripPaymentStatus(bk.id), refreshTripPaymentStatus(bk.id)]);
    await refreshTripPaymentStatus(bk.id);
    assert.equal(await obState(), "PAID");
    assert.equal(await prisma.expense.count({ where: { tripId: trip.id, source: "PINE_LABS" } }), 1);
    assert.equal(await prisma.tripEvent.count({ where: { tripId: trip.id, kind: "PAYMENT_OBLIGATION_PAID" } }), 1);
    // a stale CREATED callback afterwards cannot un-pay it
    pineLink = { status: "CREATED", amount: 10000, currency: "INR", id: "pl-v1-test", ref: "CW-testref-1" };
    await refreshTripPaymentStatus(bk.id);
    assert.equal(await obState(), "PAID");
  });

  // ============================== 6. PROVIDERS FAIL ==============================
  await t("routing providers failing (429 / 500): travel feasibility is UNKNOWN, a plan that starts before landing is still impossible, and no clash is cleared", async () => {
    const bump = async (u: { id: string }, ms: number) => {
      const later = toLocal(ms);
      return disruption.handleArrivalChange({ tripId: trip.id, userId: u.id, arrivalTime: later.slice(11), arrivalDate: later.slice(0, 10), sourceMessageId: null });
    };
    // Ridhima: a known (route-based) clash exists, then BOTH providers go down and her arrival moves again.
    await setDinner(nowMs + 25 * 60_000);
    await prisma.tripClash.updateMany({ where: { travellerId: R.id, status: { in: ["OPEN", "INFORMED", "PROPOSED"] } }, data: { status: "LEFT" } });
    await prisma.travellerJourney.update({ where: { id: journeys[R.id] }, data: { directToCommitmentId: null, notOutBeforeLocal: null, arriveLocal: toLocal(nowMs - 30 * 60_000), scheduledArriveLocal: toLocal(nowMs - 30 * 60_000), routeToStayMeters: 20000, routeToStaySeconds: 1920, routeStayBookingId: stay.id } });
    await prisma.travellerJourney.update({ where: { id: journeys[R.id] }, data: { notOutBeforeLocal: `${nowL.date}T${nowL.time}` } });
    const known = await disruption.evaluateConsequences({ tripId: trip.id, userId: R.id, sourceMessageId: null });
    assert.equal(known.clashIds.length, 1, "a route-based clash exists first");
    for (const mode of ["429", "500"] as const) {
      routeMode = mode;
      // lands AFTER dinner starts -> impossible without any route; the existing clash is kept, not replaced by "unknown"
      const r = await bump(R, nowMs + 5 * 3600_000 + (mode === "429" ? 0 : 60_000));
      assert.match(r.reply ?? "", /Travel feasibility is unknown|doesn't depend on it/);
      assert.equal((await prisma.travellerJourney.findUnique({ where: { id: journeys[R.id] } }))!.routeToStaySeconds, null, "no travel time was invented");
      const open = await prisma.tripClash.findMany({ where: { travellerId: R.id, status: { in: ["OPEN", "INFORMED", "PROPOSED"] } } });
      assert.ok(open.length >= 1, "the conflict is preserved");
      assert.ok(open.every((c) => c.commitmentName === "Birthday Dinner"));
    }
    // a fresh traveller lands AFTER dinner starts with no route data at all: a lower-bound clash is raised, with no suggested time
    routeMode = "500";
    const dina = await mk("Dina Menon");
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: dina.id } });
    const dj = await journey(dina, nowMs + 3 * 3600_000, nowMs);
    await prisma.travellerJourney.update({ where: { id: dj.id }, data: { routeToStaySeconds: null, routeToStayMeters: null, routeStayBookingId: null } });
    const lb = await disruption.evaluateConsequences({ tripId: trip.id, userId: dina.id, sourceMessageId: null });
    assert.equal(lb.clashIds.length, 1);
    const lbClash = (await prisma.tripClash.findUnique({ where: { id: lb.clashIds[0] } }))!;
    assert.equal(lbClash.suggestedLocal, null, "no travel data, so no suggested time");
    assert.equal(lbClash.routeMinutes, 0);
    const lbCard = await prisma.message.findUnique({ where: { id: lbClash.messageId! } });
    assert.match(lbCard!.cardData ?? "", /travel time is unknown, but this can't work however the roads are/);
    // a fresh traveller who lands BEFORE dinner with no route data: feasibility is unknown, and nothing is raised
    const early = await mk("Eka Das");
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: early.id } });
    const ej = await journey(early, nowMs - 10 * 60_000, nowMs - 200 * 60_000);
    await prisma.travellerJourney.update({ where: { id: ej.id }, data: { routeToStaySeconds: null, routeToStayMeters: null, routeStayBookingId: null } });
    const un = await disruption.evaluateConsequences({ tripId: trip.id, userId: early.id, sourceMessageId: null });
    assert.equal(un.clashIds.length, 0);
    assert.match(un.reply ?? "", /Travel feasibility is unknown/);
    routeMode = "ok";
  });

  // ============================== 7. THE REAL GROUP TURN (no model is configured, so any path that reaches it fails loudly) ==============================
  const { respondToGroupMessage } = await import("../../src/lib/agent/clockwise-agent");
  const say = async (u: { id: string }, content: string) => {
    await prisma.message.create({ data: { tripId: trip.id, senderId: u.id, channel: "GROUP", content } });
    const before = await prisma.message.count({ where: { tripId: trip.id, channel: "GROUP", senderId: clockwise.id } });
    const res = await respondToGroupMessage(trip.id, u.id);
    const mine = await prisma.message.findMany({ where: { tripId: trip.id, channel: "GROUP", senderId: clockwise.id, cardType: null }, orderBy: { timestamp: "desc" }, take: 1 });
    const posted = (await prisma.message.count({ where: { tripId: trip.id, channel: "GROUP", senderId: clockwise.id } })) > before;
    return { res, reply: posted ? mine[0].content : null };
  };
  await t("group turn: tentative / historical / join-directly never reach the model and never invent an arrival", async () => {
    const arrBefore = (await prisma.travellerJourney.findUnique({ where: { id: journeys[S.id] } }))!.arriveLocal;
    for (const line of ["Flight might be delayed, nothing confirmed yet.", "My flight was delayed last time too."]) {
      const { res, reply } = await say(S, line);
      assert.equal(res.spoke, false);
      assert.equal(reply, null);
      assert.ok(!res.failed, "must not have needed the model");
    }
    assert.equal((await prisma.travellerJourney.findUnique({ where: { id: journeys[S.id] } }))!.arriveLocal, arrBefore);
  });
  await t("group turn: 'Anything except another dosa place' is understood for the next meal and stored as nothing lasting", async () => {
    const { res } = await say(A, "Anything except another dosa place 😭");
    assert.equal(res.spoke, false);
    assert.ok(!res.failed);
    assert.equal(await prisma.tripPointer.count({ where: { tripId: trip.id } }), 0);
    assert.equal(await prisma.travellerPreference.count({ where: { tripId: trip.id } }), 0);
    const mood = await prisma.tripEvent.findFirst({ where: { tripId: trip.id, kind: "MEAL_MOOD_NOTED" } });
    assert.equal(JSON.parse(mood!.payload).avoid, "dosa");
  });
  await t("group turn: a conditional yes is not counted — the open proposal's votes are untouched", async () => {
    const card = await prisma.message.create({ data: { tripId: trip.id, senderId: clockwise.id, channel: "GROUP", content: "Move dinner to 10" } });
    const p = await prisma.proposal.create({ data: { tripId: trip.id, type: "ITINERARY_CHANGE", status: "AWAITING_APPROVAL", title: "Move dinner to 10", summary: "x", payload: "{}", createdBy: clockwise.id, groupMessageId: card.id } });
    for (const m of await prisma.tripMember.findMany({ where: { tripId: trip.id } })) await prisma.proposalApproval.create({ data: { proposalId: p.id, tripMemberId: m.id, decision: "PENDING" } });
    const { res, reply } = await say(A, "I'm fine with 10, but only if we're back by 11.");
    assert.ok(!res.failed);
    assert.match(reply ?? "", /your yes to "Move dinner to 10" depends on "we're back by 11"/);
    assert.match(reply ?? "", /haven't counted it as approval/);
    assert.equal(await prisma.proposalApproval.count({ where: { proposalId: p.id, decision: { not: "PENDING" } } }), 0);
    await prisma.proposal.update({ where: { id: p.id }, data: { status: "CANCELLED" } });
  });
  await t("group turn: 'Pay her the remaining amount' (unaddressed) creates no expense and no card; addressed, it answers from the ledger", async () => {
    const cards = await prisma.message.count({ where: { tripId: trip.id, cardType: { not: null } } });
    const exp = await prisma.expense.count({ where: { tripId: trip.id } });
    const quiet = await say(A, "Pay her the remaining amount.");
    assert.equal(quiet.reply, null);
    assert.ok(!quiet.res.failed);
    assert.equal(await prisma.expense.count({ where: { tripId: trip.id } }), exp);
    assert.equal(await prisma.message.count({ where: { tripId: trip.id, cardType: { not: null } } }), cards);
    const asked = await say(A, "@Clockwise pay her the remaining amount");
    assert.match(asked.reply ?? "", /you don't owe anyone|haven't paid or requested anything|Who do you mean/);
  });
  await t("group turn: 'I already paid her outside Clockwise' is answered as an unconfirmed report and writes no settlement", async () => {
    const { res, reply } = await say(S, "I already paid her outside Clockwise.");
    assert.match(reply ?? "", /your own report, not a confirmed settlement/);
    assert.ok(!res.failed);
    assert.equal(await prisma.settlement.count({ where: { tripId: trip.id } }), 0);
    assert.ok((await prisma.tripEvent.count({ where: { tripId: trip.id, kind: "SETTLEMENT_REPORTED" } })) >= 1);
  });
  await t("group turn: 'Let's do Cubbon before dinner?' is a feasibility question: no Plan entry, no proposal, no commitment", async () => {
    const commits = await prisma.commitment.count({ where: { tripId: trip.id } });
    const props = await prisma.proposal.count({ where: { tripId: trip.id } });
    const { res, reply } = await say(A, "Let's do Cubbon before dinner?");
    assert.ok(!res.failed);
    assert.ok(reply === null || !/added to the plan/i.test(reply));
    assert.equal(await prisma.commitment.count({ where: { tripId: trip.id } }), commits);
    assert.equal(await prisma.proposal.count({ where: { tripId: trip.id } }), props);
  });
  await t("group turn: 'I'll join you directly at dinner' answers once, says nothing moved, and the Plan is intact", async () => {
    const before = (await prisma.commitment.findUnique({ where: { id: dinner.id } }))!.targetTime.getTime();
    const { res, reply } = await say(R, "Go ahead, I'll join you directly at dinner.");
    assert.ok(!res.failed);
    assert.match(reply ?? "", /Nothing in the Plan moved/);
    assert.equal((await prisma.commitment.findUnique({ where: { id: dinner.id } }))!.targetTime.getTime(), before);
  });

  // ============================== 8. MEAL MOOD IS RESPECTED BY LATER SEARCHES ==============================
  const { runPlaceRequest } = await import("../../src/lib/agent/router");
  const searchCtx = { trip: { id: trip.id }, actingUserId: A.id } as never;
  const names = (reply: string) => reply;
  await t("'anything except another dosa place': later searches for THAT meal leave dosa out, say so, and an explicit request for dosa still gets it", async () => {
    await prisma.tripEvent.deleteMany({ where: { tripId: trip.id, kind: "MEAL_MOOD_NOTED" } });
    const base = await runPlaceRequest(searchCtx, "find dinner places near the hotel", "GROUP");
    assert.ok(base.outcome.ok);
    const all = base.outcome.ok ? base.outcome.places.map((p) => p.name) : [];
    assert.ok(all.includes("Vidyarthi Bhavan Dosa Corner") && all.includes("Udupi Grand"), `unfiltered search returns the dosa places: ${all.join(", ")}`);
    await say(A, "Anything except another dosa place 😭");
    const after = await runPlaceRequest(searchCtx, "find dinner places near the hotel", "GROUP");
    const kept = after.outcome.ok ? after.outcome.places.map((p) => p.name) : [];
    assert.deepEqual(kept.sort(), ["Koshy's", "Truffles Burger Cafe"], "both a dosa NAME and a dosa CUISINE tag are left out");
    assert.match(names(after.reply), /Left out dosa places, since Arshia wanted a break from them for this meal/);
    // explicitly asking for it is not blocked
    const asked = await runPlaceRequest(searchCtx, "find dosa places near the hotel", "GROUP");
    assert.ok(asked.outcome.ok && asked.outcome.places.some((p) => /dosa|udupi/i.test(p.name)));
    // it belonged to the meal: another meal's search is untouched
    await prisma.tripEvent.updateMany({ where: { tripId: trip.id, kind: "MEAL_MOOD_NOTED" }, data: { payload: JSON.stringify({ avoid: "dosa", slot: "breakfast" === (await import("../../src/lib/pointers/mood")).mealSlot(nowL.time) ? "dinner" : "breakfast", date: nowL.date }) } });
    const other = await runPlaceRequest(searchCtx, "find dinner places near the hotel", "GROUP");
    assert.ok(other.outcome.ok && other.outcome.places.some((p) => p.name === "Udupi Grand"));
    // when the mood removes everything, it says so instead of listing them anyway
    const { searchForIntent } = await import("../../src/lib/travel/place-search");
    const { parsePlaceIntent } = await import("../../src/lib/travel/place-intent");
    await prisma.tripEvent.updateMany({ where: { tripId: trip.id, kind: "MEAL_MOOD_NOTED" }, data: { payload: JSON.stringify({ avoid: "dosa", slot: (await import("../../src/lib/pointers/mood")).mealSlot(nowL.time), date: nowL.date }) } });
    const direct = await searchForIntent({ tripId: trip.id, userId: A.id, intent: parsePlaceIntent("find dinner places near the hotel") });
    assert.ok(direct.ok && direct.mealMood && direct.mealMood.removed === 2, "the shared search (used by chat AND ideas) applies it, not just one caller");
    // nothing lasting was stored
    assert.equal(await prisma.tripPointer.count({ where: { tripId: trip.id, subject: { contains: "dosa" } } }), 0);
    assert.equal(await prisma.travellerPreference.count({ where: { tripId: trip.id } }), 0);
  });

  // ============================== 9. PAYMENT CONFIRMATION FROM CHAT ==============================
  const { confirmChatSettlementAction, dismissChatSettlementAction } = await import("../../src/app/settlement-actions");
  await t("'Pay her the remaining amount' resolves recipient, direction and the CONFIRMED balance, shows a confirmation, and creates no expense; confirming records one settlement once", async () => {
    await prisma.expense.deleteMany({ where: { tripId: trip.id } });
    await prisma.settlement.deleteMany({ where: { tripId: trip.id } });
    await createExpense({ tripId: trip.id, actorUserId: R.id, title: "Cab", amountMinor: 200000, currency: "INR", stage: "PAID", status: "ACTIVE", paidByUserId: R.id, source: "MANUAL", splitMethod: "EXACT", participants: [{ userId: R.id, value: 100000 }, { userId: S.id, value: 100000 }] });
    const expensesBefore = await prisma.expense.count({ where: { tripId: trip.id } });
    const { reply } = await say(S, "@Clockwise pay her the remaining amount");
    assert.match(reply ?? "", /you owe Ridhima ₹1,000/);
    assert.equal(await prisma.expense.count({ where: { tripId: trip.id } }), expensesBefore, "no new expense");
    const card = await prisma.message.findFirst({ where: { tripId: trip.id, cardData: { contains: '"settlement"' } }, orderBy: { timestamp: "desc" } });
    assert.ok(card);
    const data = JSON.parse(card!.cardData!);
    assert.deepEqual([data.settlement.fromId, data.settlement.toId, data.settlement.amountMinor], [S.id, R.id, 100000]);
    assert.equal(card!.cardStatus, "PENDING");
    assert.equal(await prisma.settlement.count({ where: { tripId: trip.id } }), 0, "nothing is recorded until she confirms");
    // only the person who owes can confirm
    sessionUser = R.id;
    const wrong = await confirmChatSettlementAction(card!.id);
    assert.equal(wrong.ok, false);
    assert.equal(await prisma.settlement.count({ where: { tripId: trip.id } }), 0);
    sessionUser = S.id;
    const [x, y] = await Promise.all([confirmChatSettlementAction(card!.id), confirmChatSettlementAction(card!.id)]);
    assert.ok(x.ok && y.ok);
    assert.equal(await prisma.settlement.count({ where: { tripId: trip.id } }), 1, "two taps record once");
    const st = (await prisma.settlement.findFirst({ where: { tripId: trip.id } }))!;
    assert.deepEqual([st.fromUserId, st.toUserId, st.amountMinor, st.method], [S.id, R.id, 100000, "MANUAL"]);
    assert.equal(await prisma.expense.count({ where: { tripId: trip.id } }), expensesBefore);
    assert.ok((await notifFor(R)).some((n) => n.kind === "SETTLEMENT_RECORDED"));
    // a stale card whose balance has since changed is refused, not recorded
    const reply2 = await say(S, "@Clockwise pay her the remaining amount");
    assert.match(reply2.reply ?? "", /don't owe Ridhima anything|don't owe anyone/);
    assert.equal(await prisma.settlement.count({ where: { tripId: trip.id } }), 1);
    sessionUser = null;
  });
  await t("an expense is titled from the speaker's own words; invented titles become a neutral description", async () => {
    const { groundedTitle } = await import("../../src/lib/budget/titles");
    assert.deepEqual(groundedTitle("Ridhima paid ₹2,000 for the cab", "Cab", "Ridhima"), { title: "Cab", grounded: true });
    assert.deepEqual(groundedTitle("Ridhima paid ₹2,000 for both of us.", "Tickets for two", "Ridhima"), { title: "Expense paid by Ridhima", grounded: false });
    assert.deepEqual(groundedTitle("Pay her the remaining amount.", "Dinner", "Ridhima"), { title: "Expense paid by Ridhima", grounded: false });
  });

  // ============================== 10. PAYMENT STATUS: only the provider's authenticated answer moves money ==============================
  const { NextRequest } = await import("next/server");
  const returnRoute = await import("../../src/app/api/payments/return/route");
  const webhookRoute = await import("../../src/app/api/integrations/pinelabs/webhook/route");
  const { createHmac } = await import("node:crypto");
  const col2 = await prisma.paymentCollection.create({ data: { tripId: trip.id, title: "Museum", totalMinor: 50000, currency: "INR", createdBy: A.id } });
  const ob2 = await prisma.paymentObligation.create({ data: { collectionId: col2.id, tripId: trip.id, userId: R.id, amountMinor: 50000, merchantRef: "CW-testref-2", status: "PAYING" } });
  const bk2 = await prisma.booking.create({ data: { tripId: trip.id, type: "PAYMENT_REQUEST", status: "CREATED", participantIds: "[]", provider: "pinelabs", amount: 50000, currency: "INR", confirmationId: "pl-v1-two", paymentUrl: "https://pine.test/pay/two", payerId: R.id, sourceProposalId: col2.id } });
  await prisma.paymentObligation.update({ where: { id: ob2.id }, data: { bookingId: bk2.id, paymentLinkId: "pl-v1-two" } });
  const ob2Status = async () => (await prisma.paymentObligation.findUnique({ where: { id: ob2.id } }))!.status;
  const signed = (body: string, secretB64 = process.env.PINELABS_WEBHOOK_SECRET!) => {
    const id = `evt_${Math.random().toString(36).slice(2)}`;
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac("sha256", Buffer.from(secretB64, "base64")).update(`${id}.${ts}.${body}`).digest("base64");
    return { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}`, "content-type": "application/json" };
  };
  await t("the return page trusts nothing in its URL: a forged ?status=PROCESSED&paid=true marks nothing paid; only the provider's status does", async () => {
    pineLink = { status: "CLICKED", amount: 50000, currency: "INR", id: "pl-v1-two", ref: "CW-testref-2" };
    sessionUser = R.id;
    await returnRoute.GET(new NextRequest(`http://localhost/api/payments/return?booking=${bk2.id}&status=PROCESSED&payment_status=SUCCESS&paid=true&amount=500&txn=forged`));
    assert.notEqual(await ob2Status(), "PAID");
    assert.equal(await prisma.expense.count({ where: { tripId: trip.id, sourceReferenceId: bk2.id } }), 0);
    // someone who is not on the trip cannot even trigger the re-fetch
    sessionUser = "nobody";
    const res = await returnRoute.GET(new NextRequest(`http://localhost/api/payments/return?booking=${bk2.id}`));
    assert.equal(new URL(res.headers.get("location")!).pathname, "/");
    sessionUser = null;
  });
  await t("a webhook must be signed; a signed body that CLAIMS paid does nothing unless the provider's own status says so", async () => {
    const claim = JSON.stringify({ event: "payment.processed", status: "PROCESSED", data: { payment_link_id: "pl-v1-two", merchant_payment_link_reference: "CW-testref-2" } });
    const bad = await webhookRoute.POST(new NextRequest("http://localhost/api/integrations/pinelabs/webhook", { method: "POST", body: claim, headers: { ...signed(claim, Buffer.from("wrong-secret").toString("base64")) } }));
    assert.equal(bad.status, 401);
    const unsigned = await webhookRoute.POST(new NextRequest("http://localhost/api/integrations/pinelabs/webhook", { method: "POST", body: claim }));
    assert.equal(unsigned.status, 401);
    pineLink = { status: "CREATED", amount: 50000, currency: "INR", id: "pl-v1-two", ref: "CW-testref-2" };
    const ok = await webhookRoute.POST(new NextRequest("http://localhost/api/integrations/pinelabs/webhook", { method: "POST", body: claim, headers: signed(claim) }));
    assert.equal(ok.status, 200);
    assert.notEqual(await ob2Status(), "PAID", "the body said PROCESSED, the provider said CREATED");
  });
  await t("a signed webhook plus a matching provider PROCESSED settles once, however often it is replayed", async () => {
    const claim = JSON.stringify({ data: { payment_link_id: "pl-v1-two", merchant_payment_link_reference: "CW-testref-2" } });
    pineLink = { status: "PROCESSED", amount: 50000, currency: "INR", id: "pl-v1-two", ref: "CW-testref-2" };
    for (let i = 0; i < 3; i++) await webhookRoute.POST(new NextRequest("http://localhost/api/integrations/pinelabs/webhook", { method: "POST", body: claim, headers: signed(claim) }));
    sessionUser = R.id;
    await returnRoute.GET(new NextRequest(`http://localhost/api/payments/return?booking=${bk2.id}`));
    sessionUser = null;
    assert.equal(await ob2Status(), "PAID");
    assert.equal(await prisma.expense.count({ where: { tripId: trip.id, sourceReferenceId: bk2.id, source: "PINE_LABS" } }), 1);
    assert.equal(await prisma.tripEvent.count({ where: { tripId: trip.id, kind: "PAYMENT_OBLIGATION_PAID", payload: { contains: bk2.id } } }), 1);
  });
  await t("a one-off payment request (no obligation) also yields exactly one ledger effect on repeated PROCESSED answers", async () => {
    const bk3 = await prisma.booking.create({ data: { tripId: trip.id, type: "PAYMENT_REQUEST", status: "CREATED", participantIds: "[]", provider: "pinelabs", amount: 20000, currency: "INR", confirmationId: "pl-v1-three", payerId: A.id } });
    pineLink = { status: "PROCESSED", amount: 20000, currency: "INR", id: "pl-v1-three", ref: bk3.id };
    await Promise.all([refreshTripPaymentStatus(bk3.id), refreshTripPaymentStatus(bk3.id), refreshTripPaymentStatus(bk3.id)]);
    await refreshTripPaymentStatus(bk3.id);
    assert.equal((await prisma.booking.findUnique({ where: { id: bk3.id } }))!.status, "PROCESSED");
    assert.equal(await prisma.expense.count({ where: { tripId: trip.id, idempotencyKey: `pay:${bk3.id}` } }), 1);
    assert.equal(await prisma.tripEvent.count({ where: { tripId: trip.id, kind: "PAYMENT_CONFIRMED", payload: { contains: bk3.id } } }), 1);
  });

  // ============================== 11. THE THREE RAILS, TOLD TRUTHFULLY ==============================
  const { proposeDebt, payDirectiveOutcome: payOutcome } = await import("../../src/lib/agent/money-talk");
  const { confirmExpense } = await import("../../src/lib/budget/ledger");
  const { loadBudget } = await import("../../src/lib/budget/ledger");
  const { authorisePineSettlementAction, checkPineSettlementAction } = await import("../../src/app/settlement-actions");
  await t("'Ridhima owes me ₹1,000' is ONE debt Ridhima -> Arshia: never ₹500 each, never a group split, and not a debt until confirmed", async () => {
    await prisma.expense.deleteMany({ where: { tripId: trip.id } });
    await prisma.settlement.deleteMany({ where: { tripId: trip.id } });
    const reply = await proposeDebt(trip.id, A.id, { debtorWord: "Ridhima", creditorWord: "me", amountMinor: 100000 }, "msg-owes-1");
    assert.match(reply, /Ridhima owes Arshia ₹1,000/);
    assert.match(reply, /not a split/);
    const e = (await prisma.expense.findFirst({ where: { tripId: trip.id }, include: { participants: true } }))!;
    assert.equal(e.status, "PROPOSED");
    assert.equal(e.paidByUserId, A.id);
    assert.deepEqual(e.participants.map((p) => [p.userId, p.shareMinor]), [[R.id, 100000]]);
    const before = await loadBudget(trip.id, A.id);
    assert.equal(before.balances.length, 0, "unconfirmed: no debt in the ledger yet");
    await confirmExpense(e.id, A.id);
    const after = await loadBudget(trip.id, A.id);
    assert.deepEqual(after.balances[0].transfers, [{ fromUserId: R.id, toUserId: A.id, amountMinor: 100000 }]);
  });
  await t("'@Clockwise pay Arshia ₹1,000' (Ridhima): payer = Ridhima, payee = Arshia, amount = ₹1,000 — and a payment never runs backwards", async () => {
    const ok = await payOutcome(trip.id, R.id, { recipientWord: "Arshia", amountMinor: 100000, remaining: false });
    assert.ok(ok.settlement);
    assert.deepEqual([ok.settlement!.fromId, ok.settlement!.toId, ok.settlement!.amountMinor], [R.id, A.id, 100000]);
    assert.match(ok.reply, /from Ridhima to Arshia, not split with anyone/);
    assert.match(ok.reply, /matches what confirmed expenses say/);
    assert.match(ok.reply, /not the payment|counts as paid only when Pine Labs confirms/);
    const backwards = await payOutcome(trip.id, A.id, { recipientWord: "Ridhima", amountMinor: 100000, remaining: false });
    assert.equal(backwards.settlement, undefined);
    assert.match(backwards.reply, /owes YOU/);
  });
  let payCard: { id: string } | null = null;
  await t("authorising creates ONE Pine UAT link: link created is NOT paid — the debt stays, no settlement, the card says so", async () => {
    const { reply } = await (async () => {
      sessionUser = R.id;
      return say(R, "@Clockwise pay Arshia ₹1,000");
    })();
    assert.match(reply ?? "", /from Ridhima to Arshia/);
    payCard = (await prisma.message.findFirst({ where: { tripId: trip.id, cardData: { contains: '"settlement"' } }, orderBy: { timestamp: "desc" } }))!;
    assert.ok(payCard);
    sessionUser = A.id;
    assert.equal((await authorisePineSettlementAction(payCard.id)).ok, false, "only the payer can authorise");
    sessionUser = R.id;
    const [x, y] = await Promise.all([authorisePineSettlementAction(payCard.id), authorisePineSettlementAction(payCard.id)]);
    assert.ok(x.ok && y.ok);
    assert.equal(await prisma.paymentCollection.count({ where: { tripId: trip.id, payeeUserId: A.id } }), 1, "two taps, one payment");
    const card = JSON.parse((await prisma.message.findUnique({ where: { id: payCard.id } }))!.cardData!);
    assert.equal(card.settlement.pine.status, "CREATED");
    assert.match(card.settlement.pine.url, /^https:\/\/pine\.test\/pay\//);
    assert.equal((await prisma.message.findUnique({ where: { id: payCard.id } }))!.cardStatus, "PENDING");
    assert.equal(await prisma.settlement.count({ where: { tripId: trip.id } }), 0);
    const owedStill = (await loadBudget(trip.id, R.id)).balances[0].transfers;
    assert.deepEqual(owedStill, [{ fromUserId: R.id, toUserId: A.id, amountMinor: 100000 }], "the debt is untouched by a link");
    const ev = await prisma.tripEvent.findFirst({ where: { tripId: trip.id, kind: "PAYMENT_AUTHORISED" } });
    assert.equal(JSON.parse(ev!.payload).paid, false);
    // evidence: the Pine create call is on record with the request amount in paise
    const rc = await prisma.railCall.findFirst({ where: { tripId: trip.id, partner: "PINELABS", operation: { contains: "paymentlink" }, method: "POST" }, orderBy: { createdAt: "desc" } });
    assert.ok(rc);
    assert.equal(JSON.parse(rc!.requestJson).body.amount.value, 100000);
    assert.equal(rc!.httpStatus, 201);
  });
  await t("checking status: opened/started is still NOT paid; a PROCESSED answer for the wrong amount is ignored; the real one records ONE settlement and the card says paid", async () => {
    const data = JSON.parse((await prisma.message.findUnique({ where: { id: payCard!.id } }))!.cardData!);
    const linkId = (pineLink as { id: string }).id;
    for (const st of ["CLICKED", "PAYMENT_INITIATED"]) {
      pineLink = { status: st, amount: 100000, currency: "INR", id: linkId, ref: (pineLink as { ref: string | null }).ref };
      const r = await checkPineSettlementAction(payCard!.id);
      assert.ok(r.ok && r.status === st);
      assert.equal(await prisma.settlement.count({ where: { tripId: trip.id } }), 0);
      assert.equal(JSON.parse((await prisma.message.findUnique({ where: { id: payCard!.id } }))!.cardData!).settlement.pine.status, st);
    }
    pineLink = { status: "PROCESSED", amount: 50000, currency: "INR", id: linkId, ref: (pineLink as { ref: string | null }).ref };
    assert.equal((await checkPineSettlementAction(payCard!.id)).ok, false);
    assert.equal(await prisma.settlement.count({ where: { tripId: trip.id } }), 0, "wrong amount: nothing recorded");
    pineLink = { status: "PROCESSED", amount: 100000, currency: "INR", id: linkId, ref: (pineLink as { ref: string | null }).ref };
    await Promise.all([checkPineSettlementAction(payCard!.id), checkPineSettlementAction(payCard!.id)]);
    await checkPineSettlementAction(payCard!.id);
    const sets = await prisma.settlement.findMany({ where: { tripId: trip.id } });
    assert.equal(sets.length, 1);
    assert.deepEqual([sets[0].fromUserId, sets[0].toUserId, sets[0].amountMinor, sets[0].method], [R.id, A.id, 100000, "PINE_LABS"]);
    assert.equal((await prisma.message.findUnique({ where: { id: payCard!.id } }))!.cardStatus, "CONFIRMED");
    assert.equal(JSON.parse((await prisma.message.findUnique({ where: { id: payCard!.id } }))!.cardData!).settlement.pine.status, "PROCESSED");
    assert.equal((await loadBudget(trip.id, R.id)).balances[0].transfers.length, 0, "now, and only now, the debt is cleared");
    sessionUser = null;
    void data;
  });
  await t("provider truth: a Delhivery cool-down is recorded as NOT SENT (not a fake 429); Geoapify's answer is its own row labelled FALLBACK", async () => {
    process.env.DELHIVERY_MAPS_TOKEN = "stub-token-not-real";
    await prisma.delhiveryCache.upsert({ where: { key: "__ratelimit__" }, create: { key: "__ratelimit__", op: "ratelimit", requestJson: "{}", responseJson: "{}", expiresAt: new Date(Date.now() + 3600_000) }, update: { expiresAt: new Date(Date.now() + 3600_000) } });
    const { driveRoute } = await import("../../src/lib/travel/route-provider");
    const { withRailContext } = await import("../../src/lib/rails/evidence");
    const { providerLabel } = await import("../../src/lib/travel/provider-label");
    routeMode = "ok";
    const r = await withRailContext({ tripId: trip.id, userId: R.id }, () => driveRoute({ lat: 13.2, lng: 77.7 }, { lat: 12.97, lng: 77.59 }, { tripId: trip.id, userId: R.id, decision: "Arrival point to confirmed stay" }));
    assert.equal(r.provider, "geoapify");
    assert.match(r.fellBackFrom ?? "", /DELHIVERY_RATE_LIMITED/);
    const rows = await prisma.railCall.findMany({ where: { tripId: trip.id, partner: { in: ["DELHIVERY", "GEOAPIFY"] } }, orderBy: { createdAt: "desc" }, take: 2 });
    const del = rows.find((x) => x.partner === "DELHIVERY")!;
    const geo = rows.find((x) => x.partner === "GEOAPIFY")!;
    assert.equal(del.httpStatus, null, "a skipped call is not a 429");
    assert.equal(JSON.parse(del.responseJson!).sent, false);
    assert.match(del.decision ?? "", /NOT SENT/);
    assert.match(geo.decision ?? "", /FALLBACK/);
    assert.equal(geo.httpStatus, 200);
    assert.equal(providerLabel(r.provider, r.fellBackFrom), "Geoapify · FALLBACK (Delhivery rate-limited · 429 cool-down)");
    assert.equal(providerLabel("delhivery"), "Delhivery");
    delete process.env.DELHIVERY_MAPS_TOKEN;
    process.env.DELHIVERY_MAPS_TOKEN = "";
    await prisma.delhiveryCache.deleteMany({ where: { key: "__ratelimit__" } });
  });

  await t("passive: \"I'm vegetarian btw.\" then \"I am too! Dosa sounds good.\" stores Ridhima's own diet in code, without the model", async () => {
    const { observeMessage } = await import("../../src/lib/pointers/store");
    const base = ((await prisma.message.findFirst({ where: { tripId: trip.id }, orderBy: { timestamp: "desc" } }))?.timestamp.getTime() ?? Date.now()) + 1000;
    const m1 = await prisma.message.create({ data: { tripId: trip.id, channel: "GROUP", senderId: A.id, content: "I'm vegetarian btw.", timestamp: new Date(base) } });
    await observeMessage({ tripId: trip.id, userId: A.id, messageId: m1.id, text: m1.content });
    const m2 = await prisma.message.create({ data: { tripId: trip.id, channel: "GROUP", senderId: R.id, content: "I am too! Dosa sounds good.", timestamp: new Date(base + 5000) } });
    await observeMessage({ tripId: trip.id, userId: R.id, messageId: m2.id, text: m2.content });
    const rows = await prisma.travellerPreference.findMany({ where: { tripId: trip.id, key: "FOOD", value: "VEGETARIAN" } });
    assert.deepEqual(rows.map((r) => r.userId).sort(), [A.id, R.id].sort());
    // an echo with nothing to echo stores nothing
    const m3 = await prisma.message.create({ data: { tripId: trip.id, channel: "GROUP", senderId: S.id, content: "me too!", timestamp: new Date(base + 9000) } });
    const seen = await observeMessage({ tripId: trip.id, userId: S.id, messageId: m3.id, text: m3.content });
    assert.equal(seen.captured.filter((c) => c.kind === "DIET").length, 0, "the message before it states no diet, so there is nothing to echo");
  });

  console.log(`\n${passed} integration checks passed${failed ? `, ${failed} FAILED` : ""}`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
