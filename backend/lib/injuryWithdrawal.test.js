// #4418: en rytter der bliver skadet MENS et etapeloeb koerer tages helt bevidst
// ud af feltet (skadefilteret #3896, ejer-beslutning 30/8). Udtagelsen efterlod
// hidtil intet spor: spilleren saa rytteren forsvinde uden forklaring, og
// #1844-frysningen gentog "forsvundet"-advarslen paa hver resterende etape.
// Guarden her asserter begge halvdele — at skaden skiller sig ud fra de OEVRIGE
// aarsager (solgt/akademi/pensioneret, som stadig skal larme), og at skriveren
// aldrig roerer simuleringens egne crash/mechanical-raekker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { partitionMissingByInjury } from "./riderEligibility.js";
import { persistInjuryWithdrawals } from "./raceIncidents.js";

const TODAY = "2026-08-30";

test("partitionMissingByInjury: skadet -> injured, alt andet -> unexplained", () => {
  const injuredUntilByRider = new Map([
    ["skadet-i-morgen", "2026-09-01"],
    ["skadet-i-dag", TODAY], // samme dag taeller stadig som skadet (isRiderInjured >=)
    ["rask-igen", "2026-08-29"], // udloebet i gaar
    ["aldrig-skadet", null],
  ]);
  const { injured, unexplained } = partitionMissingByInjury({
    missing: ["skadet-i-morgen", "rask-igen", "skadet-i-dag", "aldrig-skadet", "ukendt-rytter"],
    injuredUntilByRider,
    todayStr: TODAY,
  });
  assert.deepEqual(injured, ["skadet-i-morgen", "skadet-i-dag"]);
  // rask-igen/aldrig-skadet/ukendt er forsvundet af en ANDEN grund (fx akademi-
  // kontrakt midt i loebet) og skal blive ved med at larme.
  assert.deepEqual(unexplained, ["rask-igen", "aldrig-skadet", "ukendt-rytter"]);
});

test("partitionMissingByInjury: tom liste giver to tomme spande", () => {
  const r = partitionMissingByInjury({ missing: [], injuredUntilByRider: new Map(), todayStr: TODAY });
  assert.deepEqual(r, { injured: [], unexplained: [] });
});

// Minimal supabase-stub: registrerer delete-filtre og indsatte raekker.
function stubSupabase() {
  const calls = { deletes: [], inserted: null };
  return {
    calls,
    from() {
      const filters = {};
      const chain = {
        delete() { chain._op = "delete"; return chain; },
        eq(col, val) {
          filters[col] = val;
          if (chain._op === "delete") calls.deletes.push({ ...filters });
          return chain;
        },
        insert(rows) { calls.inserted = rows; return Promise.resolve({ error: null }); },
        then(res) { return Promise.resolve({ error: null }).then(res); },
      };
      return chain;
    },
  };
}

test("persistInjuryWithdrawals: skriver abandon-raekker med kind=injury og uden tid/skadedage", async () => {
  const supabase = stubSupabase();
  const n = await persistInjuryWithdrawals({
    supabase, raceId: "race-1", stageNumber: 4, riderIds: ["r1", "r2", "r1"],
  });
  assert.equal(n, 2, "dubletter skal foldes sammen");
  assert.deepEqual(supabase.calls.inserted, [
    { race_id: "race-1", stage_number: 4, rider_id: "r1", kind: "injury", outcome: "abandon", time_loss_seconds: null, injury_days: null },
    { race_id: "race-1", stage_number: 4, rider_id: "r2", kind: "injury", outcome: "abandon", time_loss_seconds: null, injury_days: null },
  ]);
});

test("persistInjuryWithdrawals: delete er scopet til kind=injury paa netop denne etape", async () => {
  const supabase = stubSupabase();
  await persistInjuryWithdrawals({ supabase, raceId: "race-1", stageNumber: 4, riderIds: ["r1"] });
  const last = supabase.calls.deletes.at(-1);
  // Uden kind-scopingen ville simuleringens egne crash/mechanical-raekker for
  // samme etape blive slettet af denne skriver.
  assert.deepEqual(last, { race_id: "race-1", stage_number: 4, kind: "injury" });
});

test("persistInjuryWithdrawals: tom liste rydder stadig op og indsaetter intet", async () => {
  const supabase = stubSupabase();
  const n = await persistInjuryWithdrawals({ supabase, raceId: "race-1", stageNumber: 4, riderIds: [] });
  assert.equal(n, 0);
  assert.equal(supabase.calls.inserted, null);
  // Oprydningen SKAL koere: en rytter der var skadet ved forrige koersel af samme
  // etape, men er rask nu, maa ikke staa tilbage som udgaaet.
  assert.equal(supabase.calls.deletes.length, 3);
});
