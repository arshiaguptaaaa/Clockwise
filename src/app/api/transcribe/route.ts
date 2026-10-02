import { NextRequest, NextResponse } from "next/server";
import { transcribeSpeech } from "@/lib/speech";
import { getCurrentUserId } from "@/lib/session";

// Voice note -> raw transcript. Signed-in travellers only (every call can
// spend Gnani credits). The provider that actually produced the text is
// reported; with ?strict=gnani there is no fallback at all, and ?debug=1
// adds the sanitised wire diagnostics (status, request id, sizes — never the
// key). The transcript is NOT acted on here: it goes back into the composer
// for the person to edit and send like any typed message.
export async function POST(request: NextRequest) {
  if (!(await getCurrentUserId())) {
    return NextResponse.json({ error: "Sign in to use voice input." }, { status: 401 });
  }
  const formData = await request.formData();
  const audio = formData.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: "No audio was received." }, { status: 400 });
  }
  const language = String(formData.get("language") ?? "") || process.env.SPEECH_LANGUAGE || "en-IN";
  const strict = request.nextUrl.searchParams.get("strict") === "gnani";
  const debug = request.nextUrl.searchParams.get("debug") === "1";

  const result = await transcribeSpeech({ audio, mimeType: audio.type || "audio/webm", languageCode: language }, { strictGnani: strict });
  const diagnostics = debug ? { diagnostics: result.diagnostics ?? null } : {};

  if (result.ok) {
    return NextResponse.json({
      transcript: result.transcript,
      provider: result.provider,
      fellBackFrom: "fellBackFrom" in result ? (result.fellBackFrom ?? null) : null,
      ...diagnostics,
    });
  }
  const status = result.reason === "NOT_CONFIGURED" ? 503 : result.reason === "NO_SPEECH" ? 422 : result.reason === "UNSUPPORTED_FORMAT" ? 415 : 502;
  const message =
    result.reason === "NOT_CONFIGURED"
      ? strict
        ? "GNANI_API_KEY is not visible to this deployment (env vars only reach deployments built after they were added)."
        : "Voice transcription isn't configured yet."
      : result.reason === "NO_SPEECH"
        ? "Couldn't make out any speech in that — try again."
        : "Transcription failed — try again.";
  return NextResponse.json({ error: message, provider: result.provider, reason: result.reason, ...diagnostics }, { status });
}
