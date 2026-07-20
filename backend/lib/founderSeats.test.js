import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "./testdb/createTestDb.js";
import { getFounderSeats, FOUNDER_SEAT_CAP } from "./founderSeats.js";

const SCHEMA_FILES = ["schema.sql", "2026-06-26-cz-pro-subscriptions.sql"];

// Samme minimale count-adapter som aluntaWebhook.test.js — kun det udsnit
// getFounderSeats rent faktisk bruger: .from(t).select(cols,{count}).eq(...),
// awaitable direkte (ligesom den ægte supabase-js query builder).
function pgliteCountSupabase(db) {
  return {
    from(table) {
      return {
        select(_cols, opts) {
          const filters = {};
          const builder = {
            eq(col, val) {
              filters[col] = val;
              return builder;
            },
            then(resolve, reject) {
              (async () => {
                try {
                  const cols = Object.keys(filters);
                  const where = cols.length ? cols.map((c, i) => `${c}=$${i + 1}`).join(" AND ") : "TRUE";
                  const values = cols.map((c) => filters[c]);
                  const { rows } = await db.query(`SELECT COUNT(*)::int AS count FROM public.${table} WHERE ${where}`, values);
                  resolve({ count: rows[0]?.count ?? 0, error: null, _opts: opts });
                } catch (e) { reject(e); }
              })();
            },
          };
          return builder;
        },
      };
    },
  };
}

let db;
before(async () => { db = await createTestDb({ files: SCHEMA_FILES }); });
after(async () => { if (db) await db.close(); });

test("getFounderSeats returnerer {taken:0, cap:50} på et tomt skema", async () => {
  const seats = await getFounderSeats(pgliteCountSupabase(db));
  assert.deepEqual(seats, { taken: 0, cap: FOUNDER_SEAT_CAP });
});

test("getFounderSeats tæller kun rækker med is_founder=true", async () => {
  const { rows: [{ id: founderTeam }] } = await db.query("INSERT INTO public.teams (name) VALUES ('FounderTeam') RETURNING id");
  const { rows: [{ id: proTeam }] } = await db.query("INSERT INTO public.teams (name) VALUES ('ProTeam') RETURNING id");
  await db.query("INSERT INTO public.subscriptions (team_id, status, is_founder, current_period_end) VALUES ($1, 'active', true, now() + interval '30 days')", [founderTeam]);
  await db.query("INSERT INTO public.subscriptions (team_id, status, is_founder, current_period_end) VALUES ($1, 'active', false, now() + interval '30 days')", [proTeam]);

  const seats = await getFounderSeats(pgliteCountSupabase(db));
  assert.equal(seats.taken, 1);
  assert.equal(seats.cap, FOUNDER_SEAT_CAP);
});

test("getFounderSeats kaster videre når query-builderen resolver med en fejl", async () => {
  // Ægte supabase-js resolver ALTID promiset (aldrig raw reject) — fejlen ligger i
  // { data, error }. getFounderSeats skal selv kaste den videre (if (error) throw).
  const failingSupabase = {
    from() {
      return {
        select() {
          return {
            eq() { return this; },
            then(resolve) { resolve({ count: null, error: new Error("boom") }); },
          };
        },
      };
    },
  };
  await assert.rejects(() => getFounderSeats(failingSupabase), /boom/);
});
