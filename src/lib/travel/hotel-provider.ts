// HotelProvider — the one interface the stay UI talks to. Geoapify implements
// discovery only (search, details); availability, rates, booking and
// cancellation are explicitly NOT connected, and every listing says so in its
// own fields (isLiveRate/isBookable false, rate null). A future inventory
// provider (TBO, RateHawk, Hotelbeds…) fills the same fields and flips the
// capability flags — the UI does not change.
import { getPlaceDetails, isGeoapifyConfigured, searchStays } from "./geoapify-provider";
import type { LatLng } from "./types";

export type HotelListing = {
  provider: string;
  providerPlaceId: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  distanceMeters: number | null;
  kind: string; // Hotel | Guest house | Hostel | Apartment
  stars: string | null;
  website: string | null;
  phone: string | null;
  retrievedAt: string;
  // Provenance of money/availability. Missing means MISSING — never a guess.
  isLiveRate: boolean;
  isBookable: boolean;
  rate: { amountMinor: number; currency: string } | null;
};

export type NotConnected = { ok: false; reason: "NOT_CONNECTED"; provider: string };

export interface HotelProvider {
  readonly name: string;
  readonly capabilities: { search: boolean; details: boolean; availability: boolean; rates: boolean; book: boolean; cancel: boolean };
  isConfigured(): boolean;
  search(near: LatLng, opts?: { radiusMeters?: number; limit?: number }): Promise<HotelListing[]>;
  details(providerPlaceId: string): Promise<Partial<HotelListing> | null>;
  availability(...args: unknown[]): Promise<NotConnected>;
  rates(...args: unknown[]): Promise<NotConnected>;
  book(...args: unknown[]): Promise<NotConnected>;
  cancel(...args: unknown[]): Promise<NotConnected>;
}

function kindOf(categories: string[]): string {
  const c = categories.join(",");
  if (c.includes("guest_house")) return "Guest house";
  if (c.includes("hostel")) return "Hostel";
  if (c.includes("apartment")) return "Apartment";
  return "Hotel";
}

class GeoapifyHotelProvider implements HotelProvider {
  readonly name = "geoapify";
  readonly capabilities = { search: true, details: true, availability: false, rates: false, book: false, cancel: false };
  private nc = (): NotConnected => ({ ok: false, reason: "NOT_CONNECTED", provider: this.name });

  isConfigured() {
    return isGeoapifyConfigured();
  }

  async search(near: LatLng, opts: { radiusMeters?: number; limit?: number } = {}): Promise<HotelListing[]> {
    const rows = await searchStays(near, opts.radiusMeters, opts.limit);
    return rows.map((r) => ({
      provider: this.name,
      providerPlaceId: r.providerId,
      name: r.name,
      address: r.formattedAddress,
      latitude: r.latitude,
      longitude: r.longitude,
      distanceMeters: r.distanceMeters,
      kind: kindOf(r.categories),
      stars: r.stars,
      website: r.website,
      phone: r.phone,
      retrievedAt: r.retrievedAt,
      isLiveRate: false,
      isBookable: false,
      rate: null,
    }));
  }

  async details(providerPlaceId: string) {
    const d = await getPlaceDetails(providerPlaceId);
    if (!d) return null;
    return { name: d.name, address: d.formattedAddress ?? null, website: d.website ?? null, phone: d.phone ?? null, retrievedAt: d.retrievedAt };
  }
  availability = async () => this.nc();
  rates = async () => this.nc();
  book = async () => this.nc();
  cancel = async () => this.nc();
}

export const hotelProvider: HotelProvider = new GeoapifyHotelProvider();
