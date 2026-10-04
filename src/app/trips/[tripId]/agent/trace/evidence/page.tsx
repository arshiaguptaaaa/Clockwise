import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { loadRailEvidence } from "@/lib/rails/view";
import { CopyJson } from "@/components/trace/CopyJson";

export const dynamic = "force-dynamic";

// DEVELOPER EVIDENCE — organiser only. Exact partner requests/responses after
// redaction, for the Ken Round 3 submission. Never linked from group chat.
export default async function RailEvidencePage({ params, searchParams }: { params: Promise<{ tripId: string }>; searchParams: Promise<{ partner?: string }> }) {
  const { tripId } = await params;
  const { partner } = await searchParams;
  const userId = await getCurrentUserId();
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { createdBy: true, name: true } });
  if (!userId || !trip || trip.createdBy !== userId) {
    return <p className="px-5 py-10 text-sm text-muted-foreground">Rail evidence is visible to the trip organiser only.</p>;
  }
  const all = await loadRailEvidence(tripId);
  const partners = [...new Set(all.map((c) => c.partner))];
  const calls = partner ? all.filter((c) => c.partner === partner.toUpperCase()) : all;
  // Plain-language key numbers for routing calls, read from the exact response shown below (never invented).
  const keyFacts = (c: (typeof all)[number]) => {
    const r = c.response as { recommended_route?: { distance?: number; duration?: number } } | null;
    const req = c.request as { traffic_aware?: boolean; departure_time?: string } | null;
    if (c.partner === "DELHIVERY" && c.operation === "maps.route" && r?.recommended_route?.distance != null && r.recommended_route.duration != null) {
      return `${r.recommended_route.distance} km · ${Math.round(r.recommended_route.duration / 60)} min · ${req?.traffic_aware ? `traffic-aware estimate for a ${req.departure_time?.slice(11) ?? "?"} departure` : "no traffic model"}`;
    }
    if (c.partner === "GEOAPIFY") {
      const g = c.response as { distance_m?: number; duration_s?: number } | null;
      if (g?.distance_m != null && g.duration_s != null) return `${(g.distance_m / 1000).toFixed(1)} km · ${Math.round(g.duration_s / 60)} min · free-flow driving route`;
    }
    if (c.partner === "DELHIVERY" && (c.response as { sent?: boolean } | null)?.sent === false) return "Not sent: Delhivery is cooling down after an earlier real HTTP 429";
    return null;
  };
  // What each row IS, in one word, so a skipped call or a fallback can never be mistaken for a fresh success.
  const stamp = (c: (typeof all)[number]) => {
    const note = c.decisionNote ?? "";
    if ((c.response as { sent?: boolean } | null)?.sent === false) return { text: "NOT SENT · COOL-DOWN", tone: "bg-danger-tint text-danger" };
    if (c.httpStatus === 429) return { text: "HTTP 429 · RATE LIMITED", tone: "bg-danger-tint text-danger" };
    if (c.partner === "GEOAPIFY" && /FAILED/.test(note)) return { text: "FAILED", tone: "bg-danger-tint text-danger" };
    if (c.partner === "GEOAPIFY" && /FALLBACK/.test(note)) return { text: "FALLBACK", tone: "bg-tint-honey text-foreground" };
    if (/SERVED FROM SAVED REAL RESPONSE/.test(note)) return { text: "SAVED REAL RESPONSE", tone: "bg-surface-muted text-foreground" };
    if (c.httpStatus != null && c.httpStatus >= 400) return { text: `HTTP ${c.httpStatus} · FAILED`, tone: "bg-danger-tint text-danger" };
    return null;
  };
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-12 pt-6" data-rail-evidence>
      <Link href={`/trips/${tripId}/agent/trace`} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Agent trace
      </Link>
      <p className="eyebrow mt-6">Developer evidence · Rail calls</p>
      <h1 className="headline headline-xl mt-2">What the partners actually said.</h1>
      <p className="lede mt-2">
        Organiser only. Sanitised: API keys, Authorization headers, client secrets, access tokens and cookies are redacted; emails and phone numbers are masked. Gnani transcripts appear here exactly as returned.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link href={`/trips/${tripId}/agent/trace/evidence`} className={`rounded-full border px-3.5 py-1.5 text-[11px] font-semibold tracking-wide ${!partner ? "border-accent bg-accent text-accent-foreground" : "border-border text-muted-foreground"}`}>
          All
        </Link>
        {partners.map((p) => (
          <Link key={p} href={`/trips/${tripId}/agent/trace/evidence?partner=${p}`} className={`rounded-full border px-3.5 py-1.5 text-[11px] font-semibold tracking-wide ${partner?.toUpperCase() === p ? "border-accent bg-accent text-accent-foreground" : "border-border text-muted-foreground"}`}>
            {p}
          </Link>
        ))}
        <CopyJson value={calls} label="Copy all as JSON" />
        <a href={`/api/trips/${tripId}/rail-evidence`} className="rounded-full border border-border px-3 py-1 text-[11px] font-semibold" target="_blank" rel="noopener noreferrer">
          Open JSON
        </a>
      </div>
      {calls.length === 0 && <p className="mt-6 text-sm text-muted-foreground">No Gnani, Delhivery, Geoapify or Pine Labs calls recorded for this trip yet.</p>}
      <ol className="row-rule mt-4">
        {calls.map((c, i) => (
          <li key={c.id} className="py-5" data-rail-call={c.partner}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-accent px-2 py-0.5 font-semibold text-accent-foreground">{c.partner}</span>
              {stamp(c) && <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-[0.1em] ${stamp(c)!.tone}`} data-rail-stamp>{stamp(c)!.text}</span>}
              <span className="font-semibold">#{i + 1} {c.operation}</span>
              <span className="text-muted-foreground">{c.method} · HTTP {c.httpStatus ?? "—"} · {c.durationMs ?? "?"} ms · {c.at.replace("T", " ").slice(0, 19)} UTC</span>
            </div>
            {keyFacts(c) && <p className="mt-2 font-display text-[20px] leading-snug tracking-[-0.01em]">{keyFacts(c)}</p>}
            <p className="mt-1 break-all font-mono text-[11px]">{c.endpoint}</p>
            {c.providerRequestId && <p className="text-[11px] text-muted-foreground">Provider/request id: {c.providerRequestId}</p>}
            {c.decisionNote && <p className="mt-1 text-xs">Decision: {c.decisionNote}</p>}
            {c.related && <p className="text-xs text-muted-foreground">Related: {c.related}</p>}
            {c.decisions.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Led to: {c.decisions.map((d) => d.kind + (d.note ? ` (${d.note})` : "")).join(" → ")}
              </p>
            )}
            <details className="mt-2" open>
              <summary className="cursor-pointer text-xs font-semibold">Request</summary>
              <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-surface-muted p-2 text-[11px]">{JSON.stringify(c.request, null, 2)}</pre>
            </details>
            <details className="mt-1" open>
              <summary className="cursor-pointer text-xs font-semibold">Response</summary>
              <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-surface-muted p-2 text-[11px]">{JSON.stringify(c.response, null, 2)}</pre>
            </details>
            <div className="mt-2">
              <CopyJson value={c} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
