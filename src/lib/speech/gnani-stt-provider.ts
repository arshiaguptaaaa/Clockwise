// Gnani Vachana speech-to-text (REST, file-based). Contract taken from
// Gnani's published Vachana docs (docs.gnani.ai, gnani-vachana on PyPI):
//   POST https://api.vachana.ai/stt/v3        multipart/form-data
//   header  X-API-Key-ID: <key>
//   fields  audio_file, language_code (BCP-47, e.g. hi-IN), format=transcribe
//   formats WAV, MP3, FLAC, OGG, M4A; max 60 seconds
//   200     { success, request_id, timestamp, transcript }
// Gnani sits behind Cloudflare, which rejects bare default User-Agents, so a
// conventional UA is sent. NOT verified against a live key in this
// environment — no Gnani key exists here — so any non-2xx or
// unparseable reply is reported as PROVIDER_ERROR, never papered over.
import type { RailEvidence, SpeechDiagnostics, SpeechToTextProvider, TranscribeInput, TranscribeResult } from "./types";

const ENDPOINT = process.env.GNANI_STT_URL || "https://api.vachana.ai/stt/v3";
const SUPPORTED = /(wav|wave|mp3|mpeg|flac|ogg|m4a|mp4|x-m4a|aac)/i;

const EXTENSION: Array<[RegExp, string]> = [
  [/wav|wave/i, "wav"],
  [/mp3|mpeg/i, "mp3"],
  [/flac/i, "flac"],
  [/ogg/i, "ogg"],
  [/m4a|mp4|aac/i, "m4a"],
];

// Server-side only. GNANI_SPEECH_API_KEY is the documented name; GNANI_API_KEY is
// what the Vercel project was first configured with and is still honoured.
export function gnaniSpeechKey(): string | undefined {
  return process.env.GNANI_SPEECH_API_KEY || process.env.GNANI_API_KEY || undefined;
}

export function gnaniSpeechKeySource(): "GNANI_SPEECH_API_KEY" | "GNANI_API_KEY" | null {
  return process.env.GNANI_SPEECH_API_KEY ? "GNANI_SPEECH_API_KEY" : process.env.GNANI_API_KEY ? "GNANI_API_KEY" : null;
}

class GnaniSpeechProvider implements SpeechToTextProvider {
  readonly name = "gnani" as const;

  isConfigured() {
    return Boolean(gnaniSpeechKey());
  }

  async transcribe({ audio, mimeType, languageCode }: TranscribeInput): Promise<TranscribeResult> {
    const apiKey = gnaniSpeechKey();
    if (!apiKey) {
      return { ok: false, reason: "NOT_CONFIGURED", provider: this.name, message: "GNANI_SPEECH_API_KEY is not set." };
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

    const started = Date.now();
    const diag: SpeechDiagnostics = {
      endpoint: new URL(ENDPOINT).host + new URL(ENDPOINT).pathname,
      httpStatus: null,
      requestId: null,
      sentBytes: audio.size,
      sentMime: mimeType,
      languageCode,
      keySource: gnaniSpeechKeySource(),
      responseFields: [],
      durationMs: 0,
    };
    const evidenceRequest = {
      headers: { "X-API-Key-ID": "[REDACTED]", "User-Agent": "Clockwise/1.0 (+https://clockwise-lemon.vercel.app)", "Content-Type": "multipart/form-data" },
      body: { audio_file: `<${audio.size} bytes, ${mimeType}, not stored>`, language_code: languageCode, format: "transcribe" },
    };
    const evidence = (httpStatus: number | null, response: unknown, requestId: string | null): RailEvidence => ({
      endpoint: ENDPOINT,
      method: "POST",
      request: evidenceRequest,
      response,
      httpStatus,
      providerRequestId: requestId,
      durationMs: Date.now() - started,
    });
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "X-API-Key-ID": apiKey,
          "User-Agent": "Clockwise/1.0 (+https://clockwise-lemon.vercel.app)",
        },
        body: form,
        signal: AbortSignal.timeout(20_000),
      });
      diag.httpStatus = res.status;
      diag.durationMs = Date.now() - started;
      if (!res.ok) {
        // Sanitised: Gnani doesn't echo credentials, but strip the key if it ever did.
        diag.errorBody = (await res.text()).split(apiKey).join("[redacted]").slice(0, 300);
        console.error(`[gnani-stt] HTTP ${res.status}`);
        return { ok: false, reason: "PROVIDER_ERROR", provider: this.name, message: `Gnani returned HTTP ${res.status}.`, diagnostics: diag, evidence: evidence(res.status, diag.errorBody, null) };
      }
      const data = (await res.json()) as { success?: boolean; transcript?: string; request_id?: string };
      diag.responseFields = Object.keys(data);
      diag.requestId = data.request_id ?? null;
      const transcript = data.transcript?.trim();
      if (!transcript) {
        return { ok: false, reason: "NO_SPEECH", provider: this.name, message: "No speech was recognised.", diagnostics: diag, evidence: evidence(res.status, data, data.request_id ?? null) };
      }
      return { ok: true, transcript, provider: this.name, diagnostics: diag, evidence: evidence(res.status, data, data.request_id ?? null) };
    } catch (err) {
      diag.durationMs = Date.now() - started;
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      console.error("[gnani-stt] request failed:", err instanceof Error ? err.name : "unknown");
      return { ok: false, reason: "PROVIDER_ERROR", provider: this.name, message: timedOut ? "Gnani took too long to respond." : "Couldn't reach Gnani.", diagnostics: diag };
    }
  }
}

export const gnaniSpeechProvider = new GnaniSpeechProvider();
