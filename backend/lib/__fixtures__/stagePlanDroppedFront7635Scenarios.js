// #7635: faste, syntetiske scenarier gennem raceRunner med den rigtige v4-motor OG en
// etapeplan for hvert hold (saa motorens "sat"-regel faktisk koeres). Delt af
// stagePlanDroppedFront7635Flag.test.js og generatoren af den frosne fixture
// (stagePlanDroppedFront7635FlagOff.json). Samme fil koeres i merge-basen (foer kontakten)
// og i den nye kode; kun hashes og kvalitative udfald forlader modulet (hard rule 17).
// Ingen prod-data, ingen rng.

import { buildRaceResults, buildStageRowsAccumulated } from "../raceRunner.js";
import { loadRaceEngineV4 } from "../raceEngineV4Bridge.js";
import { ABILITY_KEYS } from "../raceSimulator.js";
import { DEMAND_VECTORS } from "../raceStageProfileGenerator.js";
import { buildSnapshotRows, createEngineInputRecorder } from "../engineInputSnapshot1857.js";
import { stagePlanRouteFromRaw, suggestStagePlan, validateStagePlanLegs } from "../stagePlan.ts";

export const RACE_7635 = Object.freeze({ id: "race-7635-fixture", race_type: "stage_race", race_class: "ProSeries", season_id: "s1", stages: 3 });

function abil(seed) {
  const a = {};
  ABILITY_KEYS.forEach((k, i) => { a[k] = 35 + ((seed * 13 + i * 7) % 55); });
  return a;
}

const ROLE_CYCLE = ["captain", "helper", "helper", "hunter", "free_role", "helper"];

export function entrants7635(n = 36, teams = 6) {
  const perTeam = Math.ceil(n / teams);
  return Array.from({ length: n }, (_, i) => {
    const team = String.fromCharCode(65 + Math.floor(i / perTeam));
    return {
      rider_id: `r${String(i).padStart(3, "0")}`,
      team_id: `team-${team}`,
      team_name: `Hold ${team}`,
      rider_name: `Rytter ${i}`,
      is_u25: i % 5 === 0,
      abilities: abil(i),
      form: 30 + (i % 40),
      fatigue: (i * 7) % 60,
      race_role: ROLE_CYCLE[i % perTeam],
    };
  });
}

/** Bakket etape, topankomst og en bjergetape med nedkoersel til maal. */
export function stages7635() {
  return [
    {
      stage_number: 1, profile_type: "hilly", finale_type: "descent",
      demand_vector: DEMAND_VECTORS.hilly, distance_km: 175,
      climbs: [
        { name: "Cote A", crest_km: 55, category: "3" },
        { name: "Cote B", crest_km: 110, category: "2" },
        { name: "Cote C", crest_km: 160, category: "2" },
      ],
      sprints: [{ name: "Sprint", km: 80, kind: "intermediate" }],
      race_id: RACE_7635.id, id: "sp-7635-1",
    },
    {
      stage_number: 2, profile_type: "mountain", finale_type: "long_climb",
      demand_vector: DEMAND_VECTORS.mountain, distance_km: 165,
      climbs: [
        { name: "Col A", crest_km: 90, category: "2" },
        { name: "Col B", crest_km: 158, category: "1", summit_finish: true },
      ],
      sprints: [{ name: "Sprint", km: 70, kind: "intermediate" }],
      race_id: RACE_7635.id, id: "sp-7635-2",
    },
    {
      stage_number: 3, profile_type: "mountain", finale_type: "descent",
      demand_vector: DEMAND_VECTORS.mountain, distance_km: 170,
      climbs: [
        { name: "Col C", crest_km: 60, category: "1" },
        { name: "Col D", crest_km: 110, category: "1" },
        { name: "Col E", crest_km: 152, category: "HC" },
      ],
      sprints: [{ name: "Sprint", km: 85, kind: "intermediate" }],
      race_id: RACE_7635.id, id: "sp-7635-3",
    },
  ];
}

/**
 * Lederen: foelg med, angrib efter dagens naestsidste stigning, koer for resultatet naar
 * han er sat (samme form som planen i #7635). De andre: assistentens forslag. Kun
 * gyldige kaeder (samme validering som motoren).
 */
function planFor(role, route) {
  const climbs = [...route.climbs].sort((a, b) => a.km - b.km);
  if (role === "captain" && climbs.length >= 2) {
    const legs = [
      { task: "follow_moves" },
      { task: "attack", from: { at: "kom", kom_index: climbs[climbs.length - 2].index } },
      { task: "ride_for_result", from: { at: "dropped" } },
    ];
    if (validateStagePlanLegs(legs, role, route) === null) return legs;
  }
  const suggested = suggestStagePlan({ role, route, teamHasSprintCaptain: false });
  return validateStagePlanLegs(suggested, role, route) === null ? suggested : null;
}

export function teamOrderRows7635() {
  const rows = [];
  const entrants = entrants7635();
  for (const stage of stages7635()) {
    const route = stagePlanRouteFromRaw(stage);
    const byTeam = new Map();
    for (const e of entrants) {
      const legs = planFor(e.race_role, route);
      if (!legs) continue;
      if (!byTeam.has(e.team_id)) byTeam.set(e.team_id, []);
      byTeam.get(e.team_id).push({ rider_id: e.rider_id, plan: legs });
    }
    for (const [teamId, riders] of byTeam) rows.push({ team_id: teamId, stage_number: stage.stage_number, riders });
  }
  return rows;
}

async function digestsOf(result, recorder) {
  const rows = await buildSnapshotRows({ raceId: RACE_7635.id, recorder });
  return {
    inputChecksums: result.runs.map((r) => r.input_checksum),
    inputSha256: rows.map((r) => r.input_sha256),
    outputSha256: rows.map((r) => r.output_sha256),
  };
}

export function wholeRace7635(v4Engine, rulesRevision) {
  const recorder = createEngineInputRecorder({ raceId: RACE_7635.id });
  const result = buildRaceResults({
    race: RACE_7635, stages: stages7635(), entrants: entrants7635(), pointsLookup: {}, v3: true, v4Engine,
    teamOrderRows: teamOrderRows7635(), rulesRevision, engineInputRecorder: recorder,
  });
  return { result, recorder };
}

export function stageByStage7635(v4Engine, rulesRevision, stageIndex) {
  const recorder = createEngineInputRecorder({ raceId: RACE_7635.id });
  const result = buildStageRowsAccumulated({
    race: RACE_7635, stagesSorted: stages7635(), stageIndex, entrants: entrants7635(), pointsLookup: {},
    priorStageRows: [], v3: true, v4Engine, teamOrderRows: teamOrderRows7635(), rulesRevision, engineInputRecorder: recorder,
  });
  return { result, recorder };
}

/** Noeglerne i den frosne fixture: revision x sti. */
export const OFF_DIGEST_CASES_7635 = Object.freeze([
  { key: "wholeRace:s5_profiles_v3", run: (e) => wholeRace7635(e, "s5_profiles_v3") },
  { key: "wholeRace:s5_profiles_v2", run: (e) => wholeRace7635(e, "s5_profiles_v2") },
  { key: "stageByStage:s5_profiles_v3:stage3", run: (e) => stageByStage7635(e, "s5_profiles_v3", 2) },
]);

/** Antal etapeplan-skift med aarsagen "sat" i en koersel (kvalitativt: findes de?). */
export function droppedSwitchCount7635(result) {
  let n = 0;
  for (const run of result.runs ?? []) {
    for (const e of run.timeline?.events ?? run.v4_timeline?.events ?? []) {
      if (e?.type === "stage_plan_leg" && e.params?.reason === "dropped") n += 1;
    }
  }
  return n;
}

/** Motoren som raceRunner faar den uden nogen kontakt taendt. */
export async function computeOffDigests7635(engine = null) {
  const v4Engine = engine ?? await loadRaceEngineV4();
  const out = {};
  for (const c of OFF_DIGEST_CASES_7635) {
    const { result, recorder } = c.run(v4Engine);
    out[c.key] = await digestsOf(result, recorder);
  }
  return out;
}

export { digestsOf as digests7635 };
