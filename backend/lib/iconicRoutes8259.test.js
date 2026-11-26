// #8259: S6-afslutningerne (stageProfileTypes.js afsnit 5) og forslagene til faste ruter for
// ikoniske loeb (iconicRoutes8259.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ICONIC_ROUTE_PROPOSALS_8259, iconicRouteSeedEntries8259 } from "./iconicRoutes8259.js";
import {
  ROAD_FINISH_WEIGHTS, COBBLES_FINISH_WEIGHTS, roadFinishWeightsFor, FINISH_MATRIX,
  DESCENT_LAST_TOP_WINDOW_KM, MOUNTAIN_DESCENT_LAST_TOP_WINDOW_KM, descentTopWindowFor,
} from "./stageProfileTypes.js";
import { validateAuthoredRoute } from "./raceIdentityTypes.js";
import { generateRaceStageProfiles } from "./raceStageProfileGenerator.js";
import { checkStage } from "./s5BenchmarkGate.js";
import { deriveTerrainType } from "./raceRouteGenerator.js";

const CATALOG = JSON.parse(readFileSync(new URL("./__fixtures__/racePoolCatalog.prod.json", import.meta.url), "utf8")).catalog;
const UPHILL = new Set(["punch", "wall_finish", "long_climb"]);

test("#8259 S6-vaegtene ligger inden for matrixen, og bjerg/hoejbjerg har ingen S6-raekke", () => {
  for (const table of [ROAD_FINISH_WEIGHTS, COBBLES_FINISH_WEIGHTS]) {
    for (const [terrain, items] of Object.entries(table)) {
      assert.ok(items.length > 0, terrain);
      for (const it of items) {
        assert.ok(FINISH_MATRIX[terrain].includes(it.value), `${terrain}: ${it.value} uden for matrixen`);
        assert.ok(it.weight > 0, `${terrain}: ${it.value} har vaegt 0`);
      }
    }
  }
  for (const t of ["mountain", "high_mountain"]) {
    assert.equal(roadFinishWeightsFor(t, t), null);
    assert.equal(roadFinishWeightsFor(t, "cobbles"), null);
  }
  assert.equal(roadFinishWeightsFor("hilly", "cobbles"), COBBLES_FINISH_WEIGHTS.hilly);
  assert.equal(roadFinishWeightsFor("hilly", "gravel"), ROAD_FINISH_WEIGHTS.hilly);
});

test("#8259 kuperet ender oftere opad end i flad spurt, og brosten sjaeldnere i nedkoersel end landevej", () => {
  const share = (items, pred) => items.filter((it) => pred(it.value)).reduce((s, it) => s + it.weight, 0) / items.reduce((s, it) => s + it.weight, 0);
  const hilly = ROAD_FINISH_WEIGHTS.hilly;
  assert.ok(share(hilly, (v) => UPHILL.has(v)) > share(hilly, (v) => v === "flat_sprint"));
  assert.ok(share(COBBLES_FINISH_WEIGHTS.hilly, (v) => v === "descent") < share(hilly, (v) => v === "descent"));
  // Boelget: spurten er stadig den hyppigste afslutning.
  const rolling = ROAD_FINISH_WEIGHTS.rolling;
  const top = rolling.reduce((a, b) => (b.weight > a.weight ? b : a));
  assert.equal(top.value, "flat_sprint");
});

test("#8259 nedkoerslen: kort vindue undtagen bjerg og hoejbjerg", () => {
  assert.ok(DESCENT_LAST_TOP_WINDOW_KM[1] < MOUNTAIN_DESCENT_LAST_TOP_WINDOW_KM[1]);
  for (const t of ["rolling", "hilly", "medium_mountain"]) assert.equal(descentTopWindowFor(t), DESCENT_LAST_TOP_WINDOW_KM);
  for (const t of ["mountain", "high_mountain"]) assert.equal(descentTopWindowFor(t), MOUNTAIN_DESCENT_LAST_TOP_WINDOW_KM);
});

test("#8259 genererede etaper uden for GT placerer en kuperet nedkoersels-top i det korte vindue", () => {
  let descents = 0;
  for (const archetype of ["hilly_classic", "puncheur", "hilly_tour", "balanced_week"]) {
    for (let s = 0; s < 30; s++) {
      const single = archetype.endsWith("classic") || archetype === "puncheur";
      const race = { id: `t-${archetype}`, external_id: `t-${archetype}`, name: "Ronde test", race_type: single ? "single" : "stage_race", stages: single ? 1 : 6, terrain_archetype: archetype, season_id: `s-${s}`, season_variant: 0 };
      for (const p of generateRaceStageProfiles(race, { profileModel: "s5" })) {
        assert.deepEqual(checkStage(p).violations, [], `${archetype} ${s} etape ${p.stage_number}`);
        if (p.finale_type !== "descent") continue;
        const terrain = deriveTerrainType(p.climbs);
        const last = p.climbs.reduce((a, b) => (b.crest_km >= a.crest_km ? b : a));
        const [lo, hi] = descentTopWindowFor(terrain);
        const toGo = p.distance_km - last.crest_km;
        assert.ok(toGo >= lo - 0.5 && toGo <= hi + 0.5, `${archetype} ${s}: top ${toGo} km før mål på ${terrain}`);
        descents += 1;
      }
    }
  }
  assert.ok(descents > 0, "ingen nedkørsler at måle");
});

test("#8259 forslagene peger paa rigtige endagsloeb i kataloget, med katalogets navn og klasse", () => {
  const seen = new Set();
  for (const p of ICONIC_ROUTE_PROPOSALS_8259) {
    assert.ok(!seen.has(p.external_id), `dublet ${p.external_id}`);
    seen.add(p.external_id);
    const c = CATALOG.find((r) => r.external_id === p.external_id);
    assert.ok(c, `${p.pool_name}: ${p.external_id} findes ikke i kataloget`);
    assert.equal(c.name, p.pool_name);
    assert.equal(c.race_class, p.race_class);
    assert.equal(c.race_type, "single");
    assert.notEqual(c.race_class, "Monuments", "monumenterne har allerede en fast rute");
    assert.ok(p.model && p.decisive, p.pool_name);
  }
  // Ejer: flere divisioner end kun 1. division.
  const classes = new Set(ICONIC_ROUTE_PROPOSALS_8259.map((p) => p.race_class));
  for (const c of ["OtherWorldTourB", "ProSeries", "Class1", "Class2"]) assert.ok(classes.has(c), `ingen forslag i ${c}`);
});

test("#8259 hver foreslaaet rute er gyldig og bestaar benchmark-gatens etape-tjek gennem den rigtige generator", () => {
  for (const p of ICONIC_ROUTE_PROPOSALS_8259) {
    assert.ok(validateAuthoredRoute(p.route), p.pool_name);
    // Generatorens haandskrevne-rute-sti gaelder i dag kun monumenter; testen laaner klassen
    // for at bygge ruten praecis som den ville blive bygget efter ejerens valg.
    const race = { id: p.external_id, external_id: p.external_id, name: p.pool_name, race_type: "single", race_class: "Monuments", stages: 1, season_id: "s6", season_variant: 0, authored_route: p.route };
    const [stage] = generateRaceStageProfiles(race, { profileModel: "s5" });
    assert.deepEqual(checkStage(stage).violations, [], p.pool_name);
    assert.equal(stage.finale_type, p.route.finale_type, p.pool_name);
    assert.equal(stage.distance_km, p.route.distance_km);
    // Fast rute: samme geometri i to saesoner, kun vejret maa skifte.
    const [again] = generateRaceStageProfiles({ ...race, season_id: "s7" }, { profileModel: "s5" });
    assert.deepEqual({ ...again, weather: null }, { ...stage, weather: null }, p.pool_name);
  }
});

test("#8259 forslagene: flad spurt er i mindretal, og brosten ender aldrig i en nedkoersel", () => {
  const flat = ICONIC_ROUTE_PROPOSALS_8259.filter((p) => p.route.finale_type === "flat_sprint").length;
  assert.ok(flat / ICONIC_ROUTE_PROPOSALS_8259.length < 0.5);
  assert.ok(ICONIC_ROUTE_PROPOSALS_8259.some((p) => UPHILL.has(p.route.finale_type)));
  const cobbled = ICONIC_ROUTE_PROPOSALS_8259.filter((p) => p.route.profile_type === "cobbles");
  assert.ok(cobbled.every((p) => p.route.sectors.length > 0 && p.route.finale_type !== "descent"));
});

test("#8259 seed-formen til migrationen: kun de valgte, alle felter med", () => {
  const all = iconicRouteSeedEntries8259();
  assert.equal(all.length, ICONIC_ROUTE_PROPOSALS_8259.length);
  const one = iconicRouteSeedEntries8259(["7afe652a93f56e13"]);
  assert.equal(one.length, 1);
  assert.deepEqual(Object.keys(one[0]), ["external_id", "race_identity_type", "signature", "authored_route"]);
});

test("#8830 migrationen for de faste ruter er genereret fra JS-kilden og er idempotent", async () => {
  const { buildIconicRoutesMigrationSql, ICONIC_ROUTES_MIGRATION_PATH } = await import("../scripts/dev/buildIconicRoutesMigration8259.mjs");
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(ICONIC_ROUTES_MIGRATION_PATH, "utf8").replace(/\r\n/g, "\n");
  assert.equal(sql, buildIconicRoutesMigrationSql(), "koer node backend/scripts/dev/buildIconicRoutesMigration8259.mjs");
  assert.equal((sql.match(/::jsonb\)/g) ?? []).length, ICONIC_ROUTE_PROPOSALS_8259.length);
  assert.match(sql, /IS DISTINCT FROM/);
  assert.match(sql, /race_type = 'single'/);
  assert.doesNotMatch(sql, /\b(DELETE|INSERT|DROP|TRUNCATE)\b/i);
});
