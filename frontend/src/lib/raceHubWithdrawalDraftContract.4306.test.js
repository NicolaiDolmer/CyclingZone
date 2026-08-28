// #4306: "Et afmeldt hold starter stadig løbet". To dele af dette dækkes her via
// kilde-scanning (samme mønster som silentFailureContract.*.test.js, der er ingen
// jsdom i denne kodebase, så RaceHubBoard/RaceColumn kan ikke rendres i node --test):
//
//   1. RaceHubBoard.jsx: en lykkedes afmelding rydder kolonnens lokale kladde, så
//      "Gem" ikke kan sende en overlevende kladde ind i det løb man netop har
//      afmeldt sig fra. Kladden ryddes KUN ved et faktisk gennemført kald (ikke ved
//      en fejlet afmelding, fx et løb der allerede er startet).
//   2. RaceColumn.jsx: et afmeldt holds kolonne viser IKKE længere et tomt kort,
//      den siger tydeligt at holdet frivilligt ikke stiller op (ejerens egne ord,
//      27/8).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const raceHubBoard = read("../components/racehub/RaceHubBoard.jsx");
const raceColumn = read("../components/racehub/RaceColumn.jsx");

test("RaceHubBoard: mutate() returnerer om kaldet lykkedes (grundlag for kladde-ryd ved succes)", () => {
  assert.match(raceHubBoard, /async function mutate\(req, errParams = \{\}\) \{/);
  assert.match(raceHubBoard, /return ok;\s*\n\s*\}/, "mutate skal returnere ok-flaget til kalderen");
});

test("RaceHubBoard: toggleWithdraw rydder KUN kolonnens kladde ved et lykkedes withdraw=true-kald (#4306)", () => {
  const start = raceHubBoard.indexOf("const toggleWithdraw = ");
  assert.ok(start !== -1, "toggleWithdraw skal findes");
  const block = raceHubBoard.slice(start, start + 500);
  assert.match(
    block,
    /\.then\(\(ok\) => \{\s*\n\s*if \(ok && withdraw\) setDrafts\(\(d\) => \{ const next = \{ \.\.\.d \}; delete next\[raceId\]; return next; \}\);/,
    "kladden for raceId skal ryddes kun når ok && withdraw",
  );
  // Kontrol: hverken "gen-deltag" (withdraw=false) eller et fejlet kald må rydde kladden.
  assert.doesNotMatch(block, /setDrafts\(\{\}\)/, "toggleWithdraw må IKKE rydde ALLE kolonners kladder, kun sin egen");
});

test("RaceColumn: withdrawn kolonne viser en synlig, diskret note i stedet for et tomt kort (#4306)", () => {
  // Den gamle adfærd (før #4306) var `: null`, et helt tomt kort for et afmeldt løb.
  assert.doesNotMatch(
    raceColumn,
    /\)\s*: null\}\s*\n\s*<div className="p-2 border-t/,
    "withdrawn-grenen må ikke længere rendre et tomt kort",
  );
  assert.match(raceColumn, /t\("racehub\.column\.withdrawnNote"\)/, "withdrawn-noten skal bruge i18n-nøglen (EN/DA), ikke en hardkodet streng");
});

test("RaceColumn: withdrawn har forrang over locked, noten forsvinder ikke igen naar loebet starter (#4306 major-fund)", () => {
  // Adversarisk verifikation fandt at withdrawnNote forsvandt igen fra og med etape 1,
  // fordi lineup_locked overtrumfede withdrawn i baade status-badget og kort-kroppen.
  // Status-badget skal afgoere withdrawn FOER locked.
  assert.match(raceColumn, /const status = column\.withdrawn\s*\n\s*\? \{ kind: "withdrawn"/, "status skal tjekke column.withdrawn foer locked");

  // Kort-kroppen: withdrawn-grenen skal ligge FOER locked-grenen i selve ternary'en, saa
  // withdrawnNote vises uanset lineup_locked, ikke kun i perioden foer loebsstart.
  const bodyIdx = raceColumn.indexOf("{column.withdrawn ? (");
  const lockedBranchIdx = raceColumn.indexOf(") : locked ? (");
  assert.ok(bodyIdx !== -1 && lockedBranchIdx !== -1, "begge markoerer skal findes");
  assert.ok(bodyIdx < lockedBranchIdx, "withdrawn-grenen skal komme foer locked-grenen i kort-kroppen");
});

test("i18n: racehub.column.withdrawnNote findes i BÅDE en og da races.json", () => {
  const en = JSON.parse(read("../../public/locales/en/races.json"));
  const da = JSON.parse(read("../../public/locales/da/races.json"));
  assert.equal(typeof en.racehub.column.withdrawnNote, "string");
  assert.ok(en.racehub.column.withdrawnNote.length > 0);
  assert.equal(typeof da.racehub.column.withdrawnNote, "string");
  assert.ok(da.racehub.column.withdrawnNote.length > 0);
  // Ingen em-dash (tankestreg) i spillervendt copy: projektreglen forbyder den overalt.
  assert.ok(!en.racehub.column.withdrawnNote.includes("—"));
  assert.ok(!da.racehub.column.withdrawnNote.includes("—"));
});
