// #5642 · S4 spor A2: D4 fra 8 til 4 puljer.
//   1) Ren plan (planD4PoolRetirement): flytning E-H → A-D op til 24, overskud
//      nedlægges, blokerende hold, projektion, determinisme, idempotens.
//   2) Migrationen 2026-09-25-4592-d4-retire-pools.sql mod ÆGTE SQL i PGlite:
//      plan_ai_pool_retirements giver 0 for en pensioneret pulje og fyld for en aktiv
//      tier 4-pulje uden ægte managers; filen kan køres to gange.
//   3) Hele apply-stien (runRetireD4Pools) mod PGlite: flyt, pensionér, nedlæg,
//      verificér, snapshot + restore-SQL, og et re-run er et no-op.

import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

import {
  planD4PoolRetirement, seasonGate, buildRestoreSql, runRetireD4Pools, D4_ACTIVE_POOL_COUNT,
} from "./retireD4PoolsS4.js";
import { POOL_TARGET_SIZE } from "../lib/economyConstants.js";

// ── 1) Ren plan ───────────────────────────────────────────────────────────────

function d4Pools({ retiredFrom = null } = {}) {
  return Array.from({ length: 8 }, (_, i) => ({
    id: 20 + i, tier: 4, pool_index: i, label: `D4 ${"ABCDEFGH"[i]}`,
    retired_at: retiredFrom != null && i >= retiredFrom ? "2026-09-27T20:00:00Z" : null,
  }));
}
const otherPools = [{ id: 1, tier: 1, pool_index: 0 }, { id: 2, tier: 3, pool_index: 0 }];

function ai(id, poolId, extra = {}) {
  return { id, is_ai: true, is_bank: false, is_frozen: false, is_test_account: false, user_id: null,
    retired_at: null, pending_removal_at: null, league_division_id: poolId, division: 4, ...extra };
}
function human(id, poolId, extra = {}) {
  return { id, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, user_id: `u-${id}`,
    retired_at: null, pending_removal_at: null, league_division_id: poolId, division: 4, ...extra };
}
function fill(poolId, n, prefix) {
  return Array.from({ length: n }, (_, i) => ai(`${prefix}-${String(i).padStart(2, "0")}`, poolId));
}

// Prod-formen efter sammenlægningen (tal fra den read-only dry-run): A-C 12 AI, D 13,
// E-H 13 hver. 49 + 52 = 101 AI; A-D rummer 96.
function prodLikeTeams() {
  return [
    ...fill(20, 12, "a"), ...fill(21, 12, "b"), ...fill(22, 12, "c"), ...fill(23, 13, "d"),
    ...fill(24, 13, "e"), ...fill(25, 13, "f"), ...fill(26, 13, "g"), ...fill(27, 13, "h"),
  ];
}

test("plan: A-D fyldes til præcis 24 med AI fra E-H; kun overskuddet nedlægges", () => {
  const plan = planD4PoolRetirement({ pools: [...otherPools, ...d4Pools()], teams: prodLikeTeams() });
  assert.equal(plan.keep.length, D4_ACTIVE_POOL_COUNT);
  assert.deepEqual(plan.retire.map((p) => p.pool_index), [4, 5, 6, 7]);
  assert.equal(plan.moves.length, 47);
  assert.equal(plan.retireTeams.length, 5);
  assert.equal(plan.blockers.length, 0);
  for (const row of plan.pools) {
    assert.equal(row.after.total, row.role === "keep" ? POOL_TARGET_SIZE : 0, row.label);
  }
  // Flettet kilde: den første A-D-pulje får hold fra alle fire pensionerede puljer.
  const intoFirst = new Set(plan.moves.filter((m) => m.toPoolId === 20).map((m) => m.fromPoolId));
  assert.deepEqual([...intoFirst].sort(), [24, 25, 26, 27]);
});

test("plan: deterministisk (samme input → samme flytninger, uafhængigt af rækkefølgen ind)", () => {
  const pools = [...otherPools, ...d4Pools()];
  const a = planD4PoolRetirement({ pools, teams: prodLikeTeams() });
  const b = planD4PoolRetirement({ pools: [...pools].reverse(), teams: [...prodLikeTeams()].reverse() });
  assert.deepEqual(a.moves, b.moves);
  assert.deepEqual(a.retireTeams, b.retireTeams);
});

test("plan: menneskehold i E-H blokerer (sammenlægningen først); --assume-merged projicerer dem væk", () => {
  const teams = [...prodLikeTeams(), human("m1", 24), human("m2", 20)];
  const plan = planD4PoolRetirement({ pools: d4Pools(), teams });
  assert.deepEqual(plan.blockers, [{ teamId: "m1", poolId: 24, kind: "manager" }]);
  // Manageren i A optager en plads: A får kun 11 AI flyttet ind.
  assert.equal(plan.pools.find((p) => p.poolId === 20).after.total, POOL_TARGET_SIZE);
  assert.equal(plan.pools.find((p) => p.poolId === 20).after.nonAi, 1);

  const projected = planD4PoolRetirement({ pools: d4Pools(), teams, assumeMerged: true });
  assert.equal(projected.blockers.length, 0);
  assert.equal(projected.moves.length, 47);
});

test("plan: frosne/test-hold og AI med ejer i E-H blokerer; et reserveret AI-hold nedlægges i stedet for at flyttes", () => {
  const teams = [
    ...fill(20, 23, "a"), ...fill(21, 24, "b"), ...fill(22, 24, "c"), ...fill(23, 24, "d"),
    ai("pending", 24, { pending_removal_at: "2026-09-27T19:00:00Z" }),
    ai("mover", 25),
    human("frozen", 26, { is_frozen: true }),
    ai("owned", 27, { user_id: "u-x" }),
  ];
  const plan = planD4PoolRetirement({ pools: d4Pools(), teams });
  assert.deepEqual(plan.moves, [{ teamId: "mover", fromPoolId: 25, toPoolId: 20 }]);
  assert.deepEqual(plan.retireTeams, [{ teamId: "pending", poolId: 24 }]);
  assert.deepEqual(plan.blockers.map((b) => b.kind).sort(), ["ai_not_retirable", "frozen_or_test"]);
});

test("plan: idempotent - efter flytningen og nedlæggelsen er et nyt plan tomt", () => {
  const pools = d4Pools({ retiredFrom: 4 });
  const first = planD4PoolRetirement({ pools, teams: prodLikeTeams() });
  const moved = new Map(first.moves.map((m) => [m.teamId, m.toPoolId]));
  const gone = new Set(first.retireTeams.map((r) => r.teamId));
  const afterTeams = prodLikeTeams().filter((t) => !gone.has(t.id))
    .map((t) => (moved.has(t.id) ? { ...t, league_division_id: moved.get(t.id) } : t));
  const second = planD4PoolRetirement({ pools, teams: afterTeams });
  assert.equal(second.moves.length, 0);
  assert.equal(second.retireTeams.length, 0);
  assert.ok(second.pools.filter((p) => p.role === "retire").every((p) => p.alreadyRetired));
});

test("plan: afviser en pyramide uden flere end 4 D4-puljer, og ignorerer ungdomspuljer", () => {
  assert.throws(() => planD4PoolRetirement({ pools: d4Pools().slice(0, 4), teams: [] }), /mere end 4 D4-puljer/);
  const youth = { id: 99, tier: 4, pool_index: 9, squad: "u23" };
  const plan = planD4PoolRetirement({ pools: [...d4Pools(), youth], teams: [] });
  assert.ok(!plan.retire.some((p) => p.id === 99));
});

test("seasonGate: aktiv sæson afvises; kræver mindst én afsluttet", () => {
  assert.equal(seasonGate([{ number: 3, status: "active" }]).ok, false);
  assert.equal(seasonGate([{ number: 4, status: "upcoming" }]).ok, false);
  assert.equal(seasonGate([{ number: 3, status: "completed" }, { number: 4, status: "upcoming" }]).ok, true);
});

test("buildRestoreSql genskaber hold, ryttere og puljer i én transaktion", () => {
  const sql = buildRestoreSql({
    taken_at: "2026-09-27T20:00:00Z",
    teams: [{ id: "t1", division: 4, league_division_id: 24, retired_at: null, pending_removal_at: null }],
    riders: [{ id: "r1", team_id: "t1", is_retired: false, pending_team_id: null }],
    pools: [{ id: 24, retired_at: null }],
  });
  assert.match(sql, /^-- #5642 rollback/);
  assert.match(sql, /update teams set division=4, league_division_id=24, retired_at=null, pending_removal_at=null where id='t1';/);
  assert.match(sql, /update riders set team_id='t1', is_retired=false, pending_team_id=null where id='r1';/);
  assert.match(sql, /update league_divisions set retired_at=null where id=24;/);
  assert.match(sql, /begin;[\s\S]*commit;/);
});

// ── 2+3) Ægte SQL i PGlite ──────────────────────────────────────────────────────

const NOW = "2026-09-27T20:00:00Z";
const MIGRATION = new URL("../../database/2026-09-25-4592-d4-retire-pools.sql", import.meta.url);
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL("../lib/testFixtures/aiPoolRetirement.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../database/2026-09-09-4753-ai-pool-retirement.sql", import.meta.url), "utf8"));
  await db.exec("ALTER TABLE teams ADD COLUMN division int; CREATE TABLE seasons(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), number int, status text);");
  const sql = await readFile(MIGRATION, "utf8");
  await db.exec(sql);
  await db.exec(sql); // auto-migrate-sikker: to kørsler
});
const tempDirs = [];
async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "retire-d4-"));
  tempDirs.push(dir);
  return dir;
}
after(async () => {
  await db?.close();
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.exec(`TRUNCATE race_stage_claims,notifications,rider_watchlist,auctions,swap_offers,transfer_listings,
    transfer_offers,race_results,race_entries,riders,races,teams,league_divisions,seasons CASCADE;
    INSERT INTO league_divisions(id,tier,pool_index,label) SELECT 20+i,4,i,'D4 '||chr(65+i) FROM generate_series(0,7) i;
    INSERT INTO league_divisions(id,tier,pool_index,label) VALUES (5,3,0,'D3 A');
    INSERT INTO seasons(number,status) VALUES (3,'completed'),(4,'upcoming');`);
});

async function seedAi(poolId, n) {
  await db.query(`INSERT INTO teams(name,is_ai,league_division_id,division)
    SELECT 'AI '||$1::text||'-'||i,true,$2::bigint,4 FROM generate_series(1,$3::int) i`, [String(poolId), poolId, n]);
  await db.query(`INSERT INTO riders(team_id,firstname,lastname)
    SELECT id,'R','X' FROM teams WHERE league_division_id=$1::bigint AND is_ai
      AND NOT EXISTS (SELECT 1 FROM riders r WHERE r.team_id=teams.id)`, [poolId]);
}
async function planIds(poolId) {
  return (await db.query("SELECT * FROM plan_ai_pool_retirements($1,$2)", [poolId, NOW])).rows;
}
async function poolCount(poolId) {
  return Number((await db.query("SELECT count(*) n FROM teams WHERE league_division_id=$1", [poolId])).rows[0].n);
}

test("SQL: aktiv tier 4-pulje uden ægte managers har mål 24 (ingen nedlæggelse under 24, overskud over)", async () => {
  await seedAi(20, 20);
  assert.equal((await planIds(20)).length, 0, "20 AI i en aktiv D4-pulje er ikke overskud");
  await seedAi(21, 25);
  const plan = await planIds(21);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].target_size, 24);
});

test("SQL: pensioneret pulje har mål 0 - alle AI-hold er overskud; tier 3 uden managers er uændret 0", async () => {
  await seedAi(25, 13);
  await db.exec(`UPDATE league_divisions SET retired_at='${NOW}' WHERE id=25`);
  const plan = await planIds(25);
  assert.equal(plan.length, 13);
  assert.ok(plan.every((r) => r.target_size === 0));
  await seedAi(5, 3);
  assert.equal((await planIds(5)).length, 3, "tom-for-managers tier 3 (dormant) er stadig mål 0");
});

// Minimal PostgREST-agtig klient over PGlite: nok til runRetireD4Pools' kald.
function client() {
  return {
    async rpc(name, args) {
      const keys = Object.keys(args);
      try {
        const res = await db.query(`SELECT ${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(",")}) AS result`, Object.values(args));
        return { data: res.rows[0].result, error: null };
      } catch (error) { return { data: null, error }; }
    },
    from(table) {
      const clauses = []; const values = [];
      let cols = "*"; let patch = null; let returning = null;
      const q = {
        select(c = "*") { if (patch) returning = c; else cols = c; return q; },
        update(p) { patch = p; return q; },
        order() { return q; },
        eq(k, v) { values.push(v); clauses.push(`${k}=$${values.length}`); return q; },
        in(k, v) { values.push(v); clauses.push(`${k}=ANY($${values.length})`); return q; },
        is(k, v) { if (v !== null) throw new Error("is: kun null"); clauses.push(`${k} IS NULL`); return q; },
        or(expr) {
          const parts = String(expr).split(",").map((cond) => {
            const [col, op, ...rest] = cond.split("."); const raw = rest.join(".");
            if (op === "is" && raw === "null") return `${col} IS NULL`;
            if (op === "eq") { values.push(raw); return `${col}=$${values.length}`; }
            throw new Error(`or: ${op}`);
          });
          clauses.push(`(${parts.join(" OR ")})`); return q;
        },
        async result() {
          const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
          try {
            if (patch) {
              const keys = Object.keys(patch);
              const offset = values.length;
              const set = keys.map((k, i) => `${k}=$${offset + i + 1}`).join(",");
              const res = await db.query(`UPDATE ${table} SET ${set}${where}${returning ? ` RETURNING ${returning}` : ""}`,
                [...values, ...keys.map((k) => patch[k])]);
              return { data: returning ? res.rows : null, error: null };
            }
            return { data: (await db.query(`SELECT ${cols} FROM ${table}${where}`, values)).rows, error: null };
          } catch (error) { return { data: null, error }; }
        },
        async range(from, to) { const r = await q.result(); return r.error ? r : { ...r, data: r.data.slice(from, to + 1) }; },
        then(res, rej) { return q.result().then(res, rej); },
      };
      return q;
    },
  };
}

test("apply mod PGlite: flytter, pensionerer E-H, nedlægger overskuddet, verificerer og skriver snapshot; re-run er no-op", async () => {
  for (const [pool, n] of [[20, 12], [21, 12], [22, 12], [23, 13], [24, 13], [25, 13], [26, 13], [27, 13]]) await seedAi(pool, n);
  const snapshotDir = await tempDir();
  const sb = client();
  const opts = { supabase: sb, apply: true, ownerGo: true, now: new Date(NOW), snapshotDir, retireEnabled: async () => true };

  const refused = await runRetireD4Pools({ ...opts, ownerGo: false });
  assert.ok(refused.refusals.some((r) => /owner-go/.test(r)));
  assert.equal(refused.applied, null);
  assert.equal(await poolCount(24), 13, "afvist apply skriver intet");

  const report = await runRetireD4Pools(opts);
  assert.deepEqual(report.refusals, []);
  assert.equal(report.applied.moved, 47);
  assert.equal(report.applied.retired, 5);
  assert.equal(report.applied.leftInRetired, 0);
  assert.deepEqual(report.applied.overfull, []);
  for (const pool of [20, 21, 22, 23]) assert.equal(await poolCount(pool), 24);
  for (const pool of [24, 25, 26, 27]) assert.equal(await poolCount(pool), 0);
  const retiredPools = (await db.query("SELECT count(*) n FROM league_divisions WHERE retired_at IS NOT NULL")).rows[0].n;
  assert.equal(Number(retiredPools), 4);
  // Historikken består: de nedlagte holds rækker og ryttere findes stadig.
  assert.equal(Number((await db.query("SELECT count(*) n FROM teams WHERE retired_at IS NOT NULL")).rows[0].n), 5);
  assert.equal(Number((await db.query("SELECT count(*) n FROM riders WHERE is_retired")).rows[0].n), 5);

  const restore = await readFile(report.applied.snapshot.sqlPath, "utf8");
  assert.match(restore, /update league_divisions set retired_at=null where id=24;/);

  const again = await runRetireD4Pools(opts);
  assert.equal(again.applied.moved, 0);
  assert.equal(again.applied.retired, 0);
  assert.equal(again.plan.moves.length + again.plan.retireTeams.length, 0);
});

test("apply mod PGlite: afvist mens sæsonen er aktiv og mens menneskehold står i E-H", async () => {
  await seedAi(24, 13);
  await db.exec("UPDATE seasons SET status='active' WHERE number=3; INSERT INTO teams(name,league_division_id,division) VALUES ('Manager',25,4)");
  const report = await runRetireD4Pools({
    supabase: client(), apply: true, ownerGo: true, now: new Date(NOW),
    snapshotDir: await tempDir(), retireEnabled: async () => true,
  });
  assert.equal(report.applied, null);
  assert.ok(report.refusals.some((r) => /active/.test(r)));
  assert.ok(report.refusals.some((r) => /sammenlægningen/.test(r)));
  assert.equal(await poolCount(24), 13);
});
