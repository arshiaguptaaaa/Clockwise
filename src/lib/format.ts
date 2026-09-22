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
