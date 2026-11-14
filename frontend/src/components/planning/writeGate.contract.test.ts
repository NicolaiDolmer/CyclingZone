// #7535 rettelsesrunde 2 (PR #8160): kilde-kontrakt for planlaegningssidens skrive-laas. Repoet koerer
// node --test uden jsdom, saa komponenternes ledninger pinnes paa kilden (samme moenster som
// RaceTacticsTab.contract.test.js). Selve laasen og raekkefoelgerne er proevet med styrede loefter i
// lib/planningWorkbench.test.ts; her sikres det, at ALLE veje faktisk bruger den samme laas.
//
// Hvad der pinnes:
//   1. Hvert skrivekald (gem, afmeld, masse-gem) sendes inde i gate.run(...), aldrig udenom.
//   2. "Gemmer" er ikke en visnings-tilstand paa fladen (saveState), saa en anvendt kladde, der
//      nulstiller visningen, kan aldrig slippe laasen (Codex' fund paa RaceWorkbench.tsx).
//   3. Sidens rydning og fortrydelse anvendes gennem pageClearStep med laasens tilstand.
//   4. Siden har ingen egne optaget-flag ved siden af laasen, og Ryd/Fortryd/Gem/loebsskift laeser den.
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
const bars = read("UnsavedBar.tsx");

/** Hvert kald af `call` ligger kort efter et gate.run(kind, ...) i samme funktion. */
function insideGate(src: string, call: string, kind: string) {
  let from = 0;
  let found = 0;
  for (;;) {
    const at = src.indexOf(call, from);
    if (at < 0) break;
    found += 1;
    const gateAt = src.lastIndexOf(`gate.run("${kind}"`, at);
    assert.ok(gateAt >= 0 && at - gateAt < 400, `${call} sendes uden om skrive-laasen (${kind})`);
    from = at + call.length;
  }
  assert.ok(found > 0, `${call} findes ikke laengere: opdatér kontrakten`);
}

test("skrive-laas: gem, afmeld og masse-gem sendes kun gennem gate.run", () => {
  insideGate(workbench, "saveRaceSelection(race.id", "save");
  insideGate(workbench, "setRaceWithdrawal(race.id", "withdraw");
  insideGate(page, "saveRaceSelectionsBulk(changes", "bulk");
});

test("skrive-laas: 'gemmer' er ikke fladens visnings-tilstand, saa en anvendt kladde kan ikke slippe laasen", () => {
  assert.doesNotMatch(workbench, /setSaveState\("saving"\)/);
  assert.doesNotMatch(workbench, /saveState === "saving"/);
  assert.match(workbench, /useSyncExternalStore\(gate\.subscribe, gate\.current\)/);
  assert.match(workbench, /pageClearStep\(\{[^}]*writing[^}]*\}\)/, "rydning og fortrydelse venter paa laasen");
});

test("skrive-laas: siden har ét sted for 'der er et kald i gang', og alle veje laeser det", () => {
  assert.doesNotMatch(page, /setClearBusy|setWorkbenchBusy|setBarBusy|onBusyChange/, "ingen egne optaget-flag ved siden af laasen");
  assert.match(page, /createWriteGate\(\)/);
  assert.match(page, /gate=\{gate\}/, "fladen faar sidens laas");
  assert.match(page, /clearLocked=\{writing !== null\}/, "Ryd udtagelser venter");
  assert.match(page, /locked=\{writing !== null\}/, "masse-gem og Fortryd venter");
  assert.match(page, /raceSwitchStep\(\{/, "loebsskift laeser laasen");
  assert.match(raceList, /disabled=\{clearCount === 0 \|\| clearLocked\}/);
  assert.match(bars, /onClick=\{onUndo\} disabled=\{busy \|\| locked\}/);
});
