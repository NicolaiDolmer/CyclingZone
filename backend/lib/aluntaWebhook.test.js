import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import express from "express";
import { createTestDb } from "./testdb/createTestDb.js";
import { handleAluntaWebhook } from "./aluntaWebhook.js";

const SCHEMA_FILES = ["schema.sql", "2026-06-26-cz-pro-subscriptions.sql"];

// Minimal supabase-lignende adapter oven på PGlite — kun .from(t).upsert(row).
function pgliteSupabase(db) {
  return {
    from(table) {
      return {
        upsert: async (row) => {
          await db.query(
            `INSERT INTO public.${table}
               (team_id, status, plan_interval, alunta_customer_id, alunta_subscription_id, current_period_end, is_founder, last_event_id, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
             ON CONFLICT (team_id) DO UPDATE SET
               status=EXCLUDED.status, plan_interval=EXCLUDED.plan_interval,
               alunta_customer_id=EXCLUDED.alunta_customer_id, alunta_subscription_id=EXCLUDED.alunta_subscription_id,
               current_period_end=EXCLUDED.current_period_end, is_founder=EXCLUDED.is_founder,
               last_event_id=EXCLUDED.last_event_id, updated_at=now()`,
            [row.team_id, row.status, row.plan_interval, row.alunta_customer_id, row.alunta_subscription_id, row.current_period_end, row.is_founder ?? false, row.last_event_id],
          );
          return { error: null };
        },
      };
    },
  };
}

let db;
before(async () => {
  db = await createTestDb({ files: SCHEMA_FILES });
  await db.query("INSERT INTO public.teams (id, name) VALUES ('00000000-0000-0000-0000-000000000009','W') ON CONFLICT DO NOTHING");
});
after(async () => { if (db) await db.close(); });

async function withServer(fn) {
  const app = express();
  const supabase = pgliteSupabase(db);
  app.post("/api/billing/alunta-webhook", express.raw({ type: "*/*" }), async (req, res) => {
    await handleAluntaWebhook({ req, res, supabase, secret: "shh" });
  });
  const server = http.createServer(app);
  server.listen(0); await once(server, "listening");
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { server.close(); await once(server, "close"); }
}

test("checkout.completed med korrekt secret flipper subscription til active", async () => {
  await withServer(async (base) => {
    const payload = {
      event: "checkout.completed",
      data: {
        external_customer_id: "00000000-0000-0000-0000-000000000009",
        subscription_uuid: "sub_1", customer_uuid: "cus_1", plan_interval: "monthly",
        current_period_end: new Date(Date.now() + 30 * 864e5).toISOString(),
      },
      timestamp: "2026-06-26T10:00:00Z", test_mode: true,
    };
    const res = await fetch(`${base}/api/billing/alunta-webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Alunta-Secret": "shh" },
      body: JSON.stringify(payload),
    });
    assert.equal(res.status, 200);
    const { rows } = await db.query("SELECT status FROM public.subscriptions WHERE team_id=$1", ["00000000-0000-0000-0000-000000000009"]);
    assert.equal(rows[0].status, "active");
  });
});

test("forkert secret afvises 401", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/billing/alunta-webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Alunta-Secret": "wrong" },
      body: JSON.stringify({ event: "checkout.completed", data: {} }),
    });
    assert.equal(res.status, 401);
  });
});

test("subscription.cancelled sætter status=cancelled (æret indtil periodeudløb)", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/billing/alunta-webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Alunta-Secret": "shh" },
      body: JSON.stringify({ event: "subscription.cancelled", data: { external_customer_id: "00000000-0000-0000-0000-000000000009", current_period_end: new Date(Date.now() + 5 * 864e5).toISOString() } }),
    });
    assert.equal(res.status, 200);
    const { rows } = await db.query("SELECT status FROM public.subscriptions WHERE team_id=$1", ["00000000-0000-0000-0000-000000000009"]);
    assert.equal(rows[0].status, "cancelled");
  });
});
