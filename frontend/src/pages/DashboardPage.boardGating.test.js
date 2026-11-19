import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #1488 — Dashboard viste bestyrelses-kortet ("Board Status" + "No board data")
// FØR bestyrelsen var etableret. Kortet var kun gated på modul-synlighed
// (isVisible("board"), default true), IKKE på om en plan-board faktisk fandtes.
// Under sæson-1 baseline-fasen returnerer backend plans[1yr/3yr/5yr]=null, så
// `board` (udledt af activePlan?.board) bliver null — men kortet renderede
// alligevel den tomme "No board data"-state.
//
// Bekræftet fravær skjuler kortet. En afventende forespørgsel reserverer kun
// kortets ramme, og indholdet kræver stadig et etableret board.
//
// Repoet kører `node --test` uden DOM-renderer, så vi guard'er invarianten
// kildekode-strukturelt (samme mønster som FinancePage.loadStates.test.js).

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "DashboardPage.jsx"), "utf8");
const dataSource = readFileSync(join(__dirname, "..", "data", "dashboardData.ts"), "utf8"); // #6494: server data moved to the data layer

test("#1488 board-kortet er skjult ved bekræftet fravær, men bevarer en pending-ramme", () => {
  assert.match(
    source,
    /\{isVisible\("board"\)\s*&&\s*\(board \|\| dashboard\.boardPending\)\s*&&\s*\(/,
    "rammen vises kun for et etableret board eller en afventende læsning",
  );
  assert.match(source, /\{board \? <div>/, "boardets indhold kræver et etableret board");
  assert.match(dataSource, /boardPending: hasTeam && boardQuery\.isPending/);
});

test("#1488 board udledes fra activePlan (kun non-null når en plan findes)", () => {
  // activePlan = plans["1yr"] || plans["3yr"] || plans["5yr"] || null
  assert.match(
    dataSource,
    /boardStatus\?\.plans\?\.\["1yr"\][\s\S]*?\["3yr"\][\s\S]*?\["5yr"\][\s\S]*?\|\|\s*null/,
    "activePlan skal falde tilbage til null når ingen plan findes",
  );
  assert.match(
    dataSource,
    /board: activePlan\?\.board\s*\|\|\s*null/,
    "board skal sættes til activePlan?.board || null",
  );
});

test("#1488 den døde tom-state-gren ('No board data') er fjernet fra kortet", () => {
  // Kortets indhold renderes nu kun når board findes, så den gamle
  // `!board ? <empty> : <board>`-ternary skal være væk.
  assert.doesNotMatch(
    source,
    /\{!board\s*\?\s*\(/,
    "den døde !board-tom-state-gren skal være fjernet (uopnåelig efter gate-fixet)",
  );
});
