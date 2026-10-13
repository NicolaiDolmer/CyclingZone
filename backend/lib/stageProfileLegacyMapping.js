// backend/lib/stageProfileLegacyMapping.js
// #6369 Fase 0: gammel (S1-S4) profile_type/finale_type -> S5's tre akser (spec §1).
//
// HVORFOR. S5 beskriver en etape med tre akser (terraen, afslutning, underlag), men alle
// raekker fra S1-S4 bærer kun den gamle etiket (profile_type) og den gamle finale_type.
// Etapekortet (#6364) og benchmark-gaten (#6367) skal kunne laese BEGGE generationer med
// samme kode. Denne funktion er den ene oversaettelse; ingen anden fil gaetter selv.
//
// GRAENSEN. Oversaettelsen bruger KUN raekkens etiketter (+ dens `sectors` for underlaget).
// Den regner IKKE terraenet af stigningerne: spec §2's B+-regel er generatorens (#6359) og
// gatens, og S4-etiketterne passer ikke altid med ruten (byg-planen §2.2). Resultatet
// fortaeller derfor hvor det er udledt i stedet for laest (`inferred`), saa en laeser der
// har stigningerne kan foretraekke B+.
//
// REN: ingen IO, ingen RNG. Muterer aldrig input.

import {
  TERRAIN_TYPES, FINISH_TYPES, SECTOR_KINDS, canonicalFinaleType,
} from "./stageProfileTypes.js";

// profile_type -> terraen-akse. De seks terraen-typer er sig selv; tidskoersler og
// klassiker-etiketterne faar det terraen deres gamle rute typisk havde (CLIMB_SPEC i
// raceRouteGenerator.js): flad/kuperet enkeltstart, brosten paa fladt, grus og klassiker
// i bakker. De sidste fem er derfor `inferred.terrain`.
const TERRAIN_BY_PROFILE_TYPE = Object.freeze({
  flat: "flat",
  rolling: "rolling",
  hilly: "hilly",
  medium_mountain: "medium_mountain",
  mountain: "mountain",
  high_mountain: "high_mountain",
  itt: "flat",
  itt_hilly: "hilly",
  ttt: "flat",
  cobbles: "flat",
  gravel: "hilly",
  classic: "hilly",
});

// Underlag naar raekken ingen sektorer har: etiketten alene.
const SURFACE_BY_PROFILE_TYPE = Object.freeze({ cobbles: "cobbles", gravel: "gravel" });

// Afslutning naar finale_type ikke beskriver en geometri (`breakaway`, eller NULL paa en
// tidlig raekke). Udbrud er ikke en afslutning i S5 (spec §3), saa vi falder tilbage til
// den geometri den gamle rutegenerator gav etapen: flade/boelgede etaper sluttede fladt,
// alle etaper med kategoriserede stigninger fik deres sidste stigning lagt foer maal
// (nedkoersels-geometri, byg-planen §1 + §2.1). Altid `inferred.finish`.
const FALLBACK_FINISH_BY_TERRAIN = Object.freeze({
  flat: "flat_sprint",
  rolling: "flat_sprint",
  hilly: "descent",
  medium_mountain: "descent",
  mountain: "descent",
  high_mountain: "descent",
});

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Taeller sektorerne pr. underlag (spec §1C: antal + laengde). Ukendte `kind`-vaerdier og
 * sektorer uden gyldig laengde ignoreres i stedet for at gaette.
 * @param {Array<{kind?: string, length_km?: number}>|null|undefined} sectors
 * @returns {{ cobbles: {count: number, km: number}, gravel: {count: number, km: number} }}
 */
export function summarizeSectors(sectors) {
  const out = { cobbles: { count: 0, km: 0 }, gravel: { count: 0, km: 0 } };
  if (!Array.isArray(sectors)) return out;
  for (const s of sectors) {
    if (!s || !SECTOR_KINDS.includes(s.kind)) continue;
    const km = Number(s.length_km);
    out[s.kind].count += 1;
    if (Number.isFinite(km) && km > 0) out[s.kind].km = round1(out[s.kind].km + km);
  }
  return out;
}

/**
 * Underlags-aksen: grus eller brosten hvis raekken har sektorer af den slags (flest km
 * vinder; ved lige km vinder grus, som er den sjaeldneste og mest saerprægede), ellers
 * etiketten (cobbles/gravel), ellers asfalt.
 */
export function surfaceOf({ profile_type: profileType, sectors } = {}) {
  // Kun sektorer med en gyldig, positiv laengde afgoer underlaget, og km summeres UAFRUNDET
  // (en kort sektor maa ikke forsvinde i afrundingen). Uden en eneste gyldig sektor
  // gaelder etiketten, saa en ufuldstaendig raekke ikke skifter underlag.
  const validKm = { cobbles: 0, gravel: 0 };
  const validCount = { cobbles: 0, gravel: 0 };
  for (const s of Array.isArray(sectors) ? sectors : []) {
    if (!s || !SECTOR_KINDS.includes(s.kind)) continue;
    const km = Number(s.length_km);
    if (!Number.isFinite(km) || km <= 0) continue;
    validKm[s.kind] += km;
    validCount[s.kind] += 1;
  }
  if (validCount.cobbles > 0 || validCount.gravel > 0) {
    if (validCount.gravel > 0 && validKm.gravel >= validKm.cobbles) return "gravel";
    return "cobbles";
  }
  return SURFACE_BY_PROFILE_TYPE[profileType] ?? "asphalt";
}

/**
 * Gammel eller ny etape-raekke -> S5's tre akser.
 *
 * @param {{ profile_type?: string|null, finale_type?: string|null, sectors?: Array|null }} row
 * @returns {null | {
 *   terrain: string, finish: string, surface: string,
 *   sectors: { cobbles: {count: number, km: number}, gravel: {count: number, km: number} },
 *   inferred: { terrain: boolean, finish: boolean },
 * }} null naar profile_type er ukendt (laeseren viser intet frem for noget forkert).
 */
export function legacyStageToS5Axes(row = {}) {
  const profileType = row?.profile_type;
  const terrain = TERRAIN_BY_PROFILE_TYPE[profileType];
  if (!terrain) return null;

  let finish;
  let finishInferred = false;
  if (profileType === "ttt") {
    finish = "ttt";
  } else if (profileType === "itt" || profileType === "itt_hilly") {
    finish = "solo_tt";
  } else {
    const canonical = canonicalFinaleType(row?.finale_type);
    if (canonical && canonical !== "breakaway" && FINISH_TYPES.includes(canonical)) {
      finish = canonical;
    } else {
      finish = FALLBACK_FINISH_BY_TERRAIN[terrain];
      finishInferred = true;
    }
  }

  return {
    terrain,
    finish,
    surface: surfaceOf(row ?? {}),
    sectors: summarizeSectors(row?.sectors),
    inferred: { terrain: !TERRAIN_TYPES.includes(profileType), finish: finishInferred },
  };
}
