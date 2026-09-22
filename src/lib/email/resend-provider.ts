import { Resend } from "resend";
import type { EmailProvider, SendEmailInput, SendEmailResult } from "./types";

const DEFAULT_FROM = "Clockwise <onboarding@resend.dev>";

// The only implementation of EmailProvider. Honestly reports
// { sent: false, reason: "..." } rather than throwing or pretending to
// succeed when RESEND_API_KEY is missing or the send itself fails — never
// fake a delivered email.
class ResendEmailProvider implements EmailProvider {
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.warn(`RESEND_API_KEY not configured — email "${input.subject}" to ${input.to} was not sent.`);
      return { sent: false, reason: "RESEND_API_KEY not configured" };
    }

    try {
      const resend = new Resend(apiKey);
      const from = process.env.RESEND_FROM_EMAIL || DEFAULT_FROM;
      const result = await resend.emails.send({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
      });
      if (result.error) {
        return { sent: false, reason: result.error.message };
      }
      return { sent: true, id: result.data?.id ?? "unknown" };
    } catch (err) {
      return { sent: false, reason: err instanceof Error ? err.message : "Unknown email error" };
    }
  }
}

export const emailProvider: EmailProvider = new ResendEmailProvider();
