import { randomBytes } from "crypto";
import { prisma } from "./prisma";

// Short, URL-safe, human-shareable — deliberately distinct from the
// internal cuid() ids used everywhere else (those are long and ugly to
// paste into a text message). Uppercase alphanumeric, ambiguous
// characters (0/O, 1/I/L) excluded so it reads correctly out loud too.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const TOKEN_LENGTH = 8;

function randomToken(): string {
  const bytes = randomBytes(TOKEN_LENGTH);
  let token = "";
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    token += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return token;
}

export async function generateUniqueInviteToken(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = randomToken();
    const existing = await prisma.invite.findUnique({ where: { token } });
    if (!existing) return token;
  }
  throw new Error("Could not generate a unique invite token after 5 attempts.");
}
