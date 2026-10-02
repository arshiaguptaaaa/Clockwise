import { gnaniSpeechProvider } from "./gnani-stt-provider";
import { geminiSpeechProvider } from "./gemini-stt-provider";
import type { SpeechToTextProvider, TranscribeInput, TranscribeResult } from "./types";

// SPEECH_PROVIDER = "gnani" | "gemini" picks the primary; unset means Gnani
// when GNANI_API_KEY exists, otherwise Gemini.
function primary(): SpeechToTextProvider {
  const choice = process.env.SPEECH_PROVIDER;
  if (choice === "gemini") return geminiSpeechProvider;
  if (choice === "gnani" || gnaniSpeechProvider.isConfigured()) return gnaniSpeechProvider;
  return geminiSpeechProvider;
}

// Try the primary; if Gnani can't take this recording (unsupported format,
// outage), fall back to Gemini — and the result says "gemini", so nothing
// downstream can mistake the source of the transcript.
export async function transcribeSpeech(
  input: TranscribeInput,
  opts: { strictGnani?: boolean } = {}
): Promise<TranscribeResult & { fellBackFrom?: string }> {
  // Proof mode: Gnani or nothing. Never falls back, never uses Gemini.
  if (opts.strictGnani) return gnaniSpeechProvider.transcribe(input);
  const first = primary();
  const result = await first.transcribe(input);
  if (result.ok || first.name === "gemini" || result.reason === "NO_SPEECH") return result;
  if (!geminiSpeechProvider.isConfigured()) return result;
  const fallback = await geminiSpeechProvider.transcribe(input);
  return { ...fallback, fellBackFrom: `${first.name}:${result.reason}` };
}

export function speechProviderStatus() {
  const active = primary();
  return {
    active: active.name,
    gnaniConfigured: gnaniSpeechProvider.isConfigured(),
    geminiConfigured: geminiSpeechProvider.isConfigured(),
  };
}
