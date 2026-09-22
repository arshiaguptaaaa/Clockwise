// Real calls against Uber's sandbox (or production, per UBER_ENV) Riders
// API — never a mock. Product listings and price estimates are proxied by
// Uber straight to production data even in sandbox; only ride *requests*
// are simulated (see architecture notes). On any failure this throws —
// callers must show the real error, never invent a fare or status.
import * as client from "@/lib/uber/client";
import type {
  MobilityProvider,
  MobilityAuth,
  MobilityRoute,
  MobilityProduct,
  VehicleOption,
  PreparedRide,
  RequestedRide,
  RideStatus,
} from "./mobility";

const CONSERVATIVE_FARE_EXPIRY_MS = 5 * 60 * 1000;

export function mapUberStatus(raw: string): string {
  switch (raw) {
    case "processing":
      return "PROCESSING";
    case "accepted":
      return "ACCEPTED";
    case "arriving":
      return "ARRIVING";
    case "in_progress":
      return "IN_PROGRESS";
    case "completed":
      return "COMPLETED";
    case "driver_canceled":
      return "DRIVER_CANCELLED";
    case "rider_canceled":
      return "RIDER_CANCELLED";
    case "no_drivers_available":
      return "FAILED";
    default:
      return "FAILED";
  }
}

export function isFareExpired(prepared: PreparedRide): boolean {
  if (prepared.fareExpiresAt) return Date.now() >= prepared.fareExpiresAt;
  return Date.now() - prepared.fareQuotedAt >= CONSERVATIVE_FARE_EXPIRY_MS;
}

class UberSandboxProvider implements MobilityProvider {
  async getProducts(
    auth: MobilityAuth,
    pickup: { lat: number; lng: number }
  ): Promise<MobilityProduct[]> {
    const { products } = await client.getProducts(auth.accessToken, pickup.lat, pickup.lng);
    return products.map((p) => ({
      productId: p.product_id,
      displayName: p.display_name,
      capacity: p.capacity,
    }));
  }

  async getEstimate(
    auth: MobilityAuth,
    route: MobilityRoute,
    partySize: number
  ): Promise<VehicleOption[]> {
    const [{ products }, { prices }] = await Promise.all([
      client.getProducts(auth.accessToken, route.pickup.lat, route.pickup.lng),
      client.getPriceEstimates(auth.accessToken, {
        startLat: route.pickup.lat,
        startLng: route.pickup.lng,
        endLat: route.destination.lat,
        endLng: route.destination.lng,
      }),
    ]);

    const capacityByProduct = new Map(products.map((p) => [p.product_id, p]));

    const options: VehicleOption[] = [];
    for (const price of prices) {
      const product = capacityByProduct.get(price.product_id);
      // Never show a product we can't size correctly, and never show one
      // Uber didn't actually return pricing for on this route.
      if (!product || !product.capacity) continue;

      const vehiclesNeeded = Math.max(1, Math.ceil(partySize / product.capacity));
      options.push({
        productId: price.product_id,
        displayName: price.display_name,
        vehiclesNeeded,
        perVehicleCapacity: product.capacity,
        lowEstimate: price.low_estimate * vehiclesNeeded,
        highEstimate: price.high_estimate * vehiclesNeeded,
        currency: price.currency_code,
        pickupEtaMinutes: null,
        surgeMultiplier: price.surge_multiplier,
      });
    }

    return options.sort(
      (a, b) => a.vehiclesNeeded - b.vehiclesNeeded || a.lowEstimate - b.lowEstimate
    );
  }

  async prepareRide(
    auth: MobilityAuth,
    route: MobilityRoute,
    productId: string
  ): Promise<PreparedRide> {
    const est = await client.getRequestEstimate(auth.accessToken, {
      productId,
      startLat: route.pickup.lat,
      startLng: route.pickup.lng,
      endLat: route.destination.lat,
      endLng: route.destination.lng,
    });

    const fareId = est.fare?.fare_id ?? est.fare_id;
    if (!fareId) {
      throw new Error("Uber did not return a bookable fare quote for this product on this route.");
    }

    return {
      productId,
      fareId,
      fareQuotedAt: Date.now(),
      fareExpiresAt: est.fare?.expires_at ? est.fare.expires_at * 1000 : null,
      lowEstimate: est.fare?.value ?? 0,
      highEstimate: est.fare?.value ?? 0,
      currency: est.fare?.currency_code ?? "USD",
      pickupEtaMinutes: est.pickup_estimate,
    };
  }

  async requestRide(
    auth: MobilityAuth,
    route: MobilityRoute,
    prepared: PreparedRide
  ): Promise<RequestedRide> {
    if (isFareExpired(prepared)) {
      throw new Error("FARE_EXPIRED");
    }
    const result = await client.createRideRequest(auth.accessToken, {
      fareId: prepared.fareId,
      productId: prepared.productId,
      startLat: route.pickup.lat,
      startLng: route.pickup.lng,
      endLat: route.destination.lat,
      endLng: route.destination.lng,
    });
    return {
      providerRideId: result.request_id,
      status: mapUberStatus(result.status),
      surgeMultiplier: result.surge_multiplier,
      pickupEtaMinutes: result.eta,
    };
  }

  async getRide(auth: MobilityAuth, providerRideId: string): Promise<RideStatus> {
    const result = await client.getRideRequest(auth.accessToken, providerRideId);
    return { providerRideId: result.request_id, status: mapUberStatus(result.status) };
  }

  async cancelRide(auth: MobilityAuth, providerRideId: string): Promise<void> {
    await client.cancelRideRequest(auth.accessToken, providerRideId);
  }
}

export const uberSandboxProvider = new UberSandboxProvider();

// Sandbox-only development tooling — walks a simulated ride through the
// lifecycle Uber would otherwise drive with a real driver. Never callable
// when UBER_ENV=production; there is no equivalent production endpoint.
export async function advanceSandboxRide(
  auth: MobilityAuth,
  providerRideId: string,
  status: "accepted" | "arriving" | "in_progress" | "completed" | "driver_canceled"
): Promise<void> {
  if ((process.env.UBER_ENV ?? "sandbox") !== "sandbox") {
    throw new Error("advanceSandboxRide is only available when UBER_ENV=sandbox.");
  }
  await client.setSandboxRequestStatus(auth.accessToken, providerRideId, status);
}
