"use client";

import { useTransition } from "react";
import { Clock, RotateCcw } from "lucide-react";
import { retryAgentResponse } from "@/app/actions";

function formatTime(date: Date) {
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function FailedClockwiseMessage({
  messageId,
  content,
  timestamp,
}: {
  messageId: string;
  content: string;
  timestamp: Date;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-start gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-danger text-white">
        <Clock className="size-4" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-danger">Clockwise</span>
          <span className="text-[11px] text-muted-foreground">{formatTime(timestamp)}</span>
        </div>
        <div className="mt-1 rounded-xl bg-danger-tint px-3 py-2 text-sm leading-relaxed text-foreground">
          {content}
        </div>
        <button
          type="button"
          disabled={isPending}
          onClick={() => startTransition(async () => { await retryAgentResponse(messageId); })}
          className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw className="size-3.5" />
          {isPending ? "Retrying…" : "Retry"}
        </button>
      </div>
    </div>
  );
}
