import { NextRequest, NextResponse } from "next/server";
import { adminSecretForCsrf, getAdminSessionValue, isAdminAuthenticated } from "@/lib/admin-auth";
import { CSRF_HEADER, csrfTokenFor, csrfTokenValid, originAllowed } from "@/lib/csrf";

// Guards for API route handlers (a layout guard does not cover them).
//   requireAdmin          -> read-only diagnostics: admin session required.
//   requireAdminMutation  -> anything that writes data, spends provider money or creates something (e.g. a payment
//                            link): admin session + same-site request + CSRF token, and the route must export POST only.
// Both return a ready NextResponse to send when the caller is refused, or null when the request may proceed.
const noStore = { "Cache-Control": "no-store" };

export async function requireAdmin(): Promise<NextResponse | null> {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ error: "Admin only." }, { status: 401, headers: noStore });
  return null;
}

export async function requireAdminMutation(request: NextRequest): Promise<NextResponse | null> {
  const denied = await requireAdmin();
  if (denied) return denied;
  const h = request.headers;
  if (!originAllowed(h.get("origin"), h.get("host"), h.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-site request refused." }, { status: 403, headers: noStore });
  }
  if (!csrfTokenValid(h.get(CSRF_HEADER), await getAdminSessionValue(), adminSecretForCsrf())) {
    return NextResponse.json({ error: "Missing or invalid CSRF token." }, { status: 403, headers: noStore });
  }
  return null;
}

// The token a signed-in admin sends as the x-csrf-token header. Tied to the current session.
export async function currentCsrfToken(): Promise<string | null> {
  const session = await getAdminSessionValue();
  const key = adminSecretForCsrf();
  return session && key ? csrfTokenFor(session, key) : null;
}
