"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Paperclip, ArrowUp, Mic, Square, Loader2, X } from "lucide-react";
import { uploadAttachment, deleteAttachment } from "@/app/attachment-actions";

function SendButton({ externallyDisabled }: { externallyDisabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || externallyDisabled}
      aria-label="Send message"
      className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-accent text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <ArrowUp className="size-4" strokeWidth={2.25} />
    </button>
  );
}

type VoiceState = "idle" | "recording" | "transcribing" | "review" | "error";

function formatElapsed(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function Composer({
  tripId,
  channel,
  action,
  placeholder = "Message the group…",
  disabled = false,
  suggestions,
}: {
  tripId: string;
  channel: "GROUP" | "PRIVATE";
  action: (formData: FormData) => void | Promise<void>;
  placeholder?: string;
  // Set while a Clockwise turn from a PREVIOUS submit is still in flight —
  // prevents piling up duplicate requests to an already-rate-limited
  // provider by resubmitting before the first reply has resolved.
  disabled?: boolean;
  // Optional quick-reply chips shown above the input — e.g. prompts for a
  // traveller's first private message. Clicking one fills the input rather
  // than auto-sending, so they can still edit before it goes to Clockwise.
  suggestions?: string[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Uploads immediately on file pick (channel/tripId/recipient authorization
  // is enforced server-side in uploadAttachment — see src/lib/attachments.ts)
  // and holds only the resulting id/filename here, never blobUrl. Linked to
  // the actual Message row only once Send is pressed (attachmentId is
  // appended to the form below) — picking a file doesn't send anything by
  // itself.
  const [pendingAttachment, setPendingAttachment] = useState<{ id: string; filename: string } | null>(null);
  const [isAttaching, setIsAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);

  // Voice is just an alternate way to produce the same `content` text the
  // typed composer sends — the transcript goes through the exact same
  // `action` (and therefore the exact same agent turn) as typed input.
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function startRecording() {
    setVoiceError(null);

    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setVoiceState("error");
      setVoiceError("Voice input isn't supported in this browser.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setVoiceState("error");
      setVoiceError("Microphone access was denied. Enable it in your browser settings to use voice.");
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      void transcribeRecording();
    };

    recorder.start();
    setVoiceState("recording");
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    setVoiceState("transcribing");
    recorderRef.current?.stop();
  }

  async function transcribeRecording() {
    const blob = new Blob(chunksRef.current, { type: recorderRef.current?.mimeType || "audio/webm" });
    if (blob.size === 0) {
      setVoiceState("error");
      setVoiceError("Didn't catch anything — try again.");
      return;
    }

    const body = new FormData();
    body.set("audio", blob, "voice-message");

    try {
      const res = await fetch("/api/transcribe", { method: "POST", body });
      const data: { transcript?: string; error?: string } = await res.json();
      if (!res.ok || !data.transcript) {
        setVoiceState("error");
        setVoiceError(data.error ?? "Transcription failed — try again.");
        return;
      }
      setTranscript(data.transcript);
      setVoiceState("review");
    } catch {
      setVoiceState("error");
      setVoiceError("Transcription failed — try again.");
    }
  }

  function editTranscript() {
    if (inputRef.current) {
      inputRef.current.value = transcript;
      inputRef.current.focus();
    }
    setVoiceState("idle");
  }

  function cancelTranscript() {
    setTranscript("");
    setVoiceState("idle");
  }

  function sendTranscript() {
    if (disabled) return;
    const body = new FormData();
    body.set("content", transcript);
    if (pendingAttachment) body.set("attachmentId", pendingAttachment.id);
    setVoiceState("idle");
    setTranscript("");
    setPendingAttachment(null);
    void action(body);
  }

  async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttachError(null);
    setIsAttaching(true);

    const formData = new FormData();
    formData.set("tripId", tripId);
    formData.set("channel", channel);
    formData.set("file", file);

    const result = await uploadAttachment(formData);
    setIsAttaching(false);
    if (fileInputRef.current) fileInputRef.current.value = "";

    if (!result.ok) {
      setAttachError(result.error);
      return;
    }
    setPendingAttachment({ id: result.attachmentId, filename: file.name });
  }

  function removePendingAttachment() {
    if (!pendingAttachment) return;
    void deleteAttachment(pendingAttachment.id);
    setPendingAttachment(null);
  }

  return (
    <div className="border-t border-border bg-surface">
      {suggestions && suggestions.length > 0 && voiceState === "idle" && (
        <div className="flex flex-wrap gap-1.5 px-4 pt-3">
          {suggestions.map((text) => (
            <button
              key={text}
              type="button"
              onClick={() => {
                if (inputRef.current) {
                  inputRef.current.value = text;
                  inputRef.current.focus();
                }
              }}
              className="cursor-pointer rounded-full border border-border bg-page px-3 py-1.5 text-xs text-foreground transition-colors hover:border-accent hover:text-accent"
            >
              {text}
            </button>
          ))}
        </div>
      )}

      {voiceState === "review" && (
        <div className="mx-4 mt-3 rounded-xl border border-accent bg-accent-tint px-3.5 py-2.5">
          <p className="text-sm text-accent-strong">&ldquo;{transcript}&rdquo;</p>
          <div className="mt-2 flex gap-3">
            <button type="button" onClick={editTranscript} className="cursor-pointer text-xs font-medium text-accent-strong hover:underline">
              Edit
            </button>
            <button type="button" onClick={cancelTranscript} className="cursor-pointer text-xs font-medium text-muted-foreground hover:underline">
              Cancel
            </button>
            <button type="button" onClick={sendTranscript} className="cursor-pointer text-xs font-medium text-accent-strong hover:underline">
              Send
            </button>
          </div>
        </div>
      )}

      {voiceError && voiceState === "error" && (
        <p className="px-4 pt-3 text-xs text-danger">{voiceError}</p>
      )}

      {attachError && (
        <p className="px-4 pt-3 text-xs text-danger">{attachError}</p>
      )}

      {pendingAttachment && voiceState === "idle" && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-full border border-border bg-page px-3 py-1.5 text-xs">
          <Paperclip className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate text-foreground">{pendingAttachment.filename}</span>
          <button
            type="button"
            onClick={removePendingAttachment}
            aria-label="Remove attachment"
            className="ml-auto shrink-0 cursor-pointer text-muted-foreground hover:text-danger"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {voiceState === "recording" ? (
        <div className="flex items-center gap-2 px-4 py-3">
          <span className="flex size-9 shrink-0 items-center justify-center">
            <span className="size-2.5 animate-pulse rounded-full bg-danger" />
          </span>
          <span className="flex-1 text-sm text-foreground">
            Listening… <span className="tabular-nums text-muted-foreground">{formatElapsed(elapsed)}</span>
          </span>
          <button
            type="button"
            onClick={stopRecording}
            aria-label="Stop recording"
            className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-danger text-white transition-opacity hover:opacity-90"
          >
            <Square className="size-3.5" fill="currentColor" />
          </button>
        </div>
      ) : voiceState === "transcribing" ? (
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Transcribing…
        </div>
      ) : (
        <form
          ref={formRef}
          data-form="composer"
          action={async (formData) => {
            if (disabled) return;
            if (pendingAttachment) formData.set("attachmentId", pendingAttachment.id);
            setPendingAttachment(null);
            await action(formData);
            formRef.current?.reset();
          }}
          className="flex items-center gap-2 px-4 py-3"
        >
          <button
            type="button"
            aria-label="Attach"
            disabled={disabled || isAttaching}
            onClick={() => fileInputRef.current?.click()}
            className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isAttaching ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"
            className="hidden"
            onChange={handleFilePicked}
          />
          <input
            ref={inputRef}
            name="content"
            autoComplete="off"
            placeholder={placeholder}
            disabled={disabled}
            className="flex-1 rounded-full border border-border bg-page px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />
          <button
            type="button"
            aria-label="Record voice message"
            disabled={disabled}
            onClick={startRecording}
            className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Mic className="size-4" />
          </button>
          <SendButton externallyDisabled={disabled} />
        </form>
      )}
    </div>
  );
}
