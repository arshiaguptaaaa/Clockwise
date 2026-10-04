# Production deployment: hardening pass (for approval, nothing here has been run on production)

Branch `hardening/subtle-conversations` (1 commit on top of `c4fa1b1`, the build that is live now). Not pushed.

## 0. Do this first: the Preview environment shares the production database

`vercel env ls preview` shows `DATABASE_URL` and `PRISMA_DATABASE_URL` scoped to **Preview and Production** (the same values).
Any non-`main` branch pushed to GitHub is built by Vercel as a preview, and the build runs `prisma migrate deploy` and the seed
against that database. **Pushing this branch as it stands would migrate the production database.** Until that is fixed:

1. Create a separate database (e.g. a second Prisma Postgres resource, or a Neon free project).
2. In Vercel > Project > Settings > Environment Variables, remove `DATABASE_URL` / `PRISMA_DATABASE_URL` from the Preview scope and add the
   new database's URLs for Preview only.
3. Add the secrets a working preview needs, Preview scope only (they are stored as sensitive, so they cannot be copied by script):
   `GEMINI_API_KEY`, `GEOAPIFY_API_KEY`, `PINELABS_BASE_URL`, `PINELABS_CLIENT_ID`, `PINELABS_CLIENT_SECRET` (UAT only),
   optionally `DELHIVERY_MAPS_TOKEN`. Leave `RESEND_API_KEY`, `UBER_*`, `GNANI_*`, VAPID keys unset so nothing external fires.
4. Deployment Protection on previews will ask for a Vercel login; use a protection-bypass token for automated checks.

## 1. What the migrations do (all four additive, no data is rewritten)

```sql
-- 20261005190000_traveller_direct_route
ALTER TABLE "TravellerJourney" ADD COLUMN "directToCommitmentId" TEXT, ADD COLUMN "directRouteSeconds" INTEGER,
  ADD COLUMN "directRouteMeters" INTEGER, ADD COLUMN "directProvider" TEXT, ADD COLUMN "notOutBeforeLocal" TEXT;
-- 20261005200000_proposal_conditions
CREATE TABLE "ProposalCondition" (...);  -- new table, FK to Proposal ON DELETE CASCADE
-- 20261005210000_route_fallback_label
ALTER TABLE "TravellerJourney" ADD COLUMN "routeFellBackFrom" TEXT; ALTER TABLE "TripClash" ADD COLUMN "routeFellBackFrom" TEXT;
ALTER TABLE "PaymentCollection" ADD COLUMN "payeeUserId" TEXT;
```

Rehearsal (local Postgres 17): database built from the migrations that are live today, seeded, a marker row added, then the two new
migrations applied: row counts before and after were identical (Trip 1, TripMember 4, Message 8, TripEvent 1), the new columns exist.
Old code ignores the new columns and table, so a rollback needs no schema change.

`npm run build` already runs `prisma migrate deploy`, so merging to `main` applies them. No manual SQL.

## 2. Existing trips

* `prisma/seed.ts` no longer rebuilds the demo trip on a deploy. It rebuilds it only with `RESET_DEMO=1` (or `npm run demo:reset`).
  Verified locally: seed, seed again (preserved), `RESET_DEMO=1` (rebuilt). User-created trips were never touched by the seed.
* Take a snapshot first (Prisma Postgres console > Backups, or from a machine that holds the connection string):
  `pg_dump "$DATABASE_URL" --format=custom --file clockwise-pre-hardening.dump`
  (I have no access to production credentials, so this step is yours.)

## 3. Steps

1. Complete section 0 and run the preview verification on the isolated database.
2. Open a PR from `hardening/subtle-conversations` to `main`; review the diff.
3. Merge. Vercel builds `main`: migrate (2 additive migrations), seed (no-op for the existing demo), build, deploy.
4. `npx vercel ls` until the new deployment is Ready.
5. Smoke test on production, no real charges: `/api/integrations/pinelabs/probe` (auth only), then a Pine UAT link via the in-app flow and open the
   checkout page without paying; send the five baseline messages from the verification table to a fresh test trip.
6. Rollback if needed: `npx vercel rollback` (or redeploy `c4fa1b1`). Leave the migrations applied.

## 4. Not done / limits

* No real Pine charge has been run, and none will be without your explicit authorisation.
* The Pine webhook secret (`PINELABS_WEBHOOK_SECRET`) is not set on production; the webhook refuses everything and payment status is
  learned from the return page and the status API. Set it when Pine Labs issues one.

## 5. Added for the final video (same branch, same deploy)

* Speech-to-text writes "eight fifteen tonight" as "08:15 tonight"; production currently reads that as 8:15 AM and asks "morning or evening?". Fixed (an evening cue means evening).
* Delhivery cool-down is recorded as a NOT SENT evidence row (never as a fake 429); Geoapify's route is its own evidence row labelled FALLBACK; Plan and clash card say "Geoapify · FALLBACK (Delhivery 429 · rate-limited)".
* "Ridhima owes me ₹1,000" is one debt (Ridhima to Arshia), not a split. "@Clockwise pay Arshia ₹1,000" asks the payer to authorise, creates one Pine Labs UAT link, and says LINK CREATED · NOT PAID until Pine Labs returns PROCESSED; only then is a settlement recorded.
* The organiser's trace chain reads its first step ("Voice -> words") from the real Gnani rail call.
