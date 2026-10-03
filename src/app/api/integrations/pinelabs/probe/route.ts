import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { getAppBaseUrl } from "@/lib/site-url";
import { createPaymentLink, getMissingPineLabsEnvVars, probePineLabsAuth } from "@/lib/payments/pine-labs-provider";

// Signed-in only. Uses the same Pine Labs client every payment uses.
//   GET            -> env-name presence + one real token request (HTTP status only)
//   GET ?create=1  -> if auth passes, creates ONE minimal UAT payment link and
//                     returns its hosted checkout URL. Writes nothing to the
//                     database: no Booking, Expense or payment state is touched,
//                     and nothing is marked paid.
// Never returns credentials or the access token.
export async function GET(request: NextRequest) {
  if (!(await getCurrentUserId())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const names = ["PINELABS_API_BASE_URL", "PINELABS_BASE_URL", "PINELABS_CLIENT_ID", "PINELABS_CLIENT_SECRET", "PINELABS_WEBHOOK_SECRET"];
  const present = Object.fromEntries(names.map((n) => [n, Boolean(process.env[n])]));
  const auth = await probePineLabsAuth();
  const out: Record<string, unknown> = { envPresent: present, missingForClient: getMissingPineLabsEnvVars(), auth };
  if (auth.ok && request.nextUrl.searchParams.get("create") === "1") {
    const ref = `uat-probe-${Date.now()}`.slice(0, 50);
    const link = await createPaymentLink({
      merchantReference: ref,
      amountMinorUnits: 1000,
      currency: "INR",
      purpose: "Clockwise UAT connectivity test (₹10)",
      callbackUrl: `${getAppBaseUrl()}/api/payments/return?booking=${ref}`,
      expireInDays: 1,
    });
    out.createLink = link.ok
      ? { ok: true, merchantReference: ref, paymentLinkId: link.paymentLinkId, status: link.status, checkoutUrl: link.paymentLinkUrl }
      : { ok: false, reason: link.reason };
  }
  return NextResponse.json(out);
}
