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
// Ejeren 5/11: "no job left" lyder som en manglende ordre fra spilleren.
const JOB = /\bjobs?\b|opgave|\btasks?\b|mission|tâche|tarea|\btaak\b|\btaken\b/i;
const ORDER_OR_CAPTAIN = /order|ordre|orden|bevel|captain|kaptajn|capitaine|capitán|kopman|leader|jefe de filas/i;

function withdrawalTexts(code: string): string[] {
  const races = load(code, "races");
  const recap = races.detail.recap;
  return [
    selectArm(recap.abandon, "withdrawal"),
    selectArm(recap.withdrawalGroup, "stage"),
    selectArm(recap.withdrawalGroup, "other"),
    races.detail.incidents.withdrawal,
    selectArm(races.detail.report.yourTeam.out, "withdrawal"),
    selectArm(races.stagePageV2.story.report.ownOut, "withdrawal"),
    selectArm(load(code, "dashboard").cards.heroAgony.moments.incident_abandon, "withdrawal"),
  ];
}

// Hjaelpens afsnit om at stige af: alt efter sidste saetning om tidsgraensen.
const HELP_START: Record<string, string> = {
  en: "After the finish,", da: "Efter målstregen kan", fr: "Après l'arrivée, un coureur",
  es: "Después de la meta, un ciclista", nl: "Na de finish kan een renner",
};

test("#7701 referatets ordlyd er ejerens, ordret paa en og da", () => {
  const [enAbandon, enGroup] = [load("en", "races").detail.recap.abandon, load("en", "races").detail.recap.withdrawalGroup];
  const [daAbandon, daGroup] = [load("da", "races").detail.recap.abandon, load("da", "races").detail.recap.withdrawalGroup];
  assert.equal(load("en", "races").detail.incidents.withdrawal, "Climbed off, too far behind");
  assert.equal(load("da", "races").detail.incidents.withdrawal, "Steg af, for langt efter");
  assert.equal(selectArm(selectArm(enAbandon, "withdrawal"), "stage"), "{rider} climbed off after the stage, too far behind the winner.");
  assert.equal(selectArm(selectArm(daAbandon, "withdrawal"), "stage"), "{rider} steg af efter etapen, for langt efter vinderen.");
  assert.equal(selectArm(enGroup, "stage"), "{count} riders climbed off after the stage, too far behind the winner.");
  assert.equal(selectArm(daGroup, "stage"), "{count} ryttere steg af efter etapen, for langt efter vinderen.");
});

for (const { code } of LANGUAGES) {
  test(`#7701 ${code}: ingen tekst om den der steg af antyder traethed, et uheld eller en opgave`, () => {
    for (const text of withdrawalTexts(code)) {
      assert.doesNotMatch(text, TIRED, text);
      assert.doesNotMatch(text, INCIDENT, text);
      assert.doesNotMatch(text, JOB, text);
    }
  });

  test(`#7701 ${code}: endagsloeb faar ingen "efter etapen" paa den enkelte rytter`, () => {
    const arm = selectArm(load(code, "races").detail.recap.abandon, "withdrawal");
    assert.notEqual(selectArm(arm, "stage"), selectArm(arm, "other"));
  });

  test(`#7713 ${code}: hjaelpen beskriver ikke laengere at ryttere stiger af efter maal`, () => {
    const text: string = load(code, "help").sections.raceDay.timeLimitAndGrupetto.text;
    assert.ok(!text.includes(HELP_START[code]), text);
    assert.ok(!text.includes(load(code, "races").detail.incidents.withdrawal), text);
  });

  test(`#7701 ${code}: dashboardet kender hver vej ud og paastaar intet uheld uden aarsag`, () => {
    const message = load(code, "dashboard").cards.heroAgony.moments.incident_abandon;
    for (const arm of ["withdrawal", "time_limit", "illness"]) assert.doesNotMatch(selectArm(message, arm), INCIDENT, arm);
    assert.doesNotMatch(selectArm(message, "other"), INCIDENT, "en ukendt art er neutral");
  });
}
