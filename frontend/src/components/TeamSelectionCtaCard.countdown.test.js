// #3243 — TeamSelectionCtaCard viser nu en ægte race_stage_schedule-countdown
// til et nyt holds første løb (startAtMs/nowMs), i stedet for at holde
// spilleren i uvished om HVORNÅR løbet kører. Kildekode-struktur-guard, samme
// mønster som MyLatestResultCard.seenServerFlag.test.js — repoet kører
// node --test uden DOM-renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "TeamSelectionCtaCard.jsx"), "utf8");

test("#3243 accepterer startAtMs/nowMs som valgfrie props (default null, ingen breaking change)", () => {
  assert.match(
    source,
    /export default function TeamSelectionCtaCard\(\{\s*nextRace,\s*startAtMs\s*=\s*null,\s*nowMs\s*=\s*null\s*\}\)/,
    "startAtMs/nowMs skal være valgfrie med null-default",
  );
});

test("#3243 genbruger den delte formatCountdown i stedet for at duplikere countdown-logik lokalt", () => {
  assert.match(
    source,
    /import\s*\{\s*formatCountdown\s*\}\s*from\s*"\.\.\/lib\/stageScheduleConfig\.js"/,
    "skal importere formatCountdown fra den delte lib (samme som DashboardPage bruger)",
  );
});

test("#3243 renderer kun countdown-linjen når begge tidsstempler er finite tal", () => {
  assert.match(
    source,
    /const showCountdown = Number\.isFinite\(startAtMs\) && Number\.isFinite\(nowMs\);/,
    "gaten skal kræve BEGGE tal, ellers kan formatCountdown få NaN",
  );
  assert.match(
    source,
    /\{showCountdown && \(/,
    "countdown-teksten skal være betinget på showCountdown",
  );
});

test("#3243 bruger tabular-nums på countdown-teksten (numerisk figur — designregel)", () => {
  assert.match(
    source,
    /tabular-nums.*\{formatCountdown\(startAtMs, nowMs, t\)\}/s,
    "countdown-teksten skal ligge i et element med tabular-nums",
  );
});
