// backend/lib/tierRaceSelection.js
// Kalender-rebuild (2026-06-27, prestige/spredning-spec): vælg ÉT løb-sæt PR. DIVISION (tier) fra
// race_pool-kataloget — DE STØRSTE løb den kan få op til en PRÆCIS game-day-kvote (Div 1=140,
// Div 2=112, Div 3=84, Div 4=56). Output (stageRaces + oneDayRaces) fodres til packLaneCalendar,
// der komprimerer + spreder + fylder til præcis density. REN + deterministisk (ingen DB/Date/random).
//
// Cross-tier dedup håndteres af tierCalendarMaterializer (øverste tier vælger først; lavere fra resten).
//
// #3327/#3328 (2026-08-04): to opt-in udvidelser, begge BAGUDKOMPATIBLE (default = uændret
// adfærd for kald der ikke sender de nye parametre — kun tierCalendarMaterializer sender dem):
//   classStageLengthBand — ekskludér etapeløb uden for deres klasses etapeantal-bånd (#3328).
//   oneDayShareTarget    — split kvoten i to budgetter (endagsløb/etapeløb) FØR det grådige
//                          walk, i stedet for ét sammenlagt walk hvor størrelse (ikke type)
//                          afgør rækkefølgen — det var rod-årsagen til D2's 33/67-skævvridning
//                          (#3327): store etapeløb vinder ALTID over 1-etapes løb ved samme
//                          prestige i et sammenlagt størrelses-sorteret walk.

// Prestige-rang (ejer-låst 2026-06-27): "de største løb" = højeste prestige først, IKKE flest
// etaper. Derfor havner monumenterne (1 etape) i Division 1.
export const PRESTIGE_RANK = Object.freeze({
  TourFrance: 0, GiroVuelta: 0, Monuments: 1,
  OtherWorldTourA: 2, OtherWorldTourB: 3, OtherWorldTourC: 4,
  ProSeries: 5, Class1: 6, Class2: 7,
});

// Et "Grand Tour" = ~3-ugers etapeløb (≥15 etaper) — pakkerens rygrad (spredt, komprimeret).
export const GRAND_TOUR_MIN_STAGES = 15;

// Game-day-kvote pr. tier (ejer-låst). Pr. pulje; alle puljer i en tier kører samme sæt.
export const TIER_GAME_DAY_QUOTA = Object.freeze({ 1: 140, 2: 112, 3: 84, 4: 56 });

// #2276 prestige-kaskade (ejer-låst 10/7): klasse-whitelist pr. tier, data-drevet ét sted.
// Kun tier 1 kører Monuments/GrandTour(TourFrance/GiroVuelta)/OtherWorldTourA — kaskaden
// fylder tier 2/3/4 nedad med de NÆSTE klasser, aldrig de øverste. `null` = alle klasser
// tilladt (kun tier 1). Rod-årsag for #2276: der fandtes KUN en etape-baseret GT-gate
// (selectTierRaceSet allowGrandTours), ingen klasse-gate — så Monuments (1 etape) og
// OtherWorldTourA kunne kaskadere frit ned i tier 4 når puljen materialiserede i et
// separat kald uden tier 1-3's valg i hukommelsen (reconcilePoolCalendarOnActivation).
export const TIER_CLASS_WHITELIST = Object.freeze({
  1: null,
  2: Object.freeze(["OtherWorldTourB", "ProSeries", "OtherWorldTourC"]),
  3: Object.freeze(["ProSeries", "Class1"]),
  4: Object.freeze(["Class1", "Class2"]),
});

// Deterministisk seed-varieret nøgle — varierer KUN rækkefølgen inden for samme prestige+størrelse.
function seededKey(id, seed) {
  let h = 2166136261 >>> 0;
  const s = `${(Number(seed) || 0) >>> 0}:${id}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
const prestigeOf = (rc) => PRESTIGE_RANK[rc] ?? 99;
const stagesOf = (r) => Math.max(1, Number(r.stages) || 1);

// Rang: prestige asc → størrelse desc (de største af samme prestige først) → knap-arketype
// (#3327, kun hvis priorityArchetypes angivet) → seed → id.
function compareCandidates(seed, priorityArchetypeSet) {
  return (a, b) => {
    const ra = prestigeOf(a.race_class), rb = prestigeOf(b.race_class);
    if (ra !== rb) return ra - rb;
    const sa = stagesOf(a), sb = stagesOf(b);
    if (sa !== sb) return sb - sa;
    if (priorityArchetypeSet) {
      const pa = priorityArchetypeSet.has(a.terrain_archetype) ? 0 : 1;
      const pb = priorityArchetypeSet.has(b.terrain_archetype) ? 0 : 1;
      if (pa !== pb) return pa - pb;
    }
    const ka = seededKey(a.id, seed), kb = seededKey(b.id, seed);
    if (ka !== kb) return ka - kb;
    return String(a.id).localeCompare(String(b.id));
  };
}

// Grådigt prestige-walk over en FÆRDIG-rangeret liste op til et game-day-budget: tag hvert
// løb der PASSER; et løb der ville skyde over springes (et senere, mindre løb lukker resten
// præcist). Delt af enkelt-walk og de to-fase-budgetterede walks nedenfor.
function greedyFill(ranked, budget) {
  const stageRaces = [];
  const oneDayRaces = [];
  let total = 0;
  for (const r of ranked) {
    if (total >= budget) break;
    const st = stagesOf(r);
    if (total + st > budget) continue;
    const row = { id: r.id, name: r.name ?? null, race_class: r.race_class, stages: st };
    if (st >= 2) stageRaces.push(row); else oneDayRaces.push(row);
    total += st;
  }
  return { stageRaces, oneDayRaces, total };
}

/**
 * Vælg en divisions løb op til en præcis game-day-kvote, prestige-først.
 *
 * @param {{ catalog?: Array<{id,name,race_class,race_type,stages,terrain_archetype}>, quota?: number,
 *   seed?: number, allowGrandTours?: boolean, allowedClasses?: string[]|null,
 *   classStageLengthBand?: object|null, oneDayShareTarget?: number|null,
 *   priorityArchetypes?: string[]|null }} args
 * @returns {{ stageRaces, oneDayRaces, stageGameDays, totalGameDays, quotaHit, shortfall }}
 */
export function selectTierRaceSet({
  catalog = [], quota = 0, seed = 1, allowGrandTours = true, allowedClasses = null,
  classStageLengthBand = null, oneDayShareTarget = null, priorityArchetypes = null,
} = {}) {
  // #2251: Grand Tours (≥15 etaper) hører KUN til Division 1 (spec'ens GT-rygrad).
  // Uden denne gate lod prestige-først-walket leftover-GT'er kaskadere ned i lavere
  // tiers (to samtidige 21-etapers GT'er i tier 4 → binding-kollaps, tomme startfelter).
  let eligible = allowGrandTours
    ? catalog
    : catalog.filter((r) => stagesOf(r) < GRAND_TOUR_MIN_STAGES);
  // #2276: klasse-whitelist-gate (Monuments/OtherWorldTourA kaskaderede ned i tier 4 —
  // etape-baseret GT-gaten alene fangede dem ikke, da Monuments = 1 etape).
  if (Array.isArray(allowedClasses)) {
    const allowed = new Set(allowedClasses);
    eligible = eligible.filter((r) => allowed.has(r.race_class));
  }
  // #3328: klasse↔etapeantal-bånd — ekskludér etapeløb uden for deres klasses bånd. Singler
  // (1 etape) er ikke etapeløb og upåvirkede; klasser uden et defineret bånd er upåvirkede.
  if (classStageLengthBand) {
    eligible = eligible.filter((r) => {
      const st = stagesOf(r);
      if (st < 2) return true;
      const band = classStageLengthBand[r.race_class];
      if (!band) return true;
      const [lo, hi] = band;
      return st >= lo && st <= hi;
    });
  }

  const priorityArchetypeSet = Array.isArray(priorityArchetypes) && priorityArchetypes.length
    ? new Set(priorityArchetypes) : null;
  const compare = compareCandidates(seed, priorityArchetypeSet);

  // Uden mix-target: ÉT sammenlagt grådigt walk (uændret historisk adfærd — størrelse
  // afgør rækkefølgen inden for samme prestige, uanset endagsløb/etapeløb).
  if (oneDayShareTarget == null) {
    const ranked = [...eligible].sort(compare);
    const { stageRaces, oneDayRaces, total } = greedyFill(ranked, quota);
    return {
      stageRaces, oneDayRaces,
      stageGameDays: stageRaces.reduce((s, r) => s + r.stages, 0),
      totalGameDays: total, quotaHit: total === quota, shortfall: Math.max(0, quota - total),
    };
  }

  // #3327: to-fase budgetteret walk. Split kvoten i et endagsløb-budget og et etapeløb-
  // budget, og fyld hver type-bunke prestige-først FOR SIG — det er hvad der faktisk styrer
  // mixet (data: TIER_ONE_DAY_SHARE_TARGET), i stedet for at lade størrelse-sorteringen
  // afgøre det som et biprodukt.
  const singles = eligible.filter((r) => stagesOf(r) === 1);
  const stages = eligible.filter((r) => stagesOf(r) >= 2);
  const singlesRanked = [...singles].sort(compare);
  const stagesRanked = [...stages].sort(compare);

  // Estimér gennemsnitlig etapeløbs-længde ved en probe (fuld kvote, kun etapeløb) — bruges
  // til at oversætte et RACE-COUNT-mål (oneDayShareTarget måler antal løb, ikke game-days;
  // ejeren taler i antal løb, jf. #3327) til et game-day-budget for endagsløb.
  //   oneDayCount ≈ X, stageCount ≈ (Q-X)/L  ⇒  X = target·Q / (L·(1-target) + target)
  const probe = greedyFill(stagesRanked, quota);
  const avgStageLen = probe.stageRaces.length ? probe.total / probe.stageRaces.length : 1;
  const denom = avgStageLen * (1 - oneDayShareTarget) + oneDayShareTarget;
  const rawOneDayBudget = denom > 0 ? (oneDayShareTarget * quota) / denom : 0;
  const oneDayBudget = Math.max(0, Math.min(quota, Math.round(rawOneDayBudget)));

  const oneDaySel = greedyFill(singlesRanked, oneDayBudget);
  const stageSel = greedyFill(stagesRanked, quota - oneDaySel.total);

  const stageRaces = stageSel.stageRaces;
  const oneDayRaces = oneDaySel.oneDayRaces;
  const total = oneDaySel.total + stageSel.total;
  return {
    stageRaces, oneDayRaces,
    stageGameDays: stageRaces.reduce((s, r) => s + r.stages, 0),
    totalGameDays: total, quotaHit: total === quota, shortfall: Math.max(0, quota - total),
  };
}
