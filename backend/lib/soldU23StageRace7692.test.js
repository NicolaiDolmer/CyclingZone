// #7692: en solgt rytter, hvis holdskifte er parkeret (pending_team_id) fordi han er
// midt i et etapeløb, kører løbet færdigt for sit gamle hold. Prod-mønsteret: en
// akademirytter sælges/byttes midt i et U23-etapeløb, graduationen (squad -> senior)
// skrives ved parkeringen, og fra næste etape faldt han ud af feltet. Syntetiske data,
// ingen prod-rækker. Kontakten #7733 er slukket i alle scenarier (prod-tilstanden).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

import { loadEntrantsForRace, simulateStageByIndex } from "./raceRunner.js";
import { filterEligibleEntriesKeepingParked } from "./stageRaceTransferDefer.js";
import {
  RACE_7733, STAGES_7733, TEAMS_7733, NOW_7733,
  worldAfterStart7733, makeSupabase7733,
} from "./__fixtures__/startedFieldLock7733Scenarios.js";

const BUYER = "team-buyer-7692";
// Rytteren på det stabile hold, der sælges midt i løbet.
const SOLD = "stable-1";

/** Verden efter etape 1, hvor SOLD er solgt og parkeret. `graduated`: salget skrev senior-trup. */
function worldWithSoldRider({ race, graduated = true, overrides = {} }) {
  const world = worldAfterStart7733({ race });
  world.riders = world.riders.map((r) => (r.id !== SOLD ? r : {
    ...r,
    pending_team_id: BUYER,
    ...(graduated ? { squad: "senior", is_academy: false } : {}),
    ...overrides,
  }));
  return world;
}

async function entrantIds(race, world) {
  const entrants = await loadEntrantsForRace({
    supabase: makeSupabase7733(world), race, stages: STAGES_7733,
    persist: false, allowAutofill: false, today: "2026-10-15",
  });
  return entrants.map((e) => e.rider_id);
}

async function stageRiderIds(race, world, stageIndex) {
  let rows = [];
  mock.timers.enable({ apis: ["Date"], now: NOW_7733 });
  try {
    await simulateStageByIndex({
      supabase: makeSupabase7733(world), race, stageIndex,
      recomputeRaceDays: async () => 12,
      processBoardWeekend: async () => ({}),
      applyFatigue: async () => ({ updated: 0 }),
      checkV3Enabled: async () => true,
      checkV4Enabled: async () => false,
      applyStageResult: async (_client, { resultRows }) => {
        rows = resultRows;
        return { lockWon: true, rowsImported: resultRows.length };
      },
    });
  } finally {
    mock.timers.reset();
  }
  return rows.filter((r) => r.result_type === "stage");
}

const U23_STAGE2 = RACE_7733;
const U23_STAGE3 = { ...RACE_7733, stages_completed: 2 };
const SENIOR_STAGE2 = { ...RACE_7733, id: "race-7692-senior", squad: "senior" };

test("#7692 U23: solgt, gradueret rytter med parkeret skifte bliver i feltet på etape 2", async () => {
  const ids = await entrantIds(U23_STAGE2, worldWithSoldRider({ race: U23_STAGE2 }));
  assert.ok(ids.includes(SOLD), "den solgte rytter skal stadig være i startfeltet");
});

test("#7692 U23: han kører etape 2 og 3 for sit gamle hold, ikke køberen", async () => {
  for (const [race, stageIndex] of [[U23_STAGE2, 1], [U23_STAGE3, 2]]) {
    const stage = await stageRiderIds(race, worldWithSoldRider({ race }), stageIndex);
    const row = stage.find((r) => r.rider_id === SOLD);
    assert.ok(row, `etape ${stageIndex + 1}: rytteren mangler i resultatet`);
    assert.equal(row.team_id, TEAMS_7733.stable, "resultatet krediteres sælgeren");
  }
});

test("#7692 senior: solgt rytter med parkeret skifte bliver i feltet", async () => {
  const ids = await entrantIds(SENIOR_STAGE2, worldWithSoldRider({ race: SENIOR_STAGE2, graduated: false }));
  assert.ok(ids.includes(SOLD));
  const stage = await stageRiderIds(SENIOR_STAGE2, worldWithSoldRider({ race: SENIOR_STAGE2, graduated: false }), 1);
  assert.equal(stage.find((r) => r.rider_id === SOLD)?.team_id, TEAMS_7733.stable);
});

test("#7692: undtagelsen gælder kun parkerede ryttere; de øvrige ghost-regler er uændrede", async () => {
  const ids = new Set(await entrantIds(U23_STAGE2, worldWithSoldRider({ race: U23_STAGE2 })));
  // Uden parkeret skifte er et trup-skifte stadig en udgang, mens #7733 er slukket.
  assert.equal(ids.has("mixed-0"), false, "trup-skifte uden parkering falder stadig ud");
  assert.equal(ids.has("mixed-2"), false, "rytter uden hold falder stadig ud");
  assert.equal(ids.has("mixed-3"), false, "pensioneret falder stadig ud");
  assert.equal(ids.has("mixed-4"), false, "skadet falder stadig ud");
});

test("#7692: parkeret rytter der ikke længere står på entry'ens hold, falder ud", async () => {
  const world = worldWithSoldRider({ race: U23_STAGE2, overrides: { team_id: BUYER } });
  assert.equal((await entrantIds(U23_STAGE2, world)).includes(SOLD), false);
});

test("#7692: et løb der ikke er startet, får den almindelige dom (intet nyt U23-løb for en gradueret)", () => {
  const ridersById = new Map([[SOLD, { id: SOLD, team_id: TEAMS_7733.stable, squad: "senior", is_academy: false, is_retired: false, pending_team_id: BUYER }]]);
  const entries = [{ rider_id: SOLD, team_id: TEAMS_7733.stable }];
  assert.deepEqual(filterEligibleEntriesKeepingParked({ entries, ridersById, squad: "u23", raceStarted: false }), []);
  assert.deepEqual(filterEligibleEntriesKeepingParked({ entries, ridersById, squad: "u23", raceStarted: true }), entries);
});

test("#7692: uden pending_team_id er helperen identisk med filterEligibleEntries", async () => {
  const { filterEligibleEntries } = await import("./riderEligibility.js");
  const world = worldAfterStart7733({ race: U23_STAGE2 });
  const ridersById = new Map(world.riders.map((r) => [r.id, r]));
  for (const squad of ["u23", "senior"]) {
    for (const raceStarted of [false, true]) {
      assert.deepEqual(
        filterEligibleEntriesKeepingParked({ entries: world.race_entries, ridersById, squad, raceStarted }),
        filterEligibleEntries({ entries: world.race_entries, ridersById, squad }),
      );
    }
  }
});
