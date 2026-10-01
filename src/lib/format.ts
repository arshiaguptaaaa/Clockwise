export function formatDateRange(
  start: Date,
  end: Date,
  style: "long" | "short" = "long"
) {
  const month: Intl.DateTimeFormatOptions["month"] =
    style === "long" ? "long" : "short";
  const startStr = start.toLocaleDateString("en-GB", {
    day: "numeric",
    month: sameMonth(start, end) ? undefined : month,
    timeZone: "UTC",
  });
  const endStr = end.toLocaleDateString("en-GB", {
    day: "numeric",
    month,
    timeZone: "UTC",
  });
  return `${startStr} – ${endStr}`;
}

function sameMonth(a: Date, b: Date) {
  return a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear();
}

// A trip-wizard-created stop only ever carries a date (midnight UTC); an
// activity confirmed through chat (e.g. "Amber Fort, 9:30") carries a real
// time. Distinguishing the two means the Plan can show "09:30" for the
// latter without ever showing a fabricated "00:00" for the former.
export function hasTimeOfDay(date: Date): boolean {
  return date.getUTCHours() !== 0 || date.getUTCMinutes() !== 0;
}

export function formatTimeOfDay(date: Date): string {
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}
