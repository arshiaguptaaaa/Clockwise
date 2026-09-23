// Simple, restrained HTML — deliberately not "marketing spam," per spec.
// Inline styles only (no <style> block, no flexbox/grid) since this has to
// render consistently across real inboxes, not just modern browsers. Colors
// reuse the app's own brand tokens (src/app/globals.css) so email and
// product feel like the same thing. Values interpolated from user input
// (email, source, names) are HTML-escaped since this renders as real HTML
// in a real inbox.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

// Matches --page / --surface / --border / --foreground / --muted-foreground
// / --accent-strong / --accent-tint in globals.css.
const PAGE_BG = "#f7f8f6";
const CARD_BG = "#ffffff";
const BORDER = "#e6e8e4";
const FOREGROUND = "#14181a";
const MUTED = "#6b716c";
const ACCENT_STRONG = "#163a2c";
const ACCENT_TINT = "#e8f0ea";

const WRAPPER_START = `<div style="background: ${PAGE_BG}; padding: 40px 16px; font-family: ${FONT_FAMILY};">
  <div style="max-width: 480px; margin: 0 auto; background: ${CARD_BG}; border: 1px solid ${BORDER}; border-radius: 16px; padding: 36px 32px; color: ${FOREGROUND}; line-height: 1.65; font-size: 15px;">`;
const WRAPPER_END = `  </div>
    <p style="max-width: 480px; margin: 20px auto 0; text-align: center; font-size: 11px; color: ${MUTED};">Clockwise</p>
  </div>`;
const WORDMARK = `<p style="font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: ${MUTED}; font-weight: 600; margin: 0 0 28px;">CLOCKWISE</p>`;

function button(label: string, href: string): string {
  return `<p style="margin: 24px 0 0;">
      <a href="${href}" style="display: inline-block; padding: 12px 26px; background: ${ACCENT_STRONG}; color: #ffffff; text-decoration: none; border-radius: 999px; font-weight: 600; font-size: 14px;">${label}</a>
    </p>`;
}

// A labelled value row for the internal/admin notification emails — a
// light shaded block per field reads more like a real notification than a
// wall of plain <p><strong> pairs, while staying table-free/flex-free.
function fieldRow(label: string, value: string): string {
  return `<div style="margin-top: 10px; padding: 10px 14px; background: ${ACCENT_TINT}; border-radius: 10px;">
      <p style="margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: ${MUTED};">${label}</p>
      <p style="margin: 2px 0 0; font-size: 14px; color: ${FOREGROUND};">${value}</p>
    </div>`;
}

export function waitlistConfirmationEmail(): { subject: string; html: string } {
  return {
    subject: "You're on the Clockwise list",
    html: `${WRAPPER_START}${WORDMARK}
      <p style="margin: 0 0 4px;">Hi,</p>
      <p style="margin: 0 0 18px; font-size: 20px; font-weight: 600; color: ${ACCENT_STRONG};">You're in.</p>
      <p>We're building Clockwise to make group travel easier to coordinate without turning one friend into the group's full-time operations manager.</p>
      <p>We'll let you know when early access opens.</p>
      <p style="margin-top: 20px; font-weight: 600;">Travel together. Further.</p>
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
      <p style="margin: 0 0 4px;">Someone just joined the Clockwise early-access list.</p>
      ${fieldRow("Email", email)}
      ${fieldRow("Signed up", signedUp)}
      ${fieldRow("Source", source)}
      ${fieldRow("Total waitlist", String(params.totalCount))}
    ${WRAPPER_END}`,
  };
}

export function tripInviteEmail(params: {
  inviterName: string;
  tripName: string;
  inviteUrl: string;
  destinations?: string[];
}): { subject: string; html: string } {
  const inviterName = escapeHtml(params.inviterName);
  const tripName = escapeHtml(params.tripName);
  const destinations = (params.destinations ?? []).filter(Boolean);
  // inviteUrl is server-constructed (getAppBaseUrl() + a random token, see
  // src/lib/invite-token.ts) — never raw user input, safe to embed as an
  // href without separate escaping.
  return {
    subject: `${params.inviterName} invited you to ${params.tripName} on Clockwise`,
    html: `${WRAPPER_START}${WORDMARK}
      <p style="margin: 0 0 4px;">Hi,</p>
      <p style="margin: 0 0 18px; font-size: 18px; font-weight: 600; color: ${ACCENT_STRONG};"><strong>${inviterName}</strong> invited you to join <strong>${tripName}</strong>.</p>
      ${destinations.length > 0 ? fieldRow("Destination", destinations.map(escapeHtml).join(" → ")) : ""}
      <p style="margin-top: ${destinations.length > 0 ? "16px" : "0"};">Clockwise helps a group coordinate a trip together without turning one friend into the full-time operations manager.</p>
      ${button("Join the trip", params.inviteUrl)}
      <p style="color: ${MUTED}; font-size: 12px; margin-top: 16px; word-break: break-all;">Or paste this link into your browser:<br/>${params.inviteUrl}</p>
    ${WRAPPER_END}`,
  };
}

export function tripJoinConfirmationEmail(params: { tripName: string }): { subject: string; html: string } {
  const tripName = escapeHtml(params.tripName);
  return {
    subject: `You're in — ${params.tripName}`,
    html: `${WRAPPER_START}${WORDMARK}
      <p style="margin: 0 0 4px;">Hi,</p>
      <p style="margin: 0 0 18px; font-size: 20px; font-weight: 600; color: ${ACCENT_STRONG};">You've joined ${tripName}.</p>
      <p>Head to Trip Room to say hello to the group, and My Clockwise for anything you'd rather keep private — schedule, budget, preferences, or anything else.</p>
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
      <p style="margin: 0 0 4px;"><strong>${inviteeName}</strong> just joined <strong>${tripName}</strong> via their invite link.</p>
      ${fieldRow("Joined", joinedAt)}
    ${WRAPPER_END}`,
  };
}
