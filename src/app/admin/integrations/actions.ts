"use server";

import { checkAllIntegrations, type IntegrationStatus } from "@/lib/integration-status";

export async function runIntegrationChecks(): Promise<IntegrationStatus[]> {
  return checkAllIntegrations();
}
