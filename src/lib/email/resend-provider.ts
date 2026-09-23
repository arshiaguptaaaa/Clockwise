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
        // Logged here too, not just returned — a caller's console.warn
        // already includes `reason`, but logging the from address and
        // Resend's own error `name` (not just `message`) right at the
        // send site makes a Vercel Function Log check for "did this
        // actually go out" unambiguous without cross-referencing two
        // files. Never logs the API key or the email body/html.
        console.error(
          `[ResendEmailProvider] send FAILED — from=${from} to=${input.to} subject="${input.subject}" error=${result.error.name}: ${result.error.message}`
        );
        return { sent: false, reason: result.error.message };
      }
      // Success was previously never logged at all — "no error in the
      // logs" was not distinguishable from "this code path never ran."
      // result.data.id is Resend's own message id, safe to log (not a
      // secret, and it's the exact id you'd look up in the Resend
      // dashboard's own Logs/Emails view to confirm delivery status).
      console.log(
        `[ResendEmailProvider] send OK — from=${from} to=${input.to} subject="${input.subject}" resendId=${result.data?.id ?? "unknown"}`
      );
      return { sent: true, id: result.data?.id ?? "unknown" };
    } catch (err) {
      console.error(
        `[ResendEmailProvider] send THREW — to=${input.to} subject="${input.subject}" error=${err instanceof Error ? err.message : "unknown"}`
      );
      return { sent: false, reason: err instanceof Error ? err.message : "Unknown email error" };
    }
  }
}

export const emailProvider: EmailProvider = new ResendEmailProvider();
