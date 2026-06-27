import test from "node:test";
import assert from "node:assert/strict";
import { packDivisionCalendar } from "./raceCalendarPacker.js";

// Repræsentativt Division 3-input: 9 etapeløb (3 solo) + 20 klassikere, 28 dage.
function d3Input() {
  return {
    stageRaces: [
      { id: "sr-anatolie", stages: 8, solo: true },
      { id: "sr-malaisie", stages: 8 },
      { id: "sr-hauts", stages: 8, solo: true },
      { id: "sr-adriatique", stages: 6 },
      { id: "sr-danmark", stages: 5, solo: true },
      { id: "sr-belge", stages: 5 },
      { id: "sr-danube", stages: 5 },
      { id: "sr-vuelta", stages: 5 },
      { id: "sr-boucles", stages: 4 },
    ],
    oneDayRaces: Array.from({ length: 20 }, (_, i) => ({ id: `od-${String(i + 1).padStart(2, "0")}` })),
    realDays: 28,
    maxStagesPerRealDay: 5,
    maxConcurrentStageRaces: 2,
    forcedOverlaps: [["sr-malaisie", "sr-adriatique"]],
  };
}

test("packer: alle løb placeres (intet uplaceret) når kalenderen kan rumme dem", () => {
  const r = packDivisionCalendar(d3Input());
  assert.deepEqual(r.unplacedStages, []);
  assert.deepEqual(r.unplacedSingles, []);
});

test("packer: løb på hver eneste IRL-dag (ingen tomme dage)", () => {
  const r = packDivisionCalendar(d3Input());
  assert.equal(r.emptyDays, 0, `forventede 0 tomme dage, load=${r.load.join(",")}`);
});

test("packer: solo-etapeløb kører helt alene (load===1 på alle deres dage)", () => {
  const inp = d3Input();
  const r = packDivisionCalendar(inp);
  const soloIds = new Set(inp.stageRaces.filter((s) => s.solo).map((s) => s.id));
  const soloPlacements = r.placements.filter((p) => soloIds.has(p.id));
  assert.equal(soloPlacements.length, soloIds.size, "alle solo-løb placeret");
  for (const p of soloPlacements) {
    for (const st of p.stagesPlaced) {
      assert.equal(r.load[st.real_day], 1, `solo-løb ${p.id} har overlap på dag ${st.real_day} (load=${r.load[st.real_day]})`);
    }
  }
});

test("packer: etapeløb-samtidighed overstiger ikke maxConcurrentStageRaces", () => {
  const r = packDivisionCalendar(d3Input());
  assert.ok(Math.max(...r.stageLoad) <= 2, `max stage-concurrency ${Math.max(...r.stageLoad)} > 2`);
});

test("packer: mindst ét etapeløb-på-etapeløb overlap findes (når layoutet tillader)", () => {
  const r = packDivisionCalendar(d3Input());
  assert.ok(r.stageLoad.some((c) => c >= 2), "forventede mindst én dag med to etapeløb");
});

test("packer: game_day === real_day, i interval, og komprimering ≤ maxStagesPerRealDay/dag", () => {
  const inp = d3Input();
  const r = packDivisionCalendar(inp);
  for (const p of r.placements) {
    const perDay = {};
    for (const st of p.stagesPlaced) {
      assert.equal(st.game_day, st.real_day, "game_day skal = real_day (binding-nøgle)");
      assert.ok(st.real_day >= 0 && st.real_day < inp.realDays, `real_day ${st.real_day} uden for [0,${inp.realDays})`);
      perDay[st.real_day] = (perDay[st.real_day] || 0) + 1;
    }
    for (const [day, n] of Object.entries(perDay)) {
      assert.ok(n <= inp.maxStagesPerRealDay, `${p.id}: ${n} etaper på dag ${day} > ${inp.maxStagesPerRealDay}`);
    }
  }
});

test("packer: deterministisk — samme input giver identisk output", () => {
  const a = packDivisionCalendar(d3Input());
  const b = packDivisionCalendar(d3Input());
  assert.deepEqual(a.placements, b.placements);
  assert.deepEqual(a.load, b.load);
});

test("packer: hvert etapeløbs samlede etaper bevares", () => {
  const inp = d3Input();
  const r = packDivisionCalendar(inp);
  for (const src of inp.stageRaces) {
    const p = r.placements.find((x) => x.id === src.id);
    assert.equal(p.stagesPlaced.length, src.stages, `${src.id}: ${p.stagesPlaced.length} ≠ ${src.stages} etaper`);
  }
});

test("packer: tom-input → ingen placements, ingen crash", () => {
  const r = packDivisionCalendar({ realDays: 28 });
  assert.deepEqual(r.placements, []);
  assert.equal(r.emptyDays, 28);
});
