// Pine Labs Payment Links client. NOT the raw card-handling API — Payment
// Links means Clockwise never touches card details itself, only sends
// people to Pine Labs' own hosted page. Mirrors the existing
// gnani-provider.ts pattern exactly: isConfigured() gate, honest refusal
// when credentials are missing, never a fabricated response.
//
// Base URL, Client ID and Secret are NOT hardcoded — Pine Labs has
// separate UAT/production hosts and this repo has no verified value for
// either yet. Every call fails closed with a clear reason until real
// values are set.
const PAYMENT_LINK_PATH = "/api/pay/v1/paymentlink";

export function isPineLabsConfigured(): boolean {
  return Boolean(process.env.PINELABS_API_BASE_URL && process.env.PINELABS_CLIENT_ID && process.env.PINELABS_CLIENT_SECRET);
}

export function getMissingPineLabsEnvVars(): string[] {
  return ["PINELABS_API_BASE_URL", "PINELABS_CLIENT_ID", "PINELABS_CLIENT_SECRET"].filter((name) => !process.env[name]);
}

// Pine Labs' own documented status vocabulary for a payment link — used
// verbatim, nothing invented. PROCESSED is the only state that means
// "money actually moved."
export type PineLabsPaymentLinkStatus =
  | "CREATED"
  | "CLICKED"
  | "PAYMENT_INITIATED"
  | "PROCESSED"
  | "PARTIAL_PROCESSED"
  | "EXPIRED"
  | "CANCELLED";

export type CreatePaymentLinkRequest = {
  merchantReference: string; // our own unique reference, for idempotency
  amountMinorUnits: number; // smallest currency unit (paise for INR)
  currency: string;
  purpose: string;
  customerName?: string;
  customerContact?: string;
  callbackUrl: string;
};

export type CreatePaymentLinkResult =
  | { ok: true; paymentLinkId: string; paymentLinkUrl: string; status: PineLabsPaymentLinkStatus }
  | { ok: false; reason: string };

export type PaymentLinkStatusResult =
  | { ok: true; status: PineLabsPaymentLinkStatus; amountMinorUnits: number; currency: string }
  | { ok: false; reason: string };

export type SimpleResult = { ok: true } | { ok: false; reason: string };

function authHeaders(): Record<string, string> {
  // Never logged, never sent to the client — this function's return value
  // only ever goes into a server-side fetch() call in this same module.
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.PINELABS_CLIENT_SECRET}`,
    "X-Client-Id": process.env.PINELABS_CLIENT_ID!,
  };
}

export async function createPaymentLink(req: CreatePaymentLinkRequest): Promise<CreatePaymentLinkResult> {
  if (!isPineLabsConfigured()) {
    return { ok: false, reason: `Pine Labs isn't configured (missing ${getMissingPineLabsEnvVars().join(", ")}).` };
  }
  try {
    const res = await fetch(`${process.env.PINELABS_API_BASE_URL}${PAYMENT_LINK_PATH}`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        merchant_order_reference: req.merchantReference,
        amount: req.amountMinorUnits,
        currency: req.currency,
        description: req.purpose,
        customer_name: req.customerName,
        customer_contact: req.customerContact,
        callback_url: req.callbackUrl,
      }),
    });
    if (!res.ok) {
      return { ok: false, reason: `Pine Labs createPaymentLink failed (${res.status}): ${await res.text()}` };
    }
    const data: { payment_link_id?: string; payment_link?: string; status?: string } = await res.json();
    if (!data.payment_link_id || !data.payment_link) {
      return { ok: false, reason: "Pine Labs accepted the request but returned no payment_link_id/payment_link." };
    }
    return {
      ok: true,
      paymentLinkId: data.payment_link_id,
      paymentLinkUrl: data.payment_link,
      status: (data.status as PineLabsPaymentLinkStatus) ?? "CREATED",
    };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Unknown Pine Labs error." };
  }
}

export async function getPaymentLinkStatus(paymentLinkId: string): Promise<PaymentLinkStatusResult> {
  if (!isPineLabsConfigured()) {
    return { ok: false, reason: `Pine Labs isn't configured (missing ${getMissingPineLabsEnvVars().join(", ")}).` };
  }
  try {
    const res = await fetch(`${process.env.PINELABS_API_BASE_URL}${PAYMENT_LINK_PATH}/${paymentLinkId}`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      return { ok: false, reason: `Pine Labs getPaymentLinkStatus failed (${res.status}): ${await res.text()}` };
    }
    const data: { status?: string; amount?: number; currency?: string } = await res.json();
    if (!data.status) return { ok: false, reason: "Pine Labs returned no status." };
    return {
      ok: true,
      status: data.status as PineLabsPaymentLinkStatus,
      amountMinorUnits: data.amount ?? 0,
      currency: data.currency ?? "INR",
    };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Unknown Pine Labs error." };
  }
}

export async function cancelPaymentLink(paymentLinkId: string): Promise<SimpleResult> {
  if (!isPineLabsConfigured()) {
    return { ok: false, reason: `Pine Labs isn't configured (missing ${getMissingPineLabsEnvVars().join(", ")}).` };
  }
  try {
    const res = await fetch(`${process.env.PINELABS_API_BASE_URL}${PAYMENT_LINK_PATH}/${paymentLinkId}/cancel`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (!res.ok) return { ok: false, reason: `Pine Labs cancelPaymentLink failed (${res.status}): ${await res.text()}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Unknown Pine Labs error." };
  }
}

export async function resendPaymentLinkNotification(paymentLinkId: string): Promise<SimpleResult> {
  if (!isPineLabsConfigured()) {
    return { ok: false, reason: `Pine Labs isn't configured (missing ${getMissingPineLabsEnvVars().join(", ")}).` };
  }
  try {
    const res = await fetch(`${process.env.PINELABS_API_BASE_URL}${PAYMENT_LINK_PATH}/${paymentLinkId}/resend`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (!res.ok) return { ok: false, reason: `Pine Labs resend failed (${res.status}): ${await res.text()}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Unknown Pine Labs error." };
  }
}
