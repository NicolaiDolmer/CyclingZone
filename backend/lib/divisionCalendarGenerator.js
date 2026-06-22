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
// som aiTeamGenerator). makeStableShuffler er allerede seed-stabil (#1124).

import {
  makeStableShuffler,
  DEFAULT_RACE_DAYS_TARGET,
  DEFAULT_OVERSHOOT_TOLERANCE,
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
 * Generér en kalender (udvalgte løb) pr. LIVE pulje — GLOBALT de-duplikeret OG
 * JÆVNT FORDELT på tværs af puljer der konkurrerer om samme klasse-segment (#1714).
 *
 * Hvert løb (pool_race_id) vælges højst af ÉN pulje på tværs af hele sæsonen, og
 * puljer i samme segment får nogenlunde lige mange løb i stedet for at de tidlige
 * puljer tømmer segmentet (det gamle "fyld-til-target-sekventielt" gav fx 28 løb i
 * pulje 6 mod 9 i pulje 7, og 0 løb i en hel division — uacceptabelt).
 *
 * ALGORITME — round-robin i to faser på tværs af ALLE live puljer:
 *
 *   For hver pulje bygges to deterministisk prioriterede kandidatlister (filtreret
 *   på puljens tier-klasser, seedet pr. pulje = baseSeed XOR pool.id):
 *     • stageQueue  — etapeløb (knappe, værdifulde)
 *     • fillQueue   — endagsløb + alle resterende løb (til fyld)
 *
 *   FASE A (etapeløb): runder hvor hver pulje på skift tager sit næste ikke-taget
 *   etapeløb fra sit segment, indtil alle har nået stageRaceQuota, segmentet er tomt,
 *   eller raceDaysTarget nås. Et globalt `taken`-Set giver unikhed → den knappe pulje
 *   af etapeløb (kataloget har ~49 < 7 puljer × 8 quota = 56) deles JÆVNT (±1 pr. pulje).
 *
 *   FASE B (fyld): runder hvor hver pulje på skift tager sit næste ikke-taget løb fra
 *   sin fillQueue, indtil raceDaysTarget eller kandidaterne er udtømt. Også jævnt:
 *   ingen pulje fyldes helt op før de andre får en chance.
 *
 * Overshoot-disciplin matcher selectSeasonRaces: et løb der ville skyde over
 * raceDaysTarget + overshootTolerance springes over (puljen kan tage et mindre løb
 * senere i runden / en senere runde).
 *
 * Determinisme: per-pulje-seed = baseSeed XOR pool.id (uændret). Pulje-rækkefølgen i
 * hver runde er fast (tier, så pool.id) → samme (pools, catalog, baseSeed) = samme output.
 *
 * GRACEFUL FALLBACK (ingen tavs beskæring): hvis et klasse-segment løber tør for
 * etapeløb, får puljerne færre etapeløb end target (suppleret med endags-fyld i fase B).
 * Hver beskåret pulje rapporteres i det vedhæftede `truncated`-array. Return-værdien er
 * ET ARRAY af kalendre (bagud-kompatibelt — materializeren itererer direkte) MED en
 * `truncated`-property hængt på.
 *
 * @param {object}   args
 * @param {Array}    args.pools            league_divisions-rækker beriget med
 *                                         realManagerCount: [{ id, tier, pool_index?, label?, realManagerCount }]
 * @param {Array}    args.catalog          race_pool-rækker: [{ id, name, race_class, race_type, stages }]
 * @param {object}   [args.tierRaceClasses] tier → includeClasses[] (default DEFAULT_TIER_RACE_CLASSES)
 * @param {number}   [args.raceDaysTarget]  løbsdage pr. division (default 60)
 * @param {number}   [args.overshootTolerance] hvor mange dage over target et løb må presse (default 5)
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
  overshootTolerance = DEFAULT_OVERSHOOT_TOLERANCE,
  stageRaceQuota = FIRST_SEASON_STAGE_RACE_QUOTA,
  baseSeed = 1,
} = {}) {
  const target = Number(raceDaysTarget) || DEFAULT_RACE_DAYS_TARGET;
  const tolerance = Number(overshootTolerance) || 0;
  const quota = Number(stageRaceQuota) || 0;

  // Kun live puljer indgår i udvælgelsen (samme prædikat som før).
  const livePools = pools.filter(
    (p) => poolHasCalendar(p.tier, Number(p.realManagerCount) || 0),
  );

  // Round-robin-rækkefølge: fast og deterministisk (top-tier først, så pool.id). Det
  // er KUN rækkefølgen puljerne tager tur i hver runde; HVOR MANGE hver får styres af
  // round-robin'en, ikke fyld-til-target.
  const roundRobinOrder = livePools
    .slice()
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier; // top-tier først
      return Number(a.id) - Number(b.id);             // stabil tie-break
    });

  const stagesOf = (race) => Number(race.stages) || 1;

  // Pr.-pulje arbejds-state: deterministisk prioriterede kandidat-køer (filtreret på
  // tier-klasser + seedet pr. pulje), plus akkumulerede udvalg.
  const stateById = new Map();
  for (const pool of roundRobinOrder) {
    const includeClasses = tierRaceClasses[pool.tier] || null;
    const includeSet = includeClasses ? new Set(includeClasses) : null;
    const seed = (Number(baseSeed) ^ Number(pool.id)) >>> 0;
    const shuffle = makeStableShuffler(seed);

    const inSegment = catalog.filter((r) => !includeSet || includeSet.has(r.race_class));
    // Etapeløb først jævnt (fase A), derefter endagsløb/resten som fyld (fase B).
    const stageQueue = shuffle(inSegment.filter((r) => r.race_type === "stage_race"));
    const fillQueue = shuffle(inSegment.filter((r) => r.race_type !== "stage_race"));

    stateById.set(pool.id, {
      pool,
      stageQueue,
      stageCursor: 0,
      fillQueue,
      fillCursor: 0,
      selected: [],
      selectedIds: new Set(),
      totalRaceDays: 0,
      stageRaceCount: 0,
      candidateCount: inSegment.length,
    });
  }

  const taken = new Set(); // globale pool_race_id'er der allerede er fordelt

  const fits = (st, race) => st.totalRaceDays + stagesOf(race) <= target + tolerance;
  const addToPool = (st, race) => {
    st.selected.push(race);
    st.selectedIds.add(race.id);
    st.totalRaceDays += stagesOf(race);
    taken.add(race.id);
  };

  // Tag puljens næste tilgængelige (ikke-taget, ikke-overshoot, room) løb fra en kø.
  // Avancerer cursoren forbi løb der allerede er taget af en anden pulje. Returnerer
  // true hvis et løb blev tilføjet i denne tur.
  const takeNext = (st, queueKey, cursorKey, { capStageRace = false } = {}) => {
    const queue = st[queueKey];
    while (st[cursorKey] < queue.length) {
      const race = queue[st[cursorKey]];
      if (taken.has(race.id)) {
        st[cursorKey]++; // taget af en anden pulje → spring permanent over
        continue;
      }
      if (st.totalRaceDays >= target) return false; // ingen mening at fylde mere
      if (!fits(st, race)) {
        // Ville skyde over loftet — lad den blive, men prøv et senere (mindre) løb.
        // Vi rykker IKKE cursoren permanent (et senere løb kan passe nu); i stedet
        // scanner vi fremad efter et løb der passer i denne tur.
        let look = st[cursorKey] + 1;
        while (look < queue.length) {
          const alt = queue[look];
          if (taken.has(alt.id)) { look++; continue; }
          if (fits(st, alt)) {
            // Byt: tag alt nu (swap så cursor-rækkefølgen forbliver deterministisk
            // for resten af køen). Vi fjerner alt fra sin plads og indsætter ved cursor.
            queue.splice(look, 1);
            queue.splice(st[cursorKey], 0, alt);
            break;
          }
          look++;
        }
        if (look >= queue.length) return false; // intet passer længere i denne kø
        // efter swap peger cursor nu på alt → fald igennem og tag det
      }
      const chosen = queue[st[cursorKey]];
      if (capStageRace && st.stageRaceCount >= quota) return false; // quota nået
      st[cursorKey]++;
      addToPool(st, chosen);
      if (chosen.race_type === "stage_race") st.stageRaceCount++;
      return true;
    }
    return false;
  };

  // FASE A — etapeløb round-robin op til quota per pulje (eller segment tomt / target).
  if (quota > 0) {
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const pool of roundRobinOrder) {
        const st = stateById.get(pool.id);
        if (st.stageRaceCount >= quota) continue;
        if (st.totalRaceDays >= target) continue;
        if (takeNext(st, "stageQueue", "stageCursor", { capStageRace: true })) {
          progressed = true;
        }
      }
    }
  }

  // FASE B — fyld round-robin op mod raceDaysTarget (endagsløb + resterende etapeløb).
  // Resterende ikke-taget etapeløb foldes ind i fyld-fasen så de ikke spildes (men
  // de fordeles stadig jævnt via round-robin'en).
  for (const pool of roundRobinOrder) {
    const st = stateById.get(pool.id);
    const leftoverStages = st.stageQueue
      .slice(st.stageCursor)
      .filter((r) => !taken.has(r.id) && !st.selectedIds.has(r.id));
    if (leftoverStages.length > 0) {
      // Behold deterministisk rækkefølge: append efter de planlagte endagsløb-fyld.
      st.fillQueue = st.fillQueue.slice(st.fillCursor).concat(leftoverStages);
      st.fillCursor = 0;
    }
  }

  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const pool of roundRobinOrder) {
      const st = stateById.get(pool.id);
      if (st.totalRaceDays >= target) continue;
      if (takeNext(st, "fillQueue", "fillCursor")) {
        progressed = true;
      }
    }
  }

  // Byg output + truncated-rapport.
  const truncated = [];
  const byPoolId = new Map();
  for (const pool of roundRobinOrder) {
    const st = stateById.get(pool.id);
    byPoolId.set(pool.id, {
      leagueDivisionId: pool.id,
      tier: pool.tier,
      label: pool.label ?? null,
      races: st.selected,
      totalRaceDays: st.totalRaceDays,
      candidateCount: st.candidateCount,
      stageRaceCount: st.stageRaceCount,
    });

    // Beskæring: fik puljen færre etapeløb end quota (target)? Rapportér eksplicit.
    if (st.stageRaceCount < quota) {
      truncated.push({
        leagueDivisionId: pool.id,
        tier: pool.tier,
        label: pool.label ?? null,
        stageRaceTarget: quota,
        stageRacesSelected: st.stageRaceCount,
        stageRacesShort: quota - st.stageRaceCount,
      });
    }
  }

  // Bevar input-puljernes rækkefølge i output (ikke round-robin-rækkefølgen), så
  // calleren ser kalendrene i samme orden som før (materializeren itererer direkte).
  const calendars = livePools
    .map((p) => byPoolId.get(p.id))
    .filter(Boolean);

  // Array (bagud-kompatibelt) med truncated-rapport hængt på som property.
  calendars.truncated = truncated;
  return calendars;
}
