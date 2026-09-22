// VoiceEscalationProvider — the CLOCKWISE → TRAVELLER outbound-call
// direction, completely separate from microphone input (TRAVELLER →
// CLOCKWISE). Only ever invoked by the deterministic escalation flow
// (src/app/escalation-actions.ts), never by Gemini deciding to call
// someone. GnaniVoiceProvider is the real implementation; a demo
// simulation stands in until real credentials are confirmed working.

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
