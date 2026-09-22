// Plain config, not a server action — "use server" files may only export
// async functions, so this lives separately from escalation-actions.ts.
export const SIMULATED_RESPONSES = {
  LEFT: { disposition: "LEFT", estimatedDelayMinutes: 0, transcript: "Left already." },
  DELAY_10: { disposition: "DELAYED", estimatedDelayMinutes: 10, transcript: "Leaving in 10 min." },
  DELAY_20: { disposition: "DELAYED", estimatedDelayMinutes: 20, transcript: "Leaving in 20 min." },
  CANT_MAKE_IT: { disposition: "CANNOT_MAKE_IT", estimatedDelayMinutes: null, transcript: "Can't make it." },
} as const;

export type SimulatedResponseKey = keyof typeof SIMULATED_RESPONSES;

export const SIMULATED_RESPONSE_LABELS: Record<SimulatedResponseKey, string> = {
  LEFT: "Left already",
  DELAY_10: "Leaving in 10 min",
  DELAY_20: "Leaving in 20 min",
  CANT_MAKE_IT: "Can't make it",
};
