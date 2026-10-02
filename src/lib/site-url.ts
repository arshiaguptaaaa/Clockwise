// The one place an absolute app URL gets constructed (e.g. for links inside
// emails, which — unlike a page render — have no request to derive an
// origin from). Vercel automatically provides these env vars for every
// deployment, no manual config needed: VERCEL_PROJECT_PRODUCTION_URL is the
// stable production domain (doesn't change per-deploy, unlike VERCEL_URL,
// which is that one deployment's own unique URL). NEXT_PUBLIC_APP_URL is an
// explicit override if you ever want one; localhost is the local-dev
// fallback.
export function getAppBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  // The public production address, stated once. (An explicit NEXT_PUBLIC_APP_URL
  // above still wins, e.g. after a custom domain is attached.)
  if (process.env.VERCEL_ENV === "production") return "https://clockwise-lemon.vercel.app";
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  // On Vercel without any of the above, never emit a localhost link in an email.
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
