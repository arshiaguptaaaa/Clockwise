// VoiceEscalationProvider — the CLOCKWISE → TRAVELLER outbound-call
// direction, completely separate from microphone input (TRAVELLER →
// CLOCKWISE). Only ever invoked through performEscalation
// (src/lib/voice-escalation/perform-escalation.ts), which both the
// human-pressed button (src/app/escalation-actions.ts) and Gemini's own
// escalate_via_voice_call tool (src/lib/agent/tools.ts) call into — never
// directly, and never any other path that could place a call without
// going through performEscalation's checks. GnaniVoiceProvider is the
// real implementation; a demo simulation stands in until real
// credentials are confirmed working.

export type EscalationCallInput = {
  travellerName: string;
  phone: string; // digits only, no country code
  countryCode: string; // e.g. "+91"
  clientReferenceId: string; // our EscalationEvent.id, for correlating the webhook back
};

export type EscalationCallResult =
  | { placed: true; providerConversationId: string }
  | { placed: false; reason: string };

export type EscalationOutcome = {
  callStatus: string;
  disposition: string | null;
  transcript: string | null;
};

export interface VoiceEscalationProvider {
  initiateCall(input: EscalationCallInput): Promise<EscalationCallResult>;
  getCallStatus(providerConversationId: string): Promise<EscalationOutcome | null>;
}
