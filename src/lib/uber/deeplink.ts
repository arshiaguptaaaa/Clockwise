// LEVEL 1 UBER: the official universal link (https://m.uber.com/ul/). It opens Uber (app or web) with the pickup
// and destination already filled in, and the traveller confirms the ride THERE. It involves no server-side Uber
// API call, so it works with no Uber credentials; it also means Clockwise has no fare, ETA or booking to report
// (Uber states a deeplink cannot supply them), and never claims it booked anything.
// Client-safe: pure string building.
export type UberPoint = { latitude?: number; longitude?: number; label?: string | null; address?: string | null };

const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

function addPoint(params: URLSearchParams, prefix: "pickup" | "dropoff", p: UberPoint) {
  if (valid(p.latitude) && valid(p.longitude)) {
    params.set(`${prefix}[latitude]`, p.latitude.toFixed(6));
    params.set(`${prefix}[longitude]`, p.longitude.toFixed(6));
  }
  if (p.label) params.set(`${prefix}[nickname]`, p.label.slice(0, 80));
  if (p.address) params.set(`${prefix}[formatted_address]`, p.address.slice(0, 160));
}

// pickup "me" uses Uber's own my_location (the phone's position stays on the phone; Clockwise never sees it).
export function uberDeeplink(p: { pickup: UberPoint | "my_location"; dropoff: UberPoint; clientId?: string | null }): string {
  const params = new URLSearchParams({ action: "setPickup" });
  if (p.clientId) params.set("client_id", p.clientId);
  if (p.pickup === "my_location") params.set("pickup", "my_location");
  else addPoint(params, "pickup", p.pickup);
  addPoint(params, "dropoff", p.dropoff);
  return `https://m.uber.com/ul/?${params.toString()}`;
}
