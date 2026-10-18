import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireAdminMutation } from "@/lib/admin-request";
import { getAppBaseUrl } from "@/lib/site-url";
import { createPaymentLink, getMissingPineLabsEnvVars, probePineLabsAuth } from "@/lib/payments/pine-labs-provider";

// Admin only. Uses the same Pine Labs client every payment uses.
//   GET            -> env-name presence + one real token request (HTTP status only)
//   POST           -> (admin + CSRF token + same-site) if auth passes, creates ONE minimal UAT payment link and
//                     returns its hosted checkout URL. Writes nothing to the
//                     database: no Booking, Expense or payment state is touched,
//                     and nothing is marked paid.
// Never returns credentials or the access token.
// Creating a payment link is a side effect, so it is never reachable by GET (a link, an <img> or a prefetch could
// trigger a GET). ?create=1 on GET now only explains where to go.
export async function GET(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const names = ["PINELABS_API_BASE_URL", "PINELABS_BASE_URL", "PINELABS_CLIENT_ID", "PINELABS_CLIENT_SECRET", "PINELABS_WEBHOOK_SECRET"];
  const present = Object.fromEntries(names.map((n) => [n, Boolean(process.env[n])]));
  const auth = await probePineLabsAuth();
  const out: Record<string, unknown> = { envPresent: present, missingForClient: getMissingPineLabsEnvVars(), auth };
  if (request.nextUrl.searchParams.get("create") === "1") out.createLink = { ok: false, reason: "Link creation is POST-only and needs an admin CSRF token. Nothing was created." };
  return NextResponse.json(out);
}

export async function POST(request: NextRequest) {
  const denied = await requireAdminMutation(request);
  if (denied) return denied;
  const auth = await probePineLabsAuth();
  const out: Record<string, unknown> = { auth };
  if (auth.ok) {
    const ref = `uat-probe-${Date.now()}`.slice(0, 50);
    const link = await createPaymentLink({
      merchantReference: ref,
      amountMinorUnits: 1000,
      currency: "INR",
      purpose: "Clockwise UAT connectivity test (₹10)",
      // Pine Labs rejects links without customer info (400 "Customer Information is required").
      // Clearly fake test customer — no real person's details.
      customerName: "Clockwise UAT Test",
      customerEmail: "uat-test@example.com",
      callbackUrl: `${getAppBaseUrl()}/api/payments/return?booking=${ref}`,
      expireInDays: 1,
    });
    out.createLink = link.ok
      ? { ok: true, merchantReference: ref, paymentLinkId: link.paymentLinkId, status: link.status, checkoutUrl: link.paymentLinkUrl }
      : { ok: false, reason: link.reason };
  }
  return NextResponse.json(out);
}
