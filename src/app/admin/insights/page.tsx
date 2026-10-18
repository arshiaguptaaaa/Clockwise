import { redirect } from "next/navigation";
import { getInsights, abVerdict } from "@/lib/insights";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { adminLogout } from "@/app/admin/admin-actions";

export const dynamic = "force-dynamic";

const pct = (n: number | null) => (n === null ? "—" : `${(n * 100).toFixed(0)}%`);

export default async function AdminInsightsPage() {
  // Guard inside the page too: a layout redirect does not stop this page from rendering in parallel, and its data
  // would still be streamed in the body of the redirect response. Check before any query runs.
  if (!(await isAdminAuthenticated())) redirect("/admin/login");
  const d = await getInsights(30);
  const max = Math.max(1, ...d.funnel.map((s) => s.count));
  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] leading-tight">Insights</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">Last {d.days} days · {d.activeUsers} active {d.activeUsers === 1 ? "traveller" : "travellers"} · counts come from real events on this deployment</p>
        </div>
        <form action={adminLogout}><button type="submit" className="btn btn-ghost">Log out</button></form>
      </div>

      <section className="mt-8" data-insights-funnel>
        <h2 className="eyebrow">Disruption loop</h2>
        <p className="mt-1 text-[12.5px] text-muted-foreground">Counted per clash: noticed → proposed → voted → plan updated.</p>
        <ol className="mt-3 flex flex-col gap-2">
          {d.funnel.map((s) => (
            <li key={s.key} className="rounded-xl border border-border px-3 py-2.5">
              <div className="flex items-baseline justify-between text-[14px]">
                <span className="font-medium">{s.label}</span>
                <span><span className="font-semibold">{s.count}</span>{s.fromPrev !== null && <span className="ml-2 text-[12px] text-muted-foreground">{pct(s.fromPrev)} of previous</span>}</span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-surface-muted"><div className="h-1.5 rounded-full bg-accent" style={{ width: `${(s.count / max) * 100}%` }} /></div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-8" data-insights-ab>
        <h2 className="eyebrow">A/B test · clash card button wording</h2>
        <p className="mt-1 text-[12.5px] text-muted-foreground">control: “Propose 8:30 PM” · direct: “Yes, propose 8:30 PM to the group”. Variant is a stable hash of the traveller, so nobody flips between versions.</p>
        <table className="mt-3 w-full text-left text-[13.5px]">
          <thead className="text-[11.5px] uppercase tracking-wider text-muted-foreground"><tr><th className="py-1">Variant</th><th>Saw it</th><th>Proposed</th><th>Rate</th></tr></thead>
          <tbody>
            {d.ab.length === 0 && <tr><td colSpan={4} className="py-2 text-muted-foreground">No exposures yet.</td></tr>}
            {d.ab.map((r) => (<tr key={r.variant} className="border-t border-border"><td className="py-1.5 font-medium">{r.variant}</td><td>{r.exposed}</td><td>{r.converted}</td><td>{pct(r.rate)}</td></tr>))}
          </tbody>
        </table>
        <p className="mt-2 text-[12.5px]" data-ab-verdict>{abVerdict(d.ab)}</p>
      </section>

      <section className="mt-8" data-insights-errors>
        <h2 className="eyebrow">Errors</h2>
        <p className="mt-2 text-[14px]">
          <span className="font-semibold">{d.errorTotal}</span> logged ({d.errorsBySource.CLIENT ?? 0} in the browser, {d.errorsBySource.SERVER ?? 0} on the server)
          {d.errorsPer100 !== null && <> · <span className="font-semibold">{d.errorsPer100.toFixed(1)}</span> per 100 active travellers</>}
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">This is errors per active traveller, not a crash-free-sessions rate: Clockwise doesn’t record sessions.</p>
        {d.topErrors.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 text-[13px]">
            {d.topErrors.map((e) => (<li key={e.message} className="flex justify-between gap-3 border-t border-border py-1"><span className="min-w-0 truncate">{e.message}</span><span className="font-semibold">{e.count}</span></li>))}
          </ul>
        )}
      </section>

      <section className="mt-8" data-insights-pwa>
        <h2 className="eyebrow">Install (Android / desktop Chrome)</h2>
        <p className="mt-2 text-[14px]">Offered {d.pwa.prompted} · accepted {d.pwa.accepted} · installed {d.pwa.installed}</p>
      </section>

      <section className="mt-8" data-insights-feedback>
        <h2 className="eyebrow">Feedback</h2>
        <p className="mt-2 text-[14px]">{d.feedback.count} {d.feedback.count === 1 ? "response" : "responses"}{d.feedback.avg !== null && <> · average rating <span className="font-semibold">{d.feedback.avg.toFixed(1)}</span> / 5</>}</p>
        <ul className="mt-2 flex flex-col gap-2">
          {d.feedback.recent.filter((f) => f.message).map((f) => (<li key={f.id} className="rounded-xl border border-border px-3 py-2 text-[13.5px]">{f.rating ? <span className="mr-2 font-semibold">{f.rating}/5</span> : null}{f.message}</li>))}
        </ul>
      </section>
    </main>
  );
}
