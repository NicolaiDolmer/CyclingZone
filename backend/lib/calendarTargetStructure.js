// backend/lib/calendarTargetStructure.js
// #5795: S4-kalenderen skal kunne skrives FØR S3's sidste løbsdag (ejer 26/9: "vi har altid
// lavet kalenderen før sæsonen var slut; her skal skabes en løsning").
//
// PROBLEMET. Fra S4 er seniorpyramiden 1/2/4/4 (#4592, SENIOR_CALENDAR_POOLS_FROM_S4).
// D4 E-H pensioneres først ved "Afslut sæson" (retireD4PoolsS4.js, #5642), og indtil da
// står alle otte D4-puljer som aktive (league_divisions.retired_at IS NULL). En kalender
// skrevet før pensioneringen ville give E-H løb, og pulje-struktur-gaten i
// buildSeasonCalendar.js stopper derfor en seniorkørsel med 8 D4-puljer.
//
// LØSNINGEN (vej a i #5795, ingen migration). Kalenderen planlægges mod S4's MÅLSTRUKTUR,
// eksplicit valgt på kommandolinjen (`--target-structure s4`): de D4-puljer som
// retireD4PoolsS4.js vil pensionere ved skiftet, behandles i planen som pensionerede. Intet
// i databasen ændres af det - retired_at røres ikke, S3's løb, stillinger og puljer er
// urørte. Planen er bagefter identisk med den plan der ville være bygget EFTER
// pensioneringen, fordi materializeren springer en pensioneret pulje over på præcis samme
// sted (buildTierMaterializationPlan's `retired`-gren).
//
// HVORFOR IKKE vej b (sæsonbundet pensionering, fx `retired_from_season`): det kræver en
// migration og at ALLE læsere af retired_at (AI-fyld, nye hold, reconcile, standings,
// liga-audit) lærer den nye kolonne. Vej a rører én kalender-læser og intet skema.
//
// SAMME REGEL SOM PENSIONERINGEN. Hvilke puljer der pensioneres, afgøres her med samme
// regel som planD4PoolRetirement (retireD4PoolsS4.js): seniorens D4-puljer sorteret på
// pool_index; de første `activePools` beholdes, resten pensioneres. Klassifikationen er på
// pool_index, ikke på retired_at, så den er idempotent: kører man kalenderen EFTER
// pensioneringen, er resultatet det samme. En test låser at de to regler er enige.
//
// Ren modul: ingen I/O.

import { SENIOR_CALENDAR_POOLS_FROM_S4, SENIOR_CALENDAR_POOLS_FIRST_SEASON } from "./calendarTierCaps.js";

/**
 * De målstrukturer kalenderen kan planlægges mod. Kun S4's findes: det er det eneste
 * sæsonskifte hvor puljer pensioneres. En ny struktur tilføjes her, aldrig som et frit
 * CLI-argument (en tastefejl må ikke kunne fjerne en pulje fra kalenderen).
 */
export const CALENDAR_TARGET_STRUCTURES = Object.freeze({
  s4: Object.freeze({
    key: "s4",
    firstSeason: SENIOR_CALENDAR_POOLS_FIRST_SEASON,
    tier: 4,
    activePools: SENIOR_CALENDAR_POOLS_FROM_S4[4],
    source: "retireD4PoolsS4.js (#5642) ved 'Afslut sæson'",
  }),
});

/**
 * Slå en målstruktur op. Ukendt eller tom værdi kaster (fail-closed).
 * @param {string|null|undefined} raw
 */
export function resolveTargetStructure(raw) {
  const key = String(raw ?? "").trim().toLowerCase();
  const structure = CALENDAR_TARGET_STRUCTURES[key];
  if (!structure) {
    throw new Error(`--target-structure: unknown target structure "${raw ?? ""}" (known: ${Object.keys(CALENDAR_TARGET_STRUCTURES).join(", ")})`);
  }
  return structure;
}

/**
 * Må målstrukturen bruges til denne kørsel? Kun seniorkalenderen (truppernes grupper
 * pensioneres ikke) og kun fra den sæson strukturen gælder.
 * @returns {string|null} en fejltekst, eller null når kombinationen er gyldig
 */
export function targetStructureUsageError({ structure, seasonNumber, squad = "senior" }) {
  if (squad !== "senior") return `--target-structure is senior-only (not --squad ${squad}); squad groups are never retired at the cutover`;
  if (!(Number(seasonNumber) >= structure.firstSeason)) {
    return `--target-structure ${structure.key} applies from season ${structure.firstSeason}, not season ${seasonNumber}`;
  }
  return null;
}

const isSeniorPool = (p) => p.squad == null || p.squad === "senior";

/**
 * Hvilke puljer pensioneres ved skiftet, og hvilke beholdes? Samme regel som
 * planD4PoolRetirement: seniorens puljer i strukturens tier, sorteret på pool_index, de
 * første `activePools` beholdes. Allerede pensionerede puljer tælles med (idempotent).
 *
 * Kaster hvis tieren har færre puljer end målet (så ville en aktiv pulje mangle), eller
 * hvis to puljer deler pool_index (så er "de første fire" ikke entydige).
 *
 * @param {{ pools: Array<{id, tier, pool_index, label?, squad?, retired_at?}>, structure?: object }} args
 * @returns {{ keep: object[], retire: object[], retireIds: Set<number|string> }}
 */
export function resolveCutoverPoolRetirement({ pools = [], structure = CALENDAR_TARGET_STRUCTURES.s4 } = {}) {
  const tierPools = pools
    .filter((p) => isSeniorPool(p) && Number(p.tier) === structure.tier)
    .sort((a, b) => Number(a.pool_index) - Number(b.pool_index));
  const indexes = tierPools.map((p) => Number(p.pool_index));
  if (indexes.some((i) => !Number.isInteger(i)) || new Set(indexes).size !== indexes.length) {
    throw new Error(`target structure ${structure.key}: D${structure.tier} pool_index values are not unique integers (${indexes.join(",")}), cannot tell which pools retire`);
  }
  if (tierPools.length < structure.activePools) {
    throw new Error(`target structure ${structure.key}: D${structure.tier} has ${tierPools.length} senior pools, the target needs ${structure.activePools} active`);
  }
  const shape = (p) => ({ id: p.id, label: p.label ?? `D${structure.tier} pool ${p.pool_index}`, poolIndex: Number(p.pool_index), alreadyRetired: p.retired_at != null });
  const keep = tierPools.slice(0, structure.activePools).map(shape);
  const retire = tierPools.slice(structure.activePools).map(shape);
  return { keep, retire, retireIds: new Set(retire.map((p) => p.id)) };
}

/**
 * Løb i en pulje der pensioneres ved skiftet. Efter en --apply med målstrukturen SKAL
 * listen være tom; ellers er kalenderen skrevet med løb der bliver forældreløse.
 * @param {{ poolCounts: Array<[id, number]>, retireIds: Set }} args  postVerify().pools
 * @returns {Array<[id, number]>}
 */
export function racesInCutoverRetiredPools({ poolCounts = [], retireIds = new Set() } = {}) {
  return poolCounts.filter(([id, n]) => retireIds.has(id) && n > 0);
}

/** Dry-run-teksten: hvad planlægges der mod, og hvad står der i databasen i dag. */
export function formatTargetStructureReport({ structure, keep = [], retire = [] }) {
  const lines = [`\n── #5795 målstruktur ${structure.key} (--target-structure): D${structure.tier} planlægges med ${structure.activePools} aktive puljer ──`];
  lines.push(`  beholdes: ${keep.map((p) => p.label).join(" · ") || "—"}`);
  lines.push(`  pensioneres ved skiftet (${structure.source}), får INGEN løb: ${retire.map((p) => `${p.label}${p.alreadyRetired ? " (allerede pensioneret)" : ""}`).join(" · ") || "—"}`);
  const pending = retire.filter((p) => !p.alreadyRetired).length;
  lines.push(pending
    ? `  databasen røres ikke: ${pending} pulje(r) står stadig som aktive (retired_at IS NULL) indtil pensioneringen er kørt.`
    : "  alle puljerne er allerede pensioneret — flaget ændrer intet i planen.");
  return lines;
}
