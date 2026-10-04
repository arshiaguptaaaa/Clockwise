// One place that decides WHICH provider measures a drive between two points, and says so.
// India: Delhivery Maps (its traffic-aware, hour-of-day estimate keyed to the departure time) when the
// token works; otherwise Geoapify. Outside India, or if Delhivery fails, Geoapify, and the result says
// "geoapify". A provider failure is never papered over with a guess: no provider => the caller reports unknown.
import { getRoute as geoapifyRoute, isGeoapifyConfigured } from "./geoapify-provider";
import { delhiveryRoute, isDelhiveryConfigured, inIndia } from "@/lib/delhivery/client";
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

export async function driveRoute(from: LatLng, to: LatLng, opts: { departLocal?: string | null; decision?: string } = {}): Promise<DriveRoute> {
  let fellBackFrom: string | undefined;
  if (isDelhiveryConfigured() && inIndia(from) && inIndia(to)) {
    const useTraffic = Boolean(opts.departLocal);
    const r = await delhiveryRoute(from, to, { mode: "auto", trafficAware: useTraffic, departureTime: opts.departLocal ?? null, decision: opts.decision });
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
  const g = await geoapifyRoute(from, to, "drive");
  return { provider: "geoapify", distanceMeters: g.distanceMeters, durationSeconds: g.durationSeconds, retrievedAt: g.retrievedAt, basis: "Geoapify driving route (free-flow, no traffic model)", trafficAware: false, departureTime: null, evidenceId: null, fellBackFrom };
}
