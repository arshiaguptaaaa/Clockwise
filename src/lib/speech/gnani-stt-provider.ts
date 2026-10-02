// Gnani Vachana speech-to-text (REST, file-based). Contract taken from
// Gnani's published Vachana docs (docs.gnani.ai, gnani-vachana on PyPI):
//   POST https://api.vachana.ai/stt/v3        multipart/form-data
//   header  X-API-Key-ID: <key>
//   fields  audio_file, language_code (BCP-47, e.g. hi-IN), format=transcribe
//   formats WAV, MP3, FLAC, OGG, M4A; max 60 seconds
//   200     { success, request_id, timestamp, transcript }
// Gnani sits behind Cloudflare, which rejects bare default User-Agents, so a
// conventional UA is sent. NOT verified against a live key in this
// environment — no GNANI_API_KEY exists here — so any non-2xx or
// unparseable reply is reported as PROVIDER_ERROR, never papered over.
import type { SpeechToTextProvider, TranscribeInput, TranscribeResult } from "./types";

const ENDPOINT = process.env.GNANI_STT_URL || "https://api.vachana.ai/stt/v3";
const SUPPORTED = /(wav|wave|mp3|mpeg|flac|ogg|m4a|mp4|x-m4a|aac)/i;

const EXTENSION: Array<[RegExp, string]> = [
  [/wav|wave/i, "wav"],
  [/mp3|mpeg/i, "mp3"],
  [/flac/i, "flac"],
  [/ogg/i, "ogg"],
  [/m4a|mp4|aac/i, "m4a"],
];

class GnaniSpeechProvider implements SpeechToTextProvider {
  readonly name = "gnani" as const;

  isConfigured() {
    return Boolean(process.env.GNANI_API_KEY);
  }

  async transcribe({ audio, mimeType, languageCode }: TranscribeInput): Promise<TranscribeResult> {
    const apiKey = process.env.GNANI_API_KEY;
    if (!apiKey) {
      return { ok: false, reason: "NOT_CONFIGURED", provider: this.name, message: "GNANI_API_KEY is not set." };
    }
    // WebM (Chrome/Edge MediaRecorder default) is not a documented Gnani
    // input format; say so rather than send something it may reject.
    if (!SUPPORTED.test(mimeType)) {
      return {
        ok: false,
        reason: "UNSUPPORTED_FORMAT",
        provider: this.name,
        message: `Gnani accepts WAV, MP3, FLAC, OGG or M4A; this recording is ${mimeType || "unknown"}.`,
      };
    }
    const ext = EXTENSION.find(([re]) => re.test(mimeType))?.[1] ?? "wav";

    const form = new FormData();
    form.append("audio_file", audio, `voice-note.${ext}`);
    form.append("language_code", languageCode);
    form.append("format", "transcribe");

    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "X-API-Key-ID": apiKey,
          "User-Agent": "Clockwise/1.0 (+https://clockwise-lemon.vercel.app)",
        },
        body: form,
      });
      if (!res.ok) {
        console.error(`[gnani-stt] HTTP ${res.status}`);
        return { ok: false, reason: "PROVIDER_ERROR", provider: this.name, message: `Gnani returned HTTP ${res.status}.` };
      }
      const data = (await res.json()) as { success?: boolean; transcript?: string };
      const transcript = data.transcript?.trim();
      if (!transcript) {
        return { ok: false, reason: "NO_SPEECH", provider: this.name, message: "No speech was recognised." };
      }
      return { ok: true, transcript, provider: this.name };
    } catch (err) {
      console.error("[gnani-stt] request failed:", err instanceof Error ? err.message : err);
      return { ok: false, reason: "PROVIDER_ERROR", provider: this.name, message: "Couldn't reach Gnani." };
    }
  }
}

export const gnaniSpeechProvider = new GnaniSpeechProvider();
