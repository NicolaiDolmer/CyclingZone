// backend/scripts/dev/calendarGoldenDiff.test.js
// #4123 — diff-scriptets egen test. Kernen er beviset på at en INJICERET afvigelse
// faktisk RAPPORTERES: en rapport der er tavs om en ændring er værre end ingen rapport,
// fordi den giver falsk tryghed lige før §2c's ene regenerering.
//
// Fixturene her er små, håndskrevne snapshots i buildCalendarGoldenSnapshot()-formen —
// ikke den rigtige S3-kalender. Det er med vilje: testen skal dømme RAPPORTEN, ikke
// kalenderen (den dømmes af lib/calendarGoldenSnapshot.test.js og
// lib/calendarInvariantsCiGate4123.test.js, som kører mod den ægte fixture).
//
// Refs #4123 #4121

import test from "node:test";
import assert from "node:assert/strict";

import { runGoldenDiff } from "./calendarGoldenDiff.mjs";
import {
  detectHardInvariantBreaches, summarizeGoldenDiff, stageCountsByRace, raceTypeOf,
} from "./lib/calendarGoldenDiffReport.mjs";
import { MAX_GT_SPAN_DAYS } from "../../lib/raceCalendarLanePacker.js";
import { GRAND_TOUR_MIN_STAGES } from "../../lib/grandTourRestDays.js";

const DAG = 86_400_000;
const datoEfter = (start, n) => new Date(Date.parse(`${start}T00:00:00Z`) + n * DAG).toISOString().slice(0, 10);

/**
 * Bygger et minimalt, lovligt snapshot: én tier, N sammenhængende dage, ét endagsløb pr.
 * dag. Ingen GT'er, ingen huller — altså grønt på alle fem hårde invarianter.
 */
function lovligtSnapshot({ tier = 1, dage = 4, firstDay = "2026-08-28" } = {}) {
  const dagListe = Array.from({ length: dage }, (_, i) => ({
    dato: datoEfter(firstDay, i),
    etaper: [{ løb: `Endagsløb ${i + 1}`, etapenummer: 1, game_day: i }],
  }));
  return {
    genereret: { firstDay, lastDay: datoEfter(firstDay, dage - 1), realDays: dage },
    tiers: [{ tier, løb: dage, etaper: dage, dage: dagListe }],
  };
}

/** Et Grand Tour som `stages` etaper fordelt over `spanDays` kalenderdage fra `startOffset`. */
function gtEtaper({ navn, stages, spanDays, startOffset = 0, firstDay = "2026-08-28" }) {
  const perDag = Math.ceil(stages / spanDays);
  const ud = [];
  let nr = 1;
  for (let d = 0; d < spanDays && nr <= stages; d++) {
    for (let k = 0; k < perDag && nr <= stages; k++) {
      ud.push({ dato: datoEfter(firstDay, startOffset + d), etape: { løb: navn, etapenummer: nr, game_day: nr - 1 } });
      nr += 1;
    }
  }
  return ud;
}

/** Lægger etaper ind i et snapshots tier-blok på deres respektive datoer. */
function medEtaper(snapshot, poster) {
  const kopi = JSON.parse(JSON.stringify(snapshot));
  const blok = kopi.tiers[0];
  const byDato = new Map(blok.dage.map((d) => [d.dato, d]));
  for (const p of poster) {
    if (!byDato.has(p.dato)) {
      const ny = { dato: p.dato, etaper: [] };
      byDato.set(p.dato, ny);
      blok.dage.push(ny);
    }
    byDato.get(p.dato).etaper.push(p.etape);
  }
  blok.dage.sort((a, b) => a.dato.localeCompare(b.dato));
  for (const d of blok.dage) d.etaper.sort((a, b) => a.game_day - b.game_day || a.løb.localeCompare(b.løb));
  blok.etaper = blok.dage.reduce((n, d) => n + d.etaper.length, 0);
  blok.løb = new Set(blok.dage.flatMap((d) => d.etaper.map((e) => e.løb))).size;
  return kopi;
}

// ── udledningerne rapporten hviler på ──────────────────────────────────────────────

test("#4123: etapeantal udledes af snapshottet selv (distinkte etapenumre pr. løb)", () => {
  const snap = medEtaper(lovligtSnapshot({ dage: 3 }), [
    { dato: "2026-08-28", etape: { løb: "Etapeløbet", etapenummer: 1, game_day: 10 } },
    { dato: "2026-08-29", etape: { løb: "Etapeløbet", etapenummer: 2, game_day: 11 } },
    // Samme etapenummer to gange må ikke tælle som to etaper.
    { dato: "2026-08-29", etape: { løb: "Etapeløbet", etapenummer: 2, game_day: 12 } },
  ]);
  const antal = stageCountsByRace(snap.tiers[0]);
  assert.equal(antal.get("Etapeløbet"), 2);
  assert.equal(antal.get("Endagsløb 1"), 1);
});

test("#4123: løbstypen følger GRAND_TOUR_MIN_STAGES, ikke et gættet tal", () => {
  assert.equal(raceTypeOf(1), "endagsløb");
  assert.equal(raceTypeOf(GRAND_TOUR_MIN_STAGES - 1), "etapeløb");
  assert.equal(raceTypeOf(GRAND_TOUR_MIN_STAGES), "grand tour");
});

// ── kernen: en injiceret afvigelse SKAL rapporteres ────────────────────────────────

test("#4123: en injiceret afvigelse rapporteres pr. division, pr. dag og pr. løbstype", () => {
  const gylden = lovligtSnapshot({ dage: 4 });
  // Afvigelsen: dag 2's endagsløb er byttet ud med et andet løb.
  const ny = JSON.parse(JSON.stringify(gylden));
  ny.tiers[0].dage[1].etaper[0].løb = "Et Helt Andet Løb";

  const { diff, hårdeBrud, exitCode } = runGoldenDiff({ gylden, ny });

  assert.equal(diff.uændret, false, "diffen må ikke melde 'uændret' når en dag har skiftet løb");
  assert.equal(diff.dage.length, 1, "præcis én dag ændrede sig");
  assert.equal(diff.dage[0].dato, gylden.tiers[0].dage[1].dato);
  assert.equal(diff.dage[0].tier, 1);
  assert.deepEqual(diff.dage[0].tilføjet, ["Et Helt Andet Løb#1"]);
  assert.deepEqual(diff.dage[0].fjernet, ["Endagsløb 2#1"]);
  assert.equal(diff.divisioner.find((d) => d.tier === 1).ændredeDage, 1);
  // Løbstype-tabellen skal stadig balancere: ét endagsløb ud, ét ind.
  const endags = diff.løbstyper.find((t) => t.type === "endagsløb");
  assert.equal(endags.løbFør, endags.løbEfter);
  // Et rent løbsbytte bryder ingen hård invariant — diffen alene er ikke exit 1.
  assert.deepEqual(hårdeBrud, []);
  assert.equal(exitCode, 0, "en ren diff er ikke automatisk en fejl, se scriptets header");
});

test("#4123: --fail-on-diff gør den rene diff til exit 1", () => {
  const gylden = lovligtSnapshot({ dage: 3 });
  const ny = JSON.parse(JSON.stringify(gylden));
  ny.tiers[0].dage[0].etaper[0].løb = "Ændret";
  assert.equal(runGoldenDiff({ gylden, ny, failOnDiff: true }).exitCode, 1);
  assert.equal(runGoldenDiff({ gylden, ny: gylden, failOnDiff: true }).exitCode, 0);
});

test("#4123: identiske snapshots giver uændret + exit 0", () => {
  const snap = lovligtSnapshot({ dage: 5 });
  const { diff, hårdeBrud, exitCode } = runGoldenDiff({ gylden: snap, ny: snap });
  assert.equal(diff.uændret, true);
  assert.deepEqual(hårdeBrud, []);
  assert.equal(exitCode, 0);
});

test("#4123: et ændret vindue er i sig selv en afvigelse", () => {
  const gylden = lovligtSnapshot({ dage: 3 });
  const ny = JSON.parse(JSON.stringify(gylden));
  ny.genereret.realDays = 31;
  const { diff } = runGoldenDiff({ gylden, ny });
  assert.equal(diff.vindue.ændret, true);
  assert.equal(diff.uændret, false);
});

// ── de hårde invarianter ──────────────────────────────────────────────────────────

test("#4123: to Grand Tours på samme dag er et HÅRDT brud (exit 1)", () => {
  const basis = lovligtSnapshot({ dage: MAX_GT_SPAN_DAYS * 2 });
  const ny = medEtaper(basis, [
    ...gtEtaper({ navn: "Grand Tour A", stages: GRAND_TOUR_MIN_STAGES, spanDays: MAX_GT_SPAN_DAYS, startOffset: 0 }),
    // Overlapper A's spænd med vilje — netop #3546's fejlklasse.
    ...gtEtaper({ navn: "Grand Tour B", stages: GRAND_TOUR_MIN_STAGES, spanDays: MAX_GT_SPAN_DAYS, startOffset: 1 }),
  ]);
  const { hårdeBrud, exitCode } = runGoldenDiff({ gylden: basis, ny });
  assert.ok(hårdeBrud.some((b) => /deler dagen/.test(b)), `forventede et delt-dag-brud, fik: ${JSON.stringify(hårdeBrud)}`);
  assert.equal(exitCode, 1);
});

test("#4123: en Grand Tour over for mange kalenderdage er et HÅRDT brud", () => {
  const basis = lovligtSnapshot({ dage: MAX_GT_SPAN_DAYS + 3 });
  const ny = medEtaper(basis, gtEtaper({
    navn: "Den Lange Rundtur", stages: MAX_GT_SPAN_DAYS + 1, spanDays: MAX_GT_SPAN_DAYS + 1, startOffset: 0,
  }).map((p, i) => ({ ...p, etape: { ...p.etape, etapenummer: i + 1 } })));
  // Løbet skal have nok etaper til at TÆLLE som en GT, ellers måles spændet slet ikke.
  const medNokEtaper = JSON.parse(JSON.stringify(ny));
  let nr = MAX_GT_SPAN_DAYS + 2;
  while (stageCountsByRace(medNokEtaper.tiers[0]).get("Den Lange Rundtur") < GRAND_TOUR_MIN_STAGES) {
    medNokEtaper.tiers[0].dage[0].etaper.push({ løb: "Den Lange Rundtur", etapenummer: nr, game_day: 90 + nr });
    nr += 1;
  }
  const brud = detectHardInvariantBreaches(medNokEtaper);
  assert.ok(brud.some((b) => /strækker sig over/.test(b)), `forventede et spænd-brud, fik: ${JSON.stringify(brud)}`);
});

test("#4123: en etape før sin forgænger er et HÅRDT brud", () => {
  const basis = lovligtSnapshot({ dage: 4 });
  const ny = medEtaper(basis, [
    { dato: "2026-08-30", etape: { løb: "Bagvendt Rundt", etapenummer: 1, game_day: 20 } },
    { dato: "2026-08-29", etape: { løb: "Bagvendt Rundt", etapenummer: 2, game_day: 21 } },
  ]);
  const brud = detectHardInvariantBreaches(ny);
  assert.ok(brud.some((b) => /ligger før etape/.test(b)), `forventede et kronologi-brud, fik: ${JSON.stringify(brud)}`);
});

test("#4123: en tom kalenderdag inde i vinduet er et HÅRDT brud", () => {
  const snap = lovligtSnapshot({ dage: 5 });
  snap.tiers[0].dage.splice(2, 1); // hul midt i vinduet
  const brud = detectHardInvariantBreaches(snap);
  assert.ok(brud.some((b) => /tom kalenderdag/.test(b)), `forventede en tom dag, fik: ${JSON.stringify(brud)}`);
});

test("#4123: den ÆGTE gyldne snapshot bryder ingen hård invariant", async () => {
  // Beviset for at de fem invarianter er formuleret så de passer på en RIGTIG kalender og
  // ikke kun på legetøjs-fixturene ovenfor. Ville en af dem fælde den committede kalender,
  // var den forkert formuleret — ikke kalenderen der var i stykker.
  const { readFileSync } = await import("node:fs");
  const { DEFAULT_GOLDEN_PATH } = await import("./calendarGoldenDiff.mjs");
  const gylden = JSON.parse(readFileSync(DEFAULT_GOLDEN_PATH, "utf8"));
  assert.deepEqual(detectHardInvariantBreaches(gylden), []);
  assert.equal(summarizeGoldenDiff(gylden, gylden).uændret, true);
});
