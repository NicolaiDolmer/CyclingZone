import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

import {
  ageBandKey,
  buildDryRunReport,
  decideApplyAllowed,
  runMarketValueLevelCorrectionApply,
  MARKET_VALUE_LEVEL_CORRECTION_NOTIFICATION_TYPE,
} from "./marketValueLevelCorrectionApply.js";

// ─── ageBandKey ────────────────────────────────────────────────────────────

test("ageBandKey: samme 5 bånd som scratchpad-måle-noten 19/8", () => {
  assert.equal(ageBandKey(19), "<23");
  assert.equal(ageBandKey(22), "<23");
  assert.equal(ageBandKey(23), "23-25");
  assert.equal(ageBandKey(25), "23-25");
  assert.equal(ageBandKey(26), "26-28");
  assert.equal(ageBandKey(28), "26-28");
  assert.equal(ageBandKey(29), "29-31");
  assert.equal(ageBandKey(31), "29-31");
  assert.equal(ageBandKey(32), "32+");
  assert.equal(ageBandKey(40), "32+");
  assert.equal(ageBandKey(null), "ukendt");
  assert.equal(ageBandKey(undefined), "ukendt");
});

// ─── decideApplyAllowed ────────────────────────────────────────────────────

test("decideApplyAllowed: NÆGTER når gaten er rød", () => {
  const d = decideApplyAllowed({ gate: { gate_status: "red", c_candidate: null }, confirmApply: true });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, "gate_not_green");
});

test("decideApplyAllowed: NÆGTER når ingen gate-måling findes overhovedet", () => {
  const d = decideApplyAllowed({ gate: null, confirmApply: true });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, "gate_not_green");
});

test("decideApplyAllowed: NÆGTER grøn gate uden c_candidate (defensivt — bør ikke ske)", () => {
  const d = decideApplyAllowed({ gate: { gate_status: "green", c_candidate: null }, confirmApply: true });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, "no_c_candidate");
});

test("decideApplyAllowed: NÆGTER grøn gate uden --confirm-apply (dry-run ikke godkendt)", () => {
  const d = decideApplyAllowed({ gate: { gate_status: "green", c_candidate: 0.69 }, confirmApply: false });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, "dry_run_not_approved");
});

test("decideApplyAllowed: TILLADER grøn gate + confirmApply", () => {
  const d = decideApplyAllowed({ gate: { gate_status: "green", c_candidate: 0.6918 }, confirmApply: true });
  assert.equal(d.allowed, true);
  assert.equal(d.c, 0.6918);
});

// ─── buildDryRunReport ─────────────────────────────────────────────────────

test("buildDryRunReport: ren skalering giver SAMME delta% for alle divisioner/aldersbånd (scratchpad-signatur)", () => {
  const c = 0.6918;
  const rows = [
    { id: "r1", current_value: 10_000, division: 1, age: 21 },
    { id: "r2", current_value: 200_000, division: 1, age: 27 },
    { id: "r3", current_value: 5_000, division: 2, age: 35 },
    { id: "r4", current_value: 50_000, division: 2, age: 24 },
  ];
  const report = buildDryRunReport(rows, c);
  assert.equal(report.populationSize, 4);
  const expectedPct = c - 1;
  assert.ok(Math.abs(report.totalDeltaPct - expectedPct) < 0.001);
  for (const d of report.byDivision) assert.ok(Math.abs(d.deltaPct - expectedPct) < 0.001, `division ${d.division}`);
  for (const b of report.byAgeBand) assert.ok(Math.abs(b.deltaPct - expectedPct) < 0.001, `band ${b.band}`);
});

test("buildDryRunReport: top10Drops sorteret mest-negative-først, aldrig stigninger ved c<1", () => {
  const c = 0.5;
  const rows = [
    { id: "cheap", current_value: 100, division: 3, age: 30 },
    { id: "expensive", current_value: 1_000_000, division: 1, age: 24 },
    { id: "mid", current_value: 10_000, division: 2, age: 26 },
  ];
  const report = buildDryRunReport(rows, c);
  assert.equal(report.top10Drops[0].id, "expensive");
  for (const t of report.top10Drops) assert.ok(t.delta <= 0, "c<1 kan aldrig give en stigning");
});

test("buildDryRunReport: værdi rundes ned til minimum 1 (aldrig 0 eller negativ)", () => {
  const report = buildDryRunReport([{ id: "r1", current_value: 1, division: 1, age: 20 }], 0.01);
  assert.equal(report.top10Drops[0].after, 1);
});

// ─── runMarketValueLevelCorrectionApply (fuld orkestrering, mocket DB) ─────

function makeMockSupabase() {
  const riderUpdates = [];
  const configUpdates = [];
  const receiptInserts = [];
  let applyLogInsert = null;

  function table(name) {
    if (name === "riders") {
      return {
        update(patch) {
          return {
            eq(_col, id) {
              riderUpdates.push({ id, ...patch });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    }
    if (name === "app_config") {
      return {
        update(patch) {
          return {
            eq(_col, key) {
              configUpdates.push({ key, ...patch });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    }
    if (name === "market_value_level_correction_apply_log") {
      return {
        insert(row) {
          applyLogInsert = row;
          return {
            select() {
              return { single: () => Promise.resolve({ data: { id: "apply-log-1", ...row }, error: null }) };
            },
          };
        },
      };
    }
    if (name === "market_value_level_correction_rider_receipts") {
      return {
        insert(rows) {
          receiptInserts.push(...rows);
          return Promise.resolve({ error: null });
        },
      };
    }
    throw new Error(`unmocked table: ${name}`);
  }

  return {
    from: table,
    _riderUpdates: riderUpdates,
    _configUpdates: configUpdates,
    _receiptInserts: receiptInserts,
    _applyLogInsert: () => applyLogInsert,
  };
}

const POPULATION = [
  { id: "rider-1", team_id: "team-1", division: 1, current_value: 10_000, age: 26 },
  { id: "rider-2", team_id: "team-2", division: 2, current_value: 20_000, age: 28 },
];

function fetchGateStub(gate) { return async () => gate; }
function fetchSeasonNumberStub(n = 5) { return async () => n; }
function fetchPopulationStub(pop = POPULATION) { return async () => pop; }

test("runMarketValueLevelCorrectionApply: NÆGTER uden at skrive NOGET, når gaten er rød", async () => {
  const supabase = makeMockSupabase();
  const result = await runMarketValueLevelCorrectionApply({
    supabase, confirmApply: true, now: new Date("2026-08-30T10:00:00Z"), log: () => {},
    fetchGate: fetchGateStub({ gate_status: "red", c_candidate: null }),
    fetchSeasonNumber: fetchSeasonNumberStub(), fetchPopulation: fetchPopulationStub(),
  });
  assert.equal(result.applied, false);
  assert.equal(result.reason, "gate_not_green");
  assert.equal(supabase._riderUpdates.length, 0);
  assert.equal(supabase._configUpdates.length, 0);
});

test("runMarketValueLevelCorrectionApply: NÆGTER uden --confirm-apply selv med grøn gate", async () => {
  const supabase = makeMockSupabase();
  const result = await runMarketValueLevelCorrectionApply({
    supabase, confirmApply: false, now: new Date("2026-08-30T10:00:00Z"), log: () => {},
    fetchGate: fetchGateStub({ gate_status: "green", c_candidate: 0.5, measured_date: "2026-08-30" }),
    fetchSeasonNumber: fetchSeasonNumberStub(), fetchPopulation: fetchPopulationStub(),
  });
  assert.equal(result.applied, false);
  assert.equal(result.reason, "dry_run_not_approved");
  assert.equal(supabase._riderUpdates.length, 0);
});

test("runMarketValueLevelCorrectionApply: TILLADT + grøn ⇒ skalerer riders, dræn-neutral bankrate, apply-log, kvitteringer, ÉN notifikation pr. hold", async () => {
  const supabase = makeMockSupabase();
  const notifyCalls = [];
  const result = await runMarketValueLevelCorrectionApply({
    supabase,
    confirmApply: true,
    now: new Date("2026-08-30T10:00:00Z"),
    notify: async (args) => { notifyCalls.push(args); },
    log: () => {},
    fetchGate: fetchGateStub({ gate_status: "green", c_candidate: 0.5, measured_date: "2026-08-30" }),
    fetchSeasonNumber: fetchSeasonNumberStub(), fetchPopulation: fetchPopulationStub(),
  });

  assert.equal(result.applied, true);
  assert.equal(result.c, 0.5);
  assert.equal(result.populationSize, 2);
  assert.equal(result.ridersChanged, 2);
  assert.equal(supabase._riderUpdates.length, 2);
  assert.equal(supabase._riderUpdates[0].base_value, 5_000); // 10.000 x 0,5
  assert.equal(supabase._riderUpdates[1].base_value, 10_000); // 20.000 x 0,5

  // Dræn-neutral bankrate: 0,25/0,5 = 0,5.
  const rateUpdate = supabase._configUpdates.find((u) => u.key === "market_value_level_correction_youth_auction_start_rate");
  assert.ok(rateUpdate);
  assert.ok(Math.abs(rateUpdate.value - 0.5) < 1e-9);

  // Ingen anker-baseret løn-A-nøgle konfigureret på denne branch ⇒ løn-benet er en dokumenteret no-op.
  assert.equal(result.wageLegApplied, false);

  assert.equal(supabase._receiptInserts.length, 2);
  assert.ok(supabase._applyLogInsert());
  assert.equal(supabase._applyLogInsert().riders_changed, 2);

  // ÉN notifikation pr. hold (to hold, hver med én ændret rytter).
  assert.equal(notifyCalls.length, 2);
  for (const call of notifyCalls) {
    assert.equal(call.type, MARKET_VALUE_LEVEL_CORRECTION_NOTIFICATION_TYPE);
    assert.match(call.message, /Sunday value update: 1 riders moved/);
  }
});

test("runMarketValueLevelCorrectionApply: ingen ændrede ryttere ⇒ ingen notifikationer sendes", async () => {
  const unchangedPopulation = [
    { id: "rider-1", team_id: "team-1", division: 1, current_value: 10_000, age: 26 },
  ];
  const supabase = makeMockSupabase();
  const notifyCalls = [];
  const result = await runMarketValueLevelCorrectionApply({
    supabase, confirmApply: true, now: new Date("2026-08-30T10:00:00Z"),
    notify: async (args) => { notifyCalls.push(args); }, log: () => {},
    fetchGate: fetchGateStub({ gate_status: "green", c_candidate: 1, measured_date: "2026-08-30" }),
    fetchSeasonNumber: fetchSeasonNumberStub(), fetchPopulation: fetchPopulationStub(unchangedPopulation),
  });
  assert.equal(result.applied, true);
  assert.equal(result.ridersChanged, 0);
  assert.equal(notifyCalls.length, 0);
});

// #3750 (ejer-beslutning 22/8): korrektions-populationen SKAL omfatte akademiryttere.
// Kildetekst-guard mod at !r.is_academy-filteret sniger sig tilbage i
// fetchCorrectionPopulation (akademiet bærer ~29 % af al værdi).
test("fetchCorrectionPopulation udelader IKKE akademiryttere (ejer-beslutning 22/8)", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "marketValueLevelCorrectionApply.js"), "utf8");
  const fn = src.match(/async function fetchCorrectionPopulation\([\s\S]*?\n\}/);
  if (!fn) throw new Error("fetchCorrectionPopulation ikke fundet");
  if (/!r\.is_academy/.test(fn[0])) throw new Error("fetchCorrectionPopulation filtrerer akademi fra — strider mod ejer-beslutningen 22/8");
});
