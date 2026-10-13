import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #1140 - det TOMME "How your team did" (race: null) skjules mens "Your first race"
// vises. Repoet koerer `node --test` uden DOM, saa wiringen guard'es kildekode-
// strukturelt (samme moenster som DashboardPage.firstRaceCountdown.test.js).
// Adfaerden bevises ende-til-ende i tests/e2e/1140-first-race-card.spec.ts.

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "DashboardPage.jsx"), "utf8");

test("#1140 tomt resultatkort skjules kun naar first-race-kortet vises OG race er null", () => {
  assert.match(
    source,
    /const myLatestResultEmptyHidden = Boolean\(firstRaceCardModel\) && myLatestResult\?\.race === null;/,
  );
});

test("#1140 myLatestResultPaired respekterer skjulningen og defineres efter firstRaceCardModel", () => {
  assert.match(
    source,
    /const myLatestResultPaired = !firstRaceMomentActive && myLatestResultVisible && !myLatestResultEmptyHidden;/,
  );
  assert.ok(
    source.indexOf("const firstRaceCardModel") < source.indexOf("const myLatestResultPaired"),
    "myLatestResultPaired skal staa efter firstRaceCardModel (ellers TDZ-fejl)",
  );
});
