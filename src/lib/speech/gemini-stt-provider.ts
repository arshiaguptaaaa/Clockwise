import { GoogleGenAI } from "@google/genai";
import type { SpeechToTextProvider, TranscribeInput, TranscribeResult } from "./types";

const DEFAULT_MODEL = "gemini-flash-lite-latest";

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
    const base64 = Buffer.from(await audio.arrayBuffer()).toString("base64");
    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              { text: "Transcribe this audio verbatim, in the language it was spoken. Return ONLY the transcribed words — no commentary, no quotation marks, no translation." },
              { inlineData: { mimeType: mimeType || "audio/webm", data: base64 } },
            ],
          },
        ],
      });
      const transcript = response.text?.trim();
      if (!transcript) return { ok: false, reason: "NO_SPEECH", provider: this.name, message: "No speech was recognised." };
      return { ok: true, transcript, provider: this.name };
    } catch (err) {
      console.error("[gemini-stt] failed:", err instanceof Error ? err.message : err);
      return { ok: false, reason: "PROVIDER_ERROR", provider: this.name, message: "Transcription failed." };
    }
  }
}

export const geminiSpeechProvider = new GeminiSpeechProvider();
