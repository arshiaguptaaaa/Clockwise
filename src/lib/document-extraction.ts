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
import { recordPersonalConstraint, formatTime12 } from "./personal-state";

// Stated assumption, shown to the user: how early they must be at the
// departure point. Not read from the ticket.
const LEAD_MINUTES: Record<string, number> = { FLIGHT: 180, TRAIN: 45 };

type Facts = {
  documentKind: "FLIGHT" | "TRAIN" | "HOTEL" | "OTHER";
  carrier: string | null;
  origin: string | null;
  destination: string | null;
  departureLocal: string | null; // YYYY-MM-DDTHH:mm, as printed (no timezone conversion)
  arrivalLocal: string | null;
};

const PROMPT = `Read this travel document and return JSON with EXACTLY these keys and nothing else:
{"documentKind":"FLIGHT"|"TRAIN"|"HOTEL"|"OTHER","carrier":string|null,"origin":string|null,"destination":string|null,"departureLocal":"YYYY-MM-DDTHH:mm"|null,"arrivalLocal":"YYYY-MM-DDTHH:mm"|null}
Use local times exactly as printed (do not convert time zones). Use null for anything not clearly stated. Do NOT output passenger names, booking references, PNRs, ticket numbers, seats, prices, or any other field.`;

export function parseFacts(raw: string): Facts | null {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const kind = ["FLIGHT", "TRAIN", "HOTEL", "OTHER"].includes(String(o.documentKind)) ? (o.documentKind as Facts["documentKind"]) : "OTHER";
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

  const lead = LEAD_MINUTES[facts.documentKind];
  const route = [facts.origin, facts.destination].filter(Boolean).join(" → ");
  const what = `${facts.documentKind === "FLIGHT" ? "flight" : facts.documentKind === "TRAIN" ? "train" : "booking"}${facts.carrier ? ` (${facts.carrier})` : ""}${route ? ` ${route}` : ""}`;
  const depTime = formatTime12(facts.departureLocal.slice(11));

  if (!lead) {
    await privateNote(att.tripId, userId, `I read your ${what}, departing ${facts.departureLocal.slice(0, 10)} at ${depTime}, and kept it private. I haven't set any availability limit from it.`);
    return;
  }

  const latest = latestArrivalFor(facts.departureLocal, lead);
  const result = await recordPersonalConstraint({
    tripId: att.tripId,
    subjectUserId: userId,
    actorUserId: userId,
    channel: "PRIVATE",
    kind: "LATEST_END",
    localTime: latest.hhmm,
    onDate: new Date(`${latest.date}T00:00:00.000Z`),
    note: `From your uploaded ${facts.documentKind.toLowerCase()} ticket (departs ${depTime}); assumed ${lead / 60}h${lead % 60 ? ` ${lead % 60}m` : ""} lead time.`,
    sourceMessageId: null,
    confidence: "MEDIUM",
  });
  await privateNote(
    att.tripId,
    userId,
    result.ok
      ? `I read your ${what}, departing ${facts.departureLocal.slice(0, 10)} at ${depTime}, and kept the file private. Assuming you need to leave about ${lead / 60}h before departure, I've noted you as unavailable after ${formatTime12(latest.hhmm)} on ${latest.date}. The group won't see the ticket or why — only a neutral "unavailable after" line if a plan clashes. Tell me if that's wrong and I'll change it.`
      : `I read your ${what} and kept it private, but couldn't save an availability limit from it.`
  );
}
