import { Leaf, Coffee, Heart, UtensilsCrossed, Compass, Star, Ban, CalendarClock, MapPin, type LucideIcon } from "lucide-react";
import { ForgetButton } from "./ForgetButton";

// One thing Clockwise remembers, as a small tinted note: a clean icon, a category word, the thing itself, and where
// it came from. Quiet on purpose: memory, not a plan item.
type Look = { label: string; Icon: LucideIcon; tint: string; ink: string };

const FOODISH = /\b(dosa|dosai|idli|biryani|thali|coffee|chai|tea|food|brunch|breakfast|lunch|dinner|cake|dessert|pizza|momos?|chaat|south indian|street food|sweets?|cafes?|cafés?)\b/i;

export function lookFor(kind: string, subject: string): Look {
  switch (kind) {
    case "DIET":
      return { label: "Food", Icon: Leaf, tint: "bg-tint-sage", ink: "text-accent-strong" };
    case "LIKE":
      return /coffee|cafe|café|chai|tea/i.test(subject) ? { label: "Into", Icon: Coffee, tint: "bg-tint-honey", ink: "text-[#7a5a12]" } : { label: "Into", Icon: Heart, tint: "bg-tint-blush", ink: "text-[#9a3b5b]" };
    case "WANT":
      return FOODISH.test(subject) ? { label: "Wants to try", Icon: UtensilsCrossed, tint: "bg-tint-honey", ink: "text-[#7a5a12]" } : { label: "Wants to do", Icon: Compass, tint: "bg-tint-sky", ink: "text-[#2b4a99]" };
    case "MUST":
      return { label: "A must", Icon: Star, tint: "bg-tint-blush", ink: "text-[#9a3b5b]" };
    case "AVOID":
      return { label: "Not keen on", Icon: Ban, tint: "bg-tint-clay", ink: "text-[#8a4a2c]" };
    case "WINDOW":
      return { label: "Keeping free", Icon: CalendarClock, tint: "bg-tint-sage", ink: "text-accent-strong" };
    case "MEET":
      return { label: "Meeting at", Icon: MapPin, tint: "bg-tint-sky", ink: "text-[#2b4a99]" };
    default:
      return { label: "Noted", Icon: Heart, tint: "bg-surface-muted", ink: "text-foreground" };
  }
}

const title = (s: string) => s.replace(/\b([a-z])/g, (c) => c.toUpperCase());

export function PointerCard({ kind, subject, who, extra, forgetId, source = "from the Trip Room" }: { kind: string; subject: string; who?: string; extra?: string | null; forgetId?: string | null; source?: string }) {
  const { label, Icon, tint, ink } = lookFor(kind, subject);
  return (
    <li className={`cw-note relative ${tint} list-none`} data-pointer={subject} data-pointer-kind={kind}>
      <p className={`flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.18em] ${ink}`}>
        <Icon className="size-[14px]" strokeWidth={1.8} aria-hidden /> {label}
      </p>
      <p className="font-display text-[19px] leading-[1.15] tracking-[-0.01em] text-foreground">{title(subject)}</p>
      <p className="text-[11.5px] leading-snug text-muted-foreground">
        {who ? `${who} · ` : ""}
        {source}
        {extra ? ` · ${extra}` : ""}
      </p>
      {forgetId && (
        <span className="absolute right-1 top-1">
          <ForgetButton pointerId={forgetId} />
        </span>
      )}
    </li>
  );
}
