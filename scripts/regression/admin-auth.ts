// Admin authentication: fail closed without ADMIN_PASSWORD, reject forged and old-key cookies, reject wrong passwords,
// accept a valid session, and make sure every admin file actually has a guard. Pure; no network, no database.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { adminSecret, passwordMatches, makeSessionValue, sessionIsValid, ADMIN_SESSION_SECONDS } from "../../src/lib/admin-auth-core";

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`PASS ${name}`);
};

const STRONG = "correct-horse-battery-staple-9X!";
const hmac = (key: string, data: string) => createHmac("sha256", key).update(data).digest("hex");
const NOW = 1_800_000_000_000;

ok("missing, empty or whitespace-only ADMIN_PASSWORD means no secret (admin disabled)", () => {
  assert.equal(adminSecret(undefined), null);
  assert.equal(adminSecret(null), null);
  assert.equal(adminSecret(""), null);
  assert.equal(adminSecret("   "), null);
  assert.equal(adminSecret("\n\t"), null);
  assert.equal(adminSecret(STRONG), STRONG);
});
ok("with no secret: no password matches, no session is issued, no cookie is valid", () => {
  for (const pw of ["", "admin", "password", STRONG, " "]) assert.equal(passwordMatches(pw, null), false);
  assert.equal(makeSessionValue(null, NOW), null);
  assert.equal(sessionIsValid("anything", null, NOW), false);
  assert.equal(sessionIsValid(undefined, null, NOW), false);
});
ok("the OLD cookie, signed with an empty key, is rejected whether or not a password is now set", () => {
  const forgedOldFormat = `admin.${hmac("", "admin")}`;
  assert.equal(sessionIsValid(forgedOldFormat, null, NOW), false, "no password configured");
  assert.equal(sessionIsValid(forgedOldFormat, STRONG, NOW), false, "password configured");
  const exp = Math.floor(NOW / 1000) + 3600;
  const forgedNewFormatEmptyKey = `${exp}.${hmac("", `admin:${exp}`)}`;
  assert.equal(sessionIsValid(forgedNewFormatEmptyKey, null, NOW), false, "new format, empty key, nothing configured");
  assert.equal(sessionIsValid(forgedNewFormatEmptyKey, STRONG, NOW), false, "new format, empty key, password configured");
});
ok("invalid and forged cookies are rejected", () => {
  const exp = Math.floor(NOW / 1000) + 3600;
  const good = makeSessionValue(STRONG, NOW)!;
  const [goodExp, goodSig] = good.split(".");
  for (const bad of [
    "", "x", ".", "..", `${exp}`, `${exp}.`, `.${goodSig}`, `${goodExp}.${goodSig}.extra`,
    `${goodExp}.${goodSig.slice(0, -1)}0`, // one hex digit changed
    `${goodExp}.${goodSig.toUpperCase()}`, // wrong case
    `${Number(goodExp) + 1}.${goodSig}`, // expiry tampered with
    `abc.${goodSig}`, `-5.${goodSig}`, `${goodExp}.zzzz`,
    `${exp}.${hmac("some-other-password", `admin:${exp}`)}`, // signed with the wrong key
    `${exp}.${hmac(STRONG, "admin")}`, // right key, wrong payload (the old token format)
  ]) assert.equal(sessionIsValid(bad, STRONG, NOW), false, `should reject: ${bad.slice(0, 40)}`);
});
ok("incorrect passwords are rejected; the correct one is accepted", () => {
  for (const pw of ["", "wrong", STRONG.toUpperCase(), `${STRONG} `, ` ${STRONG}`, STRONG.slice(0, -1), `${STRONG}x`]) assert.equal(passwordMatches(pw, STRONG), false);
  assert.equal(passwordMatches(STRONG, STRONG), true);
});
ok("a valid session is accepted, and stops working after 8 hours", () => {
  const v = makeSessionValue(STRONG, NOW)!;
  assert.equal(sessionIsValid(v, STRONG, NOW), true);
  assert.equal(sessionIsValid(v, STRONG, NOW + (ADMIN_SESSION_SECONDS - 5) * 1000), true);
  assert.equal(sessionIsValid(v, STRONG, NOW + (ADMIN_SESSION_SECONDS + 5) * 1000), false);
});
ok("changing the password invalidates existing sessions", () => {
  const v = makeSessionValue(STRONG, NOW)!;
  assert.equal(sessionIsValid(v, `${STRONG}-rotated`, NOW), false);
});
ok("a session cookie never contains the password", () => {
  assert.ok(!makeSessionValue(STRONG, NOW)!.includes(STRONG));
});

// Guard coverage: every file under src/app/admin that serves data or runs server code must call isAdminAuthenticated,
// except the login page and the login/logout actions. A new admin page or action without a guard fails here.
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
ok("every admin layout, page, route handler and server action has an admin guard", () => {
  const root = join(__dirname, "../../src/app/admin");
  const exempt = new Set([join(root, "login/page.tsx"), join(root, "admin-actions.ts")]);
  const files = walk(root).filter((f) => /(layout\.tsx|page\.tsx|route\.ts|actions\.ts)$/.test(f) && !exempt.has(f));
  assert.ok(files.length >= 5, `expected several guarded files, found ${files.length}`);
  for (const f of files) assert.match(readFileSync(f, "utf8"), /isAdminAuthenticated\(\)/, `${f} has no admin guard`);
  // pages guard themselves as well as through the layout: a layout redirect does not stop a page rendering in parallel,
  // and its data then travels in the redirect response body (found in production on /admin/waitlist and /admin/insights)
  for (const section of ["waitlist", "insights", "integrations"]) assert.ok(files.includes(join(root, section, "page.tsx")), `${section} page has no guard`);
  // each admin section has a guarding layout
  for (const section of ["waitlist", "insights", "integrations"]) assert.ok(files.includes(join(root, section, "layout.tsx")), `${section} has no layout guard`);
  // the CSV export is a route handler, which a layout does not protect
  assert.ok(files.includes(join(root, "waitlist/export/route.ts")));
});
console.log(`${n} admin-auth checks passed`);
