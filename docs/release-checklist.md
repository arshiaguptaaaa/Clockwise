# Clockwise release checklist

Use this before every production deploy. Production is https://clockwise-lemon.vercel.app (branch `main`).
Vercel Preview deployments share the production database, so **never push a non-main branch**.

## Before you deploy
- [ ] `npx tsc --noEmit` is clean and `npx eslint` is clean on the files you touched.
- [ ] `npm run test:regression` passes (pure logic, no network).
- [ ] `npm run test:integration` passes against a **throwaway local database** (name must contain `test`; the script refuses anything else).
- [ ] Any new migration is **additive** (new table, new nullable column). No drops, no renames, no rewrites of existing trips.
- [ ] No real keys or real charges were used in tests. Pine stays on UAT; "link created" is never "paid".
- [ ] The honesty rules still hold in copy and UI: Geoapify is labelled FALLBACK, a Delhivery cool-down is NOT SENT, Gnani is only claimed when it was called.

## Choose the moment
- [ ] Not right before a demo, recording or presentation. After a deploy, production can briefly return a Prisma "too many connections for role prisma_migration" error for a few minutes.
- [ ] Someone who can roll back is available.

## Deploy
- [ ] Merge to `main` and let Vercel build (`prisma migrate deploy` runs in the build).
- [ ] The seed does not reset the demo trip (it only does so with `RESET_DEMO=1`).

## After you deploy (smoke test, ~5 minutes)
- [ ] Home page loads; `/manifest.webmanifest` returns JSON; `/offline` loads.
- [ ] Sign in as a demo traveller, open the trip room, open Trip menu → Install & feedback.
- [ ] Send one feedback; see it on `/admin/insights`.
- [ ] `/admin/insights` shows the funnel and no new SERVER errors.
- [ ] If a clash card is on screen, its main button shows (exposure is logged once).

## Rollback
- The app: redeploy the previous Vercel deployment (Deployments → ⋯ → Promote to Production).
- The database: the migrations are additive, so rolling the app back needs no schema change. Do not drop the new tables.

## Beta / app stores
- Clockwise is a web app and an installable PWA. There is no Play Store or App Store listing and no beta programme yet. If an Android wrapper (TWA) is added later it needs a Google Play developer account (one-time fee) and a store review. Add its steps here when that happens.
