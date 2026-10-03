"use client";

import { useEffect, useState, useTransition } from "react";
import { Heart } from "lucide-react";
import type { HotelListing } from "@/lib/travel/hotel-provider";
import { saveStayAction, proposeStayAction, savedStayIdsAction } from "@/app/stay-actions";

type Context = { destination: string; dates: string | null; nights: number | null; travellers: number };

function distance(m: number | null) {
  if (m == null) return null;
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km from centre` : `${Math.round(m)} m from centre`;
}

// Real provider listings only. Price and availability are shown as exactly what
// they are — not connected — never as a number or "available".
export function StayList({ tripId, listings, context, notes = [], initialSaved }: { tripId: string; listings: HotelListing[]; context?: Context; notes?: string[]; initialSaved?: string[] }) {
  const [saved, setSaved] = useState<string[]>(initialSaved ?? []);
  const [proposed, setProposed] = useState<Record<string, string>>({});
  const [busy, start] = useTransition();

  useEffect(() => {
    if (initialSaved) return;
    let live = true;
    void savedStayIdsAction(tripId).then((ids) => {
      if (live) setSaved(ids);
    });
    return () => {
      live = false;
    };
  }, [tripId, initialSaved]);

  const ref = (l: HotelListing) => ({
    provider: l.provider,
    providerPlaceId: l.providerPlaceId,
    name: l.name,
    address: l.address,
    latitude: l.latitude,
    longitude: l.longitude,
    retrievedAt: l.retrievedAt,
  });

  return (
    <div className="space-y-3">
      {context && (
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {context.destination}
          {context.dates ? ` · ${context.dates}` : ""} · {context.travellers} traveller{context.travellers === 1 ? "" : "s"}
        </p>
      )}
      {listings.length === 0 && <p className="text-sm text-muted-foreground">No stays found near here.</p>}
      {listings.map((l) => {
        const isSaved = saved.includes(l.providerPlaceId);
        return (
          <div key={l.providerPlaceId} className="rounded-2xl border border-border bg-surface p-3" data-stay={l.name}>
            <p className="font-display text-lg leading-tight text-foreground">{l.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {l.kind}
              {l.stars ? ` · ${l.stars}★` : ""}
              {distance(l.distanceMeters) ? ` · ${distance(l.distanceMeters)}` : ""}
            </p>
            {l.address && <p className="mt-0.5 text-xs text-muted-foreground">{l.address}</p>}
            <p className="mt-2 inline-flex rounded-full bg-surface-muted px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Live rate · not connected</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  start(async () => {
                    const r = await saveStayAction(tripId, ref(l));
                    if (r.ok) setSaved((cur) => (r.saved ? [...cur, l.providerPlaceId] : cur.filter((x) => x !== l.providerPlaceId)));
                  })
                }
                className={`flex cursor-pointer items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold ${isSaved ? "border-accent bg-pop-pink-tint text-accent-strong" : "border-border"}`}
              >
                <Heart className="size-3.5" fill={isSaved ? "currentColor" : "none"} /> {isSaved ? "Saved" : "Save"}
              </button>
              <button
                type="button"
                disabled={busy || Boolean(proposed[l.providerPlaceId])}
                onClick={() =>
                  start(async () => {
                    const r = await proposeStayAction(tripId, ref(l));
                    setProposed((p) => ({ ...p, [l.providerPlaceId]: r.ok ? (r.duplicate ? "Already proposed" : "Proposed to the group") : (r.error ?? "Couldn't propose") }));
                  })
                }
                className="cursor-pointer rounded-full bg-accent px-3.5 py-1.5 text-xs font-semibold text-accent-foreground disabled:opacity-60"
              >
                {proposed[l.providerPlaceId] ?? "Propose"}
              </button>
              <a
                href={l.website ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${l.name} ${l.address ?? ""}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-semibold text-accent underline-offset-2 hover:underline"
              >
                {l.website ? "View / check rate" : "View on map"}
              </a>
            </div>
          </div>
        );
      })}
      {notes.map((n) => (
        <p key={n} className="text-[11px] text-muted-foreground">
          {n}
        </p>
      ))}
      {listings[0] && (
        <p className="text-[11px] text-muted-foreground">
          {listings[0].provider} · {new Date(listings[0].retrievedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
        </p>
      )}
    </div>
  );
}
