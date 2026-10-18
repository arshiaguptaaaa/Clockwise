import { redirect } from "next/navigation";
import { IntegrationStatusTable } from "@/components/admin/IntegrationStatusTable";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export default async function AdminIntegrationsPage() {
  // Guard inside the page too: a layout redirect does not stop this page from rendering in parallel, and its data
  // would still be streamed in the body of the redirect response. Check before any query runs.
  if (!(await isAdminAuthenticated())) redirect("/admin/login");
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
