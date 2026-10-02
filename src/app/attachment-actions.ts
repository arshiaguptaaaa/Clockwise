"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { put, del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { extractFromAttachment } from "@/lib/document-extraction";
import { isBlobConfigured, validateUpload, buildBlobPathname, canUploadAttachment } from "@/lib/attachments";

export type UploadAttachmentResult = { ok: true; attachmentId: string } | { ok: false; error: string };

// The only place put() is ever called. Authorization happens BEFORE it —
// trip membership and (for PRIVATE) recipient-is-self are both checked
// ahead of any Blob write, not after.
export async function uploadAttachment(formData: FormData): Promise<UploadAttachmentResult> {
  const actorId = await getCurrentUserId();
  if (!actorId) return { ok: false, error: "Sign in to upload files." };

  const tripId = formData.get("tripId");
  const channel = formData.get("channel");
  const messageIdRaw = formData.get("messageId");
  const file = formData.get("file");

  if (typeof tripId !== "string" || !tripId) return { ok: false, error: "Missing trip." };
  if (channel !== "GROUP" && channel !== "PRIVATE") return { ok: false, error: "Invalid visibility." };
  if (!(file instanceof File)) return { ok: false, error: "No file provided." };

  // PRIVATE recipientId is ALWAYS the acting user's own id — never read
  // from client input, so a client cannot manufacture a different
  // recipientId to write into someone else's private conversation.
  const recipientId = channel === "PRIVATE" ? actorId : null;

  const auth = await canUploadAttachment({ tripId, actorId, channel, recipientId });
  if (!auth.ok) return { ok: false, error: auth.reason };

  let messageId: string | null = null;
  if (typeof messageIdRaw === "string" && messageIdRaw) {
    const message = await prisma.message.findUnique({ where: { id: messageIdRaw } });
    if (!message || message.tripId !== tripId || message.channel !== channel) {
      return { ok: false, error: "That message doesn't belong to this trip/conversation." };
    }
    messageId = messageIdRaw;
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateUpload({
    filename: file.name,
    claimedMimeType: file.type,
    sizeBytes: file.size,
    bytes,
  });
  if (!validation.ok) return { ok: false, error: validation.error };

  // Vercel Blob when a store is configured; otherwise the bytes are kept
  // in the database (private by construction — no URL exists for them).
  const useBlob = isBlobConfigured();
  const pathname = buildBlobPathname(tripId, validation.detectedType);
  const blob = useBlob
    ? await put(pathname, Buffer.from(bytes), {
        access: "public",
        addRandomSuffix: false, // pathname already contains a random id
        contentType: file.type,
      })
    : null;

  try {
    const attachment = await prisma.attachment.create({
      data: {
        tripId,
        uploaderId: actorId,
        channel,
        recipientId,
        messageId,
        filename: validation.sanitizedFilename,
        mimeType: file.type,
        sizeBytes: file.size,
        blobUrl: blob?.url ?? "database://attachment",
        blobPathname: blob?.pathname ?? pathname,
        storage: useBlob ? "BLOB" : "DATABASE",
        content: useBlob ? null : Buffer.from(bytes),
      },
    });

    revalidatePath(`/trips/${tripId}/room/files`);

    // A PRIVATE document is read for itinerary facts after the response goes
    // out, so the upload itself stays fast. See document-extraction.ts for
    // exactly what is (and is never) extracted.
    if (channel === "PRIVATE") {
      after(() => extractFromAttachment(attachment.id).catch((err) => console.error("[doc-extract]", err instanceof Error ? err.message : err)));
    }
    return { ok: true, attachmentId: attachment.id };
  } catch {
    // The DB row is the source of truth for what attachments "exist" — a
    // blob with no corresponding row is an orphan. Clean it up rather
    // than leaving it to accumulate silently on every failed create.
    if (blob) await del(blob.url).catch(() => {});
    return { ok: false, error: "Upload failed while saving — please try again." };
  }
}

export async function deleteAttachment(attachmentId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const actorId = await getCurrentUserId();
  if (!actorId) return { ok: false, error: "Sign in first." };

  const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } });
  if (!attachment) return { ok: false, error: "File not found." };

  // Only the uploader may delete — not just any authorized reader.
  if (attachment.uploaderId !== actorId) {
    return { ok: false, error: "Only the person who uploaded this file can delete it." };
  }

  await prisma.attachment.delete({ where: { id: attachmentId } });
  if (attachment.storage === "BLOB") await del(attachment.blobUrl).catch(() => {});

  revalidatePath(`/trips/${attachment.tripId}/room/files`);
  return { ok: true };
}
