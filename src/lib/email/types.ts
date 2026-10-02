// Provider-agnostic, mirroring the AgentModelProvider pattern already used
// for Gemini — the waitlist flow calls this interface, never a vendor SDK
// directly, so the email vendor can change without touching call sites.
export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  // Plain-text alternative (improves deliverability and accessibility).
  text?: string;
  // Sent to the provider so a retried request can't deliver twice.
  idempotencyKey?: string;
};

export type SendEmailResult =
  | { sent: true; id: string }
  | { sent: false; reason: string };

export interface EmailProvider {
  send(input: SendEmailInput): Promise<SendEmailResult>;
}
