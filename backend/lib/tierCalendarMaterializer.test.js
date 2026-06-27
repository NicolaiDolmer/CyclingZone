import test from "node:test";
import assert from "node:assert/strict";
import { buildTierMaterializationPlan, MONUMENT_GAMEDAY_BASE } from "./tierCalendarMaterializer.js";

const FROM = new Date("2026-06-28T00:00:00Z");

// Tier-3-katalog: ProSeries + Class1, > kvote 84.
function tier3Catalog() {
  const rows = [];
  [8, 6, 5, 5, 4].forEach((st, i) => rows.push({ id: `ps-sr-${i}`, name: `Stage ${i}`, race_class: "ProSeries", race_type: "stage_race", stages: st }));
  for (let i = 0; i < 40; i++) rows.push({ id: `ps-od-${i}`, name: `Classic ${i}`, race_class: "ProSeries", race_type: "single", stages: 1 });
  [5, 4, 4, 4, 3].forEach((st, i) => rows.push({ id: `c1-sr-${i}`, name: `C1 ${i}`, race_class: "Class1", race_type: "stage_race", stages: st }));
  for (let i = 0; i < 10; i++) rows.push({ id: `c1-od-${i}`, name: `C1 Classic ${i}`, race_class: "Class1", race_type: "single", stages: 1 });
  return rows;
}

const pools = [
  { id: 4, tier: 3, realManagerCount: 11 },
  { id: 5, tier: 3, realManagerCount: 10 },
  { id: 6, tier: 3, realManagerCount: 0 },
  { id: 7, tier: 3, realManagerCount: 10 },
];

test("plan: kun LIVE puljer får en kalender (pulje 6 uden managere udeladt)", () => {
  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog: tier3Catalog(), from: FROM });
  assert.equal(tierPlans.length, 1);
  assert.deepEqual(tierPlans[0].pools.map((p) => p.leagueDivisionId).sort((a, b) => a - b), [4, 5, 7]);
});

test("plan: div 3 rammer præcis 84, tæthed 3 hver dag, alt placeret", () => {
  const t = buildTierMaterializationPlan({ pools, catalog: tier3Catalog(), from: FROM }).tierPlans[0];
  assert.equal(t.quota, 84);
  assert.equal(t.totalGameDays, 84);
  assert.equal(t.quotaHit, true, `shortfall=${t.shortfall}`);
  assert.equal(t.emptyDays, 0);
  assert.ok(t.load.every((x) => x === 3), `tæthed ikke 3 hver dag: ${t.load.join(",")}`);
  assert.equal(t.unplacedStages, 0);
  assert.equal(t.unplacedSingles, 0);
});

test("plan: div 3 har masser af overlap (≥2 løb de fleste dage)", () => {
  const t = buildTierMaterializationPlan({ pools, catalog: tier3Catalog(), from: FROM }).tierPlans[0];
  assert.ok(t.overlapDays >= 20, `for få overlap-dage i div3: ${t.overlapDays}/28`);
});

test("plan: alle puljer i tieren kører PRÆCIS samme løb-sæt", () => {
  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog: tier3Catalog(), from: FROM });
  const sets = tierPlans[0].pools.map((p) => p.raceRows.map((r) => r.pool_race_id).sort().join(","));
  assert.equal(new Set(sets).size, 1);
});

test("plan: races-rækker beriges (name + race_class + game_day_start i [0,28))", () => {
  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog: tier3Catalog(), from: FROM });
  for (const r of tierPlans[0].pools[0].raceRows) {
    assert.ok(typeof r.name === "string" && r.name.length > 0);
    assert.ok(["ProSeries", "Class1"].includes(r.race_class));
    assert.ok(Number.isInteger(r.game_day_start) && r.game_day_start >= 0 && r.game_day_start < 28);
  }
});

test("plan: deterministisk", () => {
  const a = buildTierMaterializationPlan({ pools, catalog: tier3Catalog(), from: FROM });
  const b = buildTierMaterializationPlan({ pools, catalog: tier3Catalog(), from: FROM });
  assert.deepEqual(a, b);
});

// Fuldt prestige-katalog til Div 1+2+3.
function fullCatalog() {
  const rows = [];
  rows.push({ id: "gt-0", name: "Tour", race_class: "TourFrance", race_type: "stage_race", stages: 21 });
  rows.push({ id: "gt-1", name: "Giro", race_class: "GiroVuelta", race_type: "stage_race", stages: 21 });
  rows.push({ id: "gt-2", name: "Vuelta", race_class: "GiroVuelta", race_type: "stage_race", stages: 21 });
  for (let i = 0; i < 5; i++) rows.push({ id: `mon-${i}`, name: `Mon ${i}`, race_class: "Monuments", race_type: "single", stages: 1 });
  [8, 8, 7, 7, 6, 6, 6, 5].forEach((st, i) => rows.push({ id: `owa-sr-${i}`, name: `OWA ${i}`, race_class: "OtherWorldTourA", race_type: "stage_race", stages: st }));
  for (let i = 0; i < 6; i++) rows.push({ id: `owa-od-${i}`, name: `OWA OD ${i}`, race_class: "OtherWorldTourA", race_type: "single", stages: 1 });
  [7, 5].forEach((st, i) => rows.push({ id: `owb-sr-${i}`, name: `OWB ${i}`, race_class: "OtherWorldTourB", race_type: "stage_race", stages: st }));
  for (let i = 0; i < 8; i++) rows.push({ id: `owb-od-${i}`, name: `OWB OD ${i}`, race_class: "OtherWorldTourB", race_type: "single", stages: 1 });
  for (let i = 0; i < 24; i++) rows.push({ id: `ps-sr-${i}`, name: `PS ${i}`, race_class: "ProSeries", race_type: "stage_race", stages: 5 });
  for (let i = 0; i < 70; i++) rows.push({ id: `ps-od-${i}`, name: `PS OD ${i}`, race_class: "ProSeries", race_type: "single", stages: 1 });
  [5, 4, 4, 4, 3].forEach((st, i) => rows.push({ id: `c1-sr-${i}`, name: `C1 ${i}`, race_class: "Class1", race_type: "stage_race", stages: st }));
  for (let i = 0; i < 12; i++) rows.push({ id: `c1-od-${i}`, name: `C1 OD ${i}`, race_class: "Class1", race_type: "single", stages: 1 });
  return rows;
}
const fullPools = [
  { id: 1, tier: 1, realManagerCount: 5 },
  { id: 2, tier: 2, realManagerCount: 5 },
  { id: 4, tier: 3, realManagerCount: 5 },
];

test("plan: cross-division dedup — intet løb deles mellem to divisioner", () => {
  const { tierPlans } = buildTierMaterializationPlan({ pools: fullPools, catalog: fullCatalog(), from: FROM });
  const idSets = tierPlans.map((tp) => new Set(tp.pools[0].raceRows.map((r) => r.pool_race_id)));
  for (let i = 0; i < idSets.length; i++) for (let j = i + 1; j < idSets.length; j++) {
    const shared = [...idSets[i]].filter((id) => idSets[j].has(id));
    assert.equal(shared.length, 0, `tier ${tierPlans[i].tier}&${tierPlans[j].tier} deler: ${shared.slice(0, 3)}`);
  }
});

test("plan: hver division rammer sin præcise kvote (140/112/84)", () => {
  const byTier = Object.fromEntries(buildTierMaterializationPlan({ pools: fullPools, catalog: fullCatalog(), from: FROM }).tierPlans.map((t) => [t.tier, t]));
  assert.equal(byTier[1].totalGameDays, 140);
  assert.equal(byTier[2].totalGameDays, 112);
  assert.equal(byTier[3].totalGameDays, 84);
  for (const t of [1, 2, 3]) assert.equal(byTier[t].quotaHit, true, `tier ${t} shortfall ${byTier[t].shortfall}`);
});

test("plan: Div 1 får alle 3 Grand Tours + alle 5 monumenter; div 3 ingen Grand Tour", () => {
  const tp = buildTierMaterializationPlan({ pools: fullPools, catalog: fullCatalog(), from: FROM }).tierPlans;
  const div1 = new Set(tp.find((t) => t.tier === 1).pools[0].raceRows.map((r) => r.pool_race_id));
  const div3 = tp.find((t) => t.tier === 3).pools[0].raceRows;
  assert.ok(["gt-0", "gt-1", "gt-2"].every((id) => div1.has(id)), "GT i div1");
  assert.ok([0, 1, 2, 3, 4].every((i) => div1.has(`mon-${i}`)), "monumenter i div1");
  assert.ok(!div3.some((r) => ["TourFrance", "GiroVuelta"].includes(r.race_class)), "ingen GT i div3");
});

test("plan: Grand Tour komprimeres til ceil(21/5)=5 dage (rygrad, ikke 1 etape/dag)", () => {
  const div1 = buildTierMaterializationPlan({ pools: fullPools, catalog: fullCatalog(), from: FROM }).tierPlans.find((t) => t.tier === 1).pools[0];
  for (const id of ["gt-0", "gt-1", "gt-2"]) {
    const days = new Set(div1.stageRows.filter((s) => s.pool_race_id === id).map((s) => Date.parse(s.scheduled_at) - (Date.parse(s.scheduled_at) % 86400000)));
    assert.ok(days.size <= 6, `Grand Tour ${id} spænder ${days.size} dage (forventet ~5, komprimeret)`);
  }
});

test("plan: monumenter får game_day i binding-fri båndet; game_day_start = almindelig dag", () => {
  const div1 = buildTierMaterializationPlan({ pools: fullPools, catalog: fullCatalog(), from: FROM }).tierPlans.find((t) => t.tier === 1).pools[0];
  const monRows = div1.raceRows.filter((r) => r.race_class === "Monuments");
  assert.equal(monRows.length, 5);
  for (const m of monRows) {
    assert.ok(m.game_day_start >= 0 && m.game_day_start < 28, "monument game_day_start = almindelig dag");
    const sched = div1.stageRows.filter((s) => s.pool_race_id === m.pool_race_id);
    assert.ok(sched.every((s) => s.game_day >= MONUMENT_GAMEDAY_BASE), "monument schedule game_day i båndet");
  }
  // ikke-monumenter: game_day = real_day (lille ordinal)
  const gt = div1.stageRows.filter((s) => s.pool_race_id === "gt-0");
  assert.ok(gt.every((s) => s.game_day < 28), "Grand Tour game_day = real_day");
});
