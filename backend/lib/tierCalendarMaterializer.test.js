import test from "node:test";
import assert from "node:assert/strict";
import { buildTierMaterializationPlan } from "./tierCalendarMaterializer.js";

const FROM = new Date("2026-07-01T00:00:00Z");

function catalog() {
  const rows = [];
  [8, 8, 8, 6, 5, 5, 5, 5, 5, 4, 4].forEach((st, i) => rows.push({ id: `ps-sr-${i}`, name: `Stage ${i}`, race_class: "ProSeries", race_type: "stage_race", stages: st }));
  for (let i = 0; i < 35; i++) rows.push({ id: `ps-od-${i}`, name: `Classic ${i}`, race_class: "ProSeries", race_type: "single", stages: 1 });
  [5, 4, 4, 4, 3].forEach((st, i) => rows.push({ id: `c1-sr-${i}`, name: `C1 ${i}`, race_class: "Class1", race_type: "stage_race", stages: st }));
  for (let i = 0; i < 7; i++) rows.push({ id: `c1-od-${i}`, name: `C1 Classic ${i}`, race_class: "Class1", race_type: "single", stages: 1 });
  return rows;
}

// Division 3: 4 puljer, men pulje 6 har 0 ægte managere → ingen kalender.
const pools = [
  { id: 4, tier: 3, realManagerCount: 11 },
  { id: 5, tier: 3, realManagerCount: 10 },
  { id: 6, tier: 3, realManagerCount: 0 },
  { id: 7, tier: 3, realManagerCount: 10 },
];

test("plan: kun LIVE puljer får en kalender (pulje 6 uden managere udeladt)", () => {
  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog: catalog(), from: FROM, baseSeed: 6 });
  assert.equal(tierPlans.length, 1, "kun tier 3");
  const ids = tierPlans[0].pools.map((p) => p.leagueDivisionId).sort((a, b) => a - b);
  assert.deepEqual(ids, [4, 5, 7]);
});

test("plan: alle puljer i tieren kører PRÆCIS samme løb (samme pool_race_id-sæt)", () => {
  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog: catalog(), from: FROM, baseSeed: 6 });
  const sets = tierPlans[0].pools.map((p) => p.raceRows.map((r) => r.pool_race_id).sort().join(","));
  assert.equal(new Set(sets).size, 1, "identisk løb-sæt på tværs af puljer");
});

test("plan: races-rækker beriges fra kataloget (name + race_class)", () => {
  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog: catalog(), from: FROM, baseSeed: 6 });
  for (const r of tierPlans[0].pools[0].raceRows) {
    assert.ok(typeof r.name === "string" && r.name.length > 0, "name fra katalog");
    assert.ok(["ProSeries", "Class1"].includes(r.race_class), "tier-3-klasse");
    assert.ok(Number.isInteger(r.game_day_start), "game_day_start sat");
  }
});

test("plan: stage-rækker har game_day + gyldig scheduled_at; game_day_start = min(game_day)", () => {
  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog: catalog(), from: FROM, baseSeed: 6 });
  const pool = tierPlans[0].pools[0];
  for (const s of pool.stageRows) {
    assert.ok(Number.isInteger(s.game_day));
    assert.ok(!Number.isNaN(Date.parse(s.scheduled_at)));
  }
  for (const r of pool.raceRows) {
    const mins = pool.stageRows.filter((s) => s.pool_race_id === r.pool_race_id).map((s) => s.game_day);
    assert.equal(r.game_day_start, Math.min(...mins), `game_day_start for ${r.pool_race_id}`);
  }
});

test("plan: kalenderen fylder hver dag (emptyDays 0)", () => {
  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog: catalog(), from: FROM, baseSeed: 6 });
  assert.equal(tierPlans[0].emptyDays, 0);
});

test("plan: deterministisk", () => {
  const a = buildTierMaterializationPlan({ pools, catalog: catalog(), from: FROM, baseSeed: 6 });
  const b = buildTierMaterializationPlan({ pools, catalog: catalog(), from: FROM, baseSeed: 6 });
  assert.deepEqual(a, b);
});

test("plan: intet løb deles på tværs af tiers (cross-division dedup — løb adskiller sig pr. division)", () => {
  // Delte klasser: tier1∩tier2 = OtherWorldTourA; tier2∩tier3 = ProSeries. Uden dedup ville
  // de samme løb kunne vælges af to tiers samtidig (Div 1 og Div 2 kører samme løb — forkert).
  const cat = [];
  for (let i = 0; i < 14; i++) cat.push({ id: `owa-sr-${i}`, name: `OWA SR ${i}`, race_class: "OtherWorldTourA", race_type: "stage_race", stages: 6 });
  for (let i = 0; i < 16; i++) cat.push({ id: `ps-sr-${i}`, name: `PS SR ${i}`, race_class: "ProSeries", race_type: "stage_race", stages: 6 });
  for (let i = 0; i < 6; i++) cat.push({ id: `c1-sr-${i}`, name: `C1 SR ${i}`, race_class: "Class1", race_type: "stage_race", stages: 4 });
  for (let i = 0; i < 10; i++) cat.push({ id: `mon-${i}`, name: `Mon ${i}`, race_class: "Monuments", race_type: "single", stages: 1 });
  for (let i = 0; i < 30; i++) cat.push({ id: `owa-od-${i}`, name: `OWA OD ${i}`, race_class: "OtherWorldTourA", race_type: "single", stages: 1 });
  for (let i = 0; i < 70; i++) cat.push({ id: `ps-od-${i}`, name: `PS OD ${i}`, race_class: "ProSeries", race_type: "single", stages: 1 });
  for (let i = 0; i < 10; i++) cat.push({ id: `c1-od-${i}`, name: `C1 OD ${i}`, race_class: "Class1", race_type: "single", stages: 1 });
  const multiPools = [
    { id: 1, tier: 1, realManagerCount: 5 },
    { id: 2, tier: 2, realManagerCount: 5 },
    { id: 4, tier: 3, realManagerCount: 5 },
  ];
  const { tierPlans } = buildTierMaterializationPlan({ pools: multiPools, catalog: cat, from: FROM });
  const idSets = tierPlans.map((tp) => new Set(tp.pools[0].raceRows.map((r) => r.pool_race_id)));
  for (let i = 0; i < idSets.length; i++) {
    for (let j = i + 1; j < idSets.length; j++) {
      const shared = [...idSets[i]].filter((id) => idSets[j].has(id));
      assert.equal(shared.length, 0, `tier ${tierPlans[i].tier} & ${tierPlans[j].tier} deler løb: ${shared.slice(0, 3).join(", ")}`);
    }
  }
});

test("plan: alt passer på 28 dage → unplaced 0 (eksponeret, ikke tavs cap)", () => {
  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog: catalog(), from: FROM, baseSeed: 6 });
  assert.equal(tierPlans[0].unplacedStages, 0);
  assert.equal(tierPlans[0].unplacedSingles, 0);
});

test("plan: løb der ikke kan pakkes rapporteres som unplaced (ingen tavs beskæring)", () => {
  // 3 real-dage kan umuligt rumme tier-3-sættet (9 etape + 20 endags) → pakkeren MÅ droppe,
  // og det skal eksponeres i planen, ikke skjules (jf. "ingen tavse caps").
  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog: catalog(), from: FROM, baseSeed: 6, realDays: 3 });
  const t = tierPlans[0];
  assert.ok(Number.isInteger(t.unplacedStages) && Number.isInteger(t.unplacedSingles), "unplaced-felter eksponeret som heltal");
  assert.ok(t.unplacedStages + t.unplacedSingles > 0, "droppede løb rapporteret");
});
