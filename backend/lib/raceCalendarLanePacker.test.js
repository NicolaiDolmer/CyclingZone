import test from "node:test";
import assert from "node:assert/strict";
import { packLaneCalendar, balanceStageRaceFractionAcrossGtWindows, reshapeCobblesFractionToTwoWindows, pickLeastLoadedStreamAwayFromZero } from "./raceCalendarLanePacker.js";

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
      .filter((p) => p.race_class !== "Monuments")
      .map((p) => [Math.min(...p.stagesPlaced.map((s) => s.game_day)), Math.max(...p.stagesPlaced.map((s) => s.game_day))]);
    const hi = Math.max(...spans.map((s) => s[1]));
    for (let g = 0; g <= hi; g++) {
      const conc = spans.filter(([a, b]) => a <= g && b >= g).length;
      assert.ok(conc <= cfg.overlapCap, `game-dag ${g}: overlap ${conc} > cap ${cfg.overlapCap}`);
    }
  }
});

// #3470: div1()-fixturen har INGEN date_text/seasonFraction/restDays på nogen løb — den
// rammer derfor pakkerens fraction-/hviledags-FRIE fallback-sti (bit-identisk med før
// #3469/#3470), som stadig SKAL være 100% kontinuert (ingen huller uden en beregnet
// restDays). Se "packer: stream — GT-hviledage" nedenfor for den NYE kontrakt
// (span = stages-1+restDays) når fractions+restDays ER sat.
test("packer: kronologi (fallback uden date_text/fractions) — hver etape sin egen game-dag; huller i et løbs span er KUN monument-indskud (#4075)", () => {
  const r = packLaneCalendar(div1());
  const monumentGds = new Set(r.placements.filter((p) => p.race_class === "Monuments").flatMap((p) => p.stagesPlaced.map((s) => s.game_day)));
  for (const src of div1().stageRaces) {
    const p = r.placements.find((x) => x.id === src.id);
    assert.equal(p.stagesPlaced.length, src.stages);
    const gds = p.stagesPlaced.map((s) => s.game_day).sort((a, b) => a - b);
    assert.equal(new Set(gds).size, src.stages, `${src.id}: etaper deler game-dag`);
    const gdSet = new Set(gds);
    for (let g = gds[0]; g <= gds[gds.length - 1]; g++) {
      if (!gdSet.has(g)) assert.ok(monumentGds.has(g), `${src.id}: hul paa game-dag ${g} er ikke et monument-indskud`);
    }
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
  const overlaps = r.placements.some((p) => p.id !== "gt-1" && p.race_class !== "Monuments" && p.stagesPlaced.some((s) => s.game_day >= a && s.game_day <= b));
  assert.ok(overlaps, "intet andet løb overlapper GT i game-dag-rum");
});

test("packer: monumenter har normal, EKSKLUSIV game_day i eget slot og er spredt over IRL-dage (#4075)", () => {
  const r = packLaneCalendar(div1());
  const mons = r.placements.filter((p) => p.race_class === "Monuments");
  assert.equal(mons.length, 5);
  const gds = mons.map((m) => m.stagesPlaced[0].game_day);
  assert.ok(gds.every((g) => Number.isInteger(g) && g >= 0 && g <= r.timelineLength), "monument game_day er en normal loebsdag");
  assert.equal(new Set(gds).size, 5, "monument game_day unikke");
  const otherGds = new Set(r.placements.filter((p) => p.race_class !== "Monuments").flatMap((p) => p.stagesPlaced.map((s) => s.game_day)));
  assert.ok(gds.every((g) => !otherGds.has(g)), "ingen andre loeb paa et monuments game_day (eksklusiv loebsdag, B2)");
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
  // #3472 (ejer-feedback PR #3472, 6/8 — to runder): regressions-vagt mod D1-overlap-
  // kollapset — v1's GT-anker fyldte KUN stream 0 mod hvert target, hvilket gjorde sene dele
  // af sæsonen næsten enkelt-sporede (mål på det rigtige katalog: overlapDays faldt 21→16).
  // v2 fordeler rest-fyldet LEAST-LOADED over ALLE streams under fremdriften mod targetSlot.
  // v3 (anden runde) tilføjer et lille eksplicit stream-0-KUN separations-buffer mellem
  // konsekutive GT'er (se næste test) — det koster ganske lidt overlap igen. Denne fixture
  // giver 21 med v3 (målt, ned fra v2's 22); tærsklen sættes til 18 — solidt over v1's
  // kollaps, med margin mod naturlig fixture-/katalog-følsomhed (det RIGTIGE katalogs tier 1
  // har et sparsommere restløbs-udvalg end denne fixture og lander på 20, jf. PR-body).
  assert.ok(r.overlapDays >= 18, `#3472-regression: overlapDays ${r.overlapDays} for lavt — GT-ankeret klemmer sandsynligvis stream 1-2 tomme igen`);
  assert.ok(r.maxOverlap <= 3, `maxOverlap ${r.maxOverlap} > cap 3`);
});

test("packer: stream — GT-real-day-adskillelse (#3472 v3) — konsekutive GT'er deler ALDRIG kalenderdag", () => {
  // Ejer-fund 6/8 (anden runde): game_day-non-overlap på stream 0 garanterede IKKE disjunkte
  // KALENDERDAGE (real_day) — flere spor interleaves ind i samme real_day ved slot-
  // komprimeringen. Denne test verificerer FAKTISKE real_day-spans (ikke kun game_day).
  const cfg = withFraction(div1(), (r) => {
    if (r.id === "gt-1") return 0.37;
    if (r.id === "gt-2") return 0.54;
    if (r.id === "gt-3") return 0.79;
    return fractionOfId(r.id);
  });
  const r = packLaneCalendar(cfg);
  assert.equal(r.layoutMode, "stream");
  assert.deepEqual(r.gtRealDaySeparationViolations, [], "diagnose() skal rapportere ZERO GT-real-day-brud");

  const spans = ["gt-1", "gt-2", "gt-3"].map((id) => {
    const rd = r.placements.find((p) => p.id === id).stagesPlaced.map((s) => s.real_day);
    return { id, start: Math.min(...rd), end: Math.max(...rd) };
  }).sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i++) {
    const gap = spans[i].start - spans[i - 1].end;
    assert.ok(gap >= 1, `${spans[i - 1].id} (slutter dag ${spans[i - 1].end}) og ${spans[i].id} (starter dag ${spans[i].start}) deler eller overlapper kalenderdag`);
  }
  // Fallback (ingen fractions) skal fortsat være urørt — ingen separations-logik kan udløses
  // uden GT-fractions, og diagnose() skal stadig returnere en tom violations-liste (ingen GT'er
  // identificeret som "adskilt for sent" når stien slet ikke rammer fase-ankeret).
  const fallback = packLaneCalendar(div1());
  assert.deepEqual(fallback.gtRealDaySeparationViolations, []);
});

test("packer: GT-real-day-adskillelse — fallback (ingen fractions) er BIT-IDENTISK med før #3472 v3", () => {
  // spineMinStages sendes nu til diagnose() (nyt param) — verificér at selve PLACERINGEN
  // (placements/load/overlap/etc.) forbliver uændret for den fraction-frie sti; kun det NYE
  // gtRealDaySeparationViolations-felt tilføjes (tomt, siden ingen GT-liste udløste separation).
  const r = packLaneCalendar(div1());
  assert.deepEqual(r.gtRealDaySeparationViolations, []);
  assert.equal(r.layoutMode, "stream");
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
  const otherGds = new Set(r.placements.filter((p) => p.race_class !== "Monuments").flatMap((p) => p.stagesPlaced.map((s) => s.game_day)));
  assert.ok(gds.every((g) => Number.isInteger(g) && g >= 0 && !otherGds.has(g)), "monument game_day er normal og eksklusiv (#4075)");
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

// ── #3470: GT-hviledage (KUN i STREAM's fase-ankrede gren) ─────────────────────────
test("packer: stream — GT-hviledage: 3 hviledage splitter GT i 4 segmenter, huller i game_day, TÆT stage_number 1..21, fillere fra puljen", () => {
  const cfg = withFraction(div1(), (r) => {
    if (r.id === "gt-1") return 0.37;
    if (r.id === "gt-2") return 0.54;
    if (r.id === "gt-3") return 0.79;
    return fractionOfId(r.id);
  });
  cfg.stageRaces = cfg.stageRaces.map((r) => (r.id === "gt-1" ? { ...r, restDays: 3 } : r));
  const r = packLaneCalendar(cfg);
  const gt1 = r.placements.find((p) => p.id === "gt-1");

  // Option A (#3470 verificeret arkitektur-grundlag): TÆT stage_number 1..21, uafbrudt —
  // hullet er i game_day, ALDRIG i stage_number.
  const stageNumbers = gt1.stagesPlaced.map((s) => s.stage_number).sort((a, b) => a - b);
  assert.deepEqual(stageNumbers, Array.from({ length: 21 }, (_, i) => i + 1), "stage_number skal være tæt 1..21");

  // Game_day-span = stages-1+restDays + evt. monument-indskud (#4075) — huller ud over
  // monument-gds skal være PRÆCIS de 3 hviledage.
  const gds = gt1.stagesPlaced.map((s) => s.game_day).sort((a, b) => a - b);
  const monumentGds = new Set(r.placements.filter((p) => p.race_class === "Monuments").flatMap((p) => p.stagesPlaced.map((s) => s.game_day)));
  const gdSet = new Set(gds);
  const holes = [];
  for (let g = gds[0]; g <= gds[gds.length - 1]; g++) if (!gdSet.has(g) && !monumentGds.has(g)) holes.push(g);
  assert.equal(holes.length, 3, "3 hviledags-huller i gt-1s game_day-span (ud over monument-indskud)");

  // Diagnostik (#3470 punkt 3): 3 planlagte, 3 fyldt, ingen degraderet.
  const report = r.grandTourRestDays.find((x) => x.id === "gt-1");
  assert.ok(report, "gt-1 skal have en grandTourRestDays-rapportlinje");
  assert.equal(report.restDaysPlanned, 3);
  assert.equal(report.restDaysFilled, 3);
  assert.deepEqual(report.degradedAfterStage, []);
  assert.equal(report.fillerIds.length, 3);

  // Fillerne er endagsløb der PRÆCIS fylder hullerne (spillerne beholder det daglige etape-flow).
  const fillerGameDays = report.fillerIds
    .map((id) => r.placements.find((p) => p.id === id).stagesPlaced[0].game_day)
    .sort((a, b) => a - b);
  assert.deepEqual(fillerGameDays, holes, "fillerne skal fylde PRÆCIS hullerne i gt-1s game_day-span");
  for (const fillerId of report.fillerIds) {
    const fp = r.placements.find((p) => p.id === fillerId);
    assert.equal(fp.stagesPlaced.length, 1, "filler skal være et endagsløb");
  }

  // #3470 (ejer-beslutning 7/8, afløser den midlertidige cap+1-tolerance fra rebase på
  // c3487416): diagnose()'s overlap-optælling er nu STAGE-baseret (kun løb der FAKTISK
  // kører en etape den pågældende game_day tæller med) i stedet for span-baseret (min..max)
  // — en GT på hviledag tæller derfor IKKE længere med i den dags overlap, og loftet er
  // atter det hårde cap (ingen +1-undtagelse for hviledags-slots).
  assert.ok(r.maxOverlap <= cfg.overlapCap, `maxOverlap ${r.maxOverlap} > cap ${cfg.overlapCap}`);
  assert.deepEqual(r.unplaced, []);
  assert.deepEqual(r.leftoverSingles, []);
  const spans = ["gt-1", "gt-2", "gt-3"].map((id) => {
    const gd = r.placements.find((p) => p.id === id).stagesPlaced.map((s) => s.game_day);
    return [Math.min(...gd), Math.max(...gd)];
  }).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i][0] > spans[i - 1][1], `GT-overlap: ${JSON.stringify(spans)}`);
});

test("packer: stream — GT-hviledage: uden fraction/restDays (0) forbliver ét sammenhængende segment (bit-identisk med #3469)", () => {
  const cfg = withFraction(div1(), (r) => {
    if (r.id === "gt-1") return 0.37;
    if (r.id === "gt-2") return 0.54;
    if (r.id === "gt-3") return 0.79;
    return fractionOfId(r.id);
  });
  const withRestDays = { ...cfg, stageRaces: cfg.stageRaces.map((r) => (r.id === "gt-1" ? { ...r, restDays: 0 } : r)) };
  assert.deepEqual(packLaneCalendar(withRestDays), packLaneCalendar(cfg), "restDays: 0 skal give bit-identisk output med restDays udeladt");
  const r = packLaneCalendar(cfg);
  const gt1 = r.placements.find((p) => p.id === "gt-1");
  const gds = gt1.stagesPlaced.map((s) => s.game_day).sort((a, b) => a - b);
  assert.equal(gds[gds.length - 1] - gds[0], 20, "uden restDays: span = stages-1 (ingen huller)");
  assert.deepEqual(r.grandTourRestDays.find((x) => x.id === "gt-1"), { id: "gt-1", name: null, stages: 21, restDaysPlanned: 0, restDaysFilled: 0, fillerIds: [], degradedAfterStage: [] });
});

test("packer: stream — GT-hviledage: intet endagsløb tilbage ⇒ degraderer ærligt (ingen tabte events, ingen huller indsat)", () => {
  const stageRaces = [{ id: "gt-only", stages: 21, race_class: "GrandTour", seasonFraction: 0.5, restDays: 3 }];
  const oneDayRaces = [{ id: "mon-1", race_class: "Monuments", seasonFraction: 0.9 }]; // tvinger stream-layout, ingen endagsløb-fillere til rådighed
  const cfg = { stageRaces, oneDayRaces, density: 2, days: 30, overlapCap: 2, spineMinStages: 15 };
  const r = packLaneCalendar(cfg);
  assert.equal(r.layoutMode, "stream");
  const gt = r.placements.find((p) => p.id === "gt-only");
  assert.equal(gt.stagesPlaced.length, 21, "alle 21 etaper skal stadig være placeret — ingen tabte events");
  const stageNumbers = gt.stagesPlaced.map((s) => s.stage_number).sort((a, b) => a - b);
  assert.deepEqual(stageNumbers, Array.from({ length: 21 }, (_, i) => i + 1));
  const gds = gt.stagesPlaced.map((s) => s.game_day).sort((a, b) => a - b);
  assert.equal(gds[gds.length - 1] - gds[0], 20, "fuldt degraderet: ingen huller indsat, span = stages-1");

  const report = r.grandTourRestDays.find((x) => x.id === "gt-only");
  assert.ok(report);
  assert.equal(report.restDaysPlanned, 3);
  assert.equal(report.restDaysFilled, 0);
  assert.deepEqual(report.degradedAfterStage, [6, 12, 18]);
  assert.deepEqual(report.fillerIds, []);
});

// ── #3470 supply-fix (6/8): reservér fillere FØR padding forbruger rest-køen grådigt ──
// Samme fejlklasse som reservations-fasen i tierRaceSelection.js (garanti-uden-forsyning) —
// uden reservationen "vandt" den almindelige gap-fill/least-loaded-fordeling ALLE
// endagsløb før GT'erne fik deres tur, og hviledagene degraderede selv med rigelig forsyning.

test("packer: stream — GT-hviledage (rigelig forsyning): ALLE 3 GT'ers hviledage reserveres og fyldes (0 degraderet)", () => {
  const cfg = withFraction(div1(), (r) => {
    if (r.id === "gt-1") return 0.37;
    if (r.id === "gt-2") return 0.54;
    if (r.id === "gt-3") return 0.79;
    return fractionOfId(r.id);
  });
  // Alle 3 GT'er får hviledage — 2+2+3 = 7 i alt. div1() har 43 od-* endagsløb, langt over behovet.
  cfg.stageRaces = cfg.stageRaces.map((r) => {
    if (r.id === "gt-1") return { ...r, restDays: 2 };
    if (r.id === "gt-2") return { ...r, restDays: 2 };
    if (r.id === "gt-3") return { ...r, restDays: 3 };
    return r;
  });
  const r = packLaneCalendar(cfg);
  assert.equal(r.grandTourRestDays.length, 3);
  let totalPlanned = 0, totalFilled = 0;
  for (const report of r.grandTourRestDays) {
    assert.equal(report.restDaysFilled, report.restDaysPlanned, `${report.id}: forventede ALLE hviledage fyldt med rigelig forsyning`);
    assert.deepEqual(report.degradedAfterStage, [], `${report.id}: ingen degradering forventet`);
    totalPlanned += report.restDaysPlanned;
    totalFilled += report.restDaysFilled;
  }
  assert.equal(totalPlanned, 7);
  assert.equal(totalFilled, 7);
  // Ingen filler genbrugt på tværs af GT'er (hver reserveret races-id optræder præcis én gang).
  const allFillerIds = r.grandTourRestDays.flatMap((rep) => rep.fillerIds);
  assert.equal(new Set(allFillerIds).size, allFillerIds.length, "ingen filler dobbelt-tildelt");
  // Kvote/events-regnskab uændret: intet tabt.
  assert.deepEqual(r.unplaced, []);
  assert.deepEqual(r.leftoverSingles, []);
});

test("packer: stream — GT-hviledage (knap forsyning): fordeles RETFÆRDIGT på tværs af GT'erne (alle får ≥1 før nogen får 2)", () => {
  // 3 GT'er, hver 2 hviledage (behov=6) — kun 4 endagsløb i puljen (knaphed).
  // Fraction-valg konstrueret så det deterministiske nærmeste-match er entydigt pr. runde:
  //   runde 0: gt-a(0.30)→od-1(0.31) · gt-b(0.50)→od-2(0.51) · gt-c(0.70)→od-3(0.71)
  //   runde 1: gt-a(0.30)→od-4(0.32, eneste tilbage) · gt-b/gt-c: puljen tom → degraderer
  const stageRaces = [
    { id: "gt-a", stages: 21, race_class: "GrandTour", seasonFraction: 0.30, restDays: 2 },
    { id: "gt-b", stages: 21, race_class: "GrandTour", seasonFraction: 0.50, restDays: 2 },
    { id: "gt-c", stages: 21, race_class: "GrandTour", seasonFraction: 0.70, restDays: 2 },
  ];
  const oneDayRaces = [
    { id: "mon-1", race_class: "Monuments", seasonFraction: 0.95 }, // tvinger stream-layout
    { id: "od-1", race_class: "ProSeries", seasonFraction: 0.31 },
    { id: "od-2", race_class: "ProSeries", seasonFraction: 0.51 },
    { id: "od-3", race_class: "ProSeries", seasonFraction: 0.71 },
    { id: "od-4", race_class: "ProSeries", seasonFraction: 0.32 },
  ];
  const cfg = { stageRaces, oneDayRaces, density: 4, days: 60, overlapCap: 3, spineMinStages: 15 };
  const r = packLaneCalendar(cfg);
  const byId = Object.fromEntries(r.grandTourRestDays.map((rep) => [rep.id, rep]));

  // Alle 3 GT'er fik MINDST 1 hviledag fyldt, FØR nogen fik 2 (fairness-garantien).
  assert.ok(byId["gt-a"].restDaysFilled >= 1);
  assert.ok(byId["gt-b"].restDaysFilled >= 1);
  assert.ok(byId["gt-c"].restDaysFilled >= 1);
  // Determinerede udfald (jf. fraction-konstruktionen ovenfor): gt-a fik begge (den var
  // først i fase-rækkefølge OG tættest på begge resterende kandidater i runde 1).
  assert.equal(byId["gt-a"].restDaysFilled, 2);
  assert.equal(byId["gt-b"].restDaysFilled, 1);
  assert.equal(byId["gt-c"].restDaysFilled, 1);
  assert.equal(byId["gt-b"].degradedAfterStage.length, 1);
  assert.equal(byId["gt-c"].degradedAfterStage.length, 1);
  // Total forbrug = hele puljen (4 endagsløb), intet spildt/genbrugt.
  const totalFilled = Object.values(byId).reduce((s, rep) => s + rep.restDaysFilled, 0);
  assert.equal(totalFilled, 4);
  const allFillerIds = Object.values(byId).flatMap((rep) => rep.fillerIds);
  assert.equal(new Set(allFillerIds).size, 4, "alle 4 endagsløb i puljen brugt, ingen dobbelttildeling");
  // Ingen tabte events for GT'erne selv.
  for (const id of ["gt-a", "gt-b", "gt-c"]) {
    assert.equal(r.placements.find((p) => p.id === id).stagesPlaced.length, 21);
  }
});

test("packer: stream — GT-hviledage (knap forsyning): reservationen fjerner IKKE de reserverede løb fra padding/least-loaded-fordelingen (ingen dobbelttælling)", () => {
  const stageRaces = [{ id: "gt-only", stages: 21, race_class: "GrandTour", seasonFraction: 0.5, restDays: 1 }];
  const oneDayRaces = [
    { id: "mon-1", race_class: "Monuments", seasonFraction: 0.9 },
    { id: "od-1", race_class: "ProSeries", seasonFraction: 0.5 },
    { id: "od-2", race_class: "ProSeries", seasonFraction: 0.1 },
  ];
  const cfg = { stageRaces, oneDayRaces, density: 2, days: 30, overlapCap: 2, spineMinStages: 15 };
  const r = packLaneCalendar(cfg);
  const report = r.grandTourRestDays.find((x) => x.id === "gt-only");
  assert.equal(report.restDaysFilled, 1);
  assert.deepEqual(report.fillerIds, ["od-1"]);
  // od-1 er placeret PRÆCIS én gang (som filler) — od-2 placeres separat af den normale
  // least-loaded-fordeling. Ingen løb optræder to gange i placements.
  const placedIds = r.placements.map((p) => p.id);
  assert.equal(new Set(placedIds).size, placedIds.length, "intet løb placeret to gange");
  assert.ok(r.placements.some((p) => p.id === "od-2"), "od-2 (ikke reserveret) skal stadig være placeret af den normale fordeling");
  assert.deepEqual(r.unplaced, []);
  assert.deepEqual(r.leftoverSingles, []);
});

test("packer: stream — GT-hviledage: determinisme (samme input → identisk output) + omvendt input-rækkefølge giver identisk output", () => {
  const cfg = withFraction(div1(), (r) => {
    if (r.id === "gt-1") return 0.37;
    if (r.id === "gt-2") return 0.54;
    if (r.id === "gt-3") return 0.79;
    return fractionOfId(r.id);
  });
  cfg.stageRaces = cfg.stageRaces.map((r) => {
    if (r.id === "gt-1") return { ...r, restDays: 2 };
    if (r.id === "gt-2") return { ...r, restDays: 3 };
    if (r.id === "gt-3") return { ...r, restDays: 2 };
    return r;
  });
  const a = packLaneCalendar(cfg);
  const b = packLaneCalendar(cfg);
  assert.deepEqual(a, b, "samme input → identisk output");

  const reversed = { ...cfg, stageRaces: [...cfg.stageRaces].reverse(), oneDayRaces: [...cfg.oneDayRaces].reverse() };
  const c = packLaneCalendar(reversed);
  assert.deepEqual(a, c, "omvendt input-rækkefølge → identisk output når fractions/restDays findes");
});

test("packer: stream — GT-hviledage (fallback, én GT uden fraction): reservationen kører ALDRIG i perGap-fallback-grenen, selv med restDays sat", () => {
  // Kun gt-2/gt-3 får en fraction (gt-1 mangler) — hele gtsByPhase-gaten fejler igen (som
  // #3469's egen test), SELV med restDays sat på alle 3 — reservationen bor inde i
  // gtsByPhase-grenen og må derfor aldrig røres her. restDays er derfor HELT INERT i
  // fallback-grenen: output skal være bit-identisk med div1() uden nogen restDays overhovedet.
  const cfg = div1();
  cfg.stageRaces = cfg.stageRaces.map((r) => {
    if (r.id === "gt-2") return { ...r, seasonFraction: fractionOfId(r.id), restDays: 2 };
    if (r.id === "gt-3") return { ...r, seasonFraction: fractionOfId(r.id), restDays: 2 };
    if (r.id === "gt-1") return { ...r, restDays: 3 }; // bevidst UDEN seasonFraction
    return r;
  });
  assert.deepEqual(packLaneCalendar(cfg), packLaneCalendar(div1()), "restDays uden ALLE GT'er har fraction skal give bit-identisk output med perGap-fallback (restDays helt inert)");
});

// ── #3470 (ejer-beslutning 7/8): overlap-optælling stage-baseret, ikke span-baseret ────────
// diagnose()'s maxOverlap/overlapHistogram tæller nu KUN game_days hvor et løb FAKTISK har
// en etape (ikke min..max-span) — en GT på hviledag tæller derfor ikke længere med. For løb
// UDEN huller er de to metoder matematisk identiske (gameDays-sættet ER hele [min,max]),
// hvilket denne test beviser eksplicit ved at genimplementere den GAMLE span-baserede
// beregning og kræve bit-for-bit samme facit på fixtures uden hviledage.
function referenceSpanBasedOverlap(placements) {
  const spans = placements
    .map((p) => [Math.min(...p.stagesPlaced.map((s) => s.game_day)), Math.max(...p.stagesPlaced.map((s) => s.game_day))]);
  const hi = spans.length ? Math.max(...spans.map((s) => s[1])) : -1;
  const overlapHistogram = {};
  let maxOverlap = 0;
  for (let g = 0; g <= hi; g++) {
    const n = spans.filter(([a, b]) => a <= g && b >= g).length;
    overlapHistogram[n] = (overlapHistogram[n] || 0) + 1;
    if (n > maxOverlap) maxOverlap = n;
  }
  return { maxOverlap, overlapHistogram };
}

test("packer: #3470 — for løb UDEN hviledage er stage-baseret og span-baseret overlap-optælling MATEMATISK IDENTISK (regressionsvagt, ejer-beslutning 7/8)", () => {
  // #4075: kun monument-FRIE fixtures — monument-indskud giver normale løb gd-huller
  // ved indskudspunktet, så span- og stage-basering divergerer bevidst i div1.
  const fixtures = [
    div3(),
    withFraction(div3(), (r) => fractionOfId(r.id)),
  ];
  for (const cfg of fixtures) {
    const r = packLaneCalendar(cfg);
    const ref = referenceSpanBasedOverlap(r.placements);
    assert.equal(r.maxOverlap, ref.maxOverlap, "maxOverlap divergerer for fixture uden hviledage — stage-basering må IKKE ændre tal for huller-frie løb");
    assert.deepEqual(r.overlapHistogram, ref.overlapHistogram, "overlapHistogram divergerer for fixture uden hviledage");
  }
});

test("packer: #3470 — GT-hviledage: en hviledag tæller IKKE med i overlap (GT'ens span-medlemsskab den dag ignoreres nu)", () => {
  const cfg = withFraction(div1(), (r) => {
    if (r.id === "gt-1") return 0.37;
    if (r.id === "gt-2") return 0.54;
    if (r.id === "gt-3") return 0.79;
    return fractionOfId(r.id);
  });
  cfg.stageRaces = cfg.stageRaces.map((r) => (r.id === "gt-1" ? { ...r, restDays: 3 } : r));
  const r = packLaneCalendar(cfg);
  const report = r.grandTourRestDays.find((x) => x.id === "gt-1");
  assert.ok(report.fillerIds.length > 0, "testen kræver mindst én fyldt hviledag");
  const gt1 = r.placements.find((p) => p.id === "gt-1");
  const holeGameDay = report.fillerIds
    .map((id) => r.placements.find((p) => p.id === id).stagesPlaced[0].game_day)[0];
  // GT'en har INGEN stagesPlaced-entry på hul-dagen (den ægte kilde til stage-basering).
  assert.ok(!gt1.stagesPlaced.some((s) => s.game_day === holeGameDay), "gt-1 må ikke have en etape-entry på hviledagen");
  // Loftet holder stadig hårdt (cap, ikke cap+1).
  assert.ok(r.maxOverlap <= cfg.overlapCap, `maxOverlap ${r.maxOverlap} > cap ${cfg.overlapCap}`);
});

// ── #3546 B: balanceStageRaceFractionAcrossGtWindows ────────────────────────────────
test("#3546 B: ingen fraction på GT'er/others ⇒ no-op (bit-identisk input)", () => {
  const gts = [{ id: "gt-1", stages: 21 }];
  const others = [{ id: "o-1", stages: 5 }, { id: "o-2", stages: 4 }];
  assert.deepEqual(balanceStageRaceFractionAcrossGtWindows(gts, others), others);
  assert.deepEqual(balanceStageRaceFractionAcrossGtWindows([], others), others);
  assert.deepEqual(balanceStageRaceFractionAcrossGtWindows(gts, []), []);
});

test("#3546 B: omfordeler others JÆVNT over de GT-centrerede vinduer (ikke deres rå, klumpede fraction)", () => {
  const gts = [
    { id: "gt-1", seasonFraction: 0.40 }, // Giro-lignende
    { id: "gt-2", seasonFraction: 0.61 }, // Hexagone-lignende
    { id: "gt-3", seasonFraction: 0.79 }, // Vuelta-lignende
  ];
  // 9 others, ALLE klumpet omkring fraction 0.75 (simulerer "August-klump"): den rå
  // fordeling ville lægge næsten alt i gt-3's vindue og intet i gt-1's.
  const others = Array.from({ length: 9 }, (_, i) => ({ id: `o-${i}`, stages: 4, seasonFraction: 0.75 + i * 0.001 }));
  const out = balanceStageRaceFractionAcrossGtWindows(gts, others);
  assert.equal(out.length, others.length, "antal løb uændret");
  assert.deepEqual(out.map((r) => r.id).sort(), others.map((r) => r.id).sort(), "samme løbs-sæt, kun fraction ændret");

  // Vinduer: [0, mid(.40,.61)=.505], [.505, mid(.61,.79)=.70], [.70, 1].
  const inWindow = (f, lo, hi) => f >= lo && f <= hi;
  const w0 = out.filter((r) => inWindow(r.seasonFraction, 0, 0.505)).length;
  const w1 = out.filter((r) => inWindow(r.seasonFraction, 0.505, 0.70)).length;
  const w2 = out.filter((r) => inWindow(r.seasonFraction, 0.70, 1)).length;
  assert.equal(w0 + w1 + w2, 9, "alle 9 tildelt et vindue");
  // Bredde-proportional kvote: w0 bredde .505 (≈39.7%), w1 bredde .195 (≈15.3%), w2 bredde .30 (≈23.6%)
  // af totalbredde 1.27 → largest-remainder giver ~4/1/4 eller nærtbeslægtet: under alle
  // omstændigheder skal FORDELINGEN være markant jævnere end den rå klump (der ville give 0/0/9).
  assert.ok(w0 >= 2, `forventede mindst 2 løb i vindue 0 (fik ${w0}): rebalanceringen skal sprede klumpen`);
  assert.ok(w2 < 9, `forventede IKKE alle 9 i vindue 2 (den rå klump): fik ${w2}`);
});

test("#3546 B: er en REN funktion (ingen mutation af input-arrays)", () => {
  const gts = [{ id: "gt-1", seasonFraction: 0.4 }, { id: "gt-2", seasonFraction: 0.7 }];
  const others = [{ id: "o-1", stages: 5, seasonFraction: 0.5 }];
  const gtsCopy = JSON.parse(JSON.stringify(gts));
  const othersCopy = JSON.parse(JSON.stringify(others));
  balanceStageRaceFractionAcrossGtWindows(gts, others);
  assert.deepEqual(gts, gtsCopy, "gtsByPhase må ikke muteres");
  assert.deepEqual(others, othersCopy, "others (input-arrayet) må ikke muteres: funktionen returnerer et NYT array");
});

// ── #3546 F: reshapeCobblesFractionToTwoWindows ─────────────────────────────────────
test("#3546 F: ingen cobbles-prædikat-match eller ingen fraction ⇒ no-op", () => {
  const races = [{ id: "o-1", seasonFraction: 0.1 }, { id: "o-2", seasonFraction: 0.2 }];
  assert.deepEqual(reshapeCobblesFractionToTwoWindows(races, () => false), races);
  assert.deepEqual(reshapeCobblesFractionToTwoWindows([{ id: "o-1" }], () => true), [{ id: "o-1" }], "uden fraction: no-op");
  assert.deepEqual(reshapeCobblesFractionToTwoWindows([], () => true), []);
  assert.deepEqual(reshapeCobblesFractionToTwoWindows(races, null), races, "ikke-funktion isCobbles ⇒ no-op");
});

test("#3546 F: splitter cobbles-races i to vinduer (tidligt+sent), ikke-cobbles rører den ikke", () => {
  // Rå fordeling: monotont faldende (klumpet tidligt): simulerer prod-mønstret.
  const cobbles = Array.from({ length: 8 }, (_, i) => ({ id: `cb-${i}`, seasonFraction: 0.05 + i * 0.03 }));
  const nonCobbles = [{ id: "nc-1", seasonFraction: 0.5 }, { id: "nc-2", seasonFraction: 0.6 }];
  const out = reshapeCobblesFractionToTwoWindows([...cobbles, ...nonCobbles], (r) => r.id.startsWith("cb-"));
  assert.equal(out.length, cobbles.length + nonCobbles.length, "antal uændret");

  const outNonCobbles = out.filter((r) => !r.id.startsWith("cb-"));
  assert.deepEqual(outNonCobbles, nonCobbles, "ikke-cobbles races er HELT urørte");

  const outCobbles = out.filter((r) => r.id.startsWith("cb-"));
  const early = outCobbles.filter((r) => r.seasonFraction <= 0.15);
  const late = outCobbles.filter((r) => r.seasonFraction >= 0.75);
  assert.equal(early.length + late.length, 8, "alle cobbles-races landede i ét af de to vinduer");
  assert.ok(early.length >= 3 && late.length >= 3, `forventede en meningsfuld split mellem to vinduer (tidligt=${early.length}, sent=${late.length})`);
});

test("#3546 F: er en REN funktion (ingen mutation af input)", () => {
  const races = [{ id: "cb-1", seasonFraction: 0.1 }, { id: "cb-2", seasonFraction: 0.11 }];
  const copy = JSON.parse(JSON.stringify(races));
  reshapeCobblesFractionToTwoWindows(races, () => true);
  assert.deepEqual(races, copy);
});

test("#3546 F: determinisme: samme input giver identisk output to gange", () => {
  const races = Array.from({ length: 6 }, (_, i) => ({ id: `cb-${i}`, seasonFraction: 0.1 + i * 0.02 }));
  const a = reshapeCobblesFractionToTwoWindows(races, () => true);
  const b = reshapeCobblesFractionToTwoWindows(JSON.parse(JSON.stringify(races)), () => true);
  assert.deepEqual(a, b);
});

// ── #3546 C: mindst 1 afgørelse pr. kalenderdag ─────────────────────────────────────
test("#3546 C: packLaneCalendar rapporterer daysWithoutDecision/-Count for BÅDE banded og stream", () => {
  const bandedResult = packLaneCalendar(div3());
  assert.ok(Array.isArray(bandedResult.daysWithoutDecision));
  assert.equal(bandedResult.daysWithoutDecisionCount, bandedResult.daysWithoutDecision.length);
  const streamResult = packLaneCalendar(div1());
  assert.ok(Array.isArray(streamResult.daysWithoutDecision));
  assert.equal(streamResult.daysWithoutDecisionCount, streamResult.daysWithoutDecision.length);
});

test("#3546 C: stream: en konstrueret 'ingen afgørelse'-dag rettes når et sikkert donor-bytte findes", () => {
  // 1 GT (10 etaper, INGEN af dem slutetapen lander alene) + rigeligt med endagsløb spredt
  // over hele sæsonen (så et sikkert bytte altid findes): overlapCap høj nok til at GT'en
  // ikke tvinges til at dele dag med ret meget andet.
  const stageRaces = [{ id: "gt-1", stages: 10, race_class: "GrandTour", seasonFraction: 0.5 }];
  const oneDayRaces = Array.from({ length: 30 }, (_, i) => ({
    id: `od-${i}`, race_class: "ProSeries", seasonFraction: i / 30,
  }));
  const monuments = [{ id: "mon-1", race_class: "Monuments", seasonFraction: 0.05 }]; // tvinger stream-layout
  const cfg = { stageRaces, oneDayRaces: [...oneDayRaces, ...monuments], density: 2, days: 20, overlapCap: 3 };
  const r = packLaneCalendar(cfg);
  assert.equal(r.layoutMode, "stream");
  assert.equal(r.daysWithoutDecisionCount, 0, `forventede 0 dage uden afgørelse med rigelig endagsløbs-forsyning (fik ${r.daysWithoutDecisionCount}: ${r.daysWithoutDecision})`);
});

test("#3546 C: en etapeløbs interne kronologi ER FORTSAT real_day-monoton EFTER enforceDailyDecisions (regressionsvagt for det bytte-bug der blev fanget under implementeringen)", () => {
  for (const cfg of [div1(), div3()]) {
    const r = packLaneCalendar(cfg);
    for (const p of r.placements) {
      const seq = p.stagesPlaced.slice().sort((a, b) => a.stage_number - b.stage_number);
      for (let i = 1; i < seq.length; i++) {
        const prevSlot = seq[i - 1].real_day * cfg.density + seq[i - 1].lane;
        const curSlot = seq[i].real_day * cfg.density + seq[i].lane;
        assert.ok(curSlot > prevSlot, `${p.id} etape ${seq[i].stage_number}: slot ${curSlot} ikke efter forrige ${prevSlot}`);
      }
    }
  }
});

test("#3546 C: determinisme: samme input giver identisk daysWithoutDecision to gange", () => {
  const cfg = withFraction(div1(), (r) => fractionOfId(r.id));
  const a = packLaneCalendar(cfg);
  const b = packLaneCalendar(JSON.parse(JSON.stringify(cfg)));
  assert.deepEqual(a.daysWithoutDecision, b.daysWithoutDecision);
});

// ── #3546 B v2 (arkitekt-retur 17/8 aften): pickLeastLoadedStreamAwayFromZero ───────
test("#3546 B v2: pickLeastLoadedStreamAwayFromZero bryder ties VÆK fra stream 0", () => {
  assert.equal(pickLeastLoadedStreamAwayFromZero([0, 0, 0], 3), 2, "3-vejs-tie skal give SIDSTE stream, ikke 0");
  assert.equal(pickLeastLoadedStreamAwayFromZero([0, 0], 2), 1, "2-vejs-tie skal give stream 1, ikke 0");
  assert.equal(pickLeastLoadedStreamAwayFromZero([5, 5, 5], 3), 2, "tie ved ikke-nul værdier skal stadig undgå indeks 0");
});

test("#3546 B v2: pickLeastLoadedStreamAwayFromZero vælger stadig den ÆGTE mindste ved ikke-tie", () => {
  assert.equal(pickLeastLoadedStreamAwayFromZero([0, 5, 5], 3), 0, "stream 0 ER den unikke mindste og skal stadig vælges");
  assert.equal(pickLeastLoadedStreamAwayFromZero([10, 3, 7], 3), 1);
  assert.equal(pickLeastLoadedStreamAwayFromZero([10, 3, 3], 3), 2, "tie mellem 1 og 2 (begge < stream 0): sidste vinder");
});

test("#3546 B v2: cap=1 (kun én stream) vælger altid indeks 0 (ingen alternativ)", () => {
  assert.equal(pickLeastLoadedStreamAwayFromZero([7], 1), 0);
});

test("#3546 B v2: GT-spredning forbedres mærkbart mod en asymmetrisk fase-fordelt fixture (regressionsvagt for arkitekt-fund 17/8: stream 0-tie-bias skabte bredere spænd for den FØRSTE GT)", () => {
  // 3 GT'er + rigelig "rest"-etapeløbs-forsyning, alle med fraction, tvinger den fase-
  // ankrede STREAM-gren. Målet er ikke et eksakt tal (afhænger af fixturens konkrete data),
  // men at spredningen (maks-min GT-spænd) er begrænset: IKKE at den første GT (laveste
  // fraction) systematisk ender med et markant bredere spænd end de to andre.
  const stageRaces = [
    { id: "gt-1", stages: 18, race_class: "TourFrance", seasonFraction: 0.40 },
    { id: "gt-2", stages: 17, race_class: "GiroVuelta", seasonFraction: 0.61 },
    { id: "gt-3", stages: 17, race_class: "GiroVuelta", seasonFraction: 0.79 },
    ...Array.from({ length: 4 }, (_, i) => ({ id: `wt-${i}`, stages: 6 + (i % 3), race_class: "OtherWorldTourA", seasonFraction: 0.1 + i * 0.2 })),
  ];
  const oneDayRaces = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: `mon-${i}`, race_class: "Monuments", seasonFraction: 0.05 + i * 0.18 })),
    ...Array.from({ length: 60 }, (_, i) => ({ id: `od-${i}`, race_class: "OtherWorldTourA", seasonFraction: i / 60 })),
  ];
  const r = packLaneCalendar({ stageRaces, oneDayRaces, density: 5, days: 28, overlapCap: 3, spineMinStages: 15 });
  const spans = r.placements
    .filter((p) => (p.stages ?? 1) >= 15)
    .map((p) => Math.max(...p.stagesPlaced.map((s) => s.real_day)) - Math.min(...p.stagesPlaced.map((s) => s.real_day)) + 1);
  assert.equal(spans.length, 3);
  const spread = Math.max(...spans) - Math.min(...spans);
  // Løs, ikke-skrøbelig grænse: den PRÆCISE spredning afhænger stærkt af fixturens
  // konkrete data (samme sensitivitet er dokumenteret i docs/audits' #3546-scorecard mod
  // det ægte katalog): testen er en smoke-regressionsvagt (fanger en fremtidig ændring
  // der gør det markant VÆRRE, fx et utilsigtet tilbagefald til stream-0-tie-bias), ikke
  // et præcisionskrav på denne syntetiske fixture.
  assert.ok(spread <= 12, `forventede en begrænset spredning på denne fixture (fik ${spread}, spans=${spans.join(",")})`);
});

// ── #3546 H: max-spænd-loft for ikke-GT-etapeløb (stages+3, hård grænse) ────────────
test("#3546 H: ikke-GT-etapeløb strækkes ALDRIG ud over stages+3 kalenderdage, selv med mange konkurrerende dage-uden-afgørelse", () => {
  const stageRaces = [
    { id: "sr-1", stages: 6, race_class: "ProSeries", seasonFraction: 0.1 },
    { id: "sr-2", stages: 5, race_class: "ProSeries", seasonFraction: 0.3 },
    { id: "sr-3", stages: 7, race_class: "ProSeries", seasonFraction: 0.6 },
  ];
  const oneDayRaces = [
    { id: "mon-1", race_class: "Monuments", seasonFraction: 0.02 }, // tvinger stream-layout
    ...Array.from({ length: 6 }, (_, i) => ({ id: `od-${i}`, race_class: "ProSeries", seasonFraction: 0.05 + i * 0.15 })),
  ];
  const r = packLaneCalendar({ stageRaces, oneDayRaces, density: 3, days: 28, overlapCap: 2, spineMinStages: 15 });
  for (const p of r.placements) {
    if ((p.stages ?? 1) < 2 || p.stages >= 15) continue; // kun ikke-GT-etapeløb
    const days = p.stagesPlaced.map((s) => s.real_day);
    const span = Math.max(...days) - Math.min(...days) + 1;
    assert.ok(span <= p.stages + 3, `${p.id}: spænd ${span} > stages(${p.stages})+3`);
  }
});

test("#3546 H: GT'er er ALDRIG en bytte-kandidat i C's dagsafgørelses-mekanisme (regressionsvagt: fundet under H-implementeringen, et GT-bytte brød #3472 v3's GT-real-day-separation)", () => {
  const cfg = withFraction(div1(), (r) => {
    if (r.id === "gt-1") return 0.37;
    if (r.id === "gt-2") return 0.54;
    if (r.id === "gt-3") return 0.79;
    return fractionOfId(r.id);
  });
  const r = packLaneCalendar(cfg);
  assert.deepEqual(r.gtRealDaySeparationViolations, [], "GT-real-day-separation skal ALDRIG brydes, heller ikke af C's bytte-mekanisme");
});
