// Server-only attachment validation + authorization core. No Next.js/
// cookies() dependency — actor ids are passed in explicitly, matching the
// src/lib/proposals.ts / src/lib/transport.ts convention in this codebase,
// so this stays callable from a future agent tool or route handler alike.
import { randomUUID } from "crypto";
import type { Channel } from "@prisma/client";
import { prisma } from "./prisma";

export function isBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

// Vercel's default serverless function request body limit is 4.5MB — this
// cap stays comfortably under that so uploads actually succeed without
// needing the more complex client-direct-to-blob token flow (a legitimate
// future upgrade for bigger files, out of scope here).
export const MAX_FILE_SIZE_BYTES = 4 * 1024 * 1024;

export type DetectedFileType = "pdf" | "jpeg" | "png" | "webp" | "heic";

const TYPE_MIME: Record<DetectedFileType, string[]> = {
  pdf: ["application/pdf"],
  jpeg: ["image/jpeg", "image/jpg"],
  png: ["image/png"],
  webp: ["image/webp"],
  heic: ["image/heic", "image/heif"],
};

const TYPE_EXTENSIONS: Record<DetectedFileType, string[]> = {
  pdf: [".pdf"],
  jpeg: [".jpg", ".jpeg"],
  png: [".png"],
  webp: [".webp"],
  heic: [".heic", ".heif"],
};

export const ALLOWED_TYPES_DESCRIPTION = "PDF, JPEG, PNG, WEBP, HEIC";

function bytesEqual(buf: Uint8Array, offset: number, expected: number[]): boolean {
  if (buf.length < offset + expected.length) return false;
  return expected.every((b, i) => buf[offset + i] === b);
}

// Real content sniffing — never trusts the browser-reported File.type
// alone, since that's set from the file extension/user claim, not actual
// content inspection, and a client can send anything it wants there.
export function sniffFileType(buf: Uint8Array): DetectedFileType | null {
  if (bytesEqual(buf, 0, [0x25, 0x50, 0x44, 0x46])) return "pdf"; // %PDF
  if (bytesEqual(buf, 0, [0xff, 0xd8, 0xff])) return "jpeg";
  if (bytesEqual(buf, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (bytesEqual(buf, 0, [0x52, 0x49, 0x46, 0x46]) && bytesEqual(buf, 8, [0x57, 0x45, 0x42, 0x50])) {
    return "webp"; // RIFF....WEBP
  }
  if (bytesEqual(buf, 4, [0x66, 0x74, 0x79, 0x70])) {
    // ftyp box — HEIC/HEIF brand codes vary (heic, heix, heim, heis,
    // mif1, msf1...); checking for a "hei"/"hev"/"mif" brand prefix is a
    // pragmatic middle ground rather than enumerating every brand.
    const brand = String.fromCharCode(buf[8] ?? 0, buf[9] ?? 0, buf[10] ?? 0, buf[11] ?? 0);
    if (brand.startsWith("hei") || brand.startsWith("hev") || brand.startsWith("mif")) return "heic";
  }
  return null;
}

function extname(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx).toLowerCase();
}

// Display-only sanitization: strips path components and control
// characters. The actual Blob storage pathname is always a random id
// (see buildBlobPathname), never derived from this — user-controlled text
// never reaches a storage key.
function sanitizeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "file";
  const cleaned = base.replace(/[\x00-\x1f\x7f]/g, "").trim();
  return cleaned.slice(0, 200) || "file";
}

export type FileValidationResult =
  | { ok: true; detectedType: DetectedFileType; sanitizedFilename: string }
  | { ok: false; error: string };

export function validateUpload(params: {
  filename: string;
  claimedMimeType: string;
  sizeBytes: number;
  bytes: Uint8Array;
}): FileValidationResult {
  if (params.sizeBytes <= 0) return { ok: false, error: "That file is empty." };
  if (params.sizeBytes > MAX_FILE_SIZE_BYTES) {
    return { ok: false, error: `Files must be ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB or smaller.` };
  }

  const detectedType = sniffFileType(params.bytes);
  if (!detectedType) {
    return { ok: false, error: `Unsupported file type. Allowed: ${ALLOWED_TYPES_DESCRIPTION}.` };
  }

  // The browser-reported MIME type must be consistent with what the bytes
  // actually are — catches a mislabeled/spoofed Content-Type.
  if (!TYPE_MIME[detectedType].includes(params.claimedMimeType.toLowerCase())) {
    return { ok: false, error: "The file's actual content doesn't match its reported type." };
  }

  const ext = extname(params.filename);
  if (!TYPE_EXTENSIONS[detectedType].includes(ext)) {
    return { ok: false, error: "The file's extension doesn't match its actual content." };
  }

  return { ok: true, detectedType, sanitizedFilename: sanitizeFilename(params.filename) };
}

export function buildBlobPathname(tripId: string, detectedType: DetectedFileType): string {
  const ext = TYPE_EXTENSIONS[detectedType][0];
  return `attachments/${tripId}/${randomUUID()}${ext}`;
}

export type AttachmentAuthResult = { ok: true } | { ok: false; reason: string };

// Upload-time authorization — checked BEFORE put() ever runs.
// PRIVATE uploads: recipientId must be the actor's own id. It is the
// caller's job (attachment-actions.ts) to never read recipientId from
// client input for PRIVATE uploads in the first place — this is a second,
// independent check, not the only one.
export async function canUploadAttachment(params: {
  tripId: string;
  actorId: string;
  channel: Channel;
  recipientId: string | null;
}): Promise<AttachmentAuthResult> {
  const member = await prisma.tripMember.findUnique({
    where: { tripId_userId: { tripId: params.tripId, userId: params.actorId } },
  });
  if (!member) return { ok: false, reason: "You're not a member of this trip." };

  if (params.channel === "PRIVATE" && params.recipientId !== params.actorId) {
    return { ok: false, reason: "A private file can only belong to your own conversation." };
  }

  return { ok: true };
}

// Download-time authorization — the single gate every read of an
// Attachment's content must pass through (src/app/api/attachments/[id]/
// route.ts). GROUP: any trip member. PRIVATE: only the recipient or the
// uploader — identical rule to how a PRIVATE Message thread is scoped,
// not a parallel one.
export async function canReadAttachment(
  attachment: { tripId: string; channel: Channel; recipientId: string | null; uploaderId: string },
  actorId: string | null
): Promise<boolean> {
  if (!actorId) return false;
  const member = await prisma.tripMember.findUnique({
    where: { tripId_userId: { tripId: attachment.tripId, userId: actorId } },
  });
  if (!member) return false;

  if (attachment.channel === "GROUP") return true;
  return attachment.recipientId === actorId || attachment.uploaderId === actorId;
}
