// Anti-inversions-harness for PROGNOSE-BÅNDET (#3746 trin 7, ejer-beslutning
// B+C+D 16/8). Afløser den gamle #3666-gate R8 for RATING-LOFT-BÅNDET —
// loftet er væk (trin 7 gjorde det flade og rolleklasse-bestemt), og
// #3679's inversionsangreb angreb netop loft-båndet. Filnavnet er bevaret
// (samme angrebsklasse, kaldere/CI-historik peger på den), men målet er nu
// potentialeIntervalFor/buildTypePrognosisBands i scoutingReport.js.
//
// ═══ HVORFOR #3679 DØR HER ═══
// Det gamle loft-bånds bias var PROPORTIONAL med halvbredden:
//     center_L = truth + u · CEIL_BIAS_FACTOR · half_L
// half_L faldt med scout-level, så to niveauer gav to ligninger med to
// ubekendte (truth, u) — en LSQ/to-punkts-løsning over flere niveauer kunne i
// praksis isolere truth langt bedre end den viste bredde lovede (#3679's fund).
//
// potentialeIntervalFor (scoutingReport.js) bruger bevidst en ABSOLUT, ikke
// halvbredde-skaleret bias:
//     center = potentiale + u · POT_HALF_WIDTH_BY_LEVEL[0] · CEIL_BIAS_FACTOR
// `u` er seedet på "scout-pot:rytter:hold" — IKKE på level. Centret er derfor
// IDENTISK på tværs af alle scout-niveauer (verificeret i scoutingReport.test.js:
// "samme CENTER for alle scout-niveauer"). Der er ingen anden ligning at
// krydse den mod: at scoute mere niveau ændrer kun halvbredden omkring det
// samme faste (og ukendte) center, aldrig centret selv. Den bedste angriber
// kan derfor gøre er at aflæse midtpunktet (som ER truth + bias) — og hans
// fejl er dermed PRÆCIS |bias|, uanset hvor mange niveauer han scouter eller
// hvilken strategi (gennemsnit/to-punkt/LSQ) han bruger. De fire strategier
// nedenfor er bevaret fra den gamle harness for at BEVISE denne degenerering:
// alle fire konvergerer til samme (dårlige) svar, fordi der ikke findes en
// anden observation at udnytte.
//
// ═══ GATEN ═══
// bias = u · POT_HALF_WIDTH_BY_LEVEL[0] · CEIL_BIAS_FACTOR, u ∈ [-1,1] uniform
// (seededUnit) ⇒ bias ∈ [-0,75, 0,75] potentiale-enheder (widest half 1,5 ×
// CEIL_BIAS_FACTOR 0,5). Median af |uniform(-0,75, 0,75)| = 0,75 × 0,5 = 0,375.
// Gaten er sat til 0,25 — under det er centret reelt et eksakt tal og #1543/
// #3746's "aldrig et eksakt tal" er brudt i praksis. Præ-registreret FØR
// kørsel, samme disciplin som den gamle #3666-gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  potentialeIntervalFor, potentialeHalfWidth, POT_HALF_WIDTH_BY_LEVEL, CEIL_BIAS_FACTOR,
  buildTypePrognosisBands,
} from "./scoutingReport.js";
import { seededUnit } from "./scouting.js";
import { REGISTRY_ABILITY_KEYS } from "./abilityRegistry.js";

const N = 1500;
const MAX_LEVEL = POT_HALF_WIDTH_BY_LEVEL.length - 1;
const SCOUT_RATINGS_TO_GATE = [40, 60, 80, 99];
const GATE_MEDIAN_ERROR = 0.25; // potentiale-enheder — præ-registreret, se hovedet

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(0.5 * (s.length - 1))];
};

// Deterministisk pseudo-population. Truth holdes i [1.75, 5.25] — udelukker de
// yderste ~0,25 af skalaen i begge ender, hvor clamp [1,6] kan engagere ved lave
// scout-niveauer (bred halvbredde) og trække center-uafhængigheden en anelse.
// De rene clamp-KANTERNE (pot 1/6) har deres egen dedikerede test nedenfor;
// denne population måler den generelle egenskab uden at den ene distorsion
// dominerer målingen. Fordelingen er bevidst jævn over det gyldige interval:
// gaten måler egenskaben ved FORMLEN, ikke ved en bestemt prod-fordeling.
function makeRider(i) {
  const truth = 1.75 + seededUnit(`pot-truth:${i}`) * 3.5; // 1.75-5.25
  return { id: `sim-p${i}`, truth };
}
const RIDERS = Array.from({ length: N }, (_, i) => makeRider(i));

// Angriber-strategier — bevaret fra #3666-gaten for at vise at de ALLE
// degenererer til samme svar, når bias er niveau-uafhængig (se hovedet).
function strategies(mids, halves) {
  const out = {};
  out.restMid = mids[mids.length - 1];
  out.avgAll = mids.reduce((a, b) => a + b, 0) / mids.length;
  const dh = halves[0] - halves[halves.length - 1];
  out.twoPoint = dh !== 0
    ? mids[0] - ((mids[0] - mids[mids.length - 1]) / dh) * halves[0]
    : mids[0];
  const n = mids.length;
  const mh = halves.reduce((a, b) => a + b, 0) / n;
  const mm = mids.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (halves[i] - mh) * (mids[i] - mm); sxx += (halves[i] - mh) ** 2; }
  const slope = sxx > 0 ? sxy / sxx : 0;
  out.lsq = mm - slope * mh;
  return out;
}

function runForScout(overall) {
  const scout = { overall };
  const errs = {};
  const halves = Array.from({ length: MAX_LEVEL + 1 }, (_, l) => potentialeHalfWidth(l, scout));
  for (const r of RIDERS) {
    const mids = [];
    for (let level = 0; level <= MAX_LEVEL; level++) {
      const { potLo, potHi } = potentialeIntervalFor({
        potentiale: r.truth, level, riderId: r.id, teamId: "attacker-team", scout,
      });
      mids.push((potLo + potHi) / 2);
    }
    const guesses = strategies(mids, halves);
    for (const [k, v] of Object.entries(guesses)) {
      (errs[k] ??= []).push(Math.abs(v - r.truth));
    }
  }
  const perStrategy = Object.fromEntries(Object.entries(errs).map(([k, e]) => [k, +median(e).toFixed(3)]));
  const best = Object.entries(perStrategy).sort((a, b) => a[1] - b[1])[0];
  const bestErrs = errs[best[0]].slice().sort((a, b) => a - b);
  return {
    overall,
    bestStrategy: best[0],
    perStrategy,
    medianError: best[1],
    fracWithin025: +(bestErrs.filter((e) => e <= 0.25).length / bestErrs.length).toFixed(3),
    halfWidths: halves.map((h) => +h.toFixed(2)),
  };
}

// #3679 LUKKET: den bedste angriber-strategi kan ikke slå median-fejl 0,25
// potentiale-enheder, uanset spejder-rating. Ikke længere `todo` — dette ER
// en rigtig gate.
test("prognose-båndets potentiale-center er ikke inverterbart ved nogen spejder-rating (#3679 lukket)", () => {
  const scorecards = SCOUT_RATINGS_TO_GATE.map(runForScout);
  for (const s of scorecards) {
    console.log(`scout overall=${s.overall}`, JSON.stringify(s));
  }
  for (const s of scorecards) {
    assert.ok(
      s.medianError >= GATE_MEDIAN_ERROR,
      `potentiale-centret er reelt inverterbart ved spejder-overall ${s.overall}: `
      + `bedste strategi "${s.bestStrategy}" rammer med median-fejl ${s.medianError} `
      + `potentiale-enheder (gate ${GATE_MEDIAN_ERROR}); ${(s.fracWithin025 * 100).toFixed(1)} % af `
      + `rytterne kan pinnes til ±0,25. Se ${JSON.stringify(s.perStrategy)}`
    );
  }
});

// Sanity: den observerede median ligger tæt på den teoretiske ~0,375 (median af
// |uniform(-0,75, 0,75)|). For løs til en gate (præcis 0,375 er en egenskab ved
// ÉN seed-fordeling), men en STOR afvigelse ville betyde at bias-formlen er
// ændret uden at denne fils hoved er opdateret.
test("median-fejlen ligger i den forventede størrelsesorden (~0,375, ikke en gate)", () => {
  const s = runForScout(40);
  assert.ok(s.medianError > 0.2 && s.medianError < 0.6, `medianError ${s.medianError} uden for forventet bånd`);
});

// Clamp-kanter: potentiale 1 og 6 (og lige udenfor) skal blive i [1,6].
test("potentialeIntervalFor: clamp-kanterne pot 1 og pot 6 holder [1,6]", () => {
  for (const level of [0, 1, 2, 3]) {
    for (const truth of [1, 1.4, 6, 5.6]) {
      const { potLo, potHi } = potentialeIntervalFor({
        potentiale: truth, level, riderId: `edge:${truth}:${level}`, teamId: "t-edge",
      });
      assert.ok(potLo >= 1 && potLo <= 6, `potLo ${potLo} uden for [1,6] (truth ${truth}, level ${level})`);
      assert.ok(potHi >= 1 && potHi <= 6, `potHi ${potHi} uden for [1,6] (truth ${truth}, level ${level})`);
      assert.ok(potLo <= potHi, `potLo ${potLo} > potHi ${potHi}`);
    }
  }
});

// Prognose-BÅNDET (rating-point) arver egenskaben: det er en deterministisk
// funktion af potentialeIntervalFor's output + de øvrige publicerede felter
// (nu-evner, alder, typer — intet af det er hemmeligt). Direkte attack på
// buildTypePrognosisBands ville derfor kræve at invertere HELE prognose-
// motoren (riderPrognosis.js) for at komme tilbage til potentiale — en
// strengt sværere opgave end at angribe potentialeIntervalFor selv, som
// gaten ovenfor allerede viser er urimelig. Denne test bekræfter blot at
// clamp-kanterne også holder igennem hele kæden til rating-point-skalaen.
test("buildTypePrognosisBands: clamp-kanterne pot 1 og pot 6 giver stadig gyldige [0,99]-bånd", () => {
  const nowAbilities = Object.fromEntries(REGISTRY_ABILITY_KEYS.map((k, i) => [k, 20 + (i % 5) * 3]));
  for (const potentiale of [1, 6]) {
    for (const level of [0, 3]) {
      const bands = buildTypePrognosisBands({
        nowAbilities, age: 19, primaryType: "climber", secondaryType: "gc",
        potentiale, level, riderId: `edge-band:${potentiale}:${level}`, teamId: "t-edge-band",
      });
      for (const b of bands) {
        if (b.progLo == null) continue;
        assert.ok(Number.isInteger(b.progLo) && Number.isInteger(b.progHi), b.key);
        assert.ok(b.progLo >= 0 && b.progHi <= 99 && b.progLo <= b.progHi, b.key);
      }
    }
  }
});

// Bias'en er ABSOLUT — sanity-check af selve konstruktionen (ikke af den
// afledte gate), så en fremtidig omskrivning der genindfører halvbredde-skalering
// (#3679's oprindelige fejl) fanges direkte og ikke kun via den statistiske gate.
test("potentialeIntervalFor: CEIL_BIAS_FACTOR-forskydningen er fast, ikke skaleret med halvbredden", () => {
  const truth = 4;
  const widest = POT_HALF_WIDTH_BY_LEVEL[0];
  const level0 = potentialeIntervalFor({ potentiale: truth, level: 0, riderId: "bias-check", teamId: "t-bias" });
  const bias = (level0.potLo + level0.potHi) / 2 - truth;
  assert.ok(Math.abs(bias) <= widest * CEIL_BIAS_FACTOR + 1e-9, `bias ${bias} overstiger det faste loft`);
});
