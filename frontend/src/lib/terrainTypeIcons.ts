// Terraen-type -> streg-ikon + farve. ENESTE kilde for hvordan en profile_type
// tegnes (#6683, ejer-beslutning 15/10 efter seks runder mockups; afloeser
// #4748/#4487). Ren data (ingen JSX/React-import), saa scripts/
// i18n-check-terrain-coverage.mjs og node --test kan loade filen direkte uden en
// bundler. Selve tegningen goeres af components/race/TerrainTypeGlyph.jsx, som er
// den ENESTE komponent der laeser tabellen.
//
// Regler (ejer 15/10):
//   - Ét ikon pr. etapetype, og det samme ikon overalt (kalender, forklaring,
//     forside, planlaegning, etapeside, etape-navigation, holdudtagelse, loebskort).
//   - Kun figuren, uden flise eller ring. 24-grid, streg 1.7, runde ender.
//   - Farven viser svaerhed (flad -> hoejbjerg), tidskoersel er blaa, brosten er
//     stenfarve, grus er sandfarve. Farverne er tokens (`--terrain-*` i index.css,
//     lyst + moerkt tema), aldrig raa hex her.
//   - Navnet staar altid ved hold/hover (title/aria-label), saa farven aldrig
//     staar alene.
//   - `classic` er ikke en rutetype: den vises som kuperet.
import { PROFILE_TYPE_KEYS } from "./stageProfileConfig.js";

export type TerrainShape =
  | { readonly t: "path"; readonly d: string }
  | { readonly t: "circle"; readonly cx: number; readonly cy: number; readonly r: number }
  | { readonly t: "rect"; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly rx: number };

export interface TerrainGlyphDef {
  /** Navn paa farve-token: `--terrain-<color>` i index.css. */
  readonly color: string;
  /** Figuren i et 24x24-grid. */
  readonly shapes: readonly TerrainShape[];
}

const path = (d: string): TerrainShape => ({ t: "path", d });
const circle = (cx: number, cy: number, r: number): TerrainShape => ({ t: "circle", cx, cy, r });
const rect = (x: number, y: number, w: number, h: number, rx: number): TerrainShape => ({ t: "rect", x, y, w, h, rx });

// Ét ikon pr. etapetype (11). `classic` har ikke sit eget (se TERRAIN_TYPE_GLYPH).
export const TERRAIN_GLYPHS: Readonly<Record<string, TerrainGlyphDef>> = Object.freeze({
  flat: { color: "flat", shapes: [path("M7 12h10")] },
  rolling: { color: "rolling", shapes: [path("M6 13.5h3.5l2.5-2.5 2.5 2.5H18")] },
  hilly: { color: "hilly", shapes: [path("M5.5 14.5l2.6-3.6 2.2 2.4 2.8-4.3 2.4 3.3 3-1.3")] },
  medium_mountain: { color: "medium-mountain", shapes: [path("M5.5 16.5l3.5-4 2 1.5 4-7 4 9.5")] },
  mountain: { color: "mountain", shapes: [path("M5 16.5l3.5-8 3 5.5 3-8 4.5 10.5")] },
  high_mountain: { color: "high-mountain", shapes: [path("M5 17l4-6 2 3 4-9 4.5 12"), path("M13.6 8.3l1.4 1.1 1.5-1")] },
  itt: { color: "time-trial", shapes: [circle(13.5, 12, 4.5), path("M13.5 10v2l1.5 1"), path("M5.5 10.5h3M6.5 13.5h2")] },
  itt_hilly: { color: "time-trial", shapes: [circle(14.5, 12, 4.2), path("M14.5 10.2V12l1.4.9"), path("M4.8 13.4l1.6-2.2 1.4 1.4 1.8-2.4")] },
  ttt: { color: "time-trial", shapes: [circle(10, 12, 3.8), circle(15, 12, 3.8), path("M15 10.4V12l1 .8")] },
  cobbles: { color: "cobbles", shapes: [rect(6, 7, 5, 4, 0.8), rect(13, 7, 5, 4, 0.8), rect(9.5, 13, 5, 4, 0.8)] },
  gravel: {
    color: "gravel",
    shapes: [path("M6 15.5h12"), circle(8, 10.5, 1), circle(12, 9, 0.8), circle(15.8, 11, 1.1), circle(10.5, 12.6, 0.7)],
  },
});

// profile_type -> ikon-nøgle i TERRAIN_GLYPHS. Alle 12 profile_type har en post;
// `classic` er et alias for kuperet.
export const TERRAIN_TYPE_GLYPH: Readonly<Record<string, string>> = Object.freeze({
  flat: "flat",
  rolling: "rolling",
  hilly: "hilly",
  medium_mountain: "medium_mountain",
  mountain: "mountain",
  high_mountain: "high_mountain",
  itt: "itt",
  itt_hilly: "itt_hilly",
  ttt: "ttt",
  cobbles: "cobbles",
  gravel: "gravel",
  classic: "hilly",
});

/** Vise-typen: `classic` -> `hilly`, ellers uaendret. Ukendt/manglende -> null. */
export function terrainDisplayType(profileType: string | null | undefined): string | null {
  if (!profileType || !(profileType in TERRAIN_TYPE_GLYPH)) return null;
  return TERRAIN_TYPE_GLYPH[profileType];
}

/** profile_type -> ikon-definition, eller null for ukendt/manglende (vis intet frem for et forkert ikon). */
export function terrainGlyph(profileType: string | null | undefined): TerrainGlyphDef | null {
  const key = terrainDisplayType(profileType);
  return key ? TERRAIN_GLYPHS[key] ?? null : null;
}

/** CSS-farve for en glyf: tokenet i index.css (lyst + moerkt tema). */
export function terrainColorVar(def: TerrainGlyphDef): string {
  return `var(--terrain-${def.color})`;
}

/**
 * Forward-guard: hvilke PROFILE_TYPE_KEYS mangler et ikon i tabellerne ovenfor?
 * Tom liste = fuld daekning. Brugt af terrainTypeIcons.test.ts og
 * scripts/i18n-check-terrain-coverage.mjs.
 */
export function missingTerrainIconCoverage(): string[] {
  return PROFILE_TYPE_KEYS.filter((key) => !terrainGlyph(key));
}
