// An expense is named from the speaker's OWN words. If the model's title uses words that were never said ("Tickets for two"
// from an earlier message, "Dinner" from nowhere), it is replaced by a neutral description and the card says so.
const STOP = new Set(["the", "a", "an", "for", "of", "to", "and", "our", "my", "their", "we", "us", "both", "all", "paid", "pay", "split", "bill", "expense", "payment", "cost", "total"]);
const toks = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

export function groundedTitle(spoken: string, modelTitle: string, payerFirstName: string): { title: string; grounded: boolean } {
  const said = new Set(toks(spoken).map((w) => w.replace(/s$/, "")));
  const want = toks(modelTitle).map((w) => w.replace(/s$/, ""));
  if (want.length > 0 && want.every((w) => said.has(w))) return { title: modelTitle.trim(), grounded: true };
  return { title: `Expense paid by ${payerFirstName}`, grounded: false };
}
