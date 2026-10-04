// Pure date helpers shared by the calendars and by server code. Dates are "YYYY-MM-DD", moments "YYYY-MM-DDTHH:mm";
// all arithmetic is in UTC so a device's timezone can never shift a day.
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const MON3 = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
export const DAY3 = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export const pad = (n: number) => String(n).padStart(2, "0");
export const toStr = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
export const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m: m - 1, d };
};
const utcMs = (s: string) => Date.UTC(parse(s).y, parse(s).m, parse(s).d);
export const todayStr = () => {
  const n = new Date();
  return toStr(n.getFullYear(), n.getMonth(), n.getDate());
};
export const nightsBetween = (a: string, b: string) => Math.round((utcMs(b) - utcMs(a)) / 86_400_000);

// "12–15 DEC · 3 NIGHTS"
export function rangeSummary(start: string, end: string): string {
  const a = parse(start);
  const b = parse(end);
  const n = nightsBetween(start, end);
  const span = a.m === b.m && a.y === b.y ? `${a.d}–${b.d} ${MON3[a.m]}` : `${a.d} ${MON3[a.m]} – ${b.d} ${MON3[b.m]}`;
  return `${span} · ${n === 0 ? "SAME DAY" : `${n} NIGHT${n === 1 ? "" : "S"}`}`;
}

// "SAT, 12 DEC · 8:00 PM": the resolved moment, always shown before anything consequential happens.
export function resolvedMoment(local: string): string {
  const [date, time] = local.split("T");
  const p = parse(date);
  const dow = DAY3[new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay()];
  const [h, mm] = (time ?? "00:00").split(":").map(Number);
  return `${dow}, ${p.d} ${MON3[p.m]} · ${h % 12 === 0 ? 12 : h % 12}:${pad(mm)} ${h < 12 ? "AM" : "PM"}`;
}
