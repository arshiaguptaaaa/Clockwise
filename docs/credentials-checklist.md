# What I need from you — exact checklist (no secret values here)

Env vars go in Vercel → Project → Settings → Environment Variables → **Production**, then a redeploy
(env changes only reach NEW deployments).

| # | Credential | Where you get it | Vercel env var | Secret? | How I test it |
|---|---|---|---|---|---|
| 1 | **Pooled database connection** (fixes outages) | Prisma Postgres dashboard → your database → Connection / "Accelerate" or pooled string (the current URL is a *direct* connection whose role `prisma_migration` hits "too many connections") | `DATABASE_URL` (replace) | **Yes** | Run the agent + page load burst; trace must show no `too many connections` |
| 2 | **Resend sending domain** | resend.com → Domains → add + verify DNS (SPF/DKIM) for a domain you own; then set a from address on it | `RESEND_FROM_EMAIL` (e.g. `Clockwise <invites@yourdomain>`) | No (address) | `GET /api/integrations/resend/probe` → `canSendToArbitraryRecipients: true`; then real invite to your approved inbox |
| 3 | **Approved test recipient** | You | — (tell me in chat) | No | One email address (+ one phone with country code) that you explicitly approve for tests |
| 4 | **Gnani Agent Builder platform key** | Gnani Agent Builder console → Settings → API Keys, permission scopes `agents` and `conversations` (NOT the Speech key) | `GNANI_PLATFORM_API_KEY` (outbound only; `GNANI_API_KEY` stays the Speech key) | **Yes** | `GET /api/integrations/gnani/probe` → HTTP 200 on List Agents |
| 5 | **Gnani agent / bot id** | Agent Builder → create or open the outbound agent → its `botId` | `GNANI_BOT_ID` | No | Used in `trigger_call`; one call to one **whitelisted** number |
| 6 | **Gnani whitelisted number** | Agent Builder → "Whitelisting Numbers" → add your approved phone | — | No | Phone must ring; request id recorded |
| 7 | **Gnani webhook secret** | You choose any long random string; put the same value in the agent's post-call webhook header `x-clockwise-webhook-secret` | `GNANI_WEBHOOK_SECRET` | **Yes** | Post-call webhook moves the call to RESOLVED |
| 8 | **Web push keys** | Locally run `npx web-push generate-vapid-keys` | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (public), `VAPID_PRIVATE_KEY` (**secret**), `VAPID_SUBJECT` (`mailto:you@domain`) | private key: **Yes** | Enable alerts in the bell → real push to your browser |
| 9 | **Pine Labs UAT** | Pine Labs Online dashboard → Settings → API Keys (test mode); webhook secret under Settings; ask Pine Labs support to register the webhook URL | `PINELABS_API_BASE_URL` (UAT host from docs), `PINELABS_CLIENT_ID`, `PINELABS_CLIENT_SECRET` (**secret**), `PINELABS_WEBHOOK_SECRET` (**secret**) | id: no; the rest: **Yes** | See `docs/pinelabs-uat-checklist.md` |
| 10 | Reminder escalation delay (test only) | — | `ESCALATION_DELAY_MINUTES` (unset = 1440 = 24h production; set `2` ONLY while testing, then remove) | No | Server-side only; never exposed to the browser |
| 11 | Worker secret (optional) | You choose any long random string | `CRON_SECRET` (+ the same value as GitHub repo secret `CRON_SECRET` for the scheduler) | **Yes** | `POST /api/cron/reminders` without it → 401 |
| 12 | Email sandbox override | Already present as `WAITLIST_EMAIL_TEST_RECIPIENT` (or set `EMAIL_DELIVERY_OVERRIDE`) | one of those | No (address) | Intended vs delivery recipient shown in Agent Trace; **delete it after a domain is verified** |

Already working and needing nothing: `GNANI_API_KEY` (STT, proven), `GEMINI_API_KEY`, `RESEND_API_KEY`.
