import { cookies } from "next/headers";

const ATTRIBUTION_COOKIE = "clockwise_attribution";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days — long enough to survive a landing -> waitlist gap

export type Attribution = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  referrer: string | null;
};

const EMPTY_ATTRIBUTION: Attribution = { source: null, medium: null, campaign: null, referrer: null };

function parseAttribution(params: URLSearchParams, referrer: string | null): Attribution | null {
  // Supports both the shorthand `?source=instagram` and standard
  // `utm_source`/`utm_medium`/`utm_campaign` — whichever is present.
  // Deliberately requires an actual source/medium/campaign signal, not
  // just a referrer: every same-site navigation carries a non-null
  // Referer header, so including it in this guard would let each
  // subsequent page view silently overwrite genuine first-touch campaign
  // attribution with nulls.
  const source = params.get("source") ?? params.get("utm_source");
  const medium = params.get("utm_medium");
  const campaign = params.get("utm_campaign");
  if (!source && !medium && !campaign) return null;
  return { source, medium, campaign, referrer };
}

// Captures attribution on first landing and persists it in a cookie so it
// survives navigation to a later page (e.g. "/" -> "/waitlist") that has
// no query params of its own. Must be called from a Server Action or
// Route Handler.
export async function captureAttribution(params: URLSearchParams, referrer: string | null): Promise<void> {
  const attribution = parseAttribution(params, referrer);
  if (!attribution) return;
  const store = await cookies();
  store.set(ATTRIBUTION_COOKIE, JSON.stringify(attribution), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function getStoredAttribution(): Promise<Attribution> {
  const store = await cookies();
  const raw = store.get(ATTRIBUTION_COOKIE)?.value;
  if (!raw) return EMPTY_ATTRIBUTION;
  try {
    return JSON.parse(raw) as Attribution;
  } catch {
    return EMPTY_ATTRIBUTION;
  }
}
