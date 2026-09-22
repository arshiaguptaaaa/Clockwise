import { prisma } from "@/lib/prisma";
import { getTripById } from "@/lib/trip";
import { getCurrentUserId } from "@/lib/session";
import { avatarColor } from "@/lib/avatar";
import { formatDateRange } from "@/lib/format";
import { computeReadinessStatus } from "@/lib/readiness";
import { CopyInviteLink } from "@/components/trip-room/CopyInviteLink";
import { CommitmentEscalation, type CommitmentView } from "@/components/plan/CommitmentEscalation";
import { MapPin, Mail } from "lucide-react";

export default async function PlanTravellersPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  const [trip, pendingInvites, commitments, escalationEvents, currentUserId] = await Promise.all([
    getTripById(tripId),
    prisma.invite.findMany({ where: { tripId, status: "PENDING" }, orderBy: { createdAt: "asc" } }),
    prisma.commitment.findMany({ where: { tripId } }),
    prisma.escalationEvent.findMany({ where: { tripId } }),
    getCurrentUserId(),
  ]);

  const userById = new Map(trip.members.map((m) => [m.userId, m.user]));
  const viewerIsOrganiser = currentUserId === trip.createdBy;

  const commitmentViews: CommitmentView[] = commitments.map((c) => {
    let participantIds: string[] = [];
    try {
      participantIds = JSON.parse(c.participantIds);
    } catch {
      participantIds = [];
    }
    return {
      id: c.id,
      name: c.name,
      location: c.location,
      targetTime: c.targetTime.toISOString(),
      status: computeReadinessStatus(c),
      participants: participantIds
        .map((userId) => userById.get(userId))
        .filter((u): u is NonNullable<typeof u> => Boolean(u))
        .map((u) => ({
          userId: u.id,
          name: u.name,
          voiceEscalationOptIn: u.voiceEscalationOptIn,
          hasPhone: Boolean(u.phone),
        })),
      events: escalationEvents
        .filter((e) => e.commitmentId === c.id)
        .map((e) => ({
          id: e.id,
          travellerId: e.travellerId,
          status: e.status,
          mode: e.mode,
          callDisposition: e.callDisposition,
          failureReason: e.failureReason,
        })),
    };
  });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <CommitmentEscalation commitments={commitmentViews} viewerIsOrganiser={viewerIsOrganiser} />

      <div className="flex flex-col gap-2">
        {trip.members.map((member) => (
          <div
            key={member.userId}
            className="flex items-center gap-3 rounded-xl border border-border px-3.5 py-3"
          >
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-medium"
              style={{
                backgroundColor: avatarColor(member.user.name).bg,
                color: avatarColor(member.user.name).text,
              }}
            >
              {member.user.name.slice(0, 1)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                {member.user.name}
                {member.role === "ORGANIZER" && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    Organiser
                  </span>
                )}
              </p>
              {member.departureCity && (
                <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="size-3" />
                  {member.departureCity}
                </p>
              )}
            </div>
            <p className="shrink-0 text-xs text-muted-foreground">
              {member.participationStart && member.participationEnd
                ? formatDateRange(member.participationStart, member.participationEnd, "short")
                : "No dates yet"}
            </p>
          </div>
        ))}
      </div>

      {pendingInvites.length > 0 && (
        <div className="mt-6 border-t border-border pt-4">
          <p className="mb-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Invited · not joined yet
          </p>
          <div className="flex flex-col gap-2">
            {pendingInvites.map((invite) => (
              <div
                key={invite.id}
                className="flex items-center gap-3 rounded-xl border border-dashed border-border px-3.5 py-3"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-muted text-sm font-medium text-muted-foreground">
                  {invite.inviteeName.slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{invite.inviteeName}</p>
                  {invite.contact && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <Mail className="size-3" />
                      {invite.contact}
                    </p>
                  )}
                </div>
                <CopyInviteLink token={invite.token} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
