/**
 * Slice 07c — Atomic balance updates: helper-kontrakt + race-property.
 *
 * Disse tests verificerer balanceRpc.js-helperens kontrakt mod en mock RPC.
 * Selve TOCTOU-beskyttelsen leveres af pg_advisory_xact_lock i Postgres-RPC'en
 * (database/2026-05-09-balance-rpc.sql) og kan kun verificeres mod en rigtig
 * Supabase-instans — det dækkes af manuel race-test mod test-account efter
 * deploy (se PR-beskrivelse for SQL-snippet).
 *
 * Race-property-testen her dokumenterer den invariant koden SKAL opretholde:
 * 10 parallelle increments med kendte deltas → final balance = baseline + Σ deltas.
 * Mock'en serialiserer per team for at simulere RPC-kontrakten.
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_KEY ??= "test-service-key";

const { incrementBalanceWithAudit, DUPLICATE_VIOLATION_CODE } = await import("./balanceRpc.js");

function createSerializedRpcMock({ initialBalance = 0, uniqueKeys = new Set() } = {}) {
  const state = { balance: initialBalance, financeRows: [], rpcCalls: 0 };
  // Per-team mutex-kæde simulerer pg_advisory_xact_lock(team_id) — kun én RPC
  // ad gangen pr. team. Mocken bruger én delt kæde fordi tests kun rammer ét team.
  let chain = Promise.resolve();

  return {
    state,
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      const next = chain.then(async () => {
        state.rpcCalls += 1;
        const key = params.p_finance_payload.idempotency_key;
        if (key && uniqueKeys.has(key)) {
          return { data: null, error: { code: DUPLICATE_VIOLATION_CODE, message: "duplicate" } };
        }
        if (key) uniqueKeys.add(key);
        const before = state.balance;
        state.balance += params.p_delta;
        state.financeRows.push({
          team_id: params.p_team_id,
          before_balance: before,
          after_balance: state.balance,
          ...params.p_finance_payload,
        });
        // Simulér en lille DB-roundtrip-delay så concurrent calls reelt overlapper.
        await new Promise((resolve) => setTimeout(resolve, 1));
        return { data: state.balance, error: null };
      });
      chain = next.then(() => {}, () => {});
      return next;
    },
  };
}

test("incrementBalanceWithAudit kalder RPC med korrekt payload-shape", async () => {
  const calls = [];
  const client = {
    rpc(name, params) {
      calls.push({ name, params });
      return Promise.resolve({ data: 1500, error: null });
    },
  };

  const result = await incrementBalanceWithAudit(client, {
    teamId: "team-1",
    delta: 500,
    payload: {
      type: "sponsor",
      amount: 500,
      description: "Test sponsor",
      season_id: "season-1",
      reason_code: "season_start_sponsor",
    },
  });

  assert.deepEqual(result, { skipped: false, balance: 1500 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "increment_balance_with_audit");
  assert.equal(calls[0].params.p_team_id, "team-1");
  assert.equal(calls[0].params.p_delta, 500);
  assert.equal(calls[0].params.p_finance_payload.type, "sponsor");
  assert.equal(calls[0].params.p_finance_payload.reason_code, "season_start_sponsor");
});

test("incrementBalanceWithAudit kaster på 23505 når allowDuplicate=false (default)", async () => {
  const client = {
    rpc() {
      return Promise.resolve({ data: null, error: { code: DUPLICATE_VIOLATION_CODE, message: "dup" } });
    },
  };

  await assert.rejects(
    () => incrementBalanceWithAudit(client, {
      teamId: "team-1",
      delta: 100,
      payload: { type: "sponsor", amount: 100 },
    }),
    (err) => err.code === DUPLICATE_VIOLATION_CODE,
  );
});

test("incrementBalanceWithAudit returnerer skipped=true på 23505 når allowDuplicate=true", async () => {
  const client = {
    rpc() {
      return Promise.resolve({ data: null, error: { code: DUPLICATE_VIOLATION_CODE, message: "dup" } });
    },
  };

  const result = await incrementBalanceWithAudit(
    client,
    {
      teamId: "team-1",
      delta: 100,
      payload: { type: "sponsor", amount: 100 },
    },
    { allowDuplicate: true },
  );

  assert.deepEqual(result, { skipped: true, balance: null });
});

test("incrementBalanceWithAudit propagerer andre DB-fejl uanset allowDuplicate", async () => {
  const client = {
    rpc() {
      return Promise.resolve({ data: null, error: { code: "23502", message: "not null violation" } });
    },
  };

  await assert.rejects(
    () => incrementBalanceWithAudit(
      client,
      { teamId: "team-1", delta: 100, payload: { type: "sponsor", amount: 100 } },
      { allowDuplicate: true },
    ),
    (err) => err.code === "23502",
  );
});

test("incrementBalanceWithAudit afviser kald uden client.rpc()", async () => {
  await assert.rejects(
    () => incrementBalanceWithAudit({}, {
      teamId: "team-1", delta: 100, payload: { type: "sponsor", amount: 100 },
    }),
    /Supabase-client med rpc/,
  );
});

test("incrementBalanceWithAudit afviser payload uden type eller amount", async () => {
  const client = { rpc: () => Promise.resolve({ data: 0, error: null }) };
  await assert.rejects(
    () => incrementBalanceWithAudit(client, { teamId: "t1", delta: 1, payload: { amount: 1 } }),
    /payload\.type/,
  );
  await assert.rejects(
    () => incrementBalanceWithAudit(client, { teamId: "t1", delta: 1, payload: { type: "sponsor" } }),
    /payload\.amount/,
  );
});

test("RACE: 10 parallelle increments — final balance = baseline + Σ deltas (ingen tabt update)", async () => {
  // Property: når RPC'en serialiserer per team (pg_advisory_xact_lock), kan
  // ingen update tabes selv ved 10 samtidige in-flight calls. Mock'en
  // simulerer locking via en intern Promise-kæde.
  const baseline = 800_000;
  const supabase = createSerializedRpcMock({ initialBalance: baseline });
  const deltas = [12_000, -3_500, 8_700, -1_200, 4_400, -9_800, 2_100, 6_600, -5_500, 1_300];
  const expectedFinal = deltas.reduce((sum, d) => sum + d, baseline);

  await Promise.all(
    deltas.map((delta, i) =>
      incrementBalanceWithAudit(supabase, {
        teamId: "team-race",
        delta,
        payload: {
          type: "admin_adjustment",
          amount: delta,
          description: `Race-test delta-${i}`,
        },
      })
    )
  );

  assert.equal(supabase.state.balance, expectedFinal,
    `Final balance ${supabase.state.balance} matchede ikke forventet ${expectedFinal} — lost-update?`);
  assert.equal(supabase.state.financeRows.length, 10, "alle 10 finance rows skal være persisteret");
  assert.equal(supabase.state.rpcCalls, 10);

  // Hver row skal have monotonically-increasing rækkefølge mht. before_balance →
  // after_balance, og før-balance på row N = efter-balance på row N-1.
  for (let i = 1; i < supabase.state.financeRows.length; i++) {
    const prev = supabase.state.financeRows[i - 1];
    const curr = supabase.state.financeRows[i];
    assert.equal(
      curr.before_balance,
      prev.after_balance,
      `row ${i} before_balance (${curr.before_balance}) skal matche row ${i - 1} after_balance (${prev.after_balance})`,
    );
  }
});

test("RACE: 5 parallelle calls med samme idempotency_key — kun 1 succeeder, resten skipper", async () => {
  // Property: cron-retry der spawner duplikate calls med samme key må kun
  // skifte balance én gang. RPC-konstrant uniq_finance_idempotency_key håndhæver
  // dette i prod; her simulerer mock'en med en delt Set.
  const baseline = 1_000_000;
  const supabase = createSerializedRpcMock({ initialBalance: baseline });
  const delta = 240_000;
  const sharedKey = "sponsor:team-1:season-1";

  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      incrementBalanceWithAudit(
        supabase,
        {
          teamId: "team-1",
          delta,
          payload: {
            type: "sponsor",
            amount: delta,
            description: "Sponsor sæson 1",
            idempotency_key: sharedKey,
          },
        },
        { allowDuplicate: true },
      )
    )
  );

  const succeeded = results.filter((r) => !r.skipped);
  const skipped = results.filter((r) => r.skipped);
  assert.equal(succeeded.length, 1, "kun 1 call må skifte balance");
  assert.equal(skipped.length, 4, "4 dublet-calls må skipper");
  assert.equal(supabase.state.balance, baseline + delta);
  assert.equal(supabase.state.financeRows.length, 1);
});
