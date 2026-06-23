// backend/lib/raceEntryGenerator.js
// Race Hub Fase 0b: proaktiv entry-generator. Kerne = kronologisk binding-bevidst
// tildeling: ét holds ryttere fordeles over puljens løb, så ingen rytter er i to
// tidsoverlappende løb. Deterministisk (autopick er deterministisk; løb sorteres
// stabilt på vindue-start, så race_id). Pure — ingen DB.

import { autopickTeamSelection } from "./raceAutopick.js";
import { windowsOverlap } from "./raceBinding.js";

/**
 * @param {{ riders: Array<{rider_id, abilities, fatigue?}>,
 *           races: Array<{race_id, window:{start,end}, stages, sizeRule}> }} args
 * @returns {Record<string, Array<{rider_id, race_role}>>} entries pr. race_id
 */
export function assignTeamAcrossRaces({ riders = [], races = [] }) {
  // Kronologisk, stabil rækkefølge: tidligste vindue først, så race_id.
  const ordered = [...races].sort(
    (a, b) => (a.window?.start ?? 0) - (b.window?.start ?? 0) || String(a.race_id).localeCompare(String(b.race_id))
  );
  // Optaget-liste pr. rytter: array af vinduer rytteren allerede er bundet i.
  const busy = new Map(); // rider_id → [{start,end}]
  const out = {};

  for (const race of ordered) {
    const available = riders.filter((r) => {
      const windows = busy.get(r.rider_id) || [];
      return !windows.some((w) => windowsOverlap(w, race.window));
    });
    const picks = autopickTeamSelection({ riders: available, stages: race.stages, sizeRule: race.sizeRule });
    out[race.race_id] = picks;
    for (const p of picks) {
      if (!busy.has(p.rider_id)) busy.set(p.rider_id, []);
      busy.get(p.rider_id).push(race.window);
    }
  }
  return out;
}
