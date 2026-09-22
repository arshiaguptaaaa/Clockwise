import { prisma } from "@/lib/prisma";
import { acceptInvite } from "@/app/invite-actions";
import { formatDateRange } from "@/lib/format";
import { ClockwiseWordmark } from "@/components/ClockwiseWordmark";
import { MapPin, Users, ArrowRight } from "lucide-react";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await prisma.invite.findUnique({ where: { token } });

  if (!invite) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-page px-6 text-center">
        <ClockwiseWordmark className="justify-center" />
        <p className="mt-6 text-lg font-medium text-foreground">This invite isn&apos;t valid</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The link may have expired or been mistyped.
        </p>
      </main>
    );
  }

  const [trip, inviter] = await Promise.all([
    prisma.trip.findUniqueOrThrow({
      where: { id: invite.tripId },
      include: { destinations: { orderBy: { order: "asc" } }, members: true },
    }),
    prisma.user.findUnique({ where: { id: invite.invitedBy } }),
  ]);

  const destinationNames = trip.destinations.map((d) => d.name);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-page px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="text-center">
          <ClockwiseWordmark className="justify-center" />
        </div>

        <div className="mt-8 rounded-2xl border border-border bg-surface p-6 shadow-sm">
          <p className="text-sm text-muted-foreground">
            {inviter?.name ?? "Someone"} invited you to:
          </p>
          <p className="mt-1 font-serif text-2xl font-medium text-foreground">{trip.name}</p>

          {destinationNames.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {destinationNames.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1 text-xs text-foreground"
                >
                  <MapPin className="size-3" />
                  {name}
                </span>
              ))}
            </div>
          )}

          <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
            {trip.coreStartDate && trip.coreEndDate ? (
              <span>{formatDateRange(trip.coreStartDate, trip.coreEndDate)}</span>
            ) : (
              <span>Dates not decided yet</span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Users className="size-3.5" />
              {trip.members.length} {trip.members.length === 1 ? "friend is" : "friends are"} already here
            </span>
          </div>

          <form action={acceptInvite.bind(null, token)}>
            <button
              type="submit"
              className="mt-5 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-strong"
            >
              Join Trip <ArrowRight className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
