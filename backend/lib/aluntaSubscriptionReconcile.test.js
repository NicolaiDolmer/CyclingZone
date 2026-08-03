import test from "node:test";
import assert from "node:assert/strict";
import {
  mapAluntaStatus,
  extractSubscriptionFields,
  computeReconcileActions,
  fetchAllAluntaSubscriptions,
  runAluntaSubscriptionReconcile,
} from "./aluntaSubscriptionReconcile.js";

// ── mapAluntaStatus ──────────────────────────────────────────────────────────

test("mapAluntaStatus: aktive alias -> active", () => {
  for (const s of ["active", "started", "resumed", "trialing", "ACTIVE", " Active "]) {
    assert.equal(mapAluntaStatus(s), "active", s);
  }
});

test("mapAluntaStatus: cancelled/canceled -> cancelled", () => {
  assert.equal(mapAluntaStatus("cancelled"), "cancelled");
  assert.equal(mapAluntaStatus("canceled"), "cancelled");
});

test("mapAluntaStatus: past_due/payment_failed/unpaid -> past_due", () => {
  assert.equal(mapAluntaStatus("past_due"), "past_due");
  assert.equal(mapAluntaStatus("payment_failed"), "past_due");
  assert.equal(mapAluntaStatus("unpaid"), "past_due");
});

test("mapAluntaStatus: ended/expired/inactive/paused -> inactive", () => {
  assert.equal(mapAluntaStatus("ended"), "inactive");
  assert.equal(mapAluntaStatus("expired"), "inactive");
  assert.equal(mapAluntaStatus("paused"), "inactive");
});

test("mapAluntaStatus: ukendt/manglende status -> null (rør intet)", () => {
  assert.equal(mapAluntaStatus("some_new_status"), null);
  assert.equal(mapAluntaStatus(null), null);
  assert.equal(mapAluntaStatus(undefined), null);
});

// ── extractSubscriptionFields ────────────────────────────────────────────────

test("extractSubscriptionFields: flad svarform", () => {
  const entry = {
    external_customer_id: "team-1",
    customer_uuid: "cus-1",
    uuid: "sub-1",
    status: "active",
    plan_interval: "monthly",
    current_period_end: "2026-09-01T00:00:00Z",
  };
  const f = extractSubscriptionFields(entry);
  assert.equal(f.externalCustomerId, "team-1");
  assert.equal(f.customerUuid, "cus-1");
  assert.equal(f.subscriptionUuid, "sub-1");
  assert.equal(f.rawStatus, "active");
  assert.equal(f.planInterval, "monthly");
  assert.equal(f.currentPeriodEnd, "2026-09-01T00:00:00Z");
});

test("extractSubscriptionFields: nested customer/plan-objekt (fallback-stier)", () => {
  const entry = {
    id: "sub-2",
    customer: { external_customer_id: "team-2", uuid: "cus-2" },
    plan: { interval: "half-yearly" },
    status: "cancelled",
    renews_at: "2026-10-01T00:00:00Z",
  };
  const f = extractSubscriptionFields(entry);
  assert.equal(f.externalCustomerId, "team-2");
  assert.equal(f.customerUuid, "cus-2");
  assert.equal(f.subscriptionUuid, "sub-2");
  assert.equal(f.planInterval, "half-yearly");
  assert.equal(f.currentPeriodEnd, "2026-10-01T00:00:00Z");
});

test("extractSubscriptionFields: null/non-object -> null", () => {
  assert.equal(extractSubscriptionFields(null), null);
  assert.equal(extractSubscriptionFields(undefined), null);
  assert.equal(extractSubscriptionFields("x"), null);
});

// ── computeReconcileActions (pur) ────────────────────────────────────────────

test("computeReconcileActions: fornyelse opdaterer current_period_end + status", () => {
  const localRows = [
    {
      team_id: "team-1",
      status: "active",
      plan_interval: "monthly",
      current_period_end: "2026-07-01T00:00:00Z", // gammel/udløbet periode
      alunta_customer_id: "cus-1",
      alunta_subscription_id: "sub-1",
    },
  ];
  const remoteEntries = [
    {
      external_customer_id: "team-1",
      customer_uuid: "cus-1",
      uuid: "sub-1",
      status: "active",
      plan_interval: "monthly",
      current_period_end: "2026-09-01T00:00:00Z", // fornyet
    },
  ];
  const { updates, unchanged } = computeReconcileActions({ localRows, remoteEntries });
  assert.equal(updates.length, 1);
  assert.equal(unchanged.length, 0);
  assert.equal(updates[0].current_period_end, "2026-09-01T00:00:00Z");
  assert.equal(updates[0].status, "active");
  assert.ok(!("is_founder" in updates[0]), "is_founder må ALDRIG være i en opdateringsrække");
});

test("computeReconcileActions: udløb (ended) nedgraderer til inactive", () => {
  const localRows = [
    {
      team_id: "team-1",
      status: "cancelled",
      plan_interval: "monthly",
      current_period_end: "2026-08-01T00:00:00Z",
      alunta_customer_id: "cus-1",
      alunta_subscription_id: "sub-1",
    },
  ];
  const remoteEntries = [
    { external_customer_id: "team-1", customer_uuid: "cus-1", uuid: "sub-1", status: "ended", current_period_end: "2026-08-01T00:00:00Z" },
  ];
  const { updates } = computeReconcileActions({ localRows, remoteEntries });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].status, "inactive");
});

test("computeReconcileActions: betalingsfejl mappes til past_due (bevarer grace via current_period_end)", () => {
  const localRows = [
    { team_id: "team-1", status: "active", plan_interval: "monthly", current_period_end: "2026-08-01T00:00:00Z", alunta_customer_id: "cus-1", alunta_subscription_id: "sub-1" },
  ];
  const remoteEntries = [
    { external_customer_id: "team-1", customer_uuid: "cus-1", uuid: "sub-1", status: "payment_failed", current_period_end: "2026-08-01T00:00:00Z" },
  ];
  const { updates } = computeReconcileActions({ localRows, remoteEntries });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].status, "past_due");
});

test("computeReconcileActions: identiske værdier -> unchanged, ingen update foreslået", () => {
  const localRows = [
    { team_id: "team-1", status: "active", plan_interval: "monthly", current_period_end: "2026-09-01T00:00:00Z", alunta_customer_id: "cus-1", alunta_subscription_id: "sub-1" },
  ];
  const remoteEntries = [
    { external_customer_id: "team-1", customer_uuid: "cus-1", uuid: "sub-1", status: "active", plan_interval: "monthly", current_period_end: "2026-09-01T00:00:00Z" },
  ];
  const { updates, unchanged } = computeReconcileActions({ localRows, remoteEntries });
  assert.equal(updates.length, 0);
  assert.deepEqual(unchanged, ["team-1"]);
});

test("computeReconcileActions: lokal Pro-relevant række uden remote-match -> missingRemote", () => {
  const localRows = [
    { team_id: "team-1", status: "active", plan_interval: "monthly", current_period_end: "2026-09-01T00:00:00Z", alunta_customer_id: "cus-1", alunta_subscription_id: "sub-1" },
  ];
  const { updates, missingRemote } = computeReconcileActions({ localRows, remoteEntries: [] });
  assert.equal(updates.length, 0);
  assert.equal(missingRemote.length, 1);
  assert.equal(missingRemote[0].teamId, "team-1");
});

test("computeReconcileActions: inaktiv lokal række uden Alunta-identitet og uden match -> IKKE flagget", () => {
  const localRows = [{ team_id: "team-x", status: "inactive", plan_interval: null, current_period_end: null, alunta_customer_id: null, alunta_subscription_id: null }];
  const { missingRemote } = computeReconcileActions({ localRows, remoteEntries: [] });
  assert.equal(missingRemote.length, 0);
});

test("computeReconcileActions: remote-post uden external_customer_id -> unmatchedRemote, rører intet", () => {
  const localRows = [{ team_id: "team-1", status: "active", plan_interval: null, current_period_end: null, alunta_customer_id: null, alunta_subscription_id: null }];
  const remoteEntries = [{ uuid: "sub-orphan", status: "active", current_period_end: "2026-09-01T00:00:00Z" }];
  const { updates, unmatchedRemote, missingRemote } = computeReconcileActions({ localRows, remoteEntries });
  assert.equal(updates.length, 0);
  assert.equal(unmatchedRemote.length, 1);
  assert.equal(missingRemote.length, 1); // team-1 var active, ingen match fundet
});

test("computeReconcileActions: ukendt status-værdi springes over (rører aldrig raekken)", () => {
  const localRows = [{ team_id: "team-1", status: "active", plan_interval: "monthly", current_period_end: "2026-09-01T00:00:00Z", alunta_customer_id: "cus-1", alunta_subscription_id: "sub-1" }];
  const remoteEntries = [{ external_customer_id: "team-1", status: "some_brand_new_status", current_period_end: "2026-10-01T00:00:00Z" }];
  const { updates, skippedUnknownStatus } = computeReconcileActions({ localRows, remoteEntries });
  assert.equal(updates.length, 0);
  assert.equal(skippedUnknownStatus.length, 1);
  assert.equal(skippedUnknownStatus[0].rawStatus, "some_brand_new_status");
});

// ── runAluntaSubscriptionReconcile (integration mod fakes) ──────────────────

function makeFakeSupabase(initialRows) {
  const rows = initialRows.map((r) => ({ ...r }));
  const upsertCalls = [];
  return {
    _rows: () => rows.map((r) => ({ ...r })),
    _upsertCalls: () => upsertCalls,
    from(table) {
      assert.equal(table, "subscriptions");
      return {
        select() {
          return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null });
        },
        upsert(row) {
          upsertCalls.push({ ...row });
          const idx = rows.findIndex((r) => r.team_id === row.team_id);
          if (idx === -1) rows.push({ is_founder: false, ...row });
          else rows[idx] = { ...rows[idx], ...row };
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

function makeFakeAluntaClient(pagesByPage) {
  let calls = 0;
  return {
    _calls: () => calls,
    async listSubscriptions({ page, perPage }) {
      calls += 1;
      const items = pagesByPage[page] || [];
      return { data: items.slice(0, perPage) };
    },
  };
}

function makeAlwaysFailingClient() {
  let calls = 0;
  return {
    _calls: () => calls,
    async listSubscriptions() {
      calls += 1;
      throw new Error("network error: fetch failed");
    },
  };
}

test("integration: fornyelse skriver current_period_end for den ægte kunde-scenarie (null -> udfyldt)", async () => {
  const supabase = makeFakeSupabase([
    { team_id: "team-real", status: "active", plan_interval: null, current_period_end: null, alunta_customer_id: null, alunta_subscription_id: null, is_founder: true },
  ]);
  const client = makeFakeAluntaClient({
    1: [{ external_customer_id: "team-real", customer_uuid: "cus-real", uuid: "sub-real", status: "active", plan_interval: "monthly", current_period_end: "2026-09-25T00:00:00Z" }],
  });

  const result = await runAluntaSubscriptionReconcile({ supabase, client, captureExceptionFn: () => {} });

  assert.equal(result.applied, 1);
  assert.equal(result.errors.length, 0);
  const row = supabase._rows().find((r) => r.team_id === "team-real");
  assert.equal(row.current_period_end, "2026-09-25T00:00:00Z");
  assert.equal(row.alunta_customer_id, "cus-real");
  assert.equal(row.alunta_subscription_id, "sub-real");
  assert.equal(row.is_founder, true, "is_founder skal overleve uændret");
});

test("integration: idempotent — 2. kørsel mod uændret Alunta-data giver 0 nye updates", async () => {
  const supabase = makeFakeSupabase([
    { team_id: "team-real", status: "active", plan_interval: null, current_period_end: null, alunta_customer_id: null, alunta_subscription_id: null, is_founder: true },
  ]);
  const client = makeFakeAluntaClient({
    1: [{ external_customer_id: "team-real", customer_uuid: "cus-real", uuid: "sub-real", status: "active", plan_interval: "monthly", current_period_end: "2026-09-25T00:00:00Z" }],
  });

  const first = await runAluntaSubscriptionReconcile({ supabase, client, captureExceptionFn: () => {} });
  assert.equal(first.applied, 1);

  const second = await runAluntaSubscriptionReconcile({ supabase, client, captureExceptionFn: () => {} });
  assert.equal(second.applied, 0);
  assert.equal(second.proposedUpdates, 0);
  assert.equal(second.unchanged, 1);
  // Kun ét upsert-kald total (fra 1. kørsel) — 2. kørsel skrev intet.
  assert.equal(supabase._upsertCalls().length, 1);
});

test("integration: udløb nedgraderer en aktiv kunde til inactive", async () => {
  const supabase = makeFakeSupabase([
    { team_id: "team-real", status: "active", plan_interval: "monthly", current_period_end: "2026-08-24T00:00:00Z", alunta_customer_id: "cus-real", alunta_subscription_id: "sub-real", is_founder: false },
  ]);
  const client = makeFakeAluntaClient({
    1: [{ external_customer_id: "team-real", customer_uuid: "cus-real", uuid: "sub-real", status: "ended", current_period_end: "2026-08-24T00:00:00Z" }],
  });

  const result = await runAluntaSubscriptionReconcile({ supabase, client, captureExceptionFn: () => {} });
  assert.equal(result.applied, 1);
  const row = supabase._rows().find((r) => r.team_id === "team-real");
  assert.equal(row.status, "inactive");
});

test("integration: netværksfejl kastes højt (efter retry) og alarmerer via captureExceptionFn", async () => {
  const supabase = makeFakeSupabase([]);
  const client = makeAlwaysFailingClient();
  const captured = [];

  await assert.rejects(
    () =>
      runAluntaSubscriptionReconcile({
        supabase,
        client,
        captureExceptionFn: (err, ctx) => captured.push({ message: err.message, ctx }),
        retryDelayMs: 0, // ingen ægte sleep i tests
      }),
    /Alunta GET \/subscriptions fejlede/
  );

  assert.equal(client._calls(), 2, "skal forsøge 2 gange (1 retry) før den giver op");
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].ctx.fingerprint, ["alunta-reconcile-fetch-failed"]);
});

test("integration: dry-run beregner forslag men skriver intet", async () => {
  const supabase = makeFakeSupabase([
    { team_id: "team-real", status: "active", plan_interval: null, current_period_end: null, alunta_customer_id: null, alunta_subscription_id: null, is_founder: true },
  ]);
  const client = makeFakeAluntaClient({
    1: [{ external_customer_id: "team-real", customer_uuid: "cus-real", uuid: "sub-real", status: "active", plan_interval: "monthly", current_period_end: "2026-09-25T00:00:00Z" }],
  });

  const result = await runAluntaSubscriptionReconcile({ supabase, client, dryRun: true, captureExceptionFn: () => {} });

  assert.equal(result.dryRun, true);
  assert.equal(result.proposedUpdates, 1);
  assert.equal(result.applied, 0);
  assert.equal(supabase._upsertCalls().length, 0, "dry-run må ALDRIG skrive");
  const row = supabase._rows().find((r) => r.team_id === "team-real");
  assert.equal(row.current_period_end, null, "lokal raekke uændret efter dry-run");
});

test("fetchAllAluntaSubscriptions: paginerer til en side returnerer færre end perPage", async () => {
  const client = {
    calls: [],
    async listSubscriptions({ page }) {
      this.calls.push(page);
      if (page === 1) return { data: [{ id: "a" }] }; // fuld side (perPage=1)
      if (page === 2) return { data: [{ id: "b" }] }; // fuld side igen
      return { data: [] }; // tom side -> stop
    },
  };
  const items = await fetchAllAluntaSubscriptions(client, { perPage: 1 });
  assert.deepEqual(items.map((i) => i.id), ["a", "b"]);
  assert.deepEqual(client.calls, [1, 2, 3]);
});

test("integration: flere kunder i ét svar behandles alle", async () => {
  const supabase = makeFakeSupabase([
    { team_id: "team-a", status: "active", plan_interval: "monthly", current_period_end: "2026-08-01T00:00:00Z", alunta_customer_id: "cus-a", alunta_subscription_id: "sub-a", is_founder: false },
    { team_id: "team-b", status: "active", plan_interval: "monthly", current_period_end: "2026-08-01T00:00:00Z", alunta_customer_id: "cus-b", alunta_subscription_id: "sub-b", is_founder: false },
  ]);
  const client = makeFakeAluntaClient({
    1: [
      { external_customer_id: "team-a", customer_uuid: "cus-a", uuid: "sub-a", status: "active", current_period_end: "2026-09-01T00:00:00Z" },
      { external_customer_id: "team-b", customer_uuid: "cus-b", uuid: "sub-b", status: "cancelled", current_period_end: "2026-09-05T00:00:00Z" },
    ],
  });
  const result = await runAluntaSubscriptionReconcile({ supabase, client, captureExceptionFn: () => {} });
  assert.equal(result.checkedRemote, 2);
  assert.equal(result.applied, 2);
  assert.equal(supabase._rows().find((r) => r.team_id === "team-b").status, "cancelled");
});
