import { ClockwiseMark } from "@/components/ClockwiseMark";

// ◷ Clockwise is thinking… Shown the instant someone addresses Clockwise, and gone the moment its answer or
// action lands. Never shown for background work where Clockwise intentionally stays quiet.
export function ThinkingIndicator() {
  return (
    <div className="vote-in flex items-center gap-3" role="status" aria-live="polite" data-thinking>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <ClockwiseMark size={18} working />
      </span>
      <p className="font-display text-[17px] italic tracking-[-0.005em] text-muted-foreground">
        <span className="cw-mark not-italic">◷</span> Clockwise is thinking
        <span className="ml-0.5 inline-flex gap-0.5 align-baseline">
          <span className="thinking-dot">.</span>
          <span className="thinking-dot [animation-delay:150ms]">.</span>
          <span className="thinking-dot [animation-delay:300ms]">.</span>
        </span>
      </p>
    </div>
  );
}
