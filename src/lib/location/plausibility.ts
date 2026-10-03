// Deterministic sanity check on a provider-measured route. It never computes a
// replacement distance: it only decides whether the two endpoints are credible
// for THIS trip, and if not, the answer must be withheld and the entities
// re-resolved with the user.
import type { Anchor } from "@/lib/travel/resolve";

type Point = { lat: number; lng: number };

export function haversineM(a: Point, b: Point): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type Plausibility = { ok: true } | { ok: false; reason: string };

const SAME_NAME_FAR_M = 50_000;
const LOCAL_PAIR_M = 100_000;

export function checkRoutePlausibility(p: {
  from: { label: string; point: Point };
  to: { label: string; point: Point };
  distanceMeters: number;
  anchors: Anchor[];
}): Plausibility {
  // SAME NAME, WRONG PLACE: an endpoint that carries the name of one of this trip's
  // destinations but lies far from it ("Udaipur, Jhunjhunun" for a trip to Udaipur,
  // Rajasthan). A legitimately different city (Jaipur, Delhi) is never touched.
  const head = (l: string) => l.split(",")[0].toLowerCase().replace(/\b(international|domestic)?\s*airport\b/g, "").trim();
  for (const end of [p.from, p.to]) {
    for (const a of p.anchors.filter((x) => x.kind === "destination")) {
      const d = haversineM(a.point, end.point);
      if (head(end.label) && head(end.label) === head(a.label) && d > SAME_NAME_FAR_M) {
        return { ok: false, reason: `"${end.label}" shares its name with this trip's ${a.label} but is ${Math.round(d / 1000)} km away from it` };
      }
    }
  }
  // An airport and the stay (or any two endpoints inside the same destination) are
  // a local hop; hundreds of km between them means one end is the wrong place.
  const stay = p.anchors.find((a) => a.kind === "stay");
  const isAirport = (l: string) => /airport|airfield/i.test(l);
  const touchesStay = stay && [p.from, p.to].some((e) => haversineM(e.point, stay.point) < 500);
  const hasAirport = isAirport(p.from.label) || isAirport(p.to.label);
  if (touchesStay && hasAirport && p.distanceMeters > LOCAL_PAIR_M) {
    return { ok: false, reason: `an airport-to-stay route of ${(p.distanceMeters / 1000).toFixed(0)} km is not a local transfer` };
  }
  return { ok: true };
}
