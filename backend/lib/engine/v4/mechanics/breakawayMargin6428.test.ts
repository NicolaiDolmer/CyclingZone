// backend/lib/engine/v4/mechanics/breakawayMargin6428.test.ts
// #6428 (ren revision spor 1): et kuperet endagsloeb med et passivt felt (kun
// menneskehold, ingen ordrer) gav under official_times_v2 udbrudssejre med nr. 10
// 9-16 min efter vinderen. Under official_times_v3 skal udbrudssejrens margin
// ligge i ankertabellens baand (headToHeadAnchors.ANCHOR_BANDS
// .breakawayWinMarginOneDaySeconds). Udbruddet maa stadig vinde.
//
// Ruten genskaber moenstret fra GP Criquielion (kuperet, finale "breakaway",
// to stigninger, den sidste 15 km foer maal) som en syntetisk profil; feltet er
// syntetisk (ingen rigtige ryttere eller hold). Koeres gennem broen som i prod.
import test from "node:test";
import assert from "node:assert/strict";
import { __resetRaceEngineV4Cache, loadRaceEngineV4 } from "../../../raceEngineV4Bridge.js";
import { breakawayWin, gapAtRank } from "../../../../scripts/dev/lib/tourScorecard.mjs";
import { ANCHOR_BANDS } from "../../../../scripts/lib/headToHeadAnchors.js";

const ABILITY_KEYS = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
] as const;
const ROLES = ["captain", "helper", "helper", "helper", "helper", "hunter"] as const;

/** 15 menneskehold a 6 ryttere, ingen ordrer: et passivt felt. Deterministisk. */
export function passiveOneDayField() {
  const out: Array<{ rider_id: string; team_id: string; team_is_ai: boolean; race_role: string; effort: string; abilities: Record<string, number> }> = [];
  for (let team = 0; team < 15; team++) {
    for (let r = 0; r < ROLES.length; r++) {
      const i = team * ROLES.length + r;
      const abilities: Record<string, number> = {};
      ABILITY_KEYS.forEach((key, k) => { abilities[key] = 25 + ((i * 37 + k * 23 + team * 11) % 60); });
      out.push({ rider_id: `p${String(i).padStart(3, "0")}`, team_id: `H${team}`, team_is_ai: false, race_role: ROLES[r], effort: "normal", abilities });
    }
  }
  return out;
}

export const HILLY_ONE_DAY_PROFILE = Object.freeze({
  stage_number: 1,
  profile_type: "hilly",
  finale_type: "breakaway",
  distance_km: 185,
  elevation_gain_m: 1303,
  climbs: [
    { name: "A", category: "3", crest_km: 97, length_km: 3.2, avg_gradient: 5.3, summit_finish: false },
    { name: "B", category: "2", crest_km: 170, length_km: 6.1, avg_gradient: 7.1, summit_finish: false },
  ],
  sprints: [{ km: 185, kind: "finish", name: "Finish" }],
  sectors: [],
  segments: [
    { kind: "rolling", from_km: 0, to_km: 93.8 },
    { kind: "climb", from_km: 93.8, to_km: 97, category: "3", avg_gradient: 5.3, top_elevation_m: 420 },
    { kind: "descent", from_km: 97, to_km: 98.9, technicality: 2 },
    { kind: "rolling", from_km: 98.9, to_km: 163.9 },
    { kind: "climb", from_km: 163.9, to_km: 170, category: "2", avg_gradient: 7.1, top_elevation_m: 853 },
    { kind: "descent", from_km: 170, to_km: 175.6, technicality: 2 },
    { kind: "rolling", from_km: 175.6, to_km: 185 },
  ],
  weather: { kind: "sun", wind_exposure: 0.4 },
});

export async function runPassiveOneDay(revision: string, seeds: number) {
  __resetRaceEngineV4Cache();
  const v4 = await loadRaceEngineV4();
  const entrants = passiveOneDayField();
  const rows: Array<{ seed: number; won: boolean; nr10: number | null }> = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const res = v4.simulateStage({
      entrants, stageProfile: HILLY_ONE_DAY_PROFILE, seedString: `r6428:1:s${seed}`, stageNumber: 1,
      teamOrderRows: [], isStageRace: false, raceStages: [HILLY_ONE_DAY_PROFILE], squad: null,
      rulesRevision: revision, gcStandings: null,
    });
    rows.push({ seed, won: breakawayWin(res.v4Output).won, nr10: gapAtRank(res.v4Output, 10) });
  }
  return rows;
}

const SEEDS = 12;

test("#6428: official_times_v3 - et kuperet endagsloeb med passivt felt giver aldrig en udbrudssejr over ankerets margin", async () => {
  const band = ANCHOR_BANDS.breakawayWinMarginOneDaySeconds.byTerrain.hilly;
  const rows = await runPassiveOneDay("official_times_v3", SEEDS);
  const wins = rows.filter((r) => r.won);
  for (const r of wins) assert.ok((r.nr10 ?? Infinity) <= band.max, `seed ${r.seed}: udbruddet vandt med nr. 10 paa ${r.nr10} s (anker: hoejst ${band.max} s)`);
  // Udbruddet maa stadig vinde: rettelsen er marginen, ikke at udbrud aldrig holder hjem.
  assert.ok(wins.length >= 1, `udbruddet vandt ${wins.length} af ${SEEDS}`);
});
