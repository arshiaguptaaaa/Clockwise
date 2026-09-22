import { Clock } from "lucide-react";

export function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Clock className="size-4 animate-pulse" strokeWidth={2} />
      </span>
      <div className="flex items-center gap-2 rounded-xl bg-surface-muted px-3 py-2.5">
        <span className="text-sm text-muted-foreground">Clockwise is thinking</span>
        <span className="flex items-center gap-1">
          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
        </span>
      </div>
    </div>
  );
}
