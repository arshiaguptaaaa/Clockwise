# Pine Labs Payment Links — UAT checklist

Status: code complete against Pine Labs' published docs; **not yet run against a live UAT account** (no credentials exist in this repo or deployment).

## What Pine Labs must give / what you must set

| Item | Where it comes from | Env var (Vercel → Production) |
|---|---|---|
| UAT base URL | Docs: `https://pluraluat.v2.pinepg.in` (production host comes from Pine Labs at go-live) | `PINELABS_API_BASE_URL` (canonical; `PINELABS_BASE_URL` still accepted as a legacy alias — delete it once the canonical one is set) |
| Client ID | Pine Labs Online dashboard → Settings → API Keys (test mode) | `PINELABS_CLIENT_ID` |
| Client secret | same | `PINELABS_CLIENT_SECRET` |
| Webhook secret | Dashboard → Settings (the signing secret; base64) | `PINELABS_WEBHOOK_SECRET` |
| Webhook URL registration | Pine Labs support registers it ("contact our support team to set up a URL") | — |

Webhook URL to give Pine Labs: `https://clockwise-lemon.vercel.app/api/integrations/pinelabs/webhook`
Payer return URL (sent per link as `callback_url`): `https://clockwise-lemon.vercel.app/api/payments/return?booking=<id>` — automatic.

Confirm with Pine Labs (not in the public docs we could read): the exact **event names and payload shape** of payment-link webhooks, and that the **merchant account has Payment Links enabled**. Clockwise does not depend on either: a webhook only triggers a re-fetch of the link's status.

## Endpoints used (all server-side)
- `POST /api/auth/v1/token` (client_credentials; token cached ~1h in memory)
- `POST /api/pay/v1/paymentlink` — `amount{value,currency}`, `merchant_payment_link_reference` (= our Booking id, idempotency key), `description`, `expire_by`, `callback_url`, optional `customer`
- `GET /api/pay/v1/paymentlink/{id}` and `/merchant-reference/{ref}`
- `PUT /api/pay/v1/paymentlink/{id}/cancel` (only CREATED/CLICKED), `PATCH …/resend`
- Every call has `Request-ID` (GUID) and `Request-Timestamp` (ISO-8601 UTC)

## Test script (run after env vars are set and redeployed)
1. Create a trip with 2 travellers; in the room propose a booking with an amount (e.g. ₹1,500) and have the organiser confirm. Expect: a payment link, event `PAYMENT_LINK_CREATED` (paid: false), card says "payment link sent" — **not** confirmed.
2. Open the link, do not pay → status stays CREATED/CLICKED; nothing says paid.
3. Pay with a Pine Labs UAT test card. Expect: webhook (or return page) → Clockwise re-fetches status → `PROCESSED` → `PAYMENT_CONFIRMED` event, group "Payment received" card, HIGH notification to all travellers.
4. Replay the same webhook → no duplicate card/notification (PROCESSED is terminal).
5. Send a webhook with a bad/missing signature → 401. Stale timestamp (>5 min) → 401.
6. Create another link, cancel while CREATED → `CANCELLED` event + notification. Let one expire → `EXPIRED`.
7. Check `/trips/<id>/agent/trace` shows the chain link-created → status changes → confirmed.

Pass criteria: the group card says "confirmed" only after step 3, never from approval, link creation, a click, or a webhook body alone.
