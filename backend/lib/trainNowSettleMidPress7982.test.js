// #7982 (Fable-dom 15/11 på PR #8148): løbets session gemmes midt i et Træn nu-tryk.
//
// Delkørslen efter etapen (trainingSettleRaceSession7982.js, bag training_settle_race_session, som
// kun tændes sammen med fatigue_now_7801) kan gemme løbets kvittering, efter trykket hentede.
// Trykkets hukommelse mangler så kvitteringen, og databasen afviser det næste dag-felts gemme-kald
// ("receipt snapshot changed"): intet gemmes, og trykket svarede med en fejl. Main læste
// kvitteringerne igen i hvert dag-felt og gik igennem. Rettelsen: med fatigue_now_7801 tændt træder
// hukommelsen til side ved netop den afvisning, og dag-feltet læser alt og gemmes som på main.
// Slukket: afvisningen står som før (den frosne golden fra merge-basen, #7587).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SCENARIOS } from "./trainNowSameResult7982.harness.js";
import { GOLDEN_CASES, MIDWAY, runGoldenCase, fingerprint, caseLabel } from "./__fixtures__/trainNowMidPress7801.js";

const GOLDEN = JSON.parse(readFileSync(new URL("./__fixtures__/trainNowMidPress7801Golden.json", import.meta.url), "utf8"));
const ON = { fatigue_now_7801: "on" };
const REFUSED = /receipt snapshot changed/;
const caseNamed = (name) => GOLDEN_CASES.find((c) => c.name === name);
const numbers = (run) => ({ applied: run.applied, provisional: run.provisional, state: run.state });
const sessions = MIDWAY.filter(([, sessionAfter]) => sessionAfter != null);

for (const [stageAfter, sessionAfter] of sessions) {
  test(`kontakten tændt, etape efter gemme-kald nr. ${stageAfter} og løbets session efter nr. ${sessionAfter}: trykket går igennem med mains tal`, async () => {
    const name = `main_on_stort_beta_${caseLabel(stageAfter, sessionAfter)}`;
    const expected = GOLDEN.cases[name];
    assert.equal(expected.status, 200, "mains motor går igennem (frosset)");
    const run = await runGoldenCase(caseNamed(name), SCENARIOS, { flags: ON, main: false });
    assert.equal(run.status, 200, `trykket svarer ${run.status}`);
    assert.ok(run.state.training_rider_ticks.some((row) => row.report?.race_session_7982 === true), "delkørslen skrev løbets session");
    assert.deepEqual(numbers(fingerprint(run)), numbers(expected), "gemme-kald og sluttilstand er som mains genlæsning");
  });
}

test("kontakten tændt: afvisningen opstår faktisk, og trykket læser igen i stedet for at fejle", async () => {
  // Etapen er afgjort før løbets session: bogen over belastningen er uændret, da kvitteringen kommer,
  // så kun databasens afvisning kan opdage den.
  for (const [stageAfter, sessionAfter] of [[1, 2], [1, 3], [1, 4], [3, 4]]) {
    const run = await runGoldenCase(caseNamed(`main_on_stort_beta_${caseLabel(stageAfter, sessionAfter)}`), SCENARIOS, { flags: ON, main: false });
    const refused = run.attempts.filter((attempt) => REFUSED.test(attempt.error ?? ""));
    assert.equal(refused.length, 1, `etape ${stageAfter}, session ${sessionAfter}: ét afvist gemme-kald`);
    assert.equal(run.status, 200, `etape ${stageAfter}, session ${sessionAfter}: trykket går igennem`);
  }
});

test("kontakten slukket: afvisningen står som før (frosset fra merge-basen), og intet forkert gemmes", async () => {
  for (const [stageAfter, sessionAfter] of [[1, 1], [2, 2], [1, 2]]) {
    const name = `off_stort_beta_${caseLabel(stageAfter, sessionAfter)}`;
    const expected = GOLDEN.cases[name];
    assert.match(String(expected.status), REFUSED, `${name}: merge-basen afviser`);
    assert.deepEqual(fingerprint(await runGoldenCase(caseNamed(name), SCENARIOS)), expected, `${name} afviger fra merge-basen`);
  }
});
