// The human layer: expressive, young, confident editorial illustration.
//
// Source: the "Wikimania 2021" illustration set by Jasmina El Bouamraoui and
// Karabo Poppy Moletsane, published on Wikimedia Commons under CC0 1.0
// (public-domain dedication) — production use is permitted and no attribution
// is required; it is given anyway (see CHARACTER_CREDIT, shown in the home
// page footer). Blush's "Women Power" collection stayed the art direction, but
// its assets and licence could not be reached programmatically, so they were
// not used. Only files without embedded text or logos were kept.
//
// Faces are stylised, non-realistic portraits (green, blue and pink skin
// tones among others) cropped from one portrait sheet. They are assigned by
// position or by the traveller's own choice — never inferred from a name.
export const CHARACTER_CREDIT = {
  creators: "Jasmina El Bouamraoui & Karabo Poppy Moletsane",
  set: "Wikimania 2021 illustrations, Wikimedia Commons",
  license: "CC0 1.0",
  licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  portraitsSourceUrl: "https://commons.wikimedia.org/wiki/File:Wikimania2021_video_call.svg",
} as const;

export type SceneAsset = { src: string; width: number; height: number; alt: string; sourceUrl: string };

export const SCENES = {
  airplane: { src: "/characters/airplane.webp", width: 960, height: 752, alt: "A traveller smiling at a phone beside an aeroplane window", sourceUrl: "https://commons.wikimedia.org/wiki/File:Wikimania2021_airplane_travel.svg" },
  bicycle: { src: "/characters/bicycle.webp", width: 960, height: 752, alt: "Two friends cycling with backpacks", sourceUrl: "https://commons.wikimedia.org/wiki/File:Wikimania2021_bicycle_travel.svg" },
  map: { src: "/characters/map.webp", width: 960, height: 752, alt: "A traveller with a red backpack reading a map", sourceUrl: "https://commons.wikimedia.org/wiki/File:Wikimania2021_map.svg" },
  celebrating: { src: "/characters/celebrating.webp", width: 960, height: 752, alt: "Two friends laughing and waving", sourceUrl: "https://commons.wikimedia.org/wiki/File:Wikimania2021_celebrating.svg" },
  friendship: { src: "/characters/friendship.webp", width: 960, height: 752, alt: "Two friends close together", sourceUrl: "https://commons.wikimedia.org/wiki/File:Wikimania2021_friendship.svg" },
  highfive: { src: "/characters/highfive.webp", width: 960, height: 752, alt: "Two people sharing a high five", sourceUrl: "https://commons.wikimedia.org/wiki/File:Wikimania2021_teamwork.svg" },
  suitcase: { src: "/characters/suitcase.webp", width: 960, height: 752, alt: "An overfull suitcase mid-pack", sourceUrl: "https://commons.wikimedia.org/wiki/File:Wikimania2021_suitcase.svg" },
  photography: { src: "/characters/photography.webp", width: 960, height: 752, alt: "Two friends, one taking a photograph", sourceUrl: "https://commons.wikimedia.org/wiki/File:Wikimania2021_photography.svg" },
  memories: { src: "/characters/memories.webp", width: 960, height: 752, alt: "A phone showing a holiday photo", sourceUrl: "https://commons.wikimedia.org/wiki/File:Wikimania2021_photo_memories.svg" },
} satisfies Record<string, SceneAsset>;

export type SceneKey = keyof typeof SCENES;

export const FACE_COUNT = 12;
export const faceSrc = (index: number) => `/characters/face-${String(((index % FACE_COUNT) + FACE_COUNT) % FACE_COUNT + 1).padStart(2, "0")}.webp`;

// A stable face for a person, derived from their user id — arbitrary but fixed,
// and never from their name or anything about them.
export function faceIndexForId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % FACE_COUNT;
}

// Tints for chat bubbles / chips, picked the same way (by id, not by person).
export const POP_TINTS = ["#fde6ef", "#fff3c8", "#e1e9ff", "#dff3e4", "#ffe6cf"] as const;
export function popTintForId(id: string): string {
  return POP_TINTS[faceIndexForId(id) % POP_TINTS.length];
}
