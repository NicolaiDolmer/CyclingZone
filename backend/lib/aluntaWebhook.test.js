import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createHmac } from "node:crypto";
import http from "node:http";
import express from "express";
import { createTestDb } from "./testdb/createTestDb.js";
import { handleAluntaWebhook } from "./aluntaWebhook.js";
import { FOUNDER_SEAT_CAP } from "./founderSeats.js";

const SCHEMA_FILES = ["schema.sql", "2026-06-26-cz-pro-subscriptions.sql"];

// Minimal supabase-lignende adapter oven på PGlite. Understøtter det udsnit
// af query-builderen webhook-handleren + founderSeats.js rent faktisk bruger:
// .from(t).select(cols, {count}).eq(...).maybeSingle() (awaitable direkte,
// ligesom den ægte supabase-js query builder) og .from(t).upsert(row).
class SelectQuery {
  constructor(db, table, opts) {
    this.db = db;
    this.table = table;
    this.opts = opts;
    this.filters = {};
    this.single = false;
  }
  eq(col, val) {
    this.filters[col] = val;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  async _run() {
    const cols = Object.keys(this.filters);
    const where = cols.length ? cols.map((c, i) => `${c}=$${i + 1}`).join(" AND ") : "TRUE";
    const values = cols.map((c) => this.filters[c]);
    if (this.opts?.count) {
      const { rows } = await this.db.query(`SELECT COUNT(*)::int AS count FROM public.${this.table} WHERE ${where}`, values);
      return { data: null, count: rows[0]?.count ?? 0, error: null };
    }
    const { rows } = await this.db.query(`SELECT * FROM public.${this.table} WHERE ${where}`, values);
    if (this.single) return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }
  then(resolve, reject) {
    this._run().then(resolve, reject);
  }
}

function pgliteSupabase(db) {
  return {
    from(table) {
      return {
        select(_cols, opts) {
          return new SelectQuery(db, table, opts);
        },
        // Dynamisk kolonneliste (kun keys der rent faktisk er i row), ligesom ægte
        // supabase-js upsert — en udeladt kolonne (fx is_founder ved cancel) rører
        // derfor IKKE den eksisterende værdi.
        upsert: async (row) => {
          const cols = Object.keys(row);
          const colList = cols.join(", ");
          const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
          const values = cols.map((c) => row[c]);
          const updateSet = cols.filter((c) => c !== "team_id").map((c) => `${c}=EXCLUDED.${c}`).join(", ");
          await db.query(
            `INSERT INTO public.${table} (${colList}, updated_at)
             VALUES (${placeholders}, now())
             ON CONFLICT (team_id) DO UPDATE SET ${updateSet}, updated_at=now()`,
            values,
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

// Signerer som Alunta: HMAC-SHA256 over den rå JSON-body i `Signature`-headeren.
function fireWebhook(base, payload, secret = "shh", { signatureOverride } = {}) {
  const body = JSON.stringify(payload);
  const signature = signatureOverride ?? createHmac("sha256", secret).update(body, "utf8").digest("hex");
  return fetch(`${base}/api/billing/alunta-webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Signature: signature },
    body,
  });
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
    const res = await fireWebhook(base, payload);
    assert.equal(res.status, 200);
    const { rows } = await db.query("SELECT status FROM public.subscriptions WHERE team_id=$1", ["00000000-0000-0000-0000-000000000009"]);
    assert.equal(rows[0].status, "active");
  });
});

test("signatur med forkert secret afvises 401", async () => {
  await withServer(async (base) => {
    const res = await fireWebhook(base, { event: "checkout.completed", data: {} }, "wrong");
    assert.equal(res.status, 401);
  });
});

test("manglende Signature-header afvises 401", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/billing/alunta-webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "checkout.completed", data: {} }),
    });
    assert.equal(res.status, 401);
  });
});

test("manipuleret body (gyldig signatur over ANDEN payload) afvises 401", async () => {
  await withServer(async (base) => {
    const otherSignature = createHmac("sha256", "shh").update(JSON.stringify({ event: "x" }), "utf8").digest("hex");
    const res = await fireWebhook(base, { event: "checkout.completed", data: {} }, "shh", { signatureOverride: otherSignature });
    assert.equal(res.status, 401);
  });
});

test("subscription.cancelled sætter status=cancelled (æret indtil periodeudløb)", async () => {
  await withServer(async (base) => {
    const res = await fireWebhook(base, {
      event: "subscription.cancelled",
      data: { external_customer_id: "00000000-0000-0000-0000-000000000009", current_period_end: new Date(Date.now() + 5 * 864e5).toISOString() },
    });
    assert.equal(res.status, 200);
    const { rows } = await db.query("SELECT status FROM public.subscriptions WHERE team_id=$1", ["00000000-0000-0000-0000-000000000009"]);
    assert.equal(rows[0].status, "cancelled");
  });
});

// ── Founder-derivation (#1903) ────────────────────────────────────────────────

test("checkout.completed under sæde-loftet sætter is_founder=true (server-afledt)", async () => {
  await withServer(async (base) => {
    const teamId = "00000000-0000-0000-0000-000000000010";
    await db.query("INSERT INTO public.teams (id, name) VALUES ($1,'Founder1') ON CONFLICT DO NOTHING", [teamId]);
    const res = await fireWebhook(base, {
      event: "checkout.completed",
      data: {
        external_customer_id: teamId,
        subscription_uuid: "sub_founder1", customer_uuid: "cus_founder1", plan_interval: "monthly",
        current_period_end: new Date(Date.now() + 30 * 864e5).toISOString(),
        is_founder: false, // payload-værdien skal IGNORERES — status er server-afledt
      },
    });
    assert.equal(res.status, 200);
    const { rows } = await db.query("SELECT is_founder FROM public.subscriptions WHERE team_id=$1", [teamId]);
    assert.equal(rows[0].is_founder, true);
  });
});

test("gentaget (re-fired) webhook er idempotent — bevarer eksisterende founder=true", async () => {
  await withServer(async (base) => {
    const teamId = "00000000-0000-0000-0000-000000000011";
    await db.query("INSERT INTO public.teams (id, name) VALUES ($1,'Founder2') ON CONFLICT DO NOTHING", [teamId]);
    const payload = {
      event: "checkout.completed",
      data: {
        external_customer_id: teamId,
        subscription_uuid: "sub_founder2", customer_uuid: "cus_founder2", plan_interval: "monthly",
        current_period_end: new Date(Date.now() + 30 * 864e5).toISOString(),
      },
    };
    const first = await fireWebhook(base, payload);
    assert.equal(first.status, 200);
    const second = await fireWebhook(base, payload); // Alunta-retry: samme event igen
    assert.equal(second.status, 200);
    const { rows } = await db.query("SELECT is_founder, status FROM public.subscriptions WHERE team_id=$1", [teamId]);
    assert.equal(rows[0].is_founder, true);
    assert.equal(rows[0].status, "active");
  });
});

test("subscription.cancelled fjerner ALDRIG et allerede optjent is_founder", async () => {
  await withServer(async (base) => {
    const teamId = "00000000-0000-0000-0000-000000000010"; // allerede founder fra test ovenfor
    const res = await fireWebhook(base, {
      event: "subscription.cancelled",
      data: { external_customer_id: teamId, current_period_end: new Date(Date.now() + 5 * 864e5).toISOString() },
    });
    assert.equal(res.status, 200);
    const { rows } = await db.query("SELECT status, is_founder FROM public.subscriptions WHERE team_id=$1", [teamId]);
    assert.equal(rows[0].status, "cancelled");
    assert.equal(rows[0].is_founder, true);
  });
});

test("checkout.completed ved sæde-cap sætter is_founder=false for ny abonnent", async () => {
  await withServer(async (base) => {
    // Top op til præcis FOUNDER_SEAT_CAP optjente founder-sæder, uafhængigt af
    // hvor mange tidligere tests i denne fil allerede har optjent.
    const { rows: [{ count }] } = await db.query("SELECT COUNT(*)::int AS count FROM public.subscriptions WHERE is_founder = true");
    const toSeed = FOUNDER_SEAT_CAP - count;
    for (let i = 0; i < toSeed; i++) {
      const { rows: [{ id: seedTeamId }] } = await db.query("INSERT INTO public.teams (name) VALUES ($1) RETURNING id", [`seed-${i}`]);
      await db.query(
        `INSERT INTO public.subscriptions (team_id, status, is_founder, current_period_end)
         VALUES ($1, 'active', true, now() + interval '30 days')`,
        [seedTeamId],
      );
    }

    const { rows: [{ id: newTeamId }] } = await db.query("INSERT INTO public.teams (name) VALUES ($1) RETURNING id", ["overflow"]);
    const res = await fireWebhook(base, {
      event: "checkout.completed",
      data: {
        external_customer_id: newTeamId,
        subscription_uuid: "sub_overflow", customer_uuid: "cus_overflow", plan_interval: "monthly",
        current_period_end: new Date(Date.now() + 30 * 864e5).toISOString(),
      },
    });
    assert.equal(res.status, 200);
    const { rows } = await db.query("SELECT status, is_founder FROM public.subscriptions WHERE team_id=$1", [newTeamId]);
    assert.equal(rows[0].status, "active"); // stadig fuld Pro
    assert.equal(rows[0].is_founder, false);
  });
});
