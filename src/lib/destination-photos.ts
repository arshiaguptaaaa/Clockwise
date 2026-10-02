// Curated destination photography: downloaded locally (not hotlinked) from
// Wikimedia Commons, each licence checked individually. CC BY / CC BY-SA
// require visible credit — every place a photo renders also renders its
// `credit` line. Anything not in this list falls back to the live Wikipedia
// photo returned by the destination search (credited to Wikipedia), or no
// photo at all — never a stock or generated image.
export type CuratedPhoto = {
  key: string;
  src: string;
  label: string;
  alt: string;
  credit: string;
  // Where the focal point sits when cropped to a tall arch.
  objectPosition: string;
  matches: string[];
};

export const CURATED_PHOTOS: CuratedPhoto[] = [
  {
    key: "jaipur",
    src: "/destinations/jaipur.jpg",
    label: "Jaipur",
    alt: "Hawa Mahal, Jaipur",
    credit: "Shupna / Wikimedia Commons, CC BY 4.0",
    objectPosition: "50% 38%",
    matches: ["jaipur"],
  },
  {
    key: "udaipur",
    src: "/destinations/udaipur.jpg",
    label: "Udaipur",
    alt: "Lake Pichola at sunset, Udaipur",
    credit: "UnpetitproleX / Wikimedia Commons, CC BY-SA 4.0",
    objectPosition: "76% 50%",
    matches: ["udaipur"],
  },
  {
    key: "salzburg",
    src: "/destinations/salzburg.jpg",
    label: "Salzburg",
    alt: "Salzburg old town seen from Hohensalzburg fortress",
    credit: "Bede735 / Wikimedia Commons, CC BY-SA 4.0",
    objectPosition: "50% 60%",
    matches: ["salzburg"],
  },
];

export function curatedPhotoFor(name: string | null | undefined): CuratedPhoto | null {
  const n = (name ?? "").toLowerCase();
  if (!n) return null;
  return CURATED_PHOTOS.find((p) => p.matches.some((m) => n.includes(m))) ?? null;
}
