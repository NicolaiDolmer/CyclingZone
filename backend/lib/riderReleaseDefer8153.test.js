// #8153: frigivelse midt i et etapeloeb venter til loebets slut.
// Del 1: SQL (PGlite) for bestilling, udfoerelse og vagten paa riders.
// Del 2: JS-logikken i riderReleaseDefer8153.js mod en lille in-memory-klient.
// Fast ur i alle proever (AGENTS regel 16).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { prepareBetaDatabase2176 } from "./__fixtures__/marketBeta2176Db.js";
import { clearFlagStageCache } from "./featureStage.js";
import {
  RELEASE_DEFER_FLAG_KEY,
  releaseDeferContext8153,
  findActiveStageRaceForRider,
  getPendingReleaseTradeIssue,
  getPendingReleaseSelectionIssue,
  orderPendingRelease,
  loadPendingReleasesForTeam,
  countPendingReleasesForTransition,
  countActivePendingReleases,
} from "./riderReleaseDefer8153.js";
import { executePendingReleasesForRace, runPendingReleaseHealSweep } from "./deferredTransferHealSweep.js";
import { demote as demoteAcademyRider, handleMoveSquadRequest } from "./academyTransfer.js";

const MIGRATION = "2026-11-15-8153-pending-rider-releases.sql";
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const TEAM = id(4), OTHER = id(2), RIDER = id(101), RACE = id(5001), LATER_RACE = id(5002);
const NOW = "2026-11-15T10:00:00.000Z";
const LATER = "2026-11-18T18:00:00.000Z";
const FEE = 120000;
const feePayload = (fee = FEE) => ({
  type: "transfer_out", amount: -fee, description: "Released Test Rider (buyout fee)",
  metadata: { code: "tx.riderRelease", params: { riderName: "Test Rider" } },
  actor_type: "api", source_path: "api.riders.release", reason_code: "rider_release_buyout",
  related_entity_type: "transfer", related_entity_id: RIDER,
});

// ── Del 1: SQL ────────────────────────────────────────────────────────────────

const file = (name) => readFile(new URL(`../../database/${name}`, import.meta.url), "utf8");
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];

async function database(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await prepareBetaDatabase2176(db);
  const source = await file(MIGRATION);
  await db.exec(source);
  await db.exec(source); // idempotent
  return db;
}

const order = async (db, { fee = FEE, payload = feePayload(fee), team = TEAM, minRiders = 0 } = {}) =>
  (await one(db, `SELECT public.order_rider_release_8153($1,$2,$3,$4,$5,NULL,$6,$7,'{}') AS r`,
    [RIDER, team, RACE, fee, payload, NOW, minRiders])).r;
const execute = async (db, releaseId) =>
  (await one(db, "SELECT public.execute_pending_rider_release_8153($1,$2) AS r", [releaseId, LATER])).r;
const state = (db) => one(db, `SELECT (SELECT balance FROM teams WHERE id='${TEAM}')::int AS balance,
  (SELECT team_id FROM riders WHERE id='${RIDER}') AS owner,
  (SELECT salary FROM riders WHERE id='${RIDER}') AS salary,
  (SELECT count(*) FROM finance_transactions)::int AS transactions,
  (SELECT count(*) FROM pending_rider_releases WHERE status='pending')::int AS pending`);

test("SQL: migrationen seeder kontakten slukket og er idempotent", async (t) => {
  const db = await database(t);
  assert.equal((await one(db, "SELECT value FROM app_config WHERE key=$1", [RELEASE_DEFER_FLAG_KEY])).value, "off");
  assert.equal(Number((await one(db, "SELECT count(*) AS n FROM pending_rider_releases")).n), 0);
  assert.equal((await one(db, "SELECT relrowsecurity FROM pg_class WHERE oid='public.pending_rider_releases'::regclass")).relrowsecurity, true);
});

test("SQL: bestilling midt i loebet traekker gebyret een gang og lader rytteren blive paa holdet", async (t) => {
  const db = await database(t);
  const r = await order(db);
  assert.equal(r.status, "pending");
  assert.equal(r.race_id, RACE);
  assert.deepEqual(await state(db), { balance: 1000000 - FEE, owner: TEAM, salary: 1000, transactions: 1, pending: 1 });
  const tx = await one(db, "SELECT idempotency_key, reason_code, amount::int FROM finance_transactions");
  assert.equal(tx.idempotency_key, `rider_release_pending:${r.release_id}`);
  assert.equal(tx.reason_code, "rider_release_buyout");
  assert.equal(tx.amount, -FEE);
  // Det aabne salgsopslag paa rytteren er lukket ved bestillingen.
  assert.equal((await one(db, `SELECT status FROM transfer_listings WHERE rider_id='${RIDER}'`)).status, "withdrawn");
});

test("SQL: dobbelt bestilling afvises uden et nyt gebyr", async (t) => {
  const db = await database(t);
  await order(db);
  const again = await order(db);
  assert.equal(again.status, "already_pending");
  assert.equal(again.race_id, RACE);
  assert.equal((await state(db)).transactions, 1);
});

test("SQL: for lidt paa saldoen afvises, intet oprettes", async (t) => {
  const db = await database(t);
  await db.exec(`UPDATE teams SET balance=1000 WHERE id='${TEAM}'`);
  const r = await order(db);
  assert.equal(r.status, "cannot_afford_release");
  assert.equal(Number(r.balance), 1000);
  assert.deepEqual(await state(db), { balance: 1000, owner: TEAM, salary: 1000, transactions: 0, pending: 0 });
});

test("SQL: en solgt, parkeret rytter (pending_team_id) eller en rytter paa auktion kan ikke bestilles", async (t) => {
  const db = await database(t);
  await db.exec(`UPDATE riders SET pending_team_id='${OTHER}' WHERE id='${RIDER}'`);
  assert.equal((await order(db)).status, "rider_state_changed");
  await db.exec(`UPDATE riders SET pending_team_id=NULL WHERE id='${RIDER}';
    INSERT INTO auctions(rider_id, seller_team_id, calculated_end) VALUES('${RIDER}','${TEAM}','${LATER}')`);
  assert.equal((await order(db)).status, "rider_on_auction");
  assert.equal((await state(db)).transactions, 0);
});

test("SQL: et andet hold kan ikke bestille holdets rytter", async (t) => {
  const db = await database(t);
  assert.equal((await order(db, { team: OTHER })).status, "rider_state_changed");
});

test("SQL: gulvet taeller ventende frigivelser som afgaaende", async (t) => {
  const db = await database(t);
  // Hold med to ryttere og et (syntetisk) gulv paa een: den foerste bestilling er
  // ok, den anden ville tage holdet under gulvet, fordi den foerste taeller med.
  const second = id(102);
  await db.exec(`INSERT INTO riders(id, team_id) VALUES('${second}','${TEAM}')`);
  assert.equal((await order(db, { minRiders: 1 })).status, "pending");
  const r2 = (await one(db, `SELECT public.order_rider_release_8153($1,$2,$3,$4,$5,NULL,$6,1,'{}') AS r`,
    [second, TEAM, RACE, FEE, feePayload(), NOW])).r;
  assert.equal(r2.status, "squad_floor");
});

test("SQL: vagten afviser salg, parkering og frigivelse imens; andre opdateringer passerer", async (t) => {
  const db = await database(t);
  await order(db);
  await assert.rejects(db.exec(`UPDATE riders SET team_id='${OTHER}' WHERE id='${RIDER}'`), /rider_pending_release_8153/);
  await assert.rejects(db.exec(`UPDATE riders SET pending_team_id='${OTHER}' WHERE id='${RIDER}'`), /rider_pending_release_8153/);
  // Ejerskabs-RPC'en (dagens frigivelse under holdlaasen) afvises ogsaa.
  await assert.rejects(one(db, `SELECT public.auto_accept_release_rider('${RIDER}','${TEAM}',0,'{}') AS r`), /rider_pending_release_8153/);
  await db.exec(`UPDATE riders SET salary=2000 WHERE id='${RIDER}'`);
  assert.equal((await state(db)).owner, TEAM);
});

test("SQL: udfoerelsen frigiver rytteren een gang og er idempotent", async (t) => {
  const db = await database(t);
  const { release_id: releaseId } = await order(db);
  // Et opslag, der (via en sti uden backend-vagten) er kommet til imens, lukkes ogsaa.
  await db.exec(`INSERT INTO transfer_listings(rider_id, seller_team_id, asking_price) VALUES('${RIDER}','${TEAM}',5000)`);
  const done = await execute(db, releaseId);
  assert.equal(done.status, "executed");
  assert.deepEqual(await state(db), { balance: 1000000 - FEE, owner: null, salary: null, transactions: 1, pending: 0 });
  const row = await one(db, "SELECT status, executed_at FROM pending_rider_releases WHERE id=$1", [releaseId]);
  assert.equal(row.status, "executed");
  assert.equal(new Date(row.executed_at).toISOString(), LATER);
  assert.equal(Number((await one(db, `SELECT count(*) AS n FROM transfer_listings WHERE rider_id='${RIDER}' AND status IN ('open','negotiating')`)).n), 0);
  assert.equal((await execute(db, releaseId)).status, "already_done");
  assert.equal((await state(db)).transactions, 1, "ingen nye pengeposter ved udfoerelsen");
});

test("SQL: har rytteren forladt holdet ad en anden vej, lukkes bestillingen uden at roere ham", async (t) => {
  const db = await database(t);
  const { release_id: releaseId } = await order(db);
  // Kun en superbruger-sti uden vagten kan goere dette (vagten er netop til for at stoppe det).
  await db.exec(`ALTER TABLE riders DISABLE TRIGGER riders_pending_release_guard_8153;
    UPDATE riders SET team_id='${OTHER}' WHERE id='${RIDER}';
    ALTER TABLE riders ENABLE TRIGGER riders_pending_release_guard_8153;`);
  assert.equal((await execute(db, releaseId)).status, "cancelled_by_system");
  assert.equal((await state(db)).owner, OTHER);
});

// Den rigtige nedrykning (demote_rider_to_academy, #5917) og dens taellefunktion
// (#5432) paa fixturens riders, med de kolonner og tabeller de laeser.
async function withDemoteRpc(db) {
  const count = (await file("2026-09-24-5432-squad-caps-rpc.sql"))
    .match(/CREATE OR REPLACE FUNCTION public\.count_team_squad_members\([\s\S]*?\n\$\$;/);
  const demote = (await file("2026-10-10-5917-demote-allow-listed.sql"))
    .match(/CREATE OR REPLACE FUNCTION public\.demote_rider_to_academy\([\s\S]*?\n\$\$;/);
  assert.ok(count && demote, "nedryknings-RPC'en findes i migrationerne");
  await db.exec(`ALTER TABLE riders ADD COLUMN IF NOT EXISTS birthdate date DEFAULT '2005-06-01';
    CREATE TABLE IF NOT EXISTS races(id uuid PRIMARY KEY, status text, stages_completed integer DEFAULT 0);
    CREATE TABLE IF NOT EXISTS race_entries(race_id uuid, rider_id uuid);`);
  await db.exec(count[0]);
  await db.exec(demote[0]);
}
const demoteRider = async (db, riderId) =>
  (await one(db, "SELECT public.demote_rider_to_academy($1,$2,1000,2,3,2026,'u23',10,22) AS r", [TEAM, riderId])).r;
const riderShape = (db, riderId) =>
  one(db, "SELECT team_id, is_academy, squad FROM riders WHERE id=$1", [riderId]);

test("SQL: nedrykning til akademiet afvises, mens frigivelsen venter, og tillades uden", async (t) => {
  const db = await database(t);
  await withDemoteRpc(db);
  const free = id(103);
  await db.exec(`INSERT INTO riders(id, team_id) VALUES('${free}','${TEAM}')`);
  await order(db);
  // Med en aktiv bestilling: den rigtige RPC afvises af vagten, og rytteren er uroert senior.
  await assert.rejects(demoteRider(db, RIDER), /rider_pending_release_8153: .*cannot change squad/);
  assert.deepEqual(await riderShape(db, RIDER), { team_id: TEAM, is_academy: false, squad: "senior" });
  // Ethvert andet trupskifte paa rytteren afvises ogsaa (fx en direkte opdatering).
  await assert.rejects(db.exec(`UPDATE riders SET squad='u23' WHERE id='${RIDER}'`), /rider_pending_release_8153/);
  await assert.rejects(db.exec(`UPDATE riders SET is_academy=true WHERE id='${RIDER}'`), /rider_pending_release_8153/);
  // Uden bestilling: samme RPC flytter holdkammeraten ned som i dag.
  assert.equal((await demoteRider(db, free)).ok, true);
  assert.deepEqual(await riderShape(db, free), { team_id: TEAM, is_academy: true, squad: "u23" });
});

test("SQL: en udfoert frigivelse efterlader ingen akademirytter uden hold", async (t) => {
  const db = await database(t);
  const { release_id: releaseId } = await order(db);
  // Kun en superbruger-sti uden vagten kan goere ham til akademirytter imens.
  await db.exec(`ALTER TABLE riders DISABLE TRIGGER riders_pending_release_guard_8153;
    UPDATE riders SET is_academy=true, squad='u23' WHERE id='${RIDER}';
    ALTER TABLE riders ENABLE TRIGGER riders_pending_release_guard_8153;`);
  assert.equal((await execute(db, releaseId)).status, "executed");
  assert.deepEqual(await riderShape(db, RIDER), { team_id: null, is_academy: false, squad: "senior" });
  assert.equal(Number((await one(db, "SELECT count(*) AS n FROM riders WHERE team_id IS NULL AND (is_academy OR squad <> 'senior')")).n), 0);
});

test("SQL: kun service_role kan kalde funktionerne; tabellen er lukket for klienten", async (t) => {
  const db = await database(t);
  const fns = [
    "public.order_rider_release_8153(uuid,uuid,uuid,bigint,jsonb,uuid,timestamptz,integer,uuid[])",
    "public.execute_pending_rider_release_8153(uuid,timestamptz)",
  ];
  for (const fn of fns) {
    for (const [role, expected] of [["anon", false], ["authenticated", false], ["service_role", true]]) {
      assert.equal((await one(db, "SELECT has_function_privilege($1,$2,'EXECUTE') AS ok", [role, fn])).ok, expected, `${role} ${fn}`);
    }
  }
  for (const role of ["anon", "authenticated"]) {
    assert.equal((await one(db, "SELECT has_table_privilege($1,'public.pending_rider_releases','SELECT') AS ok", [role])).ok, false);
  }
});

// ── Del 2: JS mod en in-memory-klient ─────────────────────────────────────────

function fakeSupabase(seed = {}) {
  const tables = {
    app_config: [], races: [], race_entries: [], race_withdrawals: [], pending_rider_releases: [], riders: [],
    ...structuredClone(seed),
  };
  const log = { from: [], rpc: [] };
  const rpcHandlers = {};
  function query(table) {
    const filters = [];
    let mode = "select", head = false, single = null, patch = null;
    const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const run = () => {
      if (!(table in tables)) return { data: null, error: { code: "42P01", message: `relation ${table} does not exist` } };
      if (mode === "delete") {
        const hit = rows();
        tables[table] = tables[table].filter((r) => !hit.includes(r));
        return { data: hit, error: null };
      }
      if (mode === "update") { const hit = rows(); hit.forEach((r) => Object.assign(r, patch)); return { data: hit, error: null }; }
      const data = rows();
      if (head) return { count: data.length, data: null, error: null };
      if (single === "maybe") return { data: data[0] ?? null, error: null };
      return { data, error: null };
    };
    const b = {
      select(_cols, opts) { if (opts?.head) head = true; return b; },
      eq(c, v) { filters.push((r) => r[c] === v); return b; },
      neq(c, v) { filters.push((r) => r[c] !== v); return b; },
      gt(c, v) { filters.push((r) => r[c] > v); return b; },
      in(c, vs) { filters.push((r) => vs.includes(r[c])); return b; },
      not(c, op, v) { filters.push((r) => !(op === "is" && v === null ? r[c] == null : false)); return b; },
      order() { return b; },
      range() { return Promise.resolve(run()); },
      delete() { mode = "delete"; return b; },
      update(p) { mode = "update"; patch = p; return b; },
      maybeSingle() { single = "maybe"; return Promise.resolve(run()); },
      then(f, r) { return Promise.resolve(run()).then(f, r); },
    };
    return b;
  }
  return {
    tables, log, rpcHandlers,
    from(table) { log.from.push(table); return query(table); },
    async rpc(name, args) { log.rpc.push([name, args]); return rpcHandlers[name] ? rpcHandlers[name](args) : { data: null, error: { message: `no rpc ${name}` } }; },
  };
}

const flagOn = { app_config: [{ key: RELEASE_DEFER_FLAG_KEY, value: "on" }] };
const activeRace = { races: [{ id: RACE, name: "Tour Test", race_type: "stage_race", status: "scheduled", stages_completed: 2 }] };
const entered = { race_entries: [{ race_id: RACE, rider_id: RIDER, team_id: TEAM }] };
const pendingRow = (extra = {}) => ({ id: id(9001), rider_id: RIDER, team_id: TEAM, race_id: RACE, status: "pending", ordered_at: NOW, ...extra });

test.beforeEach(() => clearFlagStageCache());

test("JS: slukket kontakt = intet opslag i tabellen, ruterne svarer som i dag", async () => {
  const sb = fakeSupabase({ ...activeRace, ...entered, pending_rider_releases: [pendingRow()] });
  assert.equal(await releaseDeferContext8153(sb, RIDER), null);
  assert.equal(await getPendingReleaseTradeIssue(sb, RIDER), null);
  assert.equal(await getPendingReleaseSelectionIssue(sb, { race: { id: LATER_RACE }, riderIds: [RIDER] }), null);
  assert.ok(!sb.log.from.includes("pending_rider_releases"), "slukket laeser aldrig tabellen");
  assert.ok(!sb.log.from.includes("races"), "slukket slaar heller ikke loebet op");
});

test("JS: kontakten taendt, rytteren koerer et etapeloeb -> pendingRace", async () => {
  const sb = fakeSupabase({ ...flagOn, ...activeRace, ...entered });
  assert.deepEqual(await releaseDeferContext8153(sb, RIDER), { issue: null, pendingRace: { id: RACE, name: "Tour Test" } });
});

test("JS: kontakten taendt, ikke i et aktivt etapeloeb -> straks som i dag (pendingRace null)", async () => {
  const notStarted = { races: [{ ...activeRace.races[0], stages_completed: 0 }] };
  const sb = fakeSupabase({ ...flagOn, ...notStarted, ...entered });
  assert.deepEqual(await releaseDeferContext8153(sb, RIDER), { issue: null, pendingRace: null });
  // Afmeldt hold: samme diskriminator som salg (#5636).
  const withdrawn = fakeSupabase({ ...flagOn, ...activeRace, ...entered, race_withdrawals: [{ race_id: RACE, team_id: TEAM }] });
  assert.equal(await findActiveStageRaceForRider(withdrawn, RIDER), null);
});

test("JS: allerede bestilt -> 409 med loebets navn", async () => {
  const sb = fakeSupabase({ ...flagOn, ...activeRace, ...entered, pending_rider_releases: [pendingRow()] });
  const ctx = await releaseDeferContext8153(sb, RIDER);
  assert.equal(ctx.issue.status, 409);
  assert.equal(ctx.issue.body.errorCode, "rider_release_already_pending");
  assert.deepEqual(ctx.issue.body.errorParams, { race: "Tour Test" });
});

test("JS: handel med en rytter, der venter paa frigivelse, afvises med teksten fra designet", async () => {
  const sb = fakeSupabase({ ...flagOn, ...activeRace, pending_rider_releases: [pendingRow()] });
  const issue = await getPendingReleaseTradeIssue(sb, RIDER);
  assert.equal(issue.status, 409);
  assert.equal(issue.body.errorCode, "rider_pending_release_trade");
  assert.deepEqual(issue.body.errorParams, { race: "Tour Test" });
  assert.equal(await getPendingReleaseTradeIssue(sb, id(999)), null);
});

test("JS: udtagelse til et senere loeb afvises, det igangvaerende loeb er tilladt", async () => {
  const sb = fakeSupabase({ ...flagOn, pending_rider_releases: [pendingRow()] });
  const issue = await getPendingReleaseSelectionIssue(sb, { race: { id: LATER_RACE }, riderIds: [RIDER, id(102)] });
  assert.deepEqual(issue, { ok: false, status: 409, error: "selection_rider_leaving", leaving_rider_ids: [RIDER] });
  assert.equal(await getPendingReleaseSelectionIssue(sb, { race: { id: RACE }, riderIds: [RIDER] }), null);
  assert.equal(await getPendingReleaseSelectionIssue(sb, { race: { id: LATER_RACE }, riderIds: [] }), null);
});

test("JS: bestillingen svarer efter kontrakten og sender beskeden", async () => {
  const sb = fakeSupabase({ ...flagOn });
  sb.rpcHandlers.order_rider_release_8153 = (args) => ({ data: { status: "pending", release_id: id(9001), race_id: args.p_race_id, fee: args.p_fee }, error: null });
  const sent = [];
  const res = await orderPendingRelease(sb, {
    riderId: RIDER, teamId: TEAM, race: { id: RACE, name: "Tour Test" }, fee: FEE, feePayload: feePayload(),
    orderedBy: id(77), now: new Date(NOW), riderName: "Test Rider", notifyTeamOwner: async (...a) => { sent.push(a); },
  });
  assert.deepEqual(res, { data: { pending: true, race: { id: RACE, name: "Tour Test" }, fee: FEE } });
  const [, args] = sb.log.rpc[0];
  assert.equal(args.p_now, NOW);
  assert.equal(args.p_min_riders, 0);
  assert.deepEqual(args.p_at_risk_rider_ids, []);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], TEAM);
  assert.equal(sent[0][5].messageCode, "notif.riderReleasePending.message");
  assert.deepEqual(sent[0][5].messageParams, { rider: "Test Rider", race: "Tour Test", fee: FEE });
  assert.equal(sent[0][3], `Test Rider will be released after Tour Test. The fee of ${FEE} CZ$ has been charged.`);
});

test("JS: bestillingens afvisninger oversaettes til dagens fejlkoder", async () => {
  const cases = [
    [{ status: "already_pending", race_id: RACE }, 409, "rider_release_already_pending"],
    [{ status: "rider_state_changed" }, 409, "rider_state_changed"],
    [{ status: "rider_on_auction" }, 409, "rider_on_auction_release"],
    [{ status: "cannot_afford_release", fee: FEE, balance: 10 }, 400, "cannot_afford_release"],
    [{ status: "insufficient_available_balance", fee: FEE, available: 5, locked: 7 }, 400, "insufficient_available_balance"],
    [{ status: "squad_floor", min_riders: 8 }, 409, "cannot_release_squad_risk"],
  ];
  for (const [result, status, code] of cases) {
    const sb = fakeSupabase({ ...activeRace });
    sb.rpcHandlers.order_rider_release_8153 = () => ({ data: result, error: null });
    const res = await orderPendingRelease(sb, { riderId: RIDER, teamId: TEAM, race: { id: RACE, name: "Tour Test" }, fee: FEE, feePayload: feePayload(), now: new Date(NOW), notifyTeamOwner: async () => assert.fail("ingen besked ved afvisning") });
    assert.equal(res.error.status, status, code);
    assert.equal(res.error.body.errorCode, code);
  }
});

function executionClient(seed) {
  const sb = fakeSupabase(seed);
  sb.rpcHandlers.execute_pending_rider_release_8153 = ({ p_release_id: releaseId }) => {
    const row = sb.tables.pending_rider_releases.find((r) => r.id === releaseId);
    if (row.status !== "pending") return { data: { status: "already_done" }, error: null };
    row.status = "executed";
    const rider = sb.tables.riders.find((r) => r.id === row.rider_id);
    if (rider) rider.team_id = null;
    return { data: { status: "executed", rider_id: row.rider_id }, error: null };
  };
  return sb;
}

test("JS: udfoerelse ved finalisering frigiver, rydder fremtidige tilmeldinger og sender beskeden; gentagelse er stille", async () => {
  const seed = {
    races: [{ id: RACE, name: "Tour Test", race_type: "stage_race", status: "completed", stages_completed: 4 }],
    riders: [{ id: RIDER, team_id: TEAM, firstname: "Test", lastname: "Rider" }],
    pending_rider_releases: [pendingRow()],
  };
  const sb = executionClient(seed);
  const sent = [];
  const notify = async (...a) => { sent.push(a); };
  const race = { id: RACE, race_type: "stage_race", name: "Tour Test" };
  assert.deepEqual(await executePendingReleasesForRace(sb, race, { now: new Date(LATER), notifyTeamOwner: notify }), { executed: 1, failed: 0, errors: [] });
  assert.equal(sb.tables.riders[0].team_id, null);
  assert.ok(sb.log.from.includes("race_entries"), "fremtidige tilmeldinger slaas op og ryddes");
  assert.equal(sent.length, 1);
  assert.equal(sent[0][3], "Test Rider has left your team.");
  assert.deepEqual(await executePendingReleasesForRace(sb, race, { now: new Date(LATER), notifyTeamOwner: notify }), { executed: 0, failed: 0, errors: [] });
  assert.equal(sent.length, 1);
});

test("JS: en rytter i et andet aktivt etapeloeb venter, til ogsaa det er slut", async () => {
  const sb = executionClient({
    races: [
      { id: RACE, name: "Tour Test", race_type: "stage_race", status: "completed", stages_completed: 4 },
      { id: LATER_RACE, name: "Other Tour", race_type: "stage_race", status: "scheduled", stages_completed: 1 },
    ],
    race_entries: [{ race_id: LATER_RACE, rider_id: RIDER, team_id: TEAM }],
    riders: [{ id: RIDER, team_id: TEAM, firstname: "Test", lastname: "Rider" }],
    pending_rider_releases: [pendingRow()],
  });
  const res = await executePendingReleasesForRace(sb, { id: RACE, race_type: "stage_race" }, { now: new Date(LATER) });
  assert.equal(res.executed, 0);
  assert.equal(sb.tables.riders[0].team_id, TEAM);
});

test("JS: et enkeltdagsloeb slaar aldrig tabellen op", async () => {
  const sb = fakeSupabase({});
  assert.deepEqual(await executePendingReleasesForRace(sb, { id: RACE, race_type: "single" }, { now: new Date(LATER) }), { executed: 0, failed: 0, errors: [] });
  assert.equal(sb.log.from.length, 0);
});

test("JS: sikkerhedsnettet udfoerer kun bestillinger, hvis loeb er slut", async () => {
  const sb = executionClient({
    races: [
      { id: RACE, name: "Tour Test", race_type: "stage_race", status: "completed", stages_completed: 4 },
      { id: LATER_RACE, name: "Running Tour", race_type: "stage_race", status: "scheduled", stages_completed: 2 },
    ],
    race_entries: [{ race_id: LATER_RACE, rider_id: id(102), team_id: TEAM }],
    riders: [
      { id: RIDER, team_id: TEAM, firstname: "Test", lastname: "Rider" },
      { id: id(102), team_id: TEAM, firstname: "Still", lastname: "Racing" },
    ],
    pending_rider_releases: [pendingRow(), pendingRow({ id: id(9002), rider_id: id(102), race_id: LATER_RACE })],
  });
  const res = await runPendingReleaseHealSweep(sb, { now: new Date(LATER) });
  assert.deepEqual(res, { checked: 2, executed: 1, failed: 0, errors: [] });
  assert.equal(sb.tables.riders.find((r) => r.id === RIDER).team_id, null);
  assert.equal(sb.tables.riders.find((r) => r.id === id(102)).team_id, TEAM);
});

test("JS: GET /me/pending-releases-kontrakten og saesonskifte-spaerren", async () => {
  const sb = fakeSupabase({ ...activeRace, pending_rider_releases: [pendingRow(), pendingRow({ id: id(9003), status: "executed" })] });
  assert.deepEqual(await loadPendingReleasesForTeam(sb, TEAM), [{ riderId: RIDER, raceId: RACE, raceName: "Tour Test" }]);
  assert.equal(await countActivePendingReleases(sb), 1);
  assert.equal(await countPendingReleasesForTransition(sb), 1);
  // Manglende tabel = 0 (migrationen er ikke applied endnu); en laesefejl i force-grenen = afvis.
  const missing = fakeSupabase({});
  delete missing.tables.pending_rider_releases;
  assert.equal(await countPendingReleasesForTransition(missing), 0);
  assert.deepEqual(await loadPendingReleasesForTeam(missing, TEAM), []);
  const broken = { from() { throw new Error("boom"); } };
  assert.equal(await countPendingReleasesForTransition(broken), 1);
});

// ── Trupskifte (nedrykning) med en ventende frigivelse ───────────────────────

test("JS: trup-ruten afviser et trupskifte, mens frigivelsen venter; slukket kontakt flytter som i dag", async () => {
  let moved = 0;
  const move = async () => { moved += 1; return { riderId: RIDER, action: "demoted" }; };
  const on = fakeSupabase({ ...flagOn, ...activeRace, pending_rider_releases: [pendingRow()] });
  const blocked = await handleMoveSquadRequest(on, { teamId: TEAM, riderId: RIDER, body: { squad: "u23" }, seasonNumber: 2, move });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.errorCode, "rider_pending_release_squad");
  assert.deepEqual(blocked.body.errorParams, { race: "Tour Test" });
  assert.equal(moved, 0, "flytningen koeres aldrig");
  // Slukket: ingen opslag i tabellen, og flytningen koerer som i dag.
  const off = fakeSupabase({ ...activeRace, pending_rider_releases: [pendingRow()] });
  const ok = await handleMoveSquadRequest(off, { teamId: TEAM, riderId: RIDER, body: { squad: "u23" }, seasonNumber: 2, move });
  assert.equal(ok.status, 200);
  assert.equal(moved, 1);
  assert.ok(!off.log.from.includes("pending_rider_releases"), "slukket laeser aldrig tabellen");
});

test("JS: afviser vagten i databasen nedrykningen, bliver det til 409 med loebets navn (ikke 500)", async () => {
  const sb = fakeSupabase({
    ...activeRace,
    riders: [{ id: RIDER, team_id: TEAM, firstname: "Test", lastname: "Rider", is_academy: false, birthdate: "2005-06-01", salary: 1000, contract_length: 2, contract_end_season: 3 }],
    pending_rider_releases: [pendingRow()],
  });
  sb.rpcHandlers.demote_rider_to_academy = () => ({ data: null, error: { code: "P0001", message: `rider_pending_release_8153: rider ${RIDER} is leaving his team after a stage race and cannot change squad` } });
  await assert.rejects(
    demoteAcademyRider(sb, { teamId: TEAM, riderId: RIDER, seasonNumber: 2, targetSquad: "u23", now: new Date(NOW), notify: async () => assert.fail("ingen besked") }),
    { message: "rider_pending_release_squad" },
  );
  // Samme fejl gennem trup-ruten (kontakten slukket, saa kun vagten i databasen stopper den).
  const res = await handleMoveSquadRequest(sb, {
    teamId: TEAM, riderId: RIDER, body: { squad: "u23" }, seasonNumber: 2,
    move: async () => { throw new Error("rider_pending_release_squad"); },
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.errorCode, "rider_pending_release_squad");
  assert.deepEqual(res.body.errorParams, { race: "Tour Test" });
});
