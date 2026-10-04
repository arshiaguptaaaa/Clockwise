import Link from "next/link";
import { ForgetButton } from "./ForgetButton";
import type { PointerRow } from "@/lib/pointers/store";

// CLOCKWISE PICKED UP ✦ : memory from ordinary conversation. Visibly NOT the plan: it sits above, and apart from,
// CONFIRMED PLAN, and says so.
export function PickedUp({ pointers, story, ideas, tripId, viewerId }: { pointers: PointerRow[]; story: string | null; ideas: { id: string; title: string; status: string }[]; tripId: string; viewerId: string | null }) {
  if (pointers.length === 0 && ideas.length === 0) return null;
  return (
    <div data-picked-up>
      {story && (
        <section className="section" data-trip-story>
          <p className="eyebrow">Your trip is taking shape ✦</p>
          <p className="t-voice mt-2 text-[17px] leading-snug">{story}</p>
        </section>
      )}
      {ideas.length > 0 && (
        <section className="section" data-open-ideas>
          <p className="eyebrow">Clockwise has an idea ✦</p>
          <ul className="mt-2 space-y-1.5">
            {ideas.map((i) => (
              <li key={i.id} className="text-[14px]">
                <span className="font-medium">{i.title}</span>{" "}
                <span className="text-muted-foreground">· {i.status === "PROPOSED" ? "proposed, waiting for votes" : "just an idea"}</span>{" "}
                <Link href={`/trips/${tripId}/room`} className="underline underline-offset-4">
                  see it
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {pointers.length > 0 && (
        <section className="section">
          <p className="eyebrow">Clockwise picked up ✦</p>
          <p className="t-voice mt-1 text-[14px] text-muted-foreground">Things I noticed in your chat. None of this is in the Plan.</p>
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {pointers.map((p) => (
              <li key={p.id} className="flex min-h-11 items-center justify-between gap-3 py-2 text-[14px]" data-pointer={p.subject}>
                <span>
                  <span className="font-semibold">{p.userName}</span> {p.label}.
                  {(p.supporterIds.length > 0 || p.mentions > 1) && <span className="ml-1.5 text-[11.5px] text-muted-foreground">{p.supporterIds.length > 0 ? `+${p.supporterIds.length} agreed` : `mentioned ${p.mentions}×`}</span>}
                </span>
                {viewerId === p.userId && <ForgetButton pointerId={p.id} />}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
