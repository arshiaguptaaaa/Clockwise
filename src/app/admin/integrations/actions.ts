"use server";

import { checkAllIntegrations, type IntegrationStatus } from "@/lib/integration-status";
import { isAdminAuthenticated } from "@/lib/admin-auth";

// A layout guard does not protect a server action (it can be POSTed to directly), so the action checks for itself.
// It makes live calls to the providers with production keys, so it must never run for an unauthenticated caller.
export async function runIntegrationChecks(): Promise<IntegrationStatus[]> {
  if (!(await isAdminAuthenticated())) return [];
  return checkAllIntegrations();
}
