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

export type TranscribeResult =
  | { ok: true; transcript: string; provider: SpeechProviderName }
  | { ok: false; reason: "NOT_CONFIGURED" | "UNSUPPORTED_FORMAT" | "NO_SPEECH" | "PROVIDER_ERROR"; message: string; provider: SpeechProviderName };

// The label a result carries is the provider that actually produced it —
// a Gemini transcript is never reported as Gnani, even when it is the
// fallback for a Gnani failure.
export type SpeechProviderName = "gnani" | "gemini";

export interface SpeechToTextProvider {
  readonly name: SpeechProviderName;
  isConfigured(): boolean;
  transcribe(input: TranscribeInput): Promise<TranscribeResult>;
}
