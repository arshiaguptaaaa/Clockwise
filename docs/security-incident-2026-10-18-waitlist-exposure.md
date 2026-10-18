# Security note: unauthenticated disclosure of waitlist data (2026-10-18)

Status: fixed in production. Scope of access history: **unknown**. This note records only what the evidence shows.
It contains no email addresses and no user has been contacted.

## What is confirmed
1. **Unauthenticated disclosure.** On 2026-10-18, around 15:30 UTC (21:00 IST), while verifying the previous release, a plain
   request with no cookie and no credentials to `https://clockwise-lemon.vercel.app/admin/waitlist` returned HTTP 307 (redirect to
   the login page) **but its response body contained waitlist email addresses**. The page lists the 50 most recent signups
   (email, source, date) plus per-source counts, so each such response could carry up to 50 addresses.
   - Observed by a script (`curl` plus a pattern match) run from the owner's machine in a Claude Code session. Up to ten of the
     addresses appeared in that session's tool output, which is stored in the local session transcript on the owner's machine
     and has not been shared elsewhere.
2. **Same pattern on `/admin/insights`.** Its redirect body contained the synthetic feedback text added during testing. Insights data
   (feedback messages, error messages, counts) is the only other data that route holds. No real user data was seen there.
3. **Not affected:** the CSV export (`/admin/waitlist/export`) returned 401 with no data.
4. **Cause.** The admin section was protected by a layout-level redirect. A layout redirect does not stop the page from rendering in
   parallel, so the page's data was streamed in the body of the redirect response.
5. **Fix.** Each admin page now checks admin before running any query (commit `a425190`, deployed 2026-10-18 about 21:16 IST).
   Re-checked afterwards with no cookie: `/admin/waitlist`, `/admin/insights` and `/admin/integrations` returned 307 with zero email
   addresses in the body, and the CSV export returned 401.

## A related weakness (separate, also fixed)
`ADMIN_PASSWORD` was not set in any Vercel environment when checked on 2026-10-18. The admin cookie was signed with that value, so
with it unset the signing key was empty and a valid cookie could be computed by anyone who knew the scheme. That would have given full
admin access, including the CSV export. Fixed in `ee977b9` (admin access disabled without a password) and activated when the owner set
a password privately on 2026-10-18. Whether anyone used this is **unknown**; I made no attempt to forge a cookie against production.

## What is NOT known
- **Who, if anyone, requested these pages**, and how many times. This cannot be stated either way.
- **How long the exposure lasted.** The waitlist admin page and its layout guard were first committed on 2026-09-22 (`5ab7e2a`). I did
  not test earlier deployments, so the start of the exposure is unknown; the earliest it could have started is the first production
  deployment containing that page.
- **Request history.** `vercel logs` for the production project returned no records for the windows I queried, so it gave no evidence
  of access either way. That is a gap in the evidence, not evidence of no access.
- **How many addresses were in the table at the time**, beyond the display limit of 50 per response.

## Suggested next steps (the owner decides)
1. Check the Vercel dashboard (Logs / Observability) for requests to `/admin/waitlist` and `/admin/insights` within whatever retention
   the plan keeps, filtering out your own IP. Record what you find and the retention limit, so the gap is documented.
2. If access cannot be ruled out, decide whether a notification is appropriate for the people who signed up. Disclosure duties depend on
   where those people are and on what you are obliged to do as the data controller; this note is not legal advice, so ask someone
   qualified if unsure.
3. Keep the admin password long and random, stored only in a password manager and the Vercel environment.

## Hardening shipped afterwards
Integration diagnostics are admin-only; actions with side effects are POST-only with CSRF protection; admin login is rate-limited
across instances (see `docs/release-notes-2026-10-18.md`).
