// #7535 rettelsesrunde 2 (PR #8160) og Handlinger-menuen (variant B): kilde-kontrakt for
// planlaegningssidens skrive-laas. Repoet koerer node --test uden jsdom, saa komponenternes ledninger
// pinnes paa kilden (samme moenster som RaceTacticsTab.contract.test.js). Selve laasen, kladden og
// raekkefoelgerne er proevet med styrede loefter i lib/planningWorkbench.test.ts; her sikres det, at
// ALLE veje faktisk bruger den samme laas.
//
// Hvad der pinnes:
//   1. Hvert kald (gem, afmeld, masse-gem, masse-afmeld, assistentens forslag) sendes inde i
//      gate.run(...), aldrig udenom, og siden sender ingen af masse-kaldene selv.
//   2. "Gemmer" er ikke en visnings-tilstand paa fladen (saveState), saa en anvendt kladde, der
//      nulstiller visningen, kan aldrig slippe laasen (Codex' fund paa RaceWorkbench.tsx).
//   3. Siden har ingen egne optaget-flag ved siden af laasen, og Handlinger/Fortryd/Gem/loebsskift
//      laeser den.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");
const workbench = read("RaceWorkbench.tsx");
const page = read("../../pages/PlanningWorkbenchPage.tsx");
const raceList = read("RaceList.tsx");
const bulkUi = read("BulkActions.tsx");
const model = read("../../lib/planningWorkbench.ts");

/** Hvert kald af `call` ligger kort efter et gate.run(kind, ...) i samme funktion. */
function insideGate(src: string, call: string, kind: string) {
  let from = 0;
  let found = 0;
  for (;;) {
    const at = src.indexOf(call, from);
    if (at < 0) break;
    found += 1;
    const gateAt = src.lastIndexOf(`gate.run("${kind}"`, at);
    assert.ok(gateAt >= 0 && at - gateAt < 900, `${call} sendes uden om skrive-laasen (${kind})`);
    from = at + call.length;
  }
  assert.ok(found > 0, `${call} findes ikke laengere: opdatér kontrakten`);
}

test("skrive-laas: gem, afmeld, masse-gem, masse-afmeld og assistenten sendes kun gennem gate.run", () => {
  insideGate(workbench, "saveRaceSelection(race.id", "save");
  insideGate(workbench, "setRaceWithdrawal(race.id", "withdraw");
  insideGate(model, "api.saveSelections(", "bulk");
  insideGate(model, "api.withdraw(", "bulk");
  insideGate(model, "api.propose(", "assist");
  // Siden giver kun de rigtige kald til kladden; den sender dem aldrig selv.
  assert.match(page, /createBulkStore\(\{ gate, api: \{ propose: proposeAssistantSquads, saveSelections: saveRaceSelectionsBulk, withdraw: withdrawRacesBulk \} \}\)/);
  assert.doesNotMatch(page, /saveRaceSelectionsBulk\(|withdrawRacesBulk\(|proposeAssistantSquads\(/);
});

test("skrive-laas: 'gemmer' er ikke fladens visnings-tilstand, saa en anvendt kladde kan ikke slippe laasen", () => {
  assert.doesNotMatch(workbench, /setSaveState\("saving"\)/);
  assert.doesNotMatch(workbench, /saveState === "saving"/);
  assert.match(workbench, /useSyncExternalStore\(gate\.subscribe, gate\.current\)/);
  assert.match(workbench, /const edit = \(next: Selection\) => \{\s*\/\/[^\n]*\n\s*if \(gate\.current\(\)\) return;/, "fladen aendres ikke midt i et kald");
});

test("skrive-laas: siden har ét sted for 'der er et kald i gang', og alle veje laeser det", () => {
  assert.doesNotMatch(page, /setClearBusy|setWorkbenchBusy|setBarBusy|onBusyChange|setBulkBusy/, "ingen egne optaget-flag ved siden af laasen");
  assert.match(page, /createWriteGate\(\)/);
  assert.match(page, /gate=\{gate\}/, "fladen faar sidens laas");
  assert.equal((page.match(/locked=\{writing !== null\}/g) ?? []).length, 2, "Handlinger-menuen og kladde-bjaelken venter begge");
  assert.match(page, /raceSwitchStep\(\{/, "loebsskift laeser laasen");
  assert.match(bulkUi, /onClick=\{onUndo\} disabled=\{busy \|\| locked\}/, "Fortryd venter");
  assert.match(bulkUi, /disabled=\{locked\}\s*loading=\{assisting\}/, "Handlinger-knappen venter");
  assert.match(bulkUi, /disabled=\{n === 0 \|\| locked\}/, "hver handling venter");
  // Den gamle "Ryd udtagelser"-knap er erstattet af menuen.
  assert.doesNotMatch(raceList, /planning-clear-shown|onClear\b/);
});
