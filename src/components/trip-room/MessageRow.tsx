"use client";

import { useState } from "react";
import { Clock, Volume2, Square, Paperclip } from "lucide-react";
import { Face } from "@/components/art/CharacterScene";
import { faceIndexForId, popTintForId } from "@/lib/characters";

export type MessageAttachment = { id: string; filename: string };

type Props = {
  senderId?: string;
  senderName: string;
  content: string;
  timestamp: Date;
  isClockwise: boolean;
  attachments?: MessageAttachment[];
};

// Downloads through the authorization-checked proxy route (src/app/api/
// attachments/[id]/route.ts) — never a direct Blob URL, which this
// component never even receives.
function AttachmentChips({ attachments }: { attachments: MessageAttachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {attachments.map((a) => (
        <a
          key={a.id}
          href={`/api/attachments/${a.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex cursor-pointer items-center gap-1 rounded-full border border-border bg-page px-2.5 py-1 text-[11px] text-foreground transition-colors hover:border-accent hover:text-accent"
        >
          <Paperclip className="size-3" />
          <span className="max-w-[160px] truncate">{a.filename}</span>
        </a>
      ))}
    </div>
  );
}

function formatTime(date: Date) {
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Optional playback, never autoplay — text stays the primary, always-
// visible representation. Uses the browser's built-in speechSynthesis,
// no new provider/credential.
function PlayResponseButton({ text }: { text: string }) {
  const [speaking, setSpeaking] = useState(false);

  function toggle() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={speaking ? "Stop playback" : "Play response"}
      className="mt-1 flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-accent"
    >
      {speaking ? <Square className="size-3" /> : <Volume2 className="size-3" />}
      {speaking ? "Stop" : "Play"}
    </button>
  );
}

export function MessageRow({ senderId, senderName, content, timestamp, isClockwise, attachments = [] }: Props) {
  if (isClockwise) {
    return (
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground ring-2 ring-pop-pink">
          <Clock className="size-4" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-accent-strong">Clockwise</span>
            <span className="text-[11px] text-muted-foreground">{formatTime(timestamp)}</span>
          </div>
          <div className="mt-1 rounded-2xl rounded-tl-md border border-accent/15 bg-accent-tint px-3.5 py-2.5 text-sm leading-relaxed text-foreground shadow-[0_6px_16px_-10px_rgba(30,75,58,0.5)]">
            {content}
          </div>
          <AttachmentChips attachments={attachments} />
          <PlayResponseButton text={content} />
        </div>
      </div>
    );
  }

  const key = senderId ?? senderName;

  return (
    <div className="flex items-start gap-3">
      <Face index={faceIndexForId(key)} className="mt-0.5 size-9" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-[15px] font-medium text-foreground">{senderName}</span>
          <span className="text-[11px] text-muted-foreground">{formatTime(timestamp)}</span>
        </div>
        <p
          className="mt-1 inline-block max-w-full rounded-2xl rounded-tl-md px-3.5 py-2 text-sm leading-relaxed text-foreground"
          style={{ backgroundColor: popTintForId(key) }}
        >
          {content}
        </p>
        <AttachmentChips attachments={attachments} />
      </div>
    </div>
  );
}
