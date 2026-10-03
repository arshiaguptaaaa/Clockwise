"use client";

import { useEffect, useState, useTransition } from "react";
import { Heart } from "lucide-react";
import { ClockwiseMark } from "@/components/ClockwiseMark";
import { aroundSearchAction, brandSearchAction, toggleSavePlaceAction, type AroundResponse } from "@/app/traveller-actions";
import { AROUND_CATEGORIES } from "@/lib/travel/around-categories";

type Ok = Extract<AroundResponse, { ok: true }>;

export function AroundYou({ tripId, anchorKind, anchorLabel, ordered, initialCategory }: { tripId: string; anchorKind: "stay" | "destination"; anchorLabel: string; ordered: string[]; initialCategory?: string }) {
  const [cat, setCat] = useState<string>(initialCategory && ordered.includes(initialCategory) ? initialCategory : ordered[0]);
  const [res, setRes] = useState<Ok | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [veg, setVeg] = useState(false);
  const [maxWalk, setMaxWalk] = useState<number | null>(null);
  const [brand, setBrand] = useState("");
  const [saved, setSaved] = useState<string[]>([]);
  const [busy, start] = useTransition();

  const run = (c: string, diet?: "vegetarian") =>
    start(async () => {
      setErr(null);
      const r = await aroundSearchAction(tripId, c, diet);
      if (r.ok) {
        setRes(r);
        setSaved(r.saved);
      } else setErr(r.error);
    });

  useEffect(() => {
    run(cat, veg && (cat === "restaurant" || cat === "cafe") ? "vegetarian" : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat, veg]);

  const shown = res?.places.filter((p) => maxWalk == null || (p.walkMinutes != null && p.walkMinutes <= maxWalk)) ?? [];

  return (
    <div className="space-y-4">
      <header className="flex items-start gap-3">
        <span className="mt-1 text-accent-strong">
          <ClockwiseMark size={28} working={busy} />
        </span>
        <div>
          <h1 className="font-display text-[26px] leading-[1.05]">{anchorKind === "stay" ? "AROUND YOUR STAY" : `AROUND ${anchorLabel.split(",")[0].toUpperCase()}`}</h1>
          <p className="text-xs text-muted-foreground">{anchorKind === "stay" ? anchorLabel : "Based around the destination for now. Once your stay is confirmed, I'll centre this around your hotel."}</p>
        </div>
      </header>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {ordered.map((c) => (
          <button key={c} type="button" onClick={() => { setCat(c); setMaxWalk(null); }} data-around-cat={c} className={`shrink-0 cursor-pointer rounded-full border px-3.5 py-1.5 text-sm ${cat === c ? "border-accent bg-pop-pink-tint text-accent-strong" : "border-border bg-page"}`}>
            <span className="mr-1">{AROUND_CATEGORIES[c].icon}</span>
            {AROUND_CATEGORIES[c].label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {anchorKind === "stay" &&
          [5, 10].map((m) => (
            <button key={m} type="button" onClick={() => setMaxWalk(maxWalk === m ? null : m)} className={`cursor-pointer rounded-full border px-3 py-1 font-semibold ${maxWalk === m ? "border-accent bg-accent-tint" : "border-border"}`}>
              {m} MIN WALK
            </button>
          ))}
        {(cat === "restaurant" || cat === "cafe") && (
          <button type="button" onClick={() => setVeg((v) => !v)} className={`cursor-pointer rounded-full border px-3 py-1 font-semibold ${veg ? "border-accent bg-accent-tint" : "border-border"}`}>
            VEGETARIAN SEARCH
          </button>
        )}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!brand.trim()) return;
          start(async () => {
            setErr(null);
            const r = await brandSearchAction(tripId, brand);
            if (r.ok) {
              setRes(r);
              setSaved(r.saved);
            } else setErr(r.error);
          });
        }}
      >
        <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Looking for a store? e.g. 7-Eleven" className="flex-1 rounded-full border border-border bg-page px-4 py-2 text-sm focus:border-accent focus:outline-none" />
        <button type="submit" disabled={busy} className="cursor-pointer rounded-full bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground">
          Find
        </button>
      </form>

      {err && <p className="text-sm text-danger">{err}</p>}
      {res?.note && <p className="rounded-xl bg-pop-yellow-tint px-3 py-2 text-xs text-foreground">{res.note}</p>}

      <ul className="space-y-2">
        {shown.map((p) => {
          const on = saved.includes(p.providerPlaceId);
          return (
            <li key={p.providerPlaceId} className="rounded-xl border border-border p-3" data-around-place={p.name}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.walkMinutes != null ? `${p.walkMinutes} min walk` : p.distanceMeters != null ? `${p.distanceMeters >= 1000 ? (p.distanceMeters / 1000).toFixed(1) + " km" : Math.round(p.distanceMeters) + " m"} away` : ""}
                    {p.address ? ` · ${p.address}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <a href={`https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-accent">
                    MAP
                  </a>
                  <button
                    type="button"
                    aria-label="Save"
                    onClick={() =>
                      start(async () => {
                        const r = await toggleSavePlaceAction(tripId, p, cat);
                        if (r.ok) setSaved((s) => (r.saved ? [...s, p.providerPlaceId] : s.filter((x) => x !== p.providerPlaceId)));
                      })
                    }
                    className={`cursor-pointer ${on ? "text-accent-strong" : "text-muted-foreground"}`}
                  >
                    <Heart className="size-4" fill={on ? "currentColor" : "none"} />
                  </button>
                </div>
              </div>
            </li>
          );
        })}
        {res && shown.length === 0 && !busy && <li className="text-sm text-muted-foreground">Nothing found{maxWalk ? ` within a ${maxWalk}-minute walk` : " here"} in the provider&apos;s data.</li>}
      </ul>
      {res && (
        <p className="text-[11px] text-muted-foreground">
          Geoapify · {new Date(res.retrievedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · A place being nearby doesn&apos;t mean it stocks a particular product. Walking times are provider routes.
        </p>
      )}
    </div>
  );
}
