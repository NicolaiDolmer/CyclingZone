// #5601 — endagsløbets vinder står under 'gc' (stage_number 1), etapeløbets
// etapevinder under 'stage'. Rækkeformerne her er de samme som motoren skriver
// (backend/lib/raceRunner.js): endagsløb = kun 'gc' + hold på stage_number 1;
// etapeløb = 'stage' hver etape + 'gc' på sidste etape.
//
// Nederst: kilde-assertions på de to kaldesteder (dashboardets hook og Race
// Centre), fordi de trækker React+Supabase ind og ikke kan importeres i en
// almindelig node --test (samme mønster som useTodayStages.test.js).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ONE_DAY_RESULT_STAGE,
  isRaceStageResultRow,
  isStageRaceType,
  planRaceResultQueries,
  raceResultSlot,
  raceStageResultRows,
} from "./raceWinnerResultType.ts";

const ONE_DAY = { raceId: "classic", raceType: "single", stageNumber: 1 };
const STAGE_RACE_FINAL = { raceId: "tour", raceType: "stage_race", stageNumber: 5 };

test("isStageRaceType — kun 'stage_race' er et etapeløb (samme regel som raceRunner.js)", () => {
  assert.equal(isStageRaceType("stage_race"), true);
  assert.equal(isStageRaceType("single"), false);
  assert.equal(isStageRaceType(null), false);
  assert.equal(isStageRaceType(undefined), false);
});

test("raceResultSlot — etapeløb → 'stage' på etapens eget nummer", () => {
  assert.deepEqual(raceResultSlot("stage_race", 3), { resultType: "stage", stageNumber: 3 });
});

test("raceResultSlot — endagsløb → 'gc' på stage_number 1, uanset slottets nummer", () => {
  assert.deepEqual(raceResultSlot("single", 1), { resultType: "gc", stageNumber: ONE_DAY_RESULT_STAGE });
  assert.deepEqual(raceResultSlot("single", 4), { resultType: "gc", stageNumber: 1 });
  // Ukendt/manglende race_type behandles som backenden gør: ikke et etapeløb.
  assert.deepEqual(raceResultSlot(null, 1), { resultType: "gc", stageNumber: 1 });
});

test("isRaceStageResultRow — endagsløbets 'gc'-række er vinderen", () => {
  const row = { race_id: "classic", stage_number: 1, result_type: "gc", rank: 1 };
  assert.equal(isRaceStageResultRow(row, ONE_DAY), true);
});

test("isRaceStageResultRow — et etapeløb bruger stadig 'stage'", () => {
  const stageRow = { race_id: "tour", stage_number: 5, result_type: "stage", rank: 1 };
  assert.equal(isRaceStageResultRow(stageRow, STAGE_RACE_FINAL), true);
  const otherStage = { race_id: "tour", stage_number: 4, result_type: "stage", rank: 1 };
  assert.equal(isRaceStageResultRow(otherStage, STAGE_RACE_FINAL), false);
});

test("isRaceStageResultRow — 'gc'-rækken på et etapeløbs sidste etape er IKKE etapevinderen", () => {
  const gcRow = { race_id: "tour", stage_number: 5, result_type: "gc", rank: 1 };
  assert.equal(isRaceStageResultRow(gcRow, STAGE_RACE_FINAL), false);
});

test("isRaceStageResultRow — forkert løb, tom række og hold-rækker matcher ikke", () => {
  assert.equal(isRaceStageResultRow({ race_id: "other", stage_number: 1, result_type: "gc" }, ONE_DAY), false);
  assert.equal(isRaceStageResultRow({ race_id: "classic", stage_number: 1, result_type: "team" }, ONE_DAY), false);
  assert.equal(isRaceStageResultRow(null, ONE_DAY), false);
  assert.equal(isRaceStageResultRow(undefined, ONE_DAY), false);
});

test("raceStageResultRows — etapeløbets sidste etape: kun 'stage'-podiet, aldrig det samlede 'gc'-podie", () => {
  const rows = [
    { race_id: "tour", stage_number: 5, result_type: "stage", rank: 1, rider_name: "Stage winner" },
    { race_id: "tour", stage_number: 5, result_type: "stage", rank: 2, rider_name: "Stage second" },
    { race_id: "tour", stage_number: 5, result_type: "gc", rank: 1, rider_name: "Overall winner" },
    { race_id: "tour", stage_number: 5, result_type: "gc", rank: 2, rider_name: "Overall second" },
    { race_id: "classic", stage_number: 1, result_type: "gc", rank: 1, rider_name: "Classic winner" },
  ];
  assert.deepEqual(
    raceStageResultRows(rows, STAGE_RACE_FINAL).map((r) => r.rider_name),
    ["Stage winner", "Stage second"],
  );
  assert.deepEqual(raceStageResultRows(rows, ONE_DAY).map((r) => r.rider_name), ["Classic winner"]);
  assert.deepEqual(raceStageResultRows(null, ONE_DAY), []);
});

test("planRaceResultQueries — én 'stage'-gruppe for etapeløb, én 'gc'-gruppe for endagsløb", () => {
  const groups = planRaceResultQueries([
    { raceId: "tour", raceType: "stage_race", stageNumber: 5 },
    { raceId: "giro", raceType: "stage_race", stageNumber: 2 },
    { raceId: "giro", raceType: "stage_race", stageNumber: 3 },
    { raceId: "classic", raceType: "single", stageNumber: 1 },
    { raceId: "monument", raceType: "single", stageNumber: 1 },
  ]);
  assert.deepEqual(groups, [
    { resultType: "stage", raceIds: ["tour", "giro"], stageNumbers: [2, 3, 5] },
    { resultType: "gc", raceIds: ["classic", "monument"], stageNumbers: [1] },
  ]);
});

test("planRaceResultQueries — et etapeløb kommer aldrig i 'gc'-gruppen (DB'en returnerer ikke den forvekslelige række)", () => {
  const groups = planRaceResultQueries([STAGE_RACE_FINAL]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].resultType, "stage");
  assert.ok(!groups.some((g) => g.resultType === "gc"));
});

test("planRaceResultQueries — kun endagsløb → kun en 'gc'-gruppe; ingen etaper → ingen forespørgsler", () => {
  assert.deepEqual(planRaceResultQueries([ONE_DAY]), [
    { resultType: "gc", raceIds: ["classic"], stageNumbers: [1] },
  ]);
  assert.deepEqual(planRaceResultQueries([]), []);
});

// ── Kaldesteder: begge flader bruger hjælperen og ingen hard-coder 'stage' ──

const __dirname = dirname(fileURLToPath(import.meta.url));
const hookSource = readFileSync(join(__dirname, "../hooks/useTodayStages.js"), "utf8");
const raceCentreSource = readFileSync(join(__dirname, "../pages/RaceCentrePage.jsx"), "utf8");

for (const [name, source] of [["useTodayStages.js", hookSource], ["RaceCentrePage.jsx", raceCentreSource]] as const) {
  test(`#5601 ${name}: vælger result_type via planRaceResultQueries, ikke et hard-coded 'stage'-filter`, () => {
    assert.match(source, /planRaceResultQueries\(/, `${name} skal planlægge sine race_results-forespørgsler med planRaceResultQueries`);
    assert.match(source, /\.eq\("result_type", group\.resultType\)/, `${name} skal filtrere på gruppens result_type`);
    assert.doesNotMatch(
      source,
      /\.eq\("result_type", "stage"\)/,
      `${name} må ikke filtrere vinder/podie hårdt på 'stage' — endagsløb har kun 'gc'-rækker og viser så "No results" (#5601)`,
    );
  });
}

test("#5601 RaceCentrePage.jsx: hvert kort får kun sine egne rækker (raceStageResultRows)", () => {
  assert.match(raceCentreSource, /raceStageResultRows\(resultRows, card\)/);
  assert.match(raceCentreSource, /raceType: race\.race_type/);
});
