// Which of the provider's airport POIs is the one passengers actually fly into?
// A city can have several (a closed or military field, a heliport, a private strip,
// the old airport next to the new one). The nearest to the centre is often NOT the
// commercial one: for Bengaluru the nearest is HAL (the old airport). So rank the
// provider's own signals instead of taking the first row. Pure, and never invents a
// candidate: it only chooses among what the provider returned.
export type AirportCandidate = {
  name: string;
  placeId: string;
  lat: number;
  lng: number;
  categories: string[];
  iata: string | null;
  icao: string | null;
  distanceMeters: number | null;
};

const NOT_PASSENGER = /heliport|helipad|seaplane|airstrip|glider|military|air ?force|air ?base|\bafs\b|\bhal\b|private|flying club|aero ?club|training/i;

export function airportScore(c: AirportCandidate): number {
  if (!/airport|airfield|aerodrome/i.test(c.name)) return -1000;
  let s = 0;
  if (c.categories.some((x) => /airport\.international/.test(x))) s += 100;
  if (/international/i.test(c.name)) s += 60;
  if (c.iata) s += 25;
  if (c.categories.some((x) => /private|military|heliport|airstrip/.test(x))) s -= 120;
  if (NOT_PASSENGER.test(c.name)) s -= 120;
  return s;
}

export function pickPassengerAirport(cands: AirportCandidate[]): AirportCandidate | null {
  const ranked = cands.map((c) => ({ c, s: airportScore(c) })).sort((a, b) => b.s - a.s || (a.c.distanceMeters ?? 1e12) - (b.c.distanceMeters ?? 1e12));
  return ranked[0] && ranked[0].s > -1000 ? ranked[0].c : null;
}
