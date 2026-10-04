"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { MONTHS, pad, toStr, parse, todayStr, rangeSummary, resolvedMoment } from "@/lib/dates";

export { rangeSummary, resolvedMoment, todayStr };

// Calendars for exact dates. Thumb-sized day cells (44px), month at a time, no typing a format.
// Dates are plain "YYYY-MM-DD" strings and times "HH:mm"; all arithmetic is in UTC so a device's timezone can
// never shift a day.

const WEEK = ["M", "T", "W", "T", "F", "S", "S"];

function Month({ ym, onPrev, onNext, canPrev, cell }: { ym: { y: number; m: number }; onPrev: () => void; onNext: () => void; canPrev: boolean; cell: (dateStr: string) => React.ReactNode }) {
  const first = new Date(Date.UTC(ym.y, ym.m, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const days = new Date(Date.UTC(ym.y, ym.m + 1, 0)).getUTCDate();
  return (
    <div>
      <div className="flex items-center justify-between">
        <button type="button" aria-label="Previous month" disabled={!canPrev} onClick={onPrev} className="flex size-11 cursor-pointer items-center justify-center rounded-full hover:bg-surface-muted disabled:opacity-30">
          <ChevronLeft className="size-5" />
        </button>
        <p className="font-display text-[20px] tracking-[-0.01em]">
          {MONTHS[ym.m]} {ym.y}
        </p>
        <button type="button" aria-label="Next month" onClick={onNext} className="flex size-11 cursor-pointer items-center justify-center rounded-full hover:bg-surface-muted">
          <ChevronRight className="size-5" />
        </button>
      </div>
      <div className="mt-1 grid grid-cols-7 text-center text-[11px] font-semibold tracking-[0.1em] text-muted-foreground">
        {WEEK.map((w, i) => (
          <span key={i} className="py-1.5">
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {Array.from({ length: lead }, (_, i) => (
          <span key={`l${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => cell(toStr(ym.y, ym.m, i + 1)))}
      </div>
    </div>
  );
}

function useMonth(initial: string | undefined) {
  const base = initial ? parse(initial) : parse(todayStr());
  const [ym, setYm] = useState({ y: base.y, m: base.m });
  const shift = (d: number) => setYm((c) => {
    const t = new Date(Date.UTC(c.y, c.m + d, 1));
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() };
  });
  return { ym, prev: () => shift(-1), next: () => shift(1) };
}

// A trip's range: tap the first day, then the last.
export function RangeCalendar({ start, end, onChange, minDate = todayStr() }: { start: string; end: string; onChange: (start: string, end: string) => void; minDate?: string }) {
  const { ym, prev, next } = useMonth(start || undefined);
  const canPrev = ym.y * 12 + ym.m > parse(minDate).y * 12 + parse(minDate).m;
  const pick = (d: string) => {
    if (!start || (start && end)) onChange(d, "");
    else if (d < start) onChange(d, "");
    else onChange(start, d);
  };
  return (
    <div data-range-calendar>
      <Month
        ym={ym}
        onPrev={prev}
        onNext={next}
        canPrev={canPrev}
        cell={(d) => {
          const disabled = d < minDate;
          const isStart = d === start;
          const isEnd = d === end;
          const inside = Boolean(start && end && d > start && d < end);
          return (
            <button
              key={d}
              type="button"
              disabled={disabled}
              onClick={() => pick(d)}
              aria-label={d}
              aria-pressed={isStart || isEnd}
              data-day={d}
              className={`relative flex aspect-square min-h-11 cursor-pointer items-center justify-center text-[15px] transition-colors disabled:cursor-not-allowed disabled:opacity-25 ${inside ? "bg-accent-tint" : ""} ${isStart && end ? "rounded-l-full bg-accent-tint" : ""} ${isEnd ? "rounded-r-full bg-accent-tint" : ""}`}
            >
              <span className={`flex size-10 items-center justify-center rounded-full ${isStart || isEnd ? "bg-accent font-semibold text-accent-foreground" : "hover:bg-surface-muted"}`}>{parse(d).d}</span>
            </button>
          );
        }}
      />
      <p className="mt-3 min-h-6 text-center font-display text-[18px] tracking-[-0.01em]" data-range-summary>
        {start && end ? rangeSummary(start, end) : start ? "Now tap your last day" : "Tap your first day"}
      </p>
    </div>
  );
}

// One moment: a day and a time, shown back in full ("SAT, 12 DEC · 8:00 PM") before it is used.
export function DateTimeField({ label, value, onChange, minDate = todayStr(), withTime = true }: { label: string; value: string; onChange: (local: string) => void; minDate?: string; withTime?: boolean }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(value ? value.slice(0, 10) : "");
  const initialH = value ? Number(value.slice(11, 13)) : 20;
  const [hour12, setHour12] = useState(initialH % 12 === 0 ? 12 : initialH % 12);
  const [minute, setMinute] = useState(value ? Number(value.slice(14, 16)) : 0);
  const [pm, setPm] = useState(initialH >= 12);
  const { ym, prev, next } = useMonth(date || undefined);
  const canPrev = ym.y * 12 + ym.m > parse(minDate).y * 12 + parse(minDate).m;
  const local = useMemo(() => {
    if (!date) return "";
    const h = (hour12 % 12) + (pm ? 12 : 0);
    return `${date}T${pad(h)}:${pad(minute)}`;
  }, [date, hour12, minute, pm]);

  return (
    <div>
      <span className="eyebrow">{label}</span>
      <button type="button" onClick={() => setOpen(true)} data-datetime-field className="mt-1 flex min-h-12 w-full cursor-pointer items-center justify-between rounded-xl border border-border bg-surface px-4 text-left text-[15px] hover:border-foreground/40">
        <span className={value ? "font-semibold" : "text-muted-foreground"}>{value ? (withTime ? resolvedMoment(value) : resolvedMoment(`${value.slice(0, 10)}T00:00`).split(" · ")[0]) : withTime ? "Choose a day and time" : "Choose a day"}</span>
        <span className="text-[11px] tracking-[0.12em] text-muted-foreground">CHANGE</span>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => setOpen(false)}>
          <div className="max-h-[92vh] w-full max-w-sm overflow-y-auto rounded-t-2xl bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:rounded-2xl" onClick={(e) => e.stopPropagation()} data-datetime-sheet>
            <div className="flex items-center justify-between">
              <p className="eyebrow">{label}</p>
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="flex size-11 cursor-pointer items-center justify-center rounded-full hover:bg-surface-muted">
                <X className="size-5" />
              </button>
            </div>
            <Month
              ym={ym}
              onPrev={prev}
              onNext={next}
              canPrev={canPrev}
              cell={(d) => (
                <button key={d} type="button" disabled={d < minDate} onClick={() => setDate(d)} data-day={d} aria-pressed={d === date} className="flex aspect-square min-h-11 cursor-pointer items-center justify-center disabled:cursor-not-allowed disabled:opacity-25">
                  <span className={`flex size-10 items-center justify-center rounded-full text-[15px] ${d === date ? "bg-accent font-semibold text-accent-foreground" : "hover:bg-surface-muted"}`}>{parse(d).d}</span>
                </button>
              )}
            />
            {withTime && (
              <div className="mt-3 flex items-center justify-center gap-2" data-time-picker>
                <select aria-label="Hour" value={hour12} onChange={(e) => setHour12(Number(e.target.value))} className="min-h-12 rounded-xl border border-border bg-surface px-3 text-[18px]">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                <span className="text-[18px]">:</span>
                <select aria-label="Minute" value={minute} onChange={(e) => setMinute(Number(e.target.value))} className="min-h-12 rounded-xl border border-border bg-surface px-3 text-[18px]">
                  {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => (
                    <option key={m} value={m}>
                      {pad(m)}
                    </option>
                  ))}
                </select>
                <div className="flex overflow-hidden rounded-xl border border-border">
                  {(["AM", "PM"] as const).map((x) => (
                    <button key={x} type="button" onClick={() => setPm(x === "PM")} aria-pressed={pm === (x === "PM")} className={`min-h-12 min-w-14 cursor-pointer text-[14px] font-semibold ${pm === (x === "PM") ? "bg-accent text-accent-foreground" : ""}`}>
                      {x}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <p className="mt-3 text-center font-display text-[20px] tracking-[-0.01em]" data-resolved>
              {date ? (withTime ? resolvedMoment(local) : resolvedMoment(`${date}T00:00`).split(" · ")[0]) : "Pick a day"}
            </p>
            <button
              type="button"
              disabled={!date}
              onClick={() => {
                onChange(withTime ? local : `${date}T00:00`);
                setOpen(false);
              }}
              className="mt-3 min-h-12 w-full cursor-pointer rounded-full bg-accent text-[13px] font-semibold tracking-[0.14em] text-accent-foreground disabled:opacity-50"
            >
              SET
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
