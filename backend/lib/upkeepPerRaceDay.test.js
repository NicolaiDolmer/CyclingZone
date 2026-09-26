// #4385 · upkeep pr. seniorløbsdag (rejse og personale).
import test from "node:test";
import assert from "node:assert/strict";

import {
  TRAVEL_STAFF_FINANCE_TYPE,
  chargeRaceDayTravelStaffToDate,
  clearSettledTravelStaffRaces,
  computeTravelStaffCharges,
  raceIdFromTravelStaffKey,
  startersByStage,
  travelStaffIdempotencyKey,
  upkeepPerRaceDayRate,
} from "./upkeepPerRaceDay.ts";
import {
  UPKEEP_PER_RACE_DAY_FLAG_KEY,
  evaluateUpkeepPerRaceDay,
  isUpkeepPerRaceDayEnabled,
} from "./upkeepPerRaceDayFlag.ts";
import {
  FINANCE_REASON,
  UPKEEP_BY_DIVISION,
  UPKEEP_PER_RACE_DAY_BY_DIVISION,
  UPKEEP_REFERENCE_RACE_DAYS_BY_DIVISION,
} from "./economyConstants.js";

const teamsById = new Map([
  ["h1", { id: "h1", division: 1 }],
  ["h2", { id: "h2", division: 2 }],
  ["h3", { id: "h3", division: 3 }],
  ["h4", { id: "h4", division: 4 }],
]);

test("flag-nøgle og evaluering: kun 'on'/true tænder, beta og fravær er off", async () => {
  assert.equal(UPKEEP_PER_RACE_DAY_FLAG_KEY, "upkeep_per_race_day");
  assert.equal(evaluateUpkeepPerRaceDay("on"), true);
  assert.equal(evaluateUpkeepPerRaceDay(true), true);
  assert.equal(evaluateUpkeepPerRaceDay("beta"), false);
  assert.equal(evaluateUpkeepPerRaceDay("off"), false);
  assert.equal(evaluateUpkeepPerRaceDay(null), false);
  // fejlet læsning → off
  assert.equal(await isUpkeepPerRaceDayEnabled({ from() { throw new Error("boom"); } }), false);
  assert.equal(await isUpkeepPerRaceDayEnabled(makeFlagClient("on")), true);
  assert.equal(await isUpkeepPerRaceDayEnabled(makeFlagClient("beta")), false);
});

test("sats pr. løbsdag følger konstanten, D4 og ukendt division = 0", () => {
  for (const d of [1, 2, 3]) assert.equal(upkeepPerRaceDayRate(d), UPKEEP_PER_RACE_DAY_BY_DIVISION[d]);
  assert.equal(upkeepPerRaceDayRate(4), 0);
  assert.equal(upkeepPerRaceDayRate(9), 0);
  assert.equal(upkeepPerRaceDayRate(null), 0);
  assert.equal(upkeepPerRaceDayRate("2"), UPKEEP_PER_RACE_DAY_BY_DIVISION[2]);
});

test("sats × reference-løbsdage ≈ den gamle sæsonsum (samme sum spredt ud, ejer-valg 1)", () => {
  for (const d of [1, 2, 3]) {
    const spread = UPKEEP_PER_RACE_DAY_BY_DIVISION[d] * UPKEEP_REFERENCE_RACE_DAYS_BY_DIVISION[d];
    // afrunding af satsen giver højst ½ CZ$ pr. løbsdag i afvigelse
    assert.ok(Math.abs(spread - UPKEEP_BY_DIVISION[d]) <= UPKEEP_REFERENCE_RACE_DAYS_BY_DIVISION[d] / 2,
      `D${d}: ${spread} vs ${UPKEEP_BY_DIVISION[d]}`);
  }
});

test("idempotency-nøglen er pr. løb + etape + hold og kan læses tilbage", () => {
  const key = travelStaffIdempotencyKey("r1", 3, "h1");
  assert.equal(key, "travel_staff:r1:3:h1");
  assert.equal(raceIdFromTravelStaffKey(key), "r1");
  assert.equal(raceIdFromTravelStaffKey("sponsor_race_day:r1:h1"), null);
});

test("endagsløb: 'gc'-rækker med stage_number 1 tæller som start", () => {
  const race = { id: "r1", stages: 1, squad: "senior" };
  const starters = startersByStage(race, [
    { team_id: "h1", stage_number: 1, result_type: "gc" },
    { team_id: "h1", stage_number: 1, result_type: "gc" },
    { team_id: null, stage_number: 1, result_type: "gc" },
  ]);
  assert.deepEqual([...starters.keys()], [1]);
  assert.deepEqual([...starters.get(1)], ["h1"]);
});

test("etapeløb: kun 'stage'-rækker tæller, pr. etape", () => {
  const race = { id: "r2", stages: 3 };
  const starters = startersByStage(race, [
    { team_id: "h1", stage_number: 1, result_type: "stage" },
    { team_id: "h1", stage_number: 2, result_type: "stage" },
    // h1 udgik før etape 3 → ingen række
    { team_id: "h2", stage_number: 1, result_type: "stage" },
    { team_id: "h2", stage_number: 2, result_type: "stage" },
    { team_id: "h2", stage_number: 3, result_type: "stage" },
    // gc-rækker i etapeløb tæller ikke som start
    { team_id: "h3", stage_number: 3, result_type: "gc" },
    // etape udenfor løbets etapetal ignoreres
    { team_id: "h3", stage_number: 9, result_type: "stage" },
  ]);
  assert.deepEqual([...starters.get(1)].sort(), ["h1", "h2"]);
  assert.deepEqual([...starters.get(2)].sort(), ["h1", "h2"]);
  assert.deepEqual([...starters.get(3)], ["h2"]);
});

test("én linje pr. løbsdag pr. hold med rytter til start; ingen start = 0", () => {
  const race = { id: "r2", stages: 3, squad: "senior" };
  const results = [
    { team_id: "h1", stage_number: 1, result_type: "stage" },
    { team_id: "h1", stage_number: 2, result_type: "stage" },
    { team_id: "h2", stage_number: 1, result_type: "stage" },
    { team_id: "h2", stage_number: 2, result_type: "stage" },
    { team_id: "h2", stage_number: 3, result_type: "stage" },
  ];
  const charges = computeTravelStaffCharges({ race, results, teamsById });
  const byTeam = (id) => charges.filter((c) => c.teamId === id);
  assert.equal(byTeam("h1").length, 2, "h1 startede 2 af 3 etaper");
  assert.equal(byTeam("h2").length, 3);
  assert.equal(byTeam("h3").length, 0, "h3 havde ingen rytter til start → 0");
  assert.ok(byTeam("h1").every((c) => c.amount === UPKEEP_PER_RACE_DAY_BY_DIVISION[1]));
  assert.ok(byTeam("h2").every((c) => c.amount === UPKEEP_PER_RACE_DAY_BY_DIVISION[2]));
  assert.equal(new Set(charges.map((c) => c.idempotencyKey)).size, charges.length, "unikke nøgler");
});

test("kun seniorløb koster: U23-/juniorløb giver ingen træk", () => {
  const results = [{ team_id: "h1", stage_number: 1, result_type: "gc" }];
  for (const squad of ["u23", "junior"]) {
    assert.deepEqual(computeTravelStaffCharges({ race: { id: "y", stages: 1, squad }, results, teamsById }), []);
  }
  assert.equal(computeTravelStaffCharges({ race: { id: "s", stages: 1, squad: null }, results, teamsById }).length, 1);
});

test("AI/ukendte hold, D4 og hold der har betalt fladt upkeep springes over", () => {
  const race = { id: "r3", stages: 1 };
  const results = [
    { team_id: "ai-team", stage_number: 1, result_type: "gc" },
    { team_id: "h4", stage_number: 1, result_type: "gc" },
    { team_id: "h1", stage_number: 1, result_type: "gc" },
    { team_id: "h2", stage_number: 1, result_type: "gc" },
  ];
  const charges = computeTravelStaffCharges({ race, results, teamsById, excludedTeamIds: new Set(["h1"]) });
  assert.deepEqual(charges.map((c) => c.teamId), ["h2"]);
});

test("idempotens: allerede-bogførte nøgler trækkes ikke igen", () => {
  const race = { id: "r4", stages: 1 };
  const results = [{ team_id: "h1", stage_number: 1, result_type: "gc" }];
  const first = computeTravelStaffCharges({ race, results, teamsById });
  assert.equal(first.length, 1);
  const again = computeTravelStaffCharges({ race, results, teamsById, paidKeys: new Set([first[0].idempotencyKey]) });
  assert.deepEqual(again, []);
});

// ── I/O ────────────────────────────────────────────────────────────────────

test("chargeRaceDayTravelStaffToDate: flag off → intet læses, intet trækkes", async () => {
  clearSettledTravelStaffRaces();
  const db = makeFakeDb({ flag: "off" });
  const res = await chargeRaceDayTravelStaffToDate("season-4", db.client);
  assert.equal(res.skipped, "flag_off");
  assert.equal(db.rpcCalls.length, 0);
});

test("chargeRaceDayTravelStaffToDate: flag on → én debitering pr. løbsdag, genkørsel trækker ikke igen", async () => {
  clearSettledTravelStaffRaces();
  const db = makeFakeDb({ flag: "on" });
  const res = await chargeRaceDayTravelStaffToDate("season-4", db.client);
  // r-one (endagsløb): h1 + h2 → 2 · r-stage (2 etaper): h1 begge + h3 kun etape 1 → 3
  // u23-løbet hentes aldrig (senior-scope i queryen), AI-holdet står ikke i teams.
  assert.equal(res.charged, 5);
  const expectedTotal = 2 * UPKEEP_PER_RACE_DAY_BY_DIVISION[1] + UPKEEP_PER_RACE_DAY_BY_DIVISION[2] + UPKEEP_PER_RACE_DAY_BY_DIVISION[3];
  assert.equal(res.total, expectedTotal + UPKEEP_PER_RACE_DAY_BY_DIVISION[1]);
  for (const call of db.rpcCalls) {
    const p = call.p_finance_payload;
    assert.equal(p.type, TRAVEL_STAFF_FINANCE_TYPE);
    assert.equal(p.reason_code, FINANCE_REASON.RACE_DAY_TRAVEL_STAFF);
    assert.ok(p.amount < 0 && call.p_delta === p.amount, "debitering: negativt beløb og delta");
    assert.equal(p.metadata.code, "tx.travelStaff");
  }

  // Samme proces, næste tick: løbene er afregnet → ingen nye kald.
  const again = await chargeRaceDayTravelStaffToDate("season-4", db.client);
  assert.equal(again.charged, 0);
  assert.equal(db.rpcCalls.length, 5);

  // Ny proces (tom in-memory-cache): nøglerne i DB gør løbene afregnede.
  clearSettledTravelStaffRaces();
  const cold = await chargeRaceDayTravelStaffToDate("season-4", db.client);
  assert.equal(cold.charged, 0);
  assert.equal(db.rpcCalls.length, 5);
});

test("chargeRaceDayTravelStaffToDate: hold der har betalt fladt upkeep i sæsonen trækkes ikke (dobbelt-træk-vagt)", async () => {
  clearSettledTravelStaffRaces();
  const db = makeFakeDb({ flag: "on", flatUpkeepTeams: ["h1"] });
  const res = await chargeRaceDayTravelStaffToDate("season-4", db.client);
  assert.ok(db.rpcCalls.every((c) => c.p_team_id !== "h1"));
  assert.equal(res.charged, 2); // h2 i r-one + h3 etape 1 i r-stage
});

test("chargeRaceDayTravelStaffToDate: DB-dublet (23505) tælles ikke som nyt træk", async () => {
  clearSettledTravelStaffRaces();
  const db = makeFakeDb({ flag: "on", duplicateAll: true });
  const res = await chargeRaceDayTravelStaffToDate("season-4", db.client);
  assert.equal(res.charged, 0);
  assert.equal(res.total, 0);
});

// ── fakes ──────────────────────────────────────────────────────────────────

function makeFlagClient(value) {
  return {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle: async () => ({ data: { value }, error: null }),
      };
    },
  };
}

function makeFakeDb({ flag, flatUpkeepTeams = [], duplicateAll = false }) {
  const races = [
    { id: "r-one", name: "One Day", stages: 1, status: "completed", squad: "senior", season_id: "season-4" },
    { id: "r-stage", name: "Stage Race", stages: 2, status: "completed", squad: "senior", season_id: "season-4" },
    { id: "r-u23", name: "U23 Race", stages: 1, status: "completed", squad: "u23", season_id: "season-4" },
  ];
  const results = {
    "r-one": [
      { team_id: "h1", stage_number: 1, result_type: "gc" },
      { team_id: "h2", stage_number: 1, result_type: "gc" },
      { team_id: "ai", stage_number: 1, result_type: "gc" },
    ],
    "r-stage": [
      { team_id: "h1", stage_number: 1, result_type: "stage" },
      { team_id: "h1", stage_number: 2, result_type: "stage" },
      { team_id: "h3", stage_number: 1, result_type: "stage" },
    ],
    "r-u23": [{ team_id: "h1", stage_number: 1, result_type: "gc" }],
  };
  const teams = [
    { id: "h1", division: 1 },
    { id: "h2", division: 2 },
    { id: "h3", division: 3 },
  ];
  const finance = flatUpkeepTeams.map((t) => ({ team_id: t, type: "upkeep", season_id: "season-4", idempotency_key: `upkeep:${t}:season-4` }));
  const rpcCalls = [];

  function query(table) {
    const filters = [];
    let orFilter = null;
    const q = {
      select() { return q; },
      eq(col, val) { filters.push((r) => r[col] === val); return q; },
      in(col, vals) { filters.push((r) => vals.includes(r[col])); return q; },
      or(expr) { orFilter = expr; return q; },
      order() { return q; },
      maybeSingle: async () => {
        if (table === "app_config") return { data: flag == null ? null : { value: flag }, error: null };
        return { data: null, error: null };
      },
      range: async () => ({ data: rows(), error: null }),
      then(resolve, reject) { return Promise.resolve({ data: rows(), error: null }).then(resolve, reject); },
    };
    function rows() {
      let src = [];
      if (table === "races") src = races;
      else if (table === "teams") src = teams.map((t) => ({ ...t, is_ai: false, is_bank: false, is_frozen: false }));
      else if (table === "finance_transactions") src = finance;
      else if (table === "race_results") {
        src = Object.entries(results).flatMap(([raceId, rs]) => rs.map((r) => ({ ...r, race_id: raceId })));
      }
      let out = src.filter((r) => filters.every((f) => f(r)));
      if (orFilter && table === "races") out = out.filter((r) => r.squad == null || r.squad === "senior");
      return out;
    }
    return q;
  }

  const client = {
    from: (table) => query(table),
    async rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      if (duplicateAll) return { data: null, error: { code: "23505", message: "dup" } };
      if (finance.some((f) => f.idempotency_key === params.p_finance_payload.idempotency_key)) {
        return { data: null, error: { code: "23505", message: "dup" } };
      }
      rpcCalls.push(params);
      finance.push({ team_id: params.p_team_id, ...params.p_finance_payload });
      return { data: 0, error: null };
    },
  };
  return { client, rpcCalls };
}
