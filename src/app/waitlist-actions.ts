"use server";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStoredAttribution } from "@/lib/attribution";
import { ensureVisitorId } from "@/lib/visitor";
import { emailProvider } from "@/lib/email/resend-provider";
import { waitlistConfirmationEmail, waitlistNotificationEmail } from "@/lib/email/templates";
import { ADMIN_NOTIFY_EMAIL } from "@/lib/notify-email";

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

  // Analytics/housekeeping — NEVER allowed to prevent the emails below.
  // This was previously unguarded: a throw here (either call is a
  // separate, non-transactional write from the signup row already
  // committed above) would propagate out of joinWaitlist() uncaught,
  // meaning the DB row exists but the function never reaches the email
  // code at all — a plausible exact match for "DB write succeeds, zero
  // Resend activity, no error visibly reported" (WaitlistForm.tsx calls
  // this inside startTransition with no catch of its own; an unhandled
  // rejection there surfaces only as a browser console warning, easy to
  // miss). totalCount falls back to 0 if this section fails, rather than
  // blocking the notification email over a display number.
  let totalCount = 0;
  try {
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
    totalCount = await prisma.waitlistSignup.count();
  } catch (err) {
    console.error(
      `WAITLIST_POST_SAVE_HOUSEKEEPING_FAILED id=${signup.id} error=${err instanceof Error ? err.message : "unknown"} — continuing to email sends regardless.`
    );
  }

  // Read fresh on every invocation, not cached at module scope, so a
  // Vercel env var change always takes effect on the very next request
  // without depending on how long this serverless instance has been warm.
  const testRecipient = process.env.WAITLIST_EMAIL_TEST_RECIPIENT?.trim() || null;
  const resendConfigured = Boolean(process.env.RESEND_API_KEY);
  console.log(
    `WAITLIST_EMAIL_CONFIG resendApiKeyConfigured=${resendConfigured} testRecipientConfigured=${Boolean(testRecipient)}${testRecipient ? ` testRecipientTarget=${testRecipient}` : ""}`
  );

  // Email failures never undo the signup or surface as an error to the
  // user — the row is already saved regardless of delivery outcome. Both
  // sends ARE awaited (not fire-and-forget) — the function does not
  // return until both have resolved, success or failure.
  //
  // The recipient (`to`) is redirected while WAITLIST_EMAIL_TEST_RECIPIENT
  // is set (see the log line above and WAITLIST_SUBMISSION_RECEIVED /
  // WAITLIST_DB_SAVED for the real intended recipient, if you need to
  // correlate) — but subject and html are always the real, unmodified
  // production content. No visible test/redirect language reaches the
  // inbox; this is purely a backend routing decision.
  const confirmation = waitlistConfirmationEmail();
  const confirmationTo = testRecipient ?? signup.email;
  console.log(`WAITLIST_CONFIRMATION_EMAIL_ATTEMPTED to=${confirmationTo} provider=resend`);
  const confirmationResult = await emailProvider.send({
    to: confirmationTo,
    subject: confirmation.subject,
    html: confirmation.html,
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
  console.log(`WAITLIST_ADMIN_EMAIL_ATTEMPTED to=${notificationTo} provider=resend`);
  const notificationResult = await emailProvider.send({
    to: notificationTo,
    subject: notification.subject,
    html: notification.html,
  });
  if (notificationResult.sent) {
    console.log(`WAITLIST_ADMIN_EMAIL_SENT to=${notificationTo} resendId=${notificationResult.id}`);
  } else {
    console.error(`WAITLIST_ADMIN_EMAIL_FAILED to=${notificationTo} reason=${notificationResult.reason}`);
  }

  return { status: "joined" };
}
