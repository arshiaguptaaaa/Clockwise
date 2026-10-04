import Link from "next/link";
import { BengaluruArt } from "@/components/art/BengaluruArt";
import { PointerCard } from "./PointerCard";
import type { PointerRow } from "@/lib/pointers/store";

// ✦ CLOCKWISE PICKED UP: what Clockwise noticed in ordinary conversation, as small tinted notes. Visibly NOT the plan:
// it sits above, and apart from, CONFIRMED PLAN, and says so.
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
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="eyebrow">✦ Clockwise picked up</p>
              <p className="t-voice mt-1 text-[14px] text-muted-foreground">Things I noticed in your chat. None of this is in the Plan.</p>
            </div>
            <BengaluruArt scene="saved" className="w-16 shrink-0 -rotate-2" />
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-2.5">
            {pointers.map((p) => (
              <PointerCard key={p.id} kind={p.kind} subject={p.subject} who={p.userName} extra={p.supporterIds.length > 0 ? `+${p.supporterIds.length} agreed` : p.mentions > 1 ? `mentioned ${p.mentions}×` : null} forgetId={viewerId === p.userId ? p.id : null} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
