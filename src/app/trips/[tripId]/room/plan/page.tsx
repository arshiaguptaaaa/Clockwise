import Link from "next/link";
import { ClipboardList, ArrowRight } from "lucide-react";

export default async function RoomPlanShortcutPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 py-16 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-surface-muted text-muted-foreground">
        <ClipboardList className="size-5" strokeWidth={1.75} />
      </span>
      <p className="text-sm font-medium text-foreground">
        The plan lives in one place
      </p>
      <p className="max-w-xs text-sm text-muted-foreground">
        Route, travellers, and what&apos;s confirmed — see it on the Plan tab.
      </p>
      <Link
        href={`/trips/${tripId}/plan`}
        className="mt-1 inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-accent"
      >
        Open Plan <ArrowRight className="size-4" />
      </Link>
    </div>
  );
}
