// A persistent, shareable group link (/join/<code>). Anyone holding it can join the trip
// by choosing a name; nobody needs an email. The link proves nothing about who they are,
// so it grants exactly what a named invite grants (membership as a TRAVELLER) and exposes
// nothing private before that: the public page shows the trip's name, destination, dates
// and how many friends are already here, never who they are or anything they've said.
import { randomBytes } from "crypto";
import { prisma } from "./prisma";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const LENGTH = 8;
export const MAX_MEMBERS_VIA_LINK = 24;

function randomCode(): string {
  const bytes = randomBytes(LENGTH);
  let code = "";
  for (let i = 0; i < LENGTH; i++) code += ALPHABET[bytes[i] % ALPHABET.length];
  return code;
}

export const normaliseJoinCode = (raw: string) => raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function ensureJoinCode(tripId: string): Promise<string> {
  const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId }, select: { joinCode: true } });
  if (trip.joinCode) return trip.joinCode;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    try {
      // Only fills an empty slot, so two concurrent first calls agree on one code.
      const claimed = await prisma.trip.updateMany({ where: { id: tripId, joinCode: null }, data: { joinCode: code } });
      if (claimed.count > 0) return code;
      const again = await prisma.trip.findUniqueOrThrow({ where: { id: tripId }, select: { joinCode: true } });
      if (again.joinCode) return again.joinCode;
    } catch {
      // unique collision: try another code
    }
  }
  throw new Error("Could not create a join link.");
}

export async function rotateJoinCode(tripId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    try {
      await prisma.trip.update({ where: { id: tripId }, data: { joinCode: code } });
      return code;
    } catch {
      // unique collision: try another code
    }
  }
  throw new Error("Could not rotate the join link.");
}

// The only data a not-yet-member can see.
export async function publicTripByJoinCode(code: string) {
  const normalised = normaliseJoinCode(code);
  if (!normalised) return null;
  const trip = await prisma.trip.findUnique({
    where: { joinCode: normalised },
    select: {
      id: true,
      name: true,
      coreStartDate: true,
      coreEndDate: true,
      createdBy: true,
      destinations: { orderBy: { order: "asc" }, select: { name: true } },
      _count: { select: { members: true } },
    },
  });
  if (!trip) return null;
  const organiser = await prisma.user.findUnique({ where: { id: trip.createdBy }, select: { name: true } });
  return {
    id: trip.id,
    name: trip.name,
    start: trip.coreStartDate,
    end: trip.coreEndDate,
    destinations: trip.destinations.map((d) => d.name),
    friendsHere: trip._count.members,
    organiserFirstName: organiser?.name.split(" ")[0] ?? null,
  };
}
