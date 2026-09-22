// Real calls against Gnani's Agent Builder Platform (docs.gnani.ai,
// api.inya.ai/platform) — researched live 2026-09-21. This is Gnani's
// outbound-call product with custom prompts + post-call webhooks, NOT
// their separate raw ASR/TTS "Speech APIs" product.
//
// Honesty note: the trigger_call response's exact field name for the
// conversation id was not confirmed against a live response during
// research (no working credential to test against) — this defensively
// checks the documented-plausible variants and fails loudly rather than
// guessing if none are present. Verify against a real response once
// GNANI_API_KEY/GNANI_BOT_ID are set, and tighten this if needed.
import type { EscalationCallInput, EscalationCallResult, EscalationOutcome, VoiceEscalationProvider } from "./types";

const BASE_URL = "https://api.inya.ai/platform";

export function isGnaniConfigured(): boolean {
  return Boolean(process.env.GNANI_API_KEY && process.env.GNANI_BOT_ID);
}

export function getMissingGnaniEnvVars(): string[] {
  return ["GNANI_API_KEY", "GNANI_BOT_ID"].filter((name) => !process.env[name]);
}

type TriggerCallResponse = Record<string, unknown>;

function extractConversationId(data: TriggerCallResponse): string | null {
  const candidates = [data.conversationId, data.conversation_id, data.id];
  const found = candidates.find((v) => typeof v === "string" && v.length > 0);
  return (found as string) ?? null;
}

class GnaniVoiceProvider implements VoiceEscalationProvider {
  async initiateCall(input: EscalationCallInput): Promise<EscalationCallResult> {
    const apiKey = process.env.GNANI_API_KEY;
    const botId = process.env.GNANI_BOT_ID;
    if (!apiKey || !botId) {
      return { placed: false, reason: "Gnani isn't configured (GNANI_API_KEY/GNANI_BOT_ID missing)." };
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
      const conversationId = extractConversationId(data);
      if (!conversationId) {
        return { placed: false, reason: "Gnani accepted the call but returned no conversation id — cannot track its outcome." };
      }
      return { placed: true, providerConversationId: conversationId };
    } catch (err) {
      return { placed: false, reason: err instanceof Error ? err.message : "Unknown Gnani error." };
    }
  }

  async getCallStatus(conversationId: string): Promise<EscalationOutcome | null> {
    const apiKey = process.env.GNANI_API_KEY;
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
