import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";

// Registers (or removes) this browser's Web Push subscription for the
// signed-in user. Called only after the traveller says yes to the contextual
// "Get important trip alerts…" prompt and the browser grants permission.
export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  };
  const sub = body.subscription;
  if (!sub?.endpoint) return NextResponse.json({ error: "Missing subscription" }, { status: 400 });

  if (body.action === "unsubscribe") {
    await prisma.pushSubscription.deleteMany({ where: { endpoint: sub.endpoint, userId } });
    return NextResponse.json({ ok: true });
  }
  if (!sub.keys?.p256dh || !sub.keys?.auth) return NextResponse.json({ error: "Missing keys" }, { status: 400 });

  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: {
      userId,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent: request.headers.get("user-agent")?.slice(0, 200) ?? null,
    },
    // A browser re-subscribing after the user switched traveller re-binds
    // the endpoint to whoever is signed in now.
    update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  });
  return NextResponse.json({ ok: true });
}
