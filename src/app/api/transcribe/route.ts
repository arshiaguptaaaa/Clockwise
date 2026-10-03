import { NextRequest, NextResponse } from "next/server";
import { transcribeSpeech } from "@/lib/speech";
import { getCurrentUserId } from "@/lib/session";
import { resolveSpeechLanguage } from "@/lib/speech/types";
import { recordVoiceTrace } from "@/lib/speech/trace";

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
  const userId = (await getCurrentUserId())!;
  const language = resolveSpeechLanguage(String(formData.get("language") ?? "") || process.env.SPEECH_LANGUAGE);
  const tripId = String(formData.get("tripId") ?? "");
  const clientDurationMs = Number(formData.get("durationMs"));
  const audioMs = Number.isFinite(clientDurationMs) && clientDurationMs > 0 ? Math.round(clientDurationMs) : null;
  const strict = request.nextUrl.searchParams.get("strict") === "gnani";
  const debug = request.nextUrl.searchParams.get("debug") === "1";

  const trace = tripId ? { tripId, userId } : null;
  if (trace) await recordVoiceTrace(trace, "VOICE_CAPTURED", { provider: "GNANI", language, audioBytes: audio.size, audioMs });
  if (trace) await recordVoiceTrace(trace, "GNANI_STT_STARTED", { provider: "GNANI", language });
  const startedAt = Date.now();
  const result = await transcribeSpeech({ audio, mimeType: audio.type || "audio/webm", languageCode: language }, { strictGnani: strict });
  if (trace) {
    await recordVoiceTrace(trace, "GNANI_STT_COMPLETED", {
      provider: result.provider.toUpperCase(),
      ok: result.ok,
      reason: result.ok ? null : result.reason,
      httpStatus: result.diagnostics?.httpStatus ?? null,
      requestId: result.diagnostics?.requestId ?? null,
      language,
      audioMs,
      latencyMs: Date.now() - startedAt,
      // Length only — the transcript itself is never written to the trace.
      transcriptChars: result.ok ? result.transcript.length : 0,
    });
  }
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
        ? "GNANI_SPEECH_API_KEY is not visible to this deployment (env vars only reach deployments built after they were added)."
        : "Voice transcription isn't configured yet."
      : result.reason === "NO_SPEECH"
        ? "Couldn't transcribe that. Try again?"
        : "Couldn't transcribe that. Try again?";
  return NextResponse.json({ error: message, provider: result.provider, reason: result.reason, providerStatus: result.diagnostics?.httpStatus ?? null, ...diagnostics }, { status });
}
