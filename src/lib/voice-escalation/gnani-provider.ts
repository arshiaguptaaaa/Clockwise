// Outbound calls via Gnani's Agent Builder Platform API (docs.gnani.ai/Platform/
// Trigger_Call.md): POST https://api.inya.ai/platform/v1/agents/{botId}/trigger_call
// with header `x-api-key` — a DIFFERENT product and key from the Speech APIs
// (STT/TTS use `X-API-Key-ID` on api.vachana.ai). The platform key comes from
// Agent Builder -> Settings -> API Keys (scoped `agents` / `conversations`),
// and botId is the agent created in Agent Builder / via Create Agent.
// Documented limits: test calls only to WHITELISTED numbers (else HTTP 400);
// developer-role keys need ?environment=development (else 403); HTTP 200
// means "call being placed", not completed.
//
// The documented 200 body is { status, message, response: { clientReferenceId }
// | null, requestId } — there is NO conversation id in it. Our own
// clientReferenceId (the EscalationEvent id) is what the post-call webhook
// echoes back, so that is the correlation key; requestId is stored as the
// provider reference.
import type { EscalationCallInput, EscalationCallResult, EscalationOutcome, VoiceEscalationProvider } from "./types";

const BASE_URL = "https://api.inya.ai/platform";

// GNANI_API_KEY is the SPEECH (STT/TTS) credential and must never place calls.
// Outbound calling uses the separate Agent Builder platform key.
export function isGnaniConfigured(): boolean {
  return Boolean(process.env.GNANI_PLATFORM_API_KEY && process.env.GNANI_BOT_ID);
}

export function getMissingGnaniEnvVars(): string[] {
  return ["GNANI_PLATFORM_API_KEY", "GNANI_BOT_ID"].filter((name) => !process.env[name]);
}

type TriggerCallResponse = Record<string, unknown>;

function extractConversationId(data: TriggerCallResponse): string | null {
  const candidates = [data.conversationId, data.conversation_id, data.id];
  const found = candidates.find((v) => typeof v === "string" && v.length > 0);
  return (found as string) ?? null;
}

class GnaniVoiceProvider implements VoiceEscalationProvider {
  async initiateCall(input: EscalationCallInput): Promise<EscalationCallResult> {
    const apiKey = process.env.GNANI_PLATFORM_API_KEY;
    const botId = process.env.GNANI_BOT_ID;
    if (!apiKey || !botId) {
      return { placed: false, reason: "Gnani outbound isn't configured (GNANI_PLATFORM_API_KEY/GNANI_BOT_ID missing)." };
    }

    const environment = process.env.GNANI_ENV || "development";
    try {
      const res = await fetch(`${BASE_URL}/v1/agents/${botId}/trigger_call?environment=${environment}`, {
        method: "POST",
        headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: input.phone,
          countryCode: input.countryCode,
          name: input.travellerName,
          clientReferenceId: input.clientReferenceId,
        }),
      });

      if (!res.ok) {
        return { placed: false, reason: `Gnani trigger_call failed (${res.status}): ${await res.text()}` };
      }

      const data: TriggerCallResponse = await res.json();
      if (data.status !== undefined && data.status !== "success") {
        return { placed: false, reason: `Gnani did not confirm the call (status ${String(data.status)}).` };
      }
      // Documented reference is requestId; fall back to any id-like field, then
      // to our own correlation id (the webhook matches on it).
      const reference =
        (typeof data.requestId === "string" && data.requestId) || extractConversationId(data) || input.clientReferenceId;
      return { placed: true, providerConversationId: reference };
    } catch (err) {
      return { placed: false, reason: err instanceof Error ? err.message : "Unknown Gnani error." };
    }
  }

  async getCallStatus(conversationId: string): Promise<EscalationOutcome | null> {
    const apiKey = process.env.GNANI_PLATFORM_API_KEY;
    if (!apiKey) return null;

    try {
      const res = await fetch(`${BASE_URL}/v1/conversations/${conversationId}/stats`, {
        headers: { "x-api-key": apiKey },
      });
      if (!res.ok) return null;

      const data: {
        callStatus?: string;
        callSummary?: { disposition?: string };
        utteranceAnalytics?: unknown;
      } = await res.json();

      return {
        callStatus: data.callStatus ?? "UNKNOWN",
        disposition: data.callSummary?.disposition ?? null,
        transcript: data.utteranceAnalytics ? JSON.stringify(data.utteranceAnalytics) : null,
      };
    } catch {
      return null;
    }
  }
}

export const gnaniVoiceProvider: VoiceEscalationProvider = new GnaniVoiceProvider();
