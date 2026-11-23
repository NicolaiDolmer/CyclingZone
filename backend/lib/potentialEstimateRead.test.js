// #7684: læse-siden af det gemte skøn. Fake-klienten projicerer kolonnerne, så en række
// i "databasen" med usikkerhed og vidensniveau kun når svaret, hvis koden selecter dem.

import test from "node:test";
import assert from "node:assert/strict";

import { REGISTRY_ABILITY_KEYS } from "./abilityRegistry.js";
import {
  TRAININGS_NEEDED,
  buildAcademyFromViews,
  buildEstimatesFromViews,
  buildPotentialView,
  buildProjectionFromView,
  buildScoutingReportFromView,
  buildTypePrognoses,
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
        .filter((row) => filters.every(({ column, values, test: match }) => (match ? match(row[column]) : values.includes(row[column]))))
        .map(project);
      const query = {
        select(selected) { columns = selected; reads.push({ table, columns: selected }); return query; },
        eq(column, value) { filters.push({ column, values: [value] }); return query; },
        in(column, values) { filters.push({ column, values }); return query; },
        gt(column, value) { filters.push({ column, test: (cell) => cell > value }); return query; },
        gte(column, value) { filters.push({ column, test: (cell) => cell >= value }); return query; },
        then(resolve, reject) { return Promise.resolve({ data: rows(), error: null }).then(resolve, reject); },
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

// regel 16: testene læser aldrig vægur-tiden
const FIXED_CLOCK = new Date("2026-11-20T12:00:00Z");

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
  const estimates = await buildEstimatesFromViews(world(), { teamId: TEAM, riderIds: ["scouted", "stranger"], clock: FIXED_CLOCK });
  assert.deepEqual(Object.keys(estimates.scouted), ["potentialView"]);
  assert.deepEqual(estimates.stranger, { potentialView: { hidden: true, reason: "unscouted" } });
  assert.doesNotMatch(JSON.stringify(estimates), FORBIDDEN);
});

const reportInput = (over = {}) => ({
  clock: FIXED_CLOCK, // regel 16: fast ur, aldrig vægur
  teamId: TEAM,
  rider: { id: "scouted", primary_type: "climber", potentiale: 5.5 },
  own: false, level: 2, maxLevel: 3, looks: 2, age: 23,
  scout: { isDefault: false, name: "Scout A", tier: 3, overall: 70, hiredAt: null },
  generatedAt: "2026-11-05T10:00:00.000Z",
  ...over,
});

test("scouting-rapporten: potentialView, kig og scout, ingen gamle stjerner eller loft", async () => {
  const report = await buildScoutingReportFromView(world(), reportInput());
  assert.equal(Object.keys(report)[0], "potentialView");
  assert.equal(report.potentialView.value, 74);
  assert.equal(report.looks, 2);
  assert.equal(report.scout.name, "Scout A");
  for (const legacy of ["stars", "displayKey", "precision", "capsMissing", "value"]) {
    assert.ok(!(legacy in report), `${legacy} er den gamle model`);
  }
  assert.doesNotMatch(JSON.stringify(report), FORBIDDEN);
});

// #6110: prognosen pr. ryttertype er tilbage under skønnet. Rytteren er 23, evnerne ligger
// midt i feltet, og båndene bygges af serveren, så rå potentiale aldrig når svaret.
const SCOUT = { isDefault: false, name: "Scout A", tier: 3, overall: 70, hiredAt: null };
const roleInput = (over = {}) => reportInput({
  rider: { id: "scouted", primary_type: "climber", secondary_type: "gc", potentiale: 5.5 },
  bandScout: SCOUT,
  ...over,
});

test("scouting-rapporten: scoutet fremmed rytter får ét prognosetal pr. ryttertype, intet bånd", async () => {
  const report = await buildScoutingReportFromView(world(), roleInput());
  assert.equal(report.types.length, 8);
  for (const row of report.types) {
    assert.deepEqual(Object.keys(row), ["key", "now", "prog"], row.key);
    assert.ok(Number.isInteger(row.now) && Number.isInteger(row.prog), row.key);
    assert.ok(row.prog >= row.now, `${row.key}: prognosen står aldrig under niveauet i dag`);
  }
  assert.ok(report.types.some((row) => row.key === "climber"));
  assert.doesNotMatch(JSON.stringify(report), /progLo|progHi|ceilLo|ceilHi|loft/);
  assert.doesNotMatch(JSON.stringify(report), FORBIDDEN);
});

test("scouting-rapporten: egen rytter får hele listen", async () => {
  const report = await buildScoutingReportFromView(world(), roleInput({ own: true, level: 3 }));
  assert.equal(report.types.length, 8);
});

// Egen 22-årig rytter, der er gået frem i alle evner den seneste måned.
const growingWorld = (over = {}) => world({
  riders: [{ id: "scouted", team_id: TEAM, is_academy: false, best_role_rating: 50, birthdate: "2004-01-01", primary_type: "climber", secondary_type: "gc" }],
  seasons: [{ number: 4, status: "active" }],
  rider_derived_abilities: [{ rider_id: "scouted", ...abilitiesAt(50) }],
  rider_derived_ability_history: [
    { rider_id: "scouted", snapshot_date: "2026-10-15", season_number: 4, source: "daily", abilities: abilitiesAt(48) },
  ],
  rider_ability_race_day_history: [],
  ...over,
});
const growingInput = (over = {}) => roleInput({
  rider: { id: "scouted", birthdate: "2004-01-01", primary_type: "climber", secondary_type: "gc", potentiale: 5.5 },
  own: true, level: 3, ...over,
});

test("scouting-rapporten: den bedste rolle har samme tal som den samlede prognose", async () => {
  const report = await buildScoutingReportFromView(growingWorld(), growingInput());
  assert.equal(report.prognosisView.hidden, false);
  const climber = report.types.find((row) => row.key === "climber");
  assert.equal(climber.prog, report.prognosisView.value, "samme regel, samme tal");
  assert.ok(climber.prog > climber.now, "fremgang giver en prognose over niveauet i dag");
});

test("scouting-rapporten: uden fremgang står hver type på sit niveau i dag", async () => {
  const report = await buildScoutingReportFromView(growingWorld({ rider_derived_ability_history: [] }), growingInput());
  for (const row of report.types) assert.equal(row.prog, row.now, row.key);
});

test("scouting-rapporten: efter toppen vokser ingen type", async () => {
  const report = await buildScoutingReportFromView(
    growingWorld({ riders: [{ id: "scouted", team_id: TEAM, is_academy: false, best_role_rating: 50, birthdate: "1990-01-01", primary_type: "climber" }] }),
    growingInput({ rider: { id: "scouted", birthdate: "1990-01-01", primary_type: "climber", potentiale: 5.5 } }),
  );
  assert.equal(report.prognosisView.reason, "pastPeak");
  for (const row of report.types) assert.equal(row.prog, row.now, row.key);
});

test("buildTypePrognoses: målet for hver type er skønnet, flyttet med typens afstand i spejderens fremskrivning", () => {
  // Alle evner ens: hver rolle står på 50 i dag og er gået lige meget frem.
  const liveAbilities = abilitiesAt(50);
  const snapshots = [{ snapshot_date: "2026-10-15", abilities: abilitiesAt(48) }];
  const rider = { id: "r", primary_type: "climber" };
  const bands = [
    { key: "climber", now: 50, progLo: 60, progHi: 70 },
    { key: "gc", now: 50, progLo: 70, progHi: 80 },
    { key: "sprinter", now: 50, progLo: 30, progHi: 40 },
  ];
  const input = { bands, rider, liveAbilities, snapshots, today: "2026-11-20", estimate: 74, age: 22 };
  const best = buildTypePrognoses(input).find((row) => row.key === "climber").prog;
  const byKey = Object.fromEntries(buildTypePrognoses(input).map((row) => [row.key, row.prog]));
  // Bedste rolle (her climber) har skønnet som mål.
  assert.ok(byKey.climber > 50 && byKey.climber <= 74, "climber går mod skønnet");
  assert.ok(byKey.gc >= best, "en type spejderen ser højere, får aldrig et lavere tal");
  assert.equal(byKey.sprinter, 50, "et mål under niveauet i dag giver ingen fremgang");
  // Uden billeder er farten nul, og tallet er niveauet i dag.
  for (const row of buildTypePrognoses({ ...input, snapshots: [] })) assert.equal(row.prog, row.now, row.key);
});

test("scouting-rapporten: uscoutet, skjult og uden kig giver ingen liste", async () => {
  const stranger = await buildScoutingReportFromView(world(), roleInput({ rider: { id: "stranger", primary_type: "climber", potentiale: 2 }, level: 0, looks: 0 }));
  assert.ok(!("types" in stranger), "uscoutet");
  const noLooks = await buildScoutingReportFromView(world(), roleInput({ level: 0, looks: 0 }));
  assert.equal(noLooks.potentialView.value, 74, "skønnet står");
  assert.ok(!("types" in noLooks), "et gammelt skøn uden kig åbner ikke båndene");
});

test("scouting-rapporten: uden evner eller alder er der intet at fremskrive", async () => {
  const noAbilities = await buildScoutingReportFromView(world({ rider_derived_abilities: [] }), roleInput());
  assert.ok(!("types" in noAbilities));
  const noAge = await buildScoutingReportFromView(world(), roleInput({ age: null }));
  assert.ok(!("types" in noAge));
});

test("scouting-rapporten: XP-modellen slås kun op, når der er en liste at bygge", async () => {
  let loads = 0;
  const loadDevelopmentXp = async () => { loads += 1; return null; };
  await buildScoutingReportFromView(world(), roleInput({ loadDevelopmentXp }));
  assert.equal(loads, 1);
  await buildScoutingReportFromView(world(), roleInput({ rider: { id: "stranger", primary_type: "climber", potentiale: 2 }, level: 0, looks: 0, loadDevelopmentXp }));
  assert.equal(loads, 1, "uscoutet rytter bygger ingen liste");
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

const projectionInput = (over = {}) => ({
  clock: FIXED_CLOCK, // regel 16: fast ur, aldrig vægur
  teamId: TEAM, rider: { id: "scouted", primary_type: "climber" }, own: false, level: 2, maxLevel: 3, age: 23, ...over,
});

test("development-projection: potentialView, aldrig band, ceil, timing eller den gamle kurve", async () => {
  const supabase = world();
  const projection = await buildProjectionFromView(supabase, projectionInput());
  assert.equal(projection.potentialView.value, 74);
  for (const legacy of ["band", "ceil", "timing", "estimateLine"]) assert.ok(!(legacy in projection), `${legacy} må ikke være med`);
  assert.ok(!("prognosisView" in projection), "andres ryttere får aldrig en prognose");
  assert.doesNotMatch(JSON.stringify(projection), FORBIDDEN);
  const abilityRead = supabase.reads.find((read) => read.table === "rider_derived_abilities");
  assert.doesNotMatch(abilityRead.columns, /ability_caps|hidden_potential|\*/);
});

test("development-projection: skjult skøn", async () => {
  const projection = await buildProjectionFromView(world(), projectionInput({ rider: { id: "stranger", primary_type: "climber" } }));
  assert.equal(projection.capsMissing, false);
  assert.deepEqual(projection.potentialView, { hidden: true, reason: "unscouted" });
});

test("development-projection: skøn uden evner siger det ærligt", async () => {
  const projection = await buildProjectionFromView(world({ rider_derived_abilities: [] }), projectionInput());
  assert.equal(projection.capsMissing, true);
  assert.equal(projection.potentialView.value, 74);
});

test("akademiet: trup og kandidater svarer fra skønnet og mister de gamle felter", async () => {
  const out = await buildAcademyFromViews(world(), {
    teamId: TEAM, clock: FIXED_CLOCK,
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
  const estimates = await buildEstimatesFromViews(supabase, { teamId: TEAM, riderIds, clock: FIXED_CLOCK });
  const report = await buildScoutingReportFromView(supabase, reportInput());
  const projection = await buildProjectionFromView(supabase, projectionInput());
  const academy = await buildAcademyFromViews(supabase, { teamId: TEAM, roster: [{ id: "scouted" }], intake: [], clock: FIXED_CLOCK });
  const expected = estimates.scouted.potentialView;
  assert.deepEqual(report.potentialView, expected);
  assert.deepEqual(projection.potentialView, expected);
  assert.deepEqual(academy.roster[0].potentialView, expected);
});
