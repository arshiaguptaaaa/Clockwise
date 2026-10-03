# Clockwise — Ken Round 3 submission analysis

Audit date: 3 Oct 2026. Source: the repository (108 commits, `main`) and the production deployment at https://clockwise-lemon.vercel.app, exercised during this build. Statuses are strict: "PRODUCTION VERIFIED" means it was run against the deployed app or the real provider; code existing is not evidence.

---

## 1. Executive thesis

Clockwise is not an itinerary generator. It is the **coordination layer for a group whose members run on different clocks**: different origins, tickets, arrival times, readiness, preferences and wallets, all converging on a few shared commitments (a stay, a dinner, a payment). It keeps three things apart and in sync: **canonical shared trip state** (one record of the stay, the route, the commitments), **private per-person state** (tickets, food, hard-nos, saves — never shown to the group), and the **relationship between the two** (does Eva's 9:15 PM landing break the 8 PM dinner?). Gemini interprets messy human input; deterministic code and real providers (Geoapify, Pine Labs, Gnani) compute facts, money and routes; humans keep authority over anything consequential (Observe → Suggest → Ask → Act, with approval before action). The question a judge should remember: *"How do you coordinate one shared trip when everybody is running on a different clock?"*

---

## 2. Repo audit — what is genuinely built

### Capability table

| CAPABILITY | STATUS | REAL PROVIDER / SIM / LOCAL | EVIDENCE IN REPO | PRODUCTION VERIFIED? | IN 5-MIN DEMO? |
|---|---|---|---|---|---|
| Trip creation wizard (destination search with state/country, dates, travellers) | PRODUCTION VERIFIED | Open-Meteo geocoder | `src/components/trip-wizard/*`, `destination-search/open-meteo-provider.ts` | Yes — created 5+ trips | Brief |
| Canonical trip state (Destination rows, TripEvent log, Decisions) | PRODUCTION VERIFIED | Local (Postgres) | `prisma/schema.prisma`, `lib/trip-route.ts` | Yes | Implicit |
| Trip Room group chat; Clockwise quiet unless addressed (code-enforced) | PRODUCTION VERIFIED | Gemini | `lib/agent/intervention-gate.ts`, `clockwise-agent.ts` | Yes — 3 banter messages, zero replies, zero loader | Yes |
| Agent tool loop (20+ tools) | PRODUCTION VERIFIED | Gemini (`gemini-flash-lite-latest` alias) | `lib/agent/tools.ts`, `providers/gemini.ts` | Yes | Yes |
| Gemini history-shape bug (400) | PRODUCTION VERIFIED (fixed + regression-locked) | Gemini | `scripts/regression/gemini-history.ts`, `/api/integrations/gemini/probe` | Yes — raw ends-on-model returns 400, real converter returns OK | No |
| Ask Clockwise sheet (private agent chat from Trip Room) | PRODUCTION VERIFIED | Gemini | `components/trip-room/AskClockwise.tsx`, `app/ask-actions.ts` | Yes (Weather topic; Find a stay flow) | Optional |
| Voice → Gnani STT → composer (never auto-sends, no Gemini fallback) | **Server path PRODUCTION VERIFIED; browser mic IMPLEMENTED BUT NOT HUMAN-TESTED** | **Real Gnani** `api.vachana.ai/stt/v3` | `lib/speech/gnani-stt-provider.ts`, `app/api/transcribe/route.ts`, `Composer.tsx` | Server: yes (HTTP 200, 1.04 s, `keySource: GNANI_SPEECH_API_KEY`, ITN "₹6,000", request id captured). Mic: blocked in my browser pane | Yes |
| Gnani outbound call (24-hour escalation) | BLOCKED / WIZARD-OF-OZ | Gnani Agent Builder (`api.inya.ai/platform`) — needs platform key, bot id, whitelisted number | `lib/voice-escalation/*`, `api/integrations/gnani/{probe,webhook}` | No — platform auth returned 401 with the speech key | Simulate |
| Expense detection from chat → "Clockwise caught that" card → confirm | PRODUCTION VERIFIED | Gemini interprets; local math | `tools.ts propose_expense`, `lib/budget/*` | Yes | **Yes — core** |
| Budget: ESTIMATED / COMMITTED / PAID, 5 split methods, balances, settle | PRODUCTION VERIFIED | Local integer math | `lib/budget/{split,balances,ledger}.ts` (18/18 local checks) | Yes — ₹6,000 dinner → ₹2,000 each; hotel COMMITTED → PAID; settlement | Yes |
| Pine Labs UAT: auth → payment link → hosted checkout → status API | **Auth, link create, checkout load, status lookup PRODUCTION VERIFIED; PROCESSED (actual payment) NOT YET RUN** | **Real Pine Labs UAT** `pluraluat.v2.pinepg.in` | `lib/payments/pine-labs-provider.ts`, `trip-payments.ts`, `payment-lifecycle.ts` | Token 200; links `pl-v1-261003061011-aa-Jbh1MF` (CREATED) and a Booking-linked link; status API returned `CLICKED` after the page was opened | Yes |
| Pine webhook | IMPLEMENTED BUT NOT PRODUCTION VERIFIED | Pine Labs | `api/integrations/pinelabs/webhook`, `webhook-signature.ts` | No — `PINELABS_WEBHOOK_SECRET` not set; status-API verification is the working path | Optional (WoZ) |
| Delhivery | **NOT BUILT** | None | `grep -ri delhivery` returns nothing in src/docs/prisma | No | WoZ only |
| Geoapify places (stays, restaurants, attractions, convenience, pharmacy…) | PRODUCTION VERIFIED | **Real Geoapify** | `lib/travel/geoapify-provider.ts`, `around.ts` | Yes | Yes |
| Geoapify routing + provider walking times | PRODUCTION VERIFIED | Real Geoapify | `getRoute`, `/api/integrations/geoapify/probe` | Yes (airport → hotel 28.1 km / 31 min) | Yes |
| Canonical location layer (identity-aware destination match, airport POI, plausibility guard, "WHICH X?") | PRODUCTION VERIFIED | Local rules over Geoapify | `lib/travel/resolve.ts`, `lib/location/plausibility.ts`, regression script | Yes — Udaipur/Udaipur Airport/Jaipur→Udaipur/Delhi→Udaipur all correct; wrong-Udaipur case blocked in unit test | Implicit |
| Stay state machine: discover → save → propose → vote → organiser approve → **mark booked** → Plan/My Clockwise/"our hotel" | PRODUCTION VERIFIED | Geoapify discovery; **no rates** | `lib/stays.ts`, `hotel-provider.ts` | Yes (several end-to-end runs) | Yes (compressed) |
| Live hotel rates / availability / booking | **NOT BUILT / BLOCKED** | None (needs a partner account: TBO, RateHawk, Hotelbeds, Expedia Rapid…) | `HotelProvider` returns `NOT_CONNECTED` | — | **Do not show** |
| Vibe Check (private, 9 questions, skips what's known) | PRODUCTION VERIFIED | Local | `lib/traveller/vibe.ts`, `components/vibe/VibeCheck.tsx` | Yes — full run, "GOT YOUR VIBE.", nothing in group chat, trace shows counts only | Optional |
| Ticket upload → extraction → private confirm → canonical journey | PRODUCTION VERIFIED | **Gemini reads the PDF**; no PNR/seat/name extracted | `lib/document-extraction.ts`, `traveller/journey.ts` | Yes — pending journey shown, edited, confirmed | Yes |
| Plan arrivals + **Rendezvous** (individual clocks vs shared commitments) | PRODUCTION VERIFIED | Geoapify routes + local rules | `lib/rendezvous.ts`, `components/plan/RendezvousSection.tsx` | Yes — "Dinner 8:00 PM — Harnoor can't be at the stay before 9:19 PM"; organiser notified | **Yes — the heart of the story** |
| Ready? (derived checklist; weather items; CONFIRMED / LIKELY / OPTIONAL) | PRODUCTION VERIFIED | Open-Meteo forecast | `lib/traveller/ready.ts` | Yes — 21–33 °C forecast produced Sunscreen + Water (LIKELY, with source) | Optional |
| Around You (anchored on destination, then confirmed stay; brand search; walk minutes from provider) | PRODUCTION VERIFIED | Geoapify | `app/.../agent/around`, `around.ts` | Yes — "I couldn't find a nearby 7-Eleven, but here are the closest convenience stores" | Optional |
| Notifications (in-app; push needs VAPID; email) | In-app PRODUCTION VERIFIED; push BLOCKED (no VAPID keys); email BLOCKED (see below) | Local / Resend | `lib/notifications.ts` | In-app yes | Yes (in-app) |
| Invite email + reminders (2-min/24-h escalation engine) | IMPLEMENTED; **delivery BLOCKED** | Resend sandbox | `lib/email/*`, `invite-engine.ts`, `reminder-worker.ts` | Email accepted and `delivered` — **to the sandbox recipient, not the entered address** (`WAITLIST_EMAIL_TEST_RECIPIENT` + unverified domain) | No |
| Agent Trace | PRODUCTION VERIFIED | Local | `lib/agent/trace.ts`, `/trips/[id]/agent/trace` | Yes — typed events with provider, ids, counts, retrieval time | **Yes — shown on screen** |
| Landing page | PRODUCTION VERIFIED | — | `src/app/page.tsx` | Yes | Yes (2 s) |
| Production probe routes (signed-in): resend, gnani, pinelabs, geoapify, gemini | PRODUCTION VERIFIED | — | `src/app/api/integrations/*/probe` | Yes | No (evidence tooling) |
| Compass / swipe discovery / group vibe aggregate / overlap → proposal | NOT BUILT | — | Only `SavedPlace` + private ♡ exist | — | No |
| Flights / trains / buses search, Uber/ride handoff, live fares | NOT BUILT (Uber sandbox models exist, untouched this build) | — | `lib/uber/*` | — | No |

### What is irrelevant to Round 3
Compass, Saved, Vibe Check polish, Budget categories/threshold bars, the Ask Clockwise topic grid, payments for non-trip purposes, push notifications. They are real but they dilute a 5-minute story about *clocks*.

---

## 3. Round 3 answers

### Q1 — One person's story (≤100 words)
Saturday 12 December. Eva boards a 3 PM flight to Udaipur for Arshia's birthday weekend; dinner is at 8. At 5 PM she holds the mic and says, "My flight's delayed — I land at nine fifteen." Clockwise measures the drive from the airport to Hotel Trident, sees she can't make dinner, and quietly asks Arshia. He approves moving the table to 10:15; a ₹2,000 deposit link appears. Eva pays, lands, and walks into the lobby as the others sit down. Nobody called anyone, and nobody was asked "where are you?"

*(86 words. Caveat: today the agent cannot yet turn Eva's voice note into an updated arrival, or move the dinner — see "Top three fixes".)*

### Q2 — Every decision, in order
**Do not fill the real table until the recording exists.**

**A. Ideal decisions the recording should show**

| # | Decision | Can Clockwise make it today? |
|---|---|---|
| D1 | Interpret Eva's voice note as a change to *her arrival* | **No** — `report_delay` only shifts commitment readiness; there is no tool that updates a traveller's journey. **Must build.** |
| D2 | Recompute everyone's clock against the confirmed stay using provider routes | Yes (`recomputeRendezvous`, Geoapify) |
| D3 | Decide the dinner is at risk for exactly one person and tell only the organiser | Yes (`RENDEZVOUS_AT_RISK`, one notification, deduped) |
| D4 | Stay silent in the group chat (not narrating the problem) | Yes (quiet mode is code-enforced) |
| D5 | Propose a fix to the group (new dinner time / "Eva joins later") | **Partly** — proposal pipeline exists; no executor that changes a Commitment. **Must build.** |
| D6 | After approval, create a Pine Labs payment link for the deposit | Yes (proposal → `createTripPaymentRequest`) |
| D7 | Treat the money as COMMITTED, not PAID, until Pine Labs reports PROCESSED | Yes (`commitFromProposal`, `markPaidFromPayment`) |
| D8 | On verified payment, mark PAID, recompute balances, tell the group | Yes |

**B. Genuinely makeable today:** D2, D3, D4, D6, D7, D8 (+ expense detection and stay confirmation as optional extras). **D1 and D5 are the gap.**

**C. Extract from Agent Trace after recording** (per event: `createdAt`, `kind`, the INPUT line, SOURCE, UNDERSTANDING, STATE, PROPAGATION): `VOICE_CAPTURED`, `GNANI_STT_STARTED`, `GNANI_STT_COMPLETED` (provider, request id, latency), `TRAVELLER_JOURNEY_CONFIRMED`/arrival-change event, `RENDEZVOUS_COMPUTED`, `RENDEZVOUS_AT_RISK`, `PROPOSAL_CREATED`/`PROPOSAL_VOTE_CAST`/`PROPOSAL_ORGANISER_CONFIRMED`/`PROPOSAL_EXECUTED`, `PAYMENT_LINK_CREATED`, `PAYMENT_LINK_STATUS`, `PAYMENT_CONFIRMED`, `EXPENSE_*`, `BALANCES_RECALCULATED`. Then, for each, the system-prompt rule from `docs/system-prompt-export.txt` that licenses it, and the exact message text from the `Message` table.

**D. Table template**

| # | WHEN (exact) | AGENT RECEIVED (exact) | FROM (connector → real source) | DECIDED | WHY (prompt rule, quoted) | DID / SAID, to whom, word for word | THROUGH |
|---|---|---|---|---|---|---|---|

### Q3 — What Clockwise knows on day one
- **System knowledge:** its operating rules (system prompt, ~5,900 words incl. tool descriptions): ask one question at a time, facts only from tools, never claim "booked"/"paid" without a tool result, stay quiet in group chat unless addressed, privacy rules.
- **Provider capability knowledge:** what each rail can and cannot do, *encoded in code, not remembered*: Geoapify = places/routes, no prices; the `HotelProvider` interface says availability/rates/booking = NOT_CONNECTED; Pine Labs = a link is not a payment, only a fetched `PROCESSED` is; Gnani STT = transcript, no decisions.
- **Trip-specific knowledge** (supplied by the organiser at creation, then by group decisions): destination (a *resolved* place with state/country/coordinates), dates, travellers, confirmed stay, commitments.
- **Person-specific knowledge** (supplied by each traveller): journey (confirmed ticket facts), vibe-check preferences, availability limits.
- **Private state:** ticket contents beyond journey facts (never stored: name, PNR, seat, fare), food, hard-nos, saves, budget ceilings, readiness ticks. Visible only to the owner.
- **Shared state:** route, stay, approved proposals, expenses and balances, each traveller's arrival time/place/mode, commitments.
- **Deliberately does NOT know:** live hotel prices or availability, whether a shop stocks a product, whether any one restaurant is vegetarian (only that the provider's vegetarian filter returned it), legal/ID rules per route, anyone's location unless they opt in, and what Gemini "remembers" about the world — tools are the only source of facts.

### Q4 — Every call to Gnani, Pine Labs, Delhivery
Only endpoints that appear in this repo or its docs are listed. Anything else = **EVIDENCE REQUIRED**.

| Partner | Purpose | Documented endpoint (from code) | Real / WoZ | Evidence in hand | What Clockwise learned → next decision |
|---|---|---|---|---|---|
| Gnani | Voice note → text | `POST https://api.vachana.ai/stt/v3`, header `X-API-Key-ID`, multipart `audio_file`, `language_code=en-IN`, `format=transcribe` | **Real** | Sanitised response, 12 Dec test: `{"success":true,"request_id":"01a1009d-6462-74dd-b1e5-3c44347aac12","transcript":"i paid ₹6,000 for dinner split between me eva and vasudha", model, processing_time, end_to_end_latency}`; HTTP 200; 1043 ms; `keySource: GNANI_SPEECH_API_KEY` | Transcript goes to the composer, user edits and sends; then the agent runs `propose_expense` (ITN already wrote "₹6,000") |
| Gnani | Outbound call after unanswered reminders | `api.inya.ai/platform` (Agent Builder; `x-api-key`; trigger-call) | **WoZ (blocked)** | `/api/integrations/gnani/probe` → 401 with the speech key. **EVIDENCE REQUIRED:** platform key, agent (bot) id, whitelisted number, and the documented call-status payload from Gnani's docs | — |
| Pine Labs | Auth | `POST {base}/api/auth/v1/token` (`client_credentials`) | **Real (UAT)** | HTTP 200 against `pluraluat.v2.pinepg.in` (token never shown) | Credentials valid |
| Pine Labs | Create payment link | `POST {base}/api/pay/v1/paymentlink` — body `amount{value,currency}`, `merchant_payment_link_reference`, `description`, `expire_by`, `callback_url`, `customer{first_name,email_id|mobile_number}` | **Real (UAT)** | First attempt **HTTP 400 `INVALID_REQUEST "Customer Information is required"`** (a real finding); after fix: `{"payment_link_id":"pl-v1-261003061011-aa-Jbh1MF","status":"CREATED","payment_link":"https://pbl.v2.pinepg.in/PLUTUS/j9feffc"}` | A link exists; nothing is paid → card says "Pay securely", budget stays COMMITTED |
| Pine Labs | Status | `GET {base}/api/pay/v1/paymentlink/{id}` | **Real (UAT)** | Returned `CLICKED` after the hosted page was opened | Still not paid → no state change beyond CLICKED |
| Pine Labs | Payment confirmation | same `GET`; webhook `POST /api/integrations/pinelabs/webhook` (`webhook-id/timestamp/signature`) only *triggers* a re-fetch | **Real if you pay; otherwise WoZ with the documented webhook body** | **EVIDENCE REQUIRED:** a `PROCESSED` status body (run one UAT payment, then fetch the link) and, for WoZ, Pine's documented webhook payload | PROCESSED → Booking PAID → Budget COMMITTED → PAID → group card + notification |
| Pine Labs | Cancel / resend | `PUT …/cancel`, `PATCH …/resend` | Implemented, not exercised | — | — |
| Delhivery | (nothing in repo) | **EVIDENCE REQUIRED.** Public listing shows Delhivery Maps: geocoding, reverse geocoding, address validation, routing, distance matrix, tolls, autosuggest. A search snippet showed `https://gateway-maps-pub-int.delhivery.com/v1/geocode` and an MCP endpoint, with *conflicting auth wording* (`x-api-key` vs Bearer). **Do not cite endpoints until read from https://www.delhivery.com/maps/developer.** | **WoZ** | None | Would feed the arrival → stay ETA in `rendezvous.ts` for Indian addresses |

Save for the submission: the Pine create request body (from `pine-labs-provider.ts createPaymentLink`), the 400 response and the 200 response above, the Gnani response, and — after the recording — raw payloads from a rail-call log (see Top-three fixes #3).

### Q5 — Up to three imagined capabilities
Only two materially strengthen the thesis. Both are labelled **HYPOTHETICAL** — neither endpoint exists.

1. **Pine Labs — group collect.** *Capability:* one request with N payer shares → N payer-specific links, one aggregated status ("3 of 4 paid"). *Endpoint (hypothetical):* `POST /api/pay/v1/paymentlink/group`. *Pine already holds:* payer instrument and UPI success history, link lifecycle and expiry state, settlement. *Why that makes it possible:* the missing piece in today's flow is "who has paid" — Pine is the party that actually knows, so Clockwise could chase only the unpaid, in each person's own clock, without the organiser asking.
2. **Delhivery — luggage-ahead.** *Capability:* quote and book a bag/parcel from a traveller's home pincode to the stay, with a delivery-by time. *Endpoint (hypothetical):* `POST /v1/shipments/quote` (labelled hypothetical; real shipment APIs exist but are not documented here). *Delhivery already holds:* pincode serviceability, transit times, address-quality scores for Indian addresses. *Why:* it removes a reason for someone to arrive early or late — it separates a person's clock from their luggage's.

(A third — Gnani "call the property" to confirm a late check-in in Hindi — is not imagined: it is the existing outbound capability we could not access.)

### Q6 — Every human surface

| Surface | Status |
|---|---|
| Landing page | REAL PRODUCTION SCREEN |
| Create trip (wizard) | REAL |
| Invite (link) / invite acceptance | REAL |
| Invite email | PARTIAL — real HTML email exists and renders; **delivery goes to a sandbox inbox** → use a screenshot of the email, state that sending is sandboxed |
| Trip Room (group chat + cards) | REAL |
| Ask Clockwise sheet | REAL |
| Voice composer (mic) | REAL (needs your physical test before filming) |
| Stay cards / Propose / Voting / Organiser approval / "Mark booked" | REAL |
| Plan (stay, arrivals, rendezvous) | REAL |
| Travellers page | REAL |
| Budget / expense card / Settle | REAL |
| Payment ("Pay securely" → Pine hosted page) | REAL (Pine-hosted page is theirs) |
| Notification centre | REAL (in-app) |
| Reminder / escalation email | MOCKUP REQUIRED |
| My Clockwise: Journey, Ready?, Around you, Saved | REAL |
| Vibe Check | REAL |
| Agent Trace | REAL |

Prefer production screenshots everywhere except the reminder email.

### Q7 — Agent readiness /10
- **Gnani — 6/10.** Works: STT is fast (~1 s), the ITN turns "six thousand rupees" into "₹6,000" which feeds Budget directly; a clear key/header model; Hindi/regional languages. Held back: outbound calling needs a *different* platform key, agent id and whitelisted numbers (we got 401 with the speech key); no way to self-serve those; trigger-call responses don't carry a conversation id we could poll.
- **Pine Labs — 7/10.** Works: token + payment-link API is clean, REST/JSON, a hosted checkout, a status endpoint we can fetch (which is exactly the trustworthy-state pattern an agent needs). Held back: **customer information is mandatory** (a 400 we only saw by trying — an agent that doesn't know a payer's contact can't create a link); no multi-payer collect; webhook secret and URL registration are manual; we have not yet seen a `PROCESSED` end to end.
- **Delhivery — 3/10 for us today.** The published capability list (routing, distance matrix, tolls, India-grade geocoding) is exactly what a group-arrival agent wants — but we have no key, no verified endpoint, and the search snippet contradicts itself on auth. It is a good *fit* we could not *test*. A 10 would be: a sandbox key, one routing + one distance-matrix call returning real ETAs for Indian addresses, and webhook-free polling.

### Q8 — Where Clockwise lives
**Its own app (a PWA) — entered through the WhatsApp group the trip already lives in.** Own app, because Clockwise needs things a chat thread cannot hold: a per-person private layer, authorisation cards, money, and notifications. WhatsApp, because that is where the trip is already being discussed. The onboarding loop: the organiser creates the trip (30 s) → pastes **one link** into the existing WhatsApp group → each person taps, joins without installing, does a 30-second private vibe check and drops in their ticket → the group immediately sees an **arrivals board** (who lands when, and whether the plan survives it). The value for the second person arrives before the first message.

### Q9 — Which company should build it?
**Recommendation: Clockwise as an independent neutral layer, using WhatsApp as the front door and the three rails as partners.**

| Option | For | Against |
|---|---|---|
| **Clockwise (independent)** | Neutral between airlines, stays, rides and payments; agent-native from day one; incentives = group outcome, not inventory | No inventory, no installed base, cold start, depends on rails |
| MakeMyTrip / Goibibo | Inventory, payments, travel intent, loyalty | Sells *its* inventory — a group agent that routes to a rival's cheaper room or a train is against its P&L; individual-booking architecture; can't see tickets bought elsewhere |
| Google | Maps/location, Gmail tickets, Calendar, Google Pay, Gemini | Org incentives (ads, no group-travel P&L; Trips was shut down); broad surfaces, slow to ship a vertical agent; consumer-privacy posture around reading inboxes |
| Uber | Mobility, payments | Only one leg of the journey; will not be neutral toward other rides |
| WhatsApp / Meta | **The group graph and the habit** — no one has the trip group already assembled | End-to-end encryption means it can't read the plan; no maps depth, no travel inventory, no payments depth for this; incentives are engagement and business messaging |

*Why them (an independent):* the product's central promise is that nobody has to be the coordinator, which only works if the agent is not secretly an advertiser for one supplier. *What do they have that nobody else does?* A purpose-built model of **per-person private state + shared canonical state** and the trust mechanics around it (confirmations, provenance, quiet-by-default). Every incumbent owns one half. *Why hasn't it been built already?* Incumbents are structurally conflicted (inventory, ads, encryption) and group coordination is low-ARPU until payments and bookings route through it — a startup can accept that.

**Honest weakness to state in the submission:** an independent has no moat on day one beyond execution and the group graph it builds; WhatsApp could clone the surface. The defence is neutrality plus accumulated trip state.

### Q10 — Customer and business model
- **Who uses it:** the 4–8 person friend, family or wedding group, led by one over-burdened organiser; most acutely wedding and destination-event groups, where dozens arrive on separate clocks.
- **Who pays:** not the travellers, at first. Revenue comes from the money that moves through the trip and the suppliers who want the group.
- **What they do today:** WhatsApp group + screenshots of tickets + a shared Sheet/Notes + Splitwise + the organiser personally chasing people ("kab pahunch rahe ho?"). **Cost:** hours of the organiser's time per trip, errors (someone missing a pickup), and awkward money chasing. *These are hypotheses to quantify:* in the first 25 concierge groups, count messages, chaser calls and organiser hours per trip, and use that as the cost number.
- **Model:** free coordination → (1) **payment rail share** on group collections and deposits (Pine Labs link; Clockwise never holds funds), (2) **booking referral** once an inventory partner is connected (hotels, intercity transport, rides), (3) later **B2B2C**: wedding planners, college fest committees, corporate offsites pay for the group tooling. Not a subscription: the person who benefits (the organiser) is also the person who'd resist paying, and transaction economics scale with the thing Clockwise actually coordinates.

### Q11 — First 1,000 users = ~250 organisers
- **Who:** (a) college travel societies and fest/club trip leads, (b) the friend who "always makes the Sheet", (c) wedding-guest-transport coordinators, (d) hostel-floor and office-offsite organisers.
- **Where they already are:** WhatsApp groups, Splitwise, Notes/Sheets, college club Instagram handles.
- **The trigger moment:** the second someone types "send your ticket screenshots" or "who's reaching when?" in the group.
- **The mechanic — the Clock Link:** the organiser pastes one link; its preview shows the trip card and a live **arrivals board**. Friends join because it removes the thing the organiser keeps asking *them* — and they get their own private readiness checklist and a shared ledger for free.
- **Why friends join:** the first person to add their ticket sees everyone else's arrival; nobody wants to be the blank row.
- **One trip creates another:** the post-trip recap settles the money and offers "same group, next trip" with preferences pre-filled; every traveller who is the organiser elsewhere sees Clockwise on their phone.
- **Campus density:** one society = dozens of trips a year with the same people; seed 10 societies → ~25 organisers each cycle, and trips overlap in membership.
- **Referral:** "Bring a trip, not a friend" — the organiser gets the next trip's setup (and any payment-rail fee waived) when a friend runs a trip through the link.
- **First 25 groups, by hand:** the founder is the agent. With consent, join the group, take voice notes and tickets, run the Clockwise screens manually, and record every decision — this is both the Wizard-of-Oz evidence and the dataset for what the agent should decide.

### Q12 — What keeps them using it after three weeks
Retention unit: **the group (trip graph), not the individual and not the single trip.** A trip is an episode; the group is the asset. What accumulates: tickets and arrival history, each person's private preferences, the shared expense ledger and who owes whom, saved places, the trip's decisions and photos/memories. Switching cost = unsettled money plus "my group is already in there". Usage is not manufactured: it spikes during live trip operations and around settling, and returns when the same people plan again. Do not optimise for daily opens.

### Q13 — Landing page
*Current production page:* eyebrow "Group travel, kept on time"; headline "One trip. Many clocks."; subline "Everyone can arrive differently. Clockwise keeps the trip together."; CTAs "Plan a trip" / "Join a trip"; a Jaipur photo with "Hawa Mahal · 10:00 / Plan synced / Everyone ready?" annotations; "Join the early-access list" and "Explore demo trip" links.

*Verdict:* it communicates the insight in the headline and subline. It under-delivers on **proof**: nothing shows individual clocks converging. Change only what helps the submission: (1) CTA to **START A TRIP**; (2) replace one annotation with an arrivals-board strip ("Eva 5:20 PM · Arshia 6:10 PM · Vasudha 9:15 PM → dinner moved to 10:15"); (3) one supporting line: "Everyone arrives differently. Everyone gets ready differently. One person shouldn't coordinate all of it." Because Q9 selects an independent, the page should keep Clockwise's own voice, not an incumbent's.

### Q14 — What could kill Clockwise in year one
Top three, ranked:
1. **Wrong canonical state / wrong agent decision destroys trust.** *We hit this in testing:* "Udaipur" resolved to a different Udaipur and produced a confident "496 km, 7 h 16 min" airport transfer. **Mitigation built:** identity-aware destination matching, an ambiguity prompt ("WHICH UDAIPUR?"), a plausibility guard that withholds implausible routes, provider provenance on every fact, confirmation before any journey is saved, Agent Trace for audit. Year one: keep expanding these guards as regression tests.
2. **Cold start / distribution friction — every traveller has to join.** Mitigation: link-first, no install, organiser-only value on day one, the arrivals board as the pull for everyone else, concierge for the first 25 groups.
3. **Provider dependency and thin inventory** (no live rates, sandbox email, rails that need partner approval). Mitigation: honest "not connected" states, `HotelProvider`-style interfaces so partners slot in, keep money flowing through partners' own hosted pages, apply early for inventory partnerships.

Others, lower: privacy (mitigated by private-by-default storage and neutral aggregates), group social dynamics (the organiser stays the final authority), low trip frequency (group asset + settlement + next-trip loop), incumbent response (neutrality and state).

---

## 4. Evidence gaps — do not claim these yet
- A **real Pine Labs PROCESSED payment** end to end (needs you to pay a UAT link).
- **Browser microphone → composer** (needs your physical test).
- **Invite emails reaching arbitrary inboxes** (Resend domain unverified; `WAITLIST_EMAIL_TEST_RECIPIENT` redirect active).
- **Reminder/escalation tests B and C** (2-minute reminder email; accept inside the window) — need real email delivery.
- **Gnani outbound calls** and **Delhivery** — no access.
- **Agent updating a traveller's arrival from chat/voice**, and **moving a commitment after approval** — not built.
- **Resolved Gemini model version** (we send the alias `gemini-flash-lite-latest`).
- **Live hotel rates/availability/booking**, ride booking, flights — not built.
- Any number about market size, WhatsApp/Google/MMT user counts, or time lost by organisers — none are in the repo; either source them or omit.

## 5. Exact data to extract before submission
1. **System prompt:** `docs/system-prompt-export.txt` (regenerate with `npx tsx scripts/export-system-prompt.ts`). **Model:** `gemini-flash-lite-latest` (alias). To capture the resolved version, call the model once and record `modelVersion` from the response, or `GET https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest` with your key.
2. **Gnani:** the request (multipart fields above, key redacted) and the full JSON response per call; the `request_id`s from Agent Trace `GNANI_STT_COMPLETED`.
3. **Pine Labs:** token request (redacted), create-link request body, 400 and 200 responses, each status-lookup response, and the final `PROCESSED` body.
4. **Delhivery:** from https://www.delhivery.com/maps/developer — the exact endpoint, auth header, request and sample response you will use for the WoZ call.
5. **Agent Trace** export for the recording window (`/trips/<id>/agent/trace`).
6. **Raw chat text** for the decision table: `Message.content` for every Clockwise message in the window.
7. Screenshots: Trip Room, Plan arrivals/rendezvous, Pay card, Pine hosted page, Budget.

## 6. Final 5-minute demo script (≈4:30)

**Setup (not filmed):** Trip "Udaipur birthday", 3 travellers (Arshia organiser, Eva, Vasudha), Hotel Trident confirmed, three confirmed journeys, one shared commitment "Dinner 8:00 PM", all green in Plan.

| Time | Screen | User action / external event | Clockwise decision | Visible output | Rail | Why |
|---|---|---|---|---|---|---|
| 0:00–0:20 | Landing → Plan | Title card: "One trip. Many clocks." Show the arrivals board: three clocks, "everyone at the stay by 6:10 PM; dinner 8:00 ✓" | — | Plan arrivals + rendezvous | Geoapify (already computed) | Establish the shared commitment and the individual clocks |
| 0:20–1:00 | Trip Room (Eva) | Eva taps the mic and says "My flight's delayed — I land at nine fifteen" | — | Gnani request + response pasted on screen; transcript appears **in the composer**; Eva edits nothing and presses Send | **Gnani** | Real voice input; never auto-sent |
| 1:00–1:40 | Trip Room / Agent Trace | — | **D1:** interpret as a change to Eva's arrival (needs the new tool) | Eva's clock updates; trace shows the event | Gemini | The agent makes the first decision |
| 1:40–2:20 | Plan + notification (Arshia) | — | **D2/D3:** recompute with a provider route; dinner at risk for Eva only; notify the organiser; **stay silent in the group chat (D4)** | "Dinner 8:00 PM — Eva can't be at the stay before 10:10 PM"; one notification | Geoapify / **Delhivery (WoZ)** for the India leg | The core insight: one clock breaks a shared commitment |
| 2:20–3:10 | Trip Room (Arshia) | Arshia reads the proposal | **D5:** propose "move dinner to 10:15" + hold-the-table deposit | Proposal card with votes | — | Human keeps authority |
| 3:10–3:40 | Trip Room | Vasudha and Arshia approve; Arshia confirms | Execute: Commitment moves; payment link created (**D6**) | "Pay securely ₹2,000" card; Pine create + response shown | **Pine Labs** | Consequential action only after approval |
| 3:40–4:15 | Pine hosted page → Budget | Eva pays on Pine's page; the PROCESSED status is fetched | **D7/D8:** PAID only on provider status; recompute balances; notify | Budget: COMMITTED → PAID; "Eva owes ₹0 / Arshia is owed ₹…" | **Pine Labs** | Trust: state changes only on the provider's word |
| 4:15–4:30 | Agent Trace | Scroll the chain | — | Every decision: input → source → rule → output | — | Evidence |

*Honest note:* this script needs the two missing decisions (D1, D5). If they cannot be built, shorten the story to "late arrival → at-risk commitment → organiser notified" and use the stay/expense/Pine chain as the action leg.

## 7. Screenshot / mockup checklist
Landing; wizard destination step; Trip Room with "Clockwise caught that"; Ask Clockwise sheet; stay cards (live rate not connected); proposal + votes; "EVERYONE'S ALIGNED" card; Plan (stay + arrivals + rendezvous); Journey card + confirm; Ready?; Around You; Budget; Pay card + Pine hosted page + status; Agent Trace; notification; **mockup only:** reminder/escalation email and the Gnani call transcript.

## 8. Landing page verdict
Keep the headline and subline. Change the primary CTA to START A TRIP and add the arrivals-board proof strip. Don't redesign.

## 9. Top three fixes before recording (only blockers)
1. **`update_my_arrival` agent tool** (and a voice/chat path to it): a traveller says their journey changed; the agent updates their confirmed journey, recomputes rendezvous, records the trace event. Without it the story's first decision is faked.
2. **Reschedule executor:** an approved proposal that changes a Commitment time (and the Plan), so the group's decision has a consequence.
3. **Rail-call log:** persist sanitised raw request/response for every Gnani/Pine (and WoZ Delhivery) call with timestamp and the triggering event id, plus a documented-webhook injection path — the submission requires the exact payloads and we only keep summaries today.

(Not blockers for the video: invite-email domain — unless you want to film the invitation arriving — and live hotel rates.)

## 10. Do-not-build list
Compass/swipe discovery, group-vibe aggregate, saved-place overlap → proposal, flight/train/bus search, Uber/ride handoff, live hotel rates, WhatsApp bot, push notifications, more Vibe Check/Around You polish, further visual redesign.
