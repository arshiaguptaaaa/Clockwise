// Pure rules for changing one's own arrival. No database, no model — these decide
// when a spoken time is safe to apply and when Clockwise must ASK instead.
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const toMs = (l: string) => new Date(`${l}:00.000Z`).getTime();
const toLocal = (ms: number) => new Date(ms).toISOString().slice(0, 16);

export type ArrivalDecision = { ok: true; newLocal: string; movedMinutes: number } | { ok: false; ask: string };

// An arrival that moves EARLIER by more than this is far more likely to be an AM/PM
// misreading than a real change ("8:15" heard as 08:15 for someone landing 18:30).
export const MAX_EARLIER_MINUTES = 3 * 60;

export function resolveNewArrival(oldLocal: string | null, input: { arrivalTime?: string; arrivalDate?: string }): ArrivalDecision {
  const time = input.arrivalTime?.trim();
  if (!time || !HHMM.test(time)) return { ok: false, ask: "I need the new arrival time in 24-hour form (e.g. 20:15). Ask the traveller whether they mean morning or evening." };
  const date = input.arrivalDate?.trim() || oldLocal?.slice(0, 10);
  if (!date || !DATE.test(date)) return { ok: false, ask: "I don't know which day they arrive — ask the traveller for the date." };
  const newLocal = `${date}T${time}`;
  if (!LOCAL.test(newLocal)) return { ok: false, ask: "That date or time isn't valid — ask the traveller to repeat it." };
  if (!oldLocal) return { ok: true, newLocal, movedMinutes: 0 };
  const moved = Math.round((toMs(newLocal) - toMs(oldLocal)) / 60_000);
  if (moved === 0) return { ok: false, ask: "That is the arrival time already on record — nothing to change." };
  if (moved < -MAX_EARLIER_MINUTES) {
    return { ok: false, ask: `That would move the arrival EARLIER by about ${Math.round(-moved / 60)} hours. Ask whether they meant ${time.slice(0, 2) === "12" ? "midnight" : `${String((Number(time.slice(0, 2)) + 12) % 24).padStart(2, "0")}${time.slice(2)}`} (evening) instead — do not change anything until they answer.` };
  }
  return { ok: true, newLocal, movedMinutes: moved };
}

// Smallest quarter-hour at or after `local` — the proposed commitment time, so a
// suggestion is never an arbitrary model-invented number.
export function ceilToQuarter(local: string): string {
  const ms = toMs(local);
  const q = 15 * 60_000;
  return toLocal(Math.ceil(ms / q) * q);
}
