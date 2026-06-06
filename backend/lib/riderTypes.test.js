import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RIDER_TYPES,
  RIDER_TYPE_KEYS,
  STAT_KEYS,
  scoreRiderType,
  computeRiderTypes,
} from "./riderTypes.js";

// Syntetisk baseline (mean 50, std 10 pr. stat) — gør testene uafhængige af den
// fittede riderTypesBaseline.json (som ændrer sig med populationen).
const BASELINE = {
  mean: Object.fromEntries(STAT_KEYS.map((s) => [s, 50])),
  std: Object.fromEntries(STAT_KEYS.map((s) => [s, 10])),
};

// Profil proportional med en types vægte: stat-værdi = base + scale·vægt (over
// baseline-mean), øvrige stats = baseline-mean. Matcher en ægte profil for typen.
function riderFavoring(typeKey, { base = 50, scale = 3 } = {}) {
  const rider = Object.fromEntries(STAT_KEYS.map((s) => [s, base]));
  const type = RIDER_TYPES.find((t) => t.key === typeKey);
  for (const [stat, w] of Object.entries(type.weights)) rider[stat] = base + scale * w;
  return rider;
}

// gc og goat er brede "stærk-overalt"-typer hvis stat-sæt er supersets af
// fokuserede typer (climber/rouleur), så de bliver sjældent primær — men skal
// kunne nå top-2. De øvrige 10 skal isolere som primær. Verificeret mod data.
const BROAD_TYPES = new Set(["gc", "goat"]);

test("RIDER_TYPES indeholder de 12 forventede typer i tie-break-rækkefølge", () => {
  assert.equal(RIDER_TYPES.length, 12);
  assert.deepEqual(RIDER_TYPE_KEYS, [
    "sprinter", "leadout", "climber", "puncheur", "tt", "classics",
    "gc", "goat", "allrounder", "rouleur", "baroudeur", "domestique",
  ]);
});

test("scoreRiderType: z-vægtet gennemsnit (hånd-regnet eksempel)", () => {
  // tt = { stat_tt:3, stat_prl:2 }. tt=70 → z=2; prl=60 → z=1.
  // score = (3·2 + 2·1) / 5 = 8/5 = 1.6
  const rider = { stat_tt: 70, stat_prl: 60 };
  assert.equal(scoreRiderType(rider, RIDER_TYPES.find((t) => t.key === "tt").weights, BASELINE), 1.6);
});

test("de 10 fokuserede typer isolerer som primær for en ren profil", () => {
  for (const t of RIDER_TYPES) {
    if (BROAD_TYPES.has(t.key)) continue;
    const { primary } = computeRiderTypes(riderFavoring(t.key), BASELINE);
    assert.equal(primary.key, t.key, `forventede ${t.key} som primær, fik ${primary.key}`);
  }
});

test("brede typer (gc/goat) når mindst top-2 for deres egen profil", () => {
  for (const key of BROAD_TYPES) {
    const { primary, secondary } = computeRiderTypes(riderFavoring(key), BASELINE);
    assert.ok([primary.key, secondary.key].includes(key), `${key} bør være i top-2`);
  }
});

test("computeRiderTypes returnerer altid primær + sekundær (top-2)", () => {
  const { primary, secondary } = computeRiderTypes(riderFavoring("sprinter"), BASELINE);
  assert.ok(primary && typeof primary.key === "string");
  assert.ok(secondary && typeof secondary.key === "string");
  assert.notEqual(primary.key, secondary.key);
  assert.ok(primary.score >= secondary.score);
});

test("edge: alle stats null → z=0, deterministisk top-2, ingen crash", () => {
  const { primary, secondary } = computeRiderTypes({}, BASELINE);
  assert.equal(primary.score, 0);
  assert.equal(secondary.score, 0);
  // Tie-break = RIDER_TYPES-rækkefølge.
  assert.equal(primary.key, "sprinter");
  assert.equal(secondary.key, "leadout");
});

test("edge: alle stats = baseline-mean → alle z=0, deterministisk", () => {
  const flat = Object.fromEntries(STAT_KEYS.map((s) => [s, 50]));
  const a = computeRiderTypes(flat, BASELINE);
  const b = computeRiderTypes(flat, BASELINE);
  assert.deepEqual(a, b);
  assert.equal(a.primary.key, "sprinter");
});

// Realistiske fixtures — eyeball-validering af intuitiv klassifikation.
test("fixture: ren sprinter klassificeres som Sprinter", () => {
  const sprinter = {
    stat_fl: 78, stat_bj: 35, stat_kb: 45, stat_bk: 55, stat_tt: 50, stat_prl: 52,
    stat_bro: 60, stat_sp: 88, stat_acc: 94, stat_ned: 65, stat_udh: 60, stat_mod: 70,
    stat_res: 62, stat_ftr: 58,
  };
  assert.equal(computeRiderTypes(sprinter, BASELINE).primary.key, "sprinter");
});

test("fixture: ren bjergrytter klassificeres som Climber", () => {
  const climber = {
    stat_fl: 50, stat_bj: 93, stat_kb: 85, stat_bk: 75, stat_tt: 55, stat_prl: 50,
    stat_bro: 40, stat_sp: 35, stat_acc: 55, stat_ned: 60, stat_udh: 80, stat_mod: 65,
    stat_res: 70, stat_ftr: 60,
  };
  assert.equal(computeRiderTypes(climber, BASELINE).primary.key, "climber");
});

test("fixture: tempo-specialist klassificeres som Time-trialist", () => {
  const tt = {
    stat_fl: 70, stat_bj: 45, stat_kb: 55, stat_bk: 55, stat_tt: 95, stat_prl: 90,
    stat_bro: 55, stat_sp: 50, stat_acc: 55, stat_ned: 60, stat_udh: 72, stat_mod: 68,
    stat_res: 65, stat_ftr: 58,
  };
  assert.equal(computeRiderTypes(tt, BASELINE).primary.key, "tt");
});
