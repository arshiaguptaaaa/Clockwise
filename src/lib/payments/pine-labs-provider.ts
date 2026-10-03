// Pine Labs Online Payment Links client — server-side only. Clockwise never
// touches card data; people pay on Pine Labs' hosted page.
//
// Contract (Pine Labs developer docs, pinelabs.com/docs/online-payments):
//   token   POST {base}/api/auth/v1/token   { client_id, client_secret, grant_type: "client_credentials" }
//   create  POST {base}/api/pay/v1/paymentlink
//   get     GET  {base}/api/pay/v1/paymentlink/{payment_link_id}
//   by ref  GET  {base}/api/pay/v1/paymentlink/merchant-reference/{ref}
//   cancel  PUT  {base}/api/pay/v1/paymentlink/{payment_link_id}/cancel   (CREATED/CLICKED only)
//   resend  PATCH {base}/api/pay/v1/paymentlink/{payment_link_id}/resend
//   every call carries Request-ID (GUID) and Request-Timestamp (ISO-8601 UTC);
//   payment calls carry Authorization: Bearer <access token>.
// UAT host per the docs is https://pluraluat.v2.pinepg.in; production host
// comes from Pine Labs at go-live. Nothing here is hardcoded: base URL and
// credentials are read from env, and every call fails closed with a clear
// reason until they are set. Not exercised against a live UAT here — no
// credentials exist in this environment.
import { randomUUID } from "crypto";
import { logRailCall } from "@/lib/rails/evidence";

// PINELABS_API_BASE_URL is the documented name; PINELABS_BASE_URL is accepted
// as an alias because that is what the Vercel project was configured with.
const rawBaseUrl = () => process.env.PINELABS_API_BASE_URL || process.env.PINELABS_BASE_URL || "";

export function isPineLabsConfigured(): boolean {
  return Boolean(rawBaseUrl() && process.env.PINELABS_CLIENT_ID && process.env.PINELABS_CLIENT_SECRET);
}

export function getMissingPineLabsEnvVars(): string[] {
  return [
    rawBaseUrl() ? "" : "PINELABS_API_BASE_URL",
    process.env.PINELABS_CLIENT_ID ? "" : "PINELABS_CLIENT_ID",
    process.env.PINELABS_CLIENT_SECRET ? "" : "PINELABS_CLIENT_SECRET",
  ].filter(Boolean);
}

// Provider error text with any credential value scrubbed before it can be shown.
function sanitize(text: string): string {
  let out = text.slice(0, 300);
  for (const v of [process.env.PINELABS_CLIENT_SECRET, process.env.PINELABS_CLIENT_ID]) if (v && v.length > 3) out = out.split(v).join("[redacted]");
  return out;
}

// Documented statuses. PROCESSED is the only one that means money moved.
// Anything else Pine Labs may send is carried as a plain string and is never
// treated as a payment.
export const PINE_LABS_STATUSES = ["CREATED", "CLICKED", "PAYMENT_INITIATED", "PROCESSED", "CANCELLED", "EXPIRED"] as const;
export type PineLabsPaymentLinkStatus = (typeof PINE_LABS_STATUSES)[number] | (string & {});

export type CreatePaymentLinkRequest = {
  merchantReference: string; // idempotency key, 1-50 chars
  amountMinorUnits: number; // paise for INR
  currency: string;
  purpose: string;
  customerName?: string;
  customerEmail?: string;
  customerMobile?: string;
  callbackUrl: string;
  expireInDays?: number; // docs: max 180
};

export type CreatePaymentLinkResult =
  | { ok: true; paymentLinkId: string; paymentLinkUrl: string; status: PineLabsPaymentLinkStatus }
  | { ok: false; reason: string };

export type PaymentLinkStatusResult =
  | { ok: true; paymentLinkId: string; merchantReference: string | null; status: PineLabsPaymentLinkStatus; amountMinorUnits: number | null; currency: string | null }
  | { ok: false; reason: string };

export type SimpleResult = { ok: true } | { ok: false; reason: string };

const notConfigured = () => ({ ok: false as const, reason: `Pine Labs isn't configured (missing ${getMissingPineLabsEnvVars().join(", ")}).` });
const baseUrl = () => rawBaseUrl().replace(/\/+$/, "");

function requestHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    accept: "application/json",
    "Request-ID": randomUUID(),
    "Request-Timestamp": new Date().toISOString(),
    ...extra,
  };
}

// Access tokens last ~3600s; reuse until a minute before expiry. Held in
// module memory only — never persisted, logged, or sent to a client.
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<{ ok: true; token: string } | { ok: false; reason: string; status?: number }> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return { ok: true, token: cachedToken.value };
  try {
    const tokenHeaders = requestHeaders();
    const started = Date.now();
    const res = await fetch(`${baseUrl()}/api/auth/v1/token`, {
      method: "POST",
      headers: tokenHeaders,
      body: JSON.stringify({
        client_id: process.env.PINELABS_CLIENT_ID,
        client_secret: process.env.PINELABS_CLIENT_SECRET,
        grant_type: "client_credentials",
      }),
    });
    const tokenText = await res.text();
    let tokenJson: unknown = tokenText;
    try {
      tokenJson = JSON.parse(tokenText);
    } catch {
      // keep raw text
    }
    await logRailCall({
      partner: "PINELABS",
      operation: "auth.token",
      endpoint: `${baseUrl()}/api/auth/v1/token`,
      method: "POST",
      request: { headers: { ...tokenHeaders, "Content-Type": "application/json" }, body: { client_id: "[REDACTED]", client_secret: "[REDACTED]", grant_type: "client_credentials" } },
      response: tokenJson,
      httpStatus: res.status,
      durationMs: Date.now() - started,
    });
    if (!res.ok) return { ok: false, status: res.status, reason: `Pine Labs token request failed (${res.status}): ${sanitize(tokenText)}` };
    const data: { access_token?: string; expires_in?: number } = JSON.parse(tokenText);
    if (!data.access_token) return { ok: false, reason: "Pine Labs returned no access_token." };
    cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
    return { ok: true, token: data.access_token };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Couldn't reach Pine Labs." };
  }
}

async function call(path: string, init: { method: string; body?: unknown }): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; reason: string }> {
  if (!isPineLabsConfigured()) return notConfigured();
  const auth = await getAccessToken();
  if (!auth.ok) return auth;
  try {
    const callHeaders = requestHeaders({ Authorization: `Bearer ${auth.token}` });
    const started = Date.now();
    const res = await fetch(`${baseUrl()}${path}`, {
      method: init.method,
      headers: callHeaders,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (res.status === 401) cachedToken = null;
    const text = await res.text();
    let json: unknown = text;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      // keep raw text
    }
    await logRailCall({
      partner: "PINELABS",
      operation: `${init.method} ${path.replace(/\/pl-v1-[\w-]+/, "/{payment_link_id}")}`,
      endpoint: `${baseUrl()}${path}`,
      method: init.method,
      request: { headers: callHeaders, body: init.body ?? null },
      response: json,
      httpStatus: res.status,
      providerRequestId: callHeaders["Request-ID"],
      durationMs: Date.now() - started,
    });
    if (!res.ok) return { ok: false, reason: `Pine Labs ${init.method} ${path.split("/").slice(0, 5).join("/")} failed (${res.status}): ${sanitize(text)}` };
    return { ok: true, data: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Unknown Pine Labs error." };
  }
}

export async function createPaymentLink(req: CreatePaymentLinkRequest): Promise<CreatePaymentLinkResult> {
  const customer =
    req.customerName || req.customerEmail || req.customerMobile
      ? { first_name: req.customerName, email_id: req.customerEmail, mobile_number: req.customerMobile }
      : undefined;
  const expireBy = new Date(Date.now() + Math.min(req.expireInDays ?? 7, 180) * 86_400_000).toISOString();

  const r = await call("/api/pay/v1/paymentlink", {
    method: "POST",
    body: {
      amount: { value: req.amountMinorUnits, currency: req.currency },
      merchant_payment_link_reference: req.merchantReference,
      description: req.purpose,
      expire_by: expireBy,
      callback_url: req.callbackUrl,
      ...(customer ? { customer } : {}),
    },
  });
  if (!r.ok) return r;
  const { payment_link_id: id, payment_link: url, status } = r.data as { payment_link_id?: string; payment_link?: string; status?: string };
  if (!id || !url) return { ok: false, reason: "Pine Labs accepted the request but returned no payment_link_id/payment_link." };
  return { ok: true, paymentLinkId: id, paymentLinkUrl: url, status: status ?? "CREATED" };
}

function parseStatus(data: Record<string, unknown>): PaymentLinkStatusResult {
  const status = data.status as string | undefined;
  if (!status) return { ok: false, reason: "Pine Labs returned no status." };
  const amount = data.amount as { value?: number; currency?: string } | undefined;
  return {
    ok: true,
    paymentLinkId: String(data.payment_link_id ?? ""),
    merchantReference: (data.merchant_payment_link_reference as string | undefined) ?? null,
    status,
    amountMinorUnits: amount?.value ?? null,
    currency: amount?.currency ?? null,
  };
}

export async function getPaymentLinkStatus(paymentLinkId: string): Promise<PaymentLinkStatusResult> {
  const r = await call(`/api/pay/v1/paymentlink/${encodeURIComponent(paymentLinkId)}`, { method: "GET" });
  return r.ok ? parseStatus(r.data) : r;
}

export async function getPaymentLinkByReference(merchantReference: string): Promise<PaymentLinkStatusResult> {
  const r = await call(`/api/pay/v1/paymentlink/merchant-reference/${encodeURIComponent(merchantReference)}`, { method: "GET" });
  return r.ok ? parseStatus(r.data) : r;
}

export async function cancelPaymentLink(paymentLinkId: string): Promise<SimpleResult> {
  const r = await call(`/api/pay/v1/paymentlink/${encodeURIComponent(paymentLinkId)}/cancel`, { method: "PUT" });
  return r.ok ? { ok: true } : r;
}

export async function resendPaymentLinkNotification(paymentLinkId: string): Promise<SimpleResult> {
  const r = await call(`/api/pay/v1/paymentlink/${encodeURIComponent(paymentLinkId)}/resend`, { method: "PATCH" });
  return r.ok ? { ok: true } : r;
}

// Smallest real check of base URL + credentials: one token request through the
// same client every payment uses. Never returns the token or any secret.
export async function probePineLabsAuth(): Promise<{ ok: boolean; httpStatus: number | null; host: string; detail: string }> {
  const host = (() => {
    try {
      return new URL(baseUrl()).host;
    } catch {
      return "(invalid base URL)";
    }
  })();
  if (!isPineLabsConfigured()) return { ok: false, httpStatus: null, host, detail: `Missing ${getMissingPineLabsEnvVars().join(", ")}.` };
  cachedToken = null;
  const auth = await getAccessToken();
  return auth.ok ? { ok: true, httpStatus: 200, host, detail: "Token issued (value not shown)." } : { ok: false, httpStatus: auth.status ?? null, host, detail: auth.reason };
}
