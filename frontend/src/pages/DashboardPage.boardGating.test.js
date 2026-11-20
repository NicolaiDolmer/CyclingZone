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
// #8019 (ejer 20/11, hurtigt men uden blink): bestyrelsen hentes for sig selv,
// og kortet har INGEN pladsholder mens læsningen står på. En grå kasse der
// forsvinder igen for spillere uden plan er et blink. De moduler der afhænger
// af bestyrelsen venter i stedet stille, så intet skifter efter første visning.
//
// Repoet kører `node --test` uden DOM-renderer, så vi guard'er invarianten
// kildekode-strukturelt (samme mønster som FinancePage.loadStates.test.js).

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "DashboardPage.jsx"), "utf8");
const dataSource = readFileSync(join(__dirname, "..", "data", "dashboardData.ts"), "utf8"); // #6494: server data moved to the data layer

test("#1488 board-kortet er gated på BÅDE modul-synlighed OG en etableret board", () => {
  assert.match(
    source,
    /\{isVisible\("board"\)\s*&&\s*board\s*&&\s*\(/,
    'board-kortet skal gates på `isVisible("board") && board` — ellers vises det tomt i baseline-fasen',
  );
});

test("#8019 ingen pladsholder for bestyrelseskortet, mens læsningen står på", () => {
  assert.doesNotMatch(source, /board \|\| dashboard\.boardPending/, "en afventende læsning må ikke vise kortets ramme");
  assert.match(dataSource, /boardPending: hasTeam && boardQuery\.isPending/);
});

test("#8019 de bestyrelses-afhængige moduler skifter ikke efter første visning", () => {
  // Næste træk kan få et bestyrelsespunkt: kortet venter i sin reserverede tilstand.
  assert.match(source, /<NextActionsCard[\s\S]{0,200}?loading=\{[^}]*dashboard\.boardPending\}/);
  // Global Rank står efter kortet: den vises først når bestyrelsen er afklaret,
  // men monteres med det samme (`hidden`/`contents`, ingen ekstra grid-celle).
  assert.match(source, /className=\{dashboard\.boardPending \? "hidden" : "contents"\}>\s*<GlobalRankWidget \/>/);
  // Sæsonstart-guiden: siden venter på bestyrelsen i vinduet, inden for samme budget.
  assert.match(source, /const boardHoldsReveal = dashboard\.boardPending && seasonStartWindowOpen && !seasonStartDismissed;/);
  assert.match(source, /const initialDataReady = [^\n]*!boardHoldsReveal/);
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
