// Money helpers. Everything is integer minor units in the ORIGINAL currency.
export const CATEGORIES = ["STAYS", "TRANSPORT", "FOOD", "ACTIVITIES", "SHOPPING", "OTHER"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABEL: Record<Category, string> = {
  STAYS: "Stay",
  TRANSPORT: "Transport",
  FOOD: "Food",
  ACTIVITIES: "Activities",
  SHOPPING: "Shopping",
  OTHER: "Other",
};

export function isCategory(v: unknown): v is Category {
  return typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);
}

const SYMBOL: Record<string, string> = { INR: "₹", EUR: "€", USD: "$", GBP: "£", JPY: "¥", AED: "AED " };

// 25800 paise -> "₹258"; whole units drop the decimals, otherwise two places.
export function formatMoney(minor: number, currency: string): string {
  const major = minor / 100;
  const whole = Number.isInteger(major);
  const num = major.toLocaleString(currency === "INR" ? "en-IN" : "en-GB", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${minor < 0 ? "−" : ""}${SYMBOL[currency] ?? `${currency} `}${num.replace("-", "")}`;
}

// "6,000" / "6000.50" / "₹6,000" -> 600000 minor units, or null if unparseable.
export function parseMajorToMinor(input: string | number): number | null {
  const cleaned = String(input).replace(/[^\d.]/g, "");
  if (!cleaned || cleaned === ".") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

// Deterministic keyword guess for a category — a convenience default the user
// can change, never a claim about the purchase.
export function guessCategory(text: string): Category {
  const t = text.toLowerCase();
  if (/hotel|resort|stay|hostel|homestay|villa|airbnb|lodg|room/.test(t)) return "STAYS";
  if (/flight|train|bus\b|taxi|cab\b|uber|ola\b|transfer|ticket to|metro|fuel|toll|rental car/.test(t)) return "TRANSPORT";
  if (/dinner|lunch|breakfast|brunch|cafe|café|restaurant|food|drinks|bar\b|snack|coffee/.test(t)) return "FOOD";
  if (/entry|tour|safari|museum|palace|fort|show|activity|boat|spa|class|trek|pass\b/.test(t)) return "ACTIVITIES";
  if (/shop|market|souvenir|gift/.test(t)) return "SHOPPING";
  return "OTHER";
}
