// backend/scripts/lib/headToHeadObservers.js
// Race Engine v4 F2 (#4030): pr.-etape observations-helpers til
// headToHeadV4.js's fulde scorecard (mor-spec §5-ankre).
//
// v3-siden af dominans/samme-hold-top-10-ankrene GENBRUGER
// backend/lib/raceDominanceMetrics.js's observeRace()/aggregateObservations()
// direkte (v3's `components.terrain` ER allerede en pr.-etape evne-fit-score —
// present formaal). Denne fil leverer den ANALOGE v4-observation, konstrueret
// saa den passer PRAECIS observeRace()'s output-kontrakt (samme feltnavne),
// saa v4-observationer kan fodres ind i den SAMME aggregateObservations()
// uden nogen duplikeret aggregerings-logik.
//
// v4-"favorit" (analog til v3's hoejeste components.terrain i HELE feltet):
// hoejeste computeFinaleAbilityScore() (genbrugt fra backend/lib/engine/v4/
// finale.ts — kun IMPORTERET, IKKE aendret, jf. worker-reglen om ikke at
// røre andre workers' engine-filer) mod etapens demandVectorByFinaleType,
// med en NEUTRAL W'-reserve-antagelse (0.5) — favoritten er "hvem BURDE denne
// etape favorisere givet deres evner", ikke "hvem endte med mest reserve
// tilbage" (det sidste ville laekke selve loebs-udfaldet ind i favorit-
// definitionen og goere favoriteWon tautologisk).
//
// REN nok til at vaere let at teste: ingen IO, ingen simulator-kald her — kun
// transformation af allerede-simulerede results/entrants til observations.

import { computeFinaleAbilityScore } from "../../lib/engine/v4/finale.ts";
import { FINALE_EXTRA_TUNING } from "../../lib/engine/v4/tuning.ts";

// Speejler finale.ts's DEFAULT_DEMAND_VECTOR (ikke selv eksporteret derfra) —
// bevidst 1:1-kopi, samme "duplikering er etableret moenster"-begrundelse som
// engine-modulernes egne header-kommentarer (rng.ts/types.ts).
const FALLBACK_DEMAND_VECTOR = { tempo: 0.3, endurance: 0.3, tactics: 0.2, positioning: 0.2 };

const NEUTRAL_WPRIME_RESERVE_FRACTION = 0.5;

/**
 * v4-analog til raceDominanceMetrics.observeRace() — SAMME output-kontrakt
 * (favoriteWon/favoritePodium/maxSameTeamTop10/distinctTeamsTop10/terrain/
 * raceId/fieldSize/winnerId/favoriteId/favoriteRank), saa v4-observationer kan
 * aggregeres med den ueaendrede aggregateObservations().
 *
 * @param {object} args
 * @param {Array<{rider_id:string, rank:number, time_seconds:number, group_id:string, status:string}>} args.results  v4 StageOutput.results
 * @param {Record<string, {abilities: Record<string, number>}>} args.entrants  rider_id -> Entrant (kun .abilities laeses)
 * @param {Map<string, string|null>} args.teamByRider
 * @param {{finale_type: string|null}} args.route
 * @param {{finale: {demandVectorByFinaleType: Record<string, Record<string, number>>}}} args.tuning
 * @param {string|null} [args.raceId]
 * @param {string} [args.terrain]  profile_type, videreført uændret (samme rolle som v3's terrain-felt)
 * @returns {ReturnType<typeof import("../../lib/raceDominanceMetrics.js").observeRace>}
 */
export function observeStageV4({ results = [], entrants = {}, teamByRider, route, tuning, raceId, terrain } = {}) {
  const fieldSize = results.length;

  if (fieldSize === 0) {
    return {
      terrain,
      raceId,
      fieldSize: 0,
      winnerId: null,
      favoriteId: null,
      favoriteRank: null,
      favoriteWon: false,
      favoritePodium: false,
      maxSameTeamTop10: 0,
      distinctTeamsTop10: 0,
    };
  }

  const sorted = [...results].sort((a, b) => a.rank - b.rank);
  const winner = sorted[0];

  const demandVector =
    (route?.finale_type && tuning?.finale?.demandVectorByFinaleType?.[route.finale_type]) || FALLBACK_DEMAND_VECTOR;
  const wprimeReserveWeight = FINALE_EXTRA_TUNING.wprimeReserveWeight;

  let favorite = null;
  let favoriteScore = -Infinity;
  for (const r of sorted) {
    const abilities = entrants[r.rider_id]?.abilities;
    if (!abilities) continue;
    const score = computeFinaleAbilityScore(abilities, NEUTRAL_WPRIME_RESERVE_FRACTION, demandVector, wprimeReserveWeight);
    if (
      score > favoriteScore ||
      (score === favoriteScore && favorite && String(r.rider_id) < String(favorite.rider_id))
    ) {
      favorite = r;
      favoriteScore = score;
    }
  }

  const teamOf = (r) => {
    const t = teamByRider ? teamByRider.get(r.rider_id) : undefined;
    return t ?? null;
  };

  const top10 = sorted.slice(0, 10);
  const teamCounts = new Map();
  for (const r of top10) {
    const team = teamOf(r);
    const key = team === null ? `__solo__:${r.rider_id}` : team;
    teamCounts.set(key, (teamCounts.get(key) || 0) + 1);
  }
  const maxSameTeamTop10 = teamCounts.size ? Math.max(...teamCounts.values()) : 0;
  const distinctTeamsTop10 = teamCounts.size;

  return {
    terrain,
    raceId,
    fieldSize,
    winnerId: winner ? winner.rider_id : null,
    favoriteId: favorite ? favorite.rider_id : null,
    favoriteRank: favorite ? favorite.rank : null,
    favoriteWon: !!(favorite && winner && favorite.rider_id === winner.rider_id),
    favoritePodium: !!(favorite && favorite.rank <= 3),
    maxSameTeamTop10,
    distinctTeamsTop10,
  };
}

/**
 * Andelen af feltet der deler vindertiden (felt-sammenhaeng-ankeret, mor-spec
 * §5: "80-95% af feltet paa vinderens tid"). `times` er RELATIVE (v3 stageGap,
 * hvor vinderen altid er 0) eller ABSOLUTTE (v4 time_seconds) — begge dele
 * virker, fordi kun (t === min) tælles, aldrig den absolutte vaerdi af min selv.
 * @param {number[]} times
 * @returns {number|null}
 */
export function cohesionFraction(times) {
  if (!times || times.length === 0) return null;
  const min = Math.min(...times);
  const count = times.filter((t) => t === min).length;
  return count / times.length;
}

/**
 * Antal ryttere der deler vindertiden (bruges som "solo/breakaway-vs-gruppe"-
 * proxy: 1 = solo/udbrudssejr, >1 = gruppeopgoer/spurt). Samme grundberegning
 * som cohesionFraction, blot talvaerdien i stedet for andelen.
 * @param {number[]} times
 * @returns {number|null}
 */
export function winnerGroupSize(times) {
  if (!times || times.length === 0) return null;
  const min = Math.min(...times);
  return times.filter((t) => t === min).length;
}

/**
 * Tidsspaend fra vinderen til n'te placering (default top 10) — bruges til
 * nedkoersels-/summit-gap-ratio-ankeret (#3426/#2415). `times` som i
 * cohesionFraction (relative ELLER absolutte, begge giver samme spaend, fordi
 * spaend = value(rank n) - value(rank 1)).
 * @param {number[]} times
 * @param {number} [n=10]
 * @returns {number|null}
 */
export function spreadAtRank(times, n = 10) {
  if (!times || times.length === 0) return null;
  const sorted = [...times].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, n - 1);
  return sorted[idx] - sorted[0];
}

/**
 * Scanner en v4-tidslinje for descent-attack-events (M3) og opsummerer
 * gevinst-sekunderne — bruges til at verificere det haardt-kravede 10-20s-loft
 * (mor-spec §4 M3 / beslutning 6) EMPIRISK over hele koerslen, ikke kun via
 * enheds-tests af computeAttackGainSeconds().
 * @param {Array<{type:string, params: Record<string, unknown>}>} events
 * @returns {{count: number, min: number|null, max: number|null}}
 */
export function descentAttackGainStats(events) {
  const gains = [];
  for (const ev of events || []) {
    if (ev.type !== "finale_attack") continue;
    if (ev.params?.direction !== "descent") continue;
    const g = Number(ev.params?.gained_seconds);
    if (Number.isFinite(g)) gains.push(g);
  }
  if (gains.length === 0) return { count: 0, min: null, max: null };
  return { count: gains.length, min: Math.min(...gains), max: Math.max(...gains) };
}
