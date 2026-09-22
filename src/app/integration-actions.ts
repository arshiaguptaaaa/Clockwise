"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/session";
import { revokeUberConnection } from "@/lib/uber/connection";

export async function disconnectUber(tripId: string) {
  const userId = await getCurrentUserId();
  if (!userId) return;
  await revokeUberConnection(userId);
  revalidatePath(`/trips/${tripId}/agent`);
}
