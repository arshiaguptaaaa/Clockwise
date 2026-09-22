// Auto-generated trip title from destinations, used as the Review screen's
// default (editable) name — matches "don't make this a long form": no
// separate required naming step.
export function suggestTripName(destinations: string[]): string {
  const clean = destinations.map((d) => d.trim()).filter(Boolean);
  if (clean.length === 0) return "New Trip";
  if (clean.length <= 2) return clean.join(" & ");
  if (clean.length === 3) return `${clean[0]}, ${clean[1]} & ${clean[2]}`;
  return `${clean[0]}, ${clean[1]} & ${clean.length - 2} more`;
}
