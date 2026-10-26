// #7251 · Tilbagekøbsret: regler + kandidater + gen-signering mod en falsk Supabase.
import test from "node:test";
import assert from "node:assert/strict";
import { buybackBlockReason, loadBuybackCandidates, buybackRider, BuybackError, BUYBACK_7251 } from "./contractBuyback7251.js";

const RELEASED = "2026-10-25T20:30:00Z";
const NOW = new Date("2026-10-26T12:00:00Z");
const free = { id: "r1", team_id: null, pending_team_id: null, is_retired: false };

test("regel: fri rytter frigivet uden varsel inden for 7 dage kan købes tilbage", () => {
  assert.equal(buybackBlockReason({ rider: free, releasedAt: RELEASED, warned: false, onActiveAuction: false, now: NOW }), null);
});

test("regel: varslet, signet af andre, pensioneret, på auktion eller udløbet blokerer", () => {
  const base = { rider: free, releasedAt: RELEASED, warned: false, onActiveAuction: false, now: NOW };
  assert.equal(buybackBlockReason({ ...base, warned: true }), "buyback_not_eligible");
  assert.equal(buybackBlockReason({ ...base, rider: { ...free, team_id: "t9" } }), "buyback_rider_not_free");
  assert.equal(buybackBlockReason({ ...base, rider: { ...free, pending_team_id: "t9" } }), "buyback_rider_not_free");
  assert.equal(buybackBlockReason({ ...base, rider: { ...free, is_retired: true } }), "buyback_rider_retired");
  assert.equal(buybackBlockReason({ ...base, onActiveAuction: true }), "buyback_rider_on_auction");
  const after = new Date(new Date(RELEASED).getTime() + BUYBACK_7251.windowDays * 86400000 + 1000);
  assert.equal(buybackBlockReason({ ...base, now: after }), "buyback_expired");
});

// Minimal falsk Supabase: filtrerer på eq/is/in/gte/lt og registrerer updates.
function fakeSupabase(tables) {
  const updates = [];
  const inserts = [];
  function query(table) {
    let rows = [...(tables[table] || [])];
    let patch = null;
    let countHead = false;
    const b = {
      select(_cols, opts) { if (opts?.head) countHead = true; return b; },
      eq(col, val) { rows = rows.filter((r) => r[col] === val); return b; },
      is(col, val) { rows = rows.filter((r) => (r[col] ?? null) === val); return b; },
      in(col, vals) { rows = rows.filter((r) => vals.includes(r[col])); return b; },
      gte(col, val) { rows = rows.filter((r) => r[col] >= val); return b; },
      lt(col, val) { rows = rows.filter((r) => r[col] < val); return b; },
      not() { return b; }, neq() { return b; }, order() { return b; }, limit() { return b; }, range() { return b; },
      update(p) { patch = p; return b; },
      insert(row) { inserts.push({ table, row }); return Promise.resolve({ data: null, error: null }); },
      maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
      single() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
      then(resolve) {
        if (patch) {
          for (const r of rows) Object.assign(r, patch);
          updates.push({ table, patch, ids: rows.map((r) => r.id) });
          return Promise.resolve({ data: rows.map((r) => ({ id: r.id })), error: null }).then(resolve);
        }
        if (countHead) return Promise.resolve({ count: rows.length, error: null, data: null }).then(resolve);
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return b;
  }
  return { from: query, updates, inserts };
}

function world() {
  return {
    rider_ownership_events: [
      { id: 1, rider_id: "r1", from_team_id: "t1", to_team_id: null, reason: "release", occurred_at: RELEASED },
      { id: 2, rider_id: "r2", from_team_id: "t1", to_team_id: null, reason: "release", occurred_at: RELEASED },
      { id: 3, rider_id: "r3", from_team_id: "t1", to_team_id: null, reason: "release", occurred_at: RELEASED },
      { id: 4, rider_id: "r4", from_team_id: "t2", to_team_id: null, reason: "release", occurred_at: RELEASED },
    ],
    notifications: [
      { id: 10, user_id: "u1", type: "contract_expiring", related_id: "r2", message: "B's contract expires at the end of season 4." },
    ],
    riders: [
      { id: "r1", firstname: "A", lastname: "Alfa", team_id: null, pending_team_id: null, is_retired: false, squad: "senior", current_production_value: 100000 },
      { id: "r2", firstname: "B", lastname: "Beta", team_id: null, pending_team_id: null, is_retired: false, squad: "senior", current_production_value: 100000 },
      { id: "r3", firstname: "C", lastname: "Charlie", team_id: "t9", pending_team_id: null, is_retired: false, squad: "senior", current_production_value: 100000 },
      { id: "r4", firstname: "D", lastname: "Delta", team_id: null, pending_team_id: null, is_retired: false, squad: "senior", current_production_value: 100000 },
      ...Array.from({ length: 5 }, (_, i) => ({ id: `own${i}`, team_id: "t1", pending_team_id: null, is_retired: false, squad: "senior" })),
    ],
    auctions: [],
    teams: [{ id: "t1", user_id: "u1", name: "T1", balance: 0, division: 3, created_at: "2026-01-01" }],
    seasons: [{ number: 5, status: "active" }],
    rider_ownership_events_written: [],
  };
}

test("kandidater: kun eget holds ryttere frigivet uden varsel; varslede er ude, signede er blokeret", async () => {
  const supabase = fakeSupabase(world());
  const list = await loadBuybackCandidates({ supabase, team: { id: "t1", user_id: "u1" }, now: NOW });
  assert.deepEqual(list.map((c) => c.id), ["r1", "r3"], "r2 havde varsel, r4 er et andet holds");
  assert.equal(list.find((c) => c.id === "r1").blocked, null);
  assert.equal(list.find((c) => c.id === "r3").blocked, "buyback_rider_not_free");
  assert.ok(list[0].salary > 0, "normal løn (computeFrozenSalary)");
});

test("gen-signering: 1 sæson, normal løn, ingen pris; afvist for varslet rytter", async () => {
  const w = world();
  const supabase = fakeSupabase(w);
  const res = await buybackRider({ supabase, team: { id: "t1", user_id: "u1" }, riderId: "r1", now: NOW });
  assert.equal(res.contract_end_season, 5, "kontrakten løber denne sæson ud (1 sæson)");
  const r1 = w.riders.find((r) => r.id === "r1");
  assert.equal(r1.team_id, "t1");
  assert.equal(r1.contract_length, 1);
  assert.equal(r1.salary, res.salary);
  assert.ok(!supabase.updates.some((u) => u.table === "teams"), "ingen pris/balance-ændring");
  await assert.rejects(
    buybackRider({ supabase, team: { id: "t1", user_id: "u1" }, riderId: "r2", now: NOW }),
    (err) => err instanceof BuybackError && err.code === "buyback_not_eligible",
  );
});
