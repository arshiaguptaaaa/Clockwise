"use client";

import { useState } from "react";
import { Clock, Volume2, Square } from "lucide-react";
import { avatarColor } from "@/lib/avatar";

type Props = {
  senderName: string;
  content: string;
  timestamp: Date;
  isClockwise: boolean;
};

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

export function MessageRow({ senderName, content, timestamp, isClockwise }: Props) {
  if (isClockwise) {
    return (
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <Clock className="size-4" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-accent-strong">Clockwise</span>
            <span className="text-[11px] text-muted-foreground">{formatTime(timestamp)}</span>
          </div>
          <div className="mt-1 rounded-xl bg-accent-tint px-3 py-2 text-sm leading-relaxed text-foreground">
            {content}
          </div>
          <PlayResponseButton text={content} />
        </div>
      </div>
    );
  }

  const color = avatarColor(senderName);

  return (
    <div className="flex items-start gap-3">
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium"
        style={{ backgroundColor: color.bg, color: color.text }}
      >
        {senderName.slice(0, 1)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-foreground">{senderName}</span>
          <span className="text-[11px] text-muted-foreground">{formatTime(timestamp)}</span>
        </div>
        <p className="mt-0.5 text-sm leading-relaxed text-foreground">{content}</p>
      </div>
    </div>
  );
}
