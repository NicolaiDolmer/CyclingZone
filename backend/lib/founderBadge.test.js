import test from "node:test";
import assert from "node:assert/strict";

import { FOUNDER_BADGE_KEY, FOUNDER_BADGE_DEF, ensureFounderBadgeDef, grantFounderBadges } from "./founderBadge.js";

function makeMock({ existingGrants = [] } = {}) {
  const calls = { upserts: [], inserts: [] };
  const supabase = {
    from(table) {
      return {
        upsert(row, opts) { calls.upserts.push({ table, row, opts }); return Promise.resolve({ error: null }); },
        select() {
          return {
            eq(col, val) {
              calls.lastSelect = { table, col, val };
              return Promise.resolve({ data: existingGrants, error: null });
            },
          };
        },
        insert(rows) { calls.inserts.push({ table, rows }); return Promise.resolve({ error: null }); },
      };
    },
  };
  return { supabase, calls };
}

test("FOUNDER_BADGE_DEF matcher achievements-kontrakten", () => {
  assert.equal(FOUNDER_BADGE_DEF.id, FOUNDER_BADGE_KEY);
  for (const k of ["id", "category", "title", "description", "icon"]) {
    assert.equal(typeof FOUNDER_BADGE_DEF[k], "string");
    assert.ok(FOUNDER_BADGE_DEF[k].length > 0, `${k} skal være sat`);
  }
  assert.equal(FOUNDER_BADGE_DEF.is_secret, false);
  assert.ok(!FOUNDER_BADGE_DEF.title.includes("—"), "ingen em-dash i title");
  assert.ok(!FOUNDER_BADGE_DEF.description.includes("—"), "ingen em-dash i description");
});

test("ensureFounderBadgeDef (apply) upserter def på id-konflikt", async () => {
  const { supabase, calls } = makeMock();
  await ensureFounderBadgeDef(supabase, { dryRun: false });
  assert.equal(calls.upserts.length, 1);
  assert.equal(calls.upserts[0].table, "achievements");
  assert.equal(calls.upserts[0].row.id, FOUNDER_BADGE_KEY);
  assert.equal(calls.upserts[0].opts.onConflict, "id");
});

test("ensureFounderBadgeDef (dryRun) upserter intet", async () => {
  const { supabase, calls } = makeMock();
  await ensureFounderBadgeDef(supabase, { dryRun: true });
  assert.equal(calls.upserts.length, 0);
});

test("grantFounderBadges tildeler kun managers uden badge; dryRun skriver intet", async () => {
  // u1 mangler, u2 har allerede badgen
  const existing = [{ user_id: "u2" }];
  const dry = makeMock({ existingGrants: existing });
  const dryRes = await grantFounderBadges(dry.supabase, { dryRun: true, managerUserIds: ["u1", "u2"] });
  assert.equal(dryRes.wouldGrant, 1);
  assert.equal(dry.calls.inserts.length, 0);

  const app = makeMock({ existingGrants: existing });
  const appRes = await grantFounderBadges(app.supabase, { dryRun: false, managerUserIds: ["u1", "u2"], now: "2026-06-20T00:00:00Z" });
  assert.equal(appRes.granted, 1);
  assert.equal(app.calls.inserts.length, 1);
  assert.deepEqual(app.calls.inserts[0].rows, [
    { user_id: "u1", achievement_id: FOUNDER_BADGE_KEY, unlocked_at: "2026-06-20T00:00:00Z" },
  ]);
  // grant sikrer også def'en
  assert.equal(app.calls.upserts.length, 1);
});

test("grantFounderBadges er idempotent (alle har badgen → 0 grants)", async () => {
  const m = makeMock({ existingGrants: [{ user_id: "u1" }] });
  const res = await grantFounderBadges(m.supabase, { dryRun: false, managerUserIds: ["u1"] });
  assert.equal(res.granted, 0);
  assert.equal(m.calls.inserts.length, 0);
});
