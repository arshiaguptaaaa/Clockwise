// Provider-agnostic, matching the AgentModelProvider/MobilityProvider
// convention — UI and call sites only ever import this interface, never a
// vendor SDK, so the search source can be swapped later.
//
// Search results and what gets persisted both use the ONE canonical
// location shape (src/lib/location/types.ts) — no locally-duplicated
// field set here anymore (Stage 3 consolidation).
import type { CanonicalPlace, PlaceSelection } from "@/lib/location/types";

// photoUrl is search-UI-specific (a thumbnail for the results dropdown),
// not part of the canonical location shape itself — kept as an addition
// here rather than on CanonicalPlace, which is also used for stored
// Destination/Booking locations that have nothing to do with search.
export type DestinationSearchResult = CanonicalPlace & { photoUrl?: string | null };

export interface DestinationSearchProvider {
  search(query: string): Promise<DestinationSearchResult[]>;
}

// What actually gets stored per destination once chosen — either a real
// search result (freeText: false), or a free-text fallback (freeText:
// true) when the search API is unavailable or returns nothing. Shared
// between the wizard UI and the server action that persists it.
export type SelectedDestination = PlaceSelection;
