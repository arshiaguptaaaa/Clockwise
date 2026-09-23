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
  console.log(`WAITLIST_SUBMISSION_RECEIVED email=${email || "(empty)"}`);

  if (!email || !email.includes("@") || email.length > 254) {
    console.log(`WAITLIST_INVALID_EMAIL email=${email || "(empty)"}`);
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
    console.log(`WAITLIST_DB_SAVED id=${signup.id} email=${signup.email}`);
  } catch (err) {
    // Unique constraint on email — a friendly response, never revealing
    // anything else about the existing record, and never incrementing
    // anything for a repeat submission. IMPORTANT, and easy to miss when
    // testing: this returns BEFORE any email code below ever runs — a
    // second submission of the SAME email will never trigger a send, by
    // design. Testing email delivery requires either a fresh address
    // each time, or a deliberate resend action (not built — out of
    // scope here), never a repeat submission of the same address.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      console.log(`WAITLIST_DUPLICATE_SHORT_CIRCUIT email=${email} — returning early, no email will be sent for this submission.`);
      return { status: "already_on_list" };
    }
    console.error(`WAITLIST_DB_SAVE_FAILED email=${email} error=${err instanceof Error ? err.message : "unknown"}`);
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

  if (testRecipient) {
    console.log(`WAITLIST_TEST_RECIPIENT_ACTIVE target=${testRecipient} — both emails below are redirected here.`);
  }

  // Email failures never undo the signup or surface as an error to the
  // user — the row is already saved regardless of delivery outcome. Both
  // sends ARE awaited (not fire-and-forget) — the function does not
  // return until both have resolved, success or failure.
  const confirmation = waitlistConfirmationEmail();
  const confirmationTo = testRecipient ?? signup.email;
  console.log(`WAITLIST_CONFIRMATION_EMAIL_ATTEMPTED to=${confirmationTo}`);
  const confirmationResult = await emailProvider.send({
    to: confirmationTo,
    subject: testRecipient ? `[TEST → ${signup.email}] ${confirmation.subject}` : confirmation.subject,
    html: testRecipient ? withTestRecipientNotice(confirmation.html, signup.email) : confirmation.html,
  });
  if (confirmationResult.sent) {
    console.log(`WAITLIST_CONFIRMATION_EMAIL_SENT to=${confirmationTo} resendId=${confirmationResult.id}`);
  } else {
    console.error(`WAITLIST_CONFIRMATION_EMAIL_FAILED to=${confirmationTo} reason=${confirmationResult.reason}`);
  }

  const notification = waitlistNotificationEmail({
    email: signup.email,
    signedUpAt: signup.createdAt,
    source: signup.source,
    totalCount,
  });
  const notificationTo = testRecipient ?? ADMIN_NOTIFY_EMAIL;
  console.log(`WAITLIST_ADMIN_EMAIL_ATTEMPTED to=${notificationTo}`);
  const notificationResult = await emailProvider.send({
    to: notificationTo,
    subject: testRecipient ? `[TEST → ${ADMIN_NOTIFY_EMAIL}] ${notification.subject}` : notification.subject,
    html: testRecipient ? withTestRecipientNotice(notification.html, ADMIN_NOTIFY_EMAIL) : notification.html,
  });
  if (notificationResult.sent) {
    console.log(`WAITLIST_ADMIN_EMAIL_SENT to=${notificationTo} resendId=${notificationResult.id}`);
  } else {
    console.error(`WAITLIST_ADMIN_EMAIL_FAILED to=${notificationTo} reason=${notificationResult.reason}`);
  }

  return { status: "joined" };
}
