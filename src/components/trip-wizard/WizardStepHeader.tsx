const STEP_LABELS = ["Destination", "Timing", "Travellers", "Review"] as const;

// A small, scannable progress treatment rather than a generic dot
// indicator — names the actual step, matches the wizard's real step
// order (not a hardcoded different order). The full labeled version
// genuinely doesn't fit a phone-width screen alongside the back button
// and wordmark (measured: ~370px of text alone) — mobile gets a compact
// "step N of 4" + dot row instead, never a squeezed/overflowing version
// of the same thing.
export function WizardStepHeader({ currentStep }: { currentStep: number }) {
  return (
    <nav aria-label="Trip setup progress">
      {/* Compact, phone-width version */}
      <div className="flex items-center gap-2 sm:hidden">
        <div className="flex items-center gap-1">
          {STEP_LABELS.map((label, i) => (
            <span
              key={label}
              aria-hidden
              className={`size-1.5 rounded-full ${i === currentStep ? "bg-accent-strong" : i < currentStep ? "bg-muted-foreground" : "bg-border"}`}
            />
          ))}
        </div>
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Step {currentStep + 1} of {STEP_LABELS.length} &middot; {STEP_LABELS[currentStep]}
        </span>
      </div>

      {/* Full labeled version, desktop/tablet only */}
      <div className="hidden items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] sm:flex">
        {STEP_LABELS.map((label, i) => (
          <span key={label} className="flex items-center gap-2">
            {i > 0 && <span className="h-px w-3 bg-border" aria-hidden />}
            <span className={i === currentStep ? "text-accent-strong" : i < currentStep ? "text-muted-foreground" : "text-border"}>
              {String(i + 1).padStart(2, "0")} {label}
            </span>
          </span>
        ))}
      </div>
    </nav>
  );
}
