// #6936 · economy_no_upkeep_v1: fjerner upkeep (fladt + rejse og personale),
// akademi-drift og facilitets-upkeep. Kontrakten testet her:
//   - flag OFF (udeladt eller false) = byte-identisk opkrævning med før #6936,
//   - flag ON = 0 for de tre udgifter, rytterløn og stabsløn uændrede,
//   - idempotent ved sæsonstart (genkørsel trækker ikke igen, hverken ON eller OFF),
//   - prognose/kvittering/admin-preview/flag-evaluering følger flaget.
import test from "node:test";
import assert from "node:assert/strict";

import {
  processTeamSeasonPayroll,
  defaultRunSeasonPayroll,
  chargeFacilityCosts,
  buildSeasonEndPreviewRows,
} from "./economyEngine.js";
import { computeFinanceForecast, computeMultiSeasonForecast } from "./financeForecast.js";
import { buildSeasonSwitchPreview } from "./seasonSwitchPreview.js";
import {
  ECONOMY_NO_UPKEEP_FLAG_KEY,
  evaluateEconomyNoUpkeep,
  isEconomyNoUpkeepEnabled,
} from "./economyNoUpkeepFlag.ts";
import { UPKEEP_BY_DIVISION } from "./economyConstants.js";
import { ACADEMY } from "./academyFlag.js";
import { getFacilityUpkeepTotal } from "./facilityEngine.js";
import { isStageFlagKey } from "./stageFlagCatalog.js";

const REMOVED_TYPES = ["upkeep", "academy_drift", "facility_upkeep"];

// ── Fake Supabase ───────────────────────────────────────────────────────────
// Kædbar query-builder der dækker processTeamSeasonPayroll's læsninger og en
// DB med uniq_finance_idempotency_key (23505 ved gentaget nøgle), så
// idempotensen kan testes end-to-end gennem debitTeam.
function makeLedger() {
  const rows = [];
  const seenKeys = new Set();
  return {
    rows,
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      const key = params.p_finance_payload?.idempotency_key;
      if (key && seenKeys.has(key)) {
        return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } });
      }
      if (key) seenKeys.add(key);
      rows.push({ team_id: params.p_team_id, delta: params.p_delta, ...params.p_finance_payload });
      return Promise.resolve({ data: 0, error: null });
    },
  };
}

function makePayrollSupabase({ academyCount = 3, facilities = [], staff = [], ledger = makeLedger(), appConfig = {} } = {}) {
  const queriedTables = [];
  function builder(table) {
    const filters = {};
    let headCount = false;
    const resolve = () => {
      if (table === "riders") {
        if (headCount) return { count: academyCount, error: null };
        return { data: [], error: null };
      }
      if (table === "team_facilities") return { data: facilities, error: null };
      if (table === "team_staff") return { data: staff, error: null };
      if (table === "teams") return { data: [], error: null };
      if (table === "app_config") return { data: null, error: null };
      throw new Error(`Unexpected table in no-upkeep faken: ${table}`);
    };
    const q = {
      select(_cols, opts) { if (opts?.head) headCount = true; return q; },
      eq(col, val) { filters[col] = val; return q; },
      in() { return q; },
      order() { return q; },
      range() { return Promise.resolve(resolve()); },
      update() { return q; },
      single() {
        if (table === "teams") return Promise.resolve({ data: { balance: 9_999_999 }, error: null });
        return Promise.resolve(resolve());
      },
      maybeSingle() {
        if (table === "app_config") {
          const value = Object.prototype.hasOwnProperty.call(appConfig, filters.key) ? appConfig[filters.key] : null;
          return Promise.resolve({ data: value == null ? null : { value }, error: null });
        }
        return Promise.resolve(resolve());
      },
      then(onOk, onErr) { return Promise.resolve(resolve()).then(onOk, onErr); },
    };
    return q;
  }
  const supabase = {
    rpc: (name, params) => ledger.rpc(name, params),
    from(table) { queriedTables.push(table); return builder(table); },
  };
  return { supabase, ledger, queriedTables };
}

const FACILITIES = [{ track: "training", tier: 2 }, { track: "medical", tier: 1 }];
const STAFF = [{ salary: 40_000 }];
const team = () => ({
  id: "team-a",
  name: "Hold A",
  division: 2,
  balance: 9_999_999,
  riders: [{ id: "r1", salary: 100_000 }, { id: "r2", salary: 50_000 }],
});

async function runPayroll(deps, fixture = {}) {
  const fake = makePayrollSupabase({ facilities: FACILITIES, staff: STAFF, ...fixture });
  const summary = await processTeamSeasonPayroll(team(), "season-5", {
    supabase: fake.supabase,
    seasonNumber: 5,
    facilitiesEnabled: true,
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => {},
    getTotalDebt: async () => 0,
    ...deps,
  });
  return { summary, ...fake };
}

const strip = (rows) => rows.map(({ ...r }) => r);

// ── Motor: sæsonstart ──────────────────────────────────────────────────────

test("#6936 OFF: noUpkeep udeladt og noUpkeep=false giver byte-identisk ledger og summary", async () => {
  const omitted = await runPayroll({});
  const explicitOff = await runPayroll({ noUpkeep: false });
  assert.deepEqual(strip(explicitOff.ledger.rows), strip(omitted.ledger.rows));
  assert.deepEqual(explicitOff.summary, omitted.summary);
  assert.deepEqual(explicitOff.queriedTables, omitted.queriedTables);

  // OFF opkræver stadig alle tre udgifter med de kendte beløb.
  const byType = (t) => omitted.ledger.rows.filter((r) => r.type === t);
  assert.equal(byType("upkeep").length, 1);
  assert.equal(byType("upkeep")[0].amount, -UPKEEP_BY_DIVISION[2]);
  assert.equal(byType("academy_drift")[0].amount, -(3 * ACADEMY.DRIFT_PER_SEASON));
  assert.equal(byType("facility_upkeep")[0].amount, -getFacilityUpkeepTotal(FACILITIES));
  assert.equal(byType("staff_salary")[0].amount, -40_000);
});

test("#6936 ON: ingen upkeep, akademi-drift eller facilitets-upkeep; øvrige poster uændrede", async () => {
  const off = await runPayroll({ noUpkeep: false });
  const on = await runPayroll({ noUpkeep: true });

  for (const type of REMOVED_TYPES) {
    assert.equal(on.ledger.rows.filter((r) => r.type === type).length, 0, `${type} må ikke trækkes med flaget on`);
  }
  assert.equal(on.summary.upkeep_total, 0);
  assert.equal(on.summary.upkeep_count, 0);
  assert.equal(on.summary.facility_upkeep, 0);
  assert.ok(!on.queriedTables.includes("team_facilities"), "facilitets-sporene læses ikke når upkeep er fjernet");

  // Alt andet (rytterløn, stabsløn, ...) er præcis som med flaget off.
  const keep = (rows) => strip(rows).filter((r) => !REMOVED_TYPES.includes(r.type));
  assert.deepEqual(keep(on.ledger.rows), keep(off.ledger.rows));
  assert.ok(on.ledger.rows.some((r) => r.type === "staff_salary"), "stabsløn trækkes stadig");
  assert.equal(on.summary.staff_salary, off.summary.staff_salary);
  assert.equal(on.summary.salary, off.summary.salary);
});

test("#6936 idempotens ved sæsonstart: genkørsel trækker intet nyt (ON og OFF)", async () => {
  for (const noUpkeep of [true, false]) {
    const ledger = makeLedger();
    await runPayroll({ noUpkeep }, { ledger });
    const afterFirst = ledger.rows.length;
    await runPayroll({ noUpkeep }, { ledger });
    assert.equal(ledger.rows.length, afterFirst, `noUpkeep=${noUpkeep}: anden kørsel må ikke skrive nye poster`);
    if (noUpkeep) {
      assert.equal(ledger.rows.filter((r) => REMOVED_TYPES.includes(r.type)).length, 0);
    }
  }
});

test("#6936 chargeFacilityCosts: chargeFacilityUpkeep=false springer kun facilitets-upkeep over", async () => {
  const fake = makePayrollSupabase({ facilities: FACILITIES, staff: STAFF });
  const res = await chargeFacilityCosts({
    team: team(), seasonId: "season-5", supabaseClient: fake.supabase, enabled: true, chargeFacilityUpkeep: false,
  });
  assert.equal(res.facilityUpkeepCharged, 0);
  assert.equal(res.staffSalaryCharged, 40_000);
  assert.deepEqual(fake.ledger.rows.map((r) => r.type), ["staff_salary"]);
});

test("#6936 defaultRunSeasonPayroll læser economy_no_upkeep_v1 fra app_config", async () => {
  const fake = makePayrollSupabase({ appConfig: { [ECONOMY_NO_UPKEEP_FLAG_KEY]: "on" } });
  await defaultRunSeasonPayroll(fake.supabase, "season-5", {});
  assert.ok(fake.queriedTables.includes("app_config"));
});

// ── Flag-evaluering ────────────────────────────────────────────────────────

test("#6936 flag: kun 'on'/true slukker udgifterne; off/beta/null/fejl = off", async () => {
  assert.equal(evaluateEconomyNoUpkeep("on"), true);
  assert.equal(evaluateEconomyNoUpkeep(true), true);
  for (const raw of ["off", "beta", null, undefined, false, "ON", 1]) {
    assert.equal(evaluateEconomyNoUpkeep(raw), false, `${String(raw)} skal læses som off`);
  }
  const on = makePayrollSupabase({ appConfig: { [ECONOMY_NO_UPKEEP_FLAG_KEY]: "on" } });
  assert.equal(await isEconomyNoUpkeepEnabled(on.supabase), true);
  const missing = makePayrollSupabase();
  assert.equal(await isEconomyNoUpkeepEnabled(missing.supabase), false);
  const broken = { from() { throw new Error("db nede"); } };
  assert.equal(await isEconomyNoUpkeepEnabled(broken), false, "fejlet læsning = off");
  assert.equal(isStageFlagKey(ECONOMY_NO_UPKEEP_FLAG_KEY), true, "flaget skal kunne flyttes fra admin-tavlen");
});

// ── Prognose, sæsonskifte-kvittering og admin-preview ──────────────────────

const forecastInput = {
  team: { id: "team-a", division: 2, balance: 500_000 },
  riders: [{ salary: 100_000, prize_earnings_bonus: 20_000 }],
  currentSeasonNumber: 4,
  facilityTracks: FACILITIES,
  activeStaffSalaries: [{ salary: 40_000 }],
  academyRiderCount: 3,
  facilitiesEnabled: true,
};

test("#6936 prognose OFF: noUpkeep udeladt = noUpkeep false (byte-identisk)", () => {
  for (const upkeepPerRaceDay of [false, true]) {
    const omitted = computeFinanceForecast({ ...forecastInput, upkeepPerRaceDay });
    const off = computeFinanceForecast({ ...forecastInput, upkeepPerRaceDay, noUpkeep: false });
    assert.deepEqual(off, omitted);
    assert.ok(omitted.projected_upkeep < 0);
    assert.ok(omitted.projected_facility_upkeep < 0);
    assert.ok(omitted.projected_academy_drift < 0);
  }
});

test("#6936 prognose ON: de tre udgifter er 0, nettoet stiger præcis med deres sum", () => {
  for (const upkeepPerRaceDay of [false, true]) {
    const off = computeFinanceForecast({ ...forecastInput, upkeepPerRaceDay });
    const on = computeFinanceForecast({ ...forecastInput, upkeepPerRaceDay, noUpkeep: true });
    assert.equal(on.projected_upkeep, 0);
    assert.equal(on.projected_upkeep_at_season_start, 0);
    assert.equal(on.projected_facility_upkeep, 0);
    assert.equal(on.projected_academy_drift, 0);
    assert.equal(on.projected_staff_salary, off.projected_staff_salary, "stabsløn uændret");
    assert.equal(on.projected_staff_facilities, off.projected_staff_salary);
    assert.equal(on.projected_salary, off.projected_salary);
    assert.equal(on.projected_sponsor, off.projected_sponsor);
    assert.equal(
      on.projected_net,
      off.projected_net - off.projected_upkeep - off.projected_facility_upkeep - off.projected_academy_drift,
    );
    assert.equal(on.inputs.no_upkeep, true);
    assert.equal(off.inputs.no_upkeep, false);
  }
});

test("#6936 flersæsons-prognose fører noUpkeep igennem hele horisonten", () => {
  const multi = computeMultiSeasonForecast({ ...forecastInput, seasonsAhead: 3, noUpkeep: true });
  assert.equal(multi.forecasts.length, 3);
  for (const f of multi.forecasts) {
    assert.equal(f.projected_upkeep, 0);
    assert.equal(f.projected_facility_upkeep, 0);
    assert.equal(f.projected_academy_drift, 0);
  }
});

test("#6936 sæsonskifte-kvittering ON: ingen akademi-, upkeep- eller facilitets-trin; S2 (historik) uændret", () => {
  const transactions = [
    { reason_code: "season_start_upkeep", amount: -70_000 },
    { reason_code: "race_day_travel_staff", amount: -1_000 },
    { reason_code: "season_start_facility_upkeep", amount: -5_000 },
    { reason_code: "season_start_academy_drift", amount: -15_000 },
  ];
  const s3 = computeFinanceForecast({ ...forecastInput, noUpkeep: true });
  const preview = buildSeasonSwitchPreview({ transactions, riders: [], startingBalance: 500_000, s3 });
  const keys = preview.settlement.steps.map((s) => s.key);
  for (const removed of ["academy_drift", "upkeep", "facility_upkeep"]) {
    assert.ok(!keys.includes(removed), `${removed}-trinnet skal skjules`);
  }
  assert.ok(keys.includes("staff_salary"), "stabsløn-trinnet står der stadig");
  assert.equal(preview.s3.upkeep, 0);
  assert.equal(preview.s3.facility_upkeep, 0);
  assert.equal(preview.s3.academy_drift, 0);
  // Indeværende sæsons realiserede tal er historik og vises uændret.
  assert.equal(preview.s2.upkeep, -71_000);
  assert.equal(preview.s2.facility_upkeep, -5_000);
  assert.equal(preview.s2.academy_drift, -15_000);
});

test("#6936 admin-preview af sæsonskiftet: upkeep 0 med flaget on, uændret med off", () => {
  const teams = [{ id: "team-a", name: "Hold A", division: 2, balance: 100_000, sponsor_income: 0, riders: [] }];
  const [off] = buildSeasonEndPreviewRows({ teams });
  const [explicitOff] = buildSeasonEndPreviewRows({ teams, noUpkeep: false });
  const [on] = buildSeasonEndPreviewRows({ teams, noUpkeep: true });
  assert.deepEqual(explicitOff, off);
  assert.equal(off.upkeep, UPKEEP_BY_DIVISION[2]);
  assert.equal(on.upkeep, 0);
  assert.equal(on.balance_after, off.balance_after + UPKEEP_BY_DIVISION[2]);
});
