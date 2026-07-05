// Wave A1 (#1441 Fase 3) — facilityService: køb/ansæt/fyr via ledger.
// Mock-mønster spejler economyEngine.test.js (in-memory state + rpc-mock af
// increment_balance_with_audit, som debitTeam rammer via balanceRpc).
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://localhost";
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "test-service-key";

const { purchaseFacilityUpgrade, hireStaff, fireStaff } = await import("./facilityService.js");
const { FACILITY_TIER_PRICE } = await import("./facilityConstants.js");
const { generateStaffCandidates } = await import("./staffCandidates.js");

const ENABLED = { facilitiesEnabled: true };

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createFacilitySupabase({ team, facilities = [], staff = [] }) {
  const state = {
    team: clone(team),
    facilities: clone(facilities),
    staff: clone(staff),
    finance_transactions: [],
    upserts: [],
    staffInserts: [],
    staffUpdates: [],
  };

  return {
    state,
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      assert.equal(params.p_team_id, state.team.id);
      state.team.balance = (state.team.balance ?? 0) + params.p_delta;
      state.finance_transactions.push({
        team_id: params.p_team_id,
        ...params.p_finance_payload,
      });
      return Promise.resolve({ data: state.team.balance, error: null });
    },
    from(table) {
      if (table === "teams") {
        return {
          select(columns) {
            assert.equal(columns, "balance");
            return {
              eq(column, value) {
                assert.equal(column, "id");
                assert.equal(value, state.team.id);
                return {
                  single() {
                    return Promise.resolve({ data: { balance: state.team.balance }, error: null });
                  },
                };
              },
            };
          },
        };
      }

      if (table === "team_facilities") {
        return {
          select(columns) {
            assert.equal(columns, "tier");
            const filters = {};
            const chain = {
              eq(column, value) {
                filters[column] = value;
                return chain;
              },
              maybeSingle() {
                const row = state.facilities.find(
                  (f) => f.team_id === filters.team_id && f.track === filters.track
                ) || null;
                return Promise.resolve({ data: row ? { tier: row.tier } : null, error: null });
              },
            };
            return chain;
          },
          upsert(payload, options) {
            assert.deepEqual(options, { onConflict: "team_id,track" });
            state.upserts.push(clone(payload));
            const idx = state.facilities.findIndex(
              (f) => f.team_id === payload.team_id && f.track === payload.track
            );
            if (idx >= 0) state.facilities[idx] = { ...state.facilities[idx], ...payload };
            else state.facilities.push(clone(payload));
            return Promise.resolve({ error: null });
          },
        };
      }

      if (table === "team_staff") {
        return {
          select(_columns) {
            const filters = {};
            const chain = {
              eq(column, value) {
                filters[column] = value;
                return chain;
              },
              maybeSingle() {
                const row = state.staff.find(
                  (r) => Object.entries(filters).every(([k, v]) => r[k] === v)
                ) || null;
                return Promise.resolve({ data: row ? clone(row) : null, error: null });
              },
            };
            return chain;
          },
          insert(payload) {
            const row = { id: `staff-${state.staff.length + 1}`, ...clone(payload) };
            state.staff.push(row);
            state.staffInserts.push(clone(payload));
            return Promise.resolve({ error: null });
          },
          update(payload) {
            return {
              eq(column, value) {
                assert.equal(column, "id");
                const row = state.staff.find((r) => r.id === value);
                assert.ok(row, `team_staff update: ukendt id ${value}`);
                Object.assign(row, payload);
                state.staffUpdates.push({ id: value, payload: clone(payload) });
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

const BASE_ARGS = { teamId: "team-1", seasonId: "season-1", seasonNumber: 7 };

// ─── purchaseFacilityUpgrade ─────────────────────────────────────────────────

test("purchase: debits price, upgrades tier 0→1, writes facility_purchase transaction, sets purchased_season + updated_at", async () => {
  const supabase = createFacilitySupabase({ team: { id: "team-1", balance: 100_000 } });
  const before = Date.now();

  const result = await purchaseFacilityUpgrade(
    { ...BASE_ARGS, track: "training" },
    supabase,
    ENABLED
  );

  assert.deepEqual(result, { ok: true, track: "training", tier: 1, price: FACILITY_TIER_PRICE[1] });
  assert.equal(supabase.state.team.balance, 100_000 - FACILITY_TIER_PRICE[1]);
  assert.equal(supabase.state.finance_transactions.length, 1);
  const tx = supabase.state.finance_transactions[0];
  assert.equal(tx.type, "facility_purchase");
  assert.equal(tx.amount, -FACILITY_TIER_PRICE[1]);
  assert.equal(tx.season_id, "season-1");
  assert.equal(tx.idempotency_key, "facility_purchase:team-1:training:1");
  assert.equal(tx.source_path, "facilityService.purchaseFacilityUpgrade");
  assert.deepEqual(tx.metadata, { code: "tx.facilityPurchase", params: { track: "training", tier: 1 } });

  assert.equal(supabase.state.upserts.length, 1);
  const upsert = supabase.state.upserts[0];
  assert.equal(upsert.team_id, "team-1");
  assert.equal(upsert.track, "training");
  assert.equal(upsert.tier, 1);
  assert.equal(upsert.purchased_season, 7);
  assert.ok(typeof upsert.updated_at === "string");
  const ts = Date.parse(upsert.updated_at);
  assert.ok(ts >= before - 1000 && ts <= Date.now() + 1000, "updated_at skal være nu-agtig ISO-timestamp");
});

test("purchase: tier 4→5 works; tier 5 → max_tier, NO debit", async () => {
  const supabase = createFacilitySupabase({
    team: { id: "team-1", balance: 1_000_000 },
    facilities: [{ team_id: "team-1", track: "medical", tier: 4 }],
  });

  const result = await purchaseFacilityUpgrade({ ...BASE_ARGS, track: "medical" }, supabase, ENABLED);
  assert.deepEqual(result, { ok: true, track: "medical", tier: 5, price: FACILITY_TIER_PRICE[5] });
  assert.equal(supabase.state.finance_transactions.length, 1);

  // Nu tier 5 → max_tier, ingen ny debit.
  const again = await purchaseFacilityUpgrade({ ...BASE_ARGS, track: "medical" }, supabase, ENABLED);
  assert.deepEqual(again, { ok: false, error: "max_tier" });
  assert.equal(supabase.state.finance_transactions.length, 1, "max_tier må ikke debitere");
});

test("purchase: insufficient balance → insufficient_funds, NO debit", async () => {
  const supabase = createFacilitySupabase({ team: { id: "team-1", balance: 10_000 } });

  const result = await purchaseFacilityUpgrade({ ...BASE_ARGS, track: "training" }, supabase, ENABLED);
  assert.deepEqual(result, { ok: false, error: "insufficient_funds" });
  assert.equal(supabase.state.finance_transactions.length, 0);
  assert.equal(supabase.state.upserts.length, 0);
});

test("all three functions gate on FACILITIES_ENABLED=false by default (no flag injection)", async () => {
  const supabase = createFacilitySupabase({ team: { id: "team-1", balance: 1_000_000 } });

  assert.deepEqual(
    await purchaseFacilityUpgrade({ ...BASE_ARGS, track: "training" }, supabase),
    { ok: false, error: "facilities_disabled" }
  );
  assert.deepEqual(
    await hireStaff({ ...BASE_ARGS, role: "training", candidateName: "whoever" }, supabase),
    { ok: false, error: "facilities_disabled" }
  );
  assert.deepEqual(
    await fireStaff({ ...BASE_ARGS, role: "training" }, supabase),
    { ok: false, error: "facilities_disabled" }
  );
  assert.equal(supabase.state.finance_transactions.length, 0);
});

// ─── hireStaff ───────────────────────────────────────────────────────────────

test("hire: happy path inserts active staff with candidate's tier/salary", async () => {
  const supabase = createFacilitySupabase({
    team: { id: "team-1", balance: 1_000_000 },
    facilities: [{ team_id: "team-1", track: "training", tier: 5 }],
  });
  const candidates = generateStaffCandidates({
    teamId: "team-1", seasonNumber: 7, role: "training", facilityTier: 5,
  });
  const candidate = candidates[0];

  const result = await hireStaff(
    { ...BASE_ARGS, role: "training", candidateName: candidate.name },
    supabase,
    ENABLED
  );

  assert.deepEqual(result, {
    ok: true,
    staff: { name: candidate.name, role: "training", tier: candidate.tier, salary: candidate.salary },
  });
  assert.equal(supabase.state.staffInserts.length, 1);
  const inserted = supabase.state.staffInserts[0];
  assert.equal(inserted.team_id, "team-1");
  assert.equal(inserted.name, candidate.name);
  assert.equal(inserted.role, "training");
  assert.equal(inserted.tier, candidate.tier);
  assert.equal(inserted.salary, candidate.salary);
  assert.equal(inserted.hired_season, 7);
  assert.equal(inserted.status, "active");
  // Ingen upfront debit — sæsonløn opkræves af payroll (Task 6).
  assert.equal(supabase.state.finance_transactions.length, 0);
});

test("hire: role occupied → role_occupied, no insert", async () => {
  const supabase = createFacilitySupabase({
    team: { id: "team-1", balance: 1_000_000 },
    facilities: [{ team_id: "team-1", track: "training", tier: 5 }],
    staff: [{ id: "staff-existing", team_id: "team-1", role: "training", status: "active", salary: 10_000, tier: 1 }],
  });

  const result = await hireStaff(
    { ...BASE_ARGS, role: "training", candidateName: "Marc Vandenbroucke" },
    supabase,
    ENABLED
  );
  assert.deepEqual(result, { ok: false, error: "role_occupied" });
  assert.equal(supabase.state.staffInserts.length, 0);
});

test("hire: concurrent insert hits partial unique index (23505) → role_occupied, no throw", async () => {
  const supabase = createFacilitySupabase({
    team: { id: "team-1", balance: 1_000_000 },
    facilities: [{ team_id: "team-1", track: "training", tier: 5 }],
  });
  const candidate = generateStaffCandidates({
    teamId: "team-1", seasonNumber: 7, role: "training", facilityTier: 5,
  })[0];

  // Simulér race: select så ingen aktiv staff, men insert taber til en
  // samtidig hire (partial unique index på (team_id, role) WHERE status='active').
  const originalFrom = supabase.from.bind(supabase);
  supabase.from = (table) => {
    const chain = originalFrom(table);
    if (table === "team_staff") {
      chain.insert = () => Promise.resolve({ error: { code: "23505", message: "duplicate key" } });
    }
    return chain;
  };

  const result = await hireStaff(
    { ...BASE_ARGS, role: "training", candidateName: candidate.name },
    supabase,
    ENABLED
  );
  assert.deepEqual(result, { ok: false, error: "role_occupied" });
});

test("hire: fired staff in role does NOT block a new hire", async () => {
  const supabase = createFacilitySupabase({
    team: { id: "team-1", balance: 1_000_000 },
    facilities: [{ team_id: "team-1", track: "training", tier: 5 }],
    staff: [{ id: "staff-old", team_id: "team-1", role: "training", status: "fired", salary: 10_000, tier: 1 }],
  });
  const candidate = generateStaffCandidates({
    teamId: "team-1", seasonNumber: 7, role: "training", facilityTier: 5,
  })[0];

  const result = await hireStaff(
    { ...BASE_ARGS, role: "training", candidateName: candidate.name },
    supabase,
    ENABLED
  );
  assert.equal(result.ok, true);
  assert.equal(supabase.state.staffInserts.length, 1);
});

test("hire: candidateName not in generated candidates → invalid_candidate", async () => {
  const supabase = createFacilitySupabase({
    team: { id: "team-1", balance: 1_000_000 },
    facilities: [{ team_id: "team-1", track: "training", tier: 5 }],
  });
  const names = new Set(
    generateStaffCandidates({ teamId: "team-1", seasonNumber: 7, role: "training", facilityTier: 5 })
      .map((c) => c.name)
  );
  assert.equal(names.has("Ikke En Kandidat"), false);

  const result = await hireStaff(
    { ...BASE_ARGS, role: "training", candidateName: "Ikke En Kandidat" },
    supabase,
    ENABLED
  );
  assert.deepEqual(result, { ok: false, error: "invalid_candidate" });
  assert.equal(supabase.state.staffInserts.length, 0);
});

test("hire: facilityTier 0 → candidates get tier 1 → staff_tier_exceeds_facility", async () => {
  // Ingen facility-row = tier 0. Kandidat-generatoren teaser tier-1-kandidater,
  // men validateHire blokerer (staff-tier 1 > facilitets-tier 0).
  const supabase = createFacilitySupabase({ team: { id: "team-1", balance: 1_000_000 } });
  const candidate = generateStaffCandidates({
    teamId: "team-1", seasonNumber: 7, role: "training", facilityTier: 0,
  })[0];
  assert.equal(candidate.tier, 1);

  const result = await hireStaff(
    { ...BASE_ARGS, role: "training", candidateName: candidate.name },
    supabase,
    ENABLED
  );
  assert.deepEqual(result, { ok: false, error: "staff_tier_exceeds_facility" });
  assert.equal(supabase.state.staffInserts.length, 0);
});

test("hire: insufficient balance for salary → insufficient_funds, no insert", async () => {
  const supabase = createFacilitySupabase({
    team: { id: "team-1", balance: 0 },
    facilities: [{ team_id: "team-1", track: "training", tier: 5 }],
  });
  const candidate = generateStaffCandidates({
    teamId: "team-1", seasonNumber: 7, role: "training", facilityTier: 5,
  })[0];

  const result = await hireStaff(
    { ...BASE_ARGS, role: "training", candidateName: candidate.name },
    supabase,
    ENABLED
  );
  assert.deepEqual(result, { ok: false, error: "insufficient_funds" });
  assert.equal(supabase.state.staffInserts.length, 0);
});

// ─── idempotent-skip propagation ────────────────────────────────────────────

// Simulér idempotent retry: RPC'en afviser med 23505 (idempotency_key findes
// allerede) → debitTeam returnerer { skipped: true } → resultat flager skipped.
function makeRpcDuplicate(supabase) {
  supabase.rpc = () => Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } });
}

test("purchase: idempotent debit-skip (23505 på idempotency_key) → ok med skipped:true", async () => {
  const supabase = createFacilitySupabase({ team: { id: "team-1", balance: 100_000 } });
  makeRpcDuplicate(supabase);

  const result = await purchaseFacilityUpgrade({ ...BASE_ARGS, track: "training" }, supabase, ENABLED);
  assert.deepEqual(result, {
    ok: true, track: "training", tier: 1, price: FACILITY_TIER_PRICE[1], skipped: true,
  });
  // Upsert kører stadig (re-stamper purchased_season på retry).
  assert.equal(supabase.state.upserts.length, 1);
});

test("fire: idempotent debit-skip → ok med skipped:true, staff stadig fired", async () => {
  const supabase = createFacilitySupabase({
    team: { id: "team-1", balance: 5_000 },
    staff: [{ id: "staff-9", team_id: "team-1", role: "training", status: "active", salary: 22_000, tier: 2 }],
  });
  makeRpcDuplicate(supabase);

  const result = await fireStaff({ ...BASE_ARGS, role: "training" }, supabase, ENABLED);
  assert.deepEqual(result, { ok: true, severance: 11_000, skipped: true });
  assert.equal(supabase.state.staff[0].status, "fired");
});

// ─── fireStaff ───────────────────────────────────────────────────────────────

test("fire: debits severance (round(salary×0.5)), sets status='fired' + fired_season", async () => {
  const supabase = createFacilitySupabase({
    team: { id: "team-1", balance: 5_000 },
    staff: [{ id: "staff-9", team_id: "team-1", role: "training", status: "active", salary: 22_000, tier: 2 }],
  });

  const result = await fireStaff({ ...BASE_ARGS, role: "training" }, supabase, ENABLED);

  assert.deepEqual(result, { ok: true, severance: 11_000 });
  // Severance må debiteres selv om balancen går negativ (fyring tilladt mens broke).
  assert.equal(supabase.state.team.balance, 5_000 - 11_000);
  assert.equal(supabase.state.finance_transactions.length, 1);
  const tx = supabase.state.finance_transactions[0];
  assert.equal(tx.type, "staff_severance");
  assert.equal(tx.amount, -11_000);
  assert.equal(tx.idempotency_key, "staff_severance:team-1:training:staff-9");
  assert.equal(tx.source_path, "facilityService.fireStaff");
  assert.deepEqual(tx.metadata, { code: "tx.staffSeverance", params: { role: "training" } });

  assert.equal(supabase.state.staffUpdates.length, 1);
  assert.equal(supabase.state.staffUpdates[0].id, "staff-9");
  assert.deepEqual(supabase.state.staffUpdates[0].payload, { status: "fired", fired_season: 7 });
  assert.equal(supabase.state.staff[0].status, "fired");
});

test("fire: odd salary rounds severance med Math.round (22_001 → 11_001)", async () => {
  const supabase = createFacilitySupabase({
    team: { id: "team-1", balance: 100_000 },
    staff: [{ id: "staff-odd", team_id: "team-1", role: "training", status: "active", salary: 22_001, tier: 2 }],
  });

  const result = await fireStaff({ ...BASE_ARGS, role: "training" }, supabase, ENABLED);
  assert.deepEqual(result, { ok: true, severance: 11_001 });
  assert.equal(supabase.state.finance_transactions[0].amount, -11_001);
});

test("fire: no active staff → no_active_staff, no debit", async () => {
  const supabase = createFacilitySupabase({
    team: { id: "team-1", balance: 100_000 },
    staff: [{ id: "staff-old", team_id: "team-1", role: "training", status: "fired", salary: 22_000, tier: 2 }],
  });

  const result = await fireStaff({ ...BASE_ARGS, role: "training" }, supabase, ENABLED);
  assert.deepEqual(result, { ok: false, error: "no_active_staff" });
  assert.equal(supabase.state.finance_transactions.length, 0);
  assert.equal(supabase.state.staffUpdates.length, 0);
});
