// Curated destination photography: downloaded locally (never hotlinked) from
// Wikimedia Commons, each licence checked individually. CC BY / CC BY-SA
// require visible credit, so everywhere a photo renders its `credit` renders
// too; sourceUrl/licenseUrl are kept for the full record. Anything not listed
// here falls back (in search only) to the live Wikipedia photo, else no photo
// — never a stock or generated image.
export type CuratedPhoto = {
  key: string;
  src: string;
  label: string;
  country: string;
  alt: string;
  // Short line shown under the place name on the homepage.
  tagline: string;
  // Tiny live-coordination annotations shown beside the photo (illustrative).
  signals: string[];
  credit: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
  // Focal point when cropped to a tall arch.
  objectPosition: string;
  // Gentle per-photo variation so the sequence doesn't feel mechanical.
  tilt: number;
  lift: number;
  matches: string[];
};

export const CURATED_PHOTOS: CuratedPhoto[] = [
  {
    key: "jaipur",
    src: "/destinations/jaipur.jpg",
    label: "Jaipur",
    country: "India",
    alt: "Hawa Mahal, Jaipur",
    tagline: "Everyone finally agreed.",
    signals: ["Hawa Mahal · 10:00", "Plan synced"],
    credit: "Shupna / Wikimedia Commons",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Hawa_Mahal_Jaipur_front_view.jpg",
    objectPosition: "50% 38%",
    tilt: -2,
    lift: 0,
    matches: ["jaipur"],
  },
  {
    key: "prague",
    src: "/destinations/prague.jpg",
    label: "Prague",
    country: "Czechia",
    alt: "Prague Castle and Charles Bridge at dusk",
    tagline: "48 hours. Three people. One plan.",
    signals: ["Eva · arrives 16:40", "✓ Everyone on track"],
    credit: "Tom Mrazek / Wikimedia Commons",
    license: "CC BY 2.0",
    licenseUrl: "https://creativecommons.org/licenses/by/2.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:A_Dreamy_Evening_(22090564661).jpg",
    objectPosition: "22% 50%",
    tilt: 1.5,
    lift: -6,
    matches: ["prague", "praha"],
  },
  {
    key: "greenland",
    src: "/destinations/greenland.jpg",
    label: "Greenland",
    country: "Kalaallit Nunaat",
    alt: "An iceberg in the Ilulissat Icefjord, Greenland",
    tagline: "Different clocks. Same adventure.",
    signals: ["Next stop · Nuuk", "Plan synced"],
    credit: "Christoph Strässler / Wikimedia Commons",
    license: "CC BY-SA 2.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/2.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Iceberg_in_the_Ilulissat_Icefjord,_Greenland_(54067514893).jpg",
    objectPosition: "60% 50%",
    tilt: -1,
    lift: 8,
    matches: ["greenland", "ilulissat", "kalaallit"],
  },
  {
    key: "vienna",
    src: "/destinations/vienna.jpg",
    label: "Vienna",
    country: "Austria",
    alt: "Schönbrunn Palace, Vienna",
    tagline: "Someone's always five minutes behind.",
    signals: ["Rendezvous · 18:30", "3 travellers"],
    credit: "Diego Delso / Wikimedia Commons",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Palacio_de_Sch%C3%B6nbrunn,_Viena,_Austria,_2020-02-02,_DD_07-09_HDR.jpg",
    objectPosition: "50% 50%",
    tilt: 2,
    lift: -4,
    matches: ["vienna", "wien"],
  },
  {
    key: "udaipur",
    src: "/destinations/udaipur.jpg",
    label: "Udaipur",
    country: "India",
    alt: "Lake Pichola at sunset, Udaipur",
    tagline: "Golden hour, on schedule.",
    signals: ["Sunset boat · 17:45", "✓ Everyone on track"],
    credit: "UnpetitproleX / Wikimedia Commons",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Lake_Pichola_at_sunset,_Udaipur,_Rajasthan,_India.jpg",
    objectPosition: "76% 50%",
    tilt: -2.5,
    lift: 4,
    matches: ["udaipur"],
  },
  {
    key: "tokyo",
    src: "/destinations/tokyo.jpg",
    label: "Tokyo",
    country: "Japan",
    alt: "Minato City skyline with Tokyo Tower at golden hour",
    tagline: "Nine time zones, one group chat.",
    signals: ["Hotel check-in · 15:00", "Plan synced"],
    credit: "David Kernan / Wikimedia Commons",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Minato_City,_Tokyo,_Japan.jpg",
    objectPosition: "43% 50%",
    tilt: 1,
    lift: 0,
    matches: ["tokyo", "tōkyō"],
  },
  {
    key: "salzburg",
    src: "/destinations/salzburg.jpg",
    label: "Salzburg",
    country: "Austria",
    alt: "Hohensalzburg Fortress above Salzburg's domes and the Salzach",
    tagline: "The train leaves at 9:12.",
    signals: ["Platform 4 · 09:12", "✓ Everyone on track"],
    credit: "Pedro J Pacheco / Wikimedia Commons",
    license: "CC BY-SA 3.0 AT",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/at/deed.en",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Festung_Hohensalzburg_(2).jpg",
    objectPosition: "40% 50%",
    tilt: -1.5,
    lift: 6,
    matches: ["salzburg"],
  },
  {
    key: "reykjavik",
    src: "/destinations/reykjavik.jpg",
    label: "Reykjavik",
    country: "Iceland",
    alt: "Hallgrímskirkja church, Reykjavik",
    tagline: "Midnight sun, shared itinerary.",
    signals: ["Whale watching · 13:00", "Plan synced"],
    credit: "Holger Uwe Schmitt / Wikimedia Commons",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:%2BDie_Hallgrimskirkja_ist_das_markanteste_Bauwerk_Reykjaviks._02.jpg",
    objectPosition: "12% 40%",
    tilt: 2,
    lift: -2,
    matches: ["reykjavik", "reykjavík"],
  },
  {
    key: "bengaluru",
    src: "/destinations/bengaluru.jpg",
    label: "Bengaluru",
    country: "India",
    alt: "A rain-wet paved path under trees in Lalbagh Botanical Garden, Bengaluru",
    tagline: "Rain at four. Filter coffee at any hour.",
    signals: ["Lalbagh · 16:00", "Plan synced"],
    credit: "Ashwin Kumar / Flickr",
    license: "CC BY-SA 2.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/2.0/",
    sourceUrl: "https://www.flickr.com/photos/34501870@N00/51347333834",
    objectPosition: "50% 60%",
    tilt: -1,
    lift: 0,
    matches: ["bengaluru", "bangalore"],
  },
];

// Extra Bengaluru frame (wide), same photographer and licence; used for editorial headers.
export const BENGALURU_WIDE = {
  src: "/destinations/bengaluru-lalbagh.jpg",
  alt: "Lalbagh Botanical Garden lawn and trees under a monsoon sky, Bengaluru",
  credit: "Ashwin Kumar / Flickr",
  license: "CC BY-SA 2.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/2.0/",
  sourceUrl: "https://www.flickr.com/photos/34501870@N00/51347333994",
} as const;

export function curatedPhotoFor(name: string | null | undefined): CuratedPhoto | null {
  const n = (name ?? "").toLowerCase();
  if (!n) return null;
  return CURATED_PHOTOS.find((p) => p.matches.some((m) => n.includes(m))) ?? null;
}
