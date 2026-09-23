"use server";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStoredAttribution } from "@/lib/attribution";
import { ensureVisitorId } from "@/lib/visitor";
import { emailProvider } from "@/lib/email/resend-provider";
import { waitlistConfirmationEmail, waitlistNotificationEmail, withTestRecipientNotice } from "@/lib/email/templates";
import { ADMIN_NOTIFY_EMAIL } from "@/lib/notify-email";

// Temporary: the current Resend account is in test mode and can only
// deliver to its own registered address (confirmed live — see commit
// history). Setting this env var redirects BOTH waitlist emails there,
// with a visible in-email notice of the real intended recipient, without
// ever touching what's stored in the database (WaitlistSignup.email is
// always the visitor's real submitted address, unconditionally). Unset
// this once a sending domain is verified in Resend to restore normal
// behavior — no code change needed, this is purely env-driven.
const testRecipient = process.env.WAITLIST_EMAIL_TEST_RECIPIENT?.trim() || null;

export type JoinWaitlistResult =
  | { status: "joined" }
  | { status: "already_on_list" }
  | { status: "invalid_email" };

export async function joinWaitlist(formData: FormData): Promise<JoinWaitlistResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || !email.includes("@") || email.length > 254) {
    return { status: "invalid_email" };
  }

  const attribution = await getStoredAttribution();

  let signup;
  try {
    signup = await prisma.waitlistSignup.create({
      data: {
        email,
        source: attribution.source,
        medium: attribution.medium,
        campaign: attribution.campaign,
        referrer: attribution.referrer,
      },
    });
  } catch (err) {
    // Unique constraint on email — a friendly response, never revealing
    // anything else about the existing record, and never incrementing
    // anything for a repeat submission.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { status: "already_on_list" };
    }
    throw err;
  }

  const visitorId = await ensureVisitorId();
  await prisma.pageView.create({
    data: {
      page: "waitlist_submitted",
      visitorId,
      source: attribution.source,
      medium: attribution.medium,
      campaign: attribution.campaign,
      referrer: attribution.referrer,
    },
  });

  const totalCount = await prisma.waitlistSignup.count();

  // Email failures never undo the signup or surface as an error to the
  // user — the row is already saved regardless of delivery outcome.
  const confirmation = waitlistConfirmationEmail();
  const confirmationResult = await emailProvider.send({
    to: testRecipient ?? signup.email,
    subject: testRecipient ? `[TEST → ${signup.email}] ${confirmation.subject}` : confirmation.subject,
    html: testRecipient ? withTestRecipientNotice(confirmation.html, signup.email) : confirmation.html,
  });
  if (!confirmationResult.sent) {
    console.warn(`Waitlist confirmation email not sent to ${testRecipient ?? signup.email}: ${confirmationResult.reason}`);
  }

  const notification = waitlistNotificationEmail({
    email: signup.email,
    signedUpAt: signup.createdAt,
    source: signup.source,
    totalCount,
  });
  const notificationResult = await emailProvider.send({
    to: testRecipient ?? ADMIN_NOTIFY_EMAIL,
    subject: testRecipient ? `[TEST → ${ADMIN_NOTIFY_EMAIL}] ${notification.subject}` : notification.subject,
    html: testRecipient ? withTestRecipientNotice(notification.html, ADMIN_NOTIFY_EMAIL) : notification.html,
  });
  if (!notificationResult.sent) {
    console.warn(`Waitlist notification email not sent: ${notificationResult.reason}`);
  }

  return { status: "joined" };
}
