import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { canReadAttachment } from "@/lib/attachments";

// THE authorization boundary for every attachment read. blobUrl is never
// sent to any client — this route fetches the blob content server-side
// and streams only the bytes back, after an authorization check that
// treats "unauthorized" and "doesn't exist" identically (404 either way,
// never 403), so an unauthorized caller can't even learn whether a given
// id exists.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const attachment = await prisma.attachment.findUnique({ where: { id } });
  if (!attachment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const actorId = await getCurrentUserId();
  const authorized = await canReadAttachment(attachment, actorId);
  if (!authorized) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const blobRes = await fetch(attachment.blobUrl);
  if (!blobRes.ok || !blobRes.body) {
    return NextResponse.json({ error: "File unavailable" }, { status: 502 });
  }

  // Escape quotes/backslashes — filename is sanitized on upload (no
  // control characters), but Content-Disposition is a header value and
  // this is the point where an unescaped quote could still break out of
  // the quoted string.
  const safeFilename = attachment.filename.replace(/["\\]/g, "\\$&");

  return new NextResponse(blobRes.body, {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Disposition": `inline; filename="${safeFilename}"`,
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
