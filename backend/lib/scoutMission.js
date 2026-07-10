// Talentspejder Fase 3 (#2244) — mission-shortlist-generator. RENE funktioner,
// ingen I/O (candidate-listen leveres af kalderen, typisk scoutSweep.js).
//
// Udvælgelse: kandidat-pool fra mission_criteria (division/land/U23/NM) →
// score = ægte potentiale-rang BLANDET med spejder-bias (seededUnit-mønster fra
// scouting.js), så shortlist-MEDLEMSKAB skævvrides mod bedre spejdere men
// output-RÆKKEFØLGEN shuffles deterministisk med en seed der er uafhængig af
// potentiale — det er selve inversions-gaten (#1162): position i shortlisten
// må ikke afsløre potentiale-rangering, heller ikke statistisk over mange missioner.
//
// reach (spejder-roleSkill) → større pool-dækning (flere kandidater i betragtning).
// evaluation (spejder-roleSkill) → mindre bias-vægt (bedre spejder finder de
// rigtige emner oftere, men afslører det aldrig via rækkefølgen).
import { DEFAULT_SCOUT, SCOUT_JOB_CONFIG } from "./scoutEngine.js";
import { seededUnit } from "./scouting.js";

const REACH_FLOOR = 40;
const REACH_CEIL = 99;
const COVERAGE_FLOOR = 0.3;
const COVERAGE_CEIL = 1.0;

const EVAL_FLOOR = 40;
const EVAL_CEIL = 99;
const BIAS_WEIGHT_FLOOR = 0.15; // topspejder — stadig ALDRIG 0 (ingen når 100%, spec beslutning 3)
const BIAS_WEIGHT_CEIL = 0.6;   // default-spejder (overall 40)

// Andel af den filtrerede kandidat-pool spejderen dækker, før scoring. Bedre
// reach → større dækning (lineær 40→0.3, 99→1.0).
export function poolCoverageFraction(reach) {
  const r = Math.max(REACH_FLOOR, Math.min(REACH_CEIL, Number(reach) || REACH_FLOOR));
  const t = (r - REACH_FLOOR) / (REACH_CEIL - REACH_FLOOR);
  return COVERAGE_FLOOR + t * (COVERAGE_CEIL - COVERAGE_FLOOR);
}

// Hvor stor en del af scoringen der er ren spejder-bias (vs. ægte potentiale-rang).
// Bedre evaluation → mindre bias-vægt (lineær 40→0.6, 99→0.15).
export function biasWeightFor(evaluation) {
  const e = Math.max(EVAL_FLOOR, Math.min(EVAL_CEIL, Number(evaluation) || EVAL_FLOOR));
  const t = (e - EVAL_FLOOR) / (EVAL_CEIL - EVAL_FLOOR);
  return BIAS_WEIGHT_CEIL - t * (BIAS_WEIGHT_CEIL - BIAS_WEIGHT_FLOOR);
}

// Kandidat-pool for en mission ud fra mission_criteria. rider-form: forventer
// { id, potentiale, divisionId, country, age, isNmEligible } — kalderen mapper
// den rå DB-række til denne form.
export function filterCandidatePool(riders, criteria) {
  if (!criteria || !Array.isArray(riders)) return [];
  const { scope, value } = criteria;
  return riders.filter((r) => {
    if (scope === "division") return r.divisionId === value;
    if (scope === "country") return r.country === value;
    if (scope === "u23") return r.age != null && r.age <= 23;
    if (scope === "nm") return r.country === value && r.isNmEligible !== false;
    return false;
  });
}

// Fisher-Yates m. seedet RNG (deterministisk pr. seedKey) — bruges til at
// shuffle SHORTLISTENS visningsrækkefølge (uafhængigt af scoring/rang).
function deterministicShuffle(items, seedKey) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const r = seededUnit(`${seedKey}:${i}`);
    const j = Math.floor(r * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Genererer shortlist (3-5 navne) + top-fund for én mission.
//   candidates : fuld rytter-pool (allerede indlæst af kalderen), form { id, potentiale, ... }
//   criteria   : mission_criteria fra scout_assignments-rækken
//   scout      : spejder-objekt (#2244) — reach/evaluation driver dækning/bias
//   teamId     : holdets id (seed-komponent — per-team varians)
//   missionId  : assignment-id (seed-komponent — unik pr. mission)
// Returnerer { shortlist: [rider_id,...], topRiderId } (topRiderId = bedste SCORE,
// ikke shufflet position — det er target for den gratis niveau-1-rapport).
export function generateShortlist({ candidates, criteria, scout = DEFAULT_SCOUT, teamId, missionId }) {
  const pool = filterCandidatePool(candidates, criteria);
  if (pool.length === 0) return { shortlist: [], topRiderId: null };

  // Ægte rang (0 = bedst potentiale) — bruges KUN til scoring-vægtning, aldrig
  // til visningsrækkefølgen.
  const ranked = [...pool].sort((a, b) => b.potentiale - a.potentiale);
  const maxRankIdx = Math.max(1, ranked.length - 1);
  const rankIndexById = new Map(ranked.map((r, i) => [r.id, i]));

  const reach = scout?.roleSkills?.reach ?? DEFAULT_SCOUT.roleSkills.reach;
  const coverage = poolCoverageFraction(reach);
  const coveredCount = Math.max(
    SCOUT_JOB_CONFIG.mission.shortlistMin,
    Math.min(ranked.length, Math.ceil(ranked.length * coverage))
  );
  const covered = ranked.slice(0, coveredCount);

  const evaluation = scout?.roleSkills?.evaluation ?? DEFAULT_SCOUT.roleSkills.evaluation;
  const biasWeight = biasWeightFor(evaluation);

  const scored = covered.map((rider) => {
    const trueScore = 1 - rankIndexById.get(rider.id) / maxRankIdx; // 1=bedst..0=svagest
    const bias = seededUnit(`scout-mission-bias:${missionId}:${teamId}:${rider.id}`);
    const score = trueScore * (1 - biasWeight) + bias * biasWeight;
    return { rider, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const n = Math.max(
    SCOUT_JOB_CONFIG.mission.shortlistMin,
    Math.min(SCOUT_JOB_CONFIG.mission.shortlistMax, scored.length)
  );
  const top = scored.slice(0, n).map((s) => s.rider);
  const topRiderId = top[0]?.id ?? null;

  // Shuffle-seeden er UAFHÆNGIG af potentiale/bias-scoren — kun mission+team+id.
  const shuffled = deterministicShuffle(top, `scout-mission-order:${missionId}:${teamId}`);

  return { shortlist: shuffled.map((r) => r.id), topRiderId };
}
