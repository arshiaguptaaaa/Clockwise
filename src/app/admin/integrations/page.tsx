import { IntegrationStatusTable } from "@/components/admin/IntegrationStatusTable";

export default function AdminIntegrationsPage() {
  return (
    <main className="min-h-screen bg-page px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          CLOCKWISE — INTEGRATION STATUS
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
        </p>

        <div className="mt-6">
          <IntegrationStatusTable />
        </div>
      </div>
    </main>
  );
}
