import { GoogleGenAI } from "@google/genai";
import type { SpeechToTextProvider, TranscribeInput, TranscribeResult } from "./types";

const DEFAULT_MODEL = "gemini-flash-lite-latest";
const MIN_AUDIO_BYTES = 6000;
const NO_SPEECH_TOKEN = "NO_SPEECH";

// Gemini's multimodal audio input as a transcriber. Reuses GEMINI_API_KEY.
// Always labelled "gemini" in results.
class GeminiSpeechProvider implements SpeechToTextProvider {
  readonly name = "gemini" as const;

  isConfigured() {
    return Boolean(process.env.GEMINI_API_KEY);
  }

  async transcribe({ audio, mimeType }: TranscribeInput): Promise<TranscribeResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { ok: false, reason: "NOT_CONFIGURED", provider: this.name, message: "GEMINI_API_KEY is missing." };
    }
    // A clip this small can't hold a sentence; the model will happily invent
    // words for near-silence, so don't ask it.
    if (audio.size < MIN_AUDIO_BYTES) {
      return { ok: false, reason: "NO_SPEECH", provider: this.name, message: "Recording too short." };
    }
    const base64 = Buffer.from(await audio.arrayBuffer()).toString("base64");
    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              { text: "Transcribe this audio verbatim, in the language it was spoken. Return ONLY the transcribed words — no commentary, no quotation marks, no translation. If there is no clearly intelligible speech (silence, noise, a click), return exactly NO_SPEECH and nothing else — never guess words." },
              { inlineData: { mimeType: mimeType || "audio/webm", data: base64 } },
            ],
          },
        ],
      });
      const transcript = response.text?.trim();
      if (!transcript || transcript.toUpperCase().includes(NO_SPEECH_TOKEN)) return { ok: false, reason: "NO_SPEECH", provider: this.name, message: "No speech was recognised." };
      return { ok: true, transcript, provider: this.name };
    } catch (err) {
      console.error("[gemini-stt] failed:", err instanceof Error ? err.message : err);
      return { ok: false, reason: "PROVIDER_ERROR", provider: this.name, message: "Transcription failed." };
    }
  }
}

export const geminiSpeechProvider = new GeminiSpeechProvider();
