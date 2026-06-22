// Per-division kalender-generator (launch-checklist #2) — REN funktion (ingen DB/I/O).
//
// Givet liga-puljerne (league_divisions) + verdens-kataloget (race_pool), vælg ét
// sæt løb PR. LIVE pulje, så hver division/pulje får sin EGEN kalender:
// "Division 1 kører deres egne løb." seasonCalendarMaterializer.js persisterer output.
//
// Pulje-liveness spejler aiTeamGenerator.targetAiCountForPool (#1688) — så vi aldrig
// genererer løb til en pulje uden et felt at køre dem i:
//   tier 1 + 2  → ALTID en kalender (felterne er altid AI-fyldte til POOL_TARGET_SIZE).
//   tier 3 + 4  → kun puljer med >=1 ægte manager. Med managere i tier 3
//                 (MANAGER_ENTRY_DIVISION=3) er div-4-puljerne tomme → ingen kalender.
//
// Determinisme: seed pr. pulje = baseSeed XOR pool.id (league_divisions.id er SERIAL),
// så hver pulje får en varieret men reproducerbar kalender (samme per-pulje-seed-mønster
// som aiTeamGenerator). selectSeasonRaces er allerede seed-stabil (#1124).

import {
  selectSeasonRaces,
  DEFAULT_RACE_DAYS_TARGET,
  FIRST_SEASON_STAGE_RACE_QUOTA,
} from "./seasonRaceSelection.js";

// ── EJER-TUNBAR: race-klasser pr. tier ──────────────────────────────────────────
// Pyramide-logik: toppen kører de prestigefyldte WorldTour/Grand Tours; indgangs-
// og bund-tierene kører Continental Circuit (ProSeries/Class 1/Class 2). Managere
// starter i tier 3 (MANAGER_ENTRY_DIVISION=3) → de kører ProSeries + Class 1, og de
// nye Class 1/2-løb (launch-checklist #5) lander dermed i tier 3-4.
//
// ÅBEN EJER-BESLUTNING (bekræftes inden launch): den præcise klasse-mix pr. tier +
// om sæson 1 skal være helt WorldTour-fri (jf. selectFirstSeasonRaces' WT-exclude).
// Da tier 1-2 er ren-AI ved launch (managere i tier 3), påvirker WT-løb dér ikke
// menneske-oplevelsen i sæson 1 — men mixet kan overrides pr. kald.
export const DEFAULT_TIER_RACE_CLASSES = Object.freeze({
  1: ["TourFrance", "GiroVuelta", "Monuments", "OtherWorldTourA", "OtherWorldTourB", "OtherWorldTourC"],
  2: ["OtherWorldTourA", "OtherWorldTourB", "OtherWorldTourC", "ProSeries"],
  3: ["ProSeries", "Class1"],
  4: ["Class1", "Class2"],
});

// Spejler aiTeamGenerator: tier 1/2 altid live; tier 3/4 kun med >=1 ægte manager.
// (Holdt som lokal kopi for at undgå import af aiTeamGenerator's __testables; samme
//  prædikat — hold dem i sync hvis politikken ændres.)
export function poolHasCalendar(tier, realManagerCount = 0) {
  if (tier === 1 || tier === 2) return true;
  return (Number(realManagerCount) || 0) >= 1;
}

/**
 * Generér en kalender (udvalgte løb) pr. LIVE pulje — GLOBALT de-duplikeret (#1714).
 *
 * Hvert løb (pool_race_id) vælges højst af ÉN pulje på tværs af hele sæsonen: et
 * globalt `Set` af allerede-valgte id'er fjernes fra kataloget før hver efterfølgende
 * puljes `selectSeasonRaces`-kald. Det forhindrer dubletter på tværs af puljer som
 * den tidligere uafhængige-pr-pulje-udvælgelse gav (#1714: fx Volta Algarvia i 5 puljer).
 *
 * Udvælgelses-rækkefølge (deterministisk): mest-begrænset-først — puljer med
 * FÆRREST etapeløb-kandidater i deres klasse-segment vælger først, så de knappe
 * etapeløb (kataloget har ~49 etapeløb total < 7 puljer × 8 quota = 56) ikke
 * "stjæles" af bredere puljer. Ties brydes på tier (top først) så pool.id (stabilt).
 *
 * Determinisme: per-pulje-seed = baseSeed XOR pool.id (uændret). Udvælgelses-
 * rækkefølgen afhænger kun af (pools, catalog) → samme input+seed = samme output.
 *
 * GRACEFUL FALLBACK (ingen tavs beskæring): hvis et klasse-segment løber tør for
 * etapeløb, får de sidste puljer færre etapeløb end target (suppleret med endags-
 * fyld). Hver beskåret pulje rapporteres i det vedhæftede `truncated`-array, så
 * calleren kan logge det. Return-værdien er ET ARRAY af kalendre (bagud-kompatibelt
 * — materializeren itererer direkte) MED en `truncated`-property hængt på.
 *
 * @param {object}   args
 * @param {Array}    args.pools            league_divisions-rækker beriget med
 *                                         realManagerCount: [{ id, tier, pool_index?, label?, realManagerCount }]
 * @param {Array}    args.catalog          race_pool-rækker: [{ id, name, race_class, race_type, stages }]
 * @param {object}   [args.tierRaceClasses] tier → includeClasses[] (default DEFAULT_TIER_RACE_CLASSES)
 * @param {number}   [args.raceDaysTarget]  løbsdage pr. division (default 60)
 * @param {number}   [args.stageRaceQuota]  garanterede etapeløb pr. division (default 8)
 * @param {number}   [args.baseSeed]        sæson-seed; pr-pulje-seed = baseSeed XOR pool.id
 * @returns {Array<{ leagueDivisionId, tier, label, races, totalRaceDays, candidateCount, stageRaceCount }>
 *           & { truncated: Array<{ leagueDivisionId, tier, label, stageRaceTarget, stageRacesSelected, stageRacesShort }> }}
 */
export function generateDivisionCalendars({
  pools = [],
  catalog = [],
  tierRaceClasses = DEFAULT_TIER_RACE_CLASSES,
  raceDaysTarget = DEFAULT_RACE_DAYS_TARGET,
  stageRaceQuota = FIRST_SEASON_STAGE_RACE_QUOTA,
  baseSeed = 1,
} = {}) {
  // Kun live puljer indgår i udvælgelsen (samme prædikat som før).
  const livePools = pools.filter(
    (p) => poolHasCalendar(p.tier, Number(p.realManagerCount) || 0),
  );

  // Mest-begrænset-først: tæl hver puljes etapeløb-kandidater i dens klasse-segment.
  // Puljer med færrest alternativer er mest sårbare for at blive tømt af andre puljer,
  // så de vælger først. Deterministisk: (færrest kandidater, så top-tier, så pool.id).
  const stageCandidateCount = (pool) => {
    const includeClasses = tierRaceClasses[pool.tier] || null;
    const includeSet = includeClasses ? new Set(includeClasses) : null;
    return catalog.filter(
      (r) => r.race_type === "stage_race" && (!includeSet || includeSet.has(r.race_class)),
    ).length;
  };
  const order = livePools
    .map((pool) => ({ pool, stageCands: stageCandidateCount(pool) }))
    .sort((a, b) => {
      if (a.stageCands !== b.stageCands) return a.stageCands - b.stageCands; // færrest først
      if (a.pool.tier !== b.pool.tier) return a.pool.tier - b.pool.tier;     // top-tier først
      return Number(a.pool.id) - Number(b.pool.id);                          // stabil tie-break
    });

  const taken = new Set(); // globale pool_race_id'er der allerede er fordelt
  const byPoolId = new Map();
  const truncated = [];

  for (const { pool } of order) {
    const includeClasses = tierRaceClasses[pool.tier] || null;
    const seed = (Number(baseSeed) ^ Number(pool.id)) >>> 0;

    // Ekskludér allerede-valgte løb fra kataloget for denne pulje (global de-dup).
    const remainingCatalog = catalog.filter((r) => !taken.has(r.id));

    const result = selectSeasonRaces({
      pool: remainingCatalog,
      includeClasses,
      raceDaysTarget,
      stageRaceQuota,
      seed,
    });

    for (const r of result.selected) taken.add(r.id);

    const stageRaceCount = result.selected.filter((r) => r.race_type === "stage_race").length;

    byPoolId.set(pool.id, {
      leagueDivisionId: pool.id,
      tier: pool.tier,
      label: pool.label ?? null,
      races: result.selected,
      totalRaceDays: result.totalRaceDays,
      candidateCount: result.candidateCount,
      stageRaceCount,
    });

    // Beskæring: fik puljen færre etapeløb end quota (target)? Rapportér eksplicit.
    if (stageRaceCount < stageRaceQuota) {
      truncated.push({
        leagueDivisionId: pool.id,
        tier: pool.tier,
        label: pool.label ?? null,
        stageRaceTarget: stageRaceQuota,
        stageRacesSelected: stageRaceCount,
        stageRacesShort: stageRaceQuota - stageRaceCount,
      });
    }
  }

  // Bevar input-puljernes rækkefølge i output (ikke udvælgelses-rækkefølgen), så
  // calleren ser kalendrene i samme orden som før de-dup'en blev indført.
  const calendars = livePools
    .map((p) => byPoolId.get(p.id))
    .filter(Boolean);

  // Array (bagud-kompatibelt) med truncated-rapport hængt på som property.
  calendars.truncated = truncated;
  return calendars;
}
