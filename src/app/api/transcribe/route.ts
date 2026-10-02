import { NextRequest, NextResponse } from "next/server";
import { transcribeSpeech } from "@/lib/speech";

// Voice note -> raw transcript. The provider (Gnani when configured and the
// format is supported, otherwise Gemini) is chosen in src/lib/speech; this
// route reports which one actually produced the text. The transcript then
// goes through the normal send path, same as typed input. Never returns a
// fabricated transcript.
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const audio = formData.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: "No audio was received." }, { status: 400 });
  }
  const language = String(formData.get("language") ?? "") || process.env.SPEECH_LANGUAGE || "en-IN";

  const result = await transcribeSpeech({ audio, mimeType: audio.type || "audio/webm", languageCode: language });
  if (result.ok) {
    return NextResponse.json({ transcript: result.transcript, provider: result.provider, fellBackFrom: result.fellBackFrom ?? null });
  }
  const status = result.reason === "NOT_CONFIGURED" ? 503 : result.reason === "NO_SPEECH" ? 422 : 502;
  const message =
    result.reason === "NOT_CONFIGURED"
      ? "Voice transcription isn't configured yet."
      : result.reason === "NO_SPEECH"
        ? "Couldn't make out any speech in that — try again."
        : "Transcription failed — try again.";
  return NextResponse.json({ error: message, provider: result.provider }, { status });
}
