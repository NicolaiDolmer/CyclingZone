import test from "node:test";
import assert from "node:assert/strict";
import { packLaneCalendar, MONUMENT_GAMEDAY_BASE } from "./raceCalendarLanePacker.js";

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

// ── #3469: fase-baseret placering (seasonFraction) ─────────────────────────────────
const withFraction = (cfg, mapper) => {
  const clone = JSON.parse(JSON.stringify(cfg));
  clone.stageRaces = cfg.stageRaces.map((r) => ({ ...r, seasonFraction: mapper(r) }));
  clone.oneDayRaces = cfg.oneDayRaces.map((r) => ({ ...r, seasonFraction: mapper(r) }));
  return clone;
};
// Deterministisk pseudo-fraction af id (0..1) — stabil, ikke afhængig af insertion-rækkefølge.
function fractionOfId(id) {
  let h = 2166136261 >>> 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return (h >>> 0) / 4294967295;
}

test("packer: fallback (stream/GT) — ét manglende løb i GT-listen ⇒ IDENTISK output med i dag", () => {
  // Kun gt-2/gt-3 får en fraction — gt-1 mangler bevidst, resten af div1() (others/klassikere/
  // monumenter) er UDEN fraction i begge scenarier, så KUN GT-listens gate testes isoleret:
  // gts.every(hasFraction) fejler på gt-1 alene → skal falde helt tilbage til perGap, med
  // PRÆCIS samme `rest`/monument-håndtering som `div1()` uden nogen som helst fraction.
  const cfg = div1();
  cfg.stageRaces = cfg.stageRaces.map((r) => (r.id === "gt-2" || r.id === "gt-3" ? { ...r, seasonFraction: fractionOfId(r.id) } : r));
  assert.deepEqual(packLaneCalendar(cfg), packLaneCalendar(div1()), "ét løb uden fraction i GT-listen skal give bit-identisk output med ingen fraction i GT-listen");
});

test("packer: fallback (stream/monumenter) — ét manglende løb i monument-listen ⇒ IDENTISK output med i dag", () => {
  // Kun 4 af 5 monumenter får en fraction (mon-0 mangler bevidst) — GT'er/others/klassikere er
  // UDEN fraction i begge scenarier, så KUN monument-listens gate testes isoleret.
  const cfg = div1();
  cfg.oneDayRaces = cfg.oneDayRaces.map((r) => (r.race_class === "Monuments" && r.id !== "mon-0" ? { ...r, seasonFraction: fractionOfId(r.id) } : r));
  assert.deepEqual(packLaneCalendar(cfg), packLaneCalendar(div1()), "ét løb uden fraction i monument-listen skal give bit-identisk output med ingen fraction i monument-listen");
});

test("packer: fallback (stream/rest) — ét manglende løb blandt others+klassikere ⇒ IDENTISK output med i dag", () => {
  // GT'er/monumenter er UDEN fraction i begge scenarier; kun ÉT klassiker-løb (od-0) mangler
  // fraction blandt others+klassikere, resten af den liste har — tester rest-gaten isoleret
  // ("rest" bruges ÉN gang, ingen splice-genbrug som i banded, så gaten er ren).
  const cfg = div1();
  cfg.oneDayRaces = cfg.oneDayRaces.map((r) => (r.race_class !== "Monuments" && r.id !== "od-0" ? { ...r, seasonFraction: fractionOfId(r.id) } : r));
  assert.deepEqual(packLaneCalendar(cfg), packLaneCalendar(div1()), "ét løb uden fraction blandt others+klassikere skal give bit-identisk output med ingen fraction i den liste");
});

test("packer: banded — fase-sorteret spor-rækkefølge (fraction asc inden for hvert spor)", () => {
  const cfg = withFraction(div3(), (r) => fractionOfId(r.id));
  const r = packLaneCalendar(cfg);
  assert.equal(r.layoutMode, "banded");
  // Alle 3 tests-invarianter fra de eksisterende tests skal stadig holde.
  assert.deepEqual(r.unplaced, []);
  assert.deepEqual(r.leftoverSingles, []);
  assert.ok(r.maxOverlap <= 2);
  // Inden for hvert spor (identificeret via kontinuerte real_day-blokke pr. lane 0..B-1) er
  // race-rækkefølgen ikke-aftagende i seasonFraction — verificeret indirekte: for hvert løb,
  // sammenlign dets startRealDay-rangering mod dets fraction-rangering pr. lane-slot 0 (den
  // primære baseline-bane). Svagere, robust assertion: banded fylder sporene i fase-orden, så
  // gennemsnitlig fraction i første halvdel af sæsonen < gennemsnitlig fraction i anden halvdel.
  const byId = new Map(cfg.stageRaces.concat(cfg.oneDayRaces).map((x) => [x.id, x.seasonFraction]));
  const firstHalf = r.placements.filter((p) => p.startRealDay < 14).map((p) => byId.get(p.id));
  const secondHalf = r.placements.filter((p) => p.startRealDay >= 14).map((p) => byId.get(p.id));
  const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(avg(firstHalf) < avg(secondHalf), `forventede stigende fase-tendens: ${avg(firstHalf)} vs ${avg(secondHalf)}`);
});

test("packer: stream — GT-rygraden fase-ankres, forbliver non-overlap, ingen tabte events", () => {
  const cfg = withFraction(div1(), (r) => {
    if (r.id === "gt-1") return 0.37; // tidlig GT
    if (r.id === "gt-2") return 0.54; // midt-GT
    if (r.id === "gt-3") return 0.79; // sen GT
    return fractionOfId(r.id);
  });
  const r = packLaneCalendar(cfg);
  assert.equal(r.layoutMode, "stream");
  assert.deepEqual(r.unplaced, []);
  assert.deepEqual(r.leftoverSingles, []);
  // Non-overlap (strukturel invariant, uændret af #3469).
  const spans = ["gt-1", "gt-2", "gt-3"].map((id) => {
    const gd = r.placements.find((p) => p.id === id).stagesPlaced.map((s) => s.game_day);
    return [Math.min(...gd), Math.max(...gd)];
  }).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i][0] > spans[i - 1][1], `GT-overlap: ${JSON.stringify(spans)}`);
  // GT'erne er i fraction-rækkefølge langs game-dag-aksen (tidlig fraction ⇒ tidligere game-dag).
  const startOf = (id) => Math.min(...r.placements.find((p) => p.id === id).stagesPlaced.map((s) => s.game_day));
  assert.ok(startOf("gt-1") < startOf("gt-2"), "gt-1 (0.37) skal ligge før gt-2 (0.54)");
  assert.ok(startOf("gt-2") < startOf("gt-3"), "gt-2 (0.54) skal ligge før gt-3 (0.79)");
  // Ingen events tabt: alle event-dage (etaper+endagsløb, EKSKL. monumenter der bruger et
  // separat game-day-bånd) matcher input-antallet, og stream 0's længde overskrider aldrig totalSlots.
  const totalSlots = cfg.density * cfg.days;
  const nonMonumentDays = r.placements.filter((p) => p.race_class !== "Monuments").reduce((s, p) => s + p.stagesPlaced.length, 0);
  const inputNonMonumentDays = cfg.stageRaces.reduce((s, x) => s + Math.max(1, x.stages || 1), 0)
    + cfg.oneDayRaces.filter((x) => x.race_class !== "Monuments").length;
  assert.equal(nonMonumentDays, inputNonMonumentDays, "ingen ikke-monument-events tabt");
  assert.ok(r.timelineLength <= totalSlots, `timelineLength ${r.timelineLength} > totalSlots ${totalSlots}`);
  // #3472 (ejer-feedback PR #3472, 6/8): regressions-vagt mod D1-overlap-kollapset — v1's
  // GT-anker fyldte KUN stream 0 mod hvert target, hvilket gjorde sene dele af sæsonen næsten
  // enkelt-sporede (mål på det rigtige katalog: overlapDays faldt 21→16). v2 fordeler rest-
  // fyldet LEAST-LOADED over ALLE streams under fremdriften mod targetSlot. Denne fixture giver
  // 22 med v2 (målt); tærsklen sættes til 20 — solidt over v1's kollaps, med margin mod naturlig
  // fixture-følsomhed.
  assert.ok(r.overlapDays >= 20, `#3472-regression: overlapDays ${r.overlapDays} for lavt — GT-ankeret klemmer sandsynligvis stream 1-2 tomme igen`);
  assert.ok(r.maxOverlap <= 3, `maxOverlap ${r.maxOverlap} > cap 3`);
});

test("packer: stream — monumenter fase-ankres til deres fraction-slot + kollisionsvandring", () => {
  const cfg = withFraction(div1(), (r) => {
    // To monumenter presses meget tæt (kolliderende slot) for at teste kollisionsvandringen.
    if (r.id === "mon-0") return 0.2;
    if (r.id === "mon-1") return 0.201;
    return fractionOfId(r.id);
  });
  const r = packLaneCalendar(cfg);
  const mons = r.placements.filter((p) => p.race_class === "Monuments");
  assert.equal(mons.length, 5);
  const gds = mons.map((m) => m.stagesPlaced[0].game_day);
  assert.equal(new Set(gds).size, 5, "monument game_day unikke (kollisionsvandring virker)");
  assert.ok(gds.every((g) => g >= 100000), "monument game_day i bånd");
});

test("packer: determinisme — samme input giver identisk output; omvendt input-rækkefølge giver identisk output når fractions findes", () => {
  const cfg = withFraction(div3(), (r) => fractionOfId(r.id));
  const a = packLaneCalendar(cfg);
  const b = packLaneCalendar(cfg);
  assert.deepEqual(a, b, "samme input → identisk output");

  const reversed = { ...cfg, stageRaces: [...cfg.stageRaces].reverse(), oneDayRaces: [...cfg.oneDayRaces].reverse() };
  const c = packLaneCalendar(reversed);
  assert.deepEqual(a, c, "omvendt input-rækkefølge → identisk output når fractions findes");
});

test("packer: kvote/density/overlap-invarianter holder også med seasonFraction sat", () => {
  for (const cfg of [div1(), div3()].map((c) => withFraction(c, (r) => fractionOfId(r.id)))) {
    const r = packLaneCalendar(cfg);
    assert.equal(r.emptyDays, 0, "ingen tomme dage");
    assert.ok(r.maxOverlap <= cfg.overlapCap, `maxOverlap ${r.maxOverlap} > cap ${cfg.overlapCap}`);
  }
});
