"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { ClockwiseMark } from "@/components/ClockwiseMark";
import { Paperclip, ArrowUp, Mic, Square, Loader2, X } from "lucide-react";
import { uploadAttachment, deleteAttachment } from "@/app/attachment-actions";
import { recordingToWav } from "@/lib/audio/to-wav";
import { DEFAULT_SPEECH_LANGUAGE } from "@/lib/speech/types";

function SendButton({ externallyDisabled }: { externallyDisabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || externallyDisabled}
      aria-label="Send message"
      className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-accent text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <ArrowUp className="size-4" strokeWidth={2.25} />
    </button>
  );
}

type VoiceState = "idle" | "recording" | "transcribing" | "error";

// Gnani accepts up to 60 s of audio; stop a little short of that.
const MAX_RECORDING_SECONDS = 55;
const TRANSCRIBE_TIMEOUT_MS = 30_000;

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
  onSubmitStart,
}: {
  tripId: string;
  channel: "GROUP" | "PRIVATE";
  // Called synchronously the instant Send is pressed (an urgent update, unlike the form action, which React
  // holds as a transition) so the UI can react immediately, e.g. "Clockwise is thinking".
  onSubmitStart?: (content: string) => void;
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

  // The composer text is ONE piece of state. Typing, quick-reply chips and a
  // voice transcript all write to it, and the normal Send button sends it —
  // there is no separate "voice message" path.
  const [text, setText] = useState("");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef(0);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);
  // The last upload, kept so TRY AGAIN can resend it without re-recording.
  const lastUploadRef = useRef<{ blob: Blob; durationMs: number } | null>(null);
  // The rail-evidence row of the last transcription, linked to the message when it is sent.
  const voiceCallRef = useRef<string | null>(null);

  function releaseMic() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  useEffect(() => releaseMic, []);

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
    } catch (err) {
      setVoiceState("error");
      const name = err instanceof DOMException ? err.name : "";
      setVoiceError(
        name === "NotFoundError" || name === "OverconstrainedError"
          ? "No microphone was found on this device."
          : "Microphone access was blocked. Allow it in your browser's site settings to use voice."
      );
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];
    cancelledRef.current = false;
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      releaseMic();
      if (cancelledRef.current) {
        setVoiceState("idle");
        return;
      }
      void transcribeRecording(recorder.mimeType || "audio/webm");
    };

    recorder.start();
    setVoiceState("recording");
    setElapsed(0);
    elapsedRef.current = 0;
    timerRef.current = setInterval(() => {
      setElapsed((s) => {
        if (s + 1 >= MAX_RECORDING_SECONDS) stopRecording();
        elapsedRef.current = s + 1;
        return s + 1;
      });
    }, 1000);
  }

  function stopRecording() {
    if (recorderRef.current?.state !== "recording") return;
    if (timerRef.current) clearInterval(timerRef.current);
    setVoiceState("transcribing");
    recorderRef.current.stop();
  }

  function cancelRecording() {
    cancelledRef.current = true;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    else {
      releaseMic();
      setVoiceState("idle");
    }
  }

  async function transcribeRecording(recordedMime: string) {
    const recorded = new Blob(chunksRef.current, { type: recordedMime });
    if (recorded.size === 0) {
      setVoiceState("error");
      setVoiceError("Didn't catch anything — try again.");
      return;
    }

    // Gnani doesn't accept WebM, so send 16 kHz mono WAV; if the browser
    // can't decode its own recording, send it as recorded and let the server
    // decide.
    let upload: Blob = recorded;
    try {
      upload = await recordingToWav(recorded);
    } catch {
      upload = recorded;
    }

    lastUploadRef.current = { blob: upload, durationMs: Math.max(0, Math.round(elapsedRef.current * 1000)) };
    await sendForTranscription();
  }

  async function retryTranscription() {
    if (!lastUploadRef.current) return;
    setVoiceError(null);
    setVoiceState("transcribing");
    await sendForTranscription();
  }

  async function sendForTranscription() {
    const last = lastUploadRef.current;
    if (!last) return;
    const upload = last.blob;
    const body = new FormData();
    body.set("audio", upload, upload.type === "audio/wav" ? "voice.wav" : "voice");
    body.set("language", DEFAULT_SPEECH_LANGUAGE);
    body.set("tripId", tripId);
    body.set("durationMs", String(last.durationMs));

    try {
      const res = await fetch("/api/transcribe", { method: "POST", body, signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS) });
      const data: { transcript?: string; error?: string; voiceRailCallId?: string | null } = await res.json().catch(() => ({}));
      if (!res.ok || !data.transcript) {
        setVoiceState("error");
        setVoiceError(data.error ?? "Couldn't transcribe that. Try again?");
        return;
      }
      voiceCallRef.current = data.voiceRailCallId ?? null;
      // Into the normal composer, editable; nothing is sent until they press Send.
      setText((prev) => (prev.trim() ? `${prev.trim()} ${data.transcript}` : data.transcript!));
      setVoiceState("idle");
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch {
      setVoiceState("error");
      setVoiceError("Couldn't transcribe that. Try again?");
    }
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
          {suggestions.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => {
                setText(chip);
                inputRef.current?.focus();
              }}
              className="cursor-pointer rounded-full border border-border bg-page px-3 py-1.5 text-xs text-foreground transition-colors hover:border-accent hover:text-accent"
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      {voiceError && voiceState === "error" && (
        <div className="flex items-center gap-3 px-4 pt-3 text-xs text-danger" role="alert">
          <span>{voiceError}</span>
          {lastUploadRef.current && (
            <button
              type="button"
              onClick={retryTranscription}
              className="cursor-pointer rounded-full border border-danger px-3 py-1 font-semibold uppercase tracking-wider"
            >
              Try again
            </button>
          )}
        </div>
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
        <div className="flex min-h-[68px] items-center gap-3 px-4 py-3" role="status" aria-live="polite">
          <button
            type="button"
            onClick={cancelRecording}
            aria-label="Cancel recording"
            className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
          <span className="flex h-5 items-center gap-[3px]" aria-hidden>
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className="voice-bar w-[3px] rounded-full bg-danger" style={{ animationDelay: `${i * 110}ms` }} />
            ))}
          </span>
          <span className="flex-1 text-sm text-foreground">
            Listening… <span className="tabular-nums text-muted-foreground">{formatElapsed(elapsed)}</span>
          </span>
          <button
            type="button"
            onClick={stopRecording}
            aria-label="Stop recording"
            className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-danger text-white transition-opacity hover:opacity-90"
          >
            <Square className="size-3.5" fill="currentColor" />
          </button>
        </div>
      ) : voiceState === "transcribing" ? (
        <div className="vote-in flex min-h-[68px] items-center gap-3 px-4 py-3" role="status" aria-live="polite">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground"><ClockwiseMark size={18} working /></span>
          <p className="font-display text-[17px] italic text-muted-foreground">Turning that into words…</p>
        </div>
      ) : (
        <form
          ref={formRef}
          data-form="composer"
          onSubmit={(e) => {
            const content = String(new FormData(e.currentTarget).get("content") ?? "");
            if (content.trim() && !disabled) onSubmitStart?.(content);
          }}
          action={async (formData) => {
            if (disabled) return;
            if (pendingAttachment) formData.set("attachmentId", pendingAttachment.id);
            if (voiceCallRef.current) {
              formData.set("voiceRailCallId", voiceCallRef.current);
              voiceCallRef.current = null;
            }
            setPendingAttachment(null);
            setText("");
            await action(formData);
          }}
          className="flex items-center gap-1.5 px-3 py-2"
        >
          <button
            type="button"
            aria-label="Attach"
            disabled={disabled || isAttaching}
            onClick={() => fileInputRef.current?.click()}
            className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
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
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoComplete="off"
            placeholder={placeholder}
            disabled={disabled}
            className="min-h-11 min-w-0 flex-1 rounded-full border border-border bg-page px-4 py-2 text-base text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />
          <button
            type="button"
            aria-label="Record voice message"
            disabled={disabled}
            onClick={startRecording}
            className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Mic className="size-4" />
          </button>
          <SendButton externallyDisabled={disabled} />
        </form>
      )}
    </div>
  );
}
