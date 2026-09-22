// Rider-authorization-code OAuth flow (auth.uber.com), matching the current
// Uber Riders API — NOT the Guest Rides / Uber-for-Business org flow, which
// is a different product. Client secret and tokens never leave this
// server-side module; nothing here is imported by client components.
const AUTHORIZE_URL = "https://auth.uber.com/oauth/v2/authorize";
const TOKEN_URL = "https://auth.uber.com/oauth/v2/token";

// `request`/`request_receipt` are privileged scopes — usable in sandbox
// immediately for the app's own dev-team Uber account with zero approval,
// but require Uber's "Full Access" review before they'll work in
// production for any other rider (see architecture note, approved 2026-09-21).
export const UBER_SCOPES = ["profile", "request", "request_receipt", "offline_access"];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

const REQUIRED_UBER_ENV_VARS = ["UBER_CLIENT_ID", "UBER_CLIENT_SECRET", "UBER_REDIRECT_URI"] as const;

export function isUberConfigured(): boolean {
  return getMissingUberEnvVars().length === 0;
}

// Named, not just a boolean — so the UI can say exactly which variables
// are missing instead of a generic "not configured" message.
export function getMissingUberEnvVars(): string[] {
  return REQUIRED_UBER_ENV_VARS.filter((name) => !process.env[name]);
}

export function buildAuthorizeUrl(state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", requireEnv("UBER_CLIENT_ID"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", requireEnv("UBER_REDIRECT_URI"));
  url.searchParams.set("scope", UBER_SCOPES.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

export type UberTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number; // seconds
  scope: string;
  token_type: string;
};

async function postForm(body: Record<string, string>): Promise<UberTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!res.ok) {
    // Real failure text, never swallowed — the caller decides how to
    // surface it, but this module never fabricates a token.
    throw new Error(`Uber OAuth request failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

export function exchangeCodeForToken(code: string): Promise<UberTokenResponse> {
  return postForm({
    grant_type: "authorization_code",
    code,
    client_id: requireEnv("UBER_CLIENT_ID"),
    client_secret: requireEnv("UBER_CLIENT_SECRET"),
    redirect_uri: requireEnv("UBER_REDIRECT_URI"),
  });
}

export function refreshAccessToken(refreshToken: string): Promise<UberTokenResponse> {
  return postForm({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: requireEnv("UBER_CLIENT_ID"),
    client_secret: requireEnv("UBER_CLIENT_SECRET"),
  });
}
