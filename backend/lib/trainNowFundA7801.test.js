// #7801, Fable-gentjek 15/11 på PR #8148, fund A: en etape afgøres midt i et Træn nu-tryk.
//
// Med kontakten fatigue_now_7801 regner træthedsreglen i hvert dag-felt på trætheden lige nu
// (åbningen plus datoens afgjorte etaper). Før trin 4a læste hvert dag-felt løbsbelastningen igen;
// trin 4a tog den fra trykkets hukommelse og stillede kun spørgsmålet igen i det foreløbige
// dag-felt. De frie dag-felter før det regnede derfor på en forældet belastning. Rettelsen: med
// kontakten tændt stiller hvert hukommelses-dag-felt med straks-ryttere spørgsmålet igen; har bogen
// ændret sig, træder hukommelsen til side, og dag-feltet læser alt som på main.
//
// Facit er FROSSET af merge-basens kode (__fixtures__/trainNowMidPress7801Golden.json, #7587):
//  - "off_*": grenens tryk med kontakterne som i prod (slukket). Den nye kode skal give præcis samme
//    svar, antal kald og læsninger, gemme-kald og sluttilstand.
//  - "main_on_*": mains motor (hvert dag-felt læser alt) med kontakten tændt: mains genlæsning.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SCENARIOS } from "./trainNowSameResult7982.harness.js";
import { GOLDEN_CASES, runGoldenCase, fingerprint, caseLabel } from "./__fixtures__/trainNowMidPress7801.js";

const GOLDEN = JSON.parse(readFileSync(new URL("./__fixtures__/trainNowMidPress7801Golden.json", import.meta.url), "utf8"));
const ON = { fatigue_now_7801: "on" };
const caseNamed = (name) => GOLDEN_CASES.find((c) => c.name === name);
const numbers = (run) => ({ applied: run.applied, provisional: run.provisional, state: run.state });
const sameNumbers = (actual, expected) => assert.deepEqual(numbers(actual), numbers(expected));

test("golden-filen er frosset af merge-basen og dækker alle tilfælde", () => {
  assert.match(GOLDEN.mergeBase, /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(GOLDEN.cases).sort(), GOLDEN_CASES.map((c) => c.name).sort());
});

test("kontakten slukket: hvert tryk er bit-identisk med merge-basen (svar, kald, læsninger, gemme-kald, sluttilstand)", async () => {
  for (const c of GOLDEN_CASES.filter((item) => item.name.startsWith("off_"))) {
    assert.deepEqual(fingerprint(await runGoldenCase(c, SCENARIOS)), GOLDEN.cases[c.name], `${c.name} afviger fra merge-basen`);
  }
});

test("forudsætning: etapen midt i trykket ændrer mains tal, når kontakten er tændt (ellers beviser prøven intet)", () => {
  const none = GOLDEN.cases[`main_on_stort_beta_${caseLabel(null, null)}`];
  for (const stageAfter of [1, 2, 3]) {
    assert.notEqual(GOLDEN.cases[`main_on_stort_beta_${caseLabel(stageAfter, null)}`].applied, none.applied, `etape efter gemme-kald nr. ${stageAfter}`);
  }
});

for (const stageAfter of [null, 1, 2, 3, 4]) {
  test(`kontakten tændt, ${stageAfter ? `etapen afgøres efter gemme-kald nr. ${stageAfter}` : "ingen etape midt i trykket"}: alle gemme-kald og sluttilstanden er som mains genlæsning`, async () => {
    const name = `main_on_stort_beta_${caseLabel(stageAfter, null)}`;
    const expected = GOLDEN.cases[name];
    const branch = fingerprint(await runGoldenCase(caseNamed(name), SCENARIOS, { flags: ON, main: false }));
    assert.equal(branch.status, 200);
    sameNumbers(branch, expected);
    // Også mod mains motor i den nye kode (den vej er uændret af rettelsen).
    sameNumbers(fingerprint(await runGoldenCase(caseNamed(name), SCENARIOS)), expected);
    // Prisen: aldrig flere læsninger af løbsbelastningen end main (main læser i hvert dag-felt).
    assert.ok(branch.raceLoadReads <= expected.raceLoadReads, `belastningen læses ${branch.raceLoadReads} gange (main: ${expected.raceLoadReads})`);
  });
}

test("prisen med kontakten tændt: kun tryk med straks-ryttere læser belastningen igen", async () => {
  const off = GOLDEN.cases.off_stort_almindeligt;
  const plain = fingerprint(await runGoldenCase(caseNamed("off_stort_almindeligt"), SCENARIOS, { flags: ON }));
  assert.equal(plain.raceLoadReads, off.raceLoadReads, "et almindeligt tryk (ingen straks-ryttere) læser som før");
  const small = fingerprint(await runGoldenCase(caseNamed("off_lille_hold"), SCENARIOS, { flags: ON }));
  assert.equal(small.raceLoadReads, GOLDEN.cases.off_lille_hold.raceLoadReads, "lille hold uden løb læser som før");
});
