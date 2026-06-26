# CZ Pro — Billing Rails (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lade et autentificeret team købe CZ Pro via Alunta hosted checkout, flippe `is_pro`-entitlement via webhook, og vise et Founder-badge — den mindste end-to-end-kæde der faktisk tager penge.

**Architecture:** Backend (Express) tilføjer et Alunta-klientmodul, en `subscriptions`-tabel (RLS: læs-egen, skriv kun service_role), en webhook der upserter entitlement, og en checkout-route. Frontend læser egen subscription (RLS-select) → `isPro` gater et Founder-badge + en `/pro`-opgraderingsside. Provider-agnostisk: entitlement bor i egen DB, Alunta-id'er er bare eksterne referencer.

**Tech Stack:** Node/Express, Supabase (Postgres+RLS), `@supabase/supabase-js` (service_role), React/Vite, react-i18next, `node --test` + PGlite-harness (`backend/lib/testdb`).

**Spec:** `docs/superpowers/specs/2026-06-26-cz-pro-monetization-design.md` (§6 værdideling, §7 priser, §9 arkitektur).

**Out of scope (senere slices):** kit/logo-designer, Pro-analytics, komfort-features, årlig plan, Alunta self-service Portal-side, e-mail-kvitteringer ud over Aluntas egne.

**Ejer-handlinger der gater LIVE-test (ikke build):**
1. Opret CZ Pro-plan i Alunta m. to renewal-intervaller (månedlig 49 / 6-mdr 265).
2. Generér Alunta API-token + webhook-secret → **Infisical** (`ALUNTA_API_TOKEN`, `ALUNTA_WEBHOOK_SECRET`, `ALUNTA_CZ_PRO_PLAN_ID_MONTHLY`, `ALUNTA_CZ_PRO_PLAN_ID_SEMIANNUAL`).

**Branch:** Brug en feature-branch/worktree (`feat/cz-pro-billing-rails`). PR'en indeholder `database/*.sql` → **ejer merger** (auto-applies i prod; hard rule).

---

### Task 1: `subscriptions`-migration + RLS

**Files:**
- Create: `database/2026-06-26-cz-pro-subscriptions.sql`
- Create: `backend/lib/subscriptionsSchema.test.js`

- [ ] **Step 1: Skriv migrationen**

```sql
-- CZ Pro billing rails (#<issue>) — entitlement-tabel for betalte abonnementer.
--
-- Datamodel:
--   - subscriptions: én række pr. team med aktivt/historisk Pro-abonnement.
--     Provider-agnostisk: alunta_* er eksterne referencer; sandheden om
--     adgang er status + current_period_end (= is_pro beregnes i koden).
--     RLS: en manager kan kun SELECTe sin EGEN række (via teams.user_id).
--     Writes sker KUN fra backend (service_role bypasser RLS) — ingen
--     INSERT/UPDATE-policy for authenticated.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS + DROP
-- POLICY IF EXISTS før CREATE. schema_migrations-insert håndteres af
-- .github/workflows/auto-migrate.yml.

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  alunta_customer_id text,
  alunta_subscription_id text,
  status text NOT NULL DEFAULT 'inactive',      -- active | cancelled | past_due | inactive
  plan_interval text,                            -- monthly | semiannual
  is_founder boolean NOT NULL DEFAULT false,
  current_period_end timestamptz,
  last_event_id text,                            -- idempotens-guard for webhooks
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Ét abonnement pr. team (upsert-nøgle).
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_team_id_key ON public.subscriptions(team_id);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subscriptions_select_own" ON public.subscriptions;
CREATE POLICY "subscriptions_select_own" ON public.subscriptions
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT id FROM public.teams WHERE user_id = (SELECT auth.uid())));

GRANT SELECT ON public.subscriptions TO authenticated;
```

- [ ] **Step 2: Skriv kolonne-kontrakt-testen (fejler først)**

Spejler `backend/lib/testdb/createTestDb.integration.test.js`. Loader de DDL-filer der definerer `teams` (FK-prerequisite) + den nye migration, og verificerer tabel + kolonner findes (fanger #1840-klassen før prod).

```javascript
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { createTestDb, columnExists } from "./testdb/createTestDb.js";

// Alle committede DDL-filer i kronologisk (filnavn-)rækkefølge, så teams +
// dens dependencies er på plads før subscriptions' FK.
const ALL_SQL = readdirSync(new URL("../../database/", import.meta.url))
  .filter((f) => /^\d{4}-\d{2}-\d{2}.*\.sql$/.test(f))
  .sort();

let db;
before(async () => { db = await createTestDb({ files: ALL_SQL }); });
after(async () => { if (db) await db.close(); });

test("subscriptions-tabellen findes efter migration", async () => {
  const { rows } = await db.query("SELECT to_regclass('public.subscriptions') AS reg");
  assert.ok(rows[0].reg, "public.subscriptions skal findes");
});

test("subscriptions HAR de kolonner entitlement-laget bruger", async () => {
  const required = [
    "id", "team_id", "alunta_customer_id", "alunta_subscription_id",
    "status", "plan_interval", "is_founder", "current_period_end",
    "last_event_id", "created_at", "updated_at",
  ];
  for (const col of required) {
    assert.ok(await columnExists(db, "subscriptions", col), `subscriptions.${col} skal findes`);
  }
});
```

- [ ] **Step 3: Kør testen — forventet FAIL**

Run: `cd backend && node --test --import ./test-setup.js lib/subscriptionsSchema.test.js`
Expected: FAIL ("public.subscriptions skal findes" — tabellen findes ikke endnu hvis harness-fil-listen ikke loader den / før migrationen er skrevet). Hvis migrationen allerede er skrevet i Step 1, verificér i stedet at testen RIGTIGT loader den nye fil (juster `ALL_SQL`-glob hvis nødvendigt).

- [ ] **Step 4: Kør testen — forventet PASS**

Run: `cd backend && node --test --import ./test-setup.js lib/subscriptionsSchema.test.js`
Expected: PASS (begge tests grønne).

> Hvis `createTestDb` ikke kan loade hele `database/`-sættet pga. en sanitizer-kant (fx en uventet konstruktion i en gammel fil), så indskrænk `files` til det minimale sæt der definerer `teams` + `subscriptions`, jf. `RACE_HUB_SCHEMA_FILES`-mønstret i `createTestDb.js`.

- [ ] **Step 5: Commit**

```bash
git add database/2026-06-26-cz-pro-subscriptions.sql backend/lib/subscriptionsSchema.test.js
git commit -m "feat(billing): subscriptions-tabel + RLS (læs-egen) + kolonne-kontrakt-test"
```

---

### Task 2: Alunta API-klient

**Files:**
- Create: `backend/lib/alunta.js`
- Create: `backend/lib/alunta.test.js`

- [ ] **Step 1: Skriv den fejlende test**

Testen injicerer en fake `fetch` for at verificere request-bygning uden netværk.

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { createAluntaClient } from "./alunta.js";

function fakeFetch(captured) {
  return async (url, opts) => {
    captured.url = url;
    captured.opts = opts;
    return { ok: true, status: 200, text: async () => JSON.stringify({ checkout_url: "https://app.alunta.com/checkout/abc", uuid: "cus_1" }) };
  };
}

test("createCheckoutSession POSTer external_customer_id + plan_id og returnerer checkout_url", async () => {
  const captured = {};
  const client = createAluntaClient({ token: "t", baseUrl: "https://app.alunta.com/api/v1", fetchImpl: fakeFetch(captured) });
  const url = await client.createCheckoutSession({ externalCustomerId: "team-1", planId: "plan-9", successUrl: "https://cz/ok", backUrl: "https://cz/pro" });
  assert.equal(url, "https://app.alunta.com/checkout/abc");
  assert.equal(captured.url, "https://app.alunta.com/api/v1/checkout-sessions");
  assert.equal(captured.opts.method, "POST");
  assert.match(captured.opts.headers.Authorization, /^Bearer t$/);
  const body = JSON.parse(captured.opts.body);
  assert.equal(body.external_customer_id, "team-1");
  assert.equal(body.plan_id, "plan-9");
});

test("ensureCustomer POSTer name + external_customer_id", async () => {
  const captured = {};
  const client = createAluntaClient({ token: "t", baseUrl: "https://app.alunta.com/api/v1", fetchImpl: fakeFetch(captured) });
  await client.ensureCustomer({ externalCustomerId: "team-1", name: "Lorraine", email: "a@b.dk" });
  assert.equal(captured.url, "https://app.alunta.com/api/v1/customers");
  const body = JSON.parse(captured.opts.body);
  assert.equal(body.external_customer_id, "team-1");
  assert.equal(body.name, "Lorraine");
});

test("non-2xx kaster med status + body", async () => {
  const client = createAluntaClient({ token: "t", baseUrl: "https://x/api/v1", fetchImpl: async () => ({ ok: false, status: 422, text: async () => "bad" }) });
  await assert.rejects(() => client.ensureCustomer({ externalCustomerId: "t", name: "n" }), /422.*bad/);
});
```

- [ ] **Step 2: Kør test — forventet FAIL**

Run: `cd backend && node --test --import ./test-setup.js lib/alunta.test.js`
Expected: FAIL ("Cannot find module './alunta.js'").

- [ ] **Step 3: Skriv klienten**

```javascript
// Alunta API-klient (provider-agnostisk wrapper). Verificeret mod OpenAPI v1
// 2026-06-26: base https://app.alunta.com/api/v1, Bearer-auth.
// Feltnavne (plan_id på checkout) bekræftes i test_mode før prod.

export function createAluntaClient({
  token = process.env.ALUNTA_API_TOKEN,
  baseUrl = process.env.ALUNTA_BASE ?? "https://app.alunta.com/api/v1",
  fetchImpl = fetch,
} = {}) {
  async function call(path, { method = "GET", body } = {}) {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Alunta ${method} ${path} -> ${res.status}: ${text}`);
    return text ? JSON.parse(text) : null;
  }

  return {
    ensureCustomer({ externalCustomerId, name, email }) {
      return call("/customers", {
        method: "POST",
        body: { name, email, external_customer_id: String(externalCustomerId) },
      });
    },
    async createCheckoutSession({ externalCustomerId, planId, successUrl, backUrl }) {
      const session = await call("/checkout-sessions", {
        method: "POST",
        body: {
          external_customer_id: String(externalCustomerId),
          plan_id: planId,
          success_url: successUrl,
          back_url: backUrl,
        },
      });
      return session.checkout_url;
    },
  };
}
```

- [ ] **Step 4: Kør test — forventet PASS**

Run: `cd backend && node --test --import ./test-setup.js lib/alunta.test.js`
Expected: PASS (3 tests grønne).

- [ ] **Step 5: Commit**

```bash
git add backend/lib/alunta.js backend/lib/alunta.test.js
git commit -m "feat(billing): Alunta API-klient (ensureCustomer + createCheckoutSession) m. fake-fetch tests"
```

---

### Task 3: Entitlement-helper (`isPro`)

**Files:**
- Create: `backend/lib/entitlement.js`
- Create: `backend/lib/entitlement.test.js`

- [ ] **Step 1: Skriv den fejlende test (mod PGlite + ægte subscriptions-DDL)**

```javascript
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { createTestDb } from "./testdb/createTestDb.js";
import { computeIsPro, SUBSCRIPTION_ACTIVE_STATUSES } from "./entitlement.js";

const ALL_SQL = readdirSync(new URL("../../database/", import.meta.url))
  .filter((f) => /^\d{4}-\d{2}-\d{2}.*\.sql$/.test(f)).sort();

test("computeIsPro: aktiv + fremtidig periode = true", () => {
  assert.equal(computeIsPro({ status: "active", current_period_end: new Date(Date.now() + 86400000).toISOString() }), true);
});
test("computeIsPro: opsagt men stadig i perioden = true (æret betalt tid)", () => {
  assert.equal(computeIsPro({ status: "cancelled", current_period_end: new Date(Date.now() + 86400000).toISOString() }), true);
});
test("computeIsPro: udløbet periode = false", () => {
  assert.equal(computeIsPro({ status: "active", current_period_end: new Date(Date.now() - 1000).toISOString() }), false);
});
test("computeIsPro: ingen række = false", () => {
  assert.equal(computeIsPro(null), false);
});

let db;
before(async () => { db = await createTestDb({ files: ALL_SQL }); });
after(async () => { if (db) await db.close(); });

test("subscriptions-row kan upsertes og læses tilbage (DDL-kontrakt)", async () => {
  // Indsæt et minimalt team først (FK). Brug eksisterende teams-kolonner.
  await db.query("INSERT INTO public.teams (id, name) VALUES ('00000000-0000-0000-0000-000000000001', 'T') ON CONFLICT DO NOTHING");
  await db.query(
    `INSERT INTO public.subscriptions (team_id, status, current_period_end)
     VALUES ($1, 'active', now() + interval '30 days')`,
    ["00000000-0000-0000-0000-000000000001"]
  );
  const { rows } = await db.query("SELECT status, current_period_end FROM public.subscriptions WHERE team_id = $1", ["00000000-0000-0000-0000-000000000001"]);
  assert.equal(rows.length, 1);
  assert.equal(computeIsPro(rows[0]), true);
});
```

> Hvis `teams` har NOT NULL-kolonner uden default (fx `user_id`), tilføj dem til INSERT'en med dummy-værdier — kør `\d teams` mentalt ud fra `database/`-DDL'en og match.

- [ ] **Step 2: Kør test — forventet FAIL**

Run: `cd backend && node --test --import ./test-setup.js lib/entitlement.test.js`
Expected: FAIL ("Cannot find module './entitlement.js'").

- [ ] **Step 3: Skriv helperen**

```javascript
// Entitlement: sandheden om Pro-adgang. Provider-agnostisk — afhænger kun af
// status + current_period_end, ikke af hvem der opkrævede.

export const SUBSCRIPTION_ACTIVE_STATUSES = new Set(["active", "cancelled", "past_due"]);

// 'cancelled' tæller stadig som Pro indtil current_period_end (æret betalt tid).
export function computeIsPro(sub) {
  if (!sub || !sub.current_period_end) return false;
  if (!SUBSCRIPTION_ACTIVE_STATUSES.has(sub.status)) return false;
  return new Date(sub.current_period_end).getTime() > Date.now();
}

// Slår team'ets subscription op via service_role-klienten og returnerer is_pro.
export async function isPro(supabase, teamId) {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("status, current_period_end, is_founder")
    .eq("team_id", teamId)
    .maybeSingle();
  if (error) throw error;
  return computeIsPro(data);
}
```

- [ ] **Step 4: Kør test — forventet PASS**

Run: `cd backend && node --test --import ./test-setup.js lib/entitlement.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/entitlement.js backend/lib/entitlement.test.js
git commit -m "feat(billing): entitlement-helper (computeIsPro + isPro) m. PGlite-kontrakt-test"
```

---

### Task 4: Webhook — Alunta → entitlement-flip

**Files:**
- Create: `backend/lib/aluntaWebhook.js` (ren handler-logik, testbar)
- Modify: `backend/server.js` (raw-body for webhook-path FØR `express.json`)
- Modify: `backend/routes/api.js` (registrér `POST /billing/alunta-webhook`)
- Create: `backend/lib/aluntaWebhook.test.js`

- [ ] **Step 1: Skriv den fejlende test (HTTP-end-to-end via http+fetch + PGlite)**

```javascript
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import express from "express";
import { readdirSync } from "node:fs";
import { createTestDb } from "./testdb/createTestDb.js";
import { handleAluntaWebhook, verifyWebhookSecret } from "./aluntaWebhook.js";

const ALL_SQL = readdirSync(new URL("../../database/", import.meta.url))
  .filter((f) => /^\d{4}-\d{2}-\d{2}.*\.sql$/.test(f)).sort();

// Minimal supabase-lignende adapter oven på PGlite, kun de kald handleren bruger.
function pgliteSupabase(db) {
  return {
    from(table) {
      return {
        upsert: async (row, opts) => {
          // Forenklet upsert på team_id (unik). Nok til test.
          await db.query(
            `INSERT INTO public.${table} (team_id, status, plan_interval, alunta_customer_id, alunta_subscription_id, current_period_end, is_founder, last_event_id, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
             ON CONFLICT (team_id) DO UPDATE SET status=EXCLUDED.status, plan_interval=EXCLUDED.plan_interval,
               alunta_customer_id=EXCLUDED.alunta_customer_id, alunta_subscription_id=EXCLUDED.alunta_subscription_id,
               current_period_end=EXCLUDED.current_period_end, is_founder=EXCLUDED.is_founder, last_event_id=EXCLUDED.last_event_id, updated_at=now()`,
            [row.team_id, row.status, row.plan_interval, row.alunta_customer_id, row.alunta_subscription_id, row.current_period_end, row.is_founder ?? false, row.last_event_id]
          );
          return { error: null };
        },
      };
    },
  };
}

let db;
before(async () => {
  db = await createTestDb({ files: ALL_SQL });
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
      data: { external_customer_id: "00000000-0000-0000-0000-000000000009", subscription_uuid: "sub_1", customer_uuid: "cus_1", plan_interval: "monthly", current_period_end: new Date(Date.now()+30*864e5).toISOString() },
      timestamp: "2026-06-26T10:00:00Z", test_mode: true,
    };
    const res = await fetch(`${base}/api/billing/alunta-webhook`, { method: "POST", headers: { "Content-Type": "application/json", "X-Alunta-Secret": "shh" }, body: JSON.stringify(payload) });
    assert.equal(res.status, 200);
    const { rows } = await db.query("SELECT status FROM public.subscriptions WHERE team_id=$1", ["00000000-0000-0000-0000-000000000009"]);
    assert.equal(rows[0].status, "active");
  });
});

test("forkert secret afvises 401 og rører ikke DB", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/billing/alunta-webhook`, { method: "POST", headers: { "Content-Type": "application/json", "X-Alunta-Secret": "wrong" }, body: JSON.stringify({ event: "checkout.completed", data: {} }) });
    assert.equal(res.status, 401);
  });
});
```

- [ ] **Step 2: Kør test — forventet FAIL**

Run: `cd backend && node --test --import ./test-setup.js lib/aluntaWebhook.test.js`
Expected: FAIL ("Cannot find module './aluntaWebhook.js'").

- [ ] **Step 3: Skriv handleren**

```javascript
// Alunta webhook-handler. Svar 2xx < 3 sek. (Aluntas grænse); minimal DB-arbejde.
// Interim-auth: delt hemmelig header (HTTPS). TODO: skift til Aluntas rigtige
// signatur-mekanisme når den er bekræftet i test_mode.

export function verifyWebhookSecret(req, secret) {
  const provided = req.get("X-Alunta-Secret");
  return Boolean(secret) && provided === secret;
}

const ACTIVATING = new Set(["checkout.completed", "invoice.paid", "subscription.created"]);
const CANCELLING = new Set(["subscription.cancelled"]);

export async function handleAluntaWebhook({ req, res, supabase, secret = process.env.ALUNTA_WEBHOOK_SECRET }) {
  if (!verifyWebhookSecret(req, secret)) return res.sendStatus(401);

  let payload;
  try {
    payload = typeof req.body === "object" && !Buffer.isBuffer(req.body)
      ? req.body
      : JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString("utf8") : req.body);
  } catch {
    return res.sendStatus(400);
  }

  const { event, data } = payload || {};
  const teamId = data?.external_customer_id;
  if (!event || !teamId) return res.sendStatus(200); // intet at gøre — undgå retries

  let status = null;
  if (ACTIVATING.has(event)) status = "active";
  else if (CANCELLING.has(event)) status = "cancelled";
  if (!status) return res.sendStatus(200); // ukendt event-type — ignorér roligt

  const { error } = await supabase.from("subscriptions").upsert(
    {
      team_id: teamId,
      status,
      plan_interval: data.plan_interval ?? null,
      alunta_customer_id: data.customer_uuid ?? null,
      alunta_subscription_id: data.subscription_uuid ?? null,
      current_period_end: data.current_period_end ?? null,
      is_founder: data.is_founder ?? undefined,
      last_event_id: data.uuid ?? `${event}:${payload.timestamp ?? ""}`,
    },
    { onConflict: "team_id" }
  );
  if (error) return res.sendStatus(500); // Alunta retry'er

  return res.sendStatus(200);
}
```

- [ ] **Step 4: Wire raw-body + route**

I `backend/server.js`, FØR `app.use(express.json(...))`:

```javascript
// Webhooks skal have rå body (signatur/verifikation) → undtag fra JSON-parseren.
app.use("/api/billing/alunta-webhook", express.raw({ type: "*/*" }));
app.use(express.json({ limit: "10mb" }));
```

I `backend/routes/api.js` (importér handleren øverst, registrér route — INGEN `requireAuth`, Alunta er ekstern):

```javascript
import { handleAluntaWebhook } from "../lib/aluntaWebhook.js";

router.post("/billing/alunta-webhook", async (req, res) => {
  await handleAluntaWebhook({ req, res, supabase });
});
```

- [ ] **Step 5: Kør test — forventet PASS**

Run: `cd backend && node --test --import ./test-setup.js lib/aluntaWebhook.test.js`
Expected: PASS (2 tests grønne).

- [ ] **Step 6: Commit**

```bash
git add backend/lib/aluntaWebhook.js backend/lib/aluntaWebhook.test.js backend/server.js backend/routes/api.js
git commit -m "feat(billing): Alunta webhook → entitlement-flip (raw-body + secret-verify + upsert)"
```

---

### Task 5: Checkout-route (`POST /api/billing/checkout`)

**Files:**
- Create: `backend/lib/billingCheckout.js` (handler-logik m. injicerbar Alunta-klient)
- Modify: `backend/routes/api.js` (registrér route m. `requireAuth`)
- Create: `backend/lib/billingCheckout.test.js`

- [ ] **Step 1: Skriv den fejlende test (fake Alunta-klient)**

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { createCheckoutHandler, PLAN_IDS } from "./billingCheckout.js";

function fakeClient() {
  const calls = [];
  return {
    calls,
    ensureCustomer: async (a) => { calls.push(["ensureCustomer", a]); return { uuid: "cus_1" }; },
    createCheckoutSession: async (a) => { calls.push(["checkout", a]); return "https://app.alunta.com/checkout/xyz"; },
  };
}

function res() {
  return { code: 0, body: null, status(c){ this.code = c; return this; }, json(b){ this.body = b; return this; } };
}

test("checkout: kendt interval → ensureCustomer + checkout_url", async () => {
  const client = fakeClient();
  const handler = createCheckoutHandler({ client, planIds: { monthly: "plan-m", semiannual: "plan-s" }, appBaseUrl: "https://cz" });
  const req = { team: { id: "team-1", name: "L" }, user: { email: "a@b.dk" }, body: { interval: "monthly" } };
  const r = res();
  await handler(req, r);
  assert.equal(r.code, 200);
  assert.equal(r.body.checkout_url, "https://app.alunta.com/checkout/xyz");
  assert.deepEqual(client.calls[0][1], { externalCustomerId: "team-1", name: "L", email: "a@b.dk" });
  assert.equal(client.calls[1][1].planId, "plan-m");
});

test("checkout: ukendt interval → 400", async () => {
  const handler = createCheckoutHandler({ client: fakeClient(), planIds: { monthly: "m" }, appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "t" }, user: {}, body: { interval: "weekly" } }, r);
  assert.equal(r.code, 400);
});

test("checkout: intet team → 400", async () => {
  const handler = createCheckoutHandler({ client: fakeClient(), planIds: { monthly: "m" }, appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: null, user: {}, body: { interval: "monthly" } }, r);
  assert.equal(r.code, 400);
});
```

- [ ] **Step 2: Kør test — forventet FAIL**

Run: `cd backend && node --test --import ./test-setup.js lib/billingCheckout.test.js`
Expected: FAIL ("Cannot find module './billingCheckout.js'").

- [ ] **Step 3: Skriv handleren**

```javascript
import { createAluntaClient } from "./alunta.js";

export const PLAN_IDS = {
  monthly: process.env.ALUNTA_CZ_PRO_PLAN_ID_MONTHLY,
  semiannual: process.env.ALUNTA_CZ_PRO_PLAN_ID_SEMIANNUAL,
};

export function createCheckoutHandler({
  client = createAluntaClient(),
  planIds = PLAN_IDS,
  appBaseUrl = process.env.FRONTEND_URL ?? "https://cyclingzone.org",
} = {}) {
  return async function checkout(req, res) {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    const interval = req.body?.interval;
    const planId = planIds[interval];
    if (!planId) return res.status(400).json({ error: "Unknown plan interval", errorCode: "unknown_interval" });

    try {
      await client.ensureCustomer({ externalCustomerId: req.team.id, name: req.team.name, email: req.user?.email });
      const checkoutUrl = await client.createCheckoutSession({
        externalCustomerId: req.team.id,
        planId,
        successUrl: `${appBaseUrl}/pro/success`,
        backUrl: `${appBaseUrl}/pro`,
      });
      return res.status(200).json({ checkout_url: checkoutUrl });
    } catch (err) {
      return res.status(502).json({ error: "Checkout failed", detail: String(err.message || err) });
    }
  };
}
```

- [ ] **Step 4: Registrér route i `backend/routes/api.js`**

```javascript
import { createCheckoutHandler } from "../lib/billingCheckout.js";
const billingCheckout = createCheckoutHandler();

router.post("/billing/checkout", requireAuth, (req, res) => billingCheckout(req, res));
```

- [ ] **Step 5: Kør test — forventet PASS**

Run: `cd backend && node --test --import ./test-setup.js lib/billingCheckout.test.js`
Expected: PASS (3 tests grønne).

- [ ] **Step 6: Commit**

```bash
git add backend/lib/billingCheckout.js backend/lib/billingCheckout.test.js backend/routes/api.js
git commit -m "feat(billing): POST /api/billing/checkout (ensureCustomer + checkout_url, interval-validering)"
```

---

### Task 6: Frontend — `isPro`-state + Founder-badge

**Files:**
- Create: `frontend/src/lib/useSubscription.js`
- Modify: `frontend/src/components/Layout.jsx` (eksponér badge i header/nav)
- Create: `frontend/src/components/ProBadge.jsx`
- Create: `frontend/src/lib/useSubscription.test.js` (ren `computeIsPro`-spejling til frontend)

- [ ] **Step 1: Skriv den fejlende test (ren beregning, ingen DOM)**

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { computeIsPro } from "./useSubscription.js";

test("computeIsPro: aktiv + fremtid = true", () => {
  assert.equal(computeIsPro({ status: "active", current_period_end: new Date(Date.now()+86400000).toISOString() }), true);
});
test("computeIsPro: udløbet = false", () => {
  assert.equal(computeIsPro({ status: "active", current_period_end: new Date(Date.now()-1000).toISOString() }), false);
});
test("computeIsPro: null = false", () => {
  assert.equal(computeIsPro(null), false);
});
```

Run (frontend kører også `node --test`): `cd frontend && node --test src/lib/useSubscription.test.js`
Expected: FAIL ("Cannot find module").

- [ ] **Step 2: Skriv hook + beregning**

```javascript
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

// Samme regel som backend (entitlement.js) — holdt bevidst i sync.
const ACTIVE = new Set(["active", "cancelled", "past_due"]);
export function computeIsPro(sub) {
  if (!sub || !sub.current_period_end) return false;
  if (!ACTIVE.has(sub.status)) return false;
  return new Date(sub.current_period_end).getTime() > Date.now();
}

// Læser EGEN subscription (RLS select-own). Returnerer { isPro, isFounder, loading }.
export function useSubscription(teamId) {
  const [sub, setSub] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    if (!teamId) { setLoading(false); return; }
    (async () => {
      const { data } = await supabase
        .from("subscriptions")
        .select("status, current_period_end, is_founder")
        .eq("team_id", teamId)
        .maybeSingle();
      if (alive) { setSub(data ?? null); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [teamId]);
  return { isPro: computeIsPro(sub), isFounder: Boolean(sub?.is_founder), loading };
}
```

- [ ] **Step 3: Skriv `ProBadge.jsx`** (editorial, ingen AI-slop — match Brand-stil)

```jsx
import { StarIcon } from "./ui/icons/index.jsx";

// Lille statusmærke. Vises kun for Pro/Founder. Ingen glow/gradient — hairline +
// accent-tekst, jf. design-smag (kun wordmark-niveau detalje).
export default function ProBadge({ isFounder }) {
  return (
    <span className="inline-flex items-center gap-1 border border-cz-accent rounded-cz px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cz-accent-t">
      <StarIcon size={11} className="text-cz-accent-t" aria-hidden="true" />
      {isFounder ? "Founder" : "Pro"}
    </span>
  );
}
```

- [ ] **Step 4: Vis badge i `Layout.jsx`** ved siden af holdnavnet (brug eksisterende `team`-state):

```jsx
import ProBadge from "./ProBadge.jsx";
import { useSubscription } from "../lib/useSubscription.js";
// ... i komponenten, hvor team kendes:
const { isPro, isFounder } = useSubscription(team?.id);
// ... i JSX nær holdnavnet:
{isPro && <ProBadge isFounder={isFounder} />}
```

- [ ] **Step 5: Kør test + build**

Run: `cd frontend && node --test src/lib/useSubscription.test.js`
Expected: PASS.
Run: `cd frontend && npm run build`
Expected: build OK (ingen ESM extensionless-import-fejl — alle relative imports har `.js`/`.jsx`).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/useSubscription.js frontend/src/lib/useSubscription.test.js frontend/src/components/ProBadge.jsx frontend/src/components/Layout.jsx
git commit -m "feat(billing): frontend isPro-hook + Founder/Pro-badge i Layout"
```

---

### Task 7: Frontend — `/pro`-opgraderingsside + checkout-CTA

**Files:**
- Create: `frontend/src/pages/ProUpgradePage.jsx`
- Create: `frontend/public/locales/en/pro.json` + `frontend/public/locales/da/pro.json`
- Modify: `frontend/src/i18n/index.js` (registrér `pro`-namespace)
- Modify: `frontend/src/App.jsx` (route `pro` under ProtectedRoute + `pro/success`)
- Modify: `frontend/src/pages/FounderSupporterPage.jsx` (CTA → `/pro` hvis logget ind, ellers `/login`)

- [ ] **Step 1: Locale-filer (EN-first)**

`frontend/public/locales/en/pro.json`:
```json
{
  "metaTitle": "Upgrade to CZ Pro",
  "title": "Become a Founder",
  "subtitle": "Back the game's development and lock in Founder status. The free game stays fully competitive — Pro adds depth, comfort and identity, never an advantage.",
  "monthly": "Monthly",
  "semiannual": "6 months",
  "monthlyPrice": "49 kr/mo",
  "semiannualPrice": "265 kr",
  "semiannualNote": "≈44 kr/mo · save ~10%",
  "cta": "Continue to payment",
  "loginFirst": "Log in to upgrade",
  "error": "Could not start checkout. Please try again."
}
```

`frontend/public/locales/da/pro.json`:
```json
{
  "metaTitle": "Opgradér til CZ Pro",
  "title": "Bliv Founder",
  "subtitle": "Støt spillets udvikling og lås Founder-status. Gratis-spillet forbliver fuldt konkurrencedygtigt — Pro tilføjer dybde, komfort og identitet, aldrig en fordel.",
  "monthly": "Månedlig",
  "semiannual": "6 måneder",
  "monthlyPrice": "49 kr/md",
  "semiannualPrice": "265 kr",
  "semiannualNote": "≈44 kr/md · spar ~10%",
  "cta": "Videre til betaling",
  "loginFirst": "Log ind for at opgradere",
  "error": "Kunne ikke starte betaling. Prøv igen."
}
```

- [ ] **Step 2: Registrér namespace i `frontend/src/i18n/index.js`**

```javascript
import proDa from "../../public/locales/da/pro.json";
import proEn from "../../public/locales/en/pro.json";
// ns: [..., "founder", "landing", "pro", ...]
// resources.da: { ..., pro: proDa }
// resources.en: { ..., pro: proEn }
```

> Hvis `/pro` er authed: tilføj `"pro"` til den inline-namespace-liste som `scripts/check-i18n-namespace-inline.mjs` kræver (kør scriptet for at se om det fejler).

- [ ] **Step 3: Opgraderingssiden m. checkout-kald**

```jsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";

const API = import.meta.env.VITE_API_URL ?? "";

export default function ProUpgradePage() {
  const { t } = useTranslation("pro");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function startCheckout(interval) {
    setBusy(true); setErr(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API}/api/billing/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ interval }),
      });
      if (!res.ok) throw new Error("checkout failed");
      const { checkout_url } = await res.json();
      window.location.href = checkout_url;   // redirect til Aluntas hostede side
    } catch {
      setErr(t("error")); setBusy(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-10">
      <h1 className="font-display text-4xl tracking-tight text-cz-1">{t("title")}</h1>
      <p className="text-cz-2 mt-3">{t("subtitle")}</p>
      {err && <p className="text-cz-danger text-sm mt-4">{err}</p>}
      <div className="grid sm:grid-cols-2 gap-4 mt-8">
        <button disabled={busy} onClick={() => startCheckout("monthly")} className="border border-cz-border rounded-cz p-5 text-left hover:bg-cz-subtle disabled:opacity-50">
          <div className="text-cz-3 text-xs uppercase tracking-wider">{t("monthly")}</div>
          <div className="font-data text-2xl text-cz-1">{t("monthlyPrice")}</div>
        </button>
        <button disabled={busy} onClick={() => startCheckout("semiannual")} className="border border-cz-accent border-t-2 rounded-cz p-5 text-left hover:bg-cz-subtle disabled:opacity-50">
          <div className="text-cz-3 text-xs uppercase tracking-wider">{t("semiannual")}</div>
          <div className="font-data text-2xl text-cz-1">{t("semiannualPrice")}</div>
          <div className="text-cz-3 text-[11px]">{t("semiannualNote")}</div>
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Routes i `frontend/src/App.jsx`**

```jsx
const ProUpgradePage = lazy(() => import("./pages/ProUpgradePage"));
// Inde i ProtectedRoute/Layout-blokken:
<Route path="pro" element={<ProUpgradePage />} />
<Route path="pro/success" element={<ProUpgradePage />} />
```

- [ ] **Step 5: Founder-side CTA → `/pro`**

I `frontend/src/pages/FounderSupporterPage.jsx`, erstat waitlist-CTA'ens `href="#waitlist"` med en route der sender til `/pro` hvis logget ind, ellers `/login?next=/pro`. Behold resten af siden (hero, fairness-promise, tiers, FAQ) som marketing.

```jsx
import { Link } from "react-router-dom";
// Primær CTA bliver:
<Link to="/pro" className="inline-flex items-center justify-center px-6 py-3 bg-cz-accent text-cz-on-accent font-bold rounded-cz text-sm hover:brightness-110 transition-all">
  {t("ctaPrimary")}
</Link>
```

> Waitlist-formularen kan blive stående midlertidigt, men er ikke længere den primære vej. Fjernelse af `FounderSupporterWaitlistForm` er en separat oprydnings-PR (ikke Slice 1).

- [ ] **Step 6: Test + build**

Run: `cd frontend && npm run build`
Expected: build OK.
Run: `npx playwright test core-smoke.spec.js` (alle 3 projekter — desktop + mobile-chromium + mobile-webkit)
Expected: PASS (eller opdatér snapshots hvis Founder-CTA ændrer den visuelle flade: `npx playwright test core-smoke --update-snapshots` og commit PNG'erne).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/ProUpgradePage.jsx frontend/src/App.jsx frontend/src/i18n/index.js frontend/public/locales/en/pro.json frontend/public/locales/da/pro.json frontend/src/pages/FounderSupporterPage.jsx
git commit -m "feat(billing): /pro opgraderingsside + checkout-CTA + Founder-side leder hertil"
```

---

### Task 8: Patch notes + hjælp (brugerrettet ændring — projekt-regel)

**Files:**
- Modify: `frontend/src/pages/PatchNotesPage.jsx` (+ evt. `frontend/src/data/patchNotes.js`)
- Modify: `frontend/public/locales/{en,da}/help.json` (FAQ: "Hvad er CZ Pro / koster det noget?")

- [ ] **Step 1: Tilføj patch-note-entry** for ny version (CZ Pro Founder-launch): kort, brugerrettet, EN+DA. Match eksisterende entry-struktur i filen.

- [ ] **Step 2: Tilføj help/FAQ-entry** (en+da): "Er spillet gratis?" → ja, fuldt konkurrencedygtigt; CZ Pro er valgfri støtte + dybde/komfort/kosmetik, aldrig fordel. Match eksisterende `help.json`-struktur.

- [ ] **Step 3: Verificér version-check** (CI patch-notes-gate): kør den lokale verifikation der matcher CI'ens patch-notes-version-tjek (jf. CLAUDE.md pre-flight).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/PatchNotesPage.jsx frontend/src/data/patchNotes.js frontend/public/locales/en/help.json frontend/public/locales/da/help.json
git commit -m "docs(patch-notes): CZ Pro Founder-launch + FAQ (gratis vs Pro)"
```

---

### Task 9: Fuld lokal verifikation + PR

- [ ] **Step 1: Kør hele pre-flight**

Run: `pwsh -File scripts/verify-local.ps1` (backend-tests + frontend-tests + frontend-build)
Expected: alt grønt. Plus: `cd frontend && npx playwright test core-smoke.spec.js` (alle 3 projekter).

- [ ] **Step 2: Verificér NYE backend-tests kører i suiten**

Run: `cd backend && npm test`
Expected: alle nye `lib/*.test.js` (subscriptionsSchema, alunta, entitlement, aluntaWebhook, billingCheckout) PASS.

- [ ] **Step 3: Push branch + åbn PR**

```bash
git push -u origin feat/cz-pro-billing-rails
gh pr create --title "feat(billing): CZ Pro billing-rails (Slice 1) — Alunta checkout + entitlement + Founder-badge" --body "Refs #<issue>. Indeholder database/2026-06-26-cz-pro-subscriptions.sql → EJER MERGER (migration auto-applies i prod). Live test_mode afventer ejer-token+plan i Infisical."
```

> **PR med `database/*.sql` → ejer merger** (hard rule). Auto-merge IKKE.

- [ ] **Step 4: LIVE test_mode-verifikation (efter ejer har lagt token+plan i Infisical)**

1. `infisical run --env=dev -- node backend/scripts/dev/...` eller kør backend lokalt m. Infisical → `POST /api/billing/checkout {interval:"monthly"}` returnerer en ægte `checkout_url`.
2. Gennemfør test-betaling på Aluntas hostede side (test_mode).
3. Bekræft webhook rammer `/api/billing/alunta-webhook` → `subscriptions.status='active'` i DB → badge vises i app.
4. Bekræft de åbne tekniske afklaringer fra spec §9: eksakt feltnavn (`plan_id` vs `plan_uuid`), webhook-signatur-mekanisme (skift fra delt secret hvis Alunta tilbyder HMAC), Portal-endpoint.

---

## Self-Review

**Spec-dækning (§9 Fase 1):** ✅ migration+RLS (T1), Alunta-klient (T2), entitlement `isPro` (T3), webhook (T4), checkout-route (T5), frontend isPro + badge (T6), Founder-side→checkout (T7), patch notes/help (T8). Pro-perks ud over badge (kit-designer, analytics, komfort) er bevidst UDE af scope (egne slices) — noteret i header.

**Placeholder-scan:** Ingen "TBD/TODO" som arbejds-substitut; `<issue>` udfyldes ved PR. To bevidst-markerede afklaringer (webhook-signatur, `plan_id` vs `plan_uuid`) hører til LIVE test_mode (T9 step 4) og kan ikke verificeres offline — de er afgrænsede verifikations-punkter, ikke huller i koden.

**Type/navne-konsistens:** `computeIsPro` (backend `entitlement.js` + frontend `useSubscription.js`, bevidst spejlet, samme `ACTIVE`-statusser). `createAluntaClient().ensureCustomer/createCheckoutSession` bruges identisk i T2/T5. `subscriptions`-kolonner i T1 matcher upsert-felterne i T4 + select i T3/T6. Webhook-secret-header `X-Alunta-Secret` konsistent T4.

**Kendt skrøbelighed:** PGlite-harness skal kunne loade hele `database/`-sættet (FK til `teams`). Hvis en gammel DDL-fil brækker sanitizeren, indskrænk `files` til minimal-sættet (noteret i T1/T3). `teams`-INSERT i tests skal matche NOT NULL-kolonner (noteret i T3).
