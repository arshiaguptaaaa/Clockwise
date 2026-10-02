// Processes due ScheduledJob rows. Safe to run any number of times, from any
// number of places, at once: jobs are claimed atomically (FOR UPDATE SKIP
// LOCKED), each claimed row moves SCHEDULED -> PROCESSING exactly once, emails
// are protected by their own idempotency key, and a job whose invite was
// accepted in the meantime is resolved instead of fired.
import { prisma } from "./prisma";
import { deliverClockwiseEmail } from "./email/deliver";
import { inviteUrl } from "./invite-engine";
import { notify } from "./notifications";
import { gnaniVoiceProvider, isGnaniConfigured, getMissingGnaniEnvVars } from "./voice-escalation/gnani-provider";

const BATCH = 10;
const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 2 * 60_000;
const STALE_LOCK_MS = 5 * 60_000;

export type WorkerSummary = { claimed: number; sent: number; resolved: number; cancelled: number; failed: number; retried: number; skipped: number };

// Personal to the organiser (these carry invitee contact details).
async function event(tripId: string, organiserId: string, kind: string, payload: Record<string, unknown>) {
  await prisma.tripEvent.create({
    data: {
      tripId,
      kind,
      scope: "PERSONAL",
      actorUserId: organiserId,
      subjectUserId: organiserId,
      sourceChannel: "SYSTEM",
      confidence: "HIGH",
      payload: JSON.stringify(payload),
      propagation: JSON.stringify(["travellers", "notifications"]),
    },
  });
}

function splitPhone(phone: string): [string, string] {
  const compact = phone.replace(/[\s().-]/g, "");
  const m = compact.match(/^(\+\d{1,3})(\d{6,})$/);
  return m ? [m[1], m[2]] : ["+91", compact.replace(/\D/g, "")];
}

export async function processDueJobs(): Promise<WorkerSummary> {
  const summary: WorkerSummary = { claimed: 0, sent: 0, resolved: 0, cancelled: 0, failed: 0, retried: 0, skipped: 0 };

  // A worker that died mid-job leaves PROCESSING rows; hand them back. The
  // email idempotency key stops a re-run from sending twice.
  await prisma.scheduledJob.updateMany({
    where: { status: "PROCESSING", lockedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } },
    data: { status: "SCHEDULED" },
  });

  const claimed = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "ScheduledJob"
       SET status = 'PROCESSING', "lockedAt" = NOW(), "attemptCount" = "attemptCount" + 1, "updatedAt" = NOW()
     WHERE id IN (
       SELECT id FROM "ScheduledJob"
        WHERE status = 'SCHEDULED' AND "scheduledFor" <= NOW()
        ORDER BY "scheduledFor"
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED)
    RETURNING id`;
  summary.claimed = claimed.length;

  for (const { id } of claimed) {
    const job = await prisma.scheduledJob.findUnique({ where: { id } });
    if (!job) continue;
    const invite = job.inviteId ? await prisma.invite.findUnique({ where: { id: job.inviteId } }) : null;

    // The required action already happened — don't fire.
    if (!invite || invite.status === "ACCEPTED") {
      await prisma.scheduledJob.update({
        where: { id },
        data: { status: job.channel === "EMAIL" ? "RESOLVED" : "CANCELLED", resolvedAt: new Date() },
      });
      if (job.channel === "EMAIL") summary.resolved++;
      else summary.cancelled++;
      continue;
    }

    if (job.eventType === "INVITE_REMINDER_EMAIL") {
      await event(job.tripId, invite.invitedBy, "INVITE_RESPONSE_OVERDUE", { inviteId: invite.id, invitee: invite.inviteeName, jobId: job.id });
      const [trip, organiser, members] = await Promise.all([
        prisma.trip.findUnique({ where: { id: job.tripId }, include: { destinations: { orderBy: { order: "asc" } } } }),
        prisma.user.findUnique({ where: { id: invite.invitedBy }, select: { name: true } }),
        prisma.tripMember.count({ where: { tripId: job.tripId } }),
      ]);
      const result = await deliverClockwiseEmail({
        tripId: job.tripId,
        inviteId: invite.id,
        jobId: job.id,
        intendedRecipient: job.recipient,
        idempotencyKey: `job:${job.id}`,
        content: {
          kind: "REMINDER",
          recipientName: invite.inviteeName,
          organiserName: organiser?.name ?? "Your trip organiser",
          tripName: trip?.name ?? "your trip",
          destinations: (trip?.destinations ?? []).map((d) => d.city ?? d.name),
          travellerCount: Math.max(0, members - 1),
          ctaUrl: inviteUrl(invite.token),
        },
      });
      if (result.ok) {
        await prisma.scheduledJob.update({
          where: { id },
          data: { status: "SENT", providerMessageId: result.duplicate ? job.providerMessageId : result.providerMessageId, failureReason: null },
        });
        if (!result.duplicate) {
          await event(job.tripId, invite.invitedBy, "INVITE_REMINDER_EMAIL_SENT", {
            inviteId: invite.id,
            invitee: invite.inviteeName,
            jobId: job.id,
            provider: "resend",
            providerMessageId: result.providerMessageId,
            deliveryRecipient: result.deliveryRecipient,
            overridden: result.overridden,
          });
          await notify({
            tripId: job.tripId,
            recipientIds: [invite.invitedBy],
            severity: "IMPORTANT",
            kind: "INVITE_REMINDER_EMAIL_SENT",
            title: `${invite.inviteeName} hasn't responded yet`,
            body: `Clockwise sent ${invite.inviteeName} a reminder email.`,
            href: `/trips/${job.tripId}/plan/travellers`,
          });
        }
        summary.sent++;
      } else if (job.attemptCount < MAX_ATTEMPTS) {
        await prisma.scheduledJob.update({
          where: { id },
          data: { status: "SCHEDULED", scheduledFor: new Date(Date.now() + RETRY_AFTER_MS), failureReason: result.reason.slice(0, 200) },
        });
        summary.retried++;
      } else {
        await prisma.scheduledJob.update({ where: { id }, data: { status: "FAILED", failureReason: result.reason.slice(0, 200) } });
        summary.failed++;
      }
      continue;
    }

    if (job.eventType === "INVITE_ESCALATION_CALL") {
      if (!invite.callConsent || !invite.phone) {
        await prisma.scheduledJob.update({ where: { id }, data: { status: "CANCELLED", failureReason: "no_call_consent_or_phone", resolvedAt: new Date() } });
        summary.cancelled++;
        continue;
      }
      if (!isGnaniConfigured()) {
        // Never a pretend call: without the platform credential nothing is placed.
        const reason = `gnani_platform_not_configured (missing ${getMissingGnaniEnvVars().join(", ")})`;
        await prisma.scheduledJob.update({ where: { id }, data: { status: "FAILED", failureReason: reason } });
        await event(job.tripId, invite.invitedBy, "ESCALATION_CALL_BLOCKED", { inviteId: invite.id, invitee: invite.inviteeName, jobId: job.id, reason });
        summary.failed++;
        continue;
      }
      const [countryCode, phone] = splitPhone(job.recipient);
      const placed = await gnaniVoiceProvider.initiateCall({ travellerName: invite.inviteeName, phone, countryCode, clientReferenceId: job.id });
      if (placed.placed) {
        await prisma.scheduledJob.update({ where: { id }, data: { status: "SENT", providerRequestId: placed.providerConversationId, failureReason: null } });
        await event(job.tripId, invite.invitedBy, "ESCALATION_CALL_PLACED", { inviteId: invite.id, invitee: invite.inviteeName, jobId: job.id, provider: "gnani", providerRequestId: placed.providerConversationId });
        await notify({
          tripId: job.tripId,
          recipientIds: [invite.invitedBy],
          severity: "IMPORTANT",
          kind: "ESCALATION_CALL_PLACED",
          title: `Clockwise called ${invite.inviteeName}`,
          body: `${invite.inviteeName} hadn't responded to the invitation, so Clockwise placed a reminder call.`,
          href: `/trips/${job.tripId}/plan/travellers`,
        });
        summary.sent++;
      } else {
        const retry = job.attemptCount < MAX_ATTEMPTS;
        await prisma.scheduledJob.update({
          where: { id },
          data: retry ? { status: "SCHEDULED", scheduledFor: new Date(Date.now() + RETRY_AFTER_MS), failureReason: placed.reason.slice(0, 200) } : { status: "FAILED", failureReason: placed.reason.slice(0, 200) },
        });
        if (retry) summary.retried++;
        else summary.failed++;
      }
      continue;
    }

    await prisma.scheduledJob.update({ where: { id }, data: { status: "FAILED", failureReason: `unknown_event_type:${job.eventType}` } });
    summary.skipped++;
  }
  return summary;
}
