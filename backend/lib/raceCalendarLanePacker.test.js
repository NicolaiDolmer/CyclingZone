import test from "node:test";
import assert from "node:assert/strict";
import { packLaneCalendar, balanceStageRaceFractionAcrossGtWindows, reshapeCobblesFractionToTwoWindows } from "./raceCalendarLanePacker.js";

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

test("packer: div 3 — cap 2 overholdt, ægte overlap findes (binding-spillet lever)", () => {
  const r = packLaneCalendar(div3());
  assert.ok(r.maxOverlap <= 2, `div3 maxOverlap ${r.maxOverlap} > 2`);
  assert.ok((r.overlapHistogram[2] || 0) >= 14, `div3 for få 2-overlap game-dage: ${JSON.stringify(r.overlapHistogram)}`);
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
// ── #3470 supply-fix (6/8): reservér fillere FØR padding forbruger rest-køen grådigt ──
// Samme fejlklasse som reservations-fasen i tierRaceSelection.js (garanti-uden-forsyning) —
// uden reservationen "vandt" den almindelige gap-fill/least-loaded-fordeling ALLE
// endagsløb før GT'erne fik deres tur, og hviledagene degraderede selv med rigelig forsyning.

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
// ── #3546 H: max-spænd-loft for ikke-GT-etapeløb (stages+3, hård grænse) ────────────