// CSRF checks, login rate-limit decisions, and a scan that every diagnostic/admin API route is admin-only and that
// every route with side effects is POST-only. Pure; no network, no database.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { csrfTokenFor, csrfTokenValid, originAllowed } from "../../src/lib/csrf";
import { LOGIN_MAX_FAILS_GLOBAL, LOGIN_MAX_FAILS_PER_IP, LOGIN_WINDOW_MS, activeCount, loginGate, retryAfterSeconds, waitText } from "../../src/lib/rate-limit-core";

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`PASS ${name}`);
};
const SECRET = "a-long-random-admin-password-for-tests";
const SESSION = "1900000000.0123456789abcdef";

ok("CSRF token: valid for its session and key, invalid for anything else", () => {
  const t = csrfTokenFor(SESSION, SECRET);
  assert.equal(csrfTokenValid(t, SESSION, SECRET), true);
  assert.equal(csrfTokenValid(t, `${SESSION}x`, SECRET), false, "another session");
  assert.equal(csrfTokenValid(t, SESSION, `${SECRET}-rotated`), false, "rotated password");
  assert.equal(csrfTokenValid(t.slice(0, -1) + (t.endsWith("0") ? "1" : "0"), SESSION, SECRET), false, "one digit changed");
  for (const bad of [null, undefined, "", "x", "undefined"]) assert.equal(csrfTokenValid(bad, SESSION, SECRET), false);
  assert.equal(csrfTokenValid(t, null, SECRET), false, "no session");
  assert.equal(csrfTokenValid(t, SESSION, null), false, "no secret configured");
  assert.ok(!t.includes(SECRET) && !t.includes(SESSION));
});
ok("origin check: same-site passes; cross-site, wrong host and malformed origins are refused", () => {
  const host = "clockwise-lemon.vercel.app";
  assert.equal(originAllowed(`https://${host}`, host, "same-origin"), true);
  assert.equal(originAllowed(null, host, null), true, "a non-browser client sends no Origin; the token decides");
  assert.equal(originAllowed(`https://${host}`, host, null), true);
  assert.equal(originAllowed("https://evil.example", host, "cross-site"), false);
  assert.equal(originAllowed("https://evil.example", host, null), false);
  assert.equal(originAllowed(`https://${host}`, host, "cross-site"), false, "Sec-Fetch-Site wins");
  assert.equal(originAllowed(`https://${host}`, host, "same-site"), false);
  assert.equal(originAllowed("null", host, null), false);
  assert.equal(originAllowed("not a url", host, null), false);
  assert.equal(originAllowed(`https://${host}.evil.example`, host, null), false);
  assert.equal(originAllowed(`https://${host}`, null, null), false);
});
ok("login gate: allows up to the limit, then blocks until the window ends; expired windows do not count", () => {
  const now = new Date("2026-10-18T12:00:00Z");
  const at = (secondsAgo: number, count: number) => ({ count, windowStart: new Date(now.getTime() - secondsAgo * 1000) });
  assert.deepEqual(loginGate(null, null, now), { blocked: false });
  assert.deepEqual(loginGate(at(10, LOGIN_MAX_FAILS_PER_IP - 1), null, now), { blocked: false });
  const g = loginGate(at(60, LOGIN_MAX_FAILS_PER_IP), null, now);
  assert.equal(g.blocked, true);
  if (g.blocked) {
    assert.equal(g.scope, "ip");
    assert.equal(g.retryAfterSeconds, LOGIN_WINDOW_MS / 1000 - 60);
  }
  assert.deepEqual(loginGate(at(LOGIN_WINDOW_MS / 1000 + 1, 99), null, now), { blocked: false }, "window over");
  const gg = loginGate(at(5, 1), at(5, LOGIN_MAX_FAILS_GLOBAL), now);
  assert.equal(gg.blocked && gg.scope, "global");
  assert.equal(activeCount(at(5, 3), now, LOGIN_WINDOW_MS), 3);
  assert.equal(activeCount(null, now, LOGIN_WINDOW_MS), 0);
  assert.equal(retryAfterSeconds(null, now, LOGIN_WINDOW_MS), 0);
  assert.equal(waitText(1), "1 minute");
  assert.equal(waitText(61), "2 minutes");
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const api = join(__dirname, "../../src/app/api");
const rel = (f: string) => relative(api, f);
// Routes under /api/integrations that are NOT admin diagnostics: provider callbacks authenticated by their own secret or
// signature, the Uber OAuth flow, and a trip-member-scoped delivery log.
const NOT_ADMIN = new Set(["integrations/pinelabs/webhook/route.ts", "integrations/gnani/webhook/route.ts", "integrations/uber/callback/route.ts", "integrations/uber/connect/route.ts", "integrations/resend/deliveries/route.ts"]);
const diagnostics = walk(join(api, "integrations")).filter((f) => f.endsWith("route.ts") && !NOT_ADMIN.has(rel(f)));

ok("every diagnostic API route is admin-only (no demo-cookie guard left)", () => {
  assert.ok(diagnostics.length >= 9, `found ${diagnostics.length}`);
  for (const f of diagnostics) {
    const src = readFileSync(f, "utf8");
    assert.match(src, /requireAdmin(Mutation)?\(/, `${rel(f)} has no admin guard`);
    assert.doesNotMatch(src.replace(/\/\/.*$/gm, ""), /Sign in first\./, `${rel(f)} still answers 'Sign in first'`);
  }
});
ok("routes with side effects are POST-only and use the CSRF-checked guard", () => {
  for (const r of ["integrations/delhivery/acceptance/route.ts", "integrations/delhivery/probe/route.ts"]) {
    const src = readFileSync(join(api, r), "utf8");
    assert.doesNotMatch(src, /export async function GET/, `${r} must not export GET`);
    assert.match(src, /export async function POST/);
    assert.match(src, /requireAdminMutation\(/);
  }
  const pine = readFileSync(join(api, "integrations/pinelabs/probe/route.ts"), "utf8");
  const [getPart, postPart] = pine.split("export async function POST");
  assert.ok(postPart, "Pine probe has a POST handler");
  assert.doesNotMatch(getPart, /createPaymentLink\(/, "GET must never create a payment link");
  assert.match(postPart, /requireAdminMutation\(/);
  assert.match(postPart, /createPaymentLink\(/);
});
ok("the CSRF token endpoint exists and is admin-only", () => {
  const src = readFileSync(join(api, "admin/csrf/route.ts"), "utf8");
  assert.match(src, /requireAdmin\(/);
  assert.match(src, /no-store/);
});
ok("every non-diagnostic /api/integrations route has its own authentication", () => {
  for (const r of NOT_ADMIN) {
    const src = readFileSync(join(api, r), "utf8");
    assert.match(src, /getCurrentUserId|PINELABS_WEBHOOK_SECRET|GNANI_WEBHOOK_SECRET|state/, `${r} has no authentication`);
  }
});
console.log(`${n} admin-hardening checks passed`);
