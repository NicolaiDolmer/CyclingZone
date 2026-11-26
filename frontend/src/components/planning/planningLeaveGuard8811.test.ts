// #8811 (Codex P1 paa #8790): et skift af visning (Uge · Saeson · Maaned) og "Tilbage til ugen" afmonterede
// Saeson-matrixen og dags-tavlen og tabte deres ugemte kladde uden et ord. Fladerne melder nu deres kladde
// til siden, og siden spoerger foerst. Reglen er ren logik (planningViews.ts); ledningerne pinnes paa
// kilden, fordi repoet koerer node --test uden jsdom (samme moenster som writeGate.contract.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { embeddedSurface, leaveConfirmKey, paramsForMode } from "./planningViews.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const clean = { season: false, board: false };

test("fladen der staar fremme: dags-tavlen foer Saeson, Maaned og Uge har ingen egen kladde", () => {
  assert.equal(embeddedSurface("week", false), null);
  assert.equal(embeddedSurface("month", false), null);
  assert.equal(embeddedSurface("season", false), "season");
  assert.equal(embeddedSurface("week", true), "distribute");
  assert.equal(embeddedSurface("season", true), "distribute");
});

test("ugemt saesonmatrix: skift til Uge, Maaned eller et loeb spoerger med matrixens eget spoergsmaal", () => {
  const dirty = { season: true, board: false };
  assert.equal(leaveConfirmKey("season", null, dirty), "matrix.leaveUnsaved");
  assert.equal(leaveConfirmKey("season", "distribute", dirty), "matrix.leaveUnsaved");
  // Et klik paa Saeson mens Saeson vises afmonterer intet.
  assert.equal(leaveConfirmKey("season", "season", dirty), null);
  assert.equal(leaveConfirmKey("season", null, clean), null);
});

test("ugemt dags-tavle: 'Tilbage til ugen' og et skift i vaelgeren spoerger med tavlens eget spoergsmaal", () => {
  const dirty = { season: false, board: true };
  assert.equal(leaveConfirmKey("distribute", null, dirty), "racehub.leaveUnsaved");
  assert.equal(leaveConfirmKey("distribute", "season", dirty), "racehub.leaveUnsaved");
  assert.equal(leaveConfirmKey("distribute", null, clean), null);
});

test("fra Uge og Maaned spoerges aldrig her (Uge staar monteret, Maaned har ingen kladde)", () => {
  const all = { season: true, board: true };
  assert.equal(leaveConfirmKey(null, "season", all), null);
  assert.equal(leaveConfirmKey(null, "distribute", all), null);
  assert.equal(leaveConfirmKey(null, null, all), null);
});

test("adressen for en visning rydder dags-tavlens parametre og beholder loebet", () => {
  const prev = new URLSearchParams("mode=season&race=r1&day=4&returnView=season&scope=mine");
  assert.equal(paramsForMode(prev, "week").toString(), "race=r1");
  assert.equal(paramsForMode(prev, "month").toString(), "mode=month&race=r1");
  // Den gamle adresse roeres ikke.
  assert.equal(prev.get("day"), "4");
});

test("ledninger: siden spoerger foer vaelgeren, 'Tilbage til ugen' og et loeb fra Saeson skifter visning", () => {
  const page = read("../../pages/PlanningWorkbenchPage.tsx");
  // Sidehovedets vaelger gaar gennem vagten, aldrig direkte til changeMode.
  assert.match(page, /onChange=\{\(next: PlanningMode\) => requestMode\(next\)\}/);
  assert.doesNotMatch(page, /onChange=\{\(next: PlanningMode\) => changeMode\(next\)\}/);
  // "Tilbage til ugen" / "Tilbage til saesonen".
  assert.match(page, /const closeDistribute = \(\) => \{[\s\S]*?requestMode\(back\);/);
  // Et loeb aabnet fra Saeson spoerger foerst og skifter til Uge.
  assert.match(page, /const openRaceFromSeason = \(id: string\) => \{\s*if \(!confirmLeave\(null\)\) return;/);
  assert.match(page, /window\.confirm\(tr\(key\)\)/);
  // Fladerne melder deres kladde op.
  assert.match(page, /<SeasonMatrixView onOpenRace=\{openRaceFromSeason\} onDirtyChange=\{setSeasonDirty\} \/>/);
  assert.match(page, /<RaceHubBoard onDirtyChange=\{setBoardDirty\} \/>/);
  // Den gamle Saeson-visning (uden linser) er ikke laengere monteret paa den nye side.
  assert.doesNotMatch(page, /racehub\/SeasonView\.jsx/);
});

test("ledninger: matrixen og dags-tavlen melder kladden og nulstiller den, naar de afmonteres", () => {
  const view = read("./SeasonMatrixView.tsx");
  assert.match(view, /onDirtyChange\?\.\(matrixDirty\);\s*\}, \[matrixDirty, onDirtyChange\]\);/);
  assert.match(view, /useEffect\(\(\) => \(\) => onDirtyChange\?\.\(false\), \[onDirtyChange\]\);/);
  const board = read("../racehub/RaceHubBoard.jsx");
  assert.match(board, /export default function RaceHubBoard\(\{ onDirtyChange \} = \{\}\)/);
  assert.match(board, /useEffect\(\(\) => \{ onDirtyChange\?\.\(boardDirty\); \}, \[boardDirty, onDirtyChange\]\);/);
  assert.match(board, /useEffect\(\(\) => \(\) => onDirtyChange\?\.\(false\), \[onDirtyChange\]\);/);
});

test("spoergsmaalene findes paa engelsk og dansk", () => {
  for (const lang of ["en", "da"]) {
    const races = JSON.parse(read(`../../../public/locales/${lang}/races.json`));
    assert.equal(typeof races.matrix?.leaveUnsaved, "string", `${lang} matrix.leaveUnsaved`);
    assert.equal(typeof races.racehub?.leaveUnsaved, "string", `${lang} racehub.leaveUnsaved`);
  }
});
