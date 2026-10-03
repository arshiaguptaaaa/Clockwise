// Speech-to-text boundary. A voice note becomes a RAW TRANSCRIPT here, from
// whichever provider is configured; the transcript then enters the same chat
// send path as typed text, where Gemini (not the ASR provider) interprets it
// into typed trip events. Providers never decide trip state.
export type TranscribeInput = {
  audio: Blob;
  mimeType: string;
  // BCP-47, e.g. "en-IN", "hi-IN".
  languageCode: string;
};

// What actually went over the wire, with nothing secret in it. Returned to
// signed-in callers on request so an integration can be proven, not assumed.
export type SpeechDiagnostics = {
  endpoint: string;
  httpStatus: number | null;
  requestId: string | null;
  sentBytes: number;
  sentMime: string;
  languageCode: string;
  // Which env var NAME supplied the key (never its value).
  keySource?: string | null;
  responseFields: string[];
  durationMs: number;
  errorBody?: string;
};

// What went over the wire to the partner, already free of secrets. Only the Gnani
// provider fills this; the route stores it as organiser-only rail evidence.
export type RailEvidence = {
  endpoint: string;
  method: string;
  request: unknown;
  response?: unknown;
  httpStatus: number | null;
  providerRequestId: string | null;
  durationMs: number;
};

export type TranscribeResult =
  | { ok: true; transcript: string; provider: SpeechProviderName; diagnostics?: SpeechDiagnostics; evidence?: RailEvidence }
  | {
      ok: false;
      reason: "NOT_CONFIGURED" | "UNSUPPORTED_FORMAT" | "NO_SPEECH" | "PROVIDER_ERROR";
      message: string;
      provider: SpeechProviderName;
      diagnostics?: SpeechDiagnostics;
      evidence?: RailEvidence;
    };

// The label a result carries is the provider that actually produced it —
// a Gemini transcript is never reported as Gnani, even when it is the
// fallback for a Gnani failure.
export type SpeechProviderName = "gnani" | "gemini";

export interface SpeechToTextProvider {
  readonly name: SpeechProviderName;
  isConfigured(): boolean;
  transcribe(input: TranscribeInput): Promise<TranscribeResult>;
}

// Languages Gnani Vachana supports for file STT. en-IN is the default; the
// composer can expose a picker later without touching the server.
export const SPEECH_LANGUAGES = [
  { code: "en-IN", label: "English" },
  { code: "hi-IN", label: "Hindi" },
  { code: "pa-IN", label: "Punjabi" },
  { code: "bn-IN", label: "Bengali" },
  { code: "gu-IN", label: "Gujarati" },
  { code: "kn-IN", label: "Kannada" },
  { code: "ml-IN", label: "Malayalam" },
  { code: "mr-IN", label: "Marathi" },
  { code: "ta-IN", label: "Tamil" },
  { code: "te-IN", label: "Telugu" },
] as const;
export const DEFAULT_SPEECH_LANGUAGE = "en-IN";
export function resolveSpeechLanguage(code: string | null | undefined): string {
  return SPEECH_LANGUAGES.some((l) => l.code === code) ? (code as string) : DEFAULT_SPEECH_LANGUAGE;
}
