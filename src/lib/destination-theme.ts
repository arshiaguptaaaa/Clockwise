import type { CSSProperties } from "react";

// Worldwide destination theming — deliberately NOT a hardcoded per-city
// component system. A known term nudges the theme toward a more specific
// motif family; anything unrecognized still gets a complete, coherent
// theme via a deterministic hash fallback, so the UI never breaks or
// looks unstyled just because a destination has no bespoke artwork.
type DestinationLike = {
  name: string;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  latitude?: number | null;
};

export type DestinationTheme = {
  key: "sun" | "coast" | "alpine" | "forest" | "urban" | "earth";
  label: string;
  accent: string;
  accentStrong: string;
  accentSoft: string;
  wash: string;
  ink: string;
  motif: "arches" | "waves" | "peaks" | "leaves" | "grid" | "sun";
};

const THEMES: Record<DestinationTheme["key"], Omit<DestinationTheme, "label">> = {
  sun: { key: "sun", accent: "#c75d3a", accentStrong: "#7f3527", accentSoft: "#f3d8c8", wash: "#f8efe5", ink: "#2d2722", motif: "sun" },
  coast: { key: "coast", accent: "#247d82", accentStrong: "#15545a", accentSoft: "#cfe7e2", wash: "#eef6f2", ink: "#183033", motif: "waves" },
  alpine: { key: "alpine", accent: "#58728b", accentStrong: "#31485e", accentSoft: "#dce6ec", wash: "#f1f4f3", ink: "#253039", motif: "peaks" },
  forest: { key: "forest", accent: "#477052", accentStrong: "#294a35", accentSoft: "#d9e7d8", wash: "#f0f4ec", ink: "#263129", motif: "leaves" },
  urban: { key: "urban", accent: "#59617c", accentStrong: "#30364c", accentSoft: "#e0e1e9", wash: "#f3f1ed", ink: "#28272a", motif: "grid" },
  earth: { key: "earth", accent: "#a45f42", accentStrong: "#683b2c", accentSoft: "#ead8cb", wash: "#f6efe7", ink: "#302821", motif: "arches" },
};

function hash(input: string) {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return h;
}

export function resolveDestinationTheme(destinations: DestinationLike[]): DestinationTheme {
  const destination = destinations.find((d) => d.name) ?? { name: "Somewhere good" };
  const text = `${destination.name} ${destination.city ?? ""} ${destination.region ?? ""} ${destination.country ?? ""}`.toLowerCase();
  const lat = destination.latitude;

  let key: DestinationTheme["key"];
  if (/island|beach|coast|bay|goa|bali|kochi|maldives|miami|sydney|cape town|rio|barcelona/.test(text)) key = "coast";
  else if (/mount|hill|alps|himal|leh|ladakh|reykjav|iceland|swiss|nepal|cusco/.test(text) || (lat != null && Math.abs(lat) > 55)) key = "alpine";
  else if (/forest|jungle|amazon|kerala|ubud|rainforest/.test(text)) key = "forest";
  else if (/jaipur|marrakech|rajasthan|desert|jaisalmer|cairo|morocco|istanbul/.test(text)) key = "earth";
  else if (/new york|tokyo|singapore|london|paris|delhi|mumbai|seoul|hong kong|berlin/.test(text)) key = "urban";
  else key = (["sun", "coast", "forest", "urban", "earth"] as const)[hash(text) % 5];

  return { ...THEMES[key], label: destination.city || destination.name };
}

export function themeStyle(theme: DestinationTheme): CSSProperties {
  return {
    "--trip-accent": theme.accent,
    "--trip-accent-strong": theme.accentStrong,
    "--trip-accent-soft": theme.accentSoft,
    "--trip-wash": theme.wash,
    "--trip-ink": theme.ink,
  } as CSSProperties;
}
