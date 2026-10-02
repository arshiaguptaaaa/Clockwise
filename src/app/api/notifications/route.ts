import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { isPushConfigured } from "@/lib/notifications";

// The bell's data source. Always scoped to the signed-in user — a notification
// row is never readable by anyone but its recipient.
export async function GET(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const tripId = request.nextUrl.searchParams.get("tripId");

  const where = { userId, ...(tripId ? { tripId } : {}) };
  const [items, unread, subscribed] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, severity: true, kind: true, title: true, body: true, href: true, readAt: true, createdAt: true },
    }),
    prisma.notification.count({ where: { ...where, readAt: null } }),
    prisma.pushSubscription.count({ where: { userId } }),
  ]);
  return NextResponse.json({
    items,
    unread,
    push: { configured: isPushConfigured(), publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null, subscribed: subscribed > 0 },
  });
}

// Body: { action: "read", id } | { action: "readAll", tripId? }
export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { action?: string; id?: string; tripId?: string };
  const now = new Date();
  if (body.action === "read" && body.id) {
    await prisma.notification.updateMany({ where: { id: body.id, userId, readAt: null }, data: { readAt: now } });
  } else if (body.action === "readAll") {
    await prisma.notification.updateMany({ where: { userId, readAt: null, ...(body.tripId ? { tripId: body.tripId } : {}) }, data: { readAt: now } });
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
