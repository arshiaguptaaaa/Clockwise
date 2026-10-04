// Clockwise's own voice: short, dry, original lines. A restrained library, chosen
// deterministically (so a trip keeps the same line instead of flickering on refresh).
// Nothing here is an external quotation, and none of it ever replaces real information.

const NUMBER_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const word = (n: number) => NUMBER_WORDS[n] ?? String(n);

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function tripTagline(seed: string, facts: { days: number | null; people: number; destination: string | null }): string {
  const dest = facts.destination ?? "This trip";
  const bengaluru = /bengaluru|bangalore/i.test(dest);
  const lines: string[] = [
    facts.days && facts.people > 1 ? `${word(facts.days)} ${facts.days === 1 ? "day" : "days"}. ${word(facts.people)} opinions. One functioning itinerary.` : "One trip. Many clocks.",
    "Everyone said they were flexible. They were not.",
    "Different flights. Same dinner.",
    "The best group trips are slightly impossible.",
    bengaluru ? "Bengaluru runs on coffee, traffic and questionable ETAs." : `${dest} won't plan itself. We'll help.`,
  ];
  return lines[hash(seed) % lines.length];
}

export type InterludeCopy = { lines: string[]; small?: string };

export const INTERLUDES: Record<string, InterludeCopy> = {
  impossible: { lines: ["The best group trips", "are slightly impossible."], small: "Clockwise handles the impossible bit." },
  flexible: { lines: ["Everyone said", "they were flexible."], small: "They were not." },
  bengaluru: { lines: ["Bengaluru runs", "on coffee, traffic", "and questionable ETAs."], small: "We have already priced in the traffic." },
};

export const HUMAN = {
  savedEmpty: "Nothing yet. Your standards are intimidating.",
  unanimous: "Miraculously unanimous.",
  clocksAgree: "For once, everyone's clocks agree.",
  lookingAt: (name: string) => `We're looking at you, ${name}.`,
  noBrand: (brand: string, city: string | null) => `No ${brand}. ${city ?? "This place"} has other plans.`,
} as const;
