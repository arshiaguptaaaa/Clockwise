import { prisma } from "@/lib/prisma";
import { adminLogout } from "@/app/admin/admin-actions";

const SOURCE_LABELS: Record<string, string> = {
  instagram: "Instagram",
  linkedin: "LinkedIn",
  community: "Community",
};

function labelFor(source: string | null): string {
  if (!source) return "Direct";
  return SOURCE_LABELS[source.toLowerCase()] ?? source;
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return "—";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

export default async function AdminWaitlistPage() {
  const [totalSignups, landingPageViews, landingVisitors, signups, allSignupsBySource] =
    await Promise.all([
      prisma.waitlistSignup.count(),
      prisma.pageView.count({ where: { page: "landing_view" } }),
      prisma.pageView.groupBy({ by: ["visitorId"], where: { page: "landing_view" } }),
      prisma.waitlistSignup.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
      prisma.waitlistSignup.groupBy({ by: ["source"], _count: { _all: true } }),
    ]);

  const uniqueVisitorCount = landingVisitors.length;
  const overallConversion = pct(totalSignups, uniqueVisitorCount);

  // Unique visitors AND signups per source, so each row's conversion is
  // real (visitor-to-signup for that specific channel), not just a share
  // of total signups.
  const visitorsBySource = await prisma.pageView.groupBy({
    by: ["source"],
    where: { page: "landing_view" },
    _count: { _all: true },
  });
  const visitorGroups = await Promise.all(
    visitorsBySource.map((row) =>
      prisma.pageView
        .groupBy({ by: ["visitorId"], where: { page: "landing_view", source: row.source } })
        .then((rows) => ({ source: row.source, uniqueVisitors: rows.length }))
    )
  );
  const visitorCountBySource = new Map(visitorGroups.map((v) => [v.source, v.uniqueVisitors]));
  const signupCountBySource = new Map(allSignupsBySource.map((s) => [s.source, s._count._all]));

  const allSourceKeys = new Set<string | null>([
    ...visitorCountBySource.keys(),
    ...signupCountBySource.keys(),
  ]);

  const sourceRows = [...allSourceKeys]
    .map((source) => {
      const visitors = visitorCountBySource.get(source) ?? 0;
      const signupCount = signupCountBySource.get(source) ?? 0;
      return { source, visitors, signupCount, conversion: pct(signupCount, visitors) };
    })
    .sort((a, b) => b.signupCount - a.signupCount);

  return (
    <main className="min-h-screen bg-page px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              CLOCKWISE — EARLY ACCESS
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/admin/waitlist/export"
              className="rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-accent hover:text-accent"
            >
              Export CSV
            </a>
            <form action={adminLogout}>
              <button
                type="submit"
                className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Total signups", value: totalSignups },
            { label: "Unique visitors", value: uniqueVisitorCount },
            { label: "Page views", value: landingPageViews },
            { label: "Visitor → signup", value: overallConversion },
          ].map((stat) => (
            <div key={stat.label} className="rounded-2xl border border-border bg-surface p-4">
              <p className="text-2xl font-medium text-foreground">{stat.value}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>

        <div className="mt-8">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Source breakdown
          </p>
          <div className="mt-2 overflow-hidden rounded-2xl border border-border bg-surface">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Source</th>
                  <th className="px-4 py-2.5 font-medium">Unique visitors</th>
                  <th className="px-4 py-2.5 font-medium">Signups</th>
                  <th className="px-4 py-2.5 font-medium">Conversion</th>
                </tr>
              </thead>
              <tbody>
                {sourceRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-4 text-center text-muted-foreground">
                      No traffic recorded yet.
                    </td>
                  </tr>
                )}
                {sourceRows.map((row) => (
                  <tr key={row.source ?? "direct"} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2.5 font-medium text-foreground">{labelFor(row.source)}</td>
                    <td className="px-4 py-2.5 text-foreground">{row.visitors}</td>
                    <td className="px-4 py-2.5 text-foreground">{row.signupCount}</td>
                    <td className="px-4 py-2.5 text-foreground">{row.conversion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-8">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Recent signups
          </p>
          <div className="mt-2 overflow-hidden rounded-2xl border border-border bg-surface">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Email</th>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Time</th>
                  <th className="px-4 py-2.5 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {signups.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-4 text-center text-muted-foreground">
                      No signups yet.
                    </td>
                  </tr>
                )}
                {signups.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2.5 text-foreground">{s.email}</td>
                    <td className="px-4 py-2.5 text-foreground">
                      {s.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-4 py-2.5 text-foreground">
                      {s.createdAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-4 py-2.5 text-foreground">{labelFor(s.source)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
