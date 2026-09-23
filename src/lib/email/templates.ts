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

export function tripInviteEmail(params: {
  inviterName: string;
  tripName: string;
  inviteUrl: string;
}): { subject: string; html: string } {
  const inviterName = escapeHtml(params.inviterName);
  const tripName = escapeHtml(params.tripName);
  // inviteUrl is server-constructed (getAppBaseUrl() + a random token, see
  // src/lib/invite-token.ts) — never raw user input, safe to embed as an
  // href without separate escaping.
  return {
    subject: `${params.inviterName} invited you to ${params.tripName} on Clockwise`,
    html: `${WRAPPER_START}${WORDMARK}
      <p>Hi,</p>
      <p><strong>${inviterName}</strong> invited you to join <strong>${tripName}</strong> on Clockwise.</p>
      <p>Clockwise helps a group coordinate a trip together without turning one friend into the full-time operations manager.</p>
      <p style="margin-top: 20px;">
        <a href="${params.inviteUrl}" style="display: inline-block; padding: 11px 22px; background: #163a2c; color: #ffffff; text-decoration: none; border-radius: 999px; font-weight: 600; font-size: 14px;">Join the trip</a>
      </p>
      <p style="color: #6b716c; font-size: 12px; margin-top: 20px;">Or paste this link into your browser:<br/>${params.inviteUrl}</p>
    ${WRAPPER_END}`,
  };
}

export function tripJoinConfirmationEmail(params: { tripName: string }): { subject: string; html: string } {
  const tripName = escapeHtml(params.tripName);
  return {
    subject: `You're in — ${params.tripName}`,
    html: `${WRAPPER_START}${WORDMARK}
      <p>Hi,</p>
      <p>You've joined <strong>${tripName}</strong> on Clockwise.</p>
      <p>Head to Trip Room to say hello to the group, and My Clockwise for anything you'd rather keep private — schedule, budget, preferences, or anything else.</p>
      <p style="color: #6b716c; margin-top: 24px;">Clockwise</p>
    ${WRAPPER_END}`,
  };
}

export function tripJoinNotificationEmail(params: {
  inviteeName: string;
  tripName: string;
  joinedAt: Date;
}): { subject: string; html: string } {
  const inviteeName = escapeHtml(params.inviteeName);
  const tripName = escapeHtml(params.tripName);
  const joinedAt = params.joinedAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

  return {
    subject: `${params.inviteeName} joined ${params.tripName}`,
    html: `${WRAPPER_START}${WORDMARK}
      <p><strong>${inviteeName}</strong> just joined <strong>${tripName}</strong> via their invite link.</p>
      <p><strong>Joined:</strong><br/>${joinedAt}</p>
    ${WRAPPER_END}`,
  };
}
