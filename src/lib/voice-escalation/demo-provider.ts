// Clearly-labelled simulation, used only when Gnani isn't configured.
// Never presented as a real call anywhere in the UI (see EscalationEvent
// .mode and the "GNANI — DEMO MODE" labelling in the Travellers tab) — it
// exists purely to demonstrate Clockwise's downstream reasoning
// (readiness recalculation) once a real outcome is known, without ever
// claiming a real phone actually rang.
import type { EscalationCallInput, EscalationCallResult, EscalationOutcome, VoiceEscalationProvider } from "./types";

class DemoVoiceEscalationProvider implements VoiceEscalationProvider {
  async initiateCall(input: EscalationCallInput): Promise<EscalationCallResult> {
    return { placed: true, providerConversationId: `demo-${input.clientReferenceId}` };
  }

  async getCallStatus(): Promise<EscalationOutcome | null> {
    // Demo outcomes are set directly by the operator picking a simulated
    // response (see simulateEscalationResponse) — there's nothing to poll.
    return null;
  }
}

export const demoVoiceEscalationProvider: VoiceEscalationProvider = new DemoVoiceEscalationProvider();
