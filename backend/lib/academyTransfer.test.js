import test from "node:test";
import assert from "node:assert/strict";

import { promote, demote, demoteSalary } from "./academyTransfer.js";
import { computeFrozenSalary, computeContractEndSeason, CONTRACT } from "./contractSeed.js";
import { ACADEMY } from "./academyFlag.js";

// ─── Mock-supabase ─────────────────────────────────────────────────────────────
// promote bruger: riders (maybeSingle load + update), academy_graduation
// (maybeSingle load + update), getMarketState (injiceret). demote bruger: riders
// (maybeSingle load), rpc("demote_rider_to_academy"). notify injiceres som spy.

// #3620: mocken PROJEKTERER fixturen ned til de kolonner kalderen faktisk
// SELECT'er — som PostgREST gør. Før returnerede den hele fixturen uanset
// kolonne-liste, og DERFOR kunne #2881-regressionstesten stå grøn i et helt år
// mens produktionens SELECT manglede contract_end_season: testen fodrede
// contractOnAcquirePatch et felt som prod aldrig hentede. En mock der ignorerer
// kolonne-listen kan ikke bevise en SELECT-kontrakt — den beviser kun logikken
// oven på et objekt ingen rute nogensinde bygger.
// En kolonne der er SELECT'et men mangler i fixturen bliver `null` (= NULL i DB),
// ikke `undefined` — det er forskellen guarden i contractOnAcquirePatch lever af.
function projectSelect(row, columns) {
  if (!row) return row;
  const wanted = String(columns ?? "").split(",").map((c) => c.trim()).filter(Boolean);
  if (wanted.length === 0 || wanted.includes("*")) return row;
  const out = {};
  for (const col of wanted) out[col] = col in row ? row[col] : null;
  return out;
}

function makeSupabase(cfg = {}) {
  const rec = { riderUpdates: [], gradUpdates: [], gradSelects: [], rpcCalls: [], riderSelects: [] };
  const supabase = {
    from(table) {
      if (table === "riders") {
        return {
          select(columns) {
            rec.riderSelects.push(columns);
            const api = {
              eq() { return api; },
              maybeSingle() {
                return Promise.resolve({
                  data: cfg.riderError ? null : projectSelect(cfg.rider ?? null, columns),
                  error: cfg.riderError ?? null,
                });
              },
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
// #3620: U23-senior manageren har FORLÆNGET (udløb sæson 5, aktiv sæson 2) —
// præcis den rytter spillerne rapporterede kom ud af akademiet med udløb i
// sæson 4. Demote må ikke røre termen.
const SENIOR_U23_WITH_EXTENDED_CONTRACT = {
  id: "r5", team_id: "t1", firstname: "Extended", lastname: "Senior",
  is_academy: false, current_production_value: 50_000, birthdate: "2005-06-15",
  salary: 9_000, contract_length: 3, contract_end_season: 5,
};

// ─── demoteSalary helper ──────────────────────────────────────────────────────
// #2594: demoteSalary er nu en ren delegation til computeFrozenSalary —
// current_production_value × per-division sats (ikke længere ACADEMY.SALARY_RATE
// × base_value).

test("demoteSalary: computeFrozenSalary-delegation (current_production_value × per-division sats, gulvet på 1)", () => {
  assert.equal(demoteSalary({ current_production_value: 50_000, division: 3 }), 7_405); // 50_000 × 0.1481
  assert.equal(demoteSalary({ current_production_value: null }), 161); // fallback 1000 × global (0.1606)
  assert.equal(demoteSalary({ current_production_value: 1, division: 1 }), 1, "round(1×0.3029)=0 → gulvet til 1");
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

// #3620 regression: #2881-testen ovenfor stod grøn mens prod var i stykker, fordi
// mocken ignorerede kolonne-listen. Nu projekteres fixturen, så testen ovenfor
// KUN kan passere hvis SELECTen faktisk henter contract_end_season. Denne test
// låser kolonne-kontrakten eksplicit fast, så et fremtidigt trim af listen fejler
// med en læsbar besked i stedet for som en tavs kontrakt-regenerering i prod.
test("promote: #3620 — SELECTen henter kontrakt-kolonnerne (ellers regenererer guarden i blinde)", async () => {
  const { supabase, rec } = makeSupabase({ rider: ACADEMY_RIDER_WITH_SURVIVING_CONTRACT, gradRow: null });
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 10, division: 2 });
  await promote(supabase, { teamId: "t1", riderId: "r4", seasonNumber: 2, getMarketState, notify: spyNotify() });

  assert.equal(rec.riderSelects.length, 1);
  assert.match(rec.riderSelects[0], /\bcontract_end_season\b/);
  assert.match(rec.riderSelects[0], /\bcontract_length\b/);
  assert.match(rec.riderSelects[0], /\bsalary\b/);
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

// #3620 regression: demote skrev UBETINGET en frisk akademi-kontrakt forankret i
// den aktuelle sæson. En rytter forlænget til sæson 5, demoted i sæson 2, kom ud
// med udløb sæson 4 (2 + 3 - 1) — rapporteret i prod 10/8. Kontrakt-termen skal
// arves uændret; kun lønnen gen-beregnes.
test("demote: #3620 — eksisterende kontrakt-term arves uændret (sæson 5 forbliver sæson 5)", async () => {
  const { supabase, rec } = makeSupabase({
    rider: SENIOR_U23_WITH_EXTENDED_CONTRACT,
    rpcResult: { ok: true, new_salary: 7_405, rows_deleted: 0 },
  });
  await demote(supabase, { teamId: "t1", riderId: "r5", seasonNumber: 2, notify: spyNotify() });

  const a = rec.rpcCalls[0].args;
  assert.equal(a.p_contract_end, 5, "udløbssæsonen må ikke rykkes frem af et akademi-ophold");
  assert.equal(a.p_contract_length, 3);
  assert.notEqual(
    a.p_contract_end,
    computeContractEndSeason(2, ACADEMY.CONTRACT_LENGTH),
    "må IKKE forankres i den aktuelle sæson (det var netop bug'en)",
  );
});

// Modstykket: en kontraktløs rytter (ingen komplet kontrakt) skal stadig få
// akademi-aftalen — create-if-missing, præcis som contractOnAcquirePatch.
test("demote: #3620 — kontraktløs rytter får stadig akademi-aftalen (create-if-missing)", async () => {
  const { supabase, rec } = makeSupabase({
    rider: { ...SENIOR_U23, salary: null },
    rpcResult: { ok: true, new_salary: 161, rows_deleted: 0 },
  });
  await demote(supabase, { teamId: "t1", riderId: "r2", seasonNumber: 2, notify: spyNotify() });

  const a = rec.rpcCalls[0].args;
  assert.equal(a.p_contract_length, ACADEMY.CONTRACT_LENGTH);
  assert.equal(a.p_contract_end, computeContractEndSeason(2, ACADEMY.CONTRACT_LENGTH));
});

// Promote/demote skal være hinandens inverse på kontrakt-termen: en tur ned og op
// igen må hverken forkorte ELLER forlænge kontrakten (ellers er demote+promote et
// gratis forlængelses-loop uden om #3143-loftet).
test("demote → promote: #3620 — rundturen efterlader kontrakt-termen urørt", async () => {
  const down = makeSupabase({
    rider: SENIOR_U23_WITH_EXTENDED_CONTRACT,
    rpcResult: { ok: true, new_salary: 7_405, rows_deleted: 0 },
  });
  await demote(down.supabase, { teamId: "t1", riderId: "r5", seasonNumber: 2, notify: spyNotify() });
  const afterDemote = down.rec.rpcCalls[0].args;

  const up = makeSupabase({
    rider: {
      ...SENIOR_U23_WITH_EXTENDED_CONTRACT,
      is_academy: true,
      salary: afterDemote.p_new_salary,
      contract_length: afterDemote.p_contract_length,
      contract_end_season: afterDemote.p_contract_end,
    },
    gradRow: null,
  });
  const getMarketState = async () => ({ squad_limits: { max: 30 }, future_count: 10, division: 3 });
  await promote(up.supabase, { teamId: "t1", riderId: "r5", seasonNumber: 2, getMarketState, notify: spyNotify() });

  assert.deepEqual(
    up.rec.riderUpdates[0],
    { is_academy: false },
    "promote må ikke røre kontraktfelterne på vej op igen",
  );
  assert.equal(afterDemote.p_contract_end, SENIOR_U23_WITH_EXTENDED_CONTRACT.contract_end_season);
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
