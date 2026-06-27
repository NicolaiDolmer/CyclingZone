// backend/lib/tierRaceSelection.js
// Kalender-rebuild (2026-06-27): vælg ÉT løb-sæt PR. TIER (division) fra race_pool-kataloget,
// skaleret per tier. Output fodres til packDivisionCalendar (raceCalendarPacker.js) og
// materialiseres derefter identisk i hver LIVE pulje i tieren ("Division 3 kører samme løb
// som Division 3, parallelt i sine 4 puljer"). REN + deterministisk (ingen DB/Date/random).
//
// Skalering per tier (ejer-låst form 2026-06-27): top-tier flest/største løb + mest overlap,
// faldende ned ad pyramiden. Tallene er katalog-loft-bevidste (tier 4 har kun ~8 etapeløb).

// Per-tier kalender-form. Tunbar; beskæres automatisk hvis kataloget ikke kan levere.
export const DEFAULT_TIER_CALENDAR = Object.freeze({
  // Tier 1: 3 Grand Tours (rygrad, garanteret) + 9 mindre etapeløb + 21 klassikere = 33 løb, alle
  // på 28 dage. soloStageCount=0 (Grand Tours kører som rygrad MED overlap, ikke solo — en solo
  // Grand Tour ville blokere ~5 dage og smide klassikere ud); overlapPairCount=2 (lidt etape-på-
  // etape, men nok 1-løbs-dage til at alle 21 klassikere får plads). Reproducerer den godkendte pack.
  1: { stageRaceCount: 12, singleCount: 21, soloStageCount: 0, overlapPairCount: 2 },
  2: { stageRaceCount: 10, singleCount: 20, soloStageCount: 3, overlapPairCount: 3 },
  3: { stageRaceCount: 9, singleCount: 20, soloStageCount: 3, overlapPairCount: 2 },
  4: { stageRaceCount: 8, singleCount: 16, soloStageCount: 2, overlapPairCount: 1 },
});

// Et "Grand Tour" = et ~3-ugers etapeløb. Det er en divisions RYGRAD og garanteres altid i
// udvalget (vælges før de mindre etapeløb), så seed-tilfældighed aldrig dropper en Grand Tour
// (prod-bug 27/6: tier 1 fik kun 2 af 3 Grand Tours fordi udvælgelsen var ren seed-rækkefølge).
export const GRAND_TOUR_MIN_STAGES = 15;

// Deterministisk seed-varieret nøgle pr. (id, seed) — stabil rækkefølge uden DB/random.
// FNV-1a over `${seed}:${id}`: seed-præfikset propagerer gennem hele hashen, så seed
// faktisk ændrer den RELATIVE rækkefølge (ikke bare et konstant offset for ens-længde-id'er).
function seededKey(id, seed) {
  let h = 2166136261 >>> 0;
  const s = `${(Number(seed) || 0) >>> 0}:${id}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * @param {{
 *   catalog?: Array<{id, race_class, race_type, stages}>,
 *   raceClasses?: string[],
 *   seed?: number,
 *   stageRaceCount?: number, singleCount?: number,
 *   soloStageCount?: number, overlapPairCount?: number,
 * }} args
 * @returns {{ stageRaces, oneDayRaces, forcedOverlaps, stageRaceCount, singleCount, stageDays, truncatedStages, truncatedSingles }}
 */
export function selectTierRaceSet({
  catalog = [],
  raceClasses = [],
  seed = 1,
  stageRaceCount = 9,
  singleCount = 20,
  soloStageCount = 3,
  overlapPairCount = 2,
} = {}) {
  const classSet = new Set(raceClasses);
  const inTier = catalog.filter((r) => classSet.has(r.race_class));
  const order = (rows) => [...rows].sort((a, b) =>
    (seededKey(a.id, seed) - seededKey(b.id, seed)) || String(a.id).localeCompare(String(b.id)));

  // Grand Tours (rygraden) først — garanteret med op til stageRaceCount — derefter de mindre
  // etapeløb i seed-rækkefølge. Lavere tiers har ingen Grand Tours → uændret seed-udvælgelse.
  const allStages = inTier.filter((r) => r.race_type === "stage_race");
  const stagePool = [
    ...order(allStages.filter((r) => (Number(r.stages) || 1) >= GRAND_TOUR_MIN_STAGES)),
    ...order(allStages.filter((r) => (Number(r.stages) || 1) < GRAND_TOUR_MIN_STAGES)),
  ];
  const singlePool = order(inTier.filter((r) => r.race_type === "single"));

  const stageRaces = stagePool.slice(0, stageRaceCount)
    .map((r) => ({ id: r.id, stages: Math.max(1, Number(r.stages) || 1) }));

  // Signatur-solo = de STØRSTE valgte etapeløb (et "grand tour"-agtigt løb kører alene).
  const bySize = [...stageRaces].sort((a, b) => (b.stages - a.stages) || String(a.id).localeCompare(String(b.id)));
  const soloN = Math.min(soloStageCount, Math.max(0, stageRaces.length - 2 * overlapPairCount));
  const soloIds = new Set(bySize.slice(0, soloN).map((s) => s.id));
  for (const s of stageRaces) if (soloIds.has(s.id)) s.solo = true;

  // Bevidste etapeløb-på-etapeløb par — fra de ikke-solo MINDRE løb (aldrig Grand Tours: to
  // Grand Tours bør ikke køre samtidig, og GT-rygraden skal kunne bære klassikere ovenpå).
  const pairable = stageRaces.filter((s) => !s.solo && (Number(s.stages) || 1) < GRAND_TOUR_MIN_STAGES).map((s) => s.id);
  const forcedOverlaps = [];
  for (let p = 0; p < overlapPairCount && (2 * p + 1) < pairable.length; p++) {
    forcedOverlaps.push([pairable[2 * p], pairable[2 * p + 1]]);
  }

  const oneDayRaces = singlePool.slice(0, singleCount).map((r) => ({ id: r.id }));

  return {
    stageRaces, oneDayRaces, forcedOverlaps,
    stageRaceCount: stageRaces.length,
    singleCount: oneDayRaces.length,
    stageDays: stageRaces.reduce((s, r) => s + r.stages, 0),
    truncatedStages: Math.max(0, stageRaceCount - stageRaces.length),
    truncatedSingles: Math.max(0, singleCount - oneDayRaces.length),
  };
}
