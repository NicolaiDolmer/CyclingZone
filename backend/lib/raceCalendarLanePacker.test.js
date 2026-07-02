import test from "node:test";
import assert from "node:assert/strict";
import { packLaneCalendar, MONUMENT_GAMEDAY_BASE, assertNoInFlightOverlap } from "./raceCalendarLanePacker.js";

// Div 1: 3 Grand Tours (21) + mindre etapeløb + 5 monumenter + klassikere = 140 events (5×28).
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
  return { stageRaces, oneDayRaces, density: 5, days: 28, overlapCap: 3 };
}
// Div 3: 11 etapeløb (49 game-days) + 35 klassikere = 84 events (3×28). Ingen GT, ingen monument.
function div3() {
  const stageRaces = [5, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4].map((st, i) => ({ id: `sr-${i}`, stages: st, race_class: "ProSeries" }));
  const oneDayRaces = Array.from({ length: 35 }, (_, i) => ({ id: `od-${i}`, race_class: "ProSeries" }));
  return { stageRaces, oneDayRaces, density: 3, days: 28, overlapCap: 2 };
}

const eventsOf = (r) => r.placements.reduce((s, p) => s + p.stagesPlaced.length, 0);

test("packer: hver IRL-dag har PRÆCIS density; ingen tomme dage; alt placeret", () => {
  for (const cfg of [div1(), div3()]) {
    const r = packLaneCalendar(cfg);
    assert.deepEqual(r.unplaced, [], "ingen uplacerede etapeløb");
    assert.deepEqual(r.leftoverSingles, [], "ingen uplacerede endagsløb");
    for (let d = 0; d < cfg.days; d++) assert.equal(r.load[d], cfg.density, `dag ${d}: ${r.load[d]}≠${cfg.density}`);
    assert.equal(eventsOf(r), cfg.density * cfg.days, "totalt antal events = density×days");
  }
});

test("packer: HARD — overlap (forskellige binding-løb pr. game-dag) overstiger aldrig cap", () => {
  for (const cfg of [div1(), div3()]) {
    const r = packLaneCalendar(cfg);
    assert.ok(r.maxOverlap <= cfg.overlapCap, `maxOverlap ${r.maxOverlap} > cap ${cfg.overlapCap}`);
    // Verificér også uafhængigt fra rå game_day-spans (ikke kun pakkerens egen tæller).
    const spans = r.placements
      .filter((p) => p.stagesPlaced.every((s) => s.game_day < MONUMENT_GAMEDAY_BASE))
      .map((p) => [Math.min(...p.stagesPlaced.map((s) => s.game_day)), Math.max(...p.stagesPlaced.map((s) => s.game_day))]);
    const hi = Math.max(...spans.map((s) => s[1]));
    for (let g = 0; g <= hi; g++) {
      const conc = spans.filter(([a, b]) => a <= g && b >= g).length;
      assert.ok(conc <= cfg.overlapCap, `game-dag ${g}: overlap ${conc} > cap ${cfg.overlapCap}`);
    }
  }
});

test("packer: kronologi — hver etape sin egen game-dag; et N-etapers løb spænder N game-dage", () => {
  const r = packLaneCalendar(div1());
  for (const src of div1().stageRaces) {
    const p = r.placements.find((x) => x.id === src.id);
    assert.equal(p.stagesPlaced.length, src.stages);
    const gds = p.stagesPlaced.map((s) => s.game_day).sort((a, b) => a - b);
    assert.equal(new Set(gds).size, src.stages, `${src.id}: etaper deler game-dag`);
    assert.equal(gds[gds.length - 1] - gds[0], src.stages - 1, `${src.id}: game-dage ikke sammenhængende`);
  }
});

test("packer: et løbs etaper er real_day-monotone (spilles forfra)", () => {
  for (const cfg of [div1(), div3()]) {
    const r = packLaneCalendar(cfg);
    for (const p of r.placements) {
      const seq = p.stagesPlaced.slice().sort((a, b) => a.stage_number - b.stage_number);
      for (let i = 1; i < seq.length; i++) {
        const prevSlot = seq[i - 1].real_day * cfg.density + seq[i - 1].lane;
        const curSlot = seq[i].real_day * cfg.density + seq[i].lane;
        assert.ok(curSlot > prevSlot, `${p.id} etape ${i + 1} ikke efter forrige`);
      }
    }
  }
});

test("packer: de 3 Grand Tours overlapper IKKE hinanden (game-dag-spans disjunkte)", () => {
  const r = packLaneCalendar(div1());
  const spans = ["gt-1", "gt-2", "gt-3"].map((id) => {
    const gd = r.placements.find((p) => p.id === id).stagesPlaced.map((s) => s.game_day);
    return [Math.min(...gd), Math.max(...gd)];
  }).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i][0] > spans[i - 1][1], `GT-overlap: ${JSON.stringify(spans)}`);
});

test("packer: under en Grand Tour kører andre løb samtidig (ægte overlap findes)", () => {
  const r = packLaneCalendar(div1());
  const gt = r.placements.find((p) => p.id === "gt-1");
  const [a, b] = [Math.min(...gt.stagesPlaced.map((s) => s.game_day)), Math.max(...gt.stagesPlaced.map((s) => s.game_day))];
  const overlaps = r.placements.some((p) => p.id !== "gt-1" && p.stagesPlaced.some((s) => s.game_day < MONUMENT_GAMEDAY_BASE && s.game_day >= a && s.game_day <= b));
  assert.ok(overlaps, "intet andet løb overlapper GT i game-dag-rum");
});

test("packer: monumenter binding-fri (game_day i bånd, unikke) og spredt over IRL-dage", () => {
  const r = packLaneCalendar(div1());
  const mons = r.placements.filter((p) => p.race_class === "Monuments");
  assert.equal(mons.length, 5);
  const gds = mons.map((m) => m.stagesPlaced[0].game_day);
  assert.ok(gds.every((g) => g >= MONUMENT_GAMEDAY_BASE), "monument game_day i bånd");
  assert.equal(new Set(gds).size, 5, "monument game_day unikke");
  const monDays = mons.map((m) => m.stagesPlaced[0].real_day);
  assert.ok(Math.max(...monDays) - Math.min(...monDays) >= 14, "monumenter spredt over sæsonen");
});

test("packer: div 3 — cap 2 overholdt, ægte overlap findes (binding-spillet lever)", () => {
  const r = packLaneCalendar(div3());
  assert.ok(r.maxOverlap <= 2, `div3 maxOverlap ${r.maxOverlap} > 2`);
  assert.ok((r.overlapHistogram[2] || 0) >= 14, `div3 for få 2-overlap game-dage: ${JSON.stringify(r.overlapHistogram)}`);
});

test("packer: div 3 — BANDED blanding (solo + 2), INGEN straddle", () => {
  const r = packLaneCalendar(div3());
  assert.equal(r.layoutMode, "banded", "div3 skal bruge banded-layout");
  assert.equal(r.straddleGameDays, 0, "div3 må ikke have straddle");
  assert.ok((r.overlapHistogram[1] || 0) > 0 && (r.overlapHistogram[2] || 0) > 0, `div3 skal være en blanding: ${JSON.stringify(r.overlapHistogram)}`);
});

test("packer: div 1 — STREAM-fallback (monumenter til stede)", () => {
  const r = packLaneCalendar(div1());
  assert.equal(r.layoutMode, "stream", "div1 (monumenter) skal bruge stream-layout");
  assert.ok(r.maxOverlap <= 3, `div1 maxOverlap ${r.maxOverlap} > 3`);
});

test("packer: deterministisk", () => {
  assert.deepEqual(packLaneCalendar(div1()), packLaneCalendar(div1()));
  assert.deepEqual(packLaneCalendar(div3()), packLaneCalendar(div3()));
});

test("packer: tom input → ingen placements, alle dage tomme", () => {
  const r = packLaneCalendar({ density: 3, days: 10, overlapCap: 2 });
  assert.deepEqual(r.placements, []);
  assert.equal(r.emptyDays, 10);
});

// #1856 forward-guard: en invariant der kaster hvis et NYT løb placeres oven i et
// IGANGVÆRENDE løbs resterende game_day-vindue (samme nøglerum). Ville have fanget den
// oprindelige overlap (nyt etapeløb schedulet oven på den igangværende La Corsa).
const gd = (id, gds) => ({ id, stagesPlaced: gds.map((g, i) => ({ stage_number: i + 1, game_day: g })) });

test("assertNoInFlightOverlap: intet optaget vindue → altid ok", () => {
  assert.equal(assertNoInFlightOverlap({ placements: [gd("new", [0, 1, 2])], occupiedWindows: [] }), true);
  assert.equal(assertNoInFlightOverlap({ placements: [gd("new", [0, 1, 2])] }), true);
});

test("assertNoInFlightOverlap: nyt løb der IKKE rører in-flight vinduet → ok", () => {
  // In-flight optager game_day 5..6; nyt løb 0..3 → ingen overlap.
  assert.equal(assertNoInFlightOverlap({
    placements: [gd("new", [0, 1, 2, 3])],
    occupiedWindows: [{ start: 5, end: 6, raceId: "la-corsa" }],
  }), true);
});

test("assertNoInFlightOverlap: nyt løb oven på in-flight vinduet → kaster (regression #1856)", () => {
  // In-flight La Corsa resterende game_day 6..6; nyt etapeløb 4..7 overlapper på game_day 6/7.
  assert.throws(
    () => assertNoInFlightOverlap({
      placements: [gd("new-stage-race", [4, 5, 6, 7])],
      occupiedWindows: [{ start: 6, end: 6, raceId: "la-corsa" }],
    }),
    /in-flight overlap invariant.*new-stage-race.*la-corsa/s,
    "nyt løb oven på in-flight vindue skal kaste",
  );
});

test("assertNoInFlightOverlap: monument-etaper (game_day i bånd) binder ikke → ok trods 'overlap'", () => {
  const monument = { id: "mon", stagesPlaced: [{ stage_number: 1, game_day: MONUMENT_GAMEDAY_BASE + 3 }] };
  assert.equal(assertNoInFlightOverlap({
    placements: [monument],
    occupiedWindows: [{ start: MONUMENT_GAMEDAY_BASE + 3, end: MONUMENT_GAMEDAY_BASE + 3 }],
  }), true, "monument er binding-fri (game_day i bånd) → ingen invariant-brud");
});
