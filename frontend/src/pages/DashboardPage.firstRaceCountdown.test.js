import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #3243 — TeamSelectionCtaCard får nu en ægte countdown til et nyt holds
// første løb (startAtMs fra nextStageByRace, samme kilde som "Kommende
// løb"-kortet). Repoet kører `node --test` uden DOM-renderer, så vi guard'er
// wiringen kildekode-strukturelt (samme mønster som DashboardPage.boardGating.test.js).

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "DashboardPage.jsx"), "utf8");

test("#3243 TeamSelectionCtaCard modtager startAtMs fra nextStageByRace + nowMs", () => {
  assert.match(
    source,
    /<TeamSelectionCtaCard\s*\n\s*nextRace=\{squadSelectionMissingRace\}\s*\n\s*startAtMs=\{squadSelectionMissingRace \? nextStageByRace\[squadSelectionMissingRace\.id\] : null\}\s*\n\s*nowMs=\{nowMs\}/,
    "kortet skal have adgang til samme countdown-tidsstempel som resten af dashboardet",
  );
});

test("#3243 genbruger delt formatCountdown i stedet for en lokal duplikeret funktion", () => {
  assert.match(
    source,
    /import \{ formatCountdown \} from "\.\.\/lib\/stageScheduleConfig\.js";/,
    "skal importere den delte helper",
  );
  assert.doesNotMatch(
    source,
    /function nextStageCountdown/,
    "den gamle lokale duplikat skal være fjernet — formatCountdown er nu eneste kilde",
  );
});
