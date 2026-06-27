import test from "node:test";
import assert from "node:assert/strict";
import { packLaneCalendar, MONUMENT_GAMEDAY_BASE } from "./raceCalendarLanePacker.js";

// Div-1: 3 Grand Tours (21) + mindre etapeløb + monumenter + klassikere = præcis 140 game-days.
function div1() {
  const stageRaces = [
    { id: "gt-1", stages: 21, race_class: "TourFrance" },
    { id: "gt-2", stages: 21, race_class: "GiroVuelta" },
    { id: "gt-3", stages: 21, race_class: "GiroVuelta" },
    { id: "wt-1", stages: 8, race_class: "OtherWorldTourA" },
    { id: "wt-2", stages: 8, race_class: "OtherWorldTourA" },
    { id: "wt-3", stages: 7, race_class: "OtherWorldTourA" },
    { id: "wt-4", stages: 6, race_class: "OtherWorldTourA" },
  ]; // 92 stage game-days
  const oneDayRaces = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: `mon-${i}`, race_class: "Monuments" })),
    ...Array.from({ length: 43 }, (_, i) => ({ id: `od-${i}`, race_class: "OtherWorldTourA" })),
  ]; // 48 → total 140
  return { stageRaces, oneDayRaces, density: 5, days: 28 };
}
function div3() {
  const stageRaces = [];
  [5, 5, 5, 5, 4, 4].forEach((st, i) => stageRaces.push({ id: `sr-${i}`, stages: st, race_class: "ProSeries" }));
  const oneDayRaces = Array.from({ length: 56 }, (_, i) => ({ id: `od-${i}`, race_class: "ProSeries" }));
  return { stageRaces, oneDayRaces, density: 3, days: 28 }; // 28 + 56 = 84
}

test("lanepacker: hver dag PRÆCIS density; alt placeret; ingen tomme/tynde dage", () => {
  const r = packLaneCalendar(div1());
  assert.deepEqual(r.unplaced, []);
  assert.deepEqual(r.leftoverSingles, []);
  for (let d = 0; d < 28; d++) assert.equal(r.load[d], 5, `dag ${d}: ${r.load[d]}≠5`);
});

test("lanepacker: hver etape unik (dag,bane); bane i [0,density)", () => {
  const r = packLaneCalendar(div1());
  const seen = new Set();
  for (const p of r.placements) for (const st of p.stagesPlaced) {
    assert.ok(st.lane >= 0 && st.lane < 5);
    const k = `${st.real_day}:${st.lane}`;
    assert.ok(!seen.has(k), `dobbelt-booket ${k}`);
    seen.add(k);
  }
});

test("lanepacker: Grand Tour komprimeret (≤ density-1 etaper/dag) og ~6 dage", () => {
  const r = packLaneCalendar(div1());
  const gt = r.placements.find((p) => p.id === "gt-1");
  assert.equal(gt.stagesPlaced.length, 21);
  const perDay = {};
  for (const st of gt.stagesPlaced) perDay[st.real_day] = (perDay[st.real_day] || 0) + 1;
  assert.ok(Math.max(...Object.values(perDay)) <= 4, "GT højst 4/dag (1 bane fri til overlap)");
  assert.equal(Object.keys(perDay).length, 6, "GT spænder ceil(21/4)=6 dage");
});

test("lanepacker: under Grand Tour kører andre løb samtidig (overlap)", () => {
  const r = packLaneCalendar(div1());
  const gt = r.placements.find((p) => p.id === "gt-1");
  const gtDays = new Set(gt.stagesPlaced.map((s) => s.real_day));
  const other = r.placements.some((p) => p.id !== "gt-1" && p.stagesPlaced.some((s) => gtDays.has(s.real_day)));
  assert.ok(other, "intet andet løb overlapper Grand Tour");
});

test("lanepacker: de 3 Grand Tours overlapper IKKE hinanden", () => {
  const r = packLaneCalendar(div1());
  const spans = ["gt-1", "gt-2", "gt-3"].map((id) => {
    const ds = r.placements.find((p) => p.id === id).stagesPlaced.map((s) => s.real_day);
    return [Math.min(...ds), Math.max(...ds)];
  }).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i][0] > spans[i - 1][1], `GT overlap: ${JSON.stringify(spans)}`);
});

test("lanepacker: monumenter binding-fri (game_day i bånd, unikke); andre game_day=real_day", () => {
  const r = packLaneCalendar(div1());
  const mons = r.placements.filter((p) => p.race_class === "Monuments");
  assert.equal(mons.length, 5);
  const gds = mons.map((m) => m.stagesPlaced[0].game_day);
  assert.ok(gds.every((g) => g >= MONUMENT_GAMEDAY_BASE));
  assert.equal(new Set(gds).size, 5);
  for (const p of r.placements.filter((p) => p.race_class !== "Monuments")) for (const st of p.stagesPlaced) assert.equal(st.game_day, st.real_day);
});

test("lanepacker: div 3 — præcis 3/dag, alt placeret, masser af overlap", () => {
  const r = packLaneCalendar(div3());
  assert.deepEqual(r.unplaced, []);
  assert.deepEqual(r.leftoverSingles, []);
  for (let d = 0; d < 28; d++) assert.equal(r.load[d], 3, `div3 dag ${d}: ${r.load[d]}≠3`);
  assert.ok(r.overlapDays >= 24, `for få overlap-dage: ${r.overlapDays}/28`);
});

test("lanepacker: hvert løbs etaper bevares; etapeløb dag-sammenhængende", () => {
  const r = packLaneCalendar(div1());
  for (const src of div1().stageRaces) {
    const p = r.placements.find((x) => x.id === src.id);
    assert.equal(p.stagesPlaced.length, src.stages);
    const ds = [...new Set(p.stagesPlaced.map((s) => s.real_day))].sort((a, b) => a - b);
    assert.equal(ds[ds.length - 1] - ds[0], ds.length - 1, `${src.id} ikke sammenhængende`);
  }
});

test("lanepacker: deterministisk", () => {
  assert.deepEqual(packLaneCalendar(div1()), packLaneCalendar(div1()));
});

test("lanepacker: tom input → ingen placements", () => {
  const r = packLaneCalendar({ density: 3, days: 10 });
  assert.deepEqual(r.placements, []);
  assert.equal(r.emptyDays, 10);
});
