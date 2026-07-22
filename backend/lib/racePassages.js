// backend/lib/racePassages.js
// Sub-2 (#2770): passage-lag — ren efterbehandling af simulateStage-output.
// Dedikerede rng-strømme (stableSeed-afledte) → motorens main-rng/noise-sekvens
// er bit-identisk. Ingen DB, ingen Math.random/Date.
import { makeRng, gaussian } from "./fictionalRiderGenerator.js";
import { stableSeed, deriveBreakawayStatus } from "./raceSimulator.js";

// Ejer-låste Tour-skalaer (spec §4, 22/7) — tunes ALDRIG mod scorecard.
export const GREEN_FINISH_SCALES = Object.freeze({
  flat:          Object.freeze([50, 30, 20, 18, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2]),
  cobbles:       Object.freeze([50, 30, 20, 18, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2]),
  rolling:       Object.freeze([30, 25, 22, 19, 17, 15, 13, 11, 9, 7, 6, 5, 4, 3, 2]),
  hilly:         Object.freeze([30, 25, 22, 19, 17, 15, 13, 11, 9, 7, 6, 5, 4, 3, 2]),
  classic:       Object.freeze([30, 25, 22, 19, 17, 15, 13, 11, 9, 7, 6, 5, 4, 3, 2]),
  mountain:      Object.freeze([20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]),
  high_mountain: Object.freeze([20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]),
  itt:           Object.freeze([20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]),
  ttt:           Object.freeze([20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]),
});
export const INTERMEDIATE_SPRINT_SCALE = Object.freeze([20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
export const KOM_SCALES = Object.freeze({
  HC:  Object.freeze([20, 15, 12, 10, 8, 6, 4, 2]),
  "1": Object.freeze([10, 8, 6, 4, 2, 1]),
  "2": Object.freeze([5, 3, 2, 1]),
  "3": Object.freeze([2, 1]),
  "4": Object.freeze([1]),
});
export const FINISH_BONUS_SECONDS = Object.freeze([10, 6, 4]);
export const INTERMEDIATE_BONUS_SECONDS = Object.freeze([3, 2, 1]);
// Tunbare (scorecard, Task 8):
export const SPRINT_CAPTAIN_CONTEST_MULTIPLIER = 1.15;
export const WAYPOINT_NOISE_SD = 0.03;
export const CATCH_KM_RANGE = Object.freeze([0.55, 0.92]); // andel af distance

const KOM_BLEND_BIG = { climbing: 0.75, endurance: 0.25 };            // HC/1/2
const KOM_BLEND_SMALL = { climbing: 0.5, punch: 0.35, acceleration: 0.15 }; // 3/4
const SPRINT_BLEND = { sprint: 0.6, acceleration: 0.25, positioning: 0.15 };

function blendScore(abilities, blend) {
  let s = 0;
  for (const [k, w] of Object.entries(blend)) s += ((Number(abilities?.[k]) || 0) / 99) * w;
  return s;
}
function scaleFor(kind, climbCategory, profileType, summitFinish) {
  if (kind === "kom") {
    const base = KOM_SCALES[climbCategory] || [];
    if (summitFinish && (climbCategory === "HC" || climbCategory === "1")) return base.map((p) => p * 2);
    return base;
  }
  if (kind === "sprint") return INTERMEDIATE_SPRINT_SCALE;
  return GREEN_FINISH_SCALES[profileType] || GREEN_FINISH_SCALES.mountain;
}

export function computePassages({ ranked = [], stageProfile = {}, entrants = [], seed, isStageRace }) {
  const empty = { passages: [], perRider: new Map() };
  if (!isStageRace || !ranked.length) return empty;
  const climbs = Array.isArray(stageProfile.climbs) ? stageProfile.climbs : [];
  const sprints = Array.isArray(stageProfile.sprints) ? stageProfile.sprints : [];
  // Data-gating (#2784): distance_km SKAL læses gennem en null-guard. `Number(null)`
  // er 0 — et endeligt tal — så den oprindelige `!Number.isFinite(Number(x))`-gate
  // lækkede for legacy-rækker med distance_km NULL (hele sæson 1): etapen slap
  // igennem uden ruteindhold og fik et fantom-"finish"-waypoint ved km 0, der
  // uddelte grøn-point på Tour-skalaen + 10/6/4 bonussekunder midt i en aktiv
  // sæson. Positiv distance kræves nu eksplicit; en etape uden BÅDE distance,
  // stigninger og sprints er legacy og skal returnere tomt.
  const rawDistance = stageProfile.distance_km;
  const distance = rawDistance == null ? NaN : Number(rawDistance);
  const hasDistance = Number.isFinite(distance) && distance > 0;
  if (!hasDistance && climbs.length === 0 && sprints.length === 0) return empty;

  const abilitiesById = new Map(entrants.map((e) => [e.rider_id, e.abilities || {}]));
  const roleById = new Map(entrants.map((e) => [e.rider_id, e.race_role || null]));
  const bwStatus = deriveBreakawayStatus(ranked);

  // Catch-punkt: dedikeret strøm — indhentede escapees er i front FØR dette km.
  const catchRng = makeRng(stableSeed(`${seed}:catch`));
  const dist = hasDistance ? distance : 200;
  const catchKm = dist * (CATCH_KM_RANGE[0] + (CATCH_KM_RANGE[1] - CATCH_KM_RANGE[0]) * catchRng());

  const inFront = (riderId, km) => {
    const st = bwStatus.get(riderId);
    if (!st?.in_breakaway) return false;
    return st.breakaway_caught ? km < catchKm : true;
  };

  // Waypoint-liste: climbs (kom) + intermediate sprints, sorteret på km; mål til sidst.
  const waypoints = [
    ...climbs.map((c, i) => ({ kind: "kom", index: i, name: c.name, km: c.crest_km, category: c.category, summit_finish: !!c.summit_finish })),
    ...sprints.filter((s) => s.kind === "intermediate").map((s, i) => ({ kind: "sprint", index: i, name: s.name, km: s.km })),
  ].sort((a, b) => a.km - b.km || (a.kind === "kom" ? -1 : 1));
  waypoints.push({ kind: "finish", index: 0, name: "Finish", km: dist });

  const passages = [];
  const perRider = new Map();
  const bump = (riderId, field, v) => {
    if (!v) return;
    if (!perRider.has(riderId)) perRider.set(riderId, { kom_points: 0, sprint_points: 0, bonus_seconds: 0 });
    perRider.get(riderId)[field] += v;
  };

  for (const wp of waypoints) {
    const scale = scaleFor(wp.kind, wp.category, stageProfile.profile_type, wp.summit_finish);
    if (!scale.length) continue;
    let order;
    if (wp.kind === "finish" || wp.summit_finish) {
      // Målorden ER motorens rangering (summit-finish: toppen = stregen).
      order = [...ranked].sort((a, b) => a.rank - b.rank).map((r) => r.rider_id);
    } else {
      const rng = makeRng(stableSeed(`${seed}:wp:${wp.kind}:${wp.index}`));
      const blend = wp.kind === "kom"
        ? (wp.category === "3" || wp.category === "4" ? KOM_BLEND_SMALL : KOM_BLEND_BIG)
        : SPRINT_BLEND;
      // Stabil rider_id-orden for rng-forbrug → determinisme uafhængig af input-orden.
      const scored = [...ranked]
        .sort((a, b) => String(a.rider_id).localeCompare(String(b.rider_id)))
        .map((r) => {
          let s = blendScore(abilitiesById.get(r.rider_id), blend) + gaussian(rng, 0, WAYPOINT_NOISE_SD);
          if (wp.kind === "sprint" && roleById.get(r.rider_id) === "sprint_captain") s *= SPRINT_CAPTAIN_CONTEST_MULTIPLIER;
          return { rider_id: r.rider_id, s, front: inFront(r.rider_id, wp.km) ? 1 : 0 };
        });
      scored.sort((a, b) => b.front - a.front || b.s - a.s || String(a.rider_id).localeCompare(String(b.rider_id)));
      order = scored.map((x) => x.rider_id);
    }
    const results = [];
    for (let i = 0; i < order.length && i < Math.max(scale.length, 3); i++) {
      const points = scale[i] || 0;
      let bonus = 0;
      if (wp.kind === "sprint") bonus = INTERMEDIATE_BONUS_SECONDS[i] || 0;
      if (wp.kind === "finish" && stageProfile.profile_type !== "itt" && stageProfile.profile_type !== "ttt") {
        bonus = FINISH_BONUS_SECONDS[i] || 0;
      }
      if (!points && !bonus) continue;
      results.push({ rider_id: order[i], passage_rank: i + 1, points, bonus_seconds: bonus });
      bump(order[i], wp.kind === "kom" ? "kom_points" : "sprint_points", points);
      bump(order[i], "bonus_seconds", bonus);
    }
    passages.push({ kind: wp.kind, index: wp.index, name: wp.name, km: wp.km, category: wp.category ?? null, results });
  }
  return { passages, perRider };
}

// NB (summit-finish + kom_points): summit-finish-waypointet er et `kom`-waypoint
// (dobbelt point via `scaleFor`) — mål-waypointet (`finish`) giver grøn-point
// separat. Begge kører målordenen.
