import { prisma } from "@/lib/prisma";
import { getUberConnection } from "@/lib/uber/connection";
import { getMissingUberEnvVars } from "@/lib/uber/oauth";
import { disconnectUber } from "@/app/integration-actions";

function maskEmail(email: string | null) {
  if (!email) return "your Uber account";
  const [name, domain] = email.split("@");
  if (!domain) return email;
  return `${name.slice(0, 2)}***@${domain}`;
}

// Only the trip organiser's Uber connection is ever used to request rides
// (see approved architecture: one authorised requester/payer per plan) —
// so this always shows the ORGANISER's connection state, not the current
// viewer's own, and only the organiser gets connect/disconnect controls.
// Anyone else sees an accurate read-only status instead of a button that
// would silently do nothing for the transport flow.
export async function ConnectedServices({ tripId, viewerId }: { tripId: string; viewerId: string }) {
  const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
  const isOrganiser = viewerId === trip.createdBy;

  const [connection, organiser] = await Promise.all([
    getUberConnection(trip.createdBy),
    prisma.user.findUniqueOrThrow({ where: { id: trip.createdBy } }),
  ]);
  const connected = Boolean(connection && !connection.revokedAt);
  const missingVars = isOrganiser && !connected ? getMissingUberEnvVars() : [];

  return (
    <div className="shrink-0 border-b border-border px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Connected services
      </p>
      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Uber</p>
          {connected ? (
            <p className="truncate text-xs text-muted-foreground">
              ✓ Connected as {connection!.providerName || maskEmail(connection!.providerEmail)}
            </p>
          ) : isOrganiser ? (
            <p className="text-xs text-muted-foreground">
              Connect your Uber account to let Clockwise prepare and request rides after your approval.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Not connected — only {organiser.name} (trip organiser) can connect Uber.
            </p>
          )}
        </div>
        {isOrganiser && missingVars.length === 0 && (
          <>
            {connected ? (
              <form action={disconnectUber.bind(null, tripId)}>
                <button
                  type="submit"
                  className="shrink-0 cursor-pointer rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-danger hover:text-danger"
                >
                  Disconnect
                </button>
              </form>
            ) : (
              <a
                href={`/api/integrations/uber/connect?tripId=${tripId}`}
                className="shrink-0 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground transition-opacity hover:opacity-90"
              >
                Connect Uber
              </a>
            )}
          </>
        )}
      </div>

      {missingVars.length > 0 && (
        <div className="mt-2 rounded-lg border border-warning-tint bg-warning-tint px-3 py-2 text-xs">
          <p className="font-medium text-warning">Uber integration needs setup.</p>
          <p className="mt-1 text-muted-foreground">Missing:</p>
          <ul className="mt-0.5 list-inside list-disc text-muted-foreground">
            {missingVars.map((name) => (
              <li key={name} className="font-mono">
                {name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
