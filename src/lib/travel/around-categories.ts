// Client-safe copy of the Around You categories (no server imports).
export const AROUND_CATEGORIES: Record<string, { label: string; icon: string }> = {
  cafe: { label: "Cafés", icon: "☕" },
  restaurant: { label: "Food", icon: "🍜" },
  convenience: { label: "Convenience", icon: "🛒" },
  supermarket: { label: "Supermarkets", icon: "🛒" },
  pharmacy: { label: "Pharmacies", icon: "💊" },
  atm: { label: "ATMs", icon: "🏧" },
  shopping: { label: "Shopping", icon: "🛍" },
  attraction: { label: "Attractions", icon: "🏛" },
  park: { label: "Parks & nature", icon: "🌿" },
  nightlife: { label: "Nightlife", icon: "🌙" },
};
