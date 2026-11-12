// #7801: faste, syntetiske scenarier for Udtagelsen (getSelectionContext) og Holdfanen
// (getStageRolesContext) med kontakten fatigue_now_7801 slukket. Samme fil køres i
// merge-basen (før fladerne kunne vise trætheden lige nu) og i den nye kode; kun hashes
// forlader modulet (hard rule 17). Ingen prod-data, ingen rng uden frø.
//
// Kør i merge-basen for at skrive facit:
//   node backend/lib/__fixtures__/fatigueNow7801SurfacesOffScenarios.js <sti-til-json>
// Genereres ALDRIG med den nye kode.

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getSelectionContext } from "../raceSelection.js";
import { getStageRolesContext } from "../raceStageRolesApi.js";

export const SCENARIO_COUNT = 40;
/** Alt andet end den eksakte streng "on" er slukket. */
export const OFF_FLAGS = [undefined, "off", "beta", null, "ON", true];
// Fast ur til Holdfanen (låste etaper) og til etapeplanen. Udtagelsen læser selv uret, så
// dens data er valgt, så svaret ikke afhænger af datoen (skader langt før/efter).
export const FIXED_NOW = new Date("2026-06-15T10:00:00Z");

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}
const int = (next, lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
const pick = (next, list) => list[Math.floor(next() * list.length)];

const ABILITIES = ["climbing", "time_trial", "sprint", "punch", "endurance", "cobblestone", "acceleration", "recovery", "tactics", "positioning", "flat", "durability", "aggression", "descending"];
const PROFILES = ["flat", "hilly", "mountain", "time_trial", "cobbles"];
const ROLES = [null, "captain", "helper", "sprint_captain", "hunter", "free_role"];

/** Rækker for én tabel, filtreret som PostgREST ville. Ukendte metoder er no-ops. */
export function tableFake(state, { reads = [] } = {}) {
  return {
    reads,
    from(table) {
      reads.push(table);
      const filters = [];
      let order = null;
      let single = false;
      const run = () => {
        let rows = (state[table] ?? []).filter((r) => filters.every((f) => f(r)));
        if (order) rows = rows.slice().sort((a, b) => (a[order.col] > b[order.col] ? 1 : a[order.col] < b[order.col] ? -1 : 0) * (order.asc ? 1 : -1));
        rows = rows.map((r) => ({ ...r }));
        return single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null };
      };
      const known = {
        eq: (c, v) => filters.push((r) => r[c] === v),
        neq: (c, v) => filters.push((r) => r[c] !== v),
        in: (c, vs) => filters.push((r) => (vs ?? []).includes(r[c])),
        lt: (c, v) => filters.push((r) => r[c] < v),
        lte: (c, v) => filters.push((r) => r[c] <= v),
        gt: (c, v) => filters.push((r) => r[c] > v),
        gte: (c, v) => filters.push((r) => r[c] >= v),
        is: (c, v) => filters.push((r) => (r[c] ?? null) === v),
        order: (col, opts) => { order = { col, asc: opts?.ascending !== false }; },
      };
      const proxy = new Proxy({}, {
        get(_t, prop) {
          if (prop === "then") return (resolve, reject) => Promise.resolve(run()).then(resolve, reject);
          if (prop === "maybeSingle" || prop === "single") return () => { single = true; return Promise.resolve(run()); };
          if (known[prop]) return (...args) => { known[prop](...args); return proxy; };
          return () => proxy;
        },
      });
      return proxy;
    },
  };
}

/** Et hold, ét løb og datoens etaper, deterministisk ud fra frøet. */
export function buildScenario(seed, { now = FIXED_NOW } = {}) {
  const next = rng(seed * 7919 + 17);
  const teamId = `team-${seed}`;
  const raceId = `race-${seed}`;
  const stageCount = pick(next, [1, 1, 3, 5, 8]);
  const stagesCompleted = stageCount === 1 ? 0 : int(next, 0, stageCount - 1);
  const riderCount = int(next, 4, 9);
  const riders = [];
  const conditions = [];
  const abilities = [];
  for (let i = 0; i < riderCount; i++) {
    const id = `r${seed}-${i}`;
    riders.push({
      id, firstname: `F${i}`, lastname: `L${seed}`, team_id: teamId, squad: "senior", is_academy: false,
      is_retired: false, primary_type: pick(next, ["climber", "sprinter", null]), secondary_type: null,
      pending_team_id: null, birthdate: "1999-05-05",
    });
    if (next() < 0.85) {
      conditions.push({
        rider_id: id, form: int(next, 20, 90), fatigue: int(next, 0, 100),
        injured_until: pick(next, [null, null, "2000-01-01", "2999-01-01"]), injury_race_days_left: null,
      });
    }
    abilities.push({ rider_id: id, ...Object.fromEntries(ABILITIES.map((k) => [k, int(next, 40, 85)])) });
  }
  const profiles = Array.from({ length: stageCount }, (_, s) => ({
    race_id: raceId, stage_number: s + 1, profile_type: pick(next, PROFILES),
    distance_km: int(next, 120, 220), elevation_gain_m: int(next, 0, 4000),
  }));
  // Etaperne ligger på samme dato som uret, så en tændt kontakt ville lægge datoens kørte etaper til.
  const base = now.getTime() - 4 * 3600_000;
  const schedule = profiles.map((p, s) => ({
    race_id: raceId, stage_number: p.stage_number, game_day: 100 + s,
    scheduled_at: new Date(base + s * 2 * 3600_000).toISOString(),
  }));
  const selected = riders.filter(() => next() < 0.7);
  const entries = selected.map((r) => ({
    race_id: raceId, team_id: teamId, rider_id: r.id, race_role: pick(next, ROLES), is_auto_filled: next() < 0.5,
  }));
  const dateStr = new Date(base).toISOString().slice(0, 10);
  const loads = [];
  for (const e of entries) {
    for (let s = 0; s < stagesCompleted; s++) {
      loads.push({
        rider_id: e.rider_id, game_day: 100 + s, tick_date: dateStr, load: int(next, 5, 40),
        consumed_at: null, duplicate_of_race_id: null,
      });
    }
  }
  const race = {
    id: raceId, name: `Race ${seed}`, race_type: stageCount > 1 ? "stage_race" : "single", race_class: "Class2",
    stages: stageCount, stages_completed: stagesCompleted, status: "scheduled", season_id: "season-1",
    league_division_id: "div-1", scheduled_for: dateStr, squad: "senior", engine_rules_revision: null,
  };
  const state = {
    riders, rider_condition: conditions, rider_derived_abilities: abilities, race_stage_profiles: profiles,
    race_entries: entries, race_stage_schedule: schedule, training_race_loads: loads, races: [race],
    seasons: [{ id: "season-1", status: "active", number: 4 }],
  };
  return { state, race, teamId };
}

function withFlag(state, flag) {
  return { ...state, app_config: flag === undefined ? [] : [{ key: "fatigue_now_7801", value: flag }] };
}

const jsonSafe = (value) => JSON.stringify(value, (_k, v) => (v instanceof Map ? [...v] : v instanceof Set ? [...v].sort() : v));
const sha = (value) => createHash("sha256").update(value).digest("hex");

/** Hash pr. scenarie og flag for begge flader. */
export async function surfaceOffDigests() {
  const out = [];
  for (let seed = 1; seed <= SCENARIO_COUNT; seed++) {
    for (const flag of OFF_FLAGS) {
      const { state, race, teamId } = buildScenario(seed);
      // `now` findes ikke i basens signatur (den læste uret); data er valgt, så svaret er det samme.
      const selection = await getSelectionContext({ supabase: tableFake(withFlag(state, flag)), race, teamId, now: FIXED_NOW });
      const roles = await getStageRolesContext({ supabase: tableFake(withFlag(state, flag)), race, teamId, now: FIXED_NOW });
      out.push({ seed, flag: String(flag), selection: sha(jsonSafe(selection)), roles: sha(jsonSafe(roles)) });
    }
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const target = process.argv[2];
  if (!target) throw new Error("usage: node fatigueNow7801SurfacesOffScenarios.js <out.json>");
  const digests = await surfaceOffDigests();
  writeFileSync(target, `${JSON.stringify({ scenarios: SCENARIO_COUNT, flags: OFF_FLAGS.map(String), digests }, null, 1)}\n`);
  console.log(`wrote ${digests.length} digests to ${target}`);
}
