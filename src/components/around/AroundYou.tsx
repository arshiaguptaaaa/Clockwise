"use client";

import { useEffect, useState, useTransition } from "react";
import { Heart } from "lucide-react";
import { ClockwiseMark } from "@/components/ClockwiseMark";
import { BengaluruArt } from "@/components/art/BengaluruArt";
import { HUMAN } from "@/lib/copy";
import { aroundSearchAction, brandSearchAction, toggleSavePlaceAction, locationEventAction, routeToPlaceAction, proposePlaceAction, nextUpAction, freeTimeAction, type AroundResponse, type AnchorStatus, type RouteResponse } from "@/app/traveller-actions";
import type { NextUp, FreeTime } from "@/lib/travel/window";
import type { AroundPlace } from "@/lib/travel/around";
import { AROUND_CATEGORIES, CATEGORY_HEADLINE, countWordTitle } from "@/lib/travel/around-categories";

type Ok = Extract<AroundResponse, { ok: true }>;
type RouteOk = Extract<RouteResponse, { ok: true }>;
type Anchor = "me" | "stay" | "arrival" | "destination";
// Current location lives ONLY in this component's memory: never stored, never sent to the group.
type Fix = { lat: number; lng: number; at: number };

const FRESH_MS = 10 * 60 * 1000;
const MODE_LABEL: Record<string, string> = { walk: "Walking", drive: "Driving", bicycle: "Cycling", transit: "Transit" };


// "Two hours", "45 minutes", "1 hour 30 minutes": read aloud, not as a timer.
const killWords = (m: number) => {
  if (m < 60) return `${m} minutes`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const hw = h <= 8 ? countWordTitle(h) : String(h);
  return `${hw} ${h === 1 ? "hour" : "hours"}${mm ? ` ${mm} minutes` : ""}`;
};
const fmtDur = (m: number) => (m >= 2880 ? `${Math.round(m / 1440)} DAYS` : m < 60 ? `${m} MIN` : `${Math.floor(m / 60)} H${m % 60 ? ` ${m % 60} MIN` : ""}`);
const hhmm = (iso: string) => iso.slice(11, 16);

function minutesAgo(at: number, now: number) {
  const m = Math.max(0, Math.round((now - at) / 60000));
  return m < 1 ? "just now" : `${m} min ago`;
}

function RouteMap({ geometry }: { geometry: { lat: number; lng: number }[] }) {
  const W = 280;
  const H = 120;
  const lats = geometry.map((p) => p.lat);
  const lngs = geometry.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const sx = (maxLng - minLng) || 1e-6;
  const sy = (maxLat - minLat) || 1e-6;
  const pad = 10;
  const pt = (p: { lat: number; lng: number }) => [pad + ((p.lng - minLng) / sx) * (W - 2 * pad), H - pad - ((p.lat - minLat) / sy) * (H - 2 * pad)] as const;
  const pts = geometry.map(pt);
  const first = pts[0];
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-28 w-full rounded-lg bg-surface" role="img" aria-label="Provider route geometry">
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-accent-strong" />
      <circle cx={first[0]} cy={first[1]} r="5" className="fill-foreground" />
      <circle cx={last[0]} cy={last[1]} r="5" className="fill-accent-strong" />
    </svg>
  );
}

export function AroundYou({ tripId, ordered, initialCategory, anchors, wantsMe, defaultAnchor }: { tripId: string; ordered: string[]; initialCategory?: string; anchors: AnchorStatus; wantsMe?: boolean; defaultAnchor?: Anchor | null }) {
  const [cat, setCat] = useState<string>(initialCategory && ordered.includes(initialCategory) ? initialCategory : ordered[0]);
  const [anchor, setAnchor] = useState<Anchor | null>(wantsMe ? null : (defaultAnchor ?? null));
  const [fix, setFix] = useState<Fix | null>(null);
  const [loc, setLoc] = useState<"idle" | "asking" | "denied" | "failed">("idle");
  const [res, setRes] = useState<Ok | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [veg, setVeg] = useState(false);
  const [maxWalk, setMaxWalk] = useState<number | null>(null);
  const [proposed, setProposed] = useState<string[]>([]);
  const [nextUp, setNextUp] = useState<NextUp | { none: string } | null>(null);
  const [free, setFree] = useState<(FreeTime & { anchorType: Anchor }) | null>(null);
  const [freeErr, setFreeErr] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [brand, setBrand] = useState("");
  const [saved, setSaved] = useState<string[]>([]);
  const [overlap, setOverlap] = useState<{ id: string; name: string; count: number } | null>(null);
  const [routeFor, setRouteFor] = useState<string | null>(null);
  const [route, setRoute] = useState<RouteOk | null>(null);
  const [routeErr, setRouteErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, start] = useTransition();

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const fallback: Anchor | null = anchors.stay.available ? "stay" : anchors.destination.available ? "destination" : null;

  // Asks the browser for permission ONLY when the traveller pressed a button.
  const requestMyLocation = () => {
    setErr(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLoc("failed");
      return;
    }
    setLoc("asking");
    void locationEventAction(tripId, "requested");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const f = { lat: pos.coords.latitude, lng: pos.coords.longitude, at: Date.now() };
        setFix(f);
        setLoc("idle");
        setAnchor("me");
        void locationEventAction(tripId, "granted");
      },
      (e) => {
        setFix(null);
        setLoc(e.code === 1 ? "denied" : "failed");
        if (e.code === 1) void locationEventAction(tripId, "denied");
      },
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 0 }
    );
  };

  const pickAnchor = (a: Anchor) => {
    if (a === "me") {
      // A fix older than 10 minutes is re-requested rather than silently reused.
      if (!fix || now - fix.at > FRESH_MS) requestMyLocation();
      else setAnchor("me");
      return;
    }
    setAnchor(a);
  };

  const me = anchor === "me" && fix ? { lat: fix.lat, lng: fix.lng } : null;

  const run = (c: string, a: Anchor, diet?: "vegetarian") =>
    start(async () => {
      setErr(null);
      setRouteFor(null);
      const r = await aroundSearchAction(tripId, c, { diet, anchor: a, me });
      if (r.ok) {
        setRes(r);
        setSaved(r.saved);
      } else {
        setRes(null);
        setErr(r.error);
      }
    });

  useEffect(() => {
    if (!anchor) return;
    run(cat, anchor, veg && (cat === "restaurant" || cat === "cafe") ? "vegetarian" : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat, veg, anchor, fix?.at]);

  useEffect(() => {
    if (!anchor) return;
    let alive = true;
    void nextUpAction(tripId, { anchor, me }).then((r) => {
      if (alive) setNextUp(r.ok ? r.nextUp : { none: r.error });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, fix?.at]);

  const shown = res?.places.filter((p) => maxWalk == null || (p.walkMinutes != null && p.walkMinutes <= maxWalk)) ?? [];
  const anchorChips: { id: Anchor; icon: string; label: string; ok: boolean; why?: string }[] = [
    { id: "me", icon: "📍", label: "ME", ok: true },
    { id: "stay", icon: "🏨", label: "HOTEL", ok: anchors.stay.available, why: "No confirmed stay yet" },
    { id: "arrival", icon: "✈", label: "ARRIVAL", ok: anchors.arrival.available, why: "Confirm your journey first" },
    { id: "destination", icon: "◎", label: "DESTINATION", ok: anchors.destination.available, why: "No destination yet" },
  ];
  const whereText =
    anchor === "me" ? "where you are" : anchor === "stay" ? "your hotel" : anchor === "arrival" ? "your arrival point" : anchor === "destination" ? (anchors.destination.label ?? "the destination").split(",")[0] : "";

  // ---- Step 1: nothing is known about where the traveller is until they say so.
  if (!anchor) {
    return (
      <div data-around-intro>
        <BengaluruArt scene="coffee" className="tile-in w-[78%] -rotate-2 shadow-[0_18px_34px_-18px_rgba(20,24,26,0.55)]" />
        <p className="eyebrow mt-7 flex items-center gap-2">
          <span className="text-accent-strong">
            <ClockwiseMark size={18} working={loc === "asking"} />
          </span>
          Around you
        </p>
        <h1 className="headline headline-xl mt-2">What&apos;s around you right now?</h1>
        <p className="lede mt-3 max-w-[20rem]">{wantsMe ? "To search around where you are, I need your location. Tap the button." : "Your location is private. It's used for one search, never stored, never shown to the group."}</p>
        <div className="mt-6 flex flex-col gap-2.5">
          <button type="button" onClick={requestMyLocation} disabled={loc === "asking"} data-use-my-location className="cursor-pointer rounded-full bg-accent px-5 py-3.5 text-[13px] font-semibold tracking-[0.12em] text-accent-foreground disabled:opacity-60">
            {loc === "asking" ? "ASKING YOUR BROWSER…" : "USE MY LOCATION"}
          </button>
          {fallback && (
            <button type="button" onClick={() => setAnchor(fallback)} data-around-fallback className="cursor-pointer rounded-full border border-foreground/20 px-5 py-3.5 text-[13px] font-semibold tracking-[0.12em]">
              {fallback === "stay" ? "AROUND OUR HOTEL" : `AROUND ${(anchors.destination.label ?? "THE DESTINATION").split(",")[0].toUpperCase()}`}
            </button>
          )}
        </div>
        {(loc === "denied" || loc === "failed") && (
          <p className="mt-4 font-display text-[19px] leading-snug tracking-[-0.01em]" data-location-off>
            {loc === "denied" ? "Location's off." : "I couldn't get a fix on your location."} {fallback === "stay" ? "I can search around your hotel instead." : fallback ? "I can search around the destination instead." : "Add a destination and I can search around that."}
          </p>
        )}
        {!fallback && loc === "idle" && <p className="mt-4 text-sm text-muted-foreground">Add a destination first. Without your location, there&apos;s nothing to centre on yet.</p>}
      </div>
    );
  }

  const renderCard = (p: AroundPlace, catKey: string, whyText: string | null | undefined, extra?: React.ReactNode) => {
    const on = saved.includes(p.providerPlaceId);
    const open = routeFor === p.providerPlaceId;
    const cc = AROUND_CATEGORIES[catKey] ?? AROUND_CATEGORIES[cat];
    return (
          <li key={p.providerPlaceId} className="py-4" data-around-place={p.name}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="eyebrow">
                  {cc.icon} {cc.label}
                </p>
                <p className="shrink-0 text-[12px] font-semibold text-foreground">{p.walkMinutes != null ? `${p.walkMinutes} min walk` : p.distanceMeters != null ? `${p.distanceMeters >= 1000 ? (p.distanceMeters / 1000).toFixed(1) + " km" : Math.round(p.distanceMeters) + " m"} away` : ""}</p>
              </div>
              <p className="mt-1 font-display text-[21px] leading-[1.1] tracking-[-0.01em]">{p.name}</p>
              {p.address && <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">{p.address}</p>}
              <p className="mt-1 text-[12px] text-muted-foreground" data-hours>
                {p.hoursNow?.state === "open" && <span className="font-semibold text-accent-strong">{p.hoursNow.until ? `Open until ${p.hoursNow.until}` : "Open now"} · </span>}
                {p.hoursNow?.state === "closed" && <span className="font-semibold text-danger">{p.hoursNow.opensAt ? `Closed now, opens ${p.hoursNow.opensAt}` : "Closed now"} · </span>}
                {p.openingHours ? `Hours: ${p.openingHours}` : "Hours unavailable"}
              </p>
              {whyText && (
                <p className="mt-2 text-[12.5px] leading-snug" data-why>
                  <span className="font-semibold">Why Clockwise picked it:</span> {whyText}
                </p>
              )}
              <div className="mt-3 flex items-center gap-4">
                <button
                  type="button"
                  data-route
                  onClick={() => {
                    if (open) return setRouteFor(null);
                    setRouteFor(p.providerPlaceId);
                    setRoute(null);
                    setRouteErr(null);
                    start(async () => {
                      const r = await routeToPlaceAction(tripId, { name: p.name, lat: p.lat, lng: p.lng }, { anchor, me });
                      if (r.ok) setRoute(r);
                      else setRouteErr(r.error);
                    });
                  }}
                  className="cursor-pointer text-xs font-semibold text-accent"
                >
                  {open ? "HIDE ROUTE" : "ROUTE"}
                </button>
                <button
                  type="button"
                  data-save
                  onClick={() =>
                    start(async () => {
                      const r = await toggleSavePlaceAction(tripId, p, cat);
                      if (r.ok) {
                        setSaved((s) => (r.saved ? [...s, p.providerPlaceId] : s.filter((x) => x !== p.providerPlaceId)));
                        setOverlap(r.saved && r.overlap ? { id: p.providerPlaceId, name: p.name, count: r.overlap } : null);
                      }
                    })
                  }
                  className={`flex cursor-pointer items-center gap-1 text-xs font-semibold ${on ? "text-accent-strong" : "text-muted-foreground"}`}
                >
                  <Heart className="size-3.5" fill={on ? "currentColor" : "none"} />
                  {on ? "SAVED" : "SAVE"}
                </button>
                {on && (
                  <button
                    type="button"
                    data-propose
                    disabled={proposed.includes(p.providerPlaceId)}
                    onClick={() =>
                      start(async () => {
                        const r = await proposePlaceAction(tripId, p, catKey);
                        if (r.ok) setProposed((x) => [...x, p.providerPlaceId]);
                        else setErr(r.error ?? "Couldn't propose it.");
                      })
                    }
                    className="cursor-pointer text-xs font-semibold text-accent-strong disabled:opacity-60"
                  >
                    {proposed.includes(p.providerPlaceId) ? "PROPOSED" : "PROPOSE"}
                  </button>
                )}
                <a href={`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-muted-foreground underline">
                  Open in Maps
                </a>
              </div>
              {extra}
              {open && (
                <div className="mt-3 space-y-2 rounded-2xl bg-surface-muted p-3.5" data-route-panel>
                  {routeErr && <p className="text-xs text-danger">{routeErr}</p>}
                  {!route && !routeErr && <p className="text-xs text-muted-foreground">Asking Geoapify for the route…</p>}
                  {route && (
                    <>
                      <p className="text-xs">
                        <span className="font-semibold">{route.fromLabel}</span> → <span className="font-semibold">{route.toLabel}</span>
                      </p>
                      {route.geometry && route.geometry.length > 1 && <RouteMap geometry={route.geometry} />}
                      <ul className="space-y-0.5 text-xs">
                        {route.legs.map((l) => (
                        <li key={l.mode} data-route-leg={l.mode}>
                            <span className="font-semibold">{MODE_LABEL[l.mode] ?? l.mode}</span> · {l.durationMinutes} min · {l.distanceMeters >= 1000 ? (l.distanceMeters / 1000).toFixed(1) + " km" : Math.round(l.distanceMeters) + " m"}
                          </li>
                        ))}
                      </ul>
                      <p className="text-[11px] text-muted-foreground">Geoapify routing, {new Date(route.retrievedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}. Only modes the provider returned are shown.</p>
                    </>
                  )}
                </div>
              )}
            </li>
    );
  };

  return (
    <div className="space-y-5">
      <header>
        <p className="eyebrow flex items-center gap-2">
          <span className="text-accent-strong">
            <ClockwiseMark size={18} working={busy} />
          </span>
          Around you
        </p>
        <h1 className="headline headline-xl mt-2">Around {whereText}.</h1>
        <p className="lede mt-2" data-anchor-note>
          {anchor === "me" && fix
            ? `Location from ${minutesAgo(fix.at, now)}. Private to you.`
            : anchor === "stay"
              ? anchors.stay.label
              : anchor === "arrival"
                ? anchors.arrival.label
                : "Based around the destination. It isn't your hotel or where you are."}
          {anchor === "me" && fix && (
            <button type="button" onClick={requestMyLocation} className="ml-2 cursor-pointer font-semibold text-accent">
              REFRESH
            </button>
          )}
        </p>
      </header>

      <div>
        <p className="eyebrow mb-2">Searching around</p>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {anchorChips.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={!c.ok || loc === "asking"}
              title={c.ok ? undefined : c.why}
              onClick={() => pickAnchor(c.id)}
              data-anchor={c.id}
              className={`relative py-1.5 text-[12.5px] font-semibold tracking-[0.12em] ${anchor === c.id ? "text-foreground" : "text-muted-foreground"} ${c.ok ? "cursor-pointer hover:text-foreground" : "cursor-not-allowed opacity-35"}`}
            >
              <span className="mr-1.5 opacity-80">{c.icon}</span>
              {c.label}
              <span className={`absolute inset-x-0 -bottom-px h-[2px] rounded-full ${anchor === c.id ? "bg-accent" : "bg-transparent"}`} />
            </button>
          ))}
        </div>
        {(loc === "denied" || loc === "failed") && (
          <p className="mt-3 font-display text-[18px] leading-snug tracking-[-0.01em]" data-location-off>
            {loc === "denied" ? "Location's off." : "I couldn't get a fix on your location."} {anchors.stay.available ? "I can search around your hotel instead." : "Pick another anchor above."}
            {anchors.stay.available && (
              <button type="button" onClick={() => setAnchor("stay")} className="ml-2 cursor-pointer font-sans text-xs font-semibold tracking-[0.12em] text-accent">
                AROUND OUR HOTEL
              </button>
            )}
          </p>
        )}
      </div>

      {/* RIGHT NOW: the traveller's clock + where they are + what's next. Deterministic; no model involved. */}
      <section className="section space-y-2" data-right-now>
        <p className="eyebrow">Right now</p>
        {nextUp && "commitment" in nextUp && (
          <div data-next-up>
            <p className="headline headline-md">
              ◷ {nextUp.commitment.name.toUpperCase()} {nextUp.minutesUntil > 0 ? `IN ${fmtDur(nextUp.minutesUntil)}` : "IS NOW"}
            </p>
            {nextUp.walkMinutes != null ? (
              <p className="text-sm">
                About a {nextUp.walkMinutes}-minute walk from {nextUp.fromLabel}. {nextUp.leaveByLocal && nextUp.minutesUntil > nextUp.walkMinutes ? `Leave around ${hhmm(nextUp.leaveByLocal)}?` : nextUp.minutesUntil <= nextUp.walkMinutes ? "You'd need to leave now." : ""}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">I couldn&apos;t place &ldquo;{nextUp.commitment.location}&rdquo; on the map, so there&apos;s no walk time to show.</p>
            )}
            {nextUp.toPoint && nextUp.walkMinutes != null && (
              <button
                type="button"
                className="mt-1 cursor-pointer text-xs font-semibold text-accent"
                onClick={() => {
                  const tp = nextUp.toPoint!;
                  const id = "next-up";
                  setRouteFor(id);
                  setRoute(null);
                  setRouteErr(null);
                  start(async () => {
                    const r = await routeToPlaceAction(tripId, { name: nextUp.commitment.location, lat: tp.lat, lng: tp.lng }, { anchor, me });
                    if (r.ok) setRoute(r);
                    else setRouteErr(r.error);
                  });
                }}
              >
                ROUTE
              </button>
            )}
            {routeFor === "next-up" && (
              <div className="mt-2 space-y-1 rounded-lg border border-border p-2 text-xs" data-route-panel>
                {routeErr && <p className="text-danger">{routeErr}</p>}
                {!route && !routeErr && <p className="text-muted-foreground">Asking Geoapify for the route…</p>}
                {route && route.legs.map((l) => (
                  <p key={l.mode} data-route-leg={l.mode}>
                    <span className="font-semibold">{MODE_LABEL[l.mode] ?? l.mode}</span> · {l.durationMinutes} min · {l.distanceMeters >= 1000 ? (l.distanceMeters / 1000).toFixed(1) + " km" : Math.round(l.distanceMeters) + " m"}
                  </p>
                ))}
              </div>
            )}
            {nextUp.rain && (
              <p className="mt-1 text-xs" data-rain>
                🌧 Rain is likely around {hhmm(nextUp.rain.atLocal)} ({nextUp.rain.probability}% chance, Open-Meteo).
              </p>
            )}
          </div>
        )}
        {nextUp && "none" in nextUp && <p className="text-xs text-muted-foreground">{nextUp.none}</p>}
        {!nextUp && <p className="text-xs text-muted-foreground">Checking your clock…</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
          <button
            type="button"
            data-what-can-we-do
            disabled={busy}
            onClick={() =>
              start(async () => {
                setFreeErr(null);
                const r = await freeTimeAction(tripId, { anchor, me, minutes: minutes ?? undefined });
                if ("ok" in r && r.ok === false) {
                  setFree(null);
                  setFreeErr(r.error);
                } else setFree(r as FreeTime & { anchorType: Anchor });
              })
            }
            className="cursor-pointer rounded-full bg-accent px-4 py-2 text-[12px] font-semibold tracking-[0.12em] text-accent-foreground"
          >
            WHAT CAN I DO NOW?
          </button>
          {[30, 60, 90, 120].map((m) => (
            <button key={m} type="button" onClick={() => setMinutes(minutes === m ? null : m)} className={`cursor-pointer rounded-full border px-3 py-1.5 text-[11.5px] font-semibold tracking-wide ${minutes === m ? "border-accent bg-accent-tint text-accent-strong" : "border-border text-muted-foreground"}`}>
              {m} MIN
            </button>
          ))}
        </div>
        {freeErr && <p className="text-xs text-danger" data-free-error>{freeErr}</p>}
        {free && free.anchorType === anchor && (
          <div className="space-y-2 pt-1" data-free-time>
            <p className="eyebrow">If you have</p>
            <p className="headline headline-lg uppercase">{killWords(free.windowMinutes)} to kill.</p>
            {free.next && free.windowSource === "next-commitment" && <p className="text-xs text-muted-foreground">Until {free.next.name} at {hhmm(free.next.targetLocal)}, {free.next.pointLabel ?? "location not on the map"}.</p>}
            {free.rainyMode && free.rain && <p className="flex items-center gap-3 text-[13px]" data-rainy><BengaluruArt scene="rain" className="w-16 shrink-0" />RAINY WINDOW. Rain is likely around {hhmm(free.rain.atLocal)} ({free.rain.probability}%). Indoor-type places only.</p>}
            {free.options.length === 0 && <p className="text-sm text-muted-foreground">Nothing I checked fits that window (I routed {free.considered} real places{free.closedDropped ? `, ${free.closedDropped} dropped because their hours say closed` : ""}). Try a longer window or a different anchor.</p>}
            {free.options.length > 0 && free.closedDropped > 0 && <p className="text-[11px] text-muted-foreground">{free.closedDropped} place(s) left out because the provider&apos;s hours say they&apos;re closed during your visit.</p>}
            <ul className="row-rule">
              {free.options.map((o) =>
                renderCard(
                  o.place,
                  o.category,
                  o.why,
                  <p className="mt-1 text-xs" data-fits>
                    <span className="font-semibold text-accent-strong">Fits ✓</span> · {o.hours.state === "open" ? `open for your visit${o.hours.until ? ` (until ${o.hours.until})` : ""}` : (o.place.openingHours ? "hours unclear (holiday rules), check before you go" : "hours unavailable, check before you go")} · {o.walkToMin} min away · ~{o.stayMin} min there (assumed) · {o.walkOnMin} min {free.windowSource === "next-commitment" && free.next ? `to ${free.next.name} afterwards` : "back afterwards"} · {o.spareMin} min spare
                  </p>
                )
              )}
            </ul>
            <p className="text-[11px] text-muted-foreground">{free.assumptions} Places and walking times: Geoapify. Weather and local time: Open-Meteo.</p>
          </div>
        )}
      </section>

      <div className="section !mt-6 !pt-5">
        <p className="eyebrow mb-1">Looking for</p>
        <div className="-mx-5 flex gap-5 overflow-x-auto px-5 [scrollbar-width:none]">
          {ordered.map((c) => (
            <button key={c} type="button" onClick={() => { setCat(c); setMaxWalk(null); }} data-around-cat={c} className={`relative shrink-0 cursor-pointer py-2 text-[14px] tracking-wide ${cat === c ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
              <span className="mr-1.5 opacity-80">{AROUND_CATEGORIES[c].icon}</span>
              {AROUND_CATEGORIES[c].label}
              <span className={`absolute inset-x-0 -bottom-px h-[2px] rounded-full ${cat === c ? "bg-accent" : "bg-transparent"}`} />
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {[5, 10, 15].map((m) => (
          <button key={m} type="button" onClick={() => setMaxWalk(maxWalk === m ? null : m)} className={`cursor-pointer rounded-full border px-3 py-1.5 text-[11.5px] font-semibold tracking-wide ${maxWalk === m ? "border-accent bg-accent-tint text-accent-strong" : "border-border text-muted-foreground"}`}>
            {m} MIN WALK
          </button>
        ))}
        {(cat === "restaurant" || cat === "cafe") && (
          <button type="button" onClick={() => setVeg((v) => !v)} className={`cursor-pointer rounded-full border px-3 py-1.5 text-[11.5px] font-semibold tracking-wide ${veg ? "border-accent bg-accent-tint text-accent-strong" : "border-border text-muted-foreground"}`}>
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
            const r = await brandSearchAction(tripId, brand, { anchor, me });
            if (r.ok) {
              setRes(r);
              setSaved(r.saved);
            } else setErr(r.error);
          });
        }}
      >
        <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Looking for a store? e.g. 7-Eleven" className="flex-1 rounded-full border border-border bg-surface px-4 py-2.5 text-sm focus:border-accent focus:outline-none" />
        <button type="submit" disabled={busy} className="cursor-pointer rounded-full bg-accent px-5 py-2.5 text-xs font-semibold tracking-[0.12em] text-accent-foreground">
          FIND
        </button>
      </form>

      {err && <p className="text-sm text-danger" data-around-error>{err}</p>}
      {res?.note && (
        <div className="border-l-2 border-accent pl-3" data-around-note>
          {brand.trim() && <p className="font-display text-[19px] leading-snug tracking-[-0.01em]">{HUMAN.noBrand(brand.trim(), null)}</p>}
          <p className="mt-0.5 text-[12.5px] leading-snug text-foreground">{res.note}</p>
        </div>
      )}
      {overlap && (
        <div className="border-l-2 border-accent pl-3" data-overlap>
          <p className="eyebrow text-accent">◷ Wait.</p>
          <p className="headline headline-md mt-1">{countWordTitle(overlap.count)} of you saved this.</p>
          <p className="mt-1 text-[13px] font-semibold">{overlap.name}</p>
          <p className="text-xs text-muted-foreground">Nobody is told who. See it under Saved.</p>
        </div>
      )}

      {res && shown.length > 0 && CATEGORY_HEADLINE[res.category] && (
        <h2 className="headline headline-lg mt-2" data-around-headline>{CATEGORY_HEADLINE[res.category]}</h2>
      )}
      <ul className="row-rule">
        {shown.map((p) => renderCard(p, res?.category ?? cat, res?.why[p.providerPlaceId]))}
        {res && shown.length === 0 && !busy && <li className="text-sm text-muted-foreground">Nothing found{maxWalk ? ` within a ${maxWalk}-minute walk` : " here"} in the provider&apos;s data.</li>}
      </ul>
      {res && (
        <p className="text-[11px] text-muted-foreground">
          Geoapify · {new Date(res.retrievedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · A place being nearby doesn&apos;t mean it stocks a particular product. Walking times are provider routes. Hours appear only when the provider supplies them.
        </p>
      )}
    </div>
  );
}
