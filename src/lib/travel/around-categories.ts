// Client-safe copy of the Around You categories (no server imports).
export const AROUND_CATEGORIES: Record<string, { label: string; icon: string }> = {
  cafe: { label: "Coffee", icon: "☕" },
  restaurant: { label: "Food", icon: "🍜" },
  attraction: { label: "Things to do", icon: "🏛" },
  convenience: { label: "Convenience", icon: "🛒" },
  pharmacy: { label: "Pharmacy", icon: "💊" },
  shopping: { label: "Shopping", icon: "🛍" },
  atm: { label: "ATM", icon: "🏧" },
  supermarket: { label: "Supermarkets", icon: "🛒" },
  museum: { label: "Museums", icon: "🖼" },
  park: { label: "Parks & nature", icon: "🌿" },
  nightlife: { label: "Nightlife", icon: "🌙" },
};

const WORDS = ["", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT"];
export const countWord = (n: number) => WORDS[n] ?? String(n);
// "Three" for sentence use (the all-caps form is kept for the existing exports).
export const countWordTitle = (n: number) => { const w = countWord(n); return w.charAt(0) + w.slice(1).toLowerCase(); };

// Editorial headline above a category's results: discovery, not "Results (8)".
export const CATEGORY_HEADLINE: Record<string, string> = {
  cafe: "A good morning starts somewhere.",
  restaurant: "Somewhere good to sit down.",
  attraction: "Worth the detour.",
  park: "Room to breathe.",
  museum: "Out of the sun for an hour.",
  shopping: "For the bags you swore you wouldn't need.",
  nightlife: "The night is young. The ETAs are not.",
};
