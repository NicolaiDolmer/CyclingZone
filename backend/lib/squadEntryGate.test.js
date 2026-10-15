// #6489 · Paritetstest: SQL-porten (squad_entry_allowed + triggeren) og app-reglen
// (riderEligibility.isEligibleRider + raceSquadOf) skal afvise og tillade PRÆCIS de
// samme tilfælde. Migrationen køres to gange mod en PGlite-database (idempotens).

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { isEligibleRider, raceSquadOf } from "./riderEligibility.js";
import {
  confirmViolations, findSquadEntryViolations, isEntryAllowed, isOpenRace,
  runSquadEntryGateWatch, violationKind,
} from "./squadEntryGate.js";

const TEAM_A = "00000000-0000-0000-0000-00000000000a";
const TEAM_B = "00000000-0000-0000-0000-00000000000b";
const RIDER = "00000000-0000-0000-0000-000000000001";
const OTHER_RIDER = "00000000-0000-0000-0000-000000000002";
const RACE = {
  senior: "00000000-0000-0000-0000-000000000101",
  u23: "00000000-0000-0000-0000-000000000102",
  junior: "00000000-0000-0000-0000-000000000103",
  seniorStarted: "00000000-0000-0000-0000-000000000104",
  u23Completed: "00000000-0000-0000-0000-000000000105",
  seniorB: "00000000-0000-0000-0000-000000000106",
};

let db;
let migration;

before(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE riders(
      id uuid PRIMARY KEY, team_id uuid, squad text NOT NULL DEFAULT 'senior'
        CHECK (squad IN ('senior','u23','junior')),
      is_academy boolean NOT NULL DEFAULT false, is_retired boolean DEFAULT false,
      salary integer);
    CREATE TABLE races(id uuid PRIMARY KEY, squad text, status text NOT NULL,
      stages_completed integer NOT NULL DEFAULT 0);
    CREATE TABLE race_entries(race_id uuid REFERENCES races(id), rider_id uuid REFERENCES riders(id),
      team_id uuid, PRIMARY KEY(race_id, rider_id));
    GRANT SELECT, INSERT, UPDATE, DELETE ON riders, races, race_entries TO service_role, authenticated;`);
  // Den gamle forward-guard (#1906) findes i prod; migrationen skal erstatte den.
  await db.exec(await readFile(new URL("../../database/2026-06-26-ghost-race-entries-trigger.sql", import.meta.url), "utf8"));
  migration = await readFile(new URL("../../database/2026-10-15-6489-squad-entry-gate.sql", import.meta.url), "utf8");
  await db.exec(migration);
  await db.exec(migration);
});

after(async () => db?.close());

beforeEach(async () => {
  await db.exec("TRUNCATE race_entries, races, riders CASCADE");
  await db.query(
    `INSERT INTO races(id, squad, status, stages_completed) VALUES
      ($1,'senior','scheduled',0), ($2,'u23','scheduled',0), ($3,'junior','scheduled',0),
      ($4,'senior','scheduled',2), ($5,'u23','completed',3), ($6,'senior','scheduled',0)`,
    [RACE.senior, RACE.u23, RACE.junior, RACE.seniorStarted, RACE.u23Completed, RACE.seniorB],
  );
});

// ── 1) Regel-paritet: alle kombinationer mod SQL-funktionen ───────────────────

const SQUAD_VALUES = ["senior", "u23", "junior", null];
const BOOL_VALUES = [true, false, null];
const TEAM_VALUES = [TEAM_A, TEAM_B, null];
const RACE_SQUAD_VALUES = ["senior", "u23", "junior", null, "ukendt"];

test("paritet: squad_entry_allowed svarer som isEligibleRider + raceSquadOf i alle kombinationer", async () => {
  let cases = 0;
  const mismatches = [];
  for (const squad of SQUAD_VALUES) for (const isAcademy of BOOL_VALUES)
  for (const isRetired of BOOL_VALUES) for (const riderTeam of TEAM_VALUES)
  for (const entryTeam of TEAM_VALUES) for (const raceSquad of RACE_SQUAD_VALUES) {
    const rider = { team_id: riderTeam, squad, is_academy: isAcademy, is_retired: isRetired };
    const race = { squad: raceSquad };
    const js = isEligibleRider(rider, { teamId: entryTeam, squad: raceSquadOf(race) });
    assert.equal(isEntryAllowed({ rider, race, entryTeamId: entryTeam }), js);
    const { rows } = await db.query(
      "SELECT squad_entry_allowed($1,$2,$3,$4,$5,$6) AS ok",
      [riderTeam, squad, isAcademy, isRetired, entryTeam, raceSquad],
    );
    cases += 1;
    if (rows[0].ok !== js) mismatches.push({ rider, raceSquad, entryTeam, sql: rows[0].ok, js });
  }
  assert.equal(cases, 4 * 3 * 3 * 3 * 3 * 5);
  assert.deepEqual(mismatches, []);
});

// ── 2) Triggeren: trup-skift fra start-tilstand til slut-tilstand ─────────────

async function insertRider(id, state) {
  await db.query(
    "INSERT INTO riders(id, team_id, squad, is_academy, is_retired) VALUES ($1,$2,$3,$4,$5)",
    [id, state.team_id, state.squad, state.is_academy, state.is_retired ?? false],
  );
}
async function enter(riderId, raceId, teamId = TEAM_A) {
  await db.query("INSERT INTO race_entries(race_id, rider_id, team_id) VALUES ($1,$2,$3)", [raceId, riderId, teamId]);
}
async function entriesOf(riderId) {
  const { rows } = await db.query("SELECT race_id FROM race_entries WHERE rider_id = $1 ORDER BY race_id", [riderId]);
  return rows.map((r) => r.race_id);
}
async function racesById() {
  const { rows } = await db.query("SELECT id, squad, status, stages_completed FROM races");
  return new Map(rows.map((r) => [r.id, r]));
}

// Start-tilstanden har entries i ALLE seks løb (også dem han ikke må køre, så
// vi ser at triggeren rydder dem der hører til hans nye tilstand). Slut: kun
// ikke-startede løb ryddes, og kun dem JS-reglen afviser.
async function assertTriggerParity({ from, to, entryTeam = TEAM_A, label }) {
  await insertRider(RIDER, from);
  for (const id of Object.values(RACE)) await enter(RIDER, id, entryTeam);
  await db.query(
    "UPDATE riders SET team_id=$2, squad=$3, is_academy=$4, is_retired=$5 WHERE id=$1",
    [RIDER, to.team_id, to.squad, to.is_academy, to.is_retired ?? false],
  );
  const races = await racesById();
  const expected = Object.values(RACE)
    .filter((id) => !isOpenRace(races.get(id))
      || isEntryAllowed({ rider: { ...to, is_retired: to.is_retired ?? false }, race: races.get(id), entryTeamId: entryTeam }))
    .sort();
  assert.deepEqual(await entriesOf(RIDER), expected, label);
  return expected;
}

const SENIOR = { team_id: TEAM_A, squad: "senior", is_academy: false };
const U23 = { team_id: TEAM_A, squad: "u23", is_academy: true };
const JUNIOR = { team_id: TEAM_A, squad: "junior", is_academy: true };

test("trigger: junior → U23 rydder juniorløbet, beholder U23-løbet", async () => {
  const kept = await assertTriggerParity({ from: JUNIOR, to: U23, label: "junior→u23" });
  assert.ok(kept.includes(RACE.u23));
  assert.ok(!kept.includes(RACE.junior));
});

test("trigger: U23 → senior (akademi-oprykning) rydder ungdomsløb, beholder seniorløb", async () => {
  const kept = await assertTriggerParity({ from: U23, to: SENIOR, label: "u23→senior" });
  assert.ok(kept.includes(RACE.senior));
  assert.ok(!kept.includes(RACE.u23) && !kept.includes(RACE.junior));
});

test("trigger: nedrykning senior → U23 rydder seniorløb", async () => {
  const kept = await assertTriggerParity({ from: SENIOR, to: U23, label: "senior→u23" });
  assert.ok(!kept.includes(RACE.senior) && !kept.includes(RACE.seniorB));
  assert.ok(kept.includes(RACE.u23));
});

test("trigger: nedrykning U23 → junior rydder U23-løbet", async () => {
  const kept = await assertTriggerParity({ from: U23, to: JUNIOR, label: "u23→junior" });
  assert.ok(kept.includes(RACE.junior) && !kept.includes(RACE.u23));
});

test("trigger: holdskift rydder alle ikke-startede løb hos det gamle hold", async () => {
  const kept = await assertTriggerParity({ from: SENIOR, to: { ...SENIOR, team_id: TEAM_B }, label: "holdskift" });
  assert.deepEqual(kept, [RACE.seniorStarted, RACE.u23Completed].sort());
});

test("trigger: pensionering rydder alle ikke-startede løb", async () => {
  const kept = await assertTriggerParity({ from: SENIOR, to: { ...SENIOR, is_retired: true }, label: "pension" });
  assert.deepEqual(kept, [RACE.seniorStarted, RACE.u23Completed].sort());
});

test("trigger: kun is_academy flippes (squad senior) → seniorløb ryddes som før (#1906)", async () => {
  const kept = await assertTriggerParity({ from: SENIOR, to: { ...SENIOR, is_academy: true }, label: "akademi-flag" });
  assert.deepEqual(kept, [RACE.seniorStarted, RACE.u23Completed].sort());
});

test("trigger: U23-rytter med is_academy=false der heales beholder sine U23-løb", async () => {
  // Den gamle krop slettede alt ved is_academy=true; den nye regel kender trupperne.
  const kept = await assertTriggerParity({
    from: { ...U23, is_academy: false }, to: U23, label: "heal is_academy",
  });
  assert.ok(kept.includes(RACE.u23));
});

test("trigger: igangværende og afsluttede løb røres aldrig", async () => {
  const kept = await assertTriggerParity({ from: JUNIOR, to: SENIOR, label: "junior→senior" });
  assert.ok(kept.includes(RACE.seniorStarted));
  assert.ok(kept.includes(RACE.u23Completed));
});

test("trigger: en urelateret kolonne fyrer ikke, og andre ryttere røres ikke", async () => {
  await insertRider(RIDER, U23);
  await insertRider(OTHER_RIDER, JUNIOR);
  await enter(RIDER, RACE.junior); // allerede forkert: kun et trup-skift rydder den
  await enter(OTHER_RIDER, RACE.junior);
  await db.query("UPDATE riders SET salary = 5 WHERE id = $1", [RIDER]);
  assert.deepEqual(await entriesOf(RIDER), [RACE.junior]);
  await db.query("UPDATE riders SET squad = 'senior', is_academy = false WHERE id = $1", [RIDER]);
  assert.deepEqual(await entriesOf(RIDER), []);
  assert.deepEqual(await entriesOf(OTHER_RIDER), [RACE.junior]);
});

test("trigger: virker når service_role opdaterer rytteren", async () => {
  await insertRider(RIDER, JUNIOR);
  await enter(RIDER, RACE.junior);
  await db.exec("SET ROLE service_role");
  try {
    await db.query("UPDATE riders SET squad = 'u23' WHERE id = $1", [RIDER]);
  } finally {
    await db.exec("RESET ROLE");
  }
  assert.deepEqual(await entriesOf(RIDER), []);
});

test("grants: anon kan ikke kalde reglen", async () => {
  const { rows } = await db.query(
    "SELECT has_function_privilege('anon','squad_entry_allowed(uuid,text,boolean,boolean,uuid,text)','EXECUTE') AS anon," +
    " has_function_privilege('service_role','squad_entry_allowed(uuid,text,boolean,boolean,uuid,text)','EXECUTE') AS svc",
  );
  assert.deepEqual(rows[0], { anon: false, svc: true });
});

test("migrationen erstatter den gamle trigger: kun én trigger på riders, og den kender squad", async () => {
  const { rows } = await db.query(
    "SELECT tgname, pg_get_triggerdef(t.oid) AS def FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid" +
    " WHERE c.relname = 'riders' AND NOT t.tgisinternal",
  );
  assert.equal(rows.length, 1);
  assert.match(rows[0].def, /squad/);
});

// ── 3) Vagten (ren kerne + runner) ────────────────────────────────────────────

test("violationKind: ghost vs. anden trup vs. tilladt", () => {
  const race = { squad: "u23", status: "scheduled", stages_completed: 0 };
  assert.equal(violationKind({ rider: { team_id: TEAM_A, squad: "u23", is_academy: true }, race, entryTeamId: TEAM_A }), null);
  assert.equal(violationKind({ rider: { team_id: TEAM_A, squad: "junior", is_academy: true }, race, entryTeamId: TEAM_A }), "off_squad");
  assert.equal(violationKind({ rider: { team_id: TEAM_B, squad: "u23", is_academy: true }, race, entryTeamId: TEAM_A }), "ghost");
  assert.equal(violationKind({ rider: { team_id: TEAM_A, squad: "u23", is_retired: true }, race, entryTeamId: TEAM_A }), "ghost");
  assert.equal(violationKind({ rider: undefined, race, entryTeamId: TEAM_A }), "ghost");
});

test("findSquadEntryViolations: tæller kun ikke-startede løb", () => {
  const races = [
    { id: "open-u23", squad: "u23", status: "scheduled", stages_completed: 0 },
    { id: "started", squad: "junior", status: "scheduled", stages_completed: 1 },
    { id: "done", squad: "junior", status: "completed", stages_completed: 3 },
  ];
  const riders = [{ id: "r1", team_id: "t1", squad: "junior", is_academy: true, is_retired: false }];
  const entries = ["open-u23", "started", "done"].map((race_id) => ({ race_id, team_id: "t1", rider_id: "r1" }));
  const out = findSquadEntryViolations({ races, entries, riders });
  assert.equal(out.checked, 1);
  assert.deepEqual(out.violations, [{
    race_id: "open-u23", team_id: "t1", rider_id: "r1", kind: "off_squad", race_squad: "u23", rider_squad: "junior",
  }]);
});

const SNAP = {
  season: { id: "s1", number: 5 },
  races: [{ id: "x", squad: "junior", status: "scheduled", stages_completed: 0 }],
  entries: [{ race_id: "x", team_id: "t1", rider_id: "r1" }],
  riders: [{ id: "r1", team_id: "t1", squad: "u23", is_academy: true, is_retired: false }],
};
const fakeSupabase = { from() { throw new Error("må ikke kaldes"); } };

test("runSquadEntryGateWatch: 0 brud → ingen alarm", async () => {
  const captured = [];
  const res = await runSquadEntryGateWatch({
    supabase: fakeSupabase,
    captureExceptionFn: (...a) => captured.push(a),
    fetchSnapshotFn: async () => ({ ...SNAP, riders: [{ ...SNAP.riders[0], squad: "junior" }] }),
    confirmFn: async () => assert.fail("genlæsning uden fund"),
  });
  assert.deepEqual(res, { ran: true, checked: 1, offSquad: 0, ghosts: 0, alerted: false });
  assert.equal(captured.length, 0);
});

test("runSquadEntryGateWatch: bekræftet brud → én Sentry-capture med fast fingerprint", async () => {
  const captured = [];
  const res = await runSquadEntryGateWatch({
    supabase: fakeSupabase,
    captureExceptionFn: (err, ctx) => captured.push({ err, ctx }),
    fetchSnapshotFn: async () => SNAP,
    confirmFn: async (_sb, v) => v,
  });
  assert.equal(res.alerted, true);
  assert.equal(res.offSquad, 1);
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].ctx.fingerprint, ["squad-entry-gate-violation"]);
  assert.equal(captured[0].ctx.tags.cron, "squad-entry-gate-watch");
});

test("runSquadEntryGateWatch: fund der forsvinder ved genlæsning alarmerer ikke", async () => {
  const captured = [];
  const res = await runSquadEntryGateWatch({
    supabase: fakeSupabase,
    captureExceptionFn: (...a) => captured.push(a),
    fetchSnapshotFn: async () => SNAP,
    confirmFn: async () => [],
  });
  assert.equal(res.alerted, false);
  assert.equal(captured.length, 0);
});

test("runSquadEntryGateWatch: ingen aktiv sæson → kører ikke", async () => {
  const res = await runSquadEntryGateWatch({
    supabase: fakeSupabase,
    fetchSnapshotFn: async () => ({ season: null, races: [], entries: [], riders: [] }),
  });
  assert.equal(res.ran, false);
});

test("confirmViolations: genberegner på frisk læsning", async () => {
  // Minimal supabase-stub: hver .from(table) returnerer tabellens rækker uanset filter.
  const tables = {
    riders: [{ id: "r1", team_id: "t1", squad: "junior", is_academy: true, is_retired: false }],
    races: [{ id: "x", squad: "junior", status: "scheduled", stages_completed: 0 }],
    race_entries: [{ race_id: "x", team_id: "t1", rider_id: "r1" }],
  };
  const stub = {
    from(table) {
      const q = {
        select: () => q, in: () => q, order: () => q,
        range: async () => ({ data: tables[table], error: null }),
      };
      return q;
    },
  };
  // Rytteren er nu junior → rækken i juniorløbet er lovlig igen.
  const out = await confirmViolations(stub, [{ race_id: "x", team_id: "t1", rider_id: "r1", kind: "off_squad" }]);
  assert.deepEqual(out, []);
});
