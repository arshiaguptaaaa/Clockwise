import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { loadRailEvidence } from "@/lib/rails/view";
import { CopyJson } from "@/components/trace/CopyJson";

export const dynamic = "force-dynamic";

// DEVELOPER EVIDENCE — organiser only. Exact partner requests/responses after
// redaction, for the Ken Round 3 submission. Never linked from group chat.
export default async function RailEvidencePage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const userId = await getCurrentUserId();
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { createdBy: true, name: true } });
  if (!userId || !trip || trip.createdBy !== userId) {
    return <p className="px-5 py-10 text-sm text-muted-foreground">Rail evidence is visible to the trip organiser only.</p>;
  }
  const calls = await loadRailEvidence(tripId);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5" data-rail-evidence>
      <Link href={`/trips/${tripId}/agent/trace`} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Back to Agent Trace
      </Link>
      <h1 className="mt-3 font-display text-2xl">DEVELOPER EVIDENCE · RAIL CALLS</h1>
      <p className="mt-1 text-xs text-muted-foreground">
        Organiser only. Sanitised: API keys, Authorization headers, client secrets, access tokens and cookies are redacted; emails and phone numbers are masked. Gnani transcripts appear here exactly as returned.
      </p>
      <div className="mt-2 flex gap-2">
        <CopyJson value={calls} label="Copy all as JSON" />
        <a href={`/api/trips/${tripId}/rail-evidence`} className="rounded-full border border-border px-3 py-1 text-[11px] font-semibold" target="_blank" rel="noopener noreferrer">
          Open JSON
        </a>
      </div>
      {calls.length === 0 && <p className="mt-6 text-sm text-muted-foreground">No Gnani or Pine Labs calls recorded for this trip yet.</p>}
      <ol className="mt-4 space-y-3">
        {calls.map((c, i) => (
          <li key={c.id} className="rounded-xl border border-border p-3" data-rail-call={c.partner}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-accent px-2 py-0.5 font-semibold text-accent-foreground">{c.partner}</span>
              <span className="font-semibold">#{i + 1} {c.operation}</span>
              <span className="text-muted-foreground">{c.method} · HTTP {c.httpStatus ?? "—"} · {c.durationMs ?? "?"} ms · {c.at.replace("T", " ").slice(0, 19)} UTC</span>
            </div>
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
