// #7471: ungdommens mini-udgaver af seniorloebene. Fixturen er et read-only snapshot
// (26/11) af seniorens D1-klasse-katalog og S5's D1-kalender (een pulje).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MINI_EDITION_RULES, MINI_SOURCE_CLASSES, RIDER_TYPES, MIN_GOALS_PER_RIDER_TYPE,
  miniEditionName, miniEditionExternalId, parseMiniEditionExternalId, miniEditionId, miniEditionStages,
  miniEditionDistanceScale, scaleDistanceBand, scaleAuthoredRoute, withMiniEditionRoutes, buildMiniEditionRow,
  riderTypeGoalsFor, miniStageIndexes, packMiniEditionCalendar, seniorAnchorsFromRows, seniorAnchorsFromPlan,
  calendarDayZero, isMiniEditionRow, loadSeniorMiniAnchors,
} from "./youthMiniEditions7471.js";
import { generateRaceStageProfiles } from "./raceStageProfileGenerator.js";
import { validateAuthoredRoute } from "./raceIdentityTypes.js";
import { buildTierMaterializationPlan } from "./tierCalendarMaterializer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(join(__dirname, "__fixtures__", "youthMiniEditions7471.json"), "utf8"));
const SQL = readFileSync(join(__dirname, "..", "..", "database", "2026-11-26-7471-youth-mini-editions.sql"), "utf8");
const SQUADS = ["u23", "junior"];
const FROM_S5 = new Date("2026-10-27T12:00:00Z");

const anchorsS5 = () => seniorAnchorsFromRows({
  races: fx.s5Division1.races, schedule: fx.s5Division1.schedule,
  externalIdByPoolRace: new Map(fx.catalog.map((c) => [c.id, c.external_id])),
});
const minisFor = (squad) => withMiniEditionRoutes(fx.catalog.map((c) => buildMiniEditionRow(c, squad)));

test("name, external_id and id follow the owner's naming rule and the migration's formula", () => {
  assert.equal(miniEditionName("De Vlaamse Ronde", "u23"), "De Vlaamse Ronde U23");
  assert.equal(miniEditionName("De Vlaamse Ronde", "junior"), "De Vlaamse Ronde Junior");
  assert.equal(miniEditionExternalId("abc", "junior"), "jun-mini-abc");
  assert.deepEqual(parseMiniEditionExternalId("u23-mini-abc"), { squad: "u23", seniorExternalId: "abc" });
  assert.equal(parseMiniEditionExternalId("u23-espoirs-france"), null, "the old youth catalog is not a mini edition");
  assert.equal(parseMiniEditionExternalId("abc"), null);
  const hex = createHash("md5").update("7471:u23:s-1").digest("hex");
  assert.equal(miniEditionId("s-1", "u23").replaceAll("-", ""), hex, "same bytes as md5(...)::uuid in SQL");
  assert.throws(() => miniEditionName("x", "senior"));
});

test("SQL mirrors the JS rules (prefix, label, GT stages, divisor, minimum, source classes)", () => {
  for (const squad of SQUADS) {
    const r = MINI_EDITION_RULES[squad];
    const re = new RegExp(`\\('${squad}',\\s*'${r.externalPrefix}',\\s*'${r.label}',\\s*${r.gtStages},\\s*${r.stageRaceDivisor}\\)`);
    assert.match(SQL, re, `${squad} VALUES row`);
    assert.equal(r.minStageRaceStages, 3);
  }
  assert.match(SQL, /GREATEST\(3, CEIL/);
  for (const c of MINI_SOURCE_CLASSES) assert.ok(SQL.includes(`'${c}'`), c);
  assert.match(SQL, /ON CONFLICT \(external_id\) DO NOTHING/);
  assert.doesNotMatch(SQL, /\b(UPDATE|DELETE|DROP|TRUNCATE)\b/i, "additive only");
});

test("stage counts: mini GTs 7/4, monuments 1, stage races shortened but never below 3 or above the senior", () => {
  const gt = fx.catalog.find((c) => c.race_class === "TourFrance");
  assert.equal(miniEditionStages(gt, "u23"), 7);
  assert.equal(miniEditionStages(gt, "junior"), 4);
  for (const c of fx.catalog) {
    for (const squad of SQUADS) {
      const n = miniEditionStages(c, squad);
      if (c.race_type !== "stage_race") assert.equal(n, 1);
      else if (!["TourFrance", "GiroVuelta"].includes(c.race_class)) {
        assert.ok(n >= Math.min(3, c.stages) && n <= c.stages, `${c.name} ${squad} ${n}`);
      }
    }
  }
});

test("mini rows keep the senior identity: class, type, terrain, race identity, signature, route", () => {
  for (const c of fx.catalog) {
    for (const squad of SQUADS) {
      const row = buildMiniEditionRow(c, squad);
      for (const k of ["race_class", "race_type", "terrain_archetype", "race_identity_type", "signature", "authored_route", "country"]) {
        assert.deepEqual(row[k], c[k] ?? null, `${c.name} ${k}`);
      }
      assert.equal(row.squad, squad);
      assert.ok(isMiniEditionRow(row));
    }
  }
});

test("distance scale only touches mini rows: senior and old youth rows are bit-identical", () => {
  const band = [150, 210];
  assert.deepEqual(scaleDistanceBand(band, { external_id: "28d2e64796e82b54" }), band);
  assert.deepEqual(scaleDistanceBand(band, { external_id: "u23-espoirs-france" }), band);
  assert.deepEqual(scaleDistanceBand(band, {}), band);
  assert.equal(miniEditionDistanceScale({ external_id: "u23-mini-x" }), 0.75);
  assert.equal(miniEditionDistanceScale({ external_id: "jun-mini-x" }), 0.6);
  assert.deepEqual(scaleDistanceBand(band, { external_id: "jun-mini-x" }), [90, 126]);
});

test("monument routes keep their signature and stay valid when shortened", () => {
  const monuments = fx.catalog.filter((c) => c.race_class === "Monuments");
  assert.equal(monuments.length, 5);
  for (const m of monuments) {
    for (const squad of SQUADS) {
      const f = MINI_EDITION_RULES[squad].distanceScale;
      const r = scaleAuthoredRoute(m.authored_route, f);
      assert.equal(validateAuthoredRoute(r), true, `${m.name} ${squad}`);
      assert.ok(Math.abs(r.distance_km - m.authored_route.distance_km * f) <= 0.5);
      // race_stage_profiles.distance_km og elevation_gain_m er heltal (junior-apply 27/11: "119.4").
      assert.ok(Number.isInteger(r.distance_km) && Number.isInteger(r.elevation_gain_m), `${m.name} ${squad}: heltal`);
      assert.deepEqual(r.climbs.map((c) => c.name), m.authored_route.climbs.map((c) => c.name), "same climbs");
      assert.ok(r.sectors.length >= 1 || m.authored_route.sectors.length === 0, "sectors survive");
    }
  }
  assert.equal(scaleAuthoredRoute(null, 0.6), null);
});

test("every mini row generates stage profiles (S5 model) with the right stage count and shorter stages", () => {
  for (const squad of SQUADS) {
    const ratios = [];
    for (const row of minisFor(squad)) {
      const stages = generateRaceStageProfiles(row, { profileModel: "s5" });
      assert.equal(stages.length, row.stages, row.name);
      if (row.race_class === "Monuments") {
        const senior = fx.catalog.find((c) => miniEditionExternalId(c.external_id, squad) === row.external_id);
        ratios.push(stages[0].distance_km / senior.authored_route.distance_km);
      }
    }
    const f = MINI_EDITION_RULES[squad].distanceScale;
    for (const r of ratios) assert.ok(Math.abs(r - f) < 0.02, `${squad} monument ratio ${r}`);
  }
});

test("rider-type goals: GTs serve climbers, all-rounders and time triallists (#8830), stage races add all-round", () => {
  const gt = fx.catalog.find((c) => c.race_class === "GiroVuelta");
  assert.deepEqual([...riderTypeGoalsFor(gt)].sort(), ["allround", "enkeltstart", "klatrer"]);
  assert.deepEqual([...riderTypeGoalsFor({ race_type: "single", terrain_archetype: "itt_classic" })], ["enkeltstart"]);
  assert.deepEqual([...riderTypeGoalsFor({ race_type: "single", terrain_archetype: "cobbled_classic" })], ["brosten"]);
  assert.deepEqual([...riderTypeGoalsFor({ race_type: "stage_race", race_identity_type: "sprinters", terrain_archetype: "mountain_tour" })].sort(), ["allround", "sprinter"]);
});

test("mini stages follow the senior's stages: first and last always included, evenly spread", () => {
  assert.deepEqual(miniStageIndexes(17, 7), [0, 3, 5, 8, 11, 13, 16]);
  assert.deepEqual(miniStageIndexes(18, 4), [0, 6, 11, 17]);
  assert.deepEqual(miniStageIndexes(1, 1), [0]);
  assert.deepEqual(miniStageIndexes(3, 5), [0, 1, 2]);
});

for (const squad of SQUADS) {
  test(`${squad}: packed on the S5 Division 1 calendar meets the owner's decisions`, () => {
    const anchors = anchorsS5();
    const rules = MINI_EDITION_RULES[squad];
    const packed = packMiniEditionCalendar({ squad, anchors, miniCatalog: minisFor(squad), from: FROM_S5, days: fx.s5Division1.days });
    assert.deepEqual(packed.violations, []);
    const s = packed.selection;
    assert.equal(s.gtCount, 3);
    assert.equal(s.monumentCount, 5);
    assert.ok(Math.abs(s.raceDays - rules.targetRaceDays) <= 2, `race days ${s.raceDays}`);
    assert.ok(s.overlapShare <= rules.overlapShare.max + 1e-9, `overlap ${s.overlapShare}`);
    for (const t of RIDER_TYPES) assert.ok(s.coverage[t] >= MIN_GOALS_PER_RIDER_TYPE, t);
    const gts = s.picked.filter((c) => ["TourFrance", "GiroVuelta"].includes(c.row.race_class));
    for (const g of gts) assert.equal(g.stages, rules.gtStages);

    // Beslutning 4: hver ungdomsetape ligger paa en af seniorudgavens game_days og datoer.
    const byAnchor = new Map(anchors.map((a) => [a.pool_race_id, a]));
    const scheduleMinutes = new Map();
    for (const a of anchors) for (const st of a.stages) {
      const key = new Date(st.scheduled_at).toISOString().slice(0, 16);
      scheduleMinutes.set(key, true);
    }
    for (const p of packed.placements) {
      const a = byAnchor.get(p.seniorPoolRaceId);
      const seniorDays = new Set(a.stages.map((x) => x.game_day));
      for (const st of p.stagesPlaced) assert.ok(seniorDays.has(st.game_day), `${p.id} gd ${st.game_day}`);
      assert.ok(p.stagesPlaced.every((st, i, arr) => i === 0 || st.game_day > arr[i - 1].game_day));
    }
    // Klokkeslaet: aldrig paa et senior-minut, aldrig to ungdomsetaper paa samme minut.
    const youth = new Set();
    for (const p of packed.placements) for (const st of p.stagesPlaced) {
      const day = new Date(Date.UTC(2026, 9, 28 + st.real_day)).toISOString().slice(0, 10);
      const slot = packed.slotsForDate(day)[st.lane];
      assert.ok(slot, `${p.id} stage ${st.stage_number} has a slot`);
      const key = `${day} ${slot}`;
      assert.ok(!youth.has(key), `two youth stages at ${key}`);
      youth.add(key);
    }
  });
}

test("same calendar for every youth pool in the tier, through the real materialization plan", () => {
  const squad = "u23";
  const pools = [0, 1, 2].map((i) => ({ id: 900 + i, tier: 1, pool_index: i, realManagerCount: 0, squad }));
  const { tierPlans } = buildTierMaterializationPlan({
    pools, catalog: minisFor(squad), from: FROM_S5, realDays: fx.s5Division1.days, squad,
    raceDayTarget: 140, seasonLastRaceDay: null, seasonTransitionAt: null, miniEditionAnchors: anchorsS5(),
  });
  assert.equal(tierPlans.length, 1);
  const [plan] = tierPlans;
  assert.deepEqual(plan.calendarViolations, []);
  const sig = (pp) => JSON.stringify(pp.stageRows.map((r) => [r.pool_race_id, r.stage_number, r.scheduled_at, r.game_day]));
  assert.equal(new Set(plan.pools.map(sig)).size, 1);
  assert.ok(plan.pools[0].raceRows.every((r) => / U23$/.test(r.name)));
});

test("anchors from a plan and from DB rows have the same shape", () => {
  const anchors = anchorsS5();
  const pool = {
    raceRows: fx.s5Division1.races.map((r) => ({ pool_race_id: r.pool_race_id, name: r.name, race_class: r.race_class, race_type: r.race_type, stages: r.stages })),
    stageRows: fx.s5Division1.schedule.map((s) => ({ pool_race_id: fx.s5Division1.races.find((r) => r.id === s.race_id).pool_race_id, stage_number: s.stage_number, game_day: s.game_day, scheduled_at: s.scheduled_at })),
  };
  const fromPlan = seniorAnchorsFromPlan({ tierPlan: { pools: [pool] }, catalog: fx.catalog });
  const norm = (list) => list.map((a) => [a.pool_race_id, a.external_id, a.stages.length]).sort();
  assert.deepEqual(norm(fromPlan), norm(anchors));
  assert.equal(calendarDayZero(FROM_S5), "2026-10-28");
});

test("loadSeniorMiniAnchors reads only SELECTs and returns the same anchors as the row helper", async () => {
  const tables = {
    league_divisions: [{ id: 7, tier: 1, squad: "senior", retired_at: null }],
    races: fx.s5Division1.races.map((r) => ({ ...r, league_division_id: 7, season_id: "s5", squad: "senior" })),
    race_stage_schedule: fx.s5Division1.schedule,
    race_pool: fx.catalog.map((c) => ({ id: c.id, external_id: c.external_id })),
  };
  const calls = [];
  const builder = (table) => {
    let rows = [...tables[table]];
    const q = {
      select: () => q, eq: (k, v) => { rows = rows.filter((r) => r[k] === v); return q; },
      is: (k, v) => { rows = rows.filter((r) => (r[k] ?? null) === v); return q; },
      or: () => q, order: () => q, in: (k, vs) => { rows = rows.filter((r) => vs.includes(r[k])); return q; },
      range: (a, b) => { rows = rows.slice(a, b + 1); return q; },
      then: (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej),
    };
    return q;
  };
  const supabase = { from: (t) => { calls.push(t); return builder(t); } };
  const anchors = await loadSeniorMiniAnchors({ supabase, seasonId: "s5" });
  const norm = (list) => list.map((a) => [a.pool_race_id, a.external_id, a.stages.length]).sort();
  assert.deepEqual(norm(anchors), norm(anchorsS5()));
  assert.deepEqual([...new Set(calls)].sort(), ["league_divisions", "race_pool", "race_stage_schedule", "races"]);
});

test("#8830 det gamle ungdomskatalog pensioneres blødt, kun naar mini-udgaverne findes", () => {
  const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../database/2026-11-26-8830-retire-old-youth-catalog.sql"), "utf8");
  for (const squad of ["u23", "junior"]) {
    assert.ok(sql.includes(`('${squad}', '${MINI_EDITION_RULES[squad].externalPrefix}')`), `${squad}: praefikset matcher JS-reglerne`);
  }
  assert.match(sql, /SET retired_at = now\(\)/);
  assert.match(sql, /rp\.retired_at IS NULL/);
  assert.match(sql, /NOT LIKE lvl\.prefix/);
  assert.match(sql, /EXISTS \(/);
  assert.doesNotMatch(sql, /\b(DELETE|INSERT|DROP|TRUNCATE)\b/i, "intet slettes (rule 38)");
});
