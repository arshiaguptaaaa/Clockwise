// One place that decides WHICH provider measures a drive between two points, and says so.
// India: Delhivery Maps (its traffic-aware, hour-of-day estimate keyed to the departure time) when the
// token works; otherwise Geoapify. Outside India, or if Delhivery fails, Geoapify, and the result says
// "geoapify". A provider failure is never papered over with a guess: no provider => the caller reports unknown.
import { getRoute as geoapifyRoute, isGeoapifyConfigured } from "./geoapify-provider";
import { delhiveryRoute, isDelhiveryConfigured, inIndia } from "@/lib/delhivery/client";
import { logRailCall } from "@/lib/rails/evidence";
import type { LatLng } from "./types";

export type DriveRoute = {
  provider: "delhivery" | "geoapify";
  distanceMeters: number;
  durationSeconds: number;
  retrievedAt: string;
  // How the number was produced, in words that never overclaim.
  basis: string;
  trafficAware: boolean;
  departureTime: string | null;
  evidenceId: string | null;
  fellBackFrom?: string;
};

export async function driveRoute(from: LatLng, to: LatLng, opts: { departLocal?: string | null; decision?: string; tripId?: string | null; userId?: string | null } = {}): Promise<DriveRoute> {
  let fellBackFrom: string | undefined;
  if (isDelhiveryConfigured() && inIndia(from) && inIndia(to)) {
    const useTraffic = Boolean(opts.departLocal);
    const r = await delhiveryRoute(from, to, { mode: "auto", trafficAware: useTraffic, departureTime: opts.departLocal ?? null, decision: opts.decision, tripId: opts.tripId, userId: opts.userId });
    if (r.ok && r.route) {
      return {
        provider: "delhivery",
        distanceMeters: r.route.distanceMeters,
        durationSeconds: r.route.durationSeconds,
        retrievedAt: new Date().toISOString(),
        basis: useTraffic ? `Delhivery Maps traffic-aware estimate for a ${opts.departLocal!.slice(11)} departure (hour-of-day model, not live traffic)` : "Delhivery Maps route estimate (no traffic model)",
        trafficAware: useTraffic,
        departureTime: useTraffic ? opts.departLocal ?? null : null,
        evidenceId: r.evidenceId,
      };
    }
    fellBackFrom = r.ok ? "delhivery (no usable duration in the response)" : `delhivery (${r.blocked ?? r.error})`;
  }
  if (!isGeoapifyConfigured()) throw new Error("No routing provider is configured.");
  // Geoapify's answer (or failure) is recorded as its own rail call, so the evidence shows WHICH provider produced the number and
  // WHY it was asked: as a labelled fallback for Delhivery, or because Delhivery is not configured for this route.
  const why = fellBackFrom ? `FALLBACK: Delhivery was asked first and did not answer (${fellBackFrom})` : isDelhiveryConfigured() ? "Delhivery is only used inside India; this route is outside it" : "Delhivery is not configured in this environment";
  const started = Date.now();
  let g;
  try {
    g = await geoapifyRoute(from, to, "drive");
  } catch (err) {
    await logRailCall({ partner: "GEOAPIFY", operation: "route", endpoint: "GET https://api.geoapify.com/v1/routing", method: "GET", request: { waypoints: `${from.lat},${from.lng}|${to.lat},${to.lng}`, mode: "drive" }, response: { error: err instanceof Error ? err.message.slice(0, 200) : "failed" }, httpStatus: null, durationMs: Date.now() - started, context: { tripId: opts.tripId, userId: opts.userId, decision: `${opts.decision ?? "Route"} · ${why} · GEOAPIFY FAILED` } });
    throw err;
  }
  await logRailCall({ partner: "GEOAPIFY", operation: "route", endpoint: "GET https://api.geoapify.com/v1/routing", method: "GET", request: { waypoints: `${from.lat},${from.lng}|${to.lat},${to.lng}`, mode: "drive" }, response: { distance_m: Math.round(g.distanceMeters), duration_s: Math.round(g.durationSeconds), provider: "geoapify" }, httpStatus: 200, durationMs: Date.now() - started, context: { tripId: opts.tripId, userId: opts.userId, decision: `${opts.decision ?? "Route"} · ${why}` } });
  return { provider: "geoapify", distanceMeters: g.distanceMeters, durationSeconds: g.durationSeconds, retrievedAt: g.retrievedAt, basis: "Geoapify driving route (free-flow, no traffic model)", trafficAware: false, departureTime: null, evidenceId: null, fellBackFrom };
}
