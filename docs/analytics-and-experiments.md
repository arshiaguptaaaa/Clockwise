# Analytics, experiments and error tracking

Where it lives: `/admin/insights` (same admin login as `/admin/waitlist`).

## Events (table `ProductEvent`)
| Event | Written when | Notes |
|---|---|---|
| `clash_detected` | A clash card is created | once per clash |
| `clash_proposed` | Someone proposes a fix from the card | once per clash; carries the A/B variant |
| `vote_cast` | Someone votes on a proposal | `props.clashId` set when the proposal came from a clash |
| `plan_updated` | The organiser confirms and the plan changes | once per proposal |
| `experiment_exposure` | The clash card's main button is on screen | once per (clash, viewer) |
| `pwa_install_prompted / _accepted / _installed` | Browser install prompt events | allow-listed names only |

Events hold ids and small counters only: never message text, names or contact details.

## The one A/B test: `clash_cta`
- `control`: "Propose 8:30 PM". `direct`: "Yes, propose 8:30 PM to the group".
- A traveller's variant is a stable hash of (experiment, userId). It does not change between renders, devices or deploys.
- Conversion = a viewer who saw the button and then proposed from that card. The result table only counts people who were exposed.
- `/admin/insights` says "Too early to call" until each variant has 30 exposures. With a handful of demo users the test proves the measurement works, not that a variant wins.
- To retire it: delete the experiment from `src/lib/experiments.ts` and the label call in `ClashCard.tsx`.

## Errors (table `ErrorLog`)
- Server: `src/instrumentation.ts` (`onRequestError`) logs render, route and server-action errors.
- Browser: `src/app/error.tsx`, `src/app/global-error.tsx` and `ClientBoot` (uncaught errors and unhandled promise rejections) post to `/api/client-error`.
- The page shows errors per 100 active travellers. It is **not** a crash-free-sessions rate, because Clockwise doesn't record sessions.

## Feedback (table `Feedback`)
- Trip menu → Install & feedback: a 1–5 rating and an optional note. Stored only; nothing is forwarded automatically.

## Android / PWA
- `manifest.ts` has an id, a portrait orientation, categories and a maskable icon (`/icons/maskable`).
- `public/sw.js` handles push and one offline page. It does not cache app pages or API calls.
- No Play Store listing, no store screenshots in the manifest, no native app.
