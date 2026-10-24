// #6804 v3 (G16/G18): point- og bjergtroejens vinder pr. seed i tour-gennemtesten.
//
// Samme akkumulering som raceRunner (in-memory, hele loebet): naar etapen har
// passager (rutedata), taeller passagernes sprint_points/kom_points; ellers den
// generiske classPointsForRank (bjergpoint kun paa CLIMB_PROFILES). Vinderen er
// nr. 1 i rankByCompDesc blandt dem der fuldfoerte loebet, og kun hvis han har
// point (som jerseyLeadersFromComps: en konkurrence uden point har ingen vinder).
//
// REN: ingen IO, ingen motor. Repoet er offentligt (hard rule 17): her staar
// ingen maalte tal.
import { CLIMB_PROFILES, classPointsForRank, rankByCompDesc } from "../../../lib/raceClassifications.js";

const add = (m, k, v) => m.set(k, (m.get(k) ?? 0) + (Number(v) || 0));

/**
 * Taeller til ét seed. `addStage({profile, ranked, passages})` pr. etape
 * (`passages` = broens {perRider} eller null), `winners(finishers)` til sidst.
 */
export function createJerseyTally() {
  const points = new Map();
  const kom = new Map();
  return {
    addStage({ profile, ranked = [], passages = null }) {
      const perRider = passages?.perRider ?? null;
      for (const r of ranked) {
        const agg = perRider ? perRider.get(r.rider_id) : null;
        if (perRider) {
          add(points, r.rider_id, agg?.sprint_points);
          add(kom, r.rider_id, agg?.kom_points);
        } else {
          add(points, r.rider_id, classPointsForRank(r.rank));
          if (CLIMB_PROFILES.has(profile?.profile_type)) add(kom, r.rider_id, classPointsForRank(r.rank));
        }
      }
    },
    /** {pointsWinner, komWinner} blandt `finishers` ([{rider_id}]); null uden point. */
    winners(finishers = []) {
      const top = (comp) => {
        const first = rankByCompDesc(finishers, comp)[0];
        return first && first.score > 0 ? first.rider_id : null;
      };
      return { pointsWinner: top(points), komWinner: top(kom) };
    },
  };
}
