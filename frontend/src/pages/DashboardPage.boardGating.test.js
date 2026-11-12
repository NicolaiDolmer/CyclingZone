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
// Fix: gate kortet på `isVisible("board") && board`, så det kun vises når en
// rigtig plan-board findes. Den nu-døde `!board`-tom-state-gren er fjernet.
//
// Repoet kører `node --test` uden DOM-renderer, så vi guard'er invarianten
// kildekode-strukturelt (samme mønster som FinancePage.loadStates.test.js).

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "DashboardPage.jsx"), "utf8");

// #8022: only the pending desktop frame is exempt from confirmed board absence.
test("#1488/#8022 board visibility permits only a pending desktop frame before confirmation", () => {
  assert.match(
    source,
    /\{isVisible\("board"\)\s*&&\s*\(board\s*\|\|\s*loading\)\s*&&\s*\(/,
    "confirmed board absence must hide the card; only core loading permits a pending frame",
  );
  assert.match(source, /className=\{board \? undefined : "hidden lg:block"\}/);
});

test("#1488 board udledes fra activePlan (kun non-null når en plan findes)", () => {
  // activePlan = plans["1yr"] || plans["3yr"] || plans["5yr"] || null
  assert.match(
    source,
    /boardStatus\?\.plans\?\.\["1yr"\][\s\S]*?\["3yr"\][\s\S]*?\["5yr"\][\s\S]*?\|\|\s*null/,
    "activePlan skal falde tilbage til null når ingen plan findes",
  );
  assert.match(
    source,
    /setBoard\(activePlan\?\.board\s*\|\|\s*null\)/,
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
