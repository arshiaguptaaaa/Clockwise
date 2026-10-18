# Release notes: 2026-10-18 (commit 647d0cd)

Production: https://clockwise-lemon.vercel.app/ (unchanged address). Branch `main`.
Scope: analytics funnel, one A/B experiment, error logging, in-app feedback, PWA install/offline polish, docs,
and one additive migration (`20261018100000_product_analytics`, three new tables).

## 1. Passed locally (throwaway Postgres, no real keys, no network)
| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| ESLint on changed files | 0 errors, 4 warnings (not from this change) |
| `npm run test:regression` | all scripts pass; the agent-behaviour script ends at 48 checks; includes 7 new insights checks and (follow-up) 9 admin-auth checks |
| `npm run test:integration` | 55 checks pass (includes 1 new analytics check: exposure counted once per clash and viewer, event write, error message cap) |
| `next build` | compiles, 37 static pages generated |
| Browser walk-through on the throwaway DB | feedback saved; browser errors logged; server error logged (temporary route, removed); exposure logged once across reloads; `/admin/insights` rendered; offline page served with the server stopped |

## 2. Verified in production (2026-10-18)
- Vercel build for 647d0cd finished Ready. The build log shows migration `20261018100000_product_analytics` applied and the demo trip preserved.
- HTTP 200: `/`, `/manifest.webmanifest`, `/icons/192`, `/icons/512`, `/icons/maskable`, `/offline`, `/sw.js`, `/demo`.
- `/admin/insights` redirects (307) to `/admin/login` when not signed in.
- Existing trip access: the seeded demo trip room loads for a synthetic demo traveller.
- Caching: trip pages are `private, no-cache, no-store`; the service worker registers and its only cache entry is `/offline`.
- Feedback: one synthetic submission was accepted and the page confirmed it saved.

## 3. Not production-verified yet
- **Funnel events** (`clash_detected`, `clash_proposed`, `vote_cast`, `plan_updated`): no clash was created in production, and the rows cannot be read from this machine.
- **A/B exposure counting** (once per clash and viewer): same reason. Verified locally only.
- **Error-log persistence**: one synthetic browser error and one synthetic API call were sent, but failures are swallowed by design and Vercel logs returned no records, so persistence is unconfirmed until `/admin/insights` is checked.
- **Android install prompt**: not tested on a real device.
- **Payment wording** ("link created" is not "paid"): the payment code was not changed in this release and the local check still passes; it was not re-checked live because no payment was started.
- **Feedback row on the admin page**: the save was confirmed in the app, not yet seen in `/admin/insights`.
- **Admin sign-in in production**: not possible until `ADMIN_PASSWORD` is set in Vercel and the app is redeployed; `/admin/insights` and the persistence of events, errors and feedback therefore remain unchecked in production.

## 4. Security finding and follow-up fix: admin authentication fails closed
**Found after 647d0cd:** `ADMIN_PASSWORD` was not set in any Vercel environment (names checked for production, preview and
development), and `src/lib/admin-auth.ts` then signed the admin cookie with an empty key, so a valid-looking cookie could be
computed by anyone who knew the scheme. Until the fix below is deployed, the admin pages (`/admin/waitlist` and its CSV export,
`/admin/insights`, `/admin/integrations`) must be treated as not access-controlled. No access was attempted against production.

**Fix (follow-up commit):**
- Missing, empty or whitespace-only `ADMIN_PASSWORD` disables admin access completely: no login succeeds, no session is
  issued, no cookie is accepted. The login page says "Admin sign-in is disabled on this deployment."
- Cookies are now `<expiry>.<HMAC of "admin:<expiry>">`: they expire after 8 hours, changing the password invalidates them,
  comparisons are constant-time, and the `Secure` flag is set in production. Old-format cookies, and cookies signed with the
  previous empty key, are rejected.
- `runIntegrationChecks` (a server action that calls providers with production keys) had no guard of its own, because a layout
  guard does not protect a server action. It now checks for admin itself.
- New `src/lib/admin-auth-core.ts` holds the pure logic. `scripts/regression/admin-auth.ts` (9 checks) covers missing config,
  forged and old-key cookies, wrong passwords, valid sessions, expiry, password rotation, and that every admin layout, route
  handler and server action contains a guard.

**Verified locally for the fix:** 9 admin-auth checks; with `ADMIN_PASSWORD` forced empty, every admin route returned 307 to
login (pages) or 401 (CSV export) for no cookie, an old-format forged cookie and a new-format empty-key forged cookie, and
login showed the "disabled" message; with a throwaway password, a wrong password was refused, the right one signed in, the
insights page, CSV export and integrations page opened, the cookie was HttpOnly, and old-format cookies (empty key and correct key) were rejected.

**Second finding, found by checking the first fix in production (ee977b9):** an unauthenticated request to `/admin/waitlist`
returned 307 to the login page, but the response *body* still contained the waitlist email addresses, and `/admin/insights`
contained feedback text. A layout redirect does not stop the page from rendering in parallel, so its data was streamed in the
redirect response. This pre-dated the analytics work for `/admin/waitlist`; `/admin/insights` inherited the same pattern.
No forged cookie or login was needed. **Fix:** each admin page (`waitlist`, `insights`, `integrations`) now checks admin before
running any query, and the guard-coverage test requires every admin page to do so. Checked locally with canary rows: an
unauthenticated request returns no canary data from any admin route, and an authenticated one does.
Also fixed: the admin login form could submit as a GET before the page's JavaScript loaded, which would have put the
password in the URL; it is now a server-action form (POST, works without JavaScript).

**Third change set: probes, side effects, CSRF and login rate limit**
- The diagnostic endpoints under `/api/integrations` (`gnani/probe`, `resend/probe`, `gemini/probe`, `geoapify/probe`,
  `geoapify/airports`, `travel-inventory/status`, `pinelabs/probe`, `delhivery/probe`, `delhivery/acceptance`) were guarded only by
  the demo "signed-in" cookie, which anyone can get from `/demo/join`. They now require an admin session and answer 401 otherwise.
  Provider callbacks (`pinelabs/webhook`, `gnani/webhook`, `uber/callback`, `uber/connect`) keep their own authentication; the
  trip-scoped `resend/deliveries` and `trips/*/rail-evidence` are unchanged.
- **Side effects are POST-only and CSRF-protected.** Creating a Pine UAT payment link (`POST /api/integrations/pinelabs/probe`) and the
  Delhivery probe and acceptance runs (which make metered calls and write rail-call rows) now require: admin session, same-site
  request (Origin / Sec-Fetch-Site), and an `x-csrf-token` header (an HMAC of the admin session, from `GET /api/admin/csrf`). The old
  `GET ...?create=1` no longer creates anything. The admin cookie is now `SameSite=Strict`.
- **Admin login is rate-limited across instances.** Failures are counted in Postgres (`RateLimitBucket`, additive migration
  `20261018220000_rate_limit_bucket`) per client address (stored only as a salted hash) and globally: 5 failures per address or 40 in
  total within 15 minutes lock sign-in, and while locked the password is not even checked. If the counters cannot be read, sign-in
  is refused rather than left unthrottled. Trade-off: a determined attacker can lock the owner out for 15 minutes by filling the
  global counter.
- Tests: `scripts/regression/admin-hardening.ts` (7 checks: CSRF token and origin rules, login gate, scan that every diagnostic route is
  admin-only and every side-effecting route is POST-only) and one integration check (shared counters under 10 concurrent requests,
  window reset, UTC-safe timestamps). Locally verified with HTTP requests: unauthenticated 401 on every probe; session without token
  403; cross-site origin and bad token 403; valid token on a same-site request allowed (provider keys blanked, so no link could be
  created); lockout after 5 wrong passwords, correct password refused during lockout and accepted after the window.
- Usage note: with the new POST-only rule an admin triggers the Pine link test from the signed-in browser console: fetch
  `/api/admin/csrf`, then `fetch('/api/integrations/pinelabs/probe', {method:'POST', headers:{'x-csrf-token': token}})`.

See `docs/security-incident-2026-10-18-waitlist-exposure.md` for the waitlist exposure record.

## 5. A/B experiment status
`clash_cta` (button wording) is instrumentation only. There is no result and no winner: the admin page shows "Too early to call" until each variant has 30 exposures.

## 6. Limits
No native Android app, no Bluetooth/firmware/IoT, no store listing, no measured user impact. Errors are reported per 100 active travellers, not as a crash-free-sessions rate.
