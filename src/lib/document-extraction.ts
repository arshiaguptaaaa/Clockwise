// Private document -> itinerary facts -> personal state -> group-safe limit.
//
// What is extracted is deliberately narrow: the KIND of document and its
// journey facts (carrier, origin, destination, departure/arrival time). The
// extraction prompt never asks for — so the system never holds — passenger
// names, PNRs, ticket numbers, seats, fares or payment details. Derived
// facts live on a PERSONAL TripEvent visible only to the uploader, and the
// one thing that can reach the group is the neutral "X is unavailable after
// HH:MM" line produced by the existing constraint machinery, built from the
// structured limit alone (see personal-state.ts groupSafeLine).
//
// The extraction itself is a model read of the document, so it is reported
// to the uploader in their private room to confirm or correct — it is never
// presented as fact to anyone else.
import { GoogleGenAI } from "@google/genai";
import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { getClockwiseUserId } from "./clockwise";
import { createPendingJourney, postJourneyConfirmCard, type JourneyMode } from "./traveller/journey";


type Facts = {
  documentKind: "FLIGHT" | "TRAIN" | "BUS" | "HOTEL" | "OTHER";
  carrier: string | null;
  origin: string | null;
  destination: string | null;
  departureLocal: string | null; // YYYY-MM-DDTHH:mm, as printed (no timezone conversion)
  arrivalLocal: string | null;
};

const PROMPT = `Read this travel document and return JSON with EXACTLY these keys and nothing else:
{"documentKind":"FLIGHT"|"TRAIN"|"BUS"|"HOTEL"|"OTHER","carrier":string|null,"origin":string|null,"destination":string|null,"departureLocal":"YYYY-MM-DDTHH:mm"|null,"arrivalLocal":"YYYY-MM-DDTHH:mm"|null}
Use local times exactly as printed (do not convert time zones). Use null for anything not clearly stated. Do NOT output passenger names, booking references, PNRs, ticket numbers, seats, prices, or any other field.`;

export function parseFacts(raw: string): Facts | null {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const kind = ["FLIGHT", "TRAIN", "BUS", "HOTEL", "OTHER"].includes(String(o.documentKind)) ? (o.documentKind as Facts["documentKind"]) : "OTHER";
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : null);
    const dt = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? v : null);
    return { documentKind: kind, carrier: str(o.carrier), origin: str(o.origin), destination: str(o.destination), departureLocal: dt(o.departureLocal), arrivalLocal: dt(o.arrivalLocal) };
  } catch {
    return null;
  }
}

// departure minus lead time, as a wall-clock date + HH:MM (no timezone maths:
// the document's own local time is the frame of reference).
export function latestArrivalFor(departureLocal: string, leadMinutes: number): { date: string; hhmm: string } {
  const [d, t] = departureLocal.split("T");
  const base = new Date(`${d}T${t}:00.000Z`);
  const at = new Date(base.getTime() - leadMinutes * 60_000);
  return { date: at.toISOString().slice(0, 10), hhmm: at.toISOString().slice(11, 16) };
}

async function privateNote(tripId: string, userId: string, content: string) {
  await prisma.message.create({
    data: { tripId, senderId: await getClockwiseUserId(), channel: "PRIVATE", recipientId: userId, content },
  });
  revalidatePath(`/trips/${tripId}/agent`);
}

export async function extractFromAttachment(attachmentId: string) {
  const att = await prisma.attachment.findUnique({ where: { id: attachmentId } });
  if (!att || att.channel !== "PRIVATE" || !att.content) return;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return;
  if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(att.mimeType)) return;

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-flash-lite-latest",
    config: { responseMimeType: "application/json" },
    contents: [{ role: "user", parts: [{ text: PROMPT }, { inlineData: { mimeType: att.mimeType, data: Buffer.from(att.content).toString("base64") } }] }],
  });
  const facts = parseFacts(response.text ?? "");
  const userId = att.uploaderId;

  await prisma.tripEvent.create({
    data: {
      tripId: att.tripId,
      kind: "DOCUMENT_EXTRACTED",
      scope: "PERSONAL",
      actorUserId: userId,
      subjectUserId: userId,
      sourceChannel: "DOCUMENT",
      confidence: facts?.departureLocal ? "MEDIUM" : "LOW",
      // Structured journey facts only (never identifiers) — and PERSONAL, so
      // only the uploader's trace/agent can read it.
      payload: JSON.stringify({ attachmentId: att.id, facts }),
      propagation: JSON.stringify(["personal-state"]),
    },
  });

  if (!facts || facts.documentKind === "OTHER" || !facts.departureLocal) {
    await privateNote(att.tripId, userId, `I received ${att.filename} and kept it private, but couldn't read a clear journey from it, so I haven't changed anything. If it's a ticket, tell me the departure time and I'll note it.`);
    return;
  }

  // A readable journey becomes a PENDING journey and a private confirm card. NOTHING
  // is saved as canonical, no availability limit is set, and the group is told
  // nothing until the traveller confirms (see traveller/journey.ts confirmJourney).
  if (facts.documentKind === "HOTEL") {
    await privateNote(att.tripId, userId, `I read this as a stay booking and kept it private. I haven't changed anything.`);
    return;
  }
  const journey = await createPendingJourney(att.tripId, userId, {
    mode: facts.documentKind as JourneyMode,
    carrier: facts.carrier,
    originName: facts.origin,
    destinationName: facts.destination,
    departLocal: facts.departureLocal,
    arriveLocal: facts.arrivalLocal,
  }, "TICKET", att.id);
  await postJourneyConfirmCard(journey.id);
  revalidatePath(`/trips/${att.tripId}/agent`);
  revalidatePath(`/trips/${att.tripId}/agent/journey`);
}
