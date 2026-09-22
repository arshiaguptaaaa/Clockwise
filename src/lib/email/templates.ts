// Plain, simple HTML — deliberately not "marketing spam," per spec. Values
// interpolated from user input (email, source) are HTML-escaped since this
// renders as real HTML in a real inbox.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const WRAPPER_START = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif; max-width: 480px; margin: 0 auto; color: #14181a; line-height: 1.6;">`;
const WRAPPER_END = `</div>`;
const WORDMARK = `<p style="font-size: 12px; letter-spacing: 0.15em; text-transform: uppercase; color: #6b716c; margin: 0 0 24px;">CLOCKWISE</p>`;

export function waitlistConfirmationEmail(): { subject: string; html: string } {
  return {
    subject: "You're on the Clockwise list",
    html: `${WRAPPER_START}${WORDMARK}
      <p>Hi,</p>
      <p>You're in.</p>
      <p>We're building Clockwise to make group travel easier to coordinate without turning one friend into the group's full-time operations manager.</p>
      <p>We'll let you know when early access opens.</p>
      <p>Until then:</p>
      <p style="font-weight: 600;">Travel together. Further.</p>
      <p style="color: #6b716c; margin-top: 24px;">Clockwise</p>
    ${WRAPPER_END}`,
  };
}

export function waitlistNotificationEmail(params: {
  email: string;
  signedUpAt: Date;
  source: string | null;
  totalCount: number;
}): { subject: string; html: string } {
  const email = escapeHtml(params.email);
  const source = params.source ? escapeHtml(params.source) : "Direct / not specified";
  const signedUp = params.signedUpAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

  return {
    subject: "New Clockwise waitlist signup",
    html: `${WRAPPER_START}${WORDMARK}
      <p>Someone just joined the Clockwise early-access list.</p>
      <p><strong>Email:</strong><br/>${email}</p>
      <p><strong>Signed up:</strong><br/>${signedUp}</p>
      <p><strong>Source:</strong><br/>${source}</p>
      <p><strong>Total waitlist:</strong><br/>${params.totalCount}</p>
    ${WRAPPER_END}`,
  };
}
