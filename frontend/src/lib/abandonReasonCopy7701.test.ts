// #7701: en rytter der steg af, er ude paa hullet til vinderen. Teksterne maa
// aldrig kalde ham udmattet eller tale om et uheld, paa noget sprog.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LANGUAGES } from "../i18n/languages.js";

const load = (lng: string, ns: string) => JSON.parse(readFileSync(new URL(`../../public/locales/${lng}/${ns}.json`, import.meta.url), "utf8"));

// Arm for arm i en ICU-select: teksten mellem "<arm> {" og den matchende "}".
function selectArm(message: string, arm: string): string {
  const start = message.indexOf(` ${arm} {`) + arm.length + 3;
  assert.ok(start > arm.length + 2, `mangler armen ${arm}: ${message}`);
  let depth = 1;
  for (let i = start; i < message.length; i += 1) {
    if (message[i] === "{") depth += 1;
    if (message[i] === "}") depth -= 1;
    if (depth === 0) return message.slice(start, i);
  }
  throw new Error(`ubalanceret arm ${arm}`);
}

const TIRED = /exhaust|tired|worn|udkørt|udmattet|træt|épuis|fatigu|agotad|cansad|uitgeput|moe\b/i;
const INCIDENT = /incident|uheld|crash|styrt|chute|caída|valpartij/i;

for (const { code } of LANGUAGES) {
  test(`#7701 ${code}: ingen tekst om den der steg af antyder traethed eller et uheld`, () => {
    const races = load(code, "races");
    const recap = races.detail.recap;
    const texts = [
      selectArm(recap.abandon, "withdrawal"),
      selectArm(recap.withdrawalGroup, "stage"),
      selectArm(recap.withdrawalGroup, "other"),
      races.detail.incidents.withdrawal,
      selectArm(races.detail.report.yourTeam.out, "withdrawal"),
      selectArm(races.stagePageV2.story.report.ownOut, "withdrawal"),
      selectArm(load(code, "dashboard").cards.heroAgony.moments.incident_abandon, "withdrawal"),
    ];
    for (const text of texts) {
      assert.doesNotMatch(text, TIRED, text);
      assert.doesNotMatch(text, INCIDENT, text);
    }
  });

  test(`#7701 ${code}: dashboardet kender hver vej ud og paastaar intet uheld uden aarsag`, () => {
    const message = load(code, "dashboard").cards.heroAgony.moments.incident_abandon;
    for (const arm of ["withdrawal", "time_limit", "illness"]) assert.doesNotMatch(selectArm(message, arm), INCIDENT, arm);
    assert.doesNotMatch(selectArm(message, "other"), INCIDENT, "en ukendt art er neutral");
  });
}
