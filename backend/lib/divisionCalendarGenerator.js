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

// ── #1856: VIRKELIGHEDSTRO blanding — garanteret andel endagsløb pr. tier ─────────
// Roden til problemet: Fase A garanterede etapeløb-kvoten, men endagsløb fik kun
// "rest" i fyld-fasen. For Tier 1 fyldte 8 etapeløb (op til 21 etaper) hele dags-
// budgettet → 0 kommende endagsløb (ren etapeløb-sæson — elendigt). Vi reserverer nu
// endagsplads FØR etapeløb-fyld løber budgettet tørt.
//
// SINGLE_RACE_MIN_SHARE: minimum-andel af raceDaysTarget der garanteres som endagsløb
// (race_type='single'), pr. tier. Endagsløb = 1 dag hver, så denne andel = antal
// garanterede endagsløb / raceDaysTarget. ~25-40%: top-tier kører flere store
// etapeløb (lavere single-share), bund-tier flere endagsklassikere (højere share).
// EJER-TUNBAR — konstanter så de kan kalibreres mod en ægte sæson senere.
export const DEFAULT_TIER_SINGLE_RACE_MIN_SHARE = Object.freeze({
  1: 0.25, // Tier 1: grand tours dominerer, men min. 25% endagsklassikere/monumenter
  2: 0.3,
  3: 0.35,
  4: 0.4,  // Tier 4: mest endagsløb (Class 1/2-klassikere)
});

// MONUMENT_MIN: minimum antal Monuments (de prestigefyldte endags-monumenter) pr.
// tier. Kun Tier 1 kører Monuments-klassen (jf. DEFAULT_TIER_RACE_CLASSES), så øvrige
// tiers står til 0. Tier 1 garanteres >=2 så sæsonen altid har monument-højdepunkter.
export const DEFAULT_TIER_MONUMENT_MIN = Object.freeze({
  1: 2,
  2: 0,
  3: 0,
  4: 0,
});

// Race-klassen der repræsenterer monumenter (endags-monumenter). Holdt som konstant
// så monument-logikken ikke hardcoder en streng flere steder.
export const MONUMENT_RACE_CLASS = "Monuments";

// Spejler aiTeamGenerator: tier 1/2 altid live; tier 3/4 kun med >=1 ægte manager.
// (Holdt som lokal kopi for at undgå import af aiTeamGenerator's __testables; samme
//  prædikat — hold dem i sync hvis politikken ændres.)
export function poolHasCalendar(tier, realManagerCount = 0) {
  if (tier === 1 || tier === 2) return true;
  return (Number(realManagerCount) || 0) >= 1;
}

// 0/1 subset-sum (DP): find en delmængde af `items` hvis størrelses-sum er PRÆCIST
// `targetSum`. Returnér delmængden (array) eller null hvis ingen eksakt kombination
// findes. targetSum er lille (≤ raceDaysTarget) → DP er billig. Deterministisk: items
// behandles i input-rækkefølge. Bruges til "PRÆCIST target"-kalenderen (#1856): vælg
// etapeløb der lukker resten eksakt, så endagsløb kan maksimere blandingen.
export function pickStagesForExactSum(items = [], targetSum, sizeOf = (r) => Number(r?.stages) || 1) {
  if (targetSum < 0) return null;
  if (targetSum === 0) return [];
  // reach[s] = { prevSum, itemIdx } for første måde at nå sum s (0/1 — hver item én gang).
  const reach = new Array(targetSum + 1).fill(null);
  reach[0] = { prevSum: -1, itemIdx: -1 };
  for (let i = 0; i < items.length; i++) {
    const w = Math.max(1, Number(sizeOf(items[i])) || 1);
    for (let s = targetSum; s >= w; s--) {
      if (reach[s] === null && reach[s - w] !== null) {
        reach[s] = { prevSum: s - w, itemIdx: i };
      }
    }
    if (reach[targetSum] !== null) break; // tidlig exit når target er nået
  }
  if (reach[targetSum] === null) return null;
  const chosen = [];
  for (let s = targetSum; s > 0; ) {
    const node = reach[s];
    chosen.push(items[node.itemIdx]);
    s = node.prevSum;
  }
  return chosen;
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
 * ALGORITME — round-robin i FIRE faser på tværs af ALLE live puljer (#1856):
 *
 *   For hver pulje bygges deterministisk prioriterede kandidatlister (filtreret
 *   på puljens tier-klasser, seedet pr. pulje = baseSeed XOR pool.id):
 *     • monumentQueue — endags-monumenter (Monuments-klassen, prestige)
 *     • singleQueue   — alle endagsløb (inkl. monumenter) til single-kvoten
 *     • stageQueue    — etapeløb (knappe, værdifulde)
 *     • fillQueue     — alt resterende (til fyld op mod target)
 *
 *   FASE A0 (monument-min): hver pulje garanteres MONUMENT_MIN endags-monumenter FØR
 *   etapeløb spiser budgettet. Sikrer at Tier 1 altid har monument-højdepunkter.
 *
 *   FASE A1 (single-kvote): hver pulje garanteres en andel (SINGLE_RACE_MIN_SHARE ×
 *   target) endagsløb. Dette er rettelsen på "ren etapeløb-sæson": endagsplads
 *   RESERVERES før etapeløb-fyld, ikke kun som rest. Round-robin → jævn fordeling.
 *
 *   FASE A2 (etapeløb-kvote): som før — hver pulje tager op til stageRaceQuota etapeløb
 *   round-robin. Det globale `taken`-Set giver unikhed → knappe etapeløb deles JÆVNT.
 *
 *   FASE B (fyld): runder hvor hver pulje på skift tager sit næste ikke-taget løb fra
 *   sin fillQueue (resterende endagsløb + etapeløb), indtil raceDaysTarget eller
 *   kandidaterne er udtømt. Også jævnt: ingen pulje fyldes helt op før de andre.
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
 * @param {number}   [args.raceDaysTarget]  løbsdage pr. division (default 140)
 * @param {number}   [args.overshootTolerance] hvor mange dage over target et løb må presse (default 5)
 * @param {number}   [args.stageRaceQuota]  garanterede etapeløb pr. division (default 8)
 * @param {object}   [args.tierSingleRaceMinShare] tier → min-andel endagsløb (default DEFAULT_TIER_SINGLE_RACE_MIN_SHARE)
 * @param {object}   [args.tierMonumentMin] tier → min antal Monuments (default DEFAULT_TIER_MONUMENT_MIN)
 * @param {number}   [args.baseSeed]        sæson-seed; pr-pulje-seed = baseSeed XOR pool.id
 * @param {boolean}  [args.allowReuseAcrossPools] når true droppes de-dup MELLEM puljer:
 *                                         hver pulje vælger uafhængigt fra sit tier-katalog,
 *                                         så parallelle puljer på samme tier må køre samme løb
 *                                         (hver med sin egen instans). Per-pulje selectedIds
 *                                         forhindrer stadig duplikat INDEN FOR samme pulje.
 *                                         Default false = NØJAGTIG nuværende #1714-adfærd.
 * @returns {Array<{ leagueDivisionId, tier, label, races, totalRaceDays, candidateCount, stageRaceCount, singleRaceCount }>
 *           & { truncated: Array<{ leagueDivisionId, tier, label, stageRaceTarget, stageRacesSelected, stageRacesShort }> }}
 */
export function generateDivisionCalendars({
  pools = [],
  catalog = [],
  tierRaceClasses = DEFAULT_TIER_RACE_CLASSES,
  raceDaysTarget = DEFAULT_RACE_DAYS_TARGET,
  overshootTolerance = DEFAULT_OVERSHOOT_TOLERANCE,
  stageRaceQuota = FIRST_SEASON_STAGE_RACE_QUOTA,
  tierSingleRaceMinShare = DEFAULT_TIER_SINGLE_RACE_MIN_SHARE,
  tierMonumentMin = DEFAULT_TIER_MONUMENT_MIN,
  baseSeed = 1,
  allowReuseAcrossPools = false,
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
  const isMonument = (race) =>
    race.race_class === MONUMENT_RACE_CLASS && race.race_type === "single";

  // Pr.-pulje arbejds-state: deterministisk prioriterede kandidat-køer (filtreret på
  // tier-klasser + seedet pr. pulje), plus akkumulerede udvalg.
  const stateById = new Map();
  for (const pool of roundRobinOrder) {
    const includeClasses = tierRaceClasses[pool.tier] || null;
    const includeSet = includeClasses ? new Set(includeClasses) : null;
    const seed = (Number(baseSeed) ^ Number(pool.id)) >>> 0;
    const shuffle = makeStableShuffler(seed);

    const inSegment = catalog.filter((r) => !includeSet || includeSet.has(r.race_class));
    // Køer pr. fase: monumenter (A0), endagsløb (A1), etapeløb (A2), resten (B-fyld).
    // singleQueue rummer ALLE endagsløb (inkl. monumenter); monumentQueue er delmængden.
    const singles = inSegment.filter((r) => r.race_type === "single");
    const monumentQueue = shuffle(singles.filter(isMonument));
    const singleQueue = shuffle(singles);
    const stageQueue = shuffle(inSegment.filter((r) => r.race_type === "stage_race"));

    // #1856: garanteret endagsløb-kvote (andel af target) + monument-min pr. tier.
    const share = Number(tierSingleRaceMinShare?.[pool.tier]) || 0;
    const singleQuota = Math.round(share * target); // endagsløb = 1 dag → antal = dage
    const monumentMin = Number(tierMonumentMin?.[pool.tier]) || 0;

    stateById.set(pool.id, {
      pool,
      monumentQueue,
      monumentCursor: 0,
      singleQueue,
      singleCursor: 0,
      stageQueue,
      stageCursor: 0,
      fillQueue: [], // rebuilt fra leftover singles + stages før Fase B
      fillCursor: 0,
      selected: [],
      selectedIds: new Set(),
      totalRaceDays: 0,
      stageRaceCount: 0,
      singleRaceCount: 0,
      monumentCount: 0,
      singleQuota,
      // singlesBudget: dage reserveret til endagsløb-finjustering i fase C, så vi rammer
      // PRÆCIST target. Begrænset af både den tunede single-kvote OG hvor mange unikke
      // endagsløb puljen faktisk har (gap kan aldrig overstige dette → ingen løb-gentagelse).
      singlesBudget: Math.min(singleQueue.length, singleQuota),
      monumentMin,
      candidateCount: inSegment.length,
    });
  }

  const taken = new Set(); // globale pool_race_id'er der allerede er fordelt
  // #1856 (overlap): når reuse er til, springer vi de-dup MELLEM puljer over —
  // et løb regnes kun "taget" hvis DENNE pulje allerede valgte det (selectedIds).
  // Per-pulje selectedIds bevares ALTID, så ingen pulje får samme løb to gange.
  const isTakenGlobally = (id) => !allowReuseAcrossPools && taken.has(id);

  const fits = (st, race) => st.totalRaceDays + stagesOf(race) <= target + tolerance;
  const addToPool = (st, race) => {
    st.selected.push(race);
    st.selectedIds.add(race.id);
    st.totalRaceDays += stagesOf(race);
    if (race.race_type === "stage_race") st.stageRaceCount++;
    if (race.race_type === "single") st.singleRaceCount++;
    if (isMonument(race)) st.monumentCount++;
    taken.add(race.id);
  };

  // Tag puljens næste tilgængelige (ikke-taget, ikke-overshoot, room) løb fra en kø.
  // Avancerer cursoren forbi løb der allerede er taget af en anden pulje. Returnerer
  // true hvis et løb blev tilføjet i denne tur. `cap` er en valgfri predikat(st) der
  // — hvis sand — stopper puljen fra at tage flere i denne fase (kvote nået).
  const takeNext = (st, queueKey, cursorKey, { cap = null } = {}) => {
    if (cap && cap(st)) return false; // fase-kvote allerede nået
    const queue = st[queueKey];
    while (st[cursorKey] < queue.length) {
      const race = queue[st[cursorKey]];
      if (isTakenGlobally(race.id) || st.selectedIds.has(race.id)) {
        st[cursorKey]++; // taget af en anden pulje (eller af denne pulje i en tidligere fase)
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
          if (isTakenGlobally(alt.id) || st.selectedIds.has(alt.id)) { look++; continue; }
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
      st[cursorKey]++;
      addToPool(st, chosen);
      return true;
    }
    return false;
  };

  // Generisk round-robin-runde-løkke: hver pulje på skift tager sit næste løb fra en
  // kø indtil ingen pulje gør fremskridt. Holder fordelingen JÆVN på tværs af puljer.
  const runRoundRobin = (queueKey, cursorKey, capFn = null) => {
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const pool of roundRobinOrder) {
        const st = stateById.get(pool.id);
        if (st.totalRaceDays >= target) continue;
        if (takeNext(st, queueKey, cursorKey, { cap: capFn })) {
          progressed = true;
        }
      }
    }
  };

  // FASE A0 — monument-min round-robin: garantér MONUMENT_MIN endags-monumenter pr.
  // pulje FØR etapeløb spiser budgettet (sikrer Tier 1 har monument-højdepunkter).
  runRoundRobin("monumentQueue", "monumentCursor", (st) => st.monumentCount >= st.monumentMin);

  if (allowReuseAcrossPools) {
    // EXACT-FIT pr. pulje (#1856 ejer-krav 26/6: "PRÆCIST target" + max blanding). Da
    // genbrug er til, konkurrerer puljerne IKKE om kataloget → hver kan behandles
    // uafhængigt: vælg en ETAPELØB-delmængde der summerer EKSAKT (subset-sum/DP), så
    // 1-dags endagsløb fylder resten op til target. Flest endagsløb først (max blanding;
    // etapeløb lukker resten eksakt) → virkelighedstro blanding + altid nøjagtig target.
    for (const pool of roundRobinOrder) {
      const st = stateById.get(pool.id);
      const remaining = target - st.totalRaceDays; // efter A0-monumenter
      if (remaining <= 0) continue;
      const avail = (queue) => queue.filter((r) => !st.selectedIds.has(r.id));
      const availStages = avail(st.stageQueue);
      const availSingles = avail(st.singleQueue);
      const maxSingles = Math.min(st.singlesBudget, availSingles.length, remaining);

      let pickedStages = null;
      let singlesUsed = 0;
      for (let s = maxSingles; s >= 0; s--) {
        const stageNeed = remaining - s;
        if (stageNeed === 0) { pickedStages = []; singlesUsed = s; break; }
        const subset = pickStagesForExactSum(availStages, stageNeed, stagesOf);
        if (subset) { pickedStages = subset; singlesUsed = s; break; }
      }

      if (pickedStages) {
        for (const r of pickedStages) addToPool(st, r);
        for (let k = 0; k < singlesUsed; k++) addToPool(st, availSingles[k]);
      } else {
        // Fallback (bør ikke ske: tier-katalog ≥ target): grådig fyld, aldrig over target.
        for (const r of [...availStages, ...availSingles]) {
          if (st.totalRaceDays + stagesOf(r) > target) continue;
          addToPool(st, r);
        }
      }
    }
  } else {
    // ROUND-ROBIN (#1714, reuse=false): puljerne KONKURRERER om kataloget (global de-dup),
    // så jævn fordeling kræver round-robin. Bevarer den oprindelige adfærd + tests.
    // FASE A1 — single-kvote (endagsplads reserveres FØR etapeløb → ikke ren etapeløb).
    runRoundRobin("singleQueue", "singleCursor", (st) => st.singleRaceCount >= st.singleQuota);
    // FASE A2 — etapeløb op til quota.
    if (quota > 0) {
      runRoundRobin("stageQueue", "stageCursor", (st) => st.stageRaceCount >= quota);
    }
    // FASE B — fyld op mod target (resterende endagsløb + etapeløb), jævnt via round-robin.
    for (const pool of roundRobinOrder) {
      const st = stateById.get(pool.id);
      const leftoverSingles = st.singleQueue
        .slice(st.singleCursor)
        .filter((r) => !isTakenGlobally(r.id) && !st.selectedIds.has(r.id));
      const leftoverStages = st.stageQueue
        .slice(st.stageCursor)
        .filter((r) => !isTakenGlobally(r.id) && !st.selectedIds.has(r.id));
      st.fillQueue = leftoverSingles.concat(leftoverStages);
      st.fillCursor = 0;
    }
    runRoundRobin("fillQueue", "fillCursor");
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
      singleRaceCount: st.singleRaceCount,
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
