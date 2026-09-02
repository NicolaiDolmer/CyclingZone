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
  assert.equal(f.planInterval, "semiannual", "half-yearly normaliseres (#4541)");
  assert.equal(f.currentPeriodEnd, "2026-10-01T00:00:00Z");
});

// #4541: Aluntas ÆGTE svarform, målt 2/9 via dry-run mod prod. plan_interval
// er et tal (måneder pr. periode) og current_period_end bærer mikrosekunder.
test("extractSubscriptionFields: Aluntas ægte svarform (målt 2/9) -> plan_interval normaliseres fra tal", () => {
  const monthly = extractSubscriptionFields({
    external_customer_id: "8073fb4a-0000-0000-0000-000000000000",
    customer_uuid: "dd3372d2-0000-0000-0000-000000000000",
    uuid: "bea7ced2-0000-0000-0000-000000000000",
    status: "active",
    plan_interval: 1,
    current_period_end: "2026-09-30T21:59:59.999999Z",
  });
  assert.equal(monthly.planInterval, "monthly");
  assert.equal(monthly.currentPeriodEnd, "2026-09-30T21:59:59.999999Z");

  const semiannual = extractSubscriptionFields({
    external_customer_id: "dd7665b4-0000-0000-0000-000000000000",
    customer_uuid: "7a7b9292-0000-0000-0000-000000000000",
    uuid: "b9d010fc-0000-0000-0000-000000000000",
    status: "active",
    plan_interval: 6,
    current_period_end: "2027-03-01T22:59:59.999999Z",
  });
  assert.equal(semiannual.planInterval, "semiannual");
});

test("computeReconcileActions: rå '1' i DB rettes til 'monthly' selvom intet andet ændres (#4541)", () => {
  const localRows = [
    { team_id: "team-1", status: "active", plan_interval: "1", current_period_end: "2026-09-30T21:59:59.999999Z", alunta_customer_id: "cus-1", alunta_subscription_id: "sub-1" },
  ];
  const remoteEntries = [
    { external_customer_id: "team-1", customer_uuid: "cus-1", uuid: "sub-1", status: "active", plan_interval: 1, current_period_end: "2026-09-30T21:59:59.999999Z" },
  ];
  const { updates, unchanged } = computeReconcileActions({ localRows, remoteEntries });
  assert.equal(unchanged.length, 0);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].plan_interval, "monthly");
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

// ── #4541/#4542: updated_at-stempel + respit-guard ───────────────────────────

const NOW_2SEP = Date.parse("2026-09-02T12:00:00Z");

test("computeReconcileActions: opdateringsrække får updated_at fra now, uændret række får intet", () => {
  const localRows = [
    { team_id: "t-old", status: "active", plan_interval: "monthly", current_period_end: "2026-08-31T21:59:59Z", alunta_customer_id: "c1", alunta_subscription_id: "s1" },
    { team_id: "t-same", status: "active", plan_interval: "semiannual", current_period_end: "2027-03-01T22:59:59Z", alunta_customer_id: "c2", alunta_subscription_id: "s2" },
  ];
  const remoteEntries = [
    { uuid: "s1", status: "active", interval: 1, current_period_end: "2026-09-30T21:59:59Z", customer: { uuid: "c1", external_customer_id: "t-old" } },
    { uuid: "s2", status: "active", interval: 6, current_period_end: "2027-03-01T22:59:59Z", customer: { uuid: "c2", external_customer_id: "t-same" } },
  ];
  const { updates, unchanged } = computeReconcileActions({ localRows, remoteEntries, now: NOW_2SEP });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].team_id, "t-old");
  assert.equal(updates[0].updated_at, new Date(NOW_2SEP).toISOString());
  assert.deepEqual(unchanged, ["t-same"]);
});

test("extractSubscriptionFields: verificeret Alunta-form (customer.external_customer_id, interval) udtrækkes", () => {
  const fields = extractSubscriptionFields({
    uuid: "b9d010fc",
    status: "active",
    interval: 6,
    current_period_end: "2027-03-01T22:59:59.999999Z",
    customer: { uuid: "7a7b9292", name: "x", external_customer_id: "dd7665b4" },
    plan: { uuid: "298f32cf", name: "CZ Pro 6 Months" },
  });
  assert.deepEqual(fields, {
    externalCustomerId: "dd7665b4",
    customerUuid: "7a7b9292",
    subscriptionUuid: "b9d010fc",
    rawStatus: "active",
    planInterval: "semiannual",
    currentPeriodEnd: "2027-03-01T22:59:59.999999Z",
  });
});

test("computeReconcileActions: aktivt hos Alunta men udløbet ud over respitten -> activeButExpired", () => {
  const remoteEntries = [
    { uuid: "s1", status: "active", interval: 1, current_period_end: "2026-08-20T21:59:59Z", customer: { uuid: "c1", external_customer_id: "t1" } },
    { uuid: "s2", status: "active", interval: 1, current_period_end: "2026-09-01T21:59:59Z", customer: { uuid: "c2", external_customer_id: "t2" } }, // inden for respit
    { uuid: "s3", status: "ended", interval: 1, current_period_end: "2026-01-01T00:00:00Z", customer: { uuid: "c3", external_customer_id: "t3" } }, // ikke løbende
  ];
  const { activeButExpired } = computeReconcileActions({ localRows: [], remoteEntries, now: NOW_2SEP });
  assert.deepEqual(activeButExpired.map((a) => a.externalCustomerId), ["t1"]);
});

test("mapAluntaStatus: under_cancellation (Aluntas opsagt-men-løbende) -> cancelled", () => {
  assert.equal(mapAluntaStatus("under_cancellation"), "cancelled");
});

test("runAluntaSubscriptionReconcile: activeButExpired alarmeres med egen fingerprint", async () => {
  const captured = [];
  const supabase = {
    from() {
      return {
        select: async () => ({ data: [], error: null }),
        upsert: async () => ({ error: null }),
      };
    },
  };
  const client = {
    listSubscriptions: async () => ({
      data: [{ uuid: "s1", status: "active", interval: 1, current_period_end: "2026-08-01T00:00:00Z", customer: { uuid: "c1", external_customer_id: "t1" } }],
    }),
  };
  const result = await runAluntaSubscriptionReconcile({
    supabase,
    client,
    captureExceptionFn: (err, ctx) => captured.push({ err, ctx }),
    now: new Date(NOW_2SEP),
    retryDelayMs: 0,
  });
  assert.equal(result.activeButExpired, 1);
  assert.ok(captured.some((c) => c.ctx.fingerprint?.[0] === "alunta-reconcile-active-but-expired"));
});
