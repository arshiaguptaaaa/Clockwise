import { Clock } from "lucide-react";

export function ClockwiseWordmark({
  className,
  iconClassName,
}: {
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-2xl font-semibold tracking-tight ${
        className ?? ""
      }`}
    >
      CL
      <Clock className={iconClassName ?? "size-6"} strokeWidth={2.25} />
      CKWISE
    </span>
  );
}
