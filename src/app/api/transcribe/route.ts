import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

// Reuses the same GEMINI_API_KEY already powering the Clockwise agent —
// no separate speech-to-text vendor/credential. Gemini's own multimodal
// audio input does the transcription; the resulting text then goes
// through the exact same send action (and therefore the exact same
// agent) as typed input. Never returns a fabricated transcript — a
// missing key or a failed call is reported honestly.
const DEFAULT_MODEL = "gemini-flash-lite-latest";

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Voice transcription isn't configured yet — GEMINI_API_KEY is missing." },
      { status: 503 }
    );
  }

  const formData = await request.formData();
  const audio = formData.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: "No audio was received." }, { status: 400 });
  }

  const arrayBuffer = await audio.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const mimeType = audio.type || "audio/webm";

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: "Transcribe this audio verbatim, in the language it was spoken. Return ONLY the transcribed words — no commentary, no quotation marks, no translation.",
            },
            { inlineData: { mimeType, data: base64 } },
          ],
        },
      ],
    });

    const transcript = response.text?.trim();
    if (!transcript) {
      return NextResponse.json({ error: "Couldn't make out any speech in that — try again." }, { status: 422 });
    }
    return NextResponse.json({ transcript });
  } catch (err) {
    console.error("Transcription failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Transcription failed — try again." }, { status: 502 });
  }
}
