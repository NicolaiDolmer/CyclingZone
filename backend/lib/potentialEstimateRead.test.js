// #7684: læse-siden af det gemte skøn. Fake-klienten projicerer kolonnerne, så en række
// i "databasen" med usikkerhed og vidensniveau kun når svaret, hvis koden selecter dem.

import test from "node:test";
import assert from "node:assert/strict";

import { REGISTRY_ABILITY_KEYS } from "./abilityRegistry.js";
import {
  TRAININGS_NEEDED,
  buildAcademyFromViews,
  buildEstimateLine,
  buildEstimatesFromViews,
  buildPotentialView,
  buildProjectionFromView,
  buildScoutingReportFromView,
  loadPotentialViews,
} from "./potentialEstimateRead.js";

const TEAM = "team-own";
const OTHER_TEAM = "team-other";
const FORBIDDEN = /uncertainty|knowledge_key|ceiling_at_write|params_version|write_reason|potentiale|ability_caps/;

const estimateRow = (over = {}) => ({
  rider_id: "scouted",
  team_id: TEAM,
  value: 74,
  certainty: "fair",
  previous_value: null,
  previous_certainty: null,
  changed_at: null,
  uncertainty: 3.5,
  knowledge_key: "s2t3",
  ceiling_at_write: 77,
  params_version: "v1",
  write_reason: "new_knowledge",
  ...over,
});

// En rytter med samme tal i alle evner har den rating i alle roller.
const abilitiesAt = (rating) => Object.fromEntries(REGISTRY_ABILITY_KEYS.map((key) => [key, rating]));

function fakeSupabase(tables) {
  const reads = [];
  const client = {
    reads,
    from(table) {
      const filters = [];
      let columns = "*";
      const project = (row) => (columns === "*"
        ? row
        : Object.fromEntries(columns.split(",").map((c) => c.trim()).map((c) => [c, row[c]])));
      const rows = () => (tables[table] ?? [])
        .filter((row) => filters.every(({ column, values }) => values.includes(row[column])))
        .map(project);
      const query = {
        select(selected) { columns = selected; reads.push({ table, columns: selected }); return query; },
        eq(column, value) { filters.push({ column, values: [value] }); return query; },
        in(column, values) { filters.push({ column, values }); return query; },
        order() { return query; },
        range: async () => ({ data: rows(), error: null }),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      };
      return query;
    },
  };
  return client;
}

const world = (over = {}) => fakeSupabase({
  riders: [
    { id: "scouted", team_id: OTHER_TEAM, is_academy: false, best_role_rating: 60, potentiale: 5.5 },
    { id: "stranger", team_id: OTHER_TEAM, is_academy: false, best_role_rating: 40, potentiale: 2 },
    { id: "youth", team_id: TEAM, is_academy: true, best_role_rating: 20, potentiale: 6 },
    { id: "veteran", team_id: TEAM, is_academy: false, best_role_rating: 70, potentiale: 3 },
  ],
  rider_potential_estimates: [
    estimateRow(),
    estimateRow({ rider_id: "stranger", team_id: OTHER_TEAM, value: 90 }),
  ],
  training_rider_ticks: [
    { rider_id: "youth", team_id: TEAM, tick_date: "2026-11-01", season_id: "s", game_day: 1 },
    { rider_id: "youth", team_id: TEAM, tick_date: "2026-11-01", season_id: "s", game_day: 2 },
    { rider_id: "youth", team_id: TEAM, tick_date: "2026-11-02", season_id: "s", game_day: 3 },
    { rider_id: "youth", team_id: OTHER_TEAM, tick_date: "2026-10-01", season_id: "s", game_day: 0 },
  ],
  rider_derived_abilities: [{ rider_id: "scouted", ...abilitiesAt(50), ability_caps: { climbing: 99 }, hidden_potential: 80 }],
  ...over,
});

test("buildPotentialView: tal + ord er præcis kontrakten", () => {
  assert.deepEqual(buildPotentialView({ row: estimateRow(), currentRating: 60 }), {
    hidden: false, value: 74, certainty: "fair", previousValue: null, previousCertainty: null, changedAt: null,
  });
});

test("buildPotentialView: ændret siden sidst følger med", () => {
  const row = estimateRow({ previous_value: 70, previous_certainty: "unsure", changed_at: "2026-11-01T10:00:00.000Z" });
  assert.deepEqual(buildPotentialView({ row, currentRating: 60 }), {
    hidden: false, value: 74, certainty: "fair", previousValue: 70, previousCertainty: "unsure", changedAt: "2026-11-01T10:00:00.000Z",
  });
});

test("buildPotentialView: skønnet vises aldrig under nuværende rating", () => {
  assert.equal(buildPotentialView({ row: estimateRow(), currentRating: 80 }).value, 80);
});

test("buildPotentialView: uden række er rytteren uscoutet", () => {
  assert.deepEqual(buildPotentialView(), { hidden: true, reason: "unscouted" });
});

test("buildPotentialView: egen ungdomsrytter læres indtil grænsen", () => {
  assert.deepEqual(buildPotentialView({ learningYouth: true, trainings: 2 }), {
    hidden: true, reason: "learning", trainings: 2, trainingsNeeded: TRAININGS_NEEDED,
  });
  assert.deepEqual(buildPotentialView({ learningYouth: true, trainings: TRAININGS_NEEDED }), { hidden: true, reason: "unscouted" });
});

test("buildPotentialView: et gemt skøn vinder over læretiden", () => {
  assert.equal(buildPotentialView({ row: estimateRow(), learningYouth: true, trainings: 0 }).hidden, false);
});

test("loadPotentialViews: læser kun holdets egne rækker og aldrig de skjulte kolonner", async () => {
  const supabase = world();
  const views = await loadPotentialViews(supabase, { teamId: TEAM, riderIds: ["scouted", "stranger", "youth", "veteran", "ghost"] });
  assert.equal(views.get("scouted").value, 74);
  assert.deepEqual(views.get("stranger"), { hidden: true, reason: "unscouted" }, "et andet holds skøn må aldrig bruges");
  assert.deepEqual(views.get("veteran"), { hidden: true, reason: "unscouted" });
  assert.equal(views.has("ghost"), false);
  const estimateRead = supabase.reads.find((read) => read.table === "rider_potential_estimates");
  assert.doesNotMatch(estimateRead.columns, FORBIDDEN);
  assert.ok(!supabase.reads.some((read) => read.table === "riders" && /potentiale/.test(read.columns)));
});

test("loadPotentialViews: træninger tælles som datoer på holdet, ikke rækker", async () => {
  const views = await loadPotentialViews(world(), { teamId: TEAM, riderIds: ["youth"] });
  assert.deepEqual(views.get("youth"), { hidden: true, reason: "learning", trainings: 2, trainingsNeeded: TRAININGS_NEEDED });
});

test("loadPotentialViews: tæller kun træninger, når en ungdomsrytter mangler et skøn", async () => {
  const supabase = world();
  await loadPotentialViews(supabase, { teamId: TEAM, riderIds: ["scouted", "veteran"] });
  assert.ok(!supabase.reads.some((read) => read.table === "training_rider_ticks"));
});

test("loadPotentialViews: gulvet følger evnerne nu, ikke den cachede rating", async () => {
  const supabase = world({ rider_derived_abilities: [{ rider_id: "scouted", ...abilitiesAt(80) }] });
  const views = await loadPotentialViews(supabase, { teamId: TEAM, riderIds: ["scouted"] });
  assert.equal(views.get("scouted").value, 80);
});

test("loadPotentialViews: uden evner falder gulvet tilbage til den cachede rating", async () => {
  const supabase = world({ rider_derived_abilities: [] });
  const views = await loadPotentialViews(supabase, { teamId: TEAM, riderIds: ["scouted"] });
  assert.equal(views.get("scouted").value, 74);
  const lifted = await loadPotentialViews(world({
    rider_derived_abilities: [],
    rider_potential_estimates: [estimateRow({ value: 55 })],
  }), { teamId: TEAM, riderIds: ["scouted"] });
  assert.equal(lifted.get("scouted").value, 60);
});

test("loadPotentialViews: tom liste slår intet op", async () => {
  const supabase = world();
  assert.equal((await loadPotentialViews(supabase, { teamId: TEAM, riderIds: [null, undefined] })).size, 0);
  assert.equal(supabase.reads.length, 0);
});

test("buildEstimatesFromViews: skønnet står alene pr. rytter", async () => {
  const estimates = await buildEstimatesFromViews(world(), { teamId: TEAM, riderIds: ["scouted", "stranger"] });
  assert.deepEqual(Object.keys(estimates.scouted), ["potentialView"]);
  assert.deepEqual(estimates.stranger, { potentialView: { hidden: true, reason: "unscouted" } });
  assert.doesNotMatch(JSON.stringify(estimates), FORBIDDEN);
});

const reportInput = (over = {}) => ({
  teamId: TEAM,
  rider: { id: "scouted", primary_type: "climber", potentiale: 5.5 },
  own: false, level: 2, maxLevel: 3, looks: 2, age: 23,
  scout: { isDefault: false, name: "Scout A", tier: 3, overall: 70, hiredAt: null },
  generatedAt: "2026-11-05T10:00:00.000Z",
  ...over,
});

test("scouting-rapporten: potentialView, kig og scout, ingen gamle bånd", async () => {
  const report = await buildScoutingReportFromView(world(), reportInput());
  assert.equal(Object.keys(report)[0], "potentialView");
  assert.equal(report.potentialView.value, 74);
  assert.equal(report.looks, 2);
  assert.equal(report.scout.name, "Scout A");
  for (const legacy of ["stars", "types", "displayKey", "precision", "capsMissing", "value"]) {
    assert.ok(!(legacy in report), `${legacy} er den gamle model`);
  }
  assert.doesNotMatch(JSON.stringify(report), FORBIDDEN);
});

test("scouting-rapporten: vurderingen bygger på skønnet og følger ordet", async () => {
  const report = await buildScoutingReportFromView(world(), reportInput());
  assert.equal(report.verdict.confidence, "medium");
  assert.equal(report.verdict.headlineKey, "bid_worth_considering");
});

test("scouting-rapporten: uden skøn er der ingen vurdering", async () => {
  const report = await buildScoutingReportFromView(world(), reportInput({ rider: { id: "stranger", primary_type: "climber" }, level: 0, looks: 0 }));
  assert.deepEqual(report.potentialView, { hidden: true, reason: "unscouted" });
  assert.equal(report.verdict, null);
  assert.equal(report.looks, 0);
});

test("estimateLine: starter ved nu, ender mod skønnet, heltal, aldrig bånd", () => {
  const line = buildEstimateLine({ now: 40, value: 70, age: 20 });
  assert.deepEqual(line[0], { season: 0, value: 40 });
  assert.ok(line.every((point) => Object.keys(point).join() === "season,value" && Number.isInteger(point.value)));
  assert.ok(line.at(-1).value > 40 && line.at(-1).value <= 70);
});

const projectionInput = (over = {}) => ({
  teamId: TEAM, rider: { id: "scouted", primary_type: "climber" }, own: false, level: 2, maxLevel: 3, age: 23, ...over,
});

test("development-projection: linje + potentialView, aldrig band, ceil eller timing", async () => {
  const supabase = world();
  const projection = await buildProjectionFromView(supabase, projectionInput());
  assert.equal(projection.potentialView.value, 74);
  assert.ok(projection.estimateLine.length > 1);
  assert.equal(projection.estimateLine[0].value, Math.round(projection.now));
  for (const legacy of ["band", "ceil", "timing"]) assert.ok(!(legacy in projection), `${legacy} må ikke være med`);
  assert.doesNotMatch(JSON.stringify(projection), FORBIDDEN);
  const abilityRead = supabase.reads.find((read) => read.table === "rider_derived_abilities");
  assert.doesNotMatch(abilityRead.columns, /ability_caps|hidden_potential|\*/);
});

test("development-projection: skjult skøn tegner ingen linje", async () => {
  const projection = await buildProjectionFromView(world(), projectionInput({ rider: { id: "stranger", primary_type: "climber" } }));
  assert.deepEqual(projection.estimateLine, []);
  assert.equal(projection.capsMissing, false);
  assert.deepEqual(projection.potentialView, { hidden: true, reason: "unscouted" });
});

test("development-projection: skøn uden evner siger det ærligt", async () => {
  const projection = await buildProjectionFromView(world({ rider_derived_abilities: [] }), projectionInput());
  assert.deepEqual(projection.estimateLine, []);
  assert.equal(projection.capsMissing, true);
  assert.equal(projection.potentialView.value, 74);
});

test("akademiet: trup og kandidater svarer fra skønnet og mister de gamle felter", async () => {
  const out = await buildAcademyFromViews(world(), {
    teamId: TEAM,
    roster: [{ id: "youth", firstname: "A", prognosis: { stage: "broad", band: { lo: 1, hi: 2 } } }],
    intake: [
      { riderId: "scouted", is_serious: true, potentialEstimate: { lo: 3, hi: 4 }, potentialBand: { prog: { lo: 60, hi: 80 } } },
      { riderId: "stranger", is_serious: true, potentialEstimate: { lo: 3, hi: 4 }, potentialBand: null },
    ],
  });
  assert.equal(out.roster[0].firstname, "A");
  assert.ok(!("prognosis" in out.roster[0]));
  assert.equal(out.roster[0].potentialView.reason, "learning");
  assert.equal(out.intake[0].potentialView.value, 74);
  assert.deepEqual(out.intake[1].potentialView, { hidden: true, reason: "unscouted" });
  for (const item of out.intake) {
    assert.equal(item.is_serious, false);
    assert.equal(item.potentialEstimate, null);
    assert.equal(item.potentialBand, null);
  }
  assert.doesNotMatch(JSON.stringify(out), FORBIDDEN);
});

test("H5: alle fire flader viser samme tal for samme (rytter, hold)", async () => {
  const supabase = world();
  const riderIds = ["scouted"];
  const estimates = await buildEstimatesFromViews(supabase, { teamId: TEAM, riderIds });
  const report = await buildScoutingReportFromView(supabase, reportInput());
  const projection = await buildProjectionFromView(supabase, projectionInput());
  const academy = await buildAcademyFromViews(supabase, { teamId: TEAM, roster: [{ id: "scouted" }], intake: [] });
  const expected = estimates.scouted.potentialView;
  assert.deepEqual(report.potentialView, expected);
  assert.deepEqual(projection.potentialView, expected);
  assert.deepEqual(academy.roster[0].potentialView, expected);
});
