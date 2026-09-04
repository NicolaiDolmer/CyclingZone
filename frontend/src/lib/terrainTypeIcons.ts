// Terraen-type -> glyf-navn — ENESTE kilde for hvilket stroke-ikon en profile_type
// tegnes med (#4748 #4487). Ren data (ingen JSX/React-import), saa scripts/
// i18n-check-terrain-coverage.mjs og node --test kan loade filen direkte uden en
// bundler — samme moenster som stageProfileConfig.js (silhuet-geometrien) og
// terrainBucket.ts (kalender-bucket-normalisering), som denne fil bevidst IKKE
// erstatter: silhuetten (profileShape) og kalender-bucket'en er stadig deres eget
// lag, dette er kun det NYE ikon-lag oven paa profile_type.
//
// Bindende (staff-chat 3/9, ejer-citat "flad etape og rolling er to forskellige
// ting"): `rolling` faar sit EGET ikon (RollingIcon) og deler IKKE laengere
// RoadIcon med `flat`. `mountain`/`high_mountain` deler FORTSAT ikon (samme
// familie, kun klatre-haardhed adskiller dem) men har hver sin label via
// stageProfileConfig.js's profileLabelKey (profileType.mountain / profileType.
// high_mountain er allerede to forskellige noegler i races.json).
//
// Det faktiske React-ikon (komponenten) resolves i
// components/race/TerrainTypeGlyph.tsx, som importerer disse navne fra
// components/ui/icons/index.jsx. Holdes adskilt fra denne fil, fordi icons/
// index.jsx indeholder JSX og dermed ikke kan importeres af et rent Node-script
// uden en JSX-transform (scripts/i18n-check-terrain-coverage.mjs koeres direkte
// med `node`, ingen bundler).
import { PROFILE_TYPE_KEYS } from "./stageProfileConfig.js";

// Navnene skal matche en export i components/ui/icons/index.jsx PRAECIS —
// terrainTypeIconNameSet-testen laaser stavemaaden.
export const TERRAIN_TYPE_ICON_NAME: Readonly<Record<string, string>> = Object.freeze({
  flat: "RoadIcon",
  rolling: "RollingIcon",
  hilly: "MountainIcon",
  mountain: "MountainIcon",
  high_mountain: "MountainIcon",
  itt: "TimeTrialIcon",
  itt_hilly: "TimeTrialIcon",
  ttt: "TeamIcon",
  cobbles: "CobblesIcon",
  gravel: "CobblesIcon", // #4105: grus deler ikon med brosten (samme terraen-familie)
  classic: "RoadIcon",
});

/**
 * profile_type -> ikon-navn. Ukendt/manglende -> "RoadIcon"-fallback (samme
 * graceful-degrade-filosofi som profileShape/toTerrainBucket).
 */
export function terrainTypeIconName(profileType: string | null | undefined): string {
  if (!profileType) return "RoadIcon";
  return TERRAIN_TYPE_ICON_NAME[profileType] ?? "RoadIcon";
}

/**
 * Forward-guard: hvilke PROFILE_TYPE_KEYS mangler et ikon i tabellen ovenfor?
 * Tom liste = fuld daekning. Brugt af terrainTypeIcons.test.ts og
 * scripts/i18n-check-terrain-coverage.mjs (samme moenster som
 * findMissingTerrainKeys i det scriptet).
 */
export function missingTerrainIconCoverage(): string[] {
  return PROFILE_TYPE_KEYS.filter((key) => !(key in TERRAIN_TYPE_ICON_NAME));
}
