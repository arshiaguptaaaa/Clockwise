// Central notification routing. EVERY notification in the product goes
// through notify(); no feature decides on its own to push or email.
//
//   INFO       -> in-app
//   IMPORTANT  -> in-app + web push
//   HIGH       -> in-app + web push + email
//   CRITICAL   -> in-app + web push + email   (+ eligible for voice escalation)
//
// Voice (Gnani) is an ESCALATION RAIL, not a generic channel: notify() never
// places a call. CRITICAL only marks the notification escalation-eligible;
// the existing opt-in + reminder-first gate (checkEscalationReadiness) still
// decides whether a call is allowed.
//
// Every rail reports what actually happened into Notification.deliveries —
// a missing VAPID key or an unconfigured email address is recorded as
// SKIPPED:<reason>, never silently treated as delivered.
import webpush from "web-push";
import { prisma } from "./prisma";
import { emailProvider } from "./email/resend-provider";
import { getAppBaseUrl } from "./site-url";

export type Severity = "INFO" | "IMPORTANT" | "HIGH" | "CRITICAL";
export type Rail = "IN_APP" | "PUSH" | "EMAIL";

export const SEVERITY_RAILS: Record<Severity, Rail[]> = {
  INFO: ["IN_APP"],
  IMPORTANT: ["IN_APP", "PUSH"],
  HIGH: ["IN_APP", "PUSH", "EMAIL"],
  CRITICAL: ["IN_APP", "PUSH", "EMAIL"],
};

export type NotifyInput = {
  tripId: string;
  recipientIds: string[];
  severity: Severity;
  kind: string;
  title: string;
  body: string;
  // Path inside the app, e.g. /trips/<id>/plan/travellers
  href?: string;
  eventId?: string | null;
};

export type Delivery = { rail: Rail; status: "SENT" | "SKIPPED" | "FAILED"; detail?: string };

export function isPushConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function sendPush(userId: string, payload: { title: string; body: string; href: string }): Promise<Delivery> {
  if (!isPushConfigured()) return { rail: "PUSH", status: "SKIPPED", detail: "push_not_configured" };
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subs.length === 0) return { rail: "PUSH", status: "SKIPPED", detail: "no_subscription" };

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:hello@clockwise.app",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
  let sent = 0;
  let lastError: string | null = null;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 }
      );
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
      }
      lastError = `push_${status ?? "error"}`;
    }
  }
  return sent > 0 ? { rail: "PUSH", status: "SENT", detail: `${sent}/${subs.length} devices` } : { rail: "PUSH", status: "FAILED", detail: lastError ?? "unknown" };
}

async function sendEmail(userId: string, n: { title: string; body: string; href: string }): Promise<Delivery> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user?.email) return { rail: "EMAIL", status: "SKIPPED", detail: "no_email_on_file" };
  const link = `${getAppBaseUrl()}${n.href}`;
  const result = await emailProvider.send({
    to: user.email,
    subject: n.title,
    html: `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#14181a;line-height:1.6;font-size:15px">
<p style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#6b716c;font-weight:600;margin:0 0 20px">CLOCKWISE</p>
<p style="font-weight:600;margin:0 0 8px">${escapeHtml(n.title)}</p>
<p style="margin:0">${escapeHtml(n.body)}</p>
<p style="margin:24px 0 0"><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 26px;background:#163a2c;color:#fff;text-decoration:none;border-radius:999px;font-weight:600;font-size:14px">Open in Clockwise</a></p></div>`,
  });
  return result.sent ? { rail: "EMAIL", status: "SENT", detail: result.id } : { rail: "EMAIL", status: "FAILED", detail: result.reason };
}

// Creates one Notification per recipient and fans out to the rails the
// severity calls for. Never throws into the caller: a notification failure
// must not undo the state change that caused it.
export async function notify(input: NotifyInput): Promise<void> {
  const rails = SEVERITY_RAILS[input.severity];
  const href = input.href ?? `/trips/${input.tripId}/room`;
  const recipients = [...new Set(input.recipientIds)];

  await Promise.all(
    recipients.map(async (userId) => {
      try {
        const deliveries: Delivery[] = [{ rail: "IN_APP", status: "SENT" }];
        const payload = { title: input.title, body: input.body, href };
        if (rails.includes("PUSH")) deliveries.push(await sendPush(userId, payload));
        if (rails.includes("EMAIL")) deliveries.push(await sendEmail(userId, payload));
        await prisma.notification.create({
          data: {
            tripId: input.tripId,
            userId,
            severity: input.severity,
            kind: input.kind,
            title: input.title,
            body: input.body,
            href,
            eventId: input.eventId ?? null,
            deliveries: JSON.stringify(deliveries),
          },
        });
      } catch (err) {
        console.error(`[notify] failed for user=${userId} kind=${input.kind}:`, err instanceof Error ? err.message : err);
      }
    })
  );
}

// Everyone on the trip except the person whose action it was.
export async function otherMemberIds(tripId: string, exceptUserId: string | null): Promise<string[]> {
  const members = await prisma.tripMember.findMany({ where: { tripId }, select: { userId: true } });
  return members.map((m) => m.userId).filter((id) => id !== exceptUserId);
}
