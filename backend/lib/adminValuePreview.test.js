// #5686 · Værdi-forhåndsvisningen i admin: samme beregningssti som søndagen,
// read-only, trin sendes videre, løn-kontrol, cache pr. (from, to, step).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  VALUE_PREVIEW_MAX_STEP,
  combineValuePreview,
  computeValuePreview,
  computeValueSide,
  createValuePreviewService,
  defaultTargetModelId,
  loadValuePreviewDataset,
  parseValuePreviewQuery,
  sidesDiffer,
} from "./adminValuePreview.js";
import { recomputeRiderValue } from "./riderValueRefresh.js";
import { VALUATION_MODEL_IDS, loadValuationModelById } from "./riderValuationModelSelect.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ABIL = { climbing: 60, time_trial: 55, prolog: 50, flat: 58, tempo: 57, sprint: 40, acceleration: 45, punch: 48, endurance: 62, recovery: 58, durability: 55, descending: 52, cobblestone: 41, positioning: 50, aggression: 50, tactics: 50 };

// Syntetisk datasæt (ingen prod-data): to hold, fire ryttere, én pensioneret,
// én uden evner.
function fixture() {
  return {
    seasonNumber: 3,
    baseline: {},
    youthBaseline: {},
    loadedAt: "2026-09-24T18:00:00.000Z",
    riders: [
      { id: "r1", firstname: "Ada", lastname: "A", team_id: "tH", age: 24, base_value: 100, valuation_type: "climber" },
      { id: "r2", firstname: "Bo", lastname: "B", team_id: "tAI", age: 30, base_value: 200 },
      { id: "r3", firstname: "Cy", lastname: "C", team_id: null, age: 20, base_value: 50 },
      { id: "r4", firstname: "Di", lastname: "D", team_id: "tH", age: 33, base_value: 80, is_retired: true },
      { id: "r5", firstname: "Ed", lastname: "E", team_id: "tH", age: 26, base_value: 70 },
    ],
    abilityRows: [
      { rider_id: "r1", ability_caps: { climbing: 70 } },
      { rider_id: "r2", ability_caps: null },
      { rider_id: "r3", ability_caps: {} },
      { rider_id: "r4", ability_caps: {} },
      // r5 har ingen evner -> springes over (kan ikke værdisættes)
    ],
    teams: [
      { id: "tH", name: "Hold A", division: 1, is_ai: false },
      { id: "tAI", name: "Hold B", division: 2, is_ai: true },
      { id: "tUnused", name: "Hold C", division: 3, is_ai: false },
    ],
  };
}

// Stub for recomputeRiderValue: model.mult ganger base_value, phaseStep
// trækker fra (så trin-følsomhed kan testes), løngrundlaget følger KUN
// productionModel.
function stubRecompute(calls = []) {
  return (row, ab, baseline, model, opts = {}) => {
    calls.push({ id: row.id, model: model.id, opts });
    const step = opts.phaseStep ?? 0;
    return {
      primary_type: "gc",
      secondary_type: "rouleur",
      base_value: Math.round(row.base_value * model.mult) - (model.stepped ? step : 0),
      current_production_value: row.base_value * (opts.productionModel?.mult ?? model.mult),
    };
  };
}

const M = {
  live: { id: "live", mult: 1 },
  next: { id: "next", mult: 0.5 },
  stepped: { id: "stepped", mult: 1, stepped: true },
  wage: { id: "wage", mult: 1 },
};

test("parseValuePreviewQuery: kun kendte model-id'er og trin 0-4", () => {
  const ids = ["v4", "v5"];
  assert.deepEqual(parseValuePreviewQuery({}, ids), { ok: true, to: null, step: 0 });
  assert.deepEqual(parseValuePreviewQuery({ to: " V5 ", step: "3" }, ids), { ok: true, to: "v5", step: 3 });
  assert.equal(parseValuePreviewQuery({ to: "v9" }, ids).ok, false);
  assert.equal(parseValuePreviewQuery({ step: "5" }, ids).ok, false);
  assert.equal(parseValuePreviewQuery({ step: "-1" }, ids).ok, false);
  assert.equal(parseValuePreviewQuery({ step: "1.5" }, ids).ok, false);
  assert.equal(parseValuePreviewQuery({ step: "abc" }, ids).ok, false);
  assert.equal(VALUE_PREVIEW_MAX_STEP, 4);
});

test("parseValuePreviewQuery: standard-listen er VALUATION_MODEL_IDS (ingen hårdkodede nøgler)", () => {
  for (const id of VALUATION_MODEL_IDS) {
    assert.equal(parseValuePreviewQuery({ to: id }).to, id);
  }
});

test("defaultTargetModelId: første nøgle der ikke er live, ellers den live", () => {
  assert.equal(defaultTargetModelId("v4", ["v4", "v5"]), "v5");
  assert.equal(defaultTargetModelId("v5", ["v4", "v5"]), "v4");
  assert.equal(defaultTargetModelId("v4", ["v4"]), "v4");
});

test("computeValuePreview: FØR uden trin, EFTER med phaseStep, løn med wageModel i begge ender", async () => {
  const calls = [];
  const res = await computeValuePreview(fixture(), {
    fromModel: M.live, toModel: M.next, wageModel: M.wage, step: 2, recompute: stubRecompute(calls),
  });
  const before = calls.filter((c) => c.model === "live");
  const after = calls.filter((c) => c.model === "next");
  assert.ok(before.length > 0 && after.length > 0);
  for (const c of before) {
    assert.equal("phaseStep" in c.opts, false, "FØR-siden får ingen trin");
    assert.equal(c.opts.productionModel, M.wage);
  }
  for (const c of after) {
    assert.equal(c.opts.phaseStep, 2, "trinnet sendes videre som opts.phaseStep");
    assert.equal(c.opts.productionModel, M.wage);
  }
  // Pensionerede regnes aldrig; ryttere uden evner springes over og tælles.
  assert.equal(calls.some((c) => c.id === "r4"), false);
  assert.deepEqual(res.riders.map((r) => r.id), ["r1", "r2", "r3"]);
  assert.equal(res.skipped, 1);
  const r1 = res.riders[0];
  assert.equal(r1.before, 100);
  assert.equal(r1.after, 50);
  assert.equal(r1.name, "Ada A");
  assert.equal(r1.human, true);
  assert.equal(res.riders[1].human, false, "AI-hold er ikke et managerhold");
  assert.equal(res.riders[2].teamId, null);
  // Løngrundlaget står stille når kun prisens model skiftes.
  assert.deepEqual(res.wageControl, { moved: 0, movedOnTeams: 0 });
  // Kun hold med ryttere i populationen.
  assert.deepEqual(res.teams.map((t) => t.id).sort(), ["tAI", "tH"]);
});

test("computeValuePreview: løn-kontrollen fanger et løngrundlag der flytter sig", async () => {
  // Uden en fælles wageModel følger løngrundlaget prismodellen -> skal tælles.
  const res = await computeValuePreview(fixture(), {
    fromModel: M.live, toModel: M.next, wageModel: undefined, recompute: stubRecompute(),
  });
  assert.equal(res.wageControl.moved, 3);
  assert.equal(res.wageControl.movedOnTeams, 2);
});

test("combineValuePreview: liveDrift tæller lagret værdi ≠ genberegnet FØR", () => {
  const ds = fixture();
  const before = new Map([["r1", { base_value: 101, current_production_value: 1 }], ["r2", { base_value: 200, current_production_value: 1 }], ["r3", { base_value: 50, current_production_value: 1 }]]);
  const res = combineValuePreview(ds, before, before);
  assert.equal(res.liveDrift, 1);
});

test("computeValueSide: giver event-loopet plads undervejs", async () => {
  const ds = fixture();
  let ticks = 0;
  const timer = setInterval(() => { ticks += 1; }, 0);
  const slow = (row, ab, bl, model, opts) => {
    const until = Date.now() + 3;
    while (Date.now() < until) { /* spin */ }
    return stubRecompute()(row, ab, bl, model, opts);
  };
  await computeValueSide(ds, M.live, { recompute: slow, yieldEvery: 1 });
  clearInterval(timer);
  assert.ok(ticks >= 1, "setImmediate-pauser lader andre opgaver køre");
});

test("sidesDiffer: trin-følsomhed afgøres på prisen", () => {
  const a = new Map([["r1", { base_value: 1 }]]);
  assert.equal(sidesDiffer(a, new Map([["r1", { base_value: 1 }]])), false);
  assert.equal(sidesDiffer(a, new Map([["r1", { base_value: 2 }]])), true);
  assert.equal(sidesDiffer(a, new Map()), true);
});

function service(overrides = {}) {
  let loads = 0;
  let t = 1_000;
  const calls = [];
  const svc = createValuePreviewService({
    now: () => t,
    loadDataset: async () => { loads += 1; return { ...fixture(), loadedAt: `load-${loads}` }; },
    readLiveModelId: async () => "live",
    readWageModelId: async () => "wage",
    loadModel: (id) => M[id],
    recompute: stubRecompute(calls),
    modelIds: ["live", "next", "stepped"],
    yieldEvery: 0,
    ...overrides,
  });
  return { svc, calls, advance: (ms) => { t += ms; }, loads: () => loads };
}

test("service: from = live model, default to = første anden nøgle, svaret bærer model-listen", async () => {
  const { svc } = service();
  const res = await svc.getPreview({}, {});
  assert.equal(res.from, "live");
  assert.equal(res.to, "next");
  assert.equal(res.wageModel, "wage");
  assert.equal(res.step, 0);
  assert.deepEqual(res.steps, [0, 1, 2, 3, 4]);
  assert.deepEqual(res.modelIds, ["live", "next", "stepped"]);
  assert.equal(res.stepSensitive, false, "en model uden trin-plan viser én kolonne");
  assert.equal(res.riders.length, 3);
});

test("service: trin-følsom model markeres, og hvert trin giver sine egne tal", async () => {
  const { svc } = service();
  const s0 = await svc.getPreview({}, { to: "stepped", step: 0 });
  const s3 = await svc.getPreview({}, { to: "stepped", step: 3 });
  assert.equal(s0.stepSensitive, true);
  assert.equal(s3.stepSensitive, true);
  assert.equal(s0.riders[0].after, 100);
  assert.equal(s3.riders[0].after, 97);
});

test("service: cache i 5 min, én hentning, FØR-siden regnes én gang på tværs af trin", async () => {
  const { svc, calls, advance, loads } = service();
  await svc.getPreview({}, { to: "stepped", step: 1 });
  const liveCallsAfterFirst = calls.filter((c) => c.model === "live").length;
  await svc.getPreview({}, { to: "stepped", step: 2 });
  await svc.getPreview({}, { to: "stepped", step: 1 });
  assert.equal(loads(), 1, "datasættet hentes én gang inden for TTL");
  assert.equal(calls.filter((c) => c.model === "live").length, liveCallsAfterFirst, "FØR-siden genbruges");
  const before = calls.length;
  await svc.getPreview({}, { to: "stepped", step: 1 });
  assert.equal(calls.length, before, "samme (to, step) regnes ikke igen");
  advance(5 * 60_000 + 1);
  await svc.getPreview({}, { to: "stepped", step: 1 });
  assert.equal(loads(), 2, "efter TTL hentes rækkerne forfra");
});

test("service: samtidige kald deler én hentning", async () => {
  const { svc, loads } = service();
  await Promise.all([svc.getPreview({}, {}), svc.getPreview({}, {}), svc.getPreview({}, { step: 2 })]);
  assert.equal(loads(), 1);
});

test("service: en fejlet hentning caches ikke", async () => {
  let n = 0;
  const { svc } = service({
    loadDataset: async () => { n += 1; if (n === 1) throw new Error("db nede"); return fixture(); },
  });
  await assert.rejects(svc.getPreview({}, {}), /db nede/);
  const res = await svc.getPreview({}, {});
  assert.equal(res.riders.length, 3);
});

// Mock-supabase: registrerer hver tabel og hver metode. Et write-kald kaster.
function mockSupabase(tables) {
  const touched = [];
  return {
    touched,
    from(name) {
      touched.push(name);
      const rows = tables[name] ?? [];
      const q = {
        _filters: [],
        select() { return q; },
        order() { return q; },
        limit() { return q; },
        eq(col, val) { q._filters.push([col, val]); return q; },
        range(from, to) { return Promise.resolve({ data: rows.slice(from, to + 1), error: null }); },
        maybeSingle() {
          const hit = rows.find((r) => q._filters.every(([c, v]) => r[c] === v));
          return Promise.resolve({ data: hit ?? null, error: null });
        },
        insert() { throw new Error("write"); },
        update() { throw new Error("write"); },
        upsert() { throw new Error("write"); },
        delete() { throw new Error("write"); },
      };
      return q;
    },
  };
}

test("loadValuePreviewDataset: samme sæson-anker som søndagen og kun SELECTs", async () => {
  const sb = mockSupabase({
    seasons: [{ number: 4, status: "active" }],
    riders: [{ id: "r1", birthdate: "2000-01-01", team_id: "t1" }],
    rider_derived_abilities: [{ rider_id: "r1", ability_caps: {}, ...ABIL }],
    teams: [{ id: "t1", name: "Hold A", division: 1 }],
  });
  const ds = await loadValuePreviewDataset(sb);
  assert.equal(ds.seasonNumber, 4);
  assert.equal(ds.riders.length, 1);
  assert.equal(typeof ds.riders[0].age, "number");
  assert.equal(ds.abilityRows.length, 1);
  assert.equal(ds.teams.length, 1);
  assert.ok(ds.baseline && ds.youthBaseline);
  assert.deepEqual([...new Set(sb.touched)].sort(), ["rider_derived_abilities", "riders", "seasons", "teams"]);
});

test("loadValuePreviewDataset: uden aktiv sæson ankres i seneste afsluttede", async () => {
  const sb = mockSupabase({ seasons: [{ number: 3, status: "completed" }], riders: [], rider_derived_abilities: [], teams: [] });
  const ds = await loadValuePreviewDataset(sb);
  assert.equal(ds.seasonNumber, 3);
});

test("ægte kæde: samme model i begge ender giver nul ændring (ingen egen formel)", async () => {
  const model = loadValuationModelById(VALUATION_MODEL_IDS[0]);
  const ds = {
    ...fixture(),
    baseline: JSON.parse(readFileSync(join(__dirname, "riderTypesBaseline.json"), "utf8")),
    youthBaseline: JSON.parse(readFileSync(join(__dirname, "riderTypesBaselineYouth.json"), "utf8")),
    riders: [
      { id: "x1", age: 24, potentiale: 4.5, team_id: "tH" },
      { id: "x2", age: 19, potentiale: 5.5, team_id: null },
    ],
    abilityRows: [
      { rider_id: "x1", ability_caps: ABIL, ...ABIL },
      { rider_id: "x2", ability_caps: ABIL, ...ABIL },
    ],
  };
  const res = await computeValuePreview(ds, { fromModel: model, toModel: model, wageModel: model });
  assert.equal(res.riders.length, 2);
  for (const r of res.riders) {
    assert.equal(r.before, r.after);
    const direct = recomputeRiderValue(ds.riders.find((x) => x.id === r.id), ds.abilityRows.find((a) => a.rider_id === r.id), ds.baseline, model, { typeAbilities: ABIL, youthBaseline: ds.youthBaseline, productionModel: model });
    assert.equal(r.before, direct.base_value, "tallet er produktionens eget");
  }
  assert.equal(res.wageControl.moved, 0);
});
