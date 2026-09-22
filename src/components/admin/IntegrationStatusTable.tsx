"use client";

import { useState, useTransition } from "react";
import { runIntegrationChecks } from "@/app/admin/integrations/actions";
import type { IntegrationStatus } from "@/lib/integration-status";

const PROVIDER_NAMES = ["Gemini", "Open-Meteo Weather", "Geoapify", "Resend", "Uber", "Gnani"];

const STATUS_STYLE: Record<string, string> = {
  LIVE: "bg-success-tint text-success",
  NOT_CONFIGURED: "bg-surface-muted text-muted-foreground",
  DEMO_MODE: "bg-warning-tint text-warning",
  ERROR: "bg-danger-tint text-danger",
  UNCHECKED: "bg-surface-muted text-muted-foreground",
};

export function IntegrationStatusTable() {
  const [results, setResults] = useState<IntegrationStatus[] | null>(null);
  const [isPending, startTransition] = useTransition();

  function runChecks() {
    startTransition(async () => {
      const res = await runIntegrationChecks();
      setResults(res);
    });
  }

  const rows = results ?? PROVIDER_NAMES.map((name) => ({ name, status: "UNCHECKED" as const, detail: "Not checked yet this session.", checkedAt: "" }));

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {results
            ? `Last checked ${new Date(results[0].checkedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} — each row is a real request to that provider, not an env-var presence check.`
            : "Each check makes a real, read-only request to the provider (no emails sent, no rides/calls placed). Nothing is checked until you press the button."}
        </p>
        <button
          type="button"
          onClick={runChecks}
          disabled={isPending}
          className="shrink-0 cursor-pointer rounded-full bg-accent px-4 py-2 text-xs font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Checking…" : "Run checks"}
        </button>
      </div>

      <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-surface">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Provider</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} className="border-b border-border last:border-b-0">
                <td className="px-4 py-3 font-medium text-foreground">{row.name}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[row.status]}`}>
                    {row.status.replace("_", " ")}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{row.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
