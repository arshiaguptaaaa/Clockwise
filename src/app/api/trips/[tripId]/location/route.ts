import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { recomputeTravellerReadiness } from "@/lib/readiness-engine";

// Live-location consent and fixes. Called only after the traveller taps
// "Share live location" in the CLOCKWISE LIVE card — nothing requests the
// browser's geolocation on page load. The response never echoes coordinates
// back, and no other route reads them: they exist for deterministic
// travel-time maths in readiness-engine.ts and nothing else.
//
// Body: { action: "start" | "decline" | "stop" }
//    or { action: "fix", latitude, longitude, accuracy? }
export async function POST(request: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const member = await prisma.tripMember.findUnique({ where: { tripId_userId: { tripId, userId } } });
  if (!member) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: { action?: string; latitude?: unknown; longitude?: unknown; accuracy?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const key = { tripId_userId: { tripId, userId } };

  if (body.action === "decline" || body.action === "stop") {
    const consent = body.action === "decline" ? "DECLINED" : "STOPPED";
    await prisma.travellerLocation.upsert({
      where: key,
      create: { tripId, userId, consent },
      // Withdrawing consent deletes the stored position, not just hides it.
      update: { consent, latitude: null, longitude: null, accuracyMeters: null, recordedAt: null },
    });
    await recomputeTravellerReadiness(tripId, userId, { sourceChannel: "LOCATION" });
    return NextResponse.json({ ok: true, consent });
  }

  if (body.action === "start") {
    await prisma.travellerLocation.upsert({
      where: key,
      create: { tripId, userId, consent: "SHARING", consentedAt: new Date() },
      update: { consent: "SHARING", consentedAt: new Date() },
    });
    return NextResponse.json({ ok: true, consent: "SHARING" });
  }

  if (body.action === "fix") {
    const lat = Number(body.latitude);
    const lng = Number(body.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
    }
    const existing = await prisma.travellerLocation.findUnique({ where: key });
    // A fix is only accepted while consent is active — a late request from
    // a tab that was told to stop must not resurrect tracking.
    if (existing?.consent !== "SHARING") {
      return NextResponse.json({ error: "Location sharing is off" }, { status: 409 });
    }
    const accuracy = Number(body.accuracy);
    await prisma.travellerLocation.update({
      where: key,
      data: {
        latitude: lat,
        longitude: lng,
        accuracyMeters: Number.isFinite(accuracy) ? accuracy : null,
        recordedAt: new Date(),
      },
    });
    const readiness = await recomputeTravellerReadiness(tripId, userId, { sourceChannel: "LOCATION" });
    return NextResponse.json({
      ok: true,
      readiness: readiness.map((r) => ({ commitment: r.commitmentName, status: r.status, bufferMinutes: r.bufferMinutes })),
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
