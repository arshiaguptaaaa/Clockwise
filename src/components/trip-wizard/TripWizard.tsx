"use client";

import { RangeCalendar } from "@/components/DatePicker";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Image from "next/image";
import { unstable_rethrow } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  X,
  Plus,
  Calendar,
  CalendarDays,
  CalendarOff,
} from "lucide-react";
import { createTrip } from "@/app/wizard-actions";
import { suggestTripName } from "@/lib/trip-name";
import { formatDateRange } from "@/lib/format";
import { ClockwiseWordmark } from "@/components/ClockwiseWordmark";
import { DestinationAutocomplete, type DestinationPreview } from "@/components/trip-wizard/DestinationAutocomplete";
import { DestinationPhotoStage, type StagePhoto } from "@/components/trip-wizard/DestinationPhotoStage";
import { CURATED_PHOTOS, curatedPhotoFor } from "@/lib/destination-photos";
import { CharacterScene, Face, SpeechBubble } from "@/components/art/CharacterScene";
import { FACE_COUNT } from "@/lib/characters";
import { WizardStepHeader } from "@/components/trip-wizard/WizardStepHeader";
import type { SelectedDestination } from "@/lib/destination-search/types";

type DateMode = "exact" | "approximate" | "unsure";
type TravellerDraft = { name: string; contact: string; face: number; phone: string; callConsent: boolean };

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

// Photo for a place: a curated, fully-credited photo when we have one, else the
// Wikipedia photo the destination search already returned, else nothing.
function stagePhotoFor(name: string | undefined, photoUrl: string | null | undefined): StagePhoto | null {
  const curated = curatedPhotoFor(name);
  if (curated) return { key: curated.key, src: curated.src, label: curated.label, credit: curated.credit, objectPosition: curated.objectPosition };
  if (photoUrl && name) return { key: `wiki:${name}`, src: photoUrl, label: name, credit: "Wikipedia" };
  return null;
}

export function TripWizard() {
  const [stepIndex, setStepIndex] = useState(0);
  const [preview, setPreview] = useState<DestinationPreview>({ query: "", result: null });
  const handlePreview = useCallback((p: DestinationPreview) => setPreview(p), []);
  const step: Step = STEPS[stepIndex];

  // Before anything is typed or chosen the page shows rotating inspiration
  // rather than empty white — one photograph at a time.
  const [idleIndex, setIdleIndex] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setIdleIndex((i) => (i + 1) % CURATED_PHOTOS.length), 3200);
    return () => clearInterval(t);
  }, []);
  // Faces are picked by position or by the traveller — never from a name.
  const [creatorFace, setCreatorFace] = useState(0);

  const [destinations, setDestinations] = useState<SelectedDestination[]>([]);

  const [dateMode, setDateMode] = useState<DateMode>("unsure");
  const [exactStart, setExactStart] = useState("");
  const [exactEnd, setExactEnd] = useState("");
  const [month, setMonth] = useState("");

  const [creatorName, setCreatorName] = useState("");
  const [creatorEmail, setCreatorEmail] = useState("");
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
    setTravellers((prev) => [...prev, { name: "", contact: "", phone: "", callConsent: false, face: (creatorFace + prev.length + 1) % FACE_COUNT }]);
  }

  function updateTraveller(index: number, field: "name" | "contact" | "phone", value: string) {
    setTravellers((prev) =>
      prev.map((t, i) => (i === index ? { ...t, [field]: value } : t))
    );
  }

  function cycleTravellerFace(index: number) {
    setTravellers((prev) => prev.map((t, i) => (i === index ? { ...t, face: (t.face + 1) % FACE_COUNT } : t)));
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
          creatorEmail: creatorEmail.trim() || null,
          travellers: travellers.filter((t) => t.name.trim()).map(({ name, contact, phone, callConsent }) => ({ name, contact, phone, callConsent })),
        });
      } catch (err) {
        unstable_rethrow(err);
        setCreateError(
          err instanceof Error ? err.message : "Something went wrong creating the trip."
        );
      }
    });
  }

  // While typing: the highlighted result's photo, or — before results arrive —
  // a curated place the typed letters are clearly heading towards.
  const previewPhoto = useMemo<StagePhoto | null>(() => {
    if (preview.result) return stagePhotoFor(preview.result.name, preview.result.photoUrl);
    const q = preview.query.toLowerCase();
    if (q.length >= 3) {
      const hit = CURATED_PHOTOS.find((p) => p.matches.some((m) => m.startsWith(q)));
      if (hit) return stagePhotoFor(hit.label, null);
    }
    return null;
  }, [preview]);
  const selectedPhotos = useMemo(
    () =>
      destinations
        .map((d) => stagePhotoFor(d.name, (d as { photoUrl?: string | null }).photoUrl))
        .filter((p): p is StagePhoto => p !== null),
    [destinations]
  );

  const idlePhoto = useMemo(() => {
    const c = CURATED_PHOTOS[idleIndex];
    return stagePhotoFor(c.label, null);
  }, [idleIndex]);

  const stageLabel = previewPhoto?.label ?? (selectedPhotos.length === 0 ? idlePhoto?.label : null);
  const destinationBubble =
    destinations.length >= 2
      ? "Okay, now we're talking."
      : destinations.length === 1
        ? "Good start. Another?"
        : previewPhoto
          ? `${previewPhoto.label}? Tell me more.`
          : `${stageLabel ?? "Anywhere"}? I could be convinced.`;
  const destinationScene = destinations.length >= 2 ? "celebrating" : destinations.length === 1 ? "highfive" : "map";

  const dateSummary =
    dateMode === "exact" && exactStart && exactEnd
      ? formatDateRange(new Date(`${exactStart}T00:00:00Z`), new Date(`${exactEnd}T00:00:00Z`))
      : dateMode === "approximate" && month
        ? new Date(`${month}-01`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
        : "Not decided yet";

  return (
    <main className="flex min-h-screen shrink-0 flex-col bg-white px-6 py-10">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <div className="mb-4 flex items-center justify-between">
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
        <div className="mb-6">
          <WizardStepHeader currentStep={stepIndex} />
        </div>

        {step === "destinations" && (
          <div className="flex flex-1 flex-col">
            <h1 className="pt-2 font-display text-[2rem] font-medium leading-[1.05] tracking-tight text-foreground">
              Where are we <span className="italic text-accent">going?</span>
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              Add as many or as few as you know. Clockwise can refine things later.
            </p>

            <div className="mt-6">
              <DestinationAutocomplete onAdd={addDestination} isDuplicate={isDuplicateDestination} onPreview={handlePreview} suggestions={["Prague", "Vienna", "Jaipur", "Nuuk"]} />
            </div>

            {destinations.length > 0 && (
              <div className="mt-4 flex flex-col gap-2">
                {destinations.map((d, i) => (
                  <div
                    key={`${d.freeText ? d.displayName : d.providerPlaceId}-${i}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-display text-lg font-medium leading-tight text-foreground">
                        {d.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {!d.freeText
                          ? [d.region, d.country].filter(Boolean).join(", ") || "Location not confirmed"
                          : "Added as typed"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeDestination(i)}
                      aria-label={`Remove ${d.displayName}`}
                      className="shrink-0 cursor-pointer text-muted-foreground hover:text-danger"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-1 items-center justify-center">
              <DestinationPhotoStage preview={previewPhoto} selected={selectedPhotos} idle={idlePhoto}>
                <SpeechBubble key={destinationBubble} className="absolute -left-4 top-2 z-30 sm:-left-14" tail="bottom-left">
                  {destinationBubble}
                </SpeechBubble>
                <CharacterScene
                  key={destinationScene}
                  scene={destinationScene}
                  tilt={-4}
                  sizes="120px"
                  className="absolute -bottom-3 -left-8 z-30 w-28 sm:-left-20"
                />
              </DestinationPhotoStage>
            </div>
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
                <RangeCalendar
                  start={exactStart}
                  end={exactEnd}
                  onChange={(st, en) => {
                    setExactStart(st);
                    setExactEnd(en);
                    setEndDateWasCleared(false);
                  }}
                />

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
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 pt-2">
                <h1 className="font-display text-[2rem] font-medium leading-[1.05] tracking-tight text-foreground">
                  Who&apos;s coming
                  <br />
                  <span className="italic text-accent">along?</span>
                </h1>
                <p className="mt-3 text-sm text-muted-foreground">
                  Just names and emails for now — everyone shares their own details privately once they join.
                </p>
              </div>
              <div className="relative mt-1 w-32 shrink-0">
                <CharacterScene scene="friendship" tilt={3} sizes="130px" />
                <SpeechBubble className="absolute right-0 top-full z-10 mt-2 w-max" tail="top-right">
                  {travellers.length === 0 ? "Who are we waiting for?" : "The more the merrier."}
                </SpeechBubble>
              </div>
            </div>

            <div className="mt-7 flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => setCreatorFace((f) => (f + 1) % FACE_COUNT)}
                  aria-label="Change your look"
                  title="Tap to change look"
                  className="mt-1 cursor-pointer rounded-full transition-transform hover:scale-105"
                >
                  <Face index={creatorFace} className="size-14" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Trip organiser · you</p>
                  <input
                    value={creatorName}
                    onChange={(e) => setCreatorName(e.target.value)}
                    placeholder="Your name"
                    autoFocus
                    className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
                  />
                  <input
                    value={creatorEmail}
                    onChange={(e) => setCreatorEmail(e.target.value)}
                    placeholder="Your email"
                    type="email"
                    className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
                  />
                </div>
              </div>

              {travellers.map((t, i) => (
                <div key={i} className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => cycleTravellerFace(i)}
                    aria-label={`Change ${t.name || "traveller"}'s look`}
                    title="Tap to change look"
                    className="mt-1 cursor-pointer rounded-full transition-transform hover:scale-105"
                  >
                    <Face index={t.face} className="size-14" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      {t.name.trim() ? "Invited" : "New traveller"}
                    </p>
                    <input
                      value={t.name}
                      onChange={(e) => updateTraveller(i, "name", e.target.value)}
                      placeholder="Name"
                      className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
                    />
                    <input
                      value={t.contact}
                      onChange={(e) => updateTraveller(i, "contact", e.target.value)}
                      placeholder="Email address"
                      className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
                    />
                    <input
                      value={t.phone}
                      onChange={(e) => updateTraveller(i, "phone", e.target.value)}
                      placeholder="Phone (optional, e.g. +91 98765 43210)"
                      inputMode="tel"
                      className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
                    />
                    <label className={`mt-2 flex items-start gap-2 text-xs ${t.phone.trim() ? "text-foreground" : "text-muted-foreground opacity-60"}`}>
                      <input
                        type="checkbox"
                        checked={t.callConsent}
                        disabled={!t.phone.trim()}
                        onChange={(e) => setTravellers((prev) => prev.map((x, k) => (k === i ? { ...x, callConsent: e.target.checked } : x)))}
                        className="mt-0.5"
                      />
                      <span>They&apos;re happy for Clockwise to call if they haven&apos;t responded in time</span>
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeTraveller(i)}
                    aria-label="Remove"
                    className="mt-9 flex shrink-0 cursor-pointer items-center justify-center text-muted-foreground hover:text-danger"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ))}

              <button
                type="button"
                onClick={addTraveller}
                className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-dashed border-border px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:border-accent hover:text-accent"
              >
                <Plus className="size-4" /> Add another traveller
              </button>
              <p className="-mt-2 text-xs text-muted-foreground">
                Email is how Clockwise sends invitations and, later, trip alerts.
              </p>
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
          <div className="flex flex-1 flex-col items-center text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">Ready to go?</p>

            <div className="relative mt-6 w-[62%] max-w-[250px]">
              <div
                className="photo-in relative aspect-[4/5] overflow-hidden rounded-t-[999px] rounded-b-[26px] bg-surface-muted shadow-[0_30px_60px_-30px_rgba(20,24,26,0.5)]"
                style={{ ["--tilt" as string]: "-2deg", transform: "rotate(-2deg)" }}
              >
                {selectedPhotos[0] ? (
                  <Image
                    src={selectedPhotos[0].src}
                    alt=""
                    fill
                    sizes="250px"
                    priority
                    className="object-cover"
                    style={{ objectPosition: selectedPhotos[0].objectPosition ?? "50% 50%" }}
                  />
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center px-4 font-display text-3xl italic text-accent">
                    {destinations[0]?.name ?? "Your trip"}
                  </span>
                )}
              </div>
              <div className="absolute -bottom-4 -right-14 z-10 w-24 sm:-right-20 sm:w-28">
                <SpeechBubble className="absolute -left-10 -top-8 z-10 w-max" tail="bottom-right">
                  Let&apos;s go.
                </SpeechBubble>
                <CharacterScene scene="highfive" tilt={5} sizes="120px" />
              </div>
            </div>

            <input
              value={effectiveTripName}
              onChange={(e) => setTripName(e.target.value)}
              aria-label="Trip name"
              className="mt-8 w-full border-none bg-transparent p-0 text-center font-display text-4xl font-medium leading-none tracking-tight text-foreground focus:outline-none"
            />
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {[...new Set(destinations.map((d) => (d.freeText ? null : d.country)).filter(Boolean))].join(" · ") ||
                destinations.map((d) => d.name).join(" · ") ||
                "Your trip"}
            </p>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
              <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Face index={creatorFace} className="size-8" /> {creatorName || "You"}
              </span>
              {travellers
                .filter((t) => t.name.trim())
                .map((t, i) => (
                  <span key={i} className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Face index={t.face} className="size-8" /> {t.name}
                    {!t.contact.trim() && <span className="text-[10px] font-normal text-muted-foreground">(no email yet)</span>}
                  </span>
                ))}
            </div>

            <p className="mt-5 font-display text-base italic text-muted-foreground">{dateSummary}</p>

            <div className="flex-1" />
            {createError && <p className="mt-4 text-sm text-danger">{createError}</p>}
            <button
              type="button"
              onClick={handleCreate}
              disabled={isPending}
              className="mt-8 flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-accent px-4 py-3.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Creating…" : "Create our trip"} <ArrowRight className="size-4" />
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
