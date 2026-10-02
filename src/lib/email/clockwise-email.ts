// Clockwise transactional email — one reusable, email-client-safe layout.
//
// Email HTML is not a web page: this uses nested tables, inline styles only,
// system font stacks (Georgia for the editorial serif — Fraunces can't be
// relied on to load in Gmail/Outlook), a 600px column that collapses on
// phones, a "bulletproof" CTA (a padded table cell, not CSS-dependent), alt
// text-free design (no images to block), a hidden preheader and a plain-text
// twin. No JS, animation, external fonts or absolute positioning.
export type EmailKind =
  | "INVITATION"
  | "REMINDER"
  | "TRIP_UPDATED"
  | "ACTION_REQUIRED"
  | "PAYMENT_REQUIRED"
  | "PAYMENT_CONFIRMED"
  | "TRAVELLER_DELAYED"
  | "PLAN_CHANGED";

export type EmailContent = {
  kind: EmailKind;
  recipientName?: string | null;
  organiserName: string;
  tripName: string;
  destinations: string[];
  ctaUrl: string;
  travellerCount?: number;
  // Free-form copy for the non-invitation kinds.
  headline?: string;
  body?: string;
  ctaLabel?: string;
  // Shown only while a sandbox delivery override is active (see deliver.ts).
  sandboxNote?: string;
};

const GREEN = "#1e4b3a";
const GREEN_DEEP = "#163a2c";
const INK = "#14181a";
const MUTED = "#6b716c";
const RULE = "#e6e8e4";
const TINT = "#f2f6f3";
const SERIF = "Georgia, 'Times New Roman', Times, serif";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function firstName(name?: string | null): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

function routeOf(c: EmailContent): string {
  const stops = c.destinations.filter(Boolean);
  return stops.length > 0 ? stops.join(" → ") : c.tripName;
}

type Copy = { subject: string; preheader: string; headline: string; lead: string; cta: string; closing: string };

function copyFor(c: EmailContent): Copy {
  const route = routeOf(c);
  const who = esc(c.organiserName);
  const name = firstName(c.recipientName);
  switch (c.kind) {
    case "INVITATION":
      return {
        subject: `${c.organiserName} invited you to ${route}`,
        preheader: `${c.organiserName} invited you to join the trip. Everyone can arrive differently — Clockwise keeps the plan together.`,
        headline: `${who} is planning something.`,
        lead: `<strong>${who}</strong> invited you to join the trip.`,
        cta: c.ctaLabel ?? "Join the trip",
        closing: `This invitation was sent because ${who} added you to this Clockwise trip.`,
      };
    case "REMINDER":
      return {
        subject: `Quick nudge — ${c.organiserName} is waiting for you`,
        preheader: `${c.organiserName} is still waiting for you to join ${route}. Takes less than a minute.`,
        headline: `Quick nudge${name ? `, ${esc(name)}` : ""}.`,
        lead: `<strong>${who}</strong> is still waiting for you to join the trip. It takes less than a minute.`,
        cta: c.ctaLabel ?? "Join the trip",
        closing: `You're getting this because ${who} added you to this Clockwise trip and you haven't joined yet.`,
      };
    default: {
      const labels: Record<string, string> = {
        TRIP_UPDATED: "The trip was updated",
        ACTION_REQUIRED: "Something needs your attention",
        PAYMENT_REQUIRED: "A payment is waiting",
        PAYMENT_CONFIRMED: "Payment confirmed",
        TRAVELLER_DELAYED: "Someone's running late",
        PLAN_CHANGED: "The plan changed",
      };
      const headline = c.headline ?? labels[c.kind] ?? "An update from Clockwise";
      return {
        subject: `${headline} — ${route}`,
        preheader: (c.body ?? headline).slice(0, 110),
        headline: esc(headline),
        lead: esc(c.body ?? ""),
        cta: c.ctaLabel ?? "Open the trip",
        closing: `You're getting this because you're on this Clockwise trip.`,
      };
    }
  }
}

export function renderClockwiseEmail(c: EmailContent): { subject: string; html: string; text: string } {
  const copy = copyFor(c);
  const route = routeOf(c);
  const stops = c.destinations.filter(Boolean);
  const routeHtml =
    stops.length > 0
      ? stops
          .map((s) => esc(s.toUpperCase()))
          .join(`<span style="color:${GREEN};padding:0 10px;">&rarr;</span>`)
      : esc(c.tripName.toUpperCase());
  const people =
    c.travellerCount && c.travellerCount > 0
      ? `${esc(c.organiserName)} + ${c.travellerCount} traveller${c.travellerCount === 1 ? "" : "s"}`
      : esc(c.organiserName);
  const url = esc(c.ctaUrl);

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(copy.subject)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#ffffff;">${esc(copy.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;"><tr><td align="center" style="padding:28px 16px 40px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
    <tr><td style="padding:0 4px 28px;font-family:${SANS};font-size:12px;letter-spacing:4px;font-weight:700;color:${GREEN_DEEP};">CLOCKWISE</td></tr>
    <tr><td style="padding:0 4px 18px;font-family:${SERIF};font-size:34px;line-height:40px;color:${INK};font-weight:normal;">${copy.headline}</td></tr>
    <tr><td style="padding:0 0 22px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:2px solid ${GREEN};border-bottom:1px solid ${RULE};background:${TINT};">
        <tr><td align="center" style="padding:26px 12px;font-family:${SERIF};font-size:26px;line-height:34px;letter-spacing:3px;color:${GREEN_DEEP};">${routeHtml}</td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:0 4px 8px;font-family:${SANS};font-size:16px;line-height:25px;color:${INK};">${copy.lead}</td></tr>
    <tr><td style="padding:0 4px 26px;font-family:${SERIF};font-size:16px;line-height:24px;font-style:italic;color:${MUTED};">Everyone can arrive differently.<br>Clockwise keeps the plan together.</td></tr>
    <tr><td align="left" style="padding:0 4px 26px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="center" bgcolor="${GREEN}" style="border-radius:999px;background:${GREEN};">
          <a href="${url}" target="_blank" style="display:inline-block;padding:17px 40px;font-family:${SANS};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">${esc(copy.cta)}</a>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:0 4px 28px;font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED};">${esc(route)} &nbsp;&middot;&nbsp; ${people}</td></tr>
    <tr><td style="padding:18px 4px 0;border-top:1px solid ${RULE};font-family:${SANS};font-size:12px;line-height:19px;color:${MUTED};">
      ${copy.closing}<br><br>
      Button not working? Paste this link into your browser:<br>
      <a href="${url}" target="_blank" style="color:${GREEN};word-break:break-all;">${url}</a>
      ${c.sandboxNote ? `<br><br><span style="color:#b5432e;">${esc(c.sandboxNote)}</span>` : ""}
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;

  const plain = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
  const text = [
    "CLOCKWISE",
    "",
    plain(copy.headline),
    "",
    route.toUpperCase(),
    "",
    plain(copy.lead),
    "Everyone can arrive differently. Clockwise keeps the plan together.",
    "",
    `${copy.cta}: ${c.ctaUrl}`,
    "",
    plain(copy.closing),
    c.sandboxNote ? `\n${c.sandboxNote}` : "",
  ]
    .join("\n")
    .trim();

  return { subject: copy.subject, html, text };
}
