"use client";

import { useEffect, useState } from "react";
import type { SelectedDestination } from "@/lib/destination-search/types";
import type { WikipediaPhoto } from "@/lib/travel/wikipedia-photo";

type Resolved = { forName: string; photo: WikipediaPhoto | null };

// Desktop-only large photo panel (hidden lg:block) — mobile never renders
// this at all, so there's no overflow/layout risk to test there; the
// phone-width wizard is otherwise completely unchanged. Uses the real,
// keyless Wikipedia photo lookup, same source as the search thumbnails —
// never a fabricated/generic image. Graceful at every stage: no
// destination selected yet, no photo found for one that is, and a
// request still in flight all render sensibly rather than a blank panel.
//
// "Loading" is derived (resolved?.forName !== destination?.displayName)
// rather than tracked as its own state — the only setState call in the
// whole component happens inside the fetch's .then(), never synchronously
// in the effect body.
export function DestinationReveal({ destination }: { destination: SelectedDestination | null }) {
  const [resolved, setResolved] = useState<Resolved | null>(null);

  useEffect(() => {
    if (!destination) return;
    let cancelled = false;
    fetch(`/api/destinations/photo?name=${encodeURIComponent(destination.displayName)}`)
      .then((res) => res.json())
      .then((data: { photo: WikipediaPhoto | null }) => {
        if (!cancelled) setResolved({ forName: destination.displayName, photo: data.photo });
      })
      .catch(() => {
        if (!cancelled) setResolved({ forName: destination.displayName, photo: null });
      });
    return () => {
      cancelled = true;
    };
  }, [destination]);

  const loading = destination != null && resolved?.forName !== destination.displayName;
  const photo = !loading ? (resolved?.photo ?? null) : null;

  return (
    <div className="relative hidden flex-1 overflow-hidden bg-[var(--ink,#1c231f)] lg:block">
      {destination && photo ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.src} alt={photo.alt} className="absolute inset-0 size-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          <p className="absolute bottom-6 left-6 text-xs font-medium uppercase tracking-[0.15em] text-white/80">
            {destination.displayName}
          </p>
        </>
      ) : (
        <div className="flex size-full items-center justify-center">
          <p className="text-sm text-white/40">
            {loading ? "Loading…" : destination ? "" : "Your destination will appear here"}
          </p>
        </div>
      )}
    </div>
  );
}
