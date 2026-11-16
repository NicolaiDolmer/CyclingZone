// #7801 (Fable-dom 16/11 på PR #8212): ryttere UDEN stempel, og løbets session gemmes midt i et
// Træn nu-tryk.
//
// Et almindeligt tryk stempler ingen: løbsrytterne venter på deres løb. Delkørslen efter etapen
// (trainingSettleRaceSession7982.js) gemmer så løbsdagen for ryttere uden stempel. Det tillader kun
// migrationens #7982-regel, som dommerens stedfortræder ikke kender; #8195's stedfortræder
// (fakeWithRaceSessionRule) gør. Trykket skal gå igennem og give samme gemme-kald og sluttilstand
// som mains motor (hvert dag-felt læser alt).
//
// Facit er FROSSET af merge-basens kode (__fixtures__/trainNowNoStampSession7801Golden.json, #7587).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SCENARIOS } from "./trainNowSameResult7982.harness.js";
import { fakeWithRaceSessionRule } from "./trainingSettleRaceSession7982.facit.test.js";
import { NO_STAMP_CASES, runGoldenCase, fingerprint } from "./__fixtures__/trainNowMidPress7801.js";

const GOLDEN = JSON.parse(readFileSync(new URL("./__fixtures__/trainNowNoStampSession7801Golden.json", import.meta.url), "utf8"));
const numbers = (run) => ({ applied: run.applied, provisional: run.provisional, state: run.state });
const stamped = (state) => new Set(state.training_train_now_locks.filter((row) => row.instant_at != null).map((row) => row.rider_id));
const sessionRiders = (state) => [...new Set(state.training_rider_ticks.filter((row) => row.report?.race_session_7982 === true).map((row) => row.rider_id))];

test("golden-filen er frosset af merge-basen og dækker alle tilfælde", () => {
  assert.match(GOLDEN.mergeBase, /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(GOLDEN.cases).sort(), NO_STAMP_CASES.map((c) => c.name).sort());
  for (const c of NO_STAMP_CASES) assert.equal(GOLDEN.cases[c.name].status, 200, `${c.name}: mains motor går igennem (frosset)`);
});

test("forudsætning: uden migrationens løbssessions-regel afvises sessionen for ryttere uden stempel (ellers beviser prøven intet)", async () => {
  const run = await runGoldenCase(NO_STAMP_CASES[0], SCENARIOS, { main: false });
  assert.match(String(run.status), /Earlier rider date ticks must commit first/);
});

for (const c of NO_STAMP_CASES) {
  test(`ryttere uden stempel, ${c.name}: trykket går igennem med mains tal`, async () => {
    const expected = GOLDEN.cases[c.name];
    const run = await runGoldenCase(c, SCENARIOS, { main: false, makeFake: fakeWithRaceSessionRule });
    assert.equal(run.status, 200, `trykket svarer ${run.status}`);
    const riders = sessionRiders(run.state);
    const stamps = stamped(run.state);
    assert.ok(riders.length > 0, "delkørslen skrev løbets session");
    assert.ok(riders.every((id) => !stamps.has(id)), "løbets ryttere har intet stempel");
    const branch = fingerprint(run);
    assert.deepEqual(numbers(branch), numbers(expected), "gemme-kald og sluttilstand er som mains frosne motor");
    // Også mod mains motor i den nye kode (den vej er uændret af rettelsen).
    assert.deepEqual(numbers(fingerprint(await runGoldenCase(c, SCENARIOS, { makeFake: fakeWithRaceSessionRule }))), numbers(expected));
    // Uden stempel stilles fund A's spørgsmål ikke, og ingen afvisning opstår: fatigue_now_7801 koster
    // ingen ekstra læsning af belastningen (samme tryk med kun løbssessions-kontakten tændt).
    assert.equal(run.attempts.filter((attempt) => attempt.error).length, 0, "intet gemme-kald afvises");
    const sessionOnly = await runGoldenCase(c, SCENARIOS, { flags: { training_settle_race_session: "on" }, main: false, makeFake: fakeWithRaceSessionRule });
    assert.equal(branch.raceLoadReads, sessionOnly.raceLoadReads, "kontakten giver ingen ekstra læsning uden stempel");
    assert.ok(branch.raceLoadReads < expected.raceLoadReads, `belastningen læses ${branch.raceLoadReads} gange (main: ${expected.raceLoadReads})`);
  });
}
