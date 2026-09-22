// Deterministic, server-only Uber Riders API client. Never imported by
// agent code (src/lib/agent/**) — only by
// src/lib/providers/uber-sandbox-provider.ts and the OAuth routes. UBER_ENV
// controls the base URL; there is no fallback to production if it's unset.
function baseUrl(): string {
  const env = process.env.UBER_ENV ?? "sandbox";
  if (env === "production") return "https://api.uber.com";
  if (env === "sandbox") return "https://sandbox-api.uber.com";
  throw new Error(`Unknown UBER_ENV "${env}" — expected "sandbox" or "production".`);
}

const API_VERSION = "v1.2";

export class UberApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`Uber API error ${status}: ${body}`);
    this.status = status;
    this.body = body;
  }
}

async function uberFetch<T>(
  path: string,
  accessToken: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${baseUrl()}/${API_VERSION}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new UberApiError(res.status, await res.text());
  }
  if (res.status === 204) return null as T;
  return res.json();
}

export type UberProfile = {
  uuid: string;
  first_name: string;
  last_name: string;
  email: string;
};

export function getProfile(accessToken: string): Promise<UberProfile> {
  return uberFetch<UberProfile>("/me", accessToken);
}

export type UberProduct = {
  product_id: string;
  display_name: string;
  capacity: number;
  description?: string;
};

export function getProducts(
  accessToken: string,
  lat: number,
  lng: number
): Promise<{ products: UberProduct[] }> {
  return uberFetch(`/products?latitude=${lat}&longitude=${lng}`, accessToken);
}

export type UberPriceEstimate = {
  product_id: string;
  display_name: string;
  currency_code: string;
  low_estimate: number;
  high_estimate: number;
  surge_multiplier: number;
  duration: number; // seconds
  distance: number;
};

export function getPriceEstimates(
  accessToken: string,
  route: { startLat: number; startLng: number; endLat: number; endLng: number }
): Promise<{ prices: UberPriceEstimate[] }> {
  const params = new URLSearchParams({
    start_latitude: String(route.startLat),
    start_longitude: String(route.startLng),
    end_latitude: String(route.endLat),
    end_longitude: String(route.endLng),
  });
  return uberFetch(`/estimates/price?${params}`, accessToken);
}

export type UberRequestEstimate = {
  fare_id?: string;
  fare?: { fare_id: string; value: number; currency_code: string; expires_at?: number };
  pickup_estimate: number | null;
  trip?: { duration_estimate: number; distance_estimate: number };
};

// Upfront-fare quote for one specific product, right before booking — the
// fare_id from this call is what expires and must be re-fetched if stale
// (see requestRide's expiry check in the provider).
export function getRequestEstimate(
  accessToken: string,
  params: {
    productId: string;
    startLat: number;
    startLng: number;
    endLat: number;
    endLng: number;
  }
): Promise<UberRequestEstimate> {
  return uberFetch("/requests/estimate", accessToken, {
    method: "POST",
    body: JSON.stringify({
      product_id: params.productId,
      start_latitude: params.startLat,
      start_longitude: params.startLng,
      end_latitude: params.endLat,
      end_longitude: params.endLng,
    }),
  });
}

export type UberRideRequest = {
  request_id: string;
  product_id: string;
  status: string;
  eta: number | null;
  surge_multiplier: number | null;
};

export function createRideRequest(
  accessToken: string,
  params: {
    fareId: string;
    productId: string;
    startLat: number;
    startLng: number;
    endLat: number;
    endLng: number;
  }
): Promise<UberRideRequest> {
  return uberFetch("/requests", accessToken, {
    method: "POST",
    body: JSON.stringify({
      fare_id: params.fareId,
      product_id: params.productId,
      start_latitude: params.startLat,
      start_longitude: params.startLng,
      end_latitude: params.endLat,
      end_longitude: params.endLng,
    }),
  });
}

export function getRideRequest(
  accessToken: string,
  requestId: string
): Promise<UberRideRequest> {
  return uberFetch(`/requests/${requestId}`, accessToken);
}

export function cancelRideRequest(accessToken: string, requestId: string): Promise<null> {
  return uberFetch(`/requests/${requestId}`, accessToken, { method: "DELETE" });
}

// Sandbox-only: walks a request through the simulated lifecycle. Calling
// this against UBER_ENV=production would be a real error from Uber — the
// provider never calls this function outside sandbox.
export function setSandboxRequestStatus(
  accessToken: string,
  requestId: string,
  status: "accepted" | "arriving" | "in_progress" | "completed" | "driver_canceled" | "no_drivers_available"
): Promise<null> {
  return uberFetch(`/sandbox/requests/${requestId}`, accessToken, {
    method: "PUT",
    body: JSON.stringify({ status }),
  });
}
