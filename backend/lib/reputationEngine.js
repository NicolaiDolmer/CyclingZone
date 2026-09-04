// Omdømme-motoren (#1099, spec §3-§4). RENE funktioner, INGEN I/O: alt her kan
// køres på et fixture-array og giver samme svar hver gang. Persistens bor i
// `reputationPersist.js`, flaget i `reputationFlag.js`, vægtene i
// `reputationConstants.js`.
//
// ── AFVIGELSE FRA SPEC §4, verificeret mod prod 4/9 2026 ────────────────────
// Specens tabel siger "Sejr endagsløb (`stage`, rank 1, race_type single)".
// Det er IKKE sådan data ligger. Målt på hele race_results (1,26 mio. rækker,
// alle tre sæsoner):
//     race_type='single'  →  result_type ∈ {gc, team} — NUL `stage`-rækker.
//     race_type='stage_race' → gc/points/mountain/young findes KUN på sidste
//                              etape; `leader` findes KUN på etape 1..N-1.
// Et endagsløbs resultat er altså en `gc`-række på stage_number 1. Havde
// motoren fulgt specen ordret, ville ALLE endagsløb (83.504 gc-rækker, heraf
// Monuments og hele ProSeries-endagskalenderen) have givet nul omdømme, og
// gulv-kreditten "Monument +15" ville aldrig være udløst en eneste gang.
// Motoren læser derfor endagsløb fra `gc` (og accepterer `stage` som fallback,
// skulle en importsti nogensinde skrive den formen). Rapporteret til ejeren i
// PR-body'en; ingen VÆGT er ændret.
//
// Selve `gc`-rækkens dobbeltrolle er grunden til at hændelsen har to baser:
// `one_day_*` når løbet er et endagsløb, `gc_*` når det er et etapeløb. De to
// har forskellige basispoint (20 vs. 25) og forskellige gulv-kreditter.

import {
  W_CLASS,
  DEFAULT_CLASS_WEIGHT,
  EVENT_BASE,
  EVENT_OUTCOME,
  LEADER_DAY_EVENT_KIND,
  LEADER_DAY_FORM_POINTS,
  BASE_FORM_POINTS,
  OUTCOME_MULTIPLIER,
  FLOOR_CREDITS,
  NO_FLOOR_CREDIT_CLASSES,
  PODIUM_MIN_RANK,
  PODIUM_MAX_RANK,
  TOP10_MIN_RANK,
  TOP10_MAX_RANK,
  FLOOR_CAP,
  REPUTATION_MIN,
  REPUTATION_MAX,
  SEED_FLOOR_WEIGHT,
  SEASON_DECAY_FACTOR,
  REPUTATION_BANDS,
  eventKind,
  roundPoints,
} from "./reputationConstants.js";

// result_type → hændelsesbase for et ETAPELØB.
const STAGE_RACE_BASE_BY_RESULT_TYPE = Object.freeze({
  stage: EVENT_BASE.STAGE,
  gc: EVENT_BASE.GC,
  points: EVENT_BASE.JERSEY_POINTS,
  mountain: EVENT_BASE.JERSEY_MOUNTAIN,
  young: EVENT_BASE.JERSEY_YOUNG,
});

// Baser der KUN afgøres på sidste etape (spec §4: "sidste etape").
const FINAL_STAGE_ONLY_BASES = new Set([
  EVENT_BASE.GC,
  EVENT_BASE.JERSEY_POINTS,
  EVENT_BASE.JERSEY_MOUNTAIN,
  EVENT_BASE.JERSEY_YOUNG,
]);

export function classWeight(raceClass) {
  const w = W_CLASS[raceClass];
  return Number.isFinite(w) ? w : DEFAULT_CLASS_WEIGHT;
}

export function outcomeForRank(rank) {
  if (!Number.isFinite(rank)) return null;
  if (rank === 1) return EVENT_OUTCOME.WIN;
  if (rank >= PODIUM_MIN_RANK && rank <= PODIUM_MAX_RANK) return EVENT_OUTCOME.PODIUM;
  if (rank >= TOP10_MIN_RANK && rank <= TOP10_MAX_RANK) return EVENT_OUTCOME.TOP10;
  return null;
}

export function formPointsFor({ base, outcome, raceClass }) {
  const basePoints = BASE_FORM_POINTS[base];
  const multiplier = OUTCOME_MULTIPLIER[outcome];
  if (!Number.isFinite(basePoints) || !Number.isFinite(multiplier)) return 0;
  return roundPoints(basePoints * multiplier * classWeight(raceClass));
}

export function floorCreditFor({ base, outcome, raceClass }) {
  // Spec §4: gulv-kredit gives kun ved sejr, og aldrig i Class1/Class2.
  if (outcome !== EVENT_OUTCOME.WIN) return 0;
  if (NO_FLOOR_CREDIT_CLASSES.includes(raceClass)) return 0;
  const credit = FLOOR_CREDITS[base]?.[raceClass];
  return Number.isFinite(credit) ? credit : 0;
}

export function dedupeKeyFor({ riderId, raceId, stageNumber, kind }) {
  return `rider:${riderId}:race:${raceId}:stage:${stageNumber}:${kind}`;
}

// Endagsløb skriver sit resultat som `gc`. Skulle en importsti nogensinde have
// skrevet `stage` i stedet, læses den — men ALDRIG begge for samme løb: så
// ville vinderen få 20·W to gange. `gc` vinder når begge findes.
function oneDayResultTypeInUse(results) {
  const hasGc = results.some((r) => r?.result_type === "gc");
  if (hasGc) return "gc";
  return results.some((r) => r?.result_type === "stage") ? "stage" : null;
}

/**
 * REN hændelses-udledning for ÉN etapes (eller ét endagsløbs) resultatrækker.
 *
 * @param {object} args
 * @param {{id, season_id, race_type, race_class, stages}} args.race
 * @param {number} args.stageNumber
 * @param {boolean} [args.isLastStage]  udledes af `stageNumber === race.stages`
 *   når den ikke gives.
 * @param {Array<{rider_id, team_id, result_type, rank}>} args.results
 *   DENNE etapes rækker (samme form som race_results/resultRows).
 * @param {string|Date|null} [args.occurredAt]
 * @returns {Array<object>} hændelser klar til `rider_reputation_events`.
 */
export function eventsFromStageResults({
  race,
  stageNumber,
  isLastStage,
  results = [],
  occurredAt = null,
} = {}) {
  if (!race?.id || !Array.isArray(results) || !results.length) return [];

  const raceClass = race.race_class ?? null;
  const isSingle = race.race_type === "single";
  const lastStage = typeof isLastStage === "boolean"
    ? isLastStage
    : Number(stageNumber) === Number(race.stages ?? 1);

  const oneDayType = isSingle ? oneDayResultTypeInUse(results) : null;
  const events = [];
  const seenKeys = new Set();

  for (const row of results) {
    if (!row?.rider_id) continue;
    const rank = Number(row.rank);
    const outcome = outcomeForRank(rank);
    const resultType = row.result_type;

    let base = null;
    let kind = null;

    if (resultType === "leader") {
      // Spec §4: dag i førertrøje, rank 1, IKKE sidste etape. Prod bekræfter at
      // `leader` aldrig skrives på sidste etape, men guarden står alligevel —
      // ellers ville en fremtidig ændring i skriveren tavst dobbelt-tælle den
      // sidste dag (som allerede er dækket af gc/trøje-hændelserne).
      if (isSingle || lastStage || rank !== 1) continue;
      kind = LEADER_DAY_EVENT_KIND;
      const key = dedupeKeyFor({ riderId: row.rider_id, raceId: race.id, stageNumber, kind });
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      events.push({
        rider_id: row.rider_id,
        team_id: row.team_id ?? null,
        race_id: race.id,
        stage_number: stageNumber,
        season_id: race.season_id ?? null,
        event_kind: kind,
        race_class: raceClass,
        form_points: roundPoints(LEADER_DAY_FORM_POINTS * classWeight(raceClass)),
        floor_credit: 0,
        occurred_at: occurredAt,
        dedupe_key: key,
      });
      continue;
    }

    if (!outcome) continue;

    if (isSingle) {
      // team/team_day og alt andet end den ene resultattype løbet bruger.
      if (!oneDayType || resultType !== oneDayType) continue;
      base = EVENT_BASE.ONE_DAY;
    } else {
      base = STAGE_RACE_BASE_BY_RESULT_TYPE[resultType] ?? null;
      if (!base) continue; // team, team_day, points_day, mountain_day, young_day
      if (FINAL_STAGE_ONLY_BASES.has(base) && !lastStage) continue;
    }

    kind = eventKind(base, outcome);
    const key = dedupeKeyFor({ riderId: row.rider_id, raceId: race.id, stageNumber, kind });
    // Samme rytter kan ikke have to rækker med samme (result_type, rank-bånd) i
    // én etape; skulle et gen-importeret datasæt indeholde dubletter, tælles de
    // ikke to gange (DB'ens UNIQUE er sikkerhedsnettet, dette er forsvaret i
    // den rene sti så backfill/harness rapporterer det samme som prod ville).
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    events.push({
      rider_id: row.rider_id,
      team_id: row.team_id ?? null,
      race_id: race.id,
      stage_number: stageNumber,
      season_id: race.season_id ?? null,
      event_kind: kind,
      race_class: raceClass,
      form_points: formPointsFor({ base, outcome, raceClass }),
      floor_credit: floorCreditFor({ base, outcome, raceClass }),
      occurred_at: occurredAt,
      dedupe_key: key,
    });
  }

  return events;
}

/**
 * Bekvemmelighed oven på `eventsFromStageResults`: grupperer en HEL afviklings
 * resultatrækker pr. etape og udleder hændelser for hver. Bruges af hook'en
 * (simulateRace afvikler alle etaper i ét kald), backfill og harness.
 */
export function eventsFromResultRows({ race, resultRows = [], occurredAt = null } = {}) {
  if (!race?.id || !resultRows.length) return [];
  const byStage = new Map();
  for (const row of resultRows) {
    const stageNumber = Number(row?.stage_number ?? 1) || 1;
    if (!byStage.has(stageNumber)) byStage.set(stageNumber, []);
    byStage.get(stageNumber).push(row);
  }
  const lastStage = Number(race.stages ?? 1) || 1;
  const events = [];
  for (const [stageNumber, results] of [...byStage.entries()].sort((a, b) => a[0] - b[0])) {
    events.push(...eventsFromStageResults({
      race,
      stageNumber,
      isLastStage: stageNumber === lastStage,
      results,
      occurredAt,
    }));
  }
  return events;
}

export function clampReputation(value) {
  return Math.min(REPUTATION_MAX, Math.max(REPUTATION_MIN, value));
}

export function seedFloorFor(seedPopularity, { seedFloorWeight = SEED_FLOOR_WEIGHT, floorCap = FLOOR_CAP } = {}) {
  const seed = Number(seedPopularity);
  if (!Number.isFinite(seed) || seed <= 0) return 0;
  return roundPoints(Math.min(seed, floorCap) * seedFloorWeight);
}

export function bandFor(reputation) {
  const value = Number(reputation) || 0;
  let band = REPUTATION_BANDS[0];
  for (const candidate of REPUTATION_BANDS) {
    if (value >= candidate.min) band = candidate;
  }
  return band;
}

/**
 * Rytterens tal (spec §3).
 *
 * @param {object} args
 * @param {number} args.seedPopularity          riders.popularity ("ry ved ankomst")
 * @param {Array<{form_points, floor_credit}>} args.events
 * @param {number} args.currentSeasonIndex      sæson-NUMMER (seasons.number)
 * @param {Function} [args.seasonIndexOf]       (event) => sæson-nummer for hændelsen
 * @param {object} [args.options]               kalibrerings-overrides (harness §9)
 * @returns {{floor:number, form:number, reputation:number, band:object}}
 */
export function computeReputation({
  seedPopularity = 0,
  events = [],
  currentSeasonIndex = 0,
  seasonIndexOf = (event) => Number(event?.season_index ?? currentSeasonIndex),
  options = {},
} = {}) {
  const {
    seedFloorWeight = SEED_FLOOR_WEIGHT,
    floorCap = FLOOR_CAP,
    decayFactor = SEASON_DECAY_FACTOR,
  } = options;

  const seedFloor = seedFloorFor(seedPopularity, { seedFloorWeight, floorCap });

  let floorCredits = 0;
  let form = 0;
  for (const event of events) {
    floorCredits += Number(event?.floor_credit) || 0;
    const eventSeason = Number(seasonIndexOf(event));
    // Negative aldre (en hændelse fra en FREMTIDIG sæson, som kun kan opstå
    // ved en fejl i kaldstedets sæson-mapping) må ikke FORSTÆRKE formen —
    // 0,5^-2 = 4. Klemmes til 0 sæsoner siden.
    const seasonsSince = Number.isFinite(eventSeason)
      ? Math.max(0, currentSeasonIndex - eventSeason)
      : 0;
    form += (Number(event?.form_points) || 0) * decayFactor ** seasonsSince;
  }

  const floor = roundPoints(Math.min(floorCap, Math.max(0, seedFloor + floorCredits)));
  const roundedForm = roundPoints(form);
  const reputation = roundPoints(clampReputation(floor + roundedForm));

  return { floor, form: roundedForm, reputation, band: bandFor(reputation) };
}
