// #5267 (ejer-kort 19/9) — PROEVEPAKNING: synkroniserede etapeloebs-blokke (R13) og
// traeningsdage i hullerne.
//
// Testen daekker to ting der maa kunne staa hver for sig:
//   1. `padAxisWithTrainingDays` — den RENE efterbehandling der naar loebsdags-maalet uden
//      at flytte et loeb. Her maales invarianterne direkte paa smaa, haandholdte akser, saa
//      en fremtidig regression ikke skal jagtes gennem et helt katalog.
//   2. R13 (synkroniseringen) — SLAAET FRA som default. Testen laaser netop det: en ny
//      kalender maa ikke faa synkroniseringen med bag om ryggen paa ejeren, fordi den er
//      MAALT til at braekke mindste-overlap-gulvet i D3/D4 (docs/audits/2026-09-19-5267-
//      proevepakning.md §3).

import test from "node:test";
import assert from "node:assert/strict";

import { padAxisWithTrainingDays, packLaneCalendar } from "./raceCalendarLanePacker.js";

// ── 1. Efterbehandlingen ────────────────────────────────────────────────────────────────

// En akse paa 6 loebsdage fordelt paa 3 datoer (2 pr. dato) med eet loeb der spaender
// loebsdag 1-4. Frie positioner er da 0, 1 og 5, 6 — IKKE 2, 3, 4 (de ligger inde i spaendet).
const AKSE = [0, 0, 1, 1, 2, 2];
const SPAEND = [[1, 4]];

test("#5267 padding: en traeningsdag lae­gges ALDRIG inde i et loebs spaend", () => {
  const r = padAxisWithTrainingDays({ dateOfGameDay: AKSE, spans: SPAEND, target: 10, days: 3 });
  assert.equal(r.dateOfGameDay.length, 10, "maalet skal vae­re naaet");
  // Loebets loebsdage skal stadig ligge i TRAEK paa den nye akse.
  const nyLo = r.mapG[1];
  const nyHi = r.mapG[4];
  assert.equal(nyHi - nyLo, 3, "loebets fire loebsdage ligger ikke laengere i traek");
  for (const g of r.trainingGameDays) {
    assert.ok(g < nyLo || g > nyHi, `traeningsdag ${g} ligger inde i spaendet ${nyLo}-${nyHi}`);
  }
});

test("#5267 padding: hver indsat loebsdag arver datoen fra den position den lae­gges paa", () => {
  const r = padAxisWithTrainingDays({ dateOfGameDay: AKSE, spans: SPAEND, target: 10, days: 3 });
  // Datoerne skal stadig vae­re ikke-faldende hen over aksen (#4236/§0: en loebsdag hoerer
  // til praecis een kalenderdato, og datoerne kommer i raekkefoelge).
  for (let g = 1; g < r.dateOfGameDay.length; g++) {
    assert.ok(r.dateOfGameDay[g] >= r.dateOfGameDay[g - 1], `datoerne falder ved loebsdag ${g}`);
  }
  for (const d of r.dateOfGameDay) assert.ok(d >= 0 && d < 3, `dato ${d} ligger uden for saesonen`);
});

test("#5267 padding: budgettet fordeles round-robin, ikke stablet paa den foerste position", () => {
  const r = padAxisWithTrainingDays({ dateOfGameDay: AKSE, spans: SPAEND, target: 10, days: 3 });
  assert.equal(r.freePositions, 4, "positionerne 0, 1, 5 og 6 er frie");
  const prDato = new Map();
  for (const g of r.trainingGameDays) {
    const d = r.dateOfGameDay[g];
    prDato.set(d, (prDato.get(d) ?? 0) + 1);
  }
  assert.ok(prDato.size >= 2, `traeningsdagene ramte kun ${prDato.size} dato(er)`);
});

test("#5267 padding: et maal under den naturlige akse tilfoejer INTET (den kan ikke presses sammen)", () => {
  const r = padAxisWithTrainingDays({ dateOfGameDay: AKSE, spans: SPAEND, target: 3, days: 3 });
  assert.equal(r.padded, 0);
  assert.deepEqual(r.dateOfGameDay, AKSE);
  assert.deepEqual(r.mapG, [0, 1, 2, 3, 4, 5], "uden padding er aksen uae­ndret");
});

test("#5267 padding: en akse hvor eet loeb fylder ALT har kun plads FOER og EFTER loebet", () => {
  // Positionerne 0 og G er altid frie (foran den foerste og efter den sidste loebsdag);
  // 1 og 2 ligger inde i spaendet og er det ikke.
  const r = padAxisWithTrainingDays({ dateOfGameDay: [0, 0, 0], spans: [[0, 2]], target: 6, days: 1 });
  assert.equal(r.freePositions, 2, "kun positionerne foer og efter loebet er frie");
  assert.equal(r.padded, 3);
  for (const g of r.trainingGameDays) {
    assert.ok(g < r.mapG[0] || g > r.mapG[2], "en traeningsdag endte inde i loebet");
  }
});

// ── 2. Synkroniseringen er FRA som default ──────────────────────────────────────────────

// Et lille, eksakt katalog: density 2, cap 2, 4 datoer → 8 etaper. To etapeloeb a 2 etaper
// + 4 endagsloeb. Nok til at skelne en kae­de fra en blok uden at koere hele prod-kataloget.
const KATALOG = {
  stageRaces: [
    { id: "sr-a", stages: 2 }, { id: "sr-b", stages: 2 },
  ],
  oneDayRaces: [
    { id: "od-1", stages: 1 }, { id: "od-2", stages: 1 },
    { id: "od-3", stages: 1 }, { id: "od-4", stages: 1 },
  ],
  density: 2, days: 4, overlapCap: 2, spineMinStages: null,
};

test("#5267: synkroniseringen er SLAAET FRA som default", () => {
  const r = packLaneCalendar({ ...KATALOG });
  assert.equal(r.syncStageBlocksHeld, false, "R13 maa ikke vae­re aktiv uden at nogen har bedt om den");
  assert.ok(r.solveAttempts.every((a) => a.sync === false), "stigen maa ikke indeholde et synk-forsoeg som default");
});

test("#5267: syncStageBlocks=true forsoeger R13 FOERST og rapporterer udfaldet", () => {
  const r = packLaneCalendar({ ...KATALOG, syncStageBlocks: true });
  assert.equal(r.solveAttempts[0].sync, true, "foerste forsoeg skal vae­re det synkroniserede");
  // Uanset om R13 kunne holde for netop dette katalog, skal udfaldet vae­re SYNLIGT.
  assert.equal(typeof r.syncStageBlocksHeld, "boolean");
  assert.ok(Number.isFinite(r.stageRaceBlocks));
});

test("#5267: et mislykket forsoeg rapporterer sit skridtforbrug (budget vs. umulig regel)", () => {
  // Skridttallet er den eneste maade at skelne "loeb toer for skridt" fra "der findes ingen
  // lovlig pakning". Foer #5267 stod der null i begge tilfae­lde.
  const r = packLaneCalendar({ ...KATALOG, syncStageBlocks: true });
  for (const a of r.solveAttempts) {
    assert.ok(Number.isFinite(a.steps), `forsoeg ${JSON.stringify(a)} rapporterede intet skridtforbrug`);
    assert.equal(typeof a.exhausted, "boolean");
  }
});

test("#5267: loebsdags-maalet aendrer ALDRIG antallet af etaper pr. kalenderdato", () => {
  const uden = packLaneCalendar({ ...KATALOG });
  const med = packLaneCalendar({ ...KATALOG, raceDayTarget: uden.timelineLength + 6 });
  assert.deepEqual(med.load, uden.load, "etaper pr. kalenderdato aendrede sig med maalet");
  assert.equal(med.timelineLength, uden.timelineLength + 6);
  assert.equal(med.naturalRaceDays, uden.timelineLength);
  assert.equal(med.raceDayTargetHeld, true);
});
