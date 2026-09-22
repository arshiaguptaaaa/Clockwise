// Real destination photography, sourced from Wikimedia Commons via the
// Special:FilePath redirect (the documented way to hotlink a Commons file
// at a given width without hardcoding its hashed storage path). All are
// CC BY-SA and require attribution — see `credit` on each entry.

function commonsFile(filename: string, width: number) {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
    filename
  )}?width=${width}`;
}

export const HALLSTATT_HERO = {
  src: commonsFile("Hallstatt at Lake Hallstatt - 2.jpg", 1600),
  alt: "Hallstatt, Austria, viewed across the lake at golden hour",
  credit: "MontanNito / Wikimedia Commons, CC BY-SA 3.0",
};

export const DESTINATION_PHOTOS: Record<
  string,
  { src: string; alt: string; credit: string }
> = {
  Vienna: {
    src: commonsFile("Vienna Skyline.jpg", 900),
    alt: "Vienna skyline, Austria",
    credit: "Fabian Lackner / Wikimedia Commons, CC BY-SA 3.0",
  },
  Salzburg: {
    src: commonsFile("Salzburg Austria.JPG", 900),
    alt: "Salzburg old town viewed from Hohensalzburg fortress",
    credit: "Bede735 / Wikimedia Commons, CC BY-SA 4.0",
  },
  Hallstatt: {
    src: commonsFile("Hallstatt - Zentrum .JPG", 900),
    alt: "Centre of Hallstatt, Austria",
    credit: "C. Stadler/Bwag / Wikimedia Commons, CC BY-SA 4.0",
  },
  Budapest: {
    src: commonsFile("Parliament Building (Budapest, Hungary) 01.jpg", 900),
    alt: "Hungarian Parliament Building, Budapest",
    credit: "Andrew Shiva / Wikimedia Commons, CC BY-SA 4.0",
  },
};
