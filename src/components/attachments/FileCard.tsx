"use client";

import { useState, useTransition } from "react";
import { FileText, Image as ImageIcon, Lock, Users, Trash2, Download } from "lucide-react";
import { deleteAttachment } from "@/app/attachment-actions";

export type FileCardAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  channel: "GROUP" | "PRIVATE";
  createdAt: Date;
  uploaderId: string;
  uploader: { name: string };
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileCard({ attachment, viewerId }: { attachment: FileCardAttachment; viewerId: string }) {
  const [isPending, startTransition] = useTransition();
  const [removed, setRemoved] = useState(false);

  if (removed) return null;

  const Icon = attachment.mimeType.startsWith("image/") ? ImageIcon : FileText;
  const canDelete = attachment.uploaderId === viewerId;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted">
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <a
        href={`/api/attachments/${attachment.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="min-w-0 flex-1"
      >
        <p className="truncate text-sm font-medium text-foreground">{attachment.filename}</p>
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
          {attachment.channel === "PRIVATE" ? (
            <Lock className="size-3" />
          ) : (
            <Users className="size-3" />
          )}
          {formatFileSize(attachment.sizeBytes)} · {attachment.uploader.name} ·{" "}
          {attachment.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
        </p>
      </a>
      <a
        href={`/api/attachments/${attachment.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 cursor-pointer rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Download"
      >
        <Download className="size-4" />
      </a>
      {canDelete && (
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await deleteAttachment(attachment.id);
              if (result.ok) setRemoved(true);
            })
          }
          className="shrink-0 cursor-pointer rounded-full p-1.5 text-muted-foreground transition-colors hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Delete"
        >
          <Trash2 className="size-4" />
        </button>
      )}
    </div>
  );
}
