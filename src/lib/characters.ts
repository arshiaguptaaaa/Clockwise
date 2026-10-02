// The human layer. Intentionally EMPTY until real, licensed character art is
// added: the art direction is Blush's "Women Power" collection (Sara Pelaez),
// whose licence/attribution terms must be confirmed on the account that
// downloads it. Add an entry here (and the file under public/characters/) and
// every <CharacterSlot name="…"/> renders it; until then the slots render
// nothing — no substitute drawings.
export type CharacterAsset = { src: string; alt: string; width: number; height: number; credit?: string };

export const CHARACTERS: Record<string, CharacterAsset> = {
  // traveller: { src: "/characters/traveller.png", alt: "…", width: 480, height: 640, credit: "Illustration: … / Blush" },
};
