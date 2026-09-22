import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { isBlobConfigured } from "@/lib/attachments";
import { AttachmentUploadForm } from "@/components/attachments/AttachmentUploadForm";
import { FileCard } from "@/components/attachments/FileCard";

export default async function RoomFilesPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  const viewerId = await getCurrentUserId();

  if (!viewerId) {
    return <p className="p-6 text-center text-sm text-muted-foreground">Sign in to see this trip&apos;s files.</p>;
  }

  const blobConfigured = isBlobConfigured();

  // Same authorization rule as the download route (src/lib/attachments.ts
  // canReadAttachment) applied at query time: GROUP files are visible to
  // any trip member, PRIVATE files only to their recipient/uploader.
  //
  // Explicit `select` (not `include`) is deliberate, not just tidiness:
  // Next.js serializes every enumerable property of a Server Component
  // prop across to the client, regardless of what the receiving Client
  // Component's TS type declares — a `select` that never fetches
  // blobUrl/blobPathname in the first place is what actually prevents
  // them from ever reaching FileCard's props, not the FileCardAttachment
  // type alone.
  const attachments = blobConfigured
    ? await prisma.attachment.findMany({
        where: {
          tripId,
          OR: [
            { channel: "GROUP" },
            { channel: "PRIVATE", OR: [{ recipientId: viewerId }, { uploaderId: viewerId }] },
          ],
        },
        select: {
          id: true,
          filename: true,
          mimeType: true,
          sizeBytes: true,
          channel: true,
          createdAt: true,
          uploaderId: true,
          uploader: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
      })
    : [];

  const groupFiles = attachments.filter((a) => a.channel === "GROUP");
  const privateFiles = attachments.filter((a) => a.channel === "PRIVATE");

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Files</p>

      {!blobConfigured ? (
        <div className="mt-3 rounded-lg border border-warning-tint bg-warning-tint px-3 py-3 text-xs">
          <p className="font-medium text-warning">File storage needs setup.</p>
          <p className="mt-1 text-muted-foreground">
            File uploads aren&apos;t available on this deployment yet — the storage connection hasn&apos;t been
            configured.
          </p>
        </div>
      ) : (
        <AttachmentUploadForm tripId={tripId} />
      )}

      <div className="mt-5">
        <p className="text-xs font-medium text-foreground">Shared with the group ({groupFiles.length})</p>
        {groupFiles.length === 0 ? (
          <p className="mt-1.5 text-xs text-muted-foreground">No group files yet.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {groupFiles.map((a) => (
              <FileCard key={a.id} attachment={a} viewerId={viewerId} />
            ))}
          </div>
        )}
      </div>

      <div className="mt-5">
        <p className="text-xs font-medium text-foreground">Your private files ({privateFiles.length})</p>
        {privateFiles.length === 0 ? (
          <p className="mt-1.5 text-xs text-muted-foreground">No private files yet — only visible to you.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {privateFiles.map((a) => (
              <FileCard key={a.id} attachment={a} viewerId={viewerId} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
