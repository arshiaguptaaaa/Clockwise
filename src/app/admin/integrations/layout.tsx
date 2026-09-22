import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";

// Same guard pattern as /admin/waitlist — a separate layout (not a shared
// /admin/layout.tsx) so /admin/login stays outside it with no redirect loop.
export default async function AdminIntegrationsLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdminAuthenticated())) {
    redirect("/admin/login");
  }
  return <>{children}</>;
}
