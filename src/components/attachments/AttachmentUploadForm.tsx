"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Paperclip } from "lucide-react";
import { uploadAttachment } from "@/app/attachment-actions";

export function AttachmentUploadForm({ tripId }: { tripId: string }) {
  const [channel, setChannel] = useState<"GROUP" | "PRIVATE">("GROUP");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    const formData = new FormData();
    formData.set("tripId", tripId);
    formData.set("channel", channel);
    formData.set("file", file);

    startTransition(async () => {
      const result = await uploadAttachment(formData);
      if (inputRef.current) inputRef.current.value = "";
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-3 rounded-xl border border-border px-3 py-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Visibility:</span>
        <button
          type="button"
          onClick={() => setChannel("GROUP")}
          className={`cursor-pointer rounded-full px-2.5 py-1 font-medium transition-colors ${
            channel === "GROUP" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-surface-muted"
          }`}
        >
          Group
        </button>
        <button
          type="button"
          onClick={() => setChannel("PRIVATE")}
          className={`cursor-pointer rounded-full px-2.5 py-1 font-medium transition-colors ${
            channel === "PRIVATE" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-surface-muted"
          }`}
        >
          Private (only you)
        </button>
      </div>

      <label className="mt-2.5 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-xs font-medium text-muted-foreground transition-colors hover:border-accent hover:text-foreground">
        {isPending ? (
          <>
            <Loader2 className="size-3.5 animate-spin" /> Uploading…
          </>
        ) : (
          <>
            <Paperclip className="size-3.5" /> Attach a file (PDF, JPEG, PNG, WEBP, HEIC — up to 4 MB)
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"
          className="hidden"
          disabled={isPending}
          onChange={handleFileChange}
        />
      </label>

      {error && <p className="mt-2 text-[11px] text-danger">{error}</p>}
    </div>
  );
}
