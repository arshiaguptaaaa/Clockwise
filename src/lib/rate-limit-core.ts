// Pure rate-limit decisions (no database). The counters themselves live in the RateLimitBucket table so every
// serverless instance sees the same numbers (see rate-limit.ts).
export const LOGIN_WINDOW_MS = 15 * 60_000;
export const LOGIN_MAX_FAILS_PER_IP = 5;
export const LOGIN_MAX_FAILS_GLOBAL = 40;

export type Bucket = { count: number; windowStart: Date } | null;

// A bucket only counts inside its window; an expired one is as good as empty.
export function activeCount(b: Bucket, now: Date, windowMs: number): number {
  if (!b) return 0;
  return now.getTime() - b.windowStart.getTime() >= windowMs ? 0 : b.count;
}

export function retryAfterSeconds(b: Bucket, now: Date, windowMs: number): number {
  if (!b) return 0;
  return Math.max(0, Math.ceil((b.windowStart.getTime() + windowMs - now.getTime()) / 1000));
}

export type LoginGate = { blocked: false } | { blocked: true; retryAfterSeconds: number; scope: "ip" | "global" };

export function loginGate(ip: Bucket, global: Bucket, now: Date): LoginGate {
  const ipBlocked = activeCount(ip, now, LOGIN_WINDOW_MS) >= LOGIN_MAX_FAILS_PER_IP;
  const globalBlocked = activeCount(global, now, LOGIN_WINDOW_MS) >= LOGIN_MAX_FAILS_GLOBAL;
  if (ipBlocked) return { blocked: true, scope: "ip", retryAfterSeconds: retryAfterSeconds(ip, now, LOGIN_WINDOW_MS) };
  if (globalBlocked) return { blocked: true, scope: "global", retryAfterSeconds: retryAfterSeconds(global, now, LOGIN_WINDOW_MS) };
  return { blocked: false };
}

export function waitText(seconds: number): string {
  const m = Math.max(1, Math.ceil(seconds / 60));
  return `${m} minute${m === 1 ? "" : "s"}`;
}
