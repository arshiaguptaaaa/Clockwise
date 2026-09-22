import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";

// Server-side guard — /admin/login itself is a sibling route outside this
// layout, so there's no redirect loop to reason about.
export default async function AdminWaitlistLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdminAuthenticated())) {
    redirect("/admin/login");
  }
  return <>{children}</>;
}
