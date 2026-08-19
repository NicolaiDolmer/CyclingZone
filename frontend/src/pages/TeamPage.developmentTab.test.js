import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #3979/#3721 (ejer-beslutning 19/8) — holdsiden får en "Development"-fane
// ved siden af Squad. Kilde-tekst-guard (samme mønster som
// TeamPage.squadTable.test.js) — node --test har ingen DOM.

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "TeamPage.jsx"), "utf8");

test("TeamDevelopmentTab er importeret og fanen tilføjet ved siden af Squad", () => {
  assert.match(src, /import TeamDevelopmentTab from "..\/components\/TeamDevelopmentTab"/);
  assert.match(src, /key: "development", label: t\("tabs\.development"\)/, "faneraekken skal have en development-fane");
});

test("Development-fanen renderes med holdets nuvaerende trup + delt scouting-hook", () => {
  assert.match(
    src,
    /activeTab === "development" &&[\s\S]{0,120}?<TeamDevelopmentTab riders=\{currentRiders\} scouting=\{scouting\} seasonYear=\{seasonYear\} \/>/,
    "Development-fanen skal faa currentRiders (samme trup som Stats-fanen) + den delte useScouting-instans",
  );
});

test("fanerne staar i raekkefoelgen Squad, Development, Stats, Transfers", () => {
  const tabsBlock = src.match(/const tabs = \[[\s\S]*?\];/);
  assert.ok(tabsBlock, "tabs-arrayet skal findes");
  const keys = [...tabsBlock[0].matchAll(/key: "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys, ["squad", "development", "stats", "transfers"]);
});
