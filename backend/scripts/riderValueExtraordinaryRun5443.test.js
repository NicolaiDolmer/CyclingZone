// #5443 — låsene foran den ekstraordinære værdikørsel.
//
// Kørslen flytter hele markedets priser uden for søndagen. Det der står mellem
// "ejeren prøver scriptet af" og "hele populationen er revalueret ved et uheld"
// er fire rene funktioner. De testes her uden DB, fordi de SKAL kunne
// gennemlæses og bevises uden at nogen rører prod.

import test from "node:test";
import assert from "node:assert/strict";

import {
  APPLY_CONFIRM_PHRASE,
  BACKED_UP_COLUMNS,
  BACKUP_TABLE,
  DEFAULT_WAGE_MODEL_ID,
  EXTRAORDINARY_PHASE_STEP,
  FREEZE_PRODUCTION_VALUE,
  OWNER_ACK_ENV,
  REQUIRED_MODEL_ID,
  ROLLBACK_COLUMNS,
  ROLLBACK_CONFIRM_PHRASE,
  applyBlockers,
  loadRequiredModelWithMarket,
  rollbackBlockers,
  rollbackExtraordinaryValueEvent,
  rollbackUpdates,
  runExtraordinaryValueEvent,
  summariseUpdates,
} from "./riderValueExtraordinaryRun5443.js";

const OK = {
  apply: true,
  confirm: APPLY_CONFIRM_PHRASE,
  ownerAck: true,
  modelId: REQUIRED_MODEL_ID,
  wageModelId: DEFAULT_WAGE_MODEL_ID,
  weekday: "wed",
  marketReady: true,
};

test("role-only changes neither move money nor escape rollback", () => {
  const before = { id: "fixture-role", base_value: 100, current_production_value: 20, best_role: "tt", best_role_rating: 40 };
  const patch = { id: before.id, best_role: "sprinter", best_role_rating: 41 };
  assert.deepEqual(summariseUpdates([patch], new Map([[before.id, before]])), { up: 0, down: 0, cpvMoved: 0 });
  const rollback = rollbackUpdates([{ ...before, rider_id: before.id }], new Map([[before.id, { ...before, ...patch }]]));
  assert.equal(rollback[0].best_role, "tt");
  assert.equal(rollback[0].best_role_rating, 40);
});

test("toerkoersel er default og har ingen laase", () => {
  assert.deepEqual(
    applyBlockers({ apply: false, confirm: null, ownerAck: false, modelId: "v4", wageModelId: "v5", weekday: "sun" }),
    []
  );
});

test("alle laase skal vaere aabne foer der skrives", () => {
  assert.deepEqual(applyBlockers(OK), [], "den korrekte kombination maa ikke blokeres");

  for (const [navn, broken] of [
    ["forkert bekraeftelse", { ...OK, confirm: "koer" }],
    ["ingen bekraeftelse", { ...OK, confirm: null }],
    ["naesten rigtig bekraeftelse", { ...OK, confirm: `${APPLY_CONFIRM_PHRASE} ` }],
    ["ingen ejer-ack", { ...OK, ownerAck: false }],
    ["prismodellen staar paa v4", { ...OK, modelId: "v4" }],
    ["prismodellen staar paa v5 (den gamle plan)", { ...OK, modelId: "v5" }],
    ["intet markeds-fit", { ...OK, marketReady: false }],
    ["loenmodellen er flippet med", { ...OK, wageModelId: "v5" }],
    ["det er soendag", { ...OK, weekday: "sun" }],
  ]) {
    assert.ok(applyBlockers(broken).length > 0, `${navn} skulle have blokeret koerslen`);
  }
});

test("soendag er blokeret - den dag ejer den ordinaere koersel", () => {
  const blockers = applyBlockers({ ...OK, weekday: "sun" });
  assert.equal(blockers.length, 1);
  assert.ok(blockers[0].includes("soendag"));
  // Alle andre ugedage er fri.
  for (const d of ["mon", "tue", "wed", "thu", "fri", "sat"]) {
    assert.deepEqual(applyBlockers({ ...OK, weekday: d }), [], `${d} maa ikke vaere blokeret`);
  }
});

test("mangler ALT, naevnes alt - ejeren skal ikke gaette sig frem i fem forsoeg", () => {
  const blockers = applyBlockers({
    apply: true, confirm: null, ownerAck: false, modelId: "v4", wageModelId: "v5", weekday: "sun", marketReady: false,
  });
  assert.equal(blockers.length, 6);
  assert.ok(blockers.some((b) => b.includes("rider_valuation_v6_market")));
  assert.ok(blockers.some((b) => b.includes(APPLY_CONFIRM_PHRASE)));
  assert.ok(blockers.some((b) => b.includes(OWNER_ACK_ENV)));
  assert.ok(blockers.some((b) => b.includes("rider_valuation_model")));
  assert.ok(blockers.some((b) => b.includes("rider_production_value_model")));
  assert.ok(blockers.some((b) => b.includes("soendag")));
});

test("rollback har sin EGEN saetning - de to kan ikke forveksles", () => {
  assert.notEqual(APPLY_CONFIRM_PHRASE, ROLLBACK_CONFIRM_PHRASE);
  assert.deepEqual(rollbackBlockers({ confirm: ROLLBACK_CONFIRM_PHRASE, ownerAck: true }), []);
  assert.ok(rollbackBlockers({ confirm: APPLY_CONFIRM_PHRASE, ownerAck: true }).length > 0);
  assert.ok(rollbackBlockers({ confirm: ROLLBACK_CONFIRM_PHRASE, ownerAck: false }).length > 0);
});

test("backuppen daekker praecis de kolonner koerslen kan skrive", () => {
  assert.deepEqual(
    [...BACKED_UP_COLUMNS].sort(),
    ["base_value", "best_role", "best_role_rating", "current_production_value", "primary_type", "secondary_type"],
    "all columns selectChangedValueUpdates can write"
  );
});

test("rollback skriver kun det der faktisk afviger", () => {
  const backup = [
    { rider_id: "a", base_value: 100, current_production_value: 10, primary_type: "gc", secondary_type: "rouleur" },
    { rider_id: "b", base_value: 200, current_production_value: 20, primary_type: "climber", secondary_type: "gc" },
    { rider_id: "c", base_value: 300, current_production_value: 30, primary_type: "sprinter", secondary_type: "rouleur" },
  ];
  const current = new Map([
    // a er uroert
    ["a", { id: "a", base_value: 100, current_production_value: 10, primary_type: "gc", secondary_type: "rouleur" }],
    // b har faaet ny pris
    ["b", { id: "b", base_value: 175, current_production_value: 20, primary_type: "climber", secondary_type: "gc" }],
    // c findes ikke laengere
  ]);
  const updates = rollbackUpdates(backup, current);
  assert.deepEqual(updates.map((u) => u.id), ["b"]);
  assert.deepEqual(updates[0], {
    id: "b", base_value: 200, primary_type: "climber", secondary_type: "gc",
    best_role: null, best_role_rating: null,
  });
});

test("en gentagen rollback er et no-op", () => {
  const backup = [{ rider_id: "a", base_value: 100, current_production_value: 10, primary_type: "gc", secondary_type: "rouleur" }];
  const restored = new Map([["a", { id: "a", ...Object.fromEntries(BACKED_UP_COLUMNS.map((c) => [c, backup[0][c]])) }]]);
  assert.deepEqual(rollbackUpdates(backup, restored), []);
});

test("rollback behandler null og manglende felt ens", () => {
  const backup = [{ rider_id: "a", base_value: 100, current_production_value: null, primary_type: "gc", secondary_type: null }];
  const current = new Map([["a", { id: "a", base_value: 100, current_production_value: null, primary_type: "gc", secondary_type: null }]]);
  assert.deepEqual(rollbackUpdates(backup, current), [], "null == null maa ikke tvinge en skrivning");
});

test("opsummeringen taeller op, ned og loengrundlag hver for sig", () => {
  const before = new Map([
    ["a", { id: "a", base_value: 100, current_production_value: 10 }],
    ["b", { id: "b", base_value: 100, current_production_value: 10 }],
    ["c", { id: "c", base_value: 100, current_production_value: 10 }],
  ]);
  const updates = [
    { id: "a", base_value: 150, current_production_value: 10 },
    { id: "b", base_value: 50, current_production_value: 10 },
    { id: "c", base_value: 100, current_production_value: 12 },
  ];
  assert.deepEqual(summariseUpdates(updates, before), { up: 1, down: 1, cpvMoved: 1 });
});

// ── #5497 trin-tælleren ─────────────────────────────────────────────────────
// Minimal app_config-mock: model-nøglerne læses, alt andet registreres, så
// testen kan bevise at ingen rytter-/backup-tabel røres før trin-nulstillingen.
// Syntetisk markeds-fit (ingen ejer-tal): kun formen.
const FAKE_MARKET_FIT = {
  schema: "typefree-market-fit/1",
  weight: 0.5,
  cap_ln: 0.1,
  common: { beta: [0.1, 0, 0], center: { O: 50, age: 25 } },
  local: null,
};

function configOnlySupabase({ modelId = REQUIRED_MODEL_ID, wageModelId = DEFAULT_WAGE_MODEL_ID, market = FAKE_MARKET_FIT } = {}) {
  const tables = [];
  const values = { rider_valuation_model: modelId, rider_production_value_model: wageModelId, rider_valuation_v6_market: market };
  return {
    tables,
    from(table) {
      tables.push(table);
      if (table !== "app_config") throw new Error(`uventet tabel ${table}`);
      return {
        select() {
          return { eq(_col, key) { return { maybeSingle: async () => ({ data: { value: values[key] ?? null }, error: null }) }; } };
        },
      };
    },
  };
}

const WEDNESDAY = new Date("2026-09-23T10:00:00Z");

test("#5497: toerkoerslen regner trin 0 og roerer IKKE trin-taelleren", async () => {
  const sb = configOnlySupabase();
  const resets = [];
  const refreshOpts = [];
  const res = await runExtraordinaryValueEvent(sb, {
    apply: false, now: WEDNESDAY, log: () => {},
    refreshFn: async (_sb, opts) => { refreshOpts.push(opts); return { scanned: 0, changed: 0, updates: [], before: [] }; },
    resetPhaseStepFn: async (_sb, step) => { resets.push(step); },
  });
  assert.equal(res.dryRun, true);
  assert.equal(refreshOpts[0].phaseStep, EXTRAORDINARY_PHASE_STEP);
  assert.equal(refreshOpts[0].dryRun, true);
  assert.deepEqual(resets, [], "en toerkoersel maa aldrig skrive noeglen");
});

test("#5497: en blokeret --apply roerer heller ikke trin-taelleren", async () => {
  const resets = [];
  const res = await runExtraordinaryValueEvent(configOnlySupabase(), {
    apply: true, confirm: "forkert", ownerAck: true, now: WEDNESDAY, log: () => {},
    resetPhaseStepFn: async (_sb, step) => { resets.push(step); },
  });
  assert.equal(res.ran, false);
  assert.deepEqual(resets, []);
});

// In-memory mock af de tabeller --apply rører: model-nøglerne, rytter-
// snapshottet, backup-tabellen og dags-claimet. `ops` er rækkefølgen.
function applySupabase({ backupRows = [], claimTaken = false, modelId = REQUIRED_MODEL_ID } = {}) {
  const ops = [];
  const backup = backupRows.map((r) => ({ ...r }));
  const riders = [{ id: "fixture-a", base_value: 10, current_production_value: 2, primary_type: "gc", secondary_type: null, best_role: null, best_role_rating: null }];
  const values = { rider_valuation_model: modelId, rider_production_value_model: DEFAULT_WAGE_MODEL_ID, rider_valuation_v6_market: FAKE_MARKET_FIT };
  const pageOf = (rows) => ({ order() { return this; }, range: async () => ({ data: rows.map((r) => ({ ...r })), error: null }) });
  return {
    ops,
    from(table) {
      if (table === "app_config") {
        return { select: () => ({ eq: (_c, key) => ({ maybeSingle: async () => ({ data: { value: values[key] ?? null }, error: null }) }) }) };
      }
      if (table === "riders") {
        return {
          select: () => { ops.push("riders:read"); return pageOf(riders); },
          update: () => ({ eq: async () => { ops.push("riders:write"); return { error: null }; } }),
        };
      }
      if (table === BACKUP_TABLE) {
        return {
          select: () => pageOf(backup),
          upsert: async (rows) => { ops.push("backup:write"); backup.push(...rows); return { error: null }; },
        };
      }
      if (table === "rider_value_sunday_log") {
        return {
          insert: async () => {
            ops.push("claim");
            return claimTaken ? { error: { code: "23505", message: "duplicate key" } } : { error: null };
          },
          update: () => ({ eq: async () => { ops.push("complete"); return { error: null }; } }),
        };
      }
      throw new Error(`uventet tabel ${table}`);
    },
  };
}

const applyArgs = (sb, resets) => ({
  apply: true, confirm: APPLY_CONFIRM_PHRASE, ownerAck: true, now: WEDNESDAY, log: () => {},
  refreshFn: async (_sb, opts) => {
    sb.ops.push(`refresh:${opts.phaseStep}`);
    sb.refreshOpts = opts;
    return { scanned: 1, changed: 0, written: 0 };
  },
  resetPhaseStepFn: async (_sb, step) => { sb.ops.push("reset"); resets.push(step); },
});

test("#5497: --apply nulstiller trin-taelleren til 0 efter backup + claim, lige foer foerste rytterskrivning", async () => {
  const sb = applySupabase();
  const resets = [];
  const res = await runExtraordinaryValueEvent(sb, applyArgs(sb, resets));
  assert.equal(res.ran, true);
  assert.deepEqual(resets, [0]);
  assert.equal(EXTRAORDINARY_PHASE_STEP, 0);
  const at = (op) => sb.ops.indexOf(op);
  assert.ok(at("backup:write") < at("claim") && at("claim") < at("reset") && at("reset") < at("refresh:0"), sb.ops.join(" > "));
});

test("#5497: en afvist --apply (backup findes / dagen er taget) roerer IKKE trin-taelleren", async () => {
  const existing = [{ rider_id: "fixture-a", base_value: 10, current_production_value: 2, primary_type: "gc", secondary_type: null, best_role: null, best_role_rating: null }];
  for (const [navn, sb, fejl] of [
    ["backup findes", applySupabase({ backupRows: existing }), /indeholder allerede/],
    ["dagen er taget", applySupabase({ claimTaken: true }), /allerede claimet/],
  ]) {
    const resets = [];
    await assert.rejects(() => runExtraordinaryValueEvent(sb, applyArgs(sb, resets)), fejl, navn);
    assert.deepEqual(resets, [], navn);
    assert.ok(!sb.ops.some((o) => o.startsWith("refresh")), navn);
  }
});

// ── #5443 v6 (ejer-lås 24/9: typefri model med marked) ──────────────────────

test("#5443 v6: koerslen kraever den typefri noegle, ikke v5", () => {
  assert.equal(REQUIRED_MODEL_ID, "v6");
  assert.equal(FREEZE_PRODUCTION_VALUE, true);
});

test("#5443 v6: modellen laeses med markeds-fittet fra app_config; mangler det, er --apply laast", async () => {
  const med = await loadRequiredModelWithMarket(configOnlySupabase());
  assert.equal(med.marketReady, true);
  assert.equal(med.model.model_id, "v6");
  assert.deepEqual(med.model.market_fit, FAKE_MARKET_FIT);

  const uden = await loadRequiredModelWithMarket(configOnlySupabase({ market: null }));
  assert.equal(uden.marketReady, false);
  assert.equal(uden.model.market_fit, undefined);

  const skrald = await loadRequiredModelWithMarket(configOnlySupabase({ market: { schema: "noget-andet" } }));
  assert.equal(skrald.marketReady, false);

  const res = await runExtraordinaryValueEvent(configOnlySupabase({ market: null }), {
    apply: true, confirm: APPLY_CONFIRM_PHRASE, ownerAck: true, now: WEDNESDAY, log: () => {},
    refreshFn: async () => { throw new Error("maa ikke koere"); },
    resetPhaseStepFn: async () => { throw new Error("maa ikke koere"); },
  });
  assert.equal(res.ran, false);
  assert.ok(res.blockers.some((b) => b.includes("rider_valuation_v6_market")));
});

test("#5443 v6: en laesefejl paa markeds-noeglen stopper koerslen i stedet for at regne uden marked", async () => {
  const failing = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "timeout" } }) }) }) }),
  };
  await assert.rejects(() => loadRequiredModelWithMarket(failing), /rider_valuation_v6_market/);
});

test("#5443 v6: toerkoersel FOER flippet pinner v6 + marked og fryser loengrundlaget", async () => {
  const refreshOpts = [];
  const res = await runExtraordinaryValueEvent(configOnlySupabase({ modelId: "v4" }), {
    apply: false, now: WEDNESDAY, log: () => {},
    refreshFn: async (_sb, opts) => { refreshOpts.push(opts); return { scanned: 0, changed: 0, updates: [], before: [] }; },
    resetPhaseStepFn: async () => { throw new Error("toerkoersel maa ikke skrive trin"); },
  });
  assert.equal(res.dryRun, true);
  assert.equal(res.pinned, true);
  assert.equal(res.marketReady, true);
  assert.equal(refreshOpts[0].model.model_id, "v6");
  assert.deepEqual(refreshOpts[0].model.market_fit, FAKE_MARKET_FIT);
  assert.equal(refreshOpts[0].productionModel, undefined, "loengrundlaget slaas op af refresh'en selv (v4-noeglen)");
  assert.equal(refreshOpts[0].phaseStep, 0);
  assert.equal(refreshOpts[0].freezeProductionValue, true);
  assert.equal(refreshOpts[0].dryRun, true);
});

test("#5443 v6: toerkoersel EFTER flippet pinner ikke - samme sti som --apply", async () => {
  const refreshOpts = [];
  const res = await runExtraordinaryValueEvent(configOnlySupabase(), {
    apply: false, now: WEDNESDAY, log: () => {},
    refreshFn: async (_sb, opts) => { refreshOpts.push(opts); return { scanned: 0, changed: 0, updates: [], before: [] }; },
  });
  assert.equal(res.pinned, false);
  assert.equal(refreshOpts[0].model.model_id, "v6");
  assert.deepEqual(refreshOpts[0].model.market_fit, FAKE_MARKET_FIT);
  assert.equal(refreshOpts[0].freezeProductionValue, true);
});

test("#5443 v6: --apply regner trin 0 med DEN model der passerede markeds-laasen, loengrundlaget uroert", async () => {
  const sb = applySupabase();
  const res = await runExtraordinaryValueEvent(sb, applyArgs(sb, []));
  assert.equal(res.ran, true);
  assert.equal(sb.refreshOpts.phaseStep, 0);
  assert.equal(sb.refreshOpts.model.model_id, "v6");
  assert.deepEqual(sb.refreshOpts.model.market_fit, FAKE_MARKET_FIT);
  assert.equal(sb.refreshOpts.productionModel, undefined);
  assert.equal(sb.refreshOpts.freezeProductionValue, true);
  assert.equal(sb.refreshOpts.dryRun, undefined, "den rigtige koersel skriver");
});

test("#5443 v6: rollback roerer ikke loengrundlaget - en senere v4-aendring er soendagens, ikke skiftets", () => {
  assert.equal(ROLLBACK_COLUMNS.includes("current_production_value"), false);
  assert.ok(BACKED_UP_COLUMNS.includes("current_production_value"), "backuppen baerer den stadig til post-verify");
  const backup = [{ rider_id: "a", base_value: 100, current_production_value: 10, primary_type: "gc", secondary_type: null, best_role: "gc", best_role_rating: 50 }];
  const onlyWageMoved = new Map([["a", { id: "a", ...backup[0], current_production_value: 12 }]]);
  assert.deepEqual(rollbackUpdates(backup, onlyWageMoved), []);
  const priceMoved = new Map([["a", { id: "a", ...backup[0], base_value: 80, current_production_value: 12 }]]);
  const [u] = rollbackUpdates(backup, priceMoved);
  assert.equal(u.base_value, 100);
  assert.equal(Object.hasOwn(u, "current_production_value"), false);
});

test("#5443 v6: rollback minder om trin-taelleren, ogsaa naar model-noeglen allerede er sat tilbage", async () => {
  const backupRow = { rider_id: "fixture-a", base_value: 99, current_production_value: 2, primary_type: "gc", secondary_type: null, best_role: null, best_role_rating: null };
  const sb = applySupabase({ backupRows: [backupRow], modelId: "v4" });
  const lines = [];
  await rollbackExtraordinaryValueEvent(sb, { confirm: ROLLBACK_CONFIRM_PHRASE, ownerAck: true, log: (l) => lines.push(l) });
  const text = lines.join("\n");
  assert.doesNotMatch(text, /staar stadig paa/);
  assert.match(text, /rider_value_phase_step/);
});

test("#5443 v6: rollback advarer om v6-noeglen og trin-taelleren", async () => {
  const backupRow = { rider_id: "fixture-a", base_value: 99, current_production_value: 2, primary_type: "gc", secondary_type: null, best_role: null, best_role_rating: null };
  const sb = applySupabase({ backupRows: [backupRow] });
  const lines = [];
  const res = await rollbackExtraordinaryValueEvent(sb, { confirm: ROLLBACK_CONFIRM_PHRASE, ownerAck: true, log: (l) => lines.push(l) });
  assert.equal(res.written, 1);
  assert.equal(res.modelId, "v6");
  const text = lines.join("\n");
  assert.match(text, /staar stadig paa 'v6'/);
  assert.match(text, /rider_valuation_model/);
  assert.match(text, /rider_value_phase_step/);
});
