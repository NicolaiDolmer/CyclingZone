// backend/lib/raceAutopick.js
// #1307: assistent-autopick — fornuftigt 6-8-rytter-hold + kaptajn når manageren
// ikke selv har udtaget. Ren funktion (ingen DB); raceRunner kalder med beriget data.
// Egnethed = gennemsnitlig terrain-score over løbets etapeprofiler, let dæmpet af
// træthed (assistenten skåner smadrede ryttere). Deterministisk (stabil tiebreak).

import { terrainScore } from "./raceSimulator.js";

// Spec 8.1 + race-hub Fase 0a: startfelt-størrelse pr. kategori — 8 (Grand Tours),
// 7 (WorldTour-niveau), 6 (øvrige). Nøgler = race_class-værdier (database/2026-05-09-race-pool.sql).
// KALIBRERBAR: de præcise klasse→antal bekræftes i simulér-før-ship (Fase 0c).
// default = generøs fallback (6-8) for løb uden kendt race_class (legacy/test); de
// rigtige sæson-løb har altid en klasse, så fallbacken rammer kun edge-tilfælde.
export const SELECTION_SIZE = Object.freeze({
  default:         Object.freeze({ min: 6, max: 8 }),
  Class2:          Object.freeze({ min: 6, max: 6 }),
  Class1:          Object.freeze({ min: 6, max: 6 }),
  ProSeries:       Object.freeze({ min: 6, max: 6 }),
  OtherWorldTourC: Object.freeze({ min: 7, max: 7 }),
  OtherWorldTourB: Object.freeze({ min: 7, max: 7 }),
  OtherWorldTourA: Object.freeze({ min: 7, max: 7 }),
  Monuments:       Object.freeze({ min: 7, max: 7 }),
  GiroVuelta:      Object.freeze({ min: 8, max: 8 }),
  TourFrance:      Object.freeze({ min: 8, max: 8 }),
});

export function selectionSizeForRace(race) {
  return SELECTION_SIZE[race?.race_class] || SELECTION_SIZE.default;
}

const AUTOPICK_FATIGUE_DAMPING = 0.3; // træthed 100 → egnethed × 0.7

export function suitabilityScore(abilities, stages) {
  if (!stages?.length) return 0;
  let sum = 0;
  for (const s of stages) sum += terrainScore(abilities, s.demand_vector || {});
  return sum / stages.length;
}

// Flade etaper (sprint-stages) bruges ikke til GC-captain-udvælgelse.
// Captain = bedst på non-sprint etaper (bjerg/TT/etc.); sprint_captain = bedste
// sprinter på flat stages der ikke allerede er captain.
const FLAT_PROFILES = new Set(["flat"]);

function gcStages(stages) {
  const nonFlat = stages.filter((s) => !FLAT_PROFILES.has(s.profile_type));
  return nonFlat.length ? nonFlat : stages; // fallback: brug alle hvis kun flade
}

/**
 * @param {{riders:Array<{rider_id:string, abilities:object, fatigue?:number}>, stages:Array, sizeRule:{min:number,max:number}}} args
 * @returns {Array<{rider_id:string, race_role:string}>} tom hvis ingen ryttere.
 */
export function autopickTeamSelection({ riders = [], stages = [], sizeRule, preference = null }) {
  const rule = sizeRule || SELECTION_SIZE.default;

  // Samlet egnethed (alle etaper) bruges til holdudvælgelsen.
  const scored = riders
    .filter((r) => r?.rider_id && r.abilities)
    .map((r) => {
      const raw = Number(r.fatigue);
      const clampedFatigue = Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) / 100 : 0;
      const freshness = 1 - clampedFatigue * AUTOPICK_FATIGUE_DAMPING;
      return { rider_id: r.rider_id, abilities: r.abilities, score: suitabilityScore(r.abilities, stages) * freshness };
    })
    .sort((a, b) => b.score - a.score || String(a.rider_id).localeCompare(String(b.rider_id)));

  // S3 præference-lag (Fork A): ved MÅL-LØB sorteres A-kæden FØRST (rang→score→rider_id),
  // så managerens kerne-ryttere garanteres pladser dér. preference==null ELLER ikke-mål-løb
  // ELLER tom A-kæde → uændret score-rækkefølge (idempotens: byte-identisk gammel adfærd).
  let ordered = scored;
  if (preference?.isTargetRace && preference.aChain?.length) {
    const rank = new Map(preference.aChain.map((id, i) => [id, i]));
    ordered = [...scored].sort((a, b) => {
      const ra = rank.has(a.rider_id) ? rank.get(a.rider_id) : Infinity;
      const rb = rank.has(b.rider_id) ? rank.get(b.rider_id) : Infinity;
      if (ra !== rb) return ra - rb;
      return b.score - a.score || String(a.rider_id).localeCompare(String(b.rider_id));
    });
  }

  const picked = ordered.slice(0, Math.min(rule.max, ordered.length));
  if (!picked.length) return [];
  const pickedIds = new Set(picked.map((p) => p.rider_id));

  const captainId = resolveCaptain({ picked, pickedIds, stages, preference });
  const sprintCaptainId = resolveSprintCaptain({ picked, pickedIds, stages, captainId, preference });

  return picked.map((p) => ({
    rider_id: p.rider_id,
    race_role: p.rider_id === captainId ? "captain"
      : p.rider_id === sprintCaptainId ? "sprint_captain"
      : "helper",
  }));
}

// A-kæde-rang som tiebreak blandt lige kandidater (lavere index = højere prioritet).
function aChainRank(id, preference) {
  const i = preference?.aChain?.indexOf(id);
  return i == null || i < 0 ? Infinity : i;
}

// Kaptajn-præcedens (L6): fast regel (always_captain) > terræn-prioritet (captains-liste)
// > GC-fallback (bedst på non-flat etaper). preference==null → kun GC-fallback (uændret).
function resolveCaptain({ picked, pickedIds, stages, preference }) {
  if (preference) {
    const forced = picked
      .filter((p) => preference.roleRules?.[p.rider_id] === "always_captain")
      .sort((a, b) => aChainRank(a.rider_id, preference) - aChainRank(b.rider_id, preference)
        || String(a.rider_id).localeCompare(String(b.rider_id)));
    if (forced.length) return forced[0].rider_id;
    for (const id of preference.captains || []) if (pickedIds.has(id)) return id;
  }
  const gcStagesToUse = gcStages(stages);
  return [...picked].sort((a, b) =>
    suitabilityScore(b.abilities, gcStagesToUse) - suitabilityScore(a.abilities, gcStagesToUse) ||
    String(a.rider_id).localeCompare(String(b.rider_id))
  )[0].rider_id;
}

// Sprint-kaptajn: fast regel (always_sprint_captain_if_present, ikke == kaptajn) >
// feltets bedste sprinter på flade etaper (ikke == kaptajn). preference==null → kun fallback.
function resolveSprintCaptain({ picked, pickedIds, stages, captainId, preference }) {
  if (preference) {
    const forced = picked
      .filter((p) => p.rider_id !== captainId
        && preference.roleRules?.[p.rider_id] === "always_sprint_captain_if_present")
      .sort((a, b) => aChainRank(a.rider_id, preference) - aChainRank(b.rider_id, preference)
        || String(a.rider_id).localeCompare(String(b.rider_id)));
    if (forced.length) return forced[0].rider_id;
  }
  if (stages.some((s) => FLAT_PROFILES.has(s.profile_type)) && picked.length > 1) {
    const bestSprint = [...picked].sort((a, b) =>
      (Number(b.abilities?.sprint) || 0) - (Number(a.abilities?.sprint) || 0) ||
      String(a.rider_id).localeCompare(String(b.rider_id))
    )[0];
    if (bestSprint.rider_id !== captainId) return bestSprint.rider_id;
  }
  return null;
}
