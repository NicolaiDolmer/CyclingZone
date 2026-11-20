// #8523 (spec 2026-11-20 §5): den samlede prognose for egne ryttere og AI-holdenes
// ryttere, der ikke kan scoutes. Tallene her er opdigtede testværdier, ikke kalibrering.

import test from "node:test";
import assert from "node:assert/strict";

import { REGISTRY_ABILITY_KEYS } from "./abilityRegistry.js";
import { PEAK_AGE } from "./developmentProjection.js";
import { ageForSeason } from "./riderSeasonAge.js";
import { PROGNOSIS_PACE_DAYS, pacePrognosis } from "./riderPrognosis.js";
import {
  buildAcademyFromViews,
  buildEstimatesFromViews,
  buildProjectionFromView,
  buildScoutingReportFromView,
  loadPotentialViews,
} from "./potentialEstimateRead.js";

// ── Den rene funktion ────────────────────────────────────────────────────────────

const base = { now: 50, past: 50, daysAgo: PROGNOSIS_PACE_DAYS, estimate: 70, age: 22 };

test("pacePrognosis: ingen fremgang i vinduet = rytteren står på sit nu", () => {
  assert.equal(pacePrognosis(base), 50);
});

test("pacePrognosis: fremgang løfter prognosen, men aldrig over skønnet", () => {
  const slow = pacePrognosis({ ...base, past: 49 });
  const fast = pacePrognosis({ ...base, past: 45 });
  assert.ok(slow > 50 && slow <= 70, `langsom: ${slow}`);
  assert.ok(fast >= slow && fast <= 70, `hurtig: ${fast}`);
  assert.equal(pacePrognosis({ ...base, past: 0 }), 70, "hele afstanden på én dag rammer skønnet");
});

test("pacePrognosis: kortere tid til toppen giver en lavere prognose ved samme fart", () => {
  const young = pacePrognosis({ ...base, past: 48, age: 20 });
  const older = pacePrognosis({ ...base, past: 48, age: PEAK_AGE - 1 });
  assert.ok(young >= older, `${young} >= ${older}`);
  assert.equal(pacePrognosis({ ...base, past: 48, age: PEAK_AGE }), 50, "ved topalderen er toppen nået");
});

test("pacePrognosis: forbi toppen eller uden tal er der ingen prognose", () => {
  assert.equal(pacePrognosis({ ...base, age: PEAK_AGE + 1 }), null);
  assert.equal(pacePrognosis({ ...base, estimate: null }), null);
  assert.equal(pacePrognosis({ ...base, now: null }), null);
  assert.equal(pacePrognosis({ ...base, age: null }), null);
});

test("pacePrognosis: tilbagegang og en rytter over skønnet står på sit nu", () => {
  assert.equal(pacePrognosis({ ...base, past: 55 }), 50);
  assert.equal(pacePrognosis({ ...base, now: 75, past: 70 }), 75);
});

test("pacePrognosis: altid et heltal", () => {
  for (let past = 40; past <= 50; past += 0.7) {
    assert.ok(Number.isInteger(pacePrognosis({ ...base, past })));
  }
});

// ── Læsesiden ────────────────────────────────────────────────────────────────────

const TEAM = "team-own";
const AI = "team-ai";
const RIVAL = "team-rival";
const SEASON = 3;
const NOW = new Date("2026-11-20T12:00:00.000Z");
const birthdateForAge = (age) => `${ageForSeason("2000-01-01", SEASON) + 2000 - age}-06-01`;
const abilitiesAt = (rating) => Object.fromEntries(REGISTRY_ABILITY_KEYS.map((key) => [key, rating]));
const FORBIDDEN = /uncertainty|knowledge_key|ceiling_at_write|params_version|write_reason|potentiale|ability_caps/;

function fakeSupabase(tables) {
  const reads = [];
  return {
    reads,
    from(table) {
      const filters = [];
      let columns = "*";
      const project = (row) => (columns === "*"
        ? row
        : Object.fromEntries(columns.split(",").map((c) => c.trim()).map((c) => [c, row[c]])));
      const rows = () => (tables[table] ?? [])
        .filter((row) => filters.every((match) => match(row)))
        .map(project);
      const query = {
        select(selected) { columns = selected; reads.push({ table, columns: selected }); return query; },
        eq(column, value) { filters.push((row) => row[column] === value); return query; },
        in(column, values) { filters.push((row) => values.includes(row[column])); return query; },
        gt(column, value) { filters.push((row) => row[column] > value); return query; },
        gte(column, value) { filters.push((row) => row[column] >= value); return query; },
        order() { return query; },
        range: async () => ({ data: rows(), error: null }),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then(resolve, reject) { return Promise.resolve({ data: rows(), error: null }).then(resolve, reject); },
      };
      return query;
    },
  };
}

const estimate = (riderId, value, certainty = "fair") => ({
  rider_id: riderId, team_id: TEAM, value, certainty,
  previous_value: null, previous_certainty: null, changed_at: null,
  uncertainty: 2, knowledge_key: "k", ceiling_at_write: 99, params_version: "v", write_reason: "r",
});

const world = (over = {}) => fakeSupabase({
  seasons: [{ number: SEASON, status: "active" }],
  teams: [{ id: TEAM, is_ai: false }, { id: AI, is_ai: true }, { id: RIVAL, is_ai: false }],
  riders: [
    { id: "growing", team_id: TEAM, is_academy: false, birthdate: birthdateForAge(21), primary_type: "climber", best_role_rating: 50 },
    { id: "flat", team_id: TEAM, is_academy: false, birthdate: birthdateForAge(21), primary_type: "climber", best_role_rating: 50 },
    { id: "veteran", team_id: TEAM, is_academy: false, birthdate: birthdateForAge(PEAK_AGE + 3), primary_type: "climber", best_role_rating: 70 },
    { id: "learner", team_id: TEAM, is_academy: true, birthdate: birthdateForAge(17), primary_type: "climber", best_role_rating: 20 },
    { id: "aiRider", team_id: AI, is_academy: false, birthdate: birthdateForAge(25), primary_type: "climber", best_role_rating: 60 },
    { id: "aiKnown", team_id: AI, is_academy: false, birthdate: birthdateForAge(25), primary_type: "climber", best_role_rating: 60 },
    { id: "rival", team_id: RIVAL, is_academy: false, birthdate: birthdateForAge(25), primary_type: "climber", best_role_rating: 60 },
  ],
  rider_potential_estimates: [
    estimate("growing", 70), estimate("flat", 70), estimate("veteran", 72), estimate("aiKnown", 66),
  ],
  rider_derived_abilities: [
    { rider_id: "growing", ...abilitiesAt(50) },
    { rider_id: "flat", ...abilitiesAt(50) },
    { rider_id: "veteran", ...abilitiesAt(70) },
  ],
  rider_derived_ability_history: [
    { rider_id: "growing", snapshot_date: "2026-10-15", abilities: abilitiesAt(46) },
    { rider_id: "growing", snapshot_date: "2026-10-21", abilities: abilitiesAt(47) },
    { rider_id: "growing", snapshot_date: "2026-11-10", abilities: abilitiesAt(49) },
    { rider_id: "flat", snapshot_date: "2026-10-18", abilities: abilitiesAt(50) },
  ],
  training_rider_ticks: [],
  ...over,
});

test("AI-hold: uden gemt skøn kan rytteren ikke scoutes", async () => {
  const views = await loadPotentialViews(world(), { teamId: TEAM, riderIds: ["aiRider", "aiKnown", "rival"] });
  assert.deepEqual(views.get("aiRider"), { hidden: true, reason: "aiTeam" });
  assert.equal(views.get("aiKnown").value, 66, "et skøn holdet allerede har, beholder det");
  assert.deepEqual(views.get("rival"), { hidden: true, reason: "unscouted" });
});

test("AI-hold: eget hold slås aldrig op som AI-hold", async () => {
  const supabase = world();
  await loadPotentialViews(supabase, { teamId: TEAM, riderIds: ["growing", "learner"] });
  assert.ok(!supabase.reads.some((read) => read.table === "teams"));
});

test("estimates: kun egne ryttere får prognosen, og den ligger mellem nu og skønnet", async () => {
  const estimates = await buildEstimatesFromViews(world(), {
    teamId: TEAM, riderIds: ["growing", "flat", "veteran", "learner", "rival", "aiRider"], now: NOW,
  });
  const growing = estimates.growing.prognosisView;
  assert.equal(growing.hidden, false);
  assert.ok(growing.value > 50 && growing.value <= 70, `prognose ${growing.value}`);
  assert.deepEqual(estimates.flat.prognosisView, { hidden: false, value: 50 });
  assert.deepEqual(estimates.veteran.prognosisView, { hidden: true, reason: "pastPeak" });
  assert.deepEqual(estimates.learner.prognosisView, { hidden: true, reason: "noEstimate" });
  assert.ok(!("prognosisView" in estimates.rival));
  assert.ok(!("prognosisView" in estimates.aiRider));
  assert.doesNotMatch(JSON.stringify(estimates), FORBIDDEN);
});

test("estimates: uden billeder i vinduet er farten nul", async () => {
  const estimates = await buildEstimatesFromViews(world({ rider_derived_ability_history: [] }), {
    teamId: TEAM, riderIds: ["growing"], now: NOW,
  });
  assert.deepEqual(estimates.growing.prognosisView, { hidden: false, value: 50 });
});

test("estimates: historikken læses kun for egne ryttere, der stadig kan vokse", async () => {
  const supabase = world();
  await buildEstimatesFromViews(supabase, { teamId: TEAM, riderIds: ["veteran", "learner", "rival"], now: NOW });
  assert.ok(!supabase.reads.some((read) => read.table === "rider_derived_ability_history"));
});

test("én kilde: estimates, rapport, projektion og akademi viser samme prognose", async () => {
  const supabase = world();
  const rider = { id: "growing", primary_type: "climber" };
  const estimates = await buildEstimatesFromViews(supabase, { teamId: TEAM, riderIds: ["growing"], now: NOW });
  const report = await buildScoutingReportFromView(supabase, {
    teamId: TEAM, rider, own: true, level: 3, maxLevel: 3, looks: 0, age: 21, scout: null, generatedAt: null, now: NOW,
  });
  const projection = await buildProjectionFromView(supabase, {
    teamId: TEAM, rider, own: true, level: 3, maxLevel: 3, age: 21, now: NOW,
  });
  const academy = await buildAcademyFromViews(supabase, { teamId: TEAM, roster: [{ id: "growing" }], intake: [], now: NOW });
  const expected = estimates.growing.prognosisView;
  assert.deepEqual(report.prognosisView, expected);
  assert.deepEqual(projection.prognosisView, expected);
  assert.deepEqual(academy.roster[0].prognosisView, expected);
  assert.ok(!("estimateLine" in projection));
});
