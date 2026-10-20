// Tests for #6929 (L3 af #6857): regen af S5's etapeprofiler på stedet. Ingen database.
//
// Det der skal holde (spec 2026-10-18 §3):
//   1. Dry-run er standard; --apply kræver --season 5 --confirm-season-upcoming (+ backup og plan-hash).
//   2. Fail-closed invarianter: samme races.id-sæt, samme stages, stages_completed=0, 0 claims,
//      engine_rules_revision IS NULL, ingen is_manual, sæsonen upcoming; efter 25/10 --allow-active.
//   3. Seed-løbene bærer identitetsfelterne til generatoren (L2), og alle puljer i en division
//      får samme parcours.
//   4. Apply skriver pr. løb i batches på højst 200 rækker, post-verify er grøn, og en genkørsel
//      skriver intet (idempotent). Samme input giver samme plan-hash (deterministisk).
//   5. Rute-filerne følger testportens cz-race-routes/v1 (#6909).
//   6. Den offentlige rapport har ingen løbsnavne eller ruter (hard rule 17).

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseArgs, copenhagenDate, canonicalJson, loadRegenInput, buildRegenPlan, checkInvariants, diffAgainstCurrent,
  buildBackupSql, buildRestoreSql, assertBackupCovers, assertBackupCoversSlots, readTouchedRaces, touchedStateFile, batchRaces, applyPlan, postVerify, crossPoolDivergence,
  parseDivergenceScriptOutput, waitForCalendarCache, buildRoutesFiles, writeRoutesDir, assertPrivatePath, buildReport,
  seedRaceFor, defaultGeneratorFactory, identityTable, signaturePins, matchesAuthored, createReadOnlyClient, overlayIdentity, gtPreludes,
  CALENDAR_CACHE_TTL_MS, CALENDAR_CACHE_MARGIN_MS, WRITE_BATCH_ROWS, ROUTES_FORMAT, PROFILE_COLUMNS, CUTOVER_DATE_CPH,
} from "./regenS5StageProfiles.mjs";
import { ARCHETYPE_PROFILES } from "../lib/raceStageProfileGenerator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEASON_ID = "11111111-1111-4111-8111-111111111111";
const BEFORE_CUTOVER = new Date("2026-10-21T08:00:00Z");
const AFTER_CUTOVER = new Date("2026-10-25T08:00:00Z");
const NO_GUARANTEES = Object.freeze({ oneDayShareMin: {}, terrainFamilyMin: {}, terrainFamilyMax: {}, mountainFreeMin: {}, uniformTolerancePp: Infinity, classStageLengthBand: null });

// ── Fixture ───────────────────────────────────────────────────────────────────────────

const AUTHORED = {
  profile_type: "cobbles", finale_type: "flat_sprint", distance_km: 255, elevation_gain_m: 1800,
  climbs: [{ name: "Muur Fictief", category: "3", crest_km: 240, length_km: 1.1, avg_gradient: 9, summit_finish: false }],
  sprints: [], sectors: [{ kind: "cobbles", start_km: 200, length_km: 2, name: "Sector Fictief" }],
};

function catalog() {
  return [
    { id: "p-pre", external_id: "x-pre", name: "Optakt Fiktiv", race_class: "OtherWorldTourA", race_type: "stage_race", stages: 5, terrain_archetype: "mountain_tour", race_identity_type: "climbers_gt_prelude", signature: { features: [{ kind: "climb", stage_hint: "queen", name: "Col du Fictif", category: "1", length_km: 9, avg_gradient: 7, summit_finish: false }] }, authored_route: null },
    { id: "p-gt", external_id: "x-gt", name: "Grand Tour Fiktiv", race_class: "GrandTour", race_type: "stage_race", stages: 21, terrain_archetype: "grand_tour", race_identity_type: null, signature: null, authored_route: null },
    { id: "p-mon", external_id: "x-mon", name: "Monument Fiktiv", race_class: "Monuments", race_type: "single", stages: 1, terrain_archetype: "cobbled_classic", race_identity_type: null, signature: null, authored_route: AUTHORED },
    { id: "p-d2", external_id: "x-d2", name: "Sprintløb Fiktiv", race_class: "ProSeries", race_type: "stage_race", stages: 4, terrain_archetype: "sprinters_week", race_identity_type: "sprinters", signature: { features: [{ kind: "prologue", stage_hint: "first", band: "flat" }] }, authored_route: null },
    { id: "p-d2s", external_id: "x-d2s", name: "Endagsløb Fiktiv", race_class: "Class1", race_type: "single", stages: 1, terrain_archetype: "flat_sprint", race_identity_type: null, signature: null, authored_route: null },
  ];
}

function race(id, poolRaceId, divisionId, cat, gameDay, extra = {}) {
  return {
    id, name: cat.name, race_type: cat.race_type, race_class: cat.race_class, stages: cat.stages, stages_completed: 0,
    status: "scheduled", pool_race_id: poolRaceId, league_division_id: divisionId, game_day_start: gameDay,
    engine_rules_revision: null, squad: "senior", season_id: SEASON_ID, ...extra,
  };
}

function state({ status = "upcoming" } = {}) {
  const cat = catalog();
  const c = Object.fromEntries(cat.map((x) => [x.id, x]));
  const races = [];
  for (const div of [1, 2]) {
    races.push(race(`r${div}-pre`, "p-pre", div, c["p-pre"], 1));
    races.push(race(`r${div}-gt`, "p-gt", div, c["p-gt"], 8));
    races.push(race(`r${div}-mon`, "p-mon", div, c["p-mon"], 3));
  }
  races.push(race("r3-d2", "p-d2", 3, c["p-d2"], 2));
  races.push(race("r3-d2s", "p-d2s", 3, c["p-d2s"], 4));
  let seq = 0;
  const profiles = races.flatMap((r) => Array.from({ length: r.stages }, (_, i) => ({
    id: `old-${++seq}`, race_id: r.id, stage_number: i + 1, profile_type: "flat", finale_type: "flat_sprint", demand_vector: { sprint: 1 },
    generator_version: 6, is_manual: false, generated_at: "2026-10-15T00:00:00Z", distance_km: 150, elevation_gain_m: 900,
    climbs: [], sprints: [], sectors: [], segments: [], weather: null, elevation_profile: [],
  })));
  return {
    seasons: [{ id: SEASON_ID, number: 5, status }],
    divisions: [{ id: 1, tier: 1, pool_index: 1 }, { id: 2, tier: 1, pool_index: 2 }, { id: 3, tier: 2, pool_index: 1 }],
    races, catalog: cat, profiles, claims: [], backup: {},
    // én etape pr. dag fra løbets første løbsdag (kun rapportens GT-optakt-tjek læser den)
    schedule: races.flatMap((r) => Array.from({ length: r.stages }, (_, i) => ({ race_id: r.id, stage_number: i + 1, scheduled_at: new Date(Date.UTC(2026, 9, 27 + r.game_day_start + i, 13)).toISOString() }))),
  };
}

function fakeDb(s) {
  const calls = [];
  let seq = 0;
  return {
    calls,
    async seasonByNumber(n) { return s.seasons.find((x) => x.number === n) ?? null; },
    async divisions() { return s.divisions.map((d) => ({ ...d })); },
    async racesOfSeason(id) { return s.races.filter((r) => r.season_id === id).map((r) => ({ ...r })); },
    async catalogRows(ids) { return s.catalog.filter((x) => ids.includes(x.id)); },
    async profilesOf(ids) { return s.profiles.filter((p) => ids.includes(p.race_id)).map((p) => structuredClone(p)); },
    async claimsOf(ids) { return s.claims.filter((x) => ids.includes(x.race_id)); },
    async scheduleOf(ids) { return s.schedule.filter((x) => ids.includes(x.race_id)); },
    async backupIds(table, ids) { return new Set((s.backup[table] ?? []).filter((id) => ids.includes(id))); },
    async backupSlots(table, raceIds) { return new Set((s.backupSlots?.[table] ?? []).filter((k) => raceIds.includes(k.split("|")[0]))); },
    async deleteProfiles(ids) { calls.push(["delete", ids.slice()]); s.profiles = s.profiles.filter((p) => !ids.includes(p.race_id)); },
    async insertProfiles(rows) {
      calls.push(["insert", rows.length]);
      s.profiles.push(...rows.map((r) => structuredClone({ id: `new-${++seq}`, generated_at: "2026-10-21T09:00:00Z", ...r })));
    },
  };
}

// Fake identitets-generator med L2's form: læser seed-løbets identitetsfelter.
function fakeGeneratorFactory(seen = []) {
  return ({ tier, seedRaces }) => {
    seen.push({ tier, seedRaces });
    return (sr) => {
      if (sr.authored_route) return [{ stage_number: 1, ...structuredClone(sr.authored_route), demand_vector: { cobblestone: 1 }, segments: [], weather: null, elevation_profile: [], generator_version: 7 }];
      const n = sr.race_type === "stage_race" ? sr.stages : 1;
      const feature = sr.signature?.features?.[0] ?? null;
      return Array.from({ length: n }, (_, i) => {
        const stage = i + 1;
        const climbs = feature?.kind === "climb" && stage === 2 ? [{ name: feature.name, category: feature.category, crest_km: 160, length_km: feature.length_km, avg_gradient: feature.avg_gradient, summit_finish: false }] : [];
        const itt = feature?.kind === "prologue" && stage === 1;
        return {
          stage_number: stage, profile_type: itt ? "itt" : stage === 2 ? "mountain" : "hilly", finale_type: itt ? "solo_tt" : "punch",
          demand_vector: { punch: 0.5 }, distance_km: itt ? 6 : 170 + stage + sr.season_variant, elevation_gain_m: 1500, climbs, sprints: [], sectors: [],
          segments: [], weather: null, elevation_profile: [], generator_version: 7,
        };
      });
    };
  };
}

const fakeDraw = () => ({ attempt: 0, exhausted: false, firstDrawFailures: [] });
const greenGate = () => ({
  green: true, blocking: [],
  parts: { stages: { green: true, violations: [] }, grandTours: { green: true, violations: [] }, season: { green: true, violations: [] }, motor: { status: "stub", stub: true, violations: [] } },
});
const redGate = () => ({ ...greenGate(), green: false, blocking: ["S5 (1) etape — x"], parts: { ...greenGate().parts, stages: { green: false, violations: ["x"] } } });

async function setup(opts = {}) {
  const s = state(opts);
  const db = fakeDb(s);
  const input = await loadRegenInput(db, 5);
  const seen = [];
  const plan = buildRegenPlan(input, {
    generatorFactory: fakeGeneratorFactory(seen), drawResolver: fakeDraw, evaluateGate: opts.gate ?? greenGate, guarantees: NO_GUARANTEES,
  });
  return { s, db, input, plan, seen };
}

// ── 1. Argumenter ─────────────────────────────────────────────────────────────────────

test("dry-run er standard; --season 5 er default", () => {
  const o = parseArgs([]);
  assert.equal(o.apply, false);
  assert.equal(o.season, 5);
});

test("--apply kræver --season 5, --confirm-season-upcoming, backup-tabel og plan-hash", () => {
  const hash = "a".repeat(64);
  const full = ["--apply", "--season", "5", "--confirm-season-upcoming", "--backup-table=backup_6857_race_stage_profiles_20261021", `--plan-hash=${hash}`];
  assert.equal(parseArgs(full).apply, true);
  assert.throws(() => parseArgs(full.filter((a) => a !== "--season" && a !== "5")), /eksplicit --season 5/);
  assert.throws(() => parseArgs(full.filter((a) => a !== "--confirm-season-upcoming")), /--confirm-season-upcoming/);
  assert.throws(() => parseArgs(full.filter((a) => !a.startsWith("--backup-table"))), /--backup-table/);
  assert.throws(() => parseArgs([...full.filter((a) => !a.startsWith("--backup-table")), "--backup-table=races"]), /--backup-table/);
  assert.throws(() => parseArgs(full.filter((a) => !a.startsWith("--plan-hash"))), /--plan-hash/);
});

test("andre sæsoner, ukendte flag og apply-flag uden --apply afvises", () => {
  assert.throws(() => parseArgs(["--season=4"]), /kun sæson 5/);
  assert.throws(() => parseArgs(["--force"]), /ukendt flag/);
  assert.throws(() => parseArgs(["--plan-hash=" + "a".repeat(64)]), /kun til --apply/);
  assert.throws(() => parseArgs(["--routes-out"]), /kræver en værdi/);
});

test("copenhagenDate bruger dansk dato, ikke UTC", () => {
  assert.equal(copenhagenDate(new Date("2026-10-24T22:30:00Z")), "2026-10-25");
  assert.equal(copenhagenDate(new Date("2026-10-24T21:30:00Z")), "2026-10-24");
});

// ── 2. Planen ─────────────────────────────────────────────────────────────────────────

test("seed-løbene bærer identitetsfelterne og seedes på katalog-id + sæson (seedRaceFor-formen)", async () => {
  const { seen } = await setup();
  const d1 = seen.find((x) => x.tier === 1).seedRaces;
  const pre = d1.find((r) => r.id === "p-pre");
  assert.equal(pre.race_identity_type, "climbers_gt_prelude");
  assert.equal(pre.signature.features[0].name, "Col du Fictif");
  assert.equal(pre.external_id, "x-pre");
  assert.equal(pre.season_id, SEASON_ID);
  assert.deepEqual(d1.find((r) => r.id === "p-mon").authored_route, AUTHORED);
  // én repræsentativ pulje pr. division: ingen dubletter
  assert.equal(d1.length, 3);
  // deterministisk rækkefølge: game_day_start, så katalog-id
  assert.deepEqual(d1.map((r) => r.id), ["p-pre", "p-mon", "p-gt"]);
  // uden identitet: præcis samme seed-løb som før #6857 (ingen null-felter, som materializeren)
  const plain = seedRaceFor({ pool_race_id: "p", race_type: "single", stages: 1 }, { race_identity_type: null, signature: null, authored_route: null }, SEASON_ID);
  for (const k of ["race_identity_type", "signature", "authored_route"]) assert.ok(!(k in plain), k);
});

test("alle puljer i en division får samme parcours; rækkerne har toStageProfileRow-formen", async () => {
  const { plan, input } = await setup();
  assert.equal(plan.planErrors.length, 0);
  assert.equal(plan.rowsByRaceId.size, input.races.length);
  const strip = (rows) => rows.map((r) => ({ ...r, race_id: null }));
  assert.deepEqual(strip(plan.rowsByRaceId.get("r1-gt")), strip(plan.rowsByRaceId.get("r2-gt")));
  for (const [raceId, rows] of plan.rowsByRaceId) {
    for (const row of rows) {
      assert.equal(row.race_id, raceId);
      assert.equal(row.is_manual, false);
      for (const k of Object.keys(row)) assert.ok(PROFILE_COLUMNS.includes(k), `ukendt kolonne ${k}`);
    }
  }
  const div = crossPoolDivergence(input.races, new Map(input.divisions.map((d) => [d.id, d.tier])), plan.rowsByRaceId);
  assert.equal([...div.values()].reduce((s, d) => s + d.diverging, 0), 0);
});

test("plan-hashen er deterministisk og afhænger af ruterne", async () => {
  const a = await setup();
  const b = await setup();
  assert.equal(a.plan.planHash, b.plan.planHash);
  const other = buildRegenPlan(a.input, {
    generatorFactory: (args) => { const g = fakeGeneratorFactory()(args); return (sr) => g({ ...sr, season_variant: 1 }); },
    drawResolver: fakeDraw, evaluateGate: greenGate, guarantees: NO_GUARANTEES,
  });
  assert.notEqual(other.planHash, a.plan.planHash);
});

test("realisme-gen-trækkets variant bruges for hele divisionen", async () => {
  const s = state();
  const input = await loadRegenInput(fakeDb(s), 5);
  const plan = buildRegenPlan(input, {
    generatorFactory: fakeGeneratorFactory(), drawResolver: ({ tier }) => ({ attempt: tier === 1 ? 3 : 0 }), evaluateGate: greenGate, guarantees: NO_GUARANTEES,
  });
  assert.equal(plan.tiers.find((t) => t.tier === 1).seasonVariant, 3);
  assert.equal(plan.rowsByRaceId.get("r1-pre")[0].distance_km, 174);
  assert.equal(plan.rowsByRaceId.get("r3-d2")[1].distance_km, 172);
});

test("puljer med forskelligt løbssæt og løb uden katalog-række er planfejl", async () => {
  const s = state();
  s.races = s.races.filter((r) => r.id !== "r2-mon");
  s.races.push(race("r3-x", "p-missing", 3, { name: "X", race_type: "single", race_class: "Class1", stages: 1 }, 9));
  const input = await loadRegenInput(fakeDb(s), 5);
  const plan = buildRegenPlan(input, { generatorFactory: fakeGeneratorFactory(), drawResolver: fakeDraw, evaluateGate: greenGate, guarantees: NO_GUARANTEES });
  assert.ok(plan.planErrors.some((e) => /samme løbssæt/.test(e)));
  assert.ok(plan.planErrors.some((e) => /p-missing/.test(e)));
  const inv = checkInvariants({ input, plan, now: BEFORE_CUTOVER });
  assert.equal(inv.ok, false);
  assert.ok(inv.violations.some((v) => /samme races.id-sæt/.test(v)));
});

// ── 3. Invarianter ────────────────────────────────────────────────────────────────────

test("invarianterne er grønne på en ren upcoming-sæson før 25/10", async () => {
  const { input, plan } = await setup();
  const inv = checkInvariants({ input, plan, now: BEFORE_CUTOVER });
  assert.deepEqual(inv.violations, []);
  assert.equal(inv.ok, true);
});

const brokenCases = [
  ["stages_completed", (s) => { s.races[0].stages_completed = 1; }, /stages_completed/],
  ["stages_completed null", (s) => { s.races[0].stages_completed = null; }, /stages_completed/],
  ["claims", (s) => { s.claims.push({ race_id: "r1-pre", stage_index: 0 }); }, /claims/],
  ["engine_rules_revision", (s) => { s.races[0].engine_rules_revision = "v4"; }, /engine_rules_revision/],
  ["is_manual", (s) => { s.profiles[0].is_manual = true; }, /is_manual/],
  ["status", (s) => { s.seasons[0].status = "completed"; }, /upcoming/],
];
for (const [name, mutate, re] of brokenCases) {
  test(`fail-closed: ${name}`, async () => {
    const s = state();
    mutate(s);
    const input = await loadRegenInput(fakeDb(s), 5);
    const plan = buildRegenPlan(input, { generatorFactory: fakeGeneratorFactory(), drawResolver: fakeDraw, evaluateGate: greenGate, guarantees: NO_GUARANTEES });
    const inv = checkInvariants({ input, plan, now: BEFORE_CUTOVER });
    assert.equal(inv.ok, false);
    assert.ok(inv.violations.some((v) => re.test(v)), inv.violations.join(" | "));
  });
}

test("fail-closed: et løb hvis etapeantal ikke matcher planen", async () => {
  const { input, plan } = await setup();
  plan.rowsByRaceId.set("r1-pre", plan.rowsByRaceId.get("r1-pre").slice(0, 4));
  const inv = checkInvariants({ input, plan, now: BEFORE_CUTOVER });
  assert.ok(inv.violations.some((v) => /samme stages/.test(v)));
});

test("fra 25/10 (dansk dato) kræves --allow-active; active-sæson kun med flaget", async () => {
  const { input, plan } = await setup();
  assert.ok(checkInvariants({ input, plan, now: AFTER_CUTOVER }).violations.some((v) => v.includes(CUTOVER_DATE_CPH)));
  assert.equal(checkInvariants({ input, plan, now: AFTER_CUTOVER, allowActive: true }).ok, true);
  const active = await setup({ status: "active" });
  assert.equal(checkInvariants({ input: active.input, plan: active.plan, now: AFTER_CUTOVER }).ok, false);
  assert.equal(checkInvariants({ input: active.input, plan: active.plan, now: AFTER_CUTOVER, allowActive: true }).ok, true);
});

test("en rød benchmark-gate eller et brudt gulv blokerer", async () => {
  const red = await setup({ gate: redGate });
  assert.ok(checkInvariants({ input: red.input, plan: red.plan, now: BEFORE_CUTOVER }).violations.some((v) => /benchmark-gaten/.test(v)));
  const s = state();
  const input = await loadRegenInput(fakeDb(s), 5);
  const plan = buildRegenPlan(input, {
    generatorFactory: fakeGeneratorFactory(), drawResolver: fakeDraw, evaluateGate: greenGate,
    guarantees: { ...NO_GUARANTEES, terrainFamilyMin: { 2: { cobbles: 3 } } },
  });
  assert.ok(checkInvariants({ input, plan, now: BEFORE_CUTOVER }).violations.some((v) => /§5-gulve/.test(v)));
});

// ── 4. Backup, apply, post-verify, idempotens ─────────────────────────────────────────

test("backup.sql og restore.sql: validerede navne, RLS, kun service_role, sæsonens seniorløb", () => {
  const sql = buildBackupSql("backup_6857_race_stage_profiles_20261021", SEASON_ID);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /grant select on table public\.backup_6857_race_stage_profiles_20261021 to service_role/);
  assert.match(sql, new RegExp(`season_id = '${SEASON_ID}'`));
  assert.match(sql, /squad is null or r\.squad = 'senior'/);
  assert.throws(() => buildBackupSql("races; drop table x", SEASON_ID), /ugyldigt backup-navn/);
  assert.throws(() => buildBackupSql("backup_6857_race_stage_profiles_20261021", "1'; drop"), /uuid/);
  const restore = buildRestoreSql("backup_6857_race_stage_profiles_20261021");
  assert.match(restore, /delete from public\.race_stage_profiles/);
  assert.match(restore, new RegExp(`insert into public\\.race_stage_profiles \\(${PROFILE_COLUMNS.join(", ")}\\)`));
});

test("apply nægter at skrive når backuppen ikke dækker de rækker der slettes", async () => {
  const { db, input } = await setup();
  const ids = input.profiles.map((p) => p.id);
  await assert.rejects(assertBackupCovers(db, "backup_6857_race_stage_profiles_20261021", ids), /mangler/);
  await assert.rejects(assertBackupCovers({ backupIds: async () => { throw new Error("relation does not exist"); } }, "backup_6857_race_stage_profiles_20261021", ids), /kan ikke læses/);
  assert.equal(db.calls.length, 0);
});

test("batches er hele løb og højst 200 rækker", () => {
  const rowsByRaceId = new Map(Array.from({ length: 30 }, (_, i) => [`r${String(i).padStart(2, "0")}`, Array.from({ length: 21 }, (_, s) => ({ stage_number: s + 1 }))]));
  const batches = batchRaces([...rowsByRaceId.keys()], rowsByRaceId);
  assert.ok(batches.every((b) => b.rows.length <= WRITE_BATCH_ROWS));
  assert.equal(batches.reduce((s, b) => s + b.raceIds.length, 0), 30);
  assert.equal(batches.reduce((s, b) => s + b.rows.length, 0), 30 * 21);
});

test("apply: DELETE før INSERT pr. batch, post-verify grøn, genkørsel skriver intet", async () => {
  const { s, db, input, plan } = await setup();
  const diff = diffAgainstCurrent(plan, input.profiles);
  assert.equal(diff.racesToWrite.length, input.races.length);
  s.backup.backup_6857_race_stage_profiles_20261021 = input.profiles.map((p) => p.id);
  await assertBackupCovers(db, "backup_6857_race_stage_profiles_20261021", input.profiles.map((p) => p.id));
  const res = await applyPlan({ db, plan, racesToWrite: diff.racesToWrite, clock: () => new Date("2026-10-21T09:00:00Z") });
  assert.equal(res.racesWritten, input.races.length);
  assert.equal(db.calls[0][0], "delete");
  assert.equal(db.calls[1][0], "insert");
  const verify = await postVerify({ db, plan, races: input.races, divisions: input.divisions });
  assert.equal(verify.ok, true, JSON.stringify(verify.checks));

  // idempotent: samme plan, ny læsning, intet at skrive
  const again = await loadRegenInput(db, 5);
  const plan2 = buildRegenPlan(again, { generatorFactory: fakeGeneratorFactory(), drawResolver: fakeDraw, evaluateGate: greenGate, guarantees: NO_GUARANTEES });
  assert.equal(plan2.planHash, plan.planHash);
  assert.equal(diffAgainstCurrent(plan2, again.profiles).racesToWrite.length, 0);
});

test("post-verify fanger en manglende række, en afvigende rute og divergens-scriptets output", async () => {
  const { s, db, input, plan } = await setup();
  await applyPlan({ db, plan, racesToWrite: [...plan.rowsByRaceId.keys()], clock: () => new Date("2026-10-21T09:00:00Z") });
  s.profiles = s.profiles.filter((p) => !(p.race_id === "r1-gt" && p.stage_number === 21));
  s.profiles.find((p) => p.race_id === "r2-pre" && p.stage_number === 1).profile_type = "flat";
  const verify = await postVerify({ db, plan, races: input.races, divisions: input.divisions, runDivergenceScript: () => "Div 1    |   2    |     27     |         1        |         0" });
  const failed = verify.checks.filter((c) => !c.ok).map((c) => c.name);
  assert.ok(failed.includes("count(profiler) = sum(stages)"));
  assert.ok(failed.includes("hver række = planen"));
  assert.ok(failed.includes("kryds-pulje-divergens 0"));
  assert.ok(failed.some((n) => n.startsWith("checkStageProfileSeedDivergence")));
});

test("parseDivergenceScriptOutput læser FØR-kolonnen og afviser ukendt output", () => {
  const out = [
    "Division | puljer | etape-slots | divergerende FØR | divergerende EFTER",
    "Div 1    |   4    |     160     |         0        |         0",
    "Div 2    |   4    |     128     |         2        |         0",
  ].join("\n");
  assert.deepEqual(parseDivergenceScriptOutput(out), { rows: 2, divergingNow: 2 });
  assert.equal(parseDivergenceScriptOutput("boom"), null);
});

test("calendar-cachen ventes ud (TTL + margin) efter sidste skrivning", async () => {
  let slept = 0;
  const last = new Date("2026-10-21T09:00:00Z");
  const res = await waitForCalendarCache({ lastWriteAt: last, clock: () => new Date("2026-10-21T09:00:10Z"), sleep: async (ms) => { slept = ms; } });
  assert.equal(slept, CALENDAR_CACHE_TTL_MS + CALENDAR_CACHE_MARGIN_MS - 10_000);
  assert.equal(res.emptyAt.toISOString(), "2026-10-21T09:01:05.000Z");
  assert.deepEqual(await waitForCalendarCache({ lastWriteAt: null, clock: () => new Date("2026-10-21T09:00:00Z") }), { waitedMs: 0, emptyAt: null });
});

test("CALENDAR_CACHE_TTL_MS matcher CACHE_TTL.calendar i routes/api.js", () => {
  const src = readFileSync(join(__dirname, "..", "routes", "api.js"), "utf8");
  const m = src.match(/\n\s*calendar:\s*([\d_]+),/);
  assert.ok(m, "CACHE_TTL.calendar ikke fundet");
  assert.equal(Number(m[1].replace(/_/g, "")), CALENDAR_CACHE_TTL_MS);
});

test("dry-run-klienten kaster ved enhver skrivning", () => {
  const fake = { from: () => ({ select: () => "ok", insert: () => "skrev", delete: () => "slettede" }) };
  const ro = createReadOnlyClient(fake);
  assert.equal(ro.from("seasons").select(), "ok");
  assert.throws(() => ro.from("race_stage_profiles").insert([]), /blokeret/);
  assert.throws(() => ro.from("race_stage_profiles").delete(), /blokeret/);
  assert.throws(() => ro.rpc("x"), /blokeret/);
});

// ── 5. Testportens rute-format ────────────────────────────────────────────────────────

test("ruterne følger cz-race-routes/v1: én fil pr. løb, race_id = filnavn, etaper 1..n, kun tabel-kolonner", async () => {
  const { plan, input } = await setup();
  const routes = buildRoutesFiles({ plan, generatedAt: "2026-10-21T08:00:00.000Z" });
  assert.equal(routes.manifest.format, ROUTES_FORMAT);
  assert.equal(routes.manifest.season, 5);
  assert.equal(routes.files.size, input.races.length);
  const stagesById = new Map(input.races.map((r) => [r.id, r.stages]));
  for (const [name, body] of routes.files) {
    assert.equal(body.format, ROUTES_FORMAT);
    assert.equal(name, `${body.race_id}.json`);
    assert.equal(body.stages, body.profiles.length);
    assert.equal(body.stages, stagesById.get(body.race_id));
    assert.deepEqual(body.profiles.map((p) => p.stage_number), Array.from({ length: body.stages }, (_, i) => i + 1));
    for (const p of body.profiles) {
      assert.ok(p.profile_type);
      for (const k of Object.keys(p)) assert.ok(PROFILE_COLUMNS.includes(k), k);
    }
  }
});

test("rute-mappen og den private mappe skal ligge i balance-internals", () => {
  assert.throws(() => writeRoutesDir(join(__dirname, "out-routes"), { manifest: {}, files: new Map() }), /balance-internals/);
  assert.throws(() => assertPrivatePath("docs/snapshots/6857", "--private-dir"), /hard rule 17/);
  assert.ok(assertPrivatePath(join("x", "balance-internals", "6857"), "--private-dir").includes("balance-internals"));
});

// ── 6. Rapporten ──────────────────────────────────────────────────────────────────────

test("rapporten: tabel A, GT-optakt, monument følger den håndskrevne rute, signatur-pins", async () => {
  const { input, plan } = await setup();
  const invariants = checkInvariants({ input, plan, now: BEFORE_CUTOVER });
  const report = buildReport({ input, plan, invariants, diff: diffAgainstCurrent(plan, input.profiles), generatedAt: "2026-10-21T08:00:00.000Z" });
  const d1 = report.full.divisions.find((d) => d.tier === 1);
  assert.equal(d1.identity.rows.find((x) => x.type === "climbers_gt_prelude").got, 1);
  assert.equal(d1.identity.ok, false, "1 af 3 GT-optakter mod tabel A");
  assert.deepEqual(d1.gtPreludes.map((g) => g.ok), [true]);
  assert.equal(d1.monuments[0].authored, true);
  assert.equal(d1.monuments[0].matchesAuthored, true);
  assert.equal(d1.monuments[0].after.last_top.km_to_finish, 15);
  assert.equal(d1.pins[0].pinned, true);
  assert.equal(d1.pins[0].stage, 2);
  const d2 = report.full.divisions.find((d) => d.tier === 2);
  assert.equal(d2.pins[0].kind, "prologue");
  assert.equal(d2.pins[0].pinned, true);
  assert.match(report.fullMarkdown, /Monument Fiktiv/);
});

test("den offentlige rapport har ingen løbsnavne, stigninger eller vægte (hard rule 17)", async () => {
  const { input, plan } = await setup();
  const invariants = checkInvariants({ input, plan, now: BEFORE_CUTOVER });
  const report = buildReport({ input, plan, invariants, diff: diffAgainstCurrent(plan, input.profiles), generatedAt: "2026-10-21T08:00:00.000Z" });
  const pub = `${report.publicMarkdown}\n${canonicalJson(report.public)}`;
  for (const c of input.catalog) assert.ok(!pub.includes(c.name), c.name);
  for (const forbidden of ["Col du Fictif", "Muur Fictief", "demand_vector", "punch", "km_to_finish", "distance_km"]) assert.ok(!pub.includes(forbidden), forbidden);
});

test("identityTable tæller kun korte etapeløb og melder løb uden type", () => {
  const cat = new Map([["a", { race_identity_type: "sprinters" }], ["b", { race_identity_type: null }], ["g", { race_identity_type: null }]]);
  const t = identityTable(4, [
    { pool_race_id: "a", race_type: "stage_race", stages: 5 },
    { pool_race_id: "b", race_type: "stage_race", stages: 3 },
    { pool_race_id: "g", race_type: "stage_race", stages: 21 },
    { pool_race_id: "s", race_type: "single", stages: 1 },
  ], cat);
  assert.equal(t.rows.find((x) => x.type === "sprinters").got, 1);
  assert.equal(t.untyped, 1);
  assert.equal(t.ok, false);
});

test("signaturePins: featurens egenskaber skal holde, ikke kun navnet (Codex-fund)", () => {
  const top = { name: "Top", category: "1", length_km: 9, avg_gradient: 7 };
  const profiles = [
    { stage_number: 1, profile_type: "flat", climbs: [], sectors: [{ kind: "cobbles", name: "Pavé A", length_km: 2 }] },
    { stage_number: 2, profile_type: "mountain", climbs: [{ ...top, crest_km: 150, summit_finish: false }], sectors: [] },
    { stage_number: 3, profile_type: "itt", climbs: [], sectors: [] },
  ];
  const pin = (feature) => signaturePins({ name: "x" }, { features: [feature] }, profiles)[0];
  // summit_finish kræver bjergtop
  assert.equal(pin({ kind: "summit_finish", stage_hint: "any", ...top, summit_finish: true }).pinned, false);
  // climb: navn OG kategori/længde/gradient
  assert.equal(pin({ kind: "climb", stage_hint: "any", ...top, summit_finish: false }).pinned, true);
  assert.equal(pin({ kind: "climb", stage_hint: "any", ...top, category: "HC", summit_finish: false }).pinned, false);
  // queen = løbets hårdeste etape(r); låst et andet sted siges tydeligt
  assert.equal(pin({ kind: "climb", stage_hint: "queen", ...top, summit_finish: false }).stage, 2);
  const harder = [...profiles, { stage_number: 4, profile_type: "high_mountain", climbs: [], sectors: [] }];
  const offQueen = signaturePins({ name: "x" }, { features: [{ kind: "climb", stage_hint: "queen", ...top, summit_finish: false }] }, harder)[0];
  assert.deepEqual([offQueen.pinned, offQueen.stage, /ikke på den etape/.test(offQueen.reason)], [false, 2, true]);
  assert.match(pin({ kind: "climb", stage_hint: "any", name: "Ukendt", category: "1", length_km: 9, avg_gradient: 7, summit_finish: false }).reason, /findes ikke/);
  // sektor: navn, belægning og længde
  assert.equal(pin({ kind: "sector", stage_hint: "first", surface: "cobbles", name: "Pavé A", length_km: 2 }).pinned, true);
  assert.equal(pin({ kind: "sector", stage_hint: "first", surface: "gravel", name: "Pavé A", length_km: 2 }).pinned, false);
  // enkeltstart: båndet tæller (hilly kræver itt_hilly)
  assert.equal(pin({ kind: "itt", stage_hint: "last", band: "flat" }).pinned, true);
  assert.equal(pin({ kind: "itt", stage_hint: "last", band: "hilly" }).pinned, false);
});

test("matchesAuthored: alle forfattede felter, ikke kun summer og navne (Codex-fund)", () => {
  const generated = { ...structuredClone(AUTHORED), demand_vector: { cobblestone: 1 }, segments: [{ x: 1 }], weather: null, elevation_profile: [] };
  assert.equal(matchesAuthored(generated, AUTHORED), true);
  const moved = structuredClone(generated);
  moved.climbs[0].crest_km = 230;
  assert.equal(matchesAuthored(moved, AUTHORED), false);
  const finale = { ...structuredClone(generated), finale_type: "punch" };
  assert.equal(matchesAuthored(finale, AUTHORED), false);
  const sector = structuredClone(generated);
  sector.sectors[0].length_km = 3;
  assert.equal(matchesAuthored(sector, AUTHORED), false);
  assert.equal(matchesAuthored(null, AUTHORED), null);
});

test("backup-tabellen er nøglet på etape-pladsen, så en genkørsel efter apply ikke blander generationer (Codex-fund)", () => {
  const sql = buildBackupSql("backup_6857_race_stage_profiles_20261021", SEASON_ID);
  assert.match(sql, /\(race_id, stage_number\);/);
  assert.match(sql, /on conflict \(race_id, stage_number\) do nothing/);
  assert.doesNotMatch(sql, /on conflict \(id\)/);
});

test("gtPreludes: optakten er det korte etapeløb der SLUTTER lige før Grand Touren", () => {
  const cat = new Map([["pre", { race_identity_type: "climbers_gt_prelude" }], ["late", { race_identity_type: "sprinters" }], ["gt", {}]]);
  const races = [
    { id: "a", pool_race_id: "pre", name: "Optakt", race_type: "stage_race", stages: 5 },
    { id: "b", pool_race_id: "late", name: "Overlapper", race_type: "stage_race", stages: 5 },
    { id: "g", pool_race_id: "gt", name: "GT", race_type: "stage_race", stages: 21 },
  ];
  const span = (d0, d1) => ({ start: Date.UTC(2026, 10, d0), end: Date.UTC(2026, 10, d1) });
  // "Overlapper" starter senere end optakten men slutter EFTER GT-starten: tæller ikke
  const spans = new Map([["a", span(1, 5)], ["b", span(3, 9)], ["g", span(8, 30)]]);
  assert.deepEqual(gtPreludes(races, cat, spans).map((g) => [g.prelude, g.ok]), [["Optakt", true]]);
  // uden tidsplan: intet kan påvises, og tjekket er rødt
  assert.deepEqual(gtPreludes(races, cat, new Map()).map((g) => g.ok), [false]);
});

// ── Identitets-fil oven på race_pool (kun dry-run) ────────────────────────────────────

test("--identity-file lægger seed-filen oven på kataloget i hukommelsen, med L1's krav", () => {
  const cat = catalog().map((c) => ({ ...c, race_identity_type: null, signature: null, authored_route: null }));
  const doc = { version: 1, entries: [
    { external_id: "x-d2", race_identity_type: "time_trial", signature: { features: [{ kind: "prologue", stage_hint: "first", band: "flat" }] }, authored_route: null },
    { external_id: "x-mon", race_identity_type: null, signature: null, authored_route: AUTHORED },
    { external_id: "x-not-in-s5", race_identity_type: "gravel", signature: null, authored_route: null },
  ] };
  const res = overlayIdentity(cat, doc);
  assert.equal(res.entries, 3);
  assert.equal(res.applied, 2);
  assert.equal(res.catalog.find((c) => c.id === "p-d2").race_identity_type, "time_trial");
  assert.deepEqual(res.catalog.find((c) => c.id === "p-mon").authored_route, AUTHORED);
  assert.equal(cat.find((c) => c.id === "p-d2").race_identity_type, null, "input-kataloget røres ikke");
  assert.throws(() => overlayIdentity(cat, { version: 1, entries: [{ external_id: "x-d2s", race_identity_type: "sprinters", signature: null, authored_route: null }] }), /kræver stage_race/);
  assert.throws(() => overlayIdentity(cat, { version: 1, entries: [{ external_id: "x-d2", race_identity_type: "nope", signature: null, authored_route: null }] }), /unknown type/);
  assert.throws(() => parseArgs(["--apply", "--season", "5", "--confirm-season-upcoming", "--backup-table=backup_6857_race_stage_profiles_20261021", `--plan-hash=${"a".repeat(64)}`, "--identity-file=x.json"]), /kun til dry-run/);
  assert.equal(parseArgs(["--identity-file=database/seed/race_identity.json"]).identityFile, "database/seed/race_identity.json");
});

// ── Mod den rigtige generator (nuværende signatur) ────────────────────────────────────

test("den rigtige S5-generator: gyldige rækker for hvert løb og samme plan-hash to gange", async () => {
  const archetypes = Object.keys(ARCHETYPE_PROFILES);
  const pick = (want) => (archetypes.includes(want) ? want : archetypes[0]);
  const s = state();
  // Uden identitetsfelter: testen gælder generatorens gyldige rækker og stabile hash. Identitets-
  // stien kræver L2 (#6931) og testes af assertIdentityGeneratorAvailable ovenfor.
  s.catalog = s.catalog.map(({ race_identity_type: _t, signature: _s, authored_route: _a, ...c }) => ({ ...c, terrain_archetype: pick(c.terrain_archetype) }));
  const run = async () => {
    const input = await loadRegenInput(fakeDb(structuredClone(s)), 5);
    return { input, plan: buildRegenPlan(input, { generatorFactory: defaultGeneratorFactory, evaluateGate: greenGate, guarantees: NO_GUARANTEES }) };
  };
  const a = await run();
  const b = await run();
  assert.equal(a.plan.planErrors.length, 0);
  assert.equal(a.plan.planHash, b.plan.planHash);
  for (const r of a.input.races) {
    const rows = a.plan.rowsByRaceId.get(r.id);
    assert.equal(rows.length, r.stages, r.id);
    assert.deepEqual(rows.map((x) => x.stage_number), Array.from({ length: r.stages }, (_, i) => i + 1));
  }
});

test("#6929 (Codex P1) identityGateViolations: rød identitet, upinnet signatur eller afvigende monument blokerer apply", async () => {
  const { identityGateViolations } = await import("./regenS5StageProfiles.mjs");
  const green = { divisions: [{ tier: 1, identity: { ok: true, untyped: 0 }, pins: [{ pinned: true }], monuments: [{ authored: true, matchesAuthored: true }], gtPreludes: [{ ok: true }] }] };
  assert.deepEqual(identityGateViolations(green), []);
  const red = { divisions: [{ tier: 2, identity: { ok: false, untyped: 3 }, pins: [{ pinned: false }], monuments: [{ authored: true, matchesAuthored: false }] }] };
  const v = identityGateViolations(red);
  assert.equal(v.length, 3);
  assert.match(v.join(" "), /tabel A er rød \(3 uden type\)/);
  assert.match(v.join(" "), /signatur/);
  assert.match(v.join(" "), /authored_route/);
});

test("#6929 (Codex P1) identityGateViolations: monument uden authored_route og forkert GT-optakt blokerer", async () => {
  const { identityGateViolations } = await import("./regenS5StageProfiles.mjs");
  const d = { tier: 1, identity: { ok: true, untyped: 0 }, pins: [], monuments: [{ authored: false, matchesAuthored: null }], gtPreludes: [{ ok: true }, { ok: false }] };
  const v = identityGateViolations({ divisions: [d] }).join(" ");
  assert.match(v, /uden authored_route/);
  assert.match(v, /GT-optakt/);
});

test("#6929 (Codex P1) applyPlan: vagterne læses igen før hver sletning; et nyligt claimet løb stopper før delete", async () => {
  const { applyPlan } = await import("./regenS5StageProfiles.mjs");
  const deleted = [];
  const db = {
    guardsOf: async (ids) => ({ races: ids.map((id) => ({ id, stages_completed: 0, engine_rules_revision: null })), claims: ids.includes("r2") ? [{ race_id: "r2", stage_index: 0 }] : [] }),
    deleteProfiles: async (ids) => { deleted.push(...ids); },
    insertProfiles: async () => {},
  };
  const plan = { rowsByRaceId: new Map([["r2", [{ race_id: "r2", stage_number: 1 }]]]) };
  await assert.rejects(applyPlan({ db, plan, racesToWrite: ["r2"], clock: () => new Date("2026-10-21T09:00:00Z") }), /claimet/);
  assert.deepEqual(deleted, [], "intet slettet");
});

test("#6929 (Codex P2) --skip-cache-wait er ikke tilladt med --apply", async () => {
  const { parseArgs } = await import("./regenS5StageProfiles.mjs");
  assert.throws(() => parseArgs(["--apply", "--season", "5", "--confirm-season-upcoming", "--backup-table=backup_6857_race_stage_profiles_20261020", `--plan-hash=${"a".repeat(64)}`, "--skip-cache-wait"]), /skip-cache-wait/);
});

test("#6929 (Codex P1) backup dækkes pr. etape-plads lige før sletning; restore sletter også løb der var tomme", async () => {
  const T = "backup_6857_race_stage_profiles_20261021";
  const rows = [{ race_id: "r1", stage_number: 1 }, { race_id: "r1", stage_number: 2 }];
  const db = { backupSlots: async () => new Set(["r1|1"]) };
  await assert.rejects(assertBackupCoversSlots(db, T, rows), /mangler 1 etape-pladser/);
  await assertBackupCoversSlots({ backupSlots: async () => new Set(["r1|1", "r1|2"]) }, T, rows);
  await assertBackupCoversSlots({ backupSlots: async () => { throw new Error("må ikke kaldes"); } }, T, []);
  const id = "11111111-1111-4111-8111-111111111111";
  const sql = buildRestoreSql(T, [id]);
  assert.ok(sql.includes(`where race_id in ('${id}');`), "apply's restore sletter kun de rørte løb (også tomme)");
  assert.ok(sql.includes(`from public.${T}\n   where race_id in ('${id}')`), "og genindsætter kun de rørte løb");
  assert.ok(!sql.includes("select distinct race_id"), "ingen sæson-bred sletning i apply's restore");
  assert.throws(() => buildRestoreSql(T, ["ikke-et-uuid"]), /uuid/);
  await assert.rejects(applyPlan({ db: {}, plan: { rowsByRaceId: new Map() }, racesToWrite: [] }), /clock skal injiceres/);
  await assert.rejects(waitForCalendarCache({ lastWriteAt: null }), /clock skal injiceres/);
});

test("#6929 (Codex P1) identitet uden L2's generator-sti fejler klart (merge L2 foer L3)", async () => {
  const { assertIdentityGeneratorAvailable } = await import("./regenS5StageProfiles.mjs");
  const typed = [{ id: "p1", race_identity_type: "hilly" }];
  assert.throws(() => assertIdentityGeneratorAvailable(typed, {}), /kræver L2 \(#6931\)/);
  assert.doesNotThrow(() => assertIdentityGeneratorAvailable(typed, { IDENTITY_GENERATOR_VERSION: 7 }));
  assert.doesNotThrow(() => assertIdentityGeneratorAvailable([{ id: "p2" }], {}), "uden identitet: ingen krav");
});

test("#6929 (Codex P1) applyPlan: et løb claimet UNDER skrivningen stopper kørslen højlydt", async () => {
  let reads = 0;
  const db = {
    guardsOf: async () => { reads += 1; return { races: [], claims: reads >= 2 ? [{ race_id: "r1", stage_index: 0 }] : [] }; },
    deleteProfiles: async () => {}, insertProfiles: async () => {},
  };
  const plan = { rowsByRaceId: new Map([["r1", [{ race_id: "r1", stage_number: 1 }]]]) };
  await assert.rejects(applyPlan({ db, plan, racesToWrite: ["r1"], clock: () => new Date("2026-10-21T09:00:00Z") }), /UNDER skrivningen/);
  assert.equal(reads, 2, "vagterne læses før og efter skrivningen");
});

test("#6929 (Codex P1) readTouchedRaces: tom uden fil, læser listen, fejler højlydt ved ødelagt fil", () => {
  const dir = mkdtempSync(join(tmpdir(), "touched-"));
  assert.deepEqual(readTouchedRaces(join(dir, "findes-ikke.json")), []);
  writeFileSync(join(dir, "t.json"), JSON.stringify({ races: ["a", "b"] }));
  assert.deepEqual(readTouchedRaces(join(dir, "t.json")), ["a", "b"]);
  writeFileSync(join(dir, "bad.json"), "{");
  assert.throws(() => readTouchedRaces(join(dir, "bad.json")), /kan ikke læses/);
});

test("#6929 (Codex P1) restore-scope: kun batches der faktisk går i gang noteres; tilstanden ligger datouafhængigt", async () => {
  // Ét løb pr. batch (200 rækker hver), så batch 2 fejler og batch 3 aldrig går i gang.
  const rows = (id) => Array.from({ length: 200 }, (_, i) => ({ race_id: id, stage_number: i + 1 }));
  const noted = [];
  const calls = [];
  const db = {
    deleteProfiles: async (ids) => { calls.push(["delete", ids[0]]); },
    insertProfiles: async (r) => { if (r[0].race_id === "r2") throw new Error("insert fejlede"); },
  };
  const plan = { rowsByRaceId: new Map([["r1", rows("r1")], ["r2", rows("r2")], ["r3", rows("r3")]]) };
  await assert.rejects(applyPlan({
    db, plan, racesToWrite: ["r1", "r2", "r3"], clock: () => new Date("2026-10-21T09:00:00Z"),
    onBeforeWrite: (ids) => { noted.push(...ids); calls.push(["noted", ids[0]]); },
  }), /insert fejlede/);
  assert.deepEqual(noted, ["r1", "r2"], "r3's batch gik aldrig i gang og noteres ikke");
  assert.deepEqual(calls.slice(0, 2), [["noted", "r1"], ["delete", "r1"]], "noteres før sletningen");
  const f = touchedStateFile("backup_6857_race_stage_profiles_20261021", "C:/x");
  const parts = f.split(/[\\/]/);
  assert.deepEqual(parts.slice(-4), ["balance-internals", "6857", "apply-state", "touched-backup_6857_race_stage_profiles_20261021.json"], "fast sted, ingen dato");
});
