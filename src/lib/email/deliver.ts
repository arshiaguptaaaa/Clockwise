// The one place a Clockwise email is actually sent. It
//   1. records an EmailLog row FIRST, keyed by an idempotency key — if that
//      key already exists the email was already sent (or is being sent), so a
//      retry, a double click or a second worker run sends nothing;
//   2. calls the provider with the same key;
//   3. records the provider message id (or the failure reason) on that row.
//
// Sandbox: Resend only delivers to the account owner until a domain is
// verified. While EMAIL_DELIVERY_OVERRIDE (or the older
// WAITLIST_EMAIL_TEST_RECIPIENT) is set, mail goes to that address INSTEAD —
// but intendedRecipient (the traveller's real address) is stored unchanged on
// the log row and mentioned in the email itself, and the traveller's own
// record is never touched. Remove the variable once a domain is verified and
// the same code sends to the real address.
import { prisma } from "@/lib/prisma";
import { emailProvider } from "./resend-provider";
import { renderClockwiseEmail, type EmailContent } from "./clockwise-email";

export function deliveryOverride(): string | null {
  return process.env.EMAIL_DELIVERY_OVERRIDE?.trim() || process.env.WAITLIST_EMAIL_TEST_RECIPIENT?.trim() || null;
}

export type DeliverResult =
  | { ok: true; duplicate: false; logId: string; providerMessageId: string; deliveryRecipient: string; overridden: boolean }
  | { ok: true; duplicate: true; logId: string }
  | { ok: false; logId: string | null; reason: string };

export async function deliverClockwiseEmail(params: {
  tripId: string | null;
  inviteId?: string | null;
  jobId?: string | null;
  intendedRecipient: string;
  content: Omit<EmailContent, "sandboxNote">;
  idempotencyKey: string;
}): Promise<DeliverResult> {
  const override = deliveryOverride();
  const deliveryRecipient = override ?? params.intendedRecipient;
  const overridden = Boolean(override) && override!.toLowerCase() !== params.intendedRecipient.toLowerCase();
  const rendered = renderClockwiseEmail({
    ...params.content,
    sandboxNote: overridden
      ? `Sandbox delivery: this message was meant for ${params.intendedRecipient}. It is sent to you only because email sending is still in test mode.`
      : undefined,
  });

  let logId: string;
  try {
    const log = await prisma.emailLog.create({
      data: {
        tripId: params.tripId,
        inviteId: params.inviteId ?? null,
        jobId: params.jobId ?? null,
        kind: params.content.kind,
        intendedRecipient: params.intendedRecipient,
        deliveryRecipient,
        overridden,
        status: "SENDING",
        subject: rendered.subject,
        ctaUrl: params.content.ctaUrl,
        idempotencyKey: params.idempotencyKey,
      },
    });
    logId = log.id;
  } catch (err) {
    // Unique violation on idempotencyKey: this exact email already exists.
    const existing = await prisma.emailLog.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
    if (existing) return { ok: true, duplicate: true, logId: existing.id };
    return { ok: false, logId: null, reason: err instanceof Error ? err.message.slice(0, 160) : "log write failed" };
  }

  const result = await emailProvider.send({
    to: deliveryRecipient,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    idempotencyKey: params.idempotencyKey,
  });

  if (!result.sent) {
    await prisma.emailLog.update({ where: { id: logId }, data: { status: "FAILED", failureReason: result.reason.slice(0, 300) } });
    return { ok: false, logId, reason: result.reason };
  }
  await prisma.emailLog.update({
    where: { id: logId },
    data: { status: "SENT", providerMessageId: result.id, sentAt: new Date() },
  });
  return { ok: true, duplicate: false, logId, providerMessageId: result.id, deliveryRecipient, overridden };
}
