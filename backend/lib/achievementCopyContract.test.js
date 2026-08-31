import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  AUCTION_WIN_THRESHOLDS,
  BOARD_SATISFACTION_TARGET,
  HIGH_ROLLER_BID_THRESHOLD,
  LOGIN_STREAK_THRESHOLDS,
  NEGOTIATOR_MIN_ROUNDS,
  SEASON_COUNT_THRESHOLDS,
  SEASON_DIVISION_WINNER_ACHIEVEMENTS,
  SEASON_RANK_THRESHOLDS,
  SINGLE_PROGRESS,
  TEAM_SIZE_THRESHOLDS,
  TRANSFER_THRESHOLDS,
  YOUTH_U25_SHARE,
} from "./achievementEngine.js";
import { STAR_RIDER_MARKET_VALUE } from "./economyConstants.js";
import { SEASON_TOP3_STREAK_TARGET } from "./seasonAchievements.js";

// ─── #4414 · Kode og copy må ikke drive fra hinanden ────────────────────────
//
// High Roller krævede et bud > 2.000.000.000 CZ$ mens copy'en lovede 500.000.
// Det er tredje gang en hårdkodet tærskel er blevet stum: #1205 (bargain/star
// målte CZ$ mod rå uci_points efter 4000x-skaleringen) og #2917 (13 sæson-
// achievements defineret uden unlock-logik). Denne test binder hvert tal i
// motoren til tallet i achievements.json — begge veje:
//
//   1. hver tærskel i koden SKAL stå i copy'en (en + da)
//   2. hvert tal i copy'en SKAL have en konstant bag sig
//
// Retning 2 er den der fanger #2917-klassen: en definition med et tal i
// teksten, som ingen kode kan tildele.

const LOCALES = join(import.meta.dirname, "..", "..", "frontend", "public", "locales");
const LANGUAGES = ["en", "da"];

const ENGINE_SOURCE = readFileSync(join(import.meta.dirname, "achievementEngine.js"), "utf8");

// Copy'en for disse er ordbaseret ("your first auction", "Win your division"),
// ikke tal-baseret — der er intet tal i teksten at binde tærsklen til.
const WORDED_COPY = new Set(["auction_first_win", "transfer_first", "season_winner"]);

// Definitioner UDEN unlock-logik i motoren: tallet i copy'en har ingen konstant
// bag sig, fordi ingen kode kan tildele achievementen (#2917-klassen). Listen
// skal krympe, aldrig vokse — implementeres en af dem, fjernes den herfra og
// dækkes af kontrakten nedenfor i stedet.
const ENGINE_GAP = new Set(["auction_5_streak", "secret_rival", "secret_heartbreak"]);

// Kontrakten bygges af de SAMME konstanter som motoren bruger — ikke af tal
// skrevet af igen, ellers ville guarden bare gentage fejlen den skal fange.
const COPY_NUMBER_CONTRACT = new Map([
  ...AUCTION_WIN_THRESHOLDS,
  ...TRANSFER_THRESHOLDS,
  ...TEAM_SIZE_THRESHOLDS,
  ...LOGIN_STREAK_THRESHOLDS,
  ...SEASON_COUNT_THRESHOLDS,
  ...SEASON_RANK_THRESHOLDS,
  ...SEASON_DIVISION_WINNER_ACHIEVEMENTS,
  ...SINGLE_PROGRESS.map(([achievementId, target]) => [achievementId, target]),
  ["auction_high_roller", HIGH_ROLLER_BID_THRESHOLD],
  ["transfer_negotiator", NEGOTIATOR_MIN_ROUNDS],
  ["team_youth", YOUTH_U25_SHARE * 100],
  ["team_star", STAR_RIDER_MARKET_VALUE],
  ["season_3_top3", SEASON_TOP3_STREAK_TARGET],
  ["season_board_100", BOARD_SATISFACTION_TARGET],
]);

// DA bruger "." som tusindseparator, EN ",", så begge strippes: "500.000" og
// "500,000" normaliseres til 500000. Lookbehinden holder tal-i-ord ude — "U25"
// i "50% U25 riders" er ikke en tærskel (hverken "25" eller halen "5").
const NUMBER_PATTERN = /(?<![\p{L}\d])\d[\d.,]*\d|(?<![\p{L}\d])\d/gu;

function numbersIn(description) {
  const matches = description.match(NUMBER_PATTERN) || [];
  return matches.map(raw => Number(raw.replace(/[.,]/g, "")));
}

function loadCopy(language) {
  return JSON.parse(readFileSync(join(LOCALES, language, "achievements.json"), "utf8"));
}

test("#4414 · hver taerskel i motoren staar ordret i achievement-copy'en (en + da)", () => {
  for (const language of LANGUAGES) {
    const copy = loadCopy(language);

    for (const [achievementId, threshold] of COPY_NUMBER_CONTRACT) {
      if (WORDED_COPY.has(achievementId)) continue;

      const entry = copy[achievementId];
      assert.ok(entry, `${language}: achievements.json mangler ${achievementId}`);
      assert.ok(
        numbersIn(entry.description).includes(threshold),
        `${language}.${achievementId}: koden kræver ${threshold}, men copy'en siger "${entry.description}"`
      );
    }
  }
});

test("#4414 · intet tal i achievement-copy'en uden en konstant bag sig (en + da)", () => {
  for (const language of LANGUAGES) {
    const copy = loadCopy(language);

    for (const [achievementId, entry] of Object.entries(copy)) {
      if (ENGINE_GAP.has(achievementId)) continue;

      const expected = COPY_NUMBER_CONTRACT.get(achievementId);
      for (const number of numbersIn(entry.description)) {
        assert.equal(
          number,
          expected,
          `${language}.${achievementId}: copy'en lover ${number}, men koden har ${expected ?? "ingen tærskel"} ("${entry.description}")`
        );
      }
    }
  }
});

test("#4414 · ENGINE_GAP-listen holdes aerlig: ingen af dem har unlock-logik", () => {
  for (const achievementId of ENGINE_GAP) {
    assert.ok(
      !ENGINE_SOURCE.includes(`unlock("${achievementId}"`),
      `${achievementId} har fået unlock-logik — fjern den fra ENGINE_GAP, så tallet i copy'en bliver bundet til konstanten`
    );
  }
});
