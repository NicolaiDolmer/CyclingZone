import test from "node:test";
import assert from "node:assert/strict";

import { promote, demote, demoteSalary } from "./academyTransfer.js";
import { computeFrozenSalary, computeContractEndSeason, CONTRACT } from "./contractSeed.js";
import { ACADEMY } from "./academyFlag.js";

// ─── Mock-supabase ─────────────────────────────────────────────────────────────
// promote bruger: riders (maybeSingle load + update), academy_graduation
// (maybeSingle load + update), getMarketState (injiceret). demote bruger: riders
// (maybeSingle load), rpc("demote_rider_to_academy"). notify injiceres som spy.

function makeSupabase(cfg = {}) {
  const rec = { riderUpdates: [], gradUpdates: [], gradSelects: [], rpcCalls: [] };
  const supabase = {
    from(table) {
      if (table === "riders") {
        return {
          select() {
            const api = {
              eq() { return api; },
              maybeSingle() { return Promise.resolve({ data: cfg.rider ?? null, error: cfg.riderError ?? null }); },
            };
            return api;
          },
          update(payload) {
            return {
              eq() {
                rec.riderUpdates.push(payload);
                return Promise.resolve({ error: cfg.riderUpdateError ?? null });
              },
            };
          },
        };
      }
      if (table === "academy_graduation") {
        return {
          select() {
            const api = {
              eq(col, val) { rec.gradSelects.push([col, val]); return api; },
              maybeSingle() { return Promise.resolve({ data: cfg.gradRow ?? null, error: null }); },
            };
            return api;
          },
          update(payload) {
            return {
              eq() {
                const chain = { eq() { rec.gradUpdates.push(payload); return Promise.resolve({ error: null }); } };
                return chain;
              },
            };
          },
        };
      }
      if (table === "teams") {
        // #2594: demote() slår det demoverende holds division op for at prissætte
        // akademi-lønnen (per-division sats).
        return {
          select() {
            const api = {
              eq() { return api; },
              maybeSingle() { return Promise.resolve({ data: cfg.team ?? { id: "t1", division: 3 }, error: null }); },
            };
            return api;
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc(fn, args) {
      rec.rpcCalls.push({ fn, args });
      return Promise.resolve({ data: cfg.rpcResult ?? null, error: cfg.rpcError ?? null });
    },
  };
  return { supabase, rec };
}

function spyNotify() {
  const calls = [];
  const fn = async (payload) => { calls.push(payload); return { delivered: true }; };
  fn.calls = calls;
  return fn;
}

const ACADEMY_RIDER = {
  id: "r1", team_id: "t1", firstname: "Up", lastname: "Coming",
  is_academy: true, base_value: 100000, prize_earnings_bonus: 0, salary: 670,
};
// #2881: akademi-rytter uden nogen kontrakt endnu (salary == null) — skal
// stadig få en frisk standard-kontrakt ved promote.
const CONTRACTLESS_ACADEMY_RIDER = {
  id: "r3", team_id: "t1", firstname: "Fresh", lastname: "Intake",
  is_academy: true, base_value: 50000, prize_earnings_bonus: 0,
  current_production_value: 20_000, salary: null,
};
// #2881: akademi-rytter der bærer en OVERLEVET senior-kontrakt (fx fra før et
// akademi-ophold, sæson 1 med 3 sæsoners restløbetid) — promote må IKKE røre
// disse felter.
const ACADEMY_RIDER_WITH_SURVIVING_CONTRACT = {
  id: "r4", team_id: "t1", firstname: "Old", lastname: "Contract",
  is_academy: true, base_value: 200000, prize_earnings_bonus: 0,
  current_production_value: 80_000, salary: 12_000,
  contract_length: 3, contract_end_season: 3,
};
const SENIOR_U23 = {
  id: "r2", team_id: "t1", firstname: "Young", lastname: "Senior",
  is_academy: false, current_production_value: 50_000, birthdate: "2005-06-15", salary: 3350,
};

// ─── demoteSalary helper ──────────────────────────────────────────────────────
// demoteSalary er en ren delegation til computeFrozenSalary — ét fælles løn-system.
// #3360: testen pinner delegationen (og at ALLE grundlags-felter føres igennem),
// ikke et tal fra ét bestemt grundlag. De eksakte formler pinnes i salaryBasis.test.js.

test("demoteSalary: ren delegation til computeFrozenSalary, alle grundlags-felter føres igennem", () => {
  const rider = { current_production_value: 50_000, market_value: 50_000, base_value: 50_000 };
  assert.equal(demoteSalary({ ...rider, division: 3 }), computeFrozenSalary({ ...rider, division: 3 }));
  assert.equal(demoteSalary({}), computeFrozenSalary({}));
  assert.ok(demoteSalary({ ...rider, division: 3 }) > demoteSalary({}),
    "en rytter med værdi må aldrig få fallback-lønnen");
});

// ─── promote ──────────────────────────────────────────────────────────────────

test("promote: is_academy=false + kontraktløs rytter (salary==null) får standard-kontrakt; notify", async () => {
  const { supabase, rec } = makeSupabase({ rider: CONTRACTLESS_ACADEMY_RIDER, gradRow: null });
  const notify = spyNotify();
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 10, division: 3 });
  const res = await promote(supabase, { teamId: "t1", riderId: "r3", seasonNumber: 1, getMarketState, notify });

  assert.equal(res.action, "promoted");
  assert.equal(rec.riderUpdates.length, 1);
  assert.equal(rec.riderUpdates[0].is_academy, false);
  assert.equal(rec.riderUpdates[0].salary, computeFrozenSalary({ ...CONTRACTLESS_ACADEMY_RIDER, division: 3 }));
  assert.equal(rec.riderUpdates[0].contract_length, CONTRACT.DEFAULT_ACQUIRE_LENGTH);
  assert.equal(rec.riderUpdates[0].contract_end_season, computeContractEndSeason(1, CONTRACT.DEFAULT_ACQUIRE_LENGTH));
  assert.equal(notify.calls.length, 1);
  assert.equal(notify.calls[0].type, "academy_promoted");
  assert.equal(res.salary, computeFrozenSalary({ ...CONTRACTLESS_ACADEMY_RIDER, division: 3 }));
});

// #2881 regression: promote() overskrev UBETINGET en eksisterende kontrakt
// (3 resterende sæsoner → 2, ny løn) — brød #1309-invarianten ("eksisterende
// kontrakt arves uændret — regenerér ALDRIG"). Låser fast at en akademi-rytter
// der allerede har kontraktfelter (overlevet fra før akademi-opholdet) IKKE
// får sin løn/længde/udløbssæson rørt ved promote — kun is_academy flipper.
test("promote: #2881 — eksisterende kontrakt (3 sæsoner) overlever UÆNDRET, kun is_academy flipper", async () => {
  const { supabase, rec } = makeSupabase({ rider: ACADEMY_RIDER_WITH_SURVIVING_CONTRACT, gradRow: null });
  const notify = spyNotify();
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 10, division: 2 });
  const res = await promote(supabase, { teamId: "t1", riderId: "r4", seasonNumber: 1, getMarketState, notify });

  assert.equal(res.action, "promoted");
  assert.equal(rec.riderUpdates.length, 1);
  assert.deepEqual(rec.riderUpdates[0], { is_academy: false }, "salary/contract_length/contract_end_season slet ikke i patchen");
  assert.equal(res.salary, ACADEMY_RIDER_WITH_SURVIVING_CONTRACT.salary, "returneret løn = den overlevede kontraktløn, ikke en ny beregning");
});

test("promote: resolver pending academy_graduation-row til 'promoted'", async () => {
  const { supabase, rec } = makeSupabase({ rider: ACADEMY_RIDER, gradRow: { id: "g1", status: "pending" } });
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 10 });
  await promote(supabase, { teamId: "t1", riderId: "r1", seasonNumber: 1, getMarketState, notify: spyNotify() });
  assert.equal(rec.gradUpdates.length, 1, "pending grad-row blev resolved");
  assert.equal(rec.gradUpdates[0].status, "promoted");
  assert.ok(rec.gradUpdates[0].resolved_at, "resolved_at sat");
});

test("promote: ingen grad-row → ingen grad-update (men promote lykkes)", async () => {
  const { supabase, rec } = makeSupabase({ rider: ACADEMY_RIDER, gradRow: null });
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 10 });
  const res = await promote(supabase, { teamId: "t1", riderId: "r1", seasonNumber: 1, getMarketState, notify: spyNotify() });
  assert.equal(res.action, "promoted");
  assert.equal(rec.gradUpdates.length, 0);
});

test("promote: afviser ved fuld senior-trup (squad_cap_violation)", async () => {
  const { supabase } = makeSupabase({ rider: ACADEMY_RIDER });
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 30 });
  await assert.rejects(
    () => promote(supabase, { teamId: "t1", riderId: "r1", seasonNumber: 1, getMarketState, notify: spyNotify() }),
    /squad_cap_violation/,
  );
});

test("promote: afviser ukendt rytter (rider_not_found)", async () => {
  const { supabase } = makeSupabase({ rider: null });
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 5 });
  await assert.rejects(
    () => promote(supabase, { teamId: "t1", riderId: "rX", seasonNumber: 1, getMarketState, notify: spyNotify() }),
    /rider_not_found/,
  );
});

test("promote: afviser rytter på andet hold (not_owned)", async () => {
  const { supabase } = makeSupabase({ rider: { ...ACADEMY_RIDER, team_id: "OTHER" } });
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 5 });
  await assert.rejects(
    () => promote(supabase, { teamId: "t1", riderId: "r1", seasonNumber: 1, getMarketState, notify: spyNotify() }),
    /not_owned/,
  );
});

test("promote: afviser senior-rytter (not_academy)", async () => {
  const { supabase } = makeSupabase({ rider: { ...ACADEMY_RIDER, is_academy: false } });
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 5 });
  await assert.rejects(
    () => promote(supabase, { teamId: "t1", riderId: "r1", seasonNumber: 1, getMarketState, notify: spyNotify() }),
    /not_academy/,
  );
});

test("promote: kaster ved rider-update-fejl", async () => {
  const { supabase } = makeSupabase({ rider: ACADEMY_RIDER, riderUpdateError: { message: "boom" } });
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 5 });
  await assert.rejects(
    () => promote(supabase, { teamId: "t1", riderId: "r1", seasonNumber: 1, getMarketState, notify: spyNotify() }),
    /boom/,
  );
});

// ─── demote ──────────────────────────────────────────────────────────────────

test("demote: kalder RPC med korrekt løn + sæson-år + kontrakt; notify; returnerer racesCleared", async () => {
  // mock-teams-lookup i makeSupabase svarer med division 3 (default) → 50_000 × 0.1481 = 7_405.
  const expectedSalary = demoteSalary({ current_production_value: 50_000, division: 3 });
  const { supabase, rec } = makeSupabase({
    rider: SENIOR_U23,
    rpcResult: { ok: true, new_salary: expectedSalary, rows_deleted: 3 },
  });
  const notify = spyNotify();
  // seasonNumber 1 → p_season_start_year = 2026 + 0 = 2026
  const res = await demote(supabase, { teamId: "t1", riderId: "r2", seasonNumber: 1, notify });

  assert.equal(rec.rpcCalls.length, 1);
  assert.equal(rec.rpcCalls[0].fn, "demote_rider_to_academy");
  const a = rec.rpcCalls[0].args;
  assert.equal(a.p_team_id, "t1");
  assert.equal(a.p_rider_id, "r2");
  assert.equal(a.p_new_salary, expectedSalary);
  assert.equal(a.p_season_start_year, 2026);
  assert.equal(a.p_contract_length, ACADEMY.CONTRACT_LENGTH);
  assert.equal(a.p_contract_end, computeContractEndSeason(1, ACADEMY.CONTRACT_LENGTH));

  assert.equal(res.action, "demoted");
  assert.equal(res.riderId, "r2");
  assert.equal(res.newSalary, expectedSalary);
  assert.equal(res.racesCleared, 3);
  assert.equal(notify.calls.length, 1);
  assert.equal(notify.calls[0].type, "academy_demoted");
});

test("demote: p_season_start_year følger seasonNumber (sæson 3 → 2028)", async () => {
  const { supabase, rec } = makeSupabase({
    rider: SENIOR_U23,
    rpcResult: { ok: true, new_salary: 5000, rows_deleted: 0 },
  });
  await demote(supabase, { teamId: "t1", riderId: "r2", seasonNumber: 3, notify: spyNotify() });
  assert.equal(rec.rpcCalls[0].args.p_season_start_year, 2028);
});

test("demote: ukendt rytter → rider_not_found (ingen RPC)", async () => {
  const { supabase, rec } = makeSupabase({ rider: null });
  await assert.rejects(
    () => demote(supabase, { teamId: "t1", riderId: "rX", seasonNumber: 1, notify: spyNotify() }),
    /rider_not_found/,
  );
  assert.equal(rec.rpcCalls.length, 0);
});

test("demote: maper RPC ok=false-koder til named errors", async () => {
  const cases = [
    ["not_owned", /not_owned/],
    ["already_academy", /already_academy/],
    ["not_u23", /not_u23/],
    ["rider_on_market", /rider_on_market/],
    ["rider_listed", /rider_listed/],
    ["academy_full", /academy_full/],
  ];
  for (const [code, re] of cases) {
    const { supabase } = makeSupabase({ rider: SENIOR_U23, rpcResult: { ok: false, code } });
    await assert.rejects(
      () => demote(supabase, { teamId: "t1", riderId: "r2", seasonNumber: 1, notify: spyNotify() }),
      re,
      `kode ${code} skal kaste`,
    );
  }
});

test("demote: RPC-transportfejl kastes", async () => {
  const { supabase } = makeSupabase({ rider: SENIOR_U23, rpcError: { message: "db down" } });
  await assert.rejects(
    () => demote(supabase, { teamId: "t1", riderId: "r2", seasonNumber: 1, notify: spyNotify() }),
    /db down/,
  );
});

test("demote: ok=false uden notify (ingen falsk demote-notifikation)", async () => {
  const { supabase } = makeSupabase({ rider: SENIOR_U23, rpcResult: { ok: false, code: "not_u23" } });
  const notify = spyNotify();
  await assert.rejects(() => demote(supabase, { teamId: "t1", riderId: "r2", seasonNumber: 1, notify }));
  assert.equal(notify.calls.length, 0, "ingen notifikation ved afvist demote");
});
