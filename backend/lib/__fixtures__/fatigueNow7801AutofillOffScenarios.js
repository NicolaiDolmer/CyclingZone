// #7801: faste, syntetiske scenarier for assistentens udtagelse (Race Hubs auto-udfyld,
// forhåndsvisningen og "udtag nu"-knappen), med kontakten fatigue_now_7801 slukket.
// Samme fil køres i merge-basen (før udtagelsen læste trætheden ved etapestart) og i den nye
// kode; kun en hash forlader modulet (hard rule 17). Ingen prod-data, ingen rng uden frø.
//
// `resolve` er kalderens træthedsopslag, som ruterne i api.js bruger det:
//   resolve({ supabase, conditions, abById, teamId, races }) → { fatById, byRace }
// Basens opslag (default herunder) er det gamle ét kald til fatigueByRiderNow.
//
// Kør i merge-basen for at skrive facit:
//   node backend/lib/__fixtures__/fatigueNow7801AutofillOffScenarios.js <sti-til-json>
// Genereres ALDRIG med den nye kode.

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { assignTeamAcrossRaces } from "../raceEntryGenerator.js";
import { fatigueByRiderNow } from "../riderFatigueNow.js";
import { pickAutoSelection } from "../selectionAutoFill.js";

const SCENARIO_COUNT = 80;
const FLAGS = [undefined, "off", "beta", "OFF", null];

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}
const int = (next, lo, hi) => lo + Math.floor(next() * (hi - lo + 1));

const PROFILES = [
  { profile_type: "flat", demand_vector: { sprint: 0.8, endurance: 0.2, randomness: 0.5 } },
  { profile_type: "mountain", demand_vector: { climbing: 0.9, endurance: 0.4, randomness: 0.2 } },
  { profile_type: "hilly", demand_vector: { punch: 0.7, climbing: 0.4, endurance: 0.3, randomness: 0.4 } },
  { profile_type: "time_trial", demand_vector: { time_trial: 0.9, endurance: 0.3, randomness: 0.1 } },
];
const ABILITY_KEYS = ["climbing", "time_trial", "sprint", "punch", "endurance", "cobblestone", "acceleration", "recovery", "tactics", "positioning"];

// En kald, der kun må læse kontakten: alt andet registreres, så digesten ser en ekstra læsning.
function fakeSupabase(flag, reads) {
  return {
    from(table) {
      reads.push(table);
      const chain = {
        select() { return chain; }, eq() { return chain; }, in() { return chain; }, lt() { return chain; },
        gte() { return chain; }, is() { return chain; }, order() { return chain; }, range() { return chain; }, limit() { return chain; },
        maybeSingle() { return Promise.resolve({ data: table === "app_config" && flag !== undefined ? { value: flag } : null, error: null }); },
        then(resolve) { resolve({ data: [], error: null }); },
      };
      return chain;
    },
  };
}

/** Basens opslag: ét kald til fatigueByRiderNow, ingen pr.-løb-træthed. */
export async function baseResolve({ supabase, conditions, abById, teamId }) {
  return { fatById: await fatigueByRiderNow({ supabase, conditions, abilityByRider: abById, teamId }), byRace: null };
}

function buildScenario(seed) {
  const next = rng(seed);
  const riderCount = int(next, 14, 30);
  const raceCount = int(next, 2, 5);
  const riders = [];
  const conditions = [];
  const abById = new Map();
  for (let i = 0; i < riderCount; i++) {
    const id = `r${i}`;
    const abilities = Object.fromEntries(ABILITY_KEYS.map((k) => [k, int(next, 35, 92)]));
    abById.set(id, { rider_id: id, ...abilities });
    riders.push(id);
    // Nogle ryttere uden condition-række: de får 0, som ruterne gør.
    if (next() > 0.1) conditions.push({ rider_id: id, fatigue: next() > 0.15 ? int(next, 0, 100) : null });
  }
  const races = [];
  let cursor = 1000;
  for (let i = 0; i < raceCount; i++) {
    const stageCount = int(next, 1, 4);
    const stages = Array.from({ length: stageCount }, (_, s) => ({ ...PROFILES[int(next, 0, PROFILES.length - 1)], stage_number: s + 1 }));
    const start = cursor + (next() > 0.4 ? int(next, 0, 80) : 400);
    const end = start + 100 * stageCount;
    cursor = end + (next() > 0.5 ? 0 : 50);
    const max = int(next, 5, 8);
    races.push({ id: `race${i}`, race_id: `race${i}`, window: { start, end }, stages, sizeRule: { min: Math.max(1, max - 2), max } });
  }
  return { riders, conditions, abById, races };
}

export async function runScenarios({ resolve = baseResolve } = {}) {
  const hash = createHash("sha256");
  const tablesRead = new Set();
  let readCount = 0;
  let picksTotal = 0;
  for (let seed = 1; seed <= SCENARIO_COUNT; seed++) {
    const { riders, conditions, abById, races } = buildScenario(seed * 7919);
    const flag = FLAGS[seed % FLAGS.length];
    const reads = [];
    const { fatById, byRace } = await resolve({
      supabase: fakeSupabase(flag, reads), conditions, abById, teamId: "t1",
      races: races.map((r) => ({ id: r.id, stages: r.stages })),
    });
    for (const table of reads) tablesRead.add(table);
    readCount += reads.length;
    // Race Hub (regenerate + preview): ét hold, flere løb.
    const riderObjs = riders.map((id) => ({ rider_id: id, abilities: abById.get(id), fatigue: fatById.get(id) ?? 0 }));
    const assignRaces = races.map((r) => ({
      race_id: r.id, window: r.window, stages: r.stages, sizeRule: r.sizeRule, fatigueByRider: byRace?.get(r.id),
    }));
    const picks = assignTeamAcrossRaces({ riders: riderObjs, races: assignRaces, lockedWindows: [], strategy: null });
    // "Udtag nu" (selection/auto): ét løb, kandidater med løbets træthed.
    const single = races[0];
    const singleFat = byRace?.get(single.id) ?? fatById;
    const singlePicks = pickAutoSelection({
      candidateRiders: riders.map((id) => ({ rider_id: id, abilities: abById.get(id), fatigue: singleFat.get(id) ?? 0 })),
      race: { id: single.id, race_type: "stage_race", race_class: "2.1" }, stages: single.stages, thisWindow: single.window,
    });
    picksTotal += Object.values(picks).reduce((n, list) => n + list.length, 0) + singlePicks.length;
    hash.update(JSON.stringify({ seed, picks, singlePicks }));
  }
  return {
    scenarioCount: SCENARIO_COUNT,
    picksTotal,
    tablesRead: [...tablesRead].sort(),
    readCount,
    picks: hash.digest("hex"),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  const result = await runScenarios();
  if (!out) { console.log(JSON.stringify(result, null, 2)); process.exit(0); }
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
