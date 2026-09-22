"use client";

import { useMemo, useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  X,
  Plus,
  MapPin,
  Calendar,
  CalendarDays,
  CalendarOff,
} from "lucide-react";
import { createTrip } from "@/app/wizard-actions";
import { suggestTripName } from "@/lib/trip-name";
import { formatDateRange } from "@/lib/format";
import { ClockwiseWordmark } from "@/components/ClockwiseWordmark";
import { DestinationAutocomplete } from "@/components/trip-wizard/DestinationAutocomplete";
import type { SelectedDestination } from "@/lib/destination-search/types";

type DateMode = "exact" | "approximate" | "unsure";
type TravellerDraft = { name: string; contact: string };

const STEPS = ["destinations", "dates", "travellers", "review"] as const;
type Step = (typeof STEPS)[number];

function computeDates(mode: DateMode, exactStart: string, exactEnd: string, month: string) {
  if (mode === "exact" && exactStart && exactEnd) {
    return { coreStartDate: exactStart, coreEndDate: exactEnd };
  }
  if (mode === "approximate" && month) {
    const [year, m] = month.split("-").map(Number);
    const start = new Date(Date.UTC(year, m - 1, 1));
    const end = new Date(Date.UTC(year, m, 0)); // last day of month
    return {
      coreStartDate: start.toISOString().slice(0, 10),
      coreEndDate: end.toISOString().slice(0, 10),
    };
  }
  return { coreStartDate: null, coreEndDate: null };
}

export function TripWizard() {
  const [stepIndex, setStepIndex] = useState(0);
  const step: Step = STEPS[stepIndex];

  const [destinations, setDestinations] = useState<SelectedDestination[]>([]);

  const [dateMode, setDateMode] = useState<DateMode>("unsure");
  const [exactStart, setExactStart] = useState("");
  const [exactEnd, setExactEnd] = useState("");
  const [month, setMonth] = useState("");

  const [creatorName, setCreatorName] = useState("");
  const [travellers, setTravellers] = useState<TravellerDraft[]>([]);

  const [tripName, setTripName] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [createError, setCreateError] = useState<string | null>(null);
  const [endDateWasCleared, setEndDateWasCleared] = useState(false);

  const suggestedName = useMemo(
    () => suggestTripName(destinations.map((d) => d.name)),
    [destinations]
  );
  const effectiveTripName = tripName ?? suggestedName;

  function addDestination(destination: SelectedDestination) {
    setDestinations((prev) => [...prev, destination]);
  }

  function isDuplicateDestination(destination: SelectedDestination) {
    return destinations.some((d) =>
      !destination.freeText && !d.freeText
        ? d.providerPlaceId === destination.providerPlaceId
        : d.displayName.toLowerCase() === destination.displayName.toLowerCase()
    );
  }

  function removeDestination(index: number) {
    setDestinations((prev) => prev.filter((_, i) => i !== index));
  }

  function addTraveller() {
    setTravellers((prev) => [...prev, { name: "", contact: "" }]);
  }

  function updateTraveller(index: number, field: keyof TravellerDraft, value: string) {
    setTravellers((prev) =>
      prev.map((t, i) => (i === index ? { ...t, [field]: value } : t))
    );
  }

  function removeTraveller(index: number) {
    setTravellers((prev) => prev.filter((_, i) => i !== index));
  }

  function goNext() {
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }
  function goBack() {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  const isExactRangeInvalid =
    dateMode === "exact" && !!exactStart && !!exactEnd && exactEnd < exactStart;

  function handleStartChange(value: string) {
    setExactStart(value);
    // Never leave a stale end date behind an updated start — that would
    // silently produce an invalid range instead of making the user pick
    // a new end date.
    if (exactEnd && value && exactEnd < value) {
      setExactEnd("");
      setEndDateWasCleared(true);
    }
  }

  function handleEndChange(value: string) {
    setExactEnd(value);
    setEndDateWasCleared(false);
  }

  function handleCreate() {
    if (isExactRangeInvalid) return;
    const { coreStartDate, coreEndDate } = computeDates(dateMode, exactStart, exactEnd, month);
    setCreateError(null);
    startTransition(async () => {
      try {
        await createTrip({
          tripName: effectiveTripName,
          destinations,
          coreStartDate,
          coreEndDate,
          creatorName,
          travellers: travellers.filter((t) => t.name.trim()),
        });
      } catch (err) {
        unstable_rethrow(err);
        setCreateError(
          err instanceof Error ? err.message : "Something went wrong creating the trip."
        );
      }
    });
  }

  const dateSummary =
    dateMode === "exact" && exactStart && exactEnd
      ? formatDateRange(new Date(`${exactStart}T00:00:00Z`), new Date(`${exactEnd}T00:00:00Z`))
      : dateMode === "approximate" && month
        ? new Date(`${month}-01`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
        : "Not decided yet";

  return (
    <main className="flex min-h-screen flex-col bg-page px-6 py-10">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col">
        <div className="mb-6 flex items-center justify-between">
          {stepIndex > 0 ? (
            <button
              type="button"
              onClick={goBack}
              className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Back"
            >
              <ArrowLeft className="size-5" />
            </button>
          ) : (
            <span />
          )}
          <ClockwiseWordmark className="scale-75" />
          <span className="w-5" />
        </div>

        {step === "destinations" && (
          <div className="flex flex-1 flex-col">
            <h1 className="font-serif text-2xl font-medium text-foreground">
              Where are we going?
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Add as many or as few as you know. Clockwise can refine things later.
            </p>

            <div className="mt-6">
              <DestinationAutocomplete onAdd={addDestination} isDuplicate={isDuplicateDestination} />
            </div>

            {destinations.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {destinations.map((d, i) => (
                  <span
                    key={`${d.freeText ? d.displayName : d.providerPlaceId}-${i}`}
                    className="inline-flex items-center gap-1.5 rounded-full bg-accent-tint px-3 py-1.5 text-sm text-accent-strong"
                  >
                    <MapPin className="size-3.5" />
                    {d.displayName}
                    <button
                      type="button"
                      onClick={() => removeDestination(i)}
                      aria-label={`Remove ${d.displayName}`}
                      className="cursor-pointer text-accent-strong/60 hover:text-accent-strong"
                    >
                      <X className="size-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex-1" />
            <button
              type="button"
              onClick={goNext}
              disabled={destinations.length === 0}
              className="mt-8 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue <ArrowRight className="size-4" />
            </button>
          </div>
        )}

        {step === "dates" && (
          <div className="flex flex-1 flex-col">
            <h1 className="font-serif text-2xl font-medium text-foreground">
              When are you thinking?
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Exact dates aren&apos;t required — Clockwise works fine before the group agrees.
            </p>

            <div className="mt-6 flex flex-col gap-2">
              {(
                [
                  {
                    mode: "exact" as const,
                    label: "Exact dates",
                    icon: CalendarDays,
                    example:
                      exactStart && exactEnd && !isExactRangeInvalid
                        ? dateSummary
                        : "12 Dec → 20 Dec",
                  },
                  { mode: "approximate" as const, label: "Approximate", icon: Calendar, example: "December 2026" },
                  { mode: "unsure" as const, label: "Not sure yet", icon: CalendarOff, example: "Decide later" },
                ]
              ).map((opt) => (
                <button
                  key={opt.mode}
                  type="button"
                  onClick={() => setDateMode(opt.mode)}
                  className={`flex w-full cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                    dateMode === opt.mode
                      ? "border-accent bg-accent-tint"
                      : "border-border bg-surface hover:border-accent"
                  }`}
                >
                  <opt.icon className={`size-4 ${dateMode === opt.mode ? "text-accent-strong" : "text-muted-foreground"}`} />
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-foreground">{opt.label}</span>
                    <span className="block text-xs text-muted-foreground">{opt.example}</span>
                  </span>
                </button>
              ))}
            </div>

            {dateMode === "exact" && (
              <div className="mt-4">
                <div className="flex gap-2">
                  <label className="flex-1 text-left">
                    <span className="mb-1 block text-xs font-medium text-muted-foreground">
                      Start date
                    </span>
                    <input
                      type="date"
                      value={exactStart}
                      onChange={(e) => handleStartChange(e.target.value)}
                      className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-foreground focus:border-accent focus:outline-none"
                    />
                  </label>
                  <label className="flex-1 text-left">
                    <span className="mb-1 block text-xs font-medium text-muted-foreground">
                      End date
                    </span>
                    <input
                      type="date"
                      value={exactEnd}
                      min={exactStart || undefined}
                      onChange={(e) => handleEndChange(e.target.value)}
                      className={`w-full rounded-xl border bg-surface px-3 py-2.5 text-sm text-foreground focus:outline-none ${
                        isExactRangeInvalid
                          ? "border-danger focus:border-danger"
                          : "border-border focus:border-accent"
                      }`}
                    />
                  </label>
                </div>

                {endDateWasCleared && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Your end date was before the new start date, so we cleared it — pick a new one.
                  </p>
                )}
                {isExactRangeInvalid && (
                  <p className="mt-2 text-xs text-danger">
                    End date can&apos;t be before the start date.
                  </p>
                )}
                {exactStart && exactEnd && !isExactRangeInvalid && (
                  <p className="mt-2 text-xs text-muted-foreground">{dateSummary}</p>
                )}
              </div>
            )}

            {dateMode === "approximate" && (
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="mt-4 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-foreground focus:border-accent focus:outline-none"
              />
            )}

            <div className="flex-1" />
            <button
              type="button"
              onClick={goNext}
              disabled={dateMode === "exact" && (!exactStart || !exactEnd || isExactRangeInvalid)}
              className="mt-8 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue <ArrowRight className="size-4" />
            </button>
          </div>
        )}

        {step === "travellers" && (
          <div className="flex flex-1 flex-col">
            <h1 className="font-serif text-2xl font-medium text-foreground">
              Who&apos;s coming along?
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Just names for now — everyone shares their own details privately once they join.
            </p>

            <div className="mt-6 flex flex-col gap-2.5">
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  You · Trip organiser
                </p>
                <input
                  value={creatorName}
                  onChange={(e) => setCreatorName(e.target.value)}
                  placeholder="Your name"
                  autoFocus
                  className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
                />
              </div>

              {travellers.map((t, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={t.name}
                    onChange={(e) => updateTraveller(i, "name", e.target.value)}
                    placeholder="Name"
                    className="flex-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
                  />
                  <input
                    value={t.contact}
                    onChange={(e) => updateTraveller(i, "contact", e.target.value)}
                    placeholder="Email or phone"
                    className="flex-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => removeTraveller(i)}
                    aria-label="Remove"
                    className="flex shrink-0 cursor-pointer items-center justify-center text-muted-foreground hover:text-danger"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ))}

              <button
                type="button"
                onClick={addTraveller}
                className="mt-1 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-dashed border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-accent hover:text-accent"
              >
                <Plus className="size-4" /> Add another
              </button>
            </div>

            <div className="flex-1" />
            <button
              type="button"
              onClick={goNext}
              disabled={!creatorName.trim()}
              className="mt-8 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue <ArrowRight className="size-4" />
            </button>
          </div>
        )}

        {step === "review" && (
          <div className="flex flex-1 flex-col">
            <h1 className="font-serif text-2xl font-medium text-foreground">
              Ready to go?
            </h1>

            <div className="mt-6 rounded-2xl border border-border bg-surface p-5 shadow-sm">
              <input
                value={effectiveTripName}
                onChange={(e) => setTripName(e.target.value)}
                className="w-full border-none bg-transparent p-0 font-serif text-xl font-medium text-foreground focus:outline-none"
              />
              <p className="mt-2 text-sm text-muted-foreground">
                {destinations.map((d) => d.displayName).join(" · ")}
              </p>
              <div className="mt-3 flex items-center gap-4 text-sm text-muted-foreground">
                <span>{dateSummary}</span>
                <span className="text-border">•</span>
                <span>{1 + travellers.filter((t) => t.name.trim()).length} travellers</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs text-foreground">
                  {creatorName || "You"}
                </span>
                {travellers
                  .filter((t) => t.name.trim())
                  .map((t, i) => (
                    <span key={i} className="rounded-full bg-surface-muted px-2.5 py-1 text-xs text-foreground">
                      {t.name}
                    </span>
                  ))}
              </div>
            </div>

            <div className="flex-1" />
            {createError && (
              <p className="mt-4 text-sm text-danger">{createError}</p>
            )}
            <button
              type="button"
              onClick={handleCreate}
              disabled={isPending}
              className="mt-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Creating…" : "Create Trip"}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
