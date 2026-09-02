import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createHmac } from "node:crypto";
import http from "node:http";
import express from "express";
import { createTestDb } from "./testdb/createTestDb.js";
import { handleAluntaWebhook } from "./aluntaWebhook.js";
import { FOUNDER_SEAT_CAP } from "./founderSeats.js";

const SCHEMA_FILES = [
  "schema.sql",
  "2026-06-26-cz-pro-subscriptions.sql",
  "2026-08-06-alunta-subscriptions-last-event-at.sql",
  "2026-05-11-player-events.sql", // #4646 — checkout_completed skrives hertil
];

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
        // #4646: plain INSERT (ikke upsert) til player_events-testene. Kaster
        // ALDRIG (supabase-js-mønster: fejl kommer tilbage som {error}, se
        // lint-dropped-supabase-error.mjs's filhoved), så en FK-/constraint-
        // fejl (fx user_id-lookup der fejler i en test uden auth.users-række)
        // rammer captureExceptionFn i stedet for at vælte serveren.
        insert: async (row) => {
          try {
            const cols = Object.keys(row);
            const colList = cols.join(", ");
            const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
            const values = cols.map((c) => (row[c] && typeof row[c] === "object" ? JSON.stringify(row[c]) : row[c]));
            await db.query(`INSERT INTO public.${table} (${colList}) VALUES (${placeholders})`, values);
            return { error: null };
          } catch (err) {
            return { error: { message: err.message } };
          }
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

// #2817: `handlerOpts` lader tests injicere `captureExceptionFn` (spy) og/eller
// tvinge en upsert-fejl for én tabel (`failUpsertForTable`), uden at røre nogen
// af de eksisterende kald (bagudkompatibelt — begge felter er optional).
async function withServer(fn, handlerOpts = {}) {
  const { captureExceptionFn, failUpsertForTable, ...restHandlerOpts } = handlerOpts;
  const app = express();
  const supabase = pgliteSupabase(db);
  if (failUpsertForTable) {
    const originalFrom = supabase.from.bind(supabase);
    supabase.from = (table) => {
      const base = originalFrom(table);
      if (table !== failUpsertForTable) return base;
      return {
        ...base,
        // Simulerer en Postgres/PostgREST-fejl, ikke en JS-throw — supabase-js
        // returnerer altid { data, error }, kaster aldrig (se lint-dropped-
        // supabase-error.mjs's filhoved-kommentar).
        upsert: async () => ({ error: { message: "simuleret upsert-fejl (#2817-test)", code: "23505" } }),
      };
    };
  }
  app.post("/api/billing/alunta-webhook", express.raw({ type: "*/*" }), async (req, res) => {
    await handleAluntaWebhook({ req, res, supabase, secret: "shh", captureExceptionFn, ...restHandlerOpts });
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

// #4541: Alunta sender plan_interval som TAL (måneder pr. periode). Rå '6' må
// aldrig lande i DB'en — LTV-estimat og admin-UI forventer 'semiannual'.
test("plan_interval som tal (6) normaliseres til 'semiannual' før upsert (#4541)", async () => {
  await withServer(async (base) => {
    const payload = {
      event: "subscription.started",
      data: {
        external_customer_id: "00000000-0000-0000-0000-000000000009",
        subscription_uuid: "sub_1", customer_uuid: "cus_1", plan_interval: 6,
        current_period_end: new Date(Date.now() + 180 * 864e5).toISOString(),
      },
      timestamp: "2026-09-02T10:05:54Z", test_mode: true,
    };
    const res = await fireWebhook(base, payload);
    assert.equal(res.status, 200);
    const { rows } = await db.query("SELECT plan_interval FROM public.subscriptions WHERE team_id=$1", ["00000000-0000-0000-0000-000000000009"]);
    assert.equal(rows[0].plan_interval, "semiannual");
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

// ── Fornyelses-/udløbs-events (#2736 — invoice.paid findes ikke hos Alunta) ──

test("invoice.paid genkendes IKKE længere — ingen række oprettes", async () => {
  await withServer(async (base) => {
    const teamId = "00000000-0000-0000-0000-000000000020";
    await db.query("INSERT INTO public.teams (id, name) VALUES ($1,'InvoicePaidGhost') ON CONFLICT DO NOTHING", [teamId]);
    const res = await fireWebhook(base, {
      event: "invoice.paid",
      data: { external_customer_id: teamId, current_period_end: new Date(Date.now() + 30 * 864e5).toISOString() },
    });
    assert.equal(res.status, 200); // roligt ignoreret, ikke en fejl (undgår Alunta-retry)
    const { rows } = await db.query("SELECT * FROM public.subscriptions WHERE team_id=$1", [teamId]);
    assert.equal(rows.length, 0);
  });
});

test("invoice.created og customer.* ignoreres roligt (200, ingen skrivning)", async () => {
  await withServer(async (base) => {
    const teamId = "00000000-0000-0000-0000-000000000021";
    await db.query("INSERT INTO public.teams (id, name) VALUES ($1,'IgnoredEvents') ON CONFLICT DO NOTHING", [teamId]);
    for (const event of ["invoice.created", "customer.updated"]) {
      const res = await fireWebhook(base, { event, data: { external_customer_id: teamId } });
      assert.equal(res.status, 200);
    }
    const { rows } = await db.query("SELECT * FROM public.subscriptions WHERE team_id=$1", [teamId]);
    assert.equal(rows.length, 0);
  });
});

test("subscription.started sætter status=active + current_period_end, uden at claime founder-sæde", async () => {
  await withServer(async (base) => {
    const teamId = "00000000-0000-0000-0000-000000000022";
    await db.query("INSERT INTO public.teams (id, name) VALUES ($1,'Started') ON CONFLICT DO NOTHING", [teamId]);
    const periodEnd = new Date(Date.now() + 30 * 864e5).toISOString();
    const res = await fireWebhook(base, {
      event: "subscription.started",
      data: {
        external_customer_id: teamId,
        subscription_uuid: "sub_started", customer_uuid: "cus_started",
        plan_interval: "monthly", current_period_end: periodEnd,
      },
    });
    assert.equal(res.status, 200);
    const { rows } = await db.query("SELECT status, current_period_end, is_founder FROM public.subscriptions WHERE team_id=$1", [teamId]);
    assert.equal(rows[0].status, "active");
    assert.equal(new Date(rows[0].current_period_end).toISOString(), periodEnd);
    // Renewal-events må ALDRIG claime nye founder-sæder, selv under sæde-loftet.
    assert.equal(rows[0].is_founder, false);
  });
});

test("subscription.resumed sætter status=active, uden at claime founder-sæde", async () => {
  await withServer(async (base) => {
    const teamId = "00000000-0000-0000-0000-000000000023";
    await db.query("INSERT INTO public.teams (id, name) VALUES ($1,'Resumed') ON CONFLICT DO NOTHING", [teamId]);
    const res = await fireWebhook(base, {
      event: "subscription.resumed",
      data: {
        external_customer_id: teamId, subscription_uuid: "sub_resumed", customer_uuid: "cus_resumed",
        plan_interval: "monthly", current_period_end: new Date(Date.now() + 30 * 864e5).toISOString(),
      },
    });
    assert.equal(res.status, 200);
    const { rows } = await db.query("SELECT status, is_founder FROM public.subscriptions WHERE team_id=$1", [teamId]);
    assert.equal(rows[0].status, "active");
    assert.equal(rows[0].is_founder, false);
  });
});

test("subscription.payment_failed saetter status=past_due og bevarer eksisterende current_period_end", async () => {
  await withServer(async (base) => {
    const teamId = "00000000-0000-0000-0000-000000000024";
    await db.query("INSERT INTO public.teams (id, name) VALUES ($1,'PaymentFailed') ON CONFLICT DO NOTHING", [teamId]);
    const periodEnd = new Date(Date.now() + 10 * 864e5).toISOString();
    // Forudgående aktiv periode (fx fra checkout.completed).
    await fireWebhook(base, {
      event: "checkout.completed",
      data: {
        external_customer_id: teamId, subscription_uuid: "sub_pf", customer_uuid: "cus_pf",
        plan_interval: "monthly", current_period_end: periodEnd,
      },
    });
    // Founder-status sat direkte (uafhaengigt af det globale saede-loft, som
    // tidligere tests i denne fil allerede har fyldt op) — testen handler om
    // at payment_failed BEVARER en eksisterende founder-status, ikke om
    // hvordan den blev optjent.
    await db.query("UPDATE public.subscriptions SET is_founder=true WHERE team_id=$1", [teamId]);
    // payment_failed-payloaden bærer IKKE current_period_end (lean payload) — skal bevares, ikke nulles.
    const res = await fireWebhook(base, {
      event: "subscription.payment_failed",
      data: { external_customer_id: teamId },
    });
    assert.equal(res.status, 200);
    const { rows } = await db.query("SELECT status, current_period_end, is_founder FROM public.subscriptions WHERE team_id=$1", [teamId]);
    assert.equal(rows[0].status, "past_due");
    assert.equal(new Date(rows[0].current_period_end).toISOString(), periodEnd); // bevaret, ikke nullet
    assert.equal(rows[0].is_founder, true); // fra checkout.completed — payment_failed roerer den aldrig
  });
});

test("subscription.ended saetter status=inactive (matcher reconcilens INACTIVE_ALIASES)", async () => {
  await withServer(async (base) => {
    const teamId = "00000000-0000-0000-0000-000000000025";
    await db.query("INSERT INTO public.teams (id, name) VALUES ($1,'Ended') ON CONFLICT DO NOTHING", [teamId]);
    await fireWebhook(base, {
      event: "checkout.completed",
      data: {
        external_customer_id: teamId, subscription_uuid: "sub_ended", customer_uuid: "cus_ended",
        plan_interval: "monthly", current_period_end: new Date(Date.now() + 30 * 864e5).toISOString(),
      },
    });
    // Founder-status sat direkte — se kommentar i payment_failed-testen ovenfor.
    await db.query("UPDATE public.subscriptions SET is_founder=true WHERE team_id=$1", [teamId]);
    const res = await fireWebhook(base, {
      event: "subscription.ended",
      data: { external_customer_id: teamId },
    });
    assert.equal(res.status, 200);
    const { rows } = await db.query("SELECT status, is_founder FROM public.subscriptions WHERE team_id=$1", [teamId]);
    assert.equal(rows[0].status, "inactive");
    assert.equal(rows[0].is_founder, true); // permanent, ended roerer den aldrig
  });
});

test("subscription.tier_changed opdaterer KUN plan_interval, roerer aldrig status", async () => {
  await withServer(async (base) => {
    const teamId = "00000000-0000-0000-0000-000000000026";
    await db.query("INSERT INTO public.teams (id, name) VALUES ($1,'TierChanged') ON CONFLICT DO NOTHING", [teamId]);
    await fireWebhook(base, {
      event: "checkout.completed",
      data: {
        external_customer_id: teamId, subscription_uuid: "sub_tier", customer_uuid: "cus_tier",
        plan_interval: "monthly", current_period_end: new Date(Date.now() + 30 * 864e5).toISOString(),
      },
    });
    const res = await fireWebhook(base, {
      event: "subscription.tier_changed",
      data: { external_customer_id: teamId, plan_interval: "semiannual" },
    });
    assert.equal(res.status, 200);
    const { rows } = await db.query("SELECT status, plan_interval FROM public.subscriptions WHERE team_id=$1", [teamId]);
    assert.equal(rows[0].status, "active"); // uaendret
    assert.equal(rows[0].plan_interval, "semiannual");
  });
});

test("subscription.tier_changed uden plan_interval i payload er en no-op", async () => {
  await withServer(async (base) => {
    const teamId = "00000000-0000-0000-0000-000000000027";
    await db.query("INSERT INTO public.teams (id, name) VALUES ($1,'TierChangedNoop') ON CONFLICT DO NOTHING", [teamId]);
    await fireWebhook(base, {
      event: "checkout.completed",
      data: {
        external_customer_id: teamId, subscription_uuid: "sub_tier2", customer_uuid: "cus_tier2",
        plan_interval: "monthly", current_period_end: new Date(Date.now() + 30 * 864e5).toISOString(),
      },
    });
    const res = await fireWebhook(base, {
      event: "subscription.tier_changed",
      data: { external_customer_id: teamId },
    });
    assert.equal(res.status, 200);
    const { rows } = await db.query("SELECT plan_interval FROM public.subscriptions WHERE team_id=$1", [teamId]);
    assert.equal(rows[0].plan_interval, "monthly"); // uaendret
  });
});

test("malformed JSON-body (gyldig signatur) afvises 400", async () => {
  await withServer(async (base) => {
    const body = "{ not valid json";
    const signature = createHmac("sha256", "shh").update(body, "utf8").digest("hex");
    const res = await fetch(`${base}/api/billing/alunta-webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Signature: signature },
      body,
    });
    assert.equal(res.status, 400);
  });
});

// ── Idempotens / replay (#2736) ───────────────────────────────────────────────

test("gentaget event (samme data.uuid) er en no-op — direkte DB-mutation overlever replay", async () => {
  await withServer(async (base) => {
    const teamId = "00000000-0000-0000-0000-000000000028";
    await db.query("INSERT INTO public.teams (id, name) VALUES ($1,'ReplayGuard') ON CONFLICT DO NOTHING", [teamId]);
    const payload = {
      event: "subscription.started",
      data: {
        external_customer_id: teamId, uuid: "evt_replay_1",
        subscription_uuid: "sub_replay", customer_uuid: "cus_replay",
        plan_interval: "monthly", current_period_end: new Date(Date.now() + 30 * 864e5).toISOString(),
      },
      timestamp: "2026-08-10T10:00:00Z",
    };
    const first = await fireWebhook(base, payload);
    assert.equal(first.status, 200);

    // Simulerer at raekken efterfoelgende blev aendret af noget andet (fx reconcile) —
    // hvis replay-guarden IKKE virker, vil re-fire af SAMME event overskrive dette igen.
    await db.query("UPDATE public.subscriptions SET plan_interval='sentinel' WHERE team_id=$1", [teamId]);

    const second = await fireWebhook(base, payload); // Alunta-retry: identisk event
    assert.equal(second.status, 200);

    const { rows } = await db.query("SELECT plan_interval FROM public.subscriptions WHERE team_id=$1", [teamId]);
    assert.equal(rows[0].plan_interval, "sentinel"); // uroert af replay'et
  });
});

test("out-of-order: aeldre subscription.cancelled ankommet EFTER nyere subscription.started ignoreres", async () => {
  await withServer(async (base) => {
    const teamId = "00000000-0000-0000-0000-000000000029";
    await db.query("INSERT INTO public.teams (id, name) VALUES ($1,'OutOfOrder') ON CONFLICT DO NOTHING", [teamId]);

    const newer = await fireWebhook(base, {
      event: "subscription.started",
      data: {
        external_customer_id: teamId, subscription_uuid: "sub_ooo", customer_uuid: "cus_ooo",
        plan_interval: "monthly", current_period_end: new Date(Date.now() + 30 * 864e5).toISOString(),
      },
      timestamp: "2026-08-10T12:00:00Z", // nyere
    });
    assert.equal(newer.status, 200);

    // Denne cancelled-begivenhed er aeldre (fx forsinket i transit) end started ovenfor.
    const older = await fireWebhook(base, {
      event: "subscription.cancelled",
      data: { external_customer_id: teamId, current_period_end: new Date(Date.now() + 5 * 864e5).toISOString() },
      timestamp: "2026-08-10T11:00:00Z", // aeldre end den allerede-anvendte started
    });
    assert.equal(older.status, 200); // afvises roligt (200, ikke fejl — undgaar retry-storm)

    const { rows } = await db.query("SELECT status FROM public.subscriptions WHERE team_id=$1", [teamId]);
    assert.equal(rows[0].status, "active"); // IKKE regresseret til cancelled
  });
});

test("events uden timestamp faar stadig lov (fail-open) naar der ikke er en lagret last_event_at at sammenligne med", async () => {
  await withServer(async (base) => {
    const teamId = "00000000-0000-0000-0000-000000000030";
    await db.query("INSERT INTO public.teams (id, name) VALUES ($1,'NoTimestamp') ON CONFLICT DO NOTHING", [teamId]);
    const res = await fireWebhook(base, {
      event: "subscription.started",
      data: {
        external_customer_id: teamId, subscription_uuid: "sub_nots", customer_uuid: "cus_nots",
        plan_interval: "monthly", current_period_end: new Date(Date.now() + 30 * 864e5).toISOString(),
      },
      // intet top-level timestamp-felt
    });
    assert.equal(res.status, 200);
    const { rows } = await db.query("SELECT status FROM public.subscriptions WHERE team_id=$1", [teamId]);
    assert.equal(rows[0].status, "active");
  });
});

// ── #4648: nested Alunta-payload (data.customer.*, subscription.*-events' data.uuid) ──
// Rod-årsag: koden læste kun FLADE feltnavne. Aluntas ægte REST-kontrakt
// (BILLING_STACK.md §5) nester external_customer_id/customer-uuid under
// `data.customer`, og bruger `interval` (ikke `plan_interval`) + `uuid` (ikke
// `subscription_uuid`) på subscription.*-events. Se postmortem:
// .claude/learnings/2026-09-02-alunta-webhook-nested-external-customer-id.md

test("#4648: subscription.started med NESTED payload (data.customer.*, data.uuid, data.interval) opdaterer korrekt team", async () => {
  await withServer(async (base) => {
    const teamId = "00000000-0000-0000-0000-000000000050";
    await db.query("INSERT INTO public.teams (id, name) VALUES ($1,'NestedForm') ON CONFLICT DO NOTHING", [teamId]);
    const periodEnd = new Date(Date.now() + 180 * 864e5).toISOString();
    const res = await fireWebhook(base, {
      event: "subscription.started",
      data: {
        uuid: "sub_nested_1", // subscription.*-event -> tilladt fallback for subscription-id
        customer: { uuid: "cus_nested_1", external_customer_id: teamId },
        interval: 6, // Aluntas REST-feltnavn, TAL
        current_period_end: periodEnd,
      },
      timestamp: "2026-09-02T10:00:00Z",
    });
    assert.equal(res.status, 200);
    const { rows } = await db.query(
      "SELECT status, plan_interval, alunta_customer_id, alunta_subscription_id, current_period_end FROM public.subscriptions WHERE team_id=$1",
      [teamId],
    );
    assert.equal(rows[0].status, "active");
    assert.equal(rows[0].plan_interval, "semiannual");
    assert.equal(rows[0].alunta_customer_id, "cus_nested_1");
    assert.equal(rows[0].alunta_subscription_id, "sub_nested_1");
    assert.equal(new Date(rows[0].current_period_end).toISOString(), periodEnd);
  });
});

test("#4648: checkout.completed bruger ALDRIG data.uuid som subscription-id (checkout-session-id er ikke et abonnement)", async () => {
  await withServer(async (base) => {
    const teamId = "00000000-0000-0000-0000-000000000051";
    await db.query("INSERT INTO public.teams (id, name) VALUES ($1,'CheckoutUuidGuard') ON CONFLICT DO NOTHING", [teamId]);
    const res = await fireWebhook(base, {
      event: "checkout.completed",
      data: {
        uuid: "checkout_session_abc", // IKKE et abonnements-id — må ikke havne som alunta_subscription_id
        customer: { uuid: "cus_guard", external_customer_id: teamId },
        plan_interval: "monthly",
        current_period_end: new Date(Date.now() + 30 * 864e5).toISOString(),
      },
    });
    assert.equal(res.status, 200);
    const { rows } = await db.query("SELECT alunta_subscription_id, alunta_customer_id FROM public.subscriptions WHERE team_id=$1", [teamId]);
    assert.equal(rows[0].alunta_subscription_id, null);
    assert.equal(rows[0].alunta_customer_id, "cus_guard");
  });
});

test("#4648: flad external_customer_id vinder over nested customer.external_customer_id naar begge er sat", async () => {
  await withServer(async (base) => {
    const teamId = "00000000-0000-0000-0000-000000000052";
    await db.query("INSERT INTO public.teams (id, name) VALUES ($1,'FlatWins') ON CONFLICT DO NOTHING", [teamId]);
    const res = await fireWebhook(base, {
      event: "checkout.completed",
      data: {
        external_customer_id: teamId,
        customer: { external_customer_id: "99999999-9999-9999-9999-999999999999", uuid: "cus_flat" },
        subscription_uuid: "sub_flat", customer_uuid: "cus_flat_top",
        plan_interval: "monthly", current_period_end: new Date(Date.now() + 30 * 864e5).toISOString(),
      },
    });
    assert.equal(res.status, 200);
    const { rows } = await db.query("SELECT alunta_customer_id FROM public.subscriptions WHERE team_id=$1", [teamId]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].alunta_customer_id, "cus_flat_top"); // flad customer_uuid vandt over nested customer.uuid
  });
});

// ── #4646: checkout_completed player_events-funnel-event ────────────────────

test("#4646: checkout.completed skriver player_events 'checkout_completed' med plan_interval + currency", async () => {
  await withServer(async (base) => {
    // #4646-test-fixture: teams.user_id -> public.users(id) (schema.sql), mens
    // player_events.user_id -> auth.users(id) (2026-05-11-player-events.sql) —
    // to forskellige "users"-tabeller i PGlite-testskemaet (spejler prod, hvor
    // public.users mirror'er auth.users på SAMME id). Begge rækker skal
    // eksistere med samme id for at begge FK'er holder.
    const { rows: [{ id: userId }] } = await db.query("INSERT INTO auth.users DEFAULT VALUES RETURNING id");
    await db.query(
      "INSERT INTO public.users (id, email, username) VALUES ($1, 'pe-test@example.test', 'pe-test-user') ON CONFLICT DO NOTHING",
      [userId],
    );
    const teamId = "00000000-0000-0000-0000-000000000060";
    await db.query("INSERT INTO public.teams (id, name, user_id) VALUES ($1,'PlayerEventTeam',$2) ON CONFLICT DO NOTHING", [teamId, userId]);
    const res = await fireWebhook(base, {
      event: "checkout.completed",
      data: {
        external_customer_id: teamId, subscription_uuid: "sub_pe", customer_uuid: "cus_pe",
        plan_interval: "monthly", current_period_end: new Date(Date.now() + 30 * 864e5).toISOString(),
        currency: "DKK",
      },
    });
    assert.equal(res.status, 200);
    const { rows } = await db.query(
      "SELECT event_name, team_id, user_id, event_data FROM public.player_events WHERE team_id=$1 AND event_name='checkout_completed'",
      [teamId],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, userId);
    assert.deepEqual(rows[0].event_data, { plan_interval: "monthly", currency: "DKK" });
  });
});

test("#4646: checkout.completed for et hold uden user_id (ingen auth-bruger) springer player_events-skrivning stille over", async () => {
  await withServer(async (base) => {
    const teamId = "00000000-0000-0000-0000-000000000061";
    await db.query("INSERT INTO public.teams (id, name) VALUES ($1,'NoUserTeam') ON CONFLICT DO NOTHING", [teamId]); // user_id NULL
    const res = await fireWebhook(base, {
      event: "checkout.completed",
      data: {
        external_customer_id: teamId, subscription_uuid: "sub_nu", customer_uuid: "cus_nu",
        plan_interval: "monthly", current_period_end: new Date(Date.now() + 30 * 864e5).toISOString(),
      },
    });
    assert.equal(res.status, 200); // stadig 200 — player_events er sidegevinst, ikke betalings-kritisk
    const { rows } = await db.query("SELECT * FROM public.player_events WHERE team_id=$1", [teamId]);
    assert.equal(rows.length, 0);
    const { rows: subRows } = await db.query("SELECT status FROM public.subscriptions WHERE team_id=$1", [teamId]);
    assert.equal(subRows[0].status, "active"); // hovedflowet upåvirket
  });
});

// ── #4648: scopet reconcile-for-team fire-and-forget efter checkout.completed ──

test("#4648: checkout.completed kalder reconcileForTeamFn naar en Alunta-klient er injiceret", async () => {
  const calls = [];
  const teamId = "00000000-0000-0000-0000-000000000053";
  await db.query("INSERT INTO public.teams (id, name) VALUES ($1,'ReconcileTrigger') ON CONFLICT DO NOTHING", [teamId]);
  const fakeClient = { listSubscriptions: async () => ({ data: [] }) };
  const reconcileForTeamFn = async (args) => { calls.push(args); return { ran: true, applied: false }; };
  await withServer(async (base) => {
    const res = await fireWebhook(base, {
      event: "checkout.completed",
      data: {
        external_customer_id: teamId, subscription_uuid: "sub_rt", customer_uuid: "cus_rt",
        plan_interval: "monthly", current_period_end: new Date(Date.now() + 30 * 864e5).toISOString(),
      },
    });
    assert.equal(res.status, 200);
  }, { client: fakeClient, reconcileForTeamFn });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].teamId, teamId);
  assert.equal(calls[0].client, fakeClient);
});

test("#4648: reconcileForTeamFn kaldes IKKE for andre events end checkout.completed", async () => {
  const calls = [];
  const teamId = "00000000-0000-0000-0000-000000000055";
  await db.query("INSERT INTO public.teams (id, name) VALUES ($1,'ReconcileOnlyCheckout') ON CONFLICT DO NOTHING", [teamId]);
  const fakeClient = { listSubscriptions: async () => ({ data: [] }) };
  const reconcileForTeamFn = async (args) => { calls.push(args); return { ran: true, applied: false }; };
  await withServer(async (base) => {
    const res = await fireWebhook(base, {
      event: "subscription.started",
      data: {
        external_customer_id: teamId, subscription_uuid: "sub_no_rt", customer_uuid: "cus_no_rt",
        plan_interval: "monthly", current_period_end: new Date(Date.now() + 30 * 864e5).toISOString(),
      },
    });
    assert.equal(res.status, 200);
  }, { client: fakeClient, reconcileForTeamFn });
  assert.equal(calls.length, 0);
});

test("#4648: fejl i reconcileForTeamFn fanges via captureExceptionFn og paavirker ikke 200-svaret", async () => {
  const captured = [];
  const teamId = "00000000-0000-0000-0000-000000000054";
  await db.query("INSERT INTO public.teams (id, name) VALUES ($1,'ReconcileFails') ON CONFLICT DO NOTHING", [teamId]);
  const fakeClient = { listSubscriptions: async () => ({ data: [] }) };
  const reconcileForTeamFn = async () => { throw new Error("boom-reconcile"); };
  await withServer(async (base) => {
    const res = await fireWebhook(base, {
      event: "checkout.completed",
      data: {
        external_customer_id: teamId, subscription_uuid: "sub_rf", customer_uuid: "cus_rf",
        plan_interval: "monthly", current_period_end: new Date(Date.now() + 30 * 864e5).toISOString(),
      },
    });
    assert.equal(res.status, 200);
  }, { client: fakeClient, reconcileForTeamFn, captureExceptionFn: (err, ctx) => captured.push({ err, ctx }) });
  assert.equal(captured.length, 1);
  assert.match(captured[0].err.message, /boom-reconcile/);
  assert.equal(captured[0].ctx.tags.stage, "webhook-reconcile-team");
  assert.equal(captured[0].ctx.teamId, teamId);
});

// ── Observability (#2817) — tavse fejl-exits skal logge/capture'e ────────────
// Rod-årsag: alle fejl-exits var før dette 100 % tavse (hverken console.warn,
// captureException eller Sentry). Testene her verificerer BÅDE at der nu logges/
// capture'es, OG (sikkerhedskravet) at det ALDRIG er payload/signatur/headers/
// secret der havner i loggen — kun ikke-følsomme felter som event-type/team-id.

test("#2817: ugyldig signatur logger via console.warn, uden at logge signatur/body", async (t) => {
  const warnCalls = [];
  t.mock.method(console, "warn", (...args) => { warnCalls.push(args); });
  await withServer(async (base) => {
    const res = await fireWebhook(base, { event: "checkout.completed", data: { secret_field: "should-never-leak" } }, "wrong-secret");
    assert.equal(res.status, 401);
  });
  assert.equal(warnCalls.length, 1);
  assert.equal(warnCalls[0].length, 1); // kun én statisk besked — intet data-argument der kunne bære payload/signatur
  assert.match(warnCalls[0][0], /signatur/i);
  assert.doesNotMatch(warnCalls[0][0], /should-never-leak|wrong-secret/);
});

test("#2817: malformed JSON-body logger via console.warn, uden at logge selve body'en", async (t) => {
  const warnCalls = [];
  t.mock.method(console, "warn", (...args) => { warnCalls.push(args); });
  await withServer(async (base) => {
    const body = "{ not valid json, super-secret-customer-data: 12345";
    const signature = createHmac("sha256", "shh").update(body, "utf8").digest("hex");
    const res = await fetch(`${base}/api/billing/alunta-webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Signature: signature },
      body,
    });
    assert.equal(res.status, 400);
  });
  assert.equal(warnCalls.length, 1);
  assert.equal(warnCalls[0].length, 1);
  assert.match(warnCalls[0][0], /pars/i);
  assert.doesNotMatch(warnCalls[0][0], /super-secret-customer-data/);
});

test("#2817: manglende event/team_id logger event-type + team-id (ikke-foelsomme felter)", async (t) => {
  const warnCalls = [];
  t.mock.method(console, "warn", (...args) => { warnCalls.push(args); });
  await withServer(async (base) => {
    const res = await fireWebhook(base, { event: "checkout.completed", data: {} }); // ingen external_customer_id
    assert.equal(res.status, 200);
  });
  assert.equal(warnCalls.length, 1);
  assert.match(warnCalls[0][0], /event|team/i);
  assert.deepEqual(warnCalls[0][1], { event: "checkout.completed", teamId: null });
});

test("#2817: ukendt event-type logger event-type + team-id", async (t) => {
  const warnCalls = [];
  t.mock.method(console, "warn", (...args) => { warnCalls.push(args); });
  const teamId = "00000000-0000-0000-0000-000000000041";
  await withServer(async (base) => {
    await db.query("INSERT INTO public.teams (id, name) VALUES ($1,'UnknownEvent') ON CONFLICT DO NOTHING", [teamId]);
    const res = await fireWebhook(base, { event: "some.unknown.event", data: { external_customer_id: teamId } });
    assert.equal(res.status, 200);
  });
  assert.equal(warnCalls.length, 1);
  assert.deepEqual(warnCalls[0][1], { event: "some.unknown.event", teamId });
});

test("#2817: DB-upsert-fejl paa hovedflowet (checkout.completed) trigger captureExceptionFn og returnerer 500", async () => {
  const captured = [];
  const teamId = "00000000-0000-0000-0000-000000000042";
  await db.query("INSERT INTO public.teams (id, name) VALUES ($1,'UpsertFailMain') ON CONFLICT DO NOTHING", [teamId]);
  await withServer(async (base) => {
    const res = await fireWebhook(base, {
      event: "checkout.completed",
      data: {
        external_customer_id: teamId, subscription_uuid: "sub_fail", customer_uuid: "cus_fail",
        plan_interval: "monthly", current_period_end: new Date(Date.now() + 30 * 864e5).toISOString(),
      },
    });
    assert.equal(res.status, 500); // Alunta retry'er
  }, {
    captureExceptionFn: (err, ctx) => captured.push({ err, ctx }),
    failUpsertForTable: "subscriptions",
  });
  assert.equal(captured.length, 1);
  assert.match(captured[0].err.message, /simuleret upsert-fejl/);
  assert.equal(captured[0].ctx.tags.flow, "billing");
  assert.equal(captured[0].ctx.tags.stage, "webhook-upsert");
  assert.equal(captured[0].ctx.teamId, teamId);
  assert.equal(captured[0].ctx.event, "checkout.completed");
});

test("#2817: DB-upsert-fejl paa tier_changed-flowet trigger captureExceptionFn og returnerer 500", async () => {
  const captured = [];
  const teamId = "00000000-0000-0000-0000-000000000043";
  await db.query("INSERT INTO public.teams (id, name) VALUES ($1,'UpsertFailTier') ON CONFLICT DO NOTHING", [teamId]);
  // Forudgaaende aktiv periode uden fejl-injektion, saa raekken findes til tier_changed-stien.
  await withServer(async (base) => {
    await fireWebhook(base, {
      event: "checkout.completed",
      data: {
        external_customer_id: teamId, subscription_uuid: "sub_tier_fail", customer_uuid: "cus_tier_fail",
        plan_interval: "monthly", current_period_end: new Date(Date.now() + 30 * 864e5).toISOString(),
      },
    });
  });
  await withServer(async (base) => {
    const res = await fireWebhook(base, {
      event: "subscription.tier_changed",
      data: { external_customer_id: teamId, plan_interval: "semiannual" },
    });
    assert.equal(res.status, 500);
  }, {
    captureExceptionFn: (err, ctx) => captured.push({ err, ctx }),
    failUpsertForTable: "subscriptions",
  });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].ctx.tags.stage, "webhook-upsert");
  assert.equal(captured[0].ctx.event, "subscription.tier_changed");
});
