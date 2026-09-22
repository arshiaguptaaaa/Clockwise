// Mobility provider interface. UberSandboxProvider (src/lib/providers/
// uber-sandbox-provider.ts) is the only implementation — a future
// UberProductionProvider or a different carrier implements the same
// interface without touching any call site (agent tools, card-actions,
// TransportCard all only ever import `mobilityProvider` + these types).
//
// Every method takes a resolved access token (MobilityAuth) rather than a
// userId — token lookup/refresh is Uber-specific plumbing that lives in
// src/lib/uber/connection.ts, kept out of the provider so the interface
// itself stays auth-implementation-agnostic.

export type MobilityAuth = { accessToken: string };

export type MobilityRoute = {
  pickup: { lat: number; lng: number; label: string };
  destination: { lat: number; lng: number; label: string };
};

export type MobilityProduct = {
  productId: string;
  displayName: string;
  capacity: number;
};

// One row per product the group could take — grouped by how many vehicles
// of that product are actually needed for the party size, using the real
// capacity the provider returned (never a hardcoded "3 people per car").
export type VehicleOption = {
  productId: string;
  displayName: string;
  vehiclesNeeded: number;
  perVehicleCapacity: number;
  lowEstimate: number;
  highEstimate: number;
  currency: string;
  pickupEtaMinutes: number | null;
  surgeMultiplier: number;
};

export type PreparedRide = {
  productId: string;
  fareId: string;
  fareQuotedAt: number; // epoch ms — used to enforce a conservative expiry if the provider doesn't return one
  fareExpiresAt: number | null; // epoch ms from the provider, if given
  lowEstimate: number;
  highEstimate: number;
  currency: string;
  pickupEtaMinutes: number | null;
};

export type RequestedRide = {
  providerRideId: string;
  status: string; // raw provider status string — mapped to Clockwise's RideOrder.status by the caller
  surgeMultiplier: number | null;
  pickupEtaMinutes: number | null;
};

export type RideStatus = {
  providerRideId: string;
  status: string;
};

export interface MobilityProvider {
  getProducts(auth: MobilityAuth, pickup: { lat: number; lng: number }): Promise<MobilityProduct[]>;
  getEstimate(auth: MobilityAuth, route: MobilityRoute, partySize: number): Promise<VehicleOption[]>;
  prepareRide(auth: MobilityAuth, route: MobilityRoute, productId: string): Promise<PreparedRide>;
  requestRide(auth: MobilityAuth, route: MobilityRoute, prepared: PreparedRide): Promise<RequestedRide>;
  getRide(auth: MobilityAuth, providerRideId: string): Promise<RideStatus>;
  cancelRide(auth: MobilityAuth, providerRideId: string): Promise<void>;
}

export { uberSandboxProvider as mobilityProvider } from "./uber-sandbox-provider";
