import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";

// Read-only audit of the email setup (signed-in only). Answers: is the API key
// present, which FROM address is in use, which sending domains exist and are
// they verified. Resend only delivers to arbitrary recipients from a VERIFIED
// domain; from the shared onboarding@resend.dev sender it only reaches the
// account owner's own address. Never returns the key.
export async function GET(request: NextRequest) {
  if (!(await getCurrentUserId())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || "Clockwise <onboarding@resend.dev>";
  const fromDomain = (/@([^>\s]+)/.exec(from)?.[1] ?? "").toLowerCase();
  const usingSharedSender = fromDomain === "resend.dev";
  const deliveryOverrideActive = Boolean(process.env.EMAIL_DELIVERY_OVERRIDE?.trim() || process.env.WAITLIST_EMAIL_TEST_RECIPIENT?.trim());
  // ?emailId=<provider message id> returns Resend's own record of that email:
  // delivery event, subject, recipient, and every link in the HTML — proof from
  // the provider, not from our own log.
  const emailId = request.nextUrl.searchParams.get("emailId");
  if (key && emailId && /^[0-9a-f-]{20,}$/i.test(emailId)) {
    try {
      const r = await fetch(`https://api.resend.com/emails/${emailId}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
      const e = (await r.json().catch(() => ({}))) as { last_event?: string; subject?: string; to?: string[]; from?: string; created_at?: string; html?: string; message?: string };
      const links = [...(e.html ?? "").matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
      return NextResponse.json({
        httpStatus: r.status,
        lastEvent: e.last_event ?? null,
        subject: e.subject ?? null,
        to: e.to ?? null,
        from: e.from ?? null,
        createdAt: e.created_at ?? null,
        links: [...new Set(links)],
        note: r.ok ? null : (e.message ?? "lookup failed").slice(0, 160),
      });
    } catch {
      return NextResponse.json({ error: "lookup failed" }, { status: 502 });
    }
  }
  if (!key) return NextResponse.json({ apiKeyConfigured: false, from, usingSharedSender, deliveryOverrideActive });

  try {
    const res = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { data?: { name: string; status: string }[]; message?: string; name?: string };
    const domains = (body.data ?? []).map((d) => ({ name: d.name, status: d.status }));
    const fromDomainVerified = domains.some((d) => d.name.toLowerCase() === fromDomain && d.status === "verified");
    return NextResponse.json({
      apiKeyConfigured: true,
      deliveryOverrideActive,
      from,
      usingSharedSender,
      listDomainsHttpStatus: res.status,
      // A restricted ("sending access") key can't list domains; that is reported, not guessed.
      listDomainsNote: res.ok ? null : (body.message ?? body.name ?? "could not list domains").slice(0, 160),
      domains,
      fromDomainVerified,
      canSendToArbitraryRecipients: !usingSharedSender && fromDomainVerified,
    });
  } catch (err) {
    return NextResponse.json({ apiKeyConfigured: true, from, usingSharedSender, error: err instanceof Error ? err.name : "request failed" }, { status: 502 });
  }
}
