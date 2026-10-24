// #2757 A2: s5FlatStageA2_2757.js på syntetiske snapshots (ingen prod, ingen tal fra spillet).
import test from "node:test";
import { generateRaceStageProfiles } from "../lib/raceStageProfileGenerator.js";
import assert from "node:assert/strict";

import {
  parseArgs, expandSnapshot, buildA2Plan, evaluateGates, buildBackupSql, buildRestoreSql, diffAgainstCurrent,
  applyPlan, postVerify, renderA2Html, renderA2Markdown, writeContent, violationKey, detectSeasonVariant, approvedPlanFrom, liveStateViolations, planHashOf, planSlots, planRoutes,
  INPUT_FORMAT, A2_WRITE_COLUMNS,
} from "./s5FlatStageA2_2757.js";

const RACE_A1 = "11111111-1111-4111-8111-111111111111";
const RACE_A2 = "22222222-2222-4222-8222-222222222222";
const RACE_B = "33333333-3333-4333-8333-333333333333";
const POOL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const POOL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
// Test-bånd (ikke de rigtige; de står privat i balance-internals/2757-a2/).
const BANDS = Object.freeze({ ascendingShareMax: 1, identicalShareMax: 1, identicalCountFloor: 2, distinctShareMin: 0, positionDistanceMax: 1, minRoutesPerStageCount: 2 });
const SIG = { features: [{ kind: "climb", name: "Muro Test", category: "3", length_km: 2.4, avg_gradient: 7.5, stage_hint: "any", summit_finish: false }] };

function snapshot(overrides = {}) {
  const route = [
    { stage_number: 1, profile_type: "rolling", finale_type: "flat_sprint", climbs: [{ name: "Côte Un", category: "4", summit_finish: false }], generator_version: 7, is_manual: false },
    { stage_number: 2, profile_type: "hilly", finale_type: "descent", climbs: [{ name: "Muro Test", category: "3", summit_finish: false }], generator_version: 7, is_manual: false },
    { stage_number: 3, profile_type: "medium_mountain", finale_type: "long_climb", climbs: [{ name: "Col Top", category: "2", summit_finish: true }], generator_version: 7, is_manual: false },
    { stage_number: 4, profile_type: "hilly", finale_type: "flat_sprint", climbs: [{ name: "Côte Deux", category: "3", summit_finish: false }], generator_version: 7, is_manual: false },
  ];
  return {
    format: INPUT_FORMAT, label: "test",
    season: { id: "00000000-0000-0000-0000-000000000005", number: 5, status: "upcoming" },
    divisions: [{ id: 4, tier: 3 }, { id: 5, tier: 3 }],
    races: [
      { id: RACE_A1, name: "Ronde Test", race_type: "stage_race", race_class: "ProSeries", stages: 4, stages_completed: 0, pool_race_id: POOL_A, league_division_id: 4, engine_rules_revision: null, route: "A", game_days: [2, 4, 7, 9], first_date: "2026-10-28" },
      { id: RACE_A2, name: "Ronde Test", race_type: "stage_race", race_class: "ProSeries", stages: 4, stages_completed: 0, pool_race_id: POOL_A, league_division_id: 5, engine_rules_revision: null, route: "A" },
      { id: RACE_B, name: "Tour Plat", race_type: "stage_race", race_class: "ProSeries", stages: 3, stages_completed: 0, pool_race_id: POOL_B, league_division_id: 4, engine_rules_revision: null, profile_types: "flat,hilly,flat", game_days: [12, 14, 17], first_date: "2026-10-30" },
      { id: "k1", name: "Klassiker", race_type: "single", race_class: "ProSeries", stages: 1, stages_completed: 0, pool_race_id: "p1", league_division_id: 4, engine_rules_revision: null, profile_types: "hilly", game_days: [2], first_date: "2026-10-28" },
    ],
    catalog: [
      { id: POOL_A, external_id: "cz-test-a", name: "Ronde Test", race_type: "stage_race", race_class: "ProSeries", terrain_archetype: "hilly_tour", race_identity_type: "hilly", signature: SIG },
      { id: POOL_B, external_id: "cz-test-b", name: "Tour Plat", race_type: "stage_race", race_class: "ProSeries", terrain_archetype: null, race_identity_type: "sprinters", signature: null },
      { id: "p1", name: "Klassiker", race_type: "single", race_class: "ProSeries", race_identity_type: null },
    ],
    routes: { A: route },
    claims: [],
    ...overrides,
  };
}

test("parseArgs: dry-run er standard; apply kræver owner-go, backup-tabel og plan-hash, aldrig --input", () => {
  assert.equal(parseArgs([]).apply, false);
  assert.throws(() => parseArgs(["--season=4"]), /kun sæson 5/);
  assert.throws(() => parseArgs(["--apply"]), /--owner-go/);
  assert.throws(() => parseArgs(["--apply", "--owner-go"]), /--backup-table/);
  assert.throws(() => parseArgs(["--apply", "--owner-go", "--backup-table=backup_2757_race_stage_profiles_20261024"]), /--plan-hash/);
  const hash = "a".repeat(64);
  assert.equal(parseArgs(["--apply", "--owner-go", "--backup-table=backup_2757_race_stage_profiles_20261024", `--plan-hash=${hash}`]).apply, true);
  assert.throws(() => parseArgs(["--apply", "--owner-go", "--backup-table=backup_2757_race_stage_profiles_20261024", `--plan-hash=${hash}`, "--input=x.json"]), /--input er kun til dry-run/);
  assert.throws(() => parseArgs(["--owner-go"]), /kun til --apply/);
  assert.throws(() => parseArgs(["--plan-hash", hash]), /kun til --apply/);
  assert.throws(() => parseArgs(["--ukendt"]), /ukendt flag/);
});

test("expandSnapshot: route, profile_types og game_days udfoldes; forkert format og etapeantal afvises", () => {
  const input = expandSnapshot(snapshot());
  assert.equal(input.profiles.filter((p) => p.race_id === RACE_A2).length, 4);
  assert.deepEqual(input.profiles.filter((p) => p.race_id === RACE_B).map((p) => p.profile_type), ["flat", "hilly", "flat"]);
  assert.deepEqual(input.schedule.filter((s) => s.race_id === RACE_A1).map((s) => s.game_day), [2, 4, 7, 9]);
  assert.equal(input.schedule.find((s) => s.race_id === RACE_A1 && s.stage_number === 1).scheduled_at, "2026-10-28");
  assert.throws(() => expandSnapshot({ ...snapshot(), format: "x" }), /format/);
  assert.throws(() => expandSnapshot(snapshot({ routes: {} })), /ruten "A" findes ikke/);
  const bad = snapshot();
  bad.races[2].profile_types = "flat,hilly";
  assert.throws(() => expandSnapshot(bad), /2 profiler, men stages = 3/);
});

test("buildA2Plan: kun løb uden flad etape; aldrig signatur-etapen eller topankomsten; puljerne får samme etape", () => {
  const input = expandSnapshot(snapshot());
  const plan = buildA2Plan(input);
  assert.deepEqual(plan.planErrors, []);
  assert.deepEqual(plan.items.map((it) => it.race_id).sort(), [RACE_A1, RACE_A2].sort(), "løbet med flade etaper røres ikke");
  const [a, b] = plan.items;
  assert.deepEqual(a.candidates, [1, 4], "signatur-etapen (2) og topankomsten (3) er aldrig kandidater");
  assert.ok([1, 4].includes(a.stage_number));
  assert.equal(a.stage_number, b.stage_number);
  assert.deepEqual(a.content, b.content, "samme parcours i begge puljer");
  assert.equal(a.content.profile_type, "flat");
  assert.equal(a.content.generator_version, 7, "etapen beholder løbets generator-version");
  assert.deepEqual(Object.keys(a.content), [...A2_WRITE_COLUMNS]);
  assert.deepEqual(a.benchmark, []);
  assert.equal(buildA2Plan(expandSnapshot(snapshot())).planHash, plan.planHash, "deterministisk plan-hash");
  assert.match(plan.planHash, /^[0-9a-f]{64}$/);
});

test("evaluateGates: grøn på et sundt snapshot; et startet løb eller en claim blokerer", () => {
  const input = expandSnapshot(snapshot());
  const plan = buildA2Plan(input);
  const gates = evaluateGates({ input, plan, orderBands: BANDS });
  assert.equal(gates.ok, true, gates.violations.join(" · "));
  assert.equal(gates.tiers.length, 1);
  assert.equal(gates.tiers[0].after.familyCounts.flat_sprint, gates.tiers[0].before.familyCounts.flat_sprint + 1);
  const started = snapshot();
  started.races[0].stages_completed = 1;
  const s = expandSnapshot(started);
  assert.equal(evaluateGates({ input: s, plan: buildA2Plan(s), orderBands: BANDS }).ok, false);
  const claimed = expandSnapshot(snapshot({ claims: [{ race_id: RACE_A2, stage_index: 0 }] }));
  assert.match(evaluateGates({ input: claimed, plan: buildA2Plan(claimed), orderBands: BANDS }).violations.join(" "), /claims/);
  assert.match(evaluateGates({ input, plan, orderBands: BANDS, ciGate: { ok: false, pass: 1, fail: 1, skipped: 0 } }).violations.join(" "), /calendarInvariantsCiGate4123/);
  // Brud der fandtes før A2 (her: det lille syntetiske løbssæt under gulvene) er ikke nye, selv om tallet flytter sig.
  assert.deepEqual(gates.tiers[0].newViolations, []);
  assert.ok(gates.tiers[0].before.violations.length > 0);
  assert.equal(violationKey("tier 3: \"flat_sprint\" har 3 etaper, under 12 (#3327)"), violationKey("tier 3: \"flat_sprint\" har 4 etaper, under 12 (#3327)"));
  assert.notEqual(violationKey("tier 3: \"rolling\" under gulvet"), violationKey("tier 3: \"flat_sprint\" under gulvet"));
});

test("backup.sql har RLS og dækker præcis etape-pladserne; restore lægger dem tilbage på samme plads", () => {
  const plan = buildA2Plan(expandSnapshot(snapshot()));
  const table = "backup_2757_race_stage_profiles_20261024";
  const sql = buildBackupSql(table, planSlots(plan));
  assert.match(sql, /enable row level security/);
  assert.match(sql, /grant select on table public\.backup_2757_race_stage_profiles_20261024 to service_role/);
  assert.match(sql, new RegExp(`'${RACE_A1}'::uuid, ${plan.items[0].stage_number}`));
  assert.match(sql, /on conflict \(race_id, stage_number\) do nothing/);
  assert.throws(() => buildBackupSql("backup_x", planSlots(plan)), /ugyldigt backup-navn/);
  assert.throws(() => buildBackupSql(table, [{ ...planSlots(plan)[0], race_id: "k1" }]), /uuid/);
  const restore = buildRestoreSql(table, planSlots(plan));
  assert.match(restore, /update public\.race_stage_profiles p/);
  assert.match(restore, /elevation_profile = b\.elevation_profile/);
});

function fakeDb(input, { backup = true } = {}) {
  const rows = input.profiles.map((p, i) => ({ id: `row-${i}`, ...p }));
  const writes = [];
  return {
    writes,
    rows,
    async fullProfilesOf(ids) { return rows.filter((r) => ids.includes(r.race_id)); },
    async backupSlots() { return new Set(backup ? rows.map((r) => `${r.race_id}|${r.stage_number}`) : []); },
    async updateStage(raceId, stageNumber, content) {
      const hit = rows.filter((r) => r.race_id === raceId && r.stage_number === stageNumber);
      assert.equal(hit.length, 1);
      Object.assign(hit[0], content);
      writes.push(`${raceId}|${stageNumber}`);
    },
  };
}

test("apply: kræver backup, skriver kun den valgte etape, er idempotent og post-verificerer", async () => {
  const input = expandSnapshot(snapshot());
  const plan = buildA2Plan(input);
  await assert.rejects(applyPlan({ db: fakeDb(input, { backup: false }), plan, backupTable: "backup_2757_race_stage_profiles_20261024" }), /mangler 2 af 2/);
  const db = fakeDb(input);
  const before = JSON.stringify(db.rows.filter((r) => !plan.items.some((it) => it.race_id === r.race_id && it.stage_number === r.stage_number)));
  assert.equal((await postVerify({ db, plan })).ok, false);
  const first = await applyPlan({ db, plan, backupTable: "backup_2757_race_stage_profiles_20261024" });
  assert.deepEqual(first, { written: 2, skipped: 0 });
  assert.equal(JSON.stringify(db.rows.filter((r) => !plan.items.some((it) => it.race_id === r.race_id && it.stage_number === r.stage_number))), before, "andre etaper urørte");
  const again = await applyPlan({ db, plan, backupTable: "backup_2757_race_stage_profiles_20261024" });
  assert.deepEqual(again, { written: 0, skipped: 2 });
  assert.equal((await postVerify({ db, plan })).ok, true);
  assert.equal(diffAgainstCurrent(plan, db.rows).toWrite.length, 0);
  assert.deepEqual(writeContent(db.rows.find((r) => r.race_id === RACE_A1 && r.stage_number === plan.items[0].stage_number)), plan.items[0].content);
});

test("rapport og billede: løbsnavne, før/efter og den nye etape markeret", () => {
  const input = expandSnapshot(snapshot());
  const plan = buildA2Plan(input);
  const gates = evaluateGates({ input, plan, orderBands: BANDS });
  const html = renderA2Html({ plan, gates, generatedAt: "2026-10-24T12:00:00Z" });
  assert.match(html, /Ronde Test/);
  assert.match(html, /2 puljer/);
  assert.equal(planRoutes(plan).length, 1, "puljerne samlet pr. rute");
  assert.equal((html.match(/class="st ch"/g) ?? []).length, 1, "én markeret etape pr. rute");
  const md = renderA2Markdown({ input, plan, gates, generatedAt: "2026-10-24T12:00:00Z" });
  assert.match(md, /\*\*1 ruter\*\* \(2 løb/);
  assert.match(md, /## Rækkefølge-gaten/);
  assert.match(md, /## Placering af flade etaper/);
});

test("detectSeasonVariant: finder divisionens gen-træk ud fra de skrevne ruter; ukendte ruter giver null", () => {
  const seed = { id: POOL_A, name: "Ronde Test", race_type: "stage_race", stages: 5, external_id: "cz-test-a", terrain_archetype: "hilly_tour", race_class: "ProSeries", season_id: "00000000-0000-0000-0000-000000000005", race_identity_type: "hilly", signature: null };
  for (const v of [0, 2]) {
    const rows = generateRaceStageProfiles({ ...seed, season_variant: v }, { profileModel: "s5", a2FlatStage: false });
    assert.equal(detectSeasonVariant(seed, rows), v);
  }
  const odd = generateRaceStageProfiles({ ...seed, season_variant: 0 }, { profileModel: "s5", a2FlatStage: false }).map((p) => ({ ...p, distance_km: 1 }));
  assert.equal(detectSeasonVariant(seed, odd), null);
});

test("apply genoptager den godkendte plan efter en delvis kørsel og nægter at skrive ved drift", async () => {
  const input = expandSnapshot(snapshot());
  const plan = buildA2Plan(input);
  const doc = JSON.parse(JSON.stringify({ planHash: plan.planHash, gates: { ok: true }, plan }));
  const approved = approvedPlanFrom(doc, plan.planHash);
  assert.equal(planHashOf(approved.items), plan.planHash);
  assert.throws(() => approvedPlanFrom(doc, "b".repeat(64)), /hash/);
  const tampered = JSON.parse(JSON.stringify(doc));
  tampered.plan.items[0].writes[0].content.distance_km = 1;
  assert.throws(() => approvedPlanFrom(tampered, plan.planHash), /hash/);
  // Delvis kørsel: kun den første etape blev skrevet, så fejlede forbindelsen.
  const db = fakeDb(input);
  const failing = { ...db, updateStage: async (raceId, stageNumber, content) => { if (db.writes.length) throw new Error("netværk"); return db.updateStage(raceId, stageNumber, content); } };
  await assert.rejects(applyPlan({ db: failing, plan: approved, backupTable: "backup_2757_race_stage_profiles_20261024" }), /netværk/);
  assert.equal(db.writes.length, 1);
  // Planen bygget om fra prod nu ville være en anden (løbet har en flad etape), men den godkendte genoptages.
  const rebuilt = buildA2Plan({ ...input, profiles: db.rows });
  assert.notEqual(rebuilt.planHash, plan.planHash);
  assert.deepEqual(await applyPlan({ db, plan: approved, backupTable: "backup_2757_race_stage_profiles_20261024" }), { written: 1, skipped: 1 });
  assert.equal((await postVerify({ db, plan: approved })).ok, true);
  // Drift: en etape der hverken er dry-runnets eller planens, stopper alt.
  const drifted = fakeDb(input);
  const slot = drifted.rows.find((r) => r.race_id === RACE_A2 && r.stage_number === plan.items[1].stage_number);
  slot.profile_type = "medium_mountain";
  await assert.rejects(applyPlan({ db: drifted, plan: approved, backupTable: "backup_2757_race_stage_profiles_20261024" }), /ændret siden/);
  assert.equal(drifted.writes.length, 0);
});

test("Codex P2: en etape ændret efter dry-run (kun stigninger) skrives ikke over", async () => {
  const input = expandSnapshot(snapshot());
  const plan = buildA2Plan(input);
  const db = fakeDb(input);
  const slot = db.rows.find((r) => r.race_id === RACE_A1 && r.stage_number === plan.items[0].stage_number);
  // Samme type, afslutning, distance og højdemeter, men en anden stigningsliste.
  slot.climbs = [...(slot.climbs ?? []), { name: "Ny stigning", km: 1, category: 4 }];
  assert.equal(diffAgainstCurrent(plan, db.rows).drift.length, 1);
  await assert.rejects(applyPlan({ db, plan, backupTable: "backup_2757_race_stage_profiles_20261024" }), /ændret siden/);
  assert.equal(db.writes.length, 0);
});

test("Codex P2: post-verify fejler på en flad etape med forkert indhold (drift tæller som afvigelse)", async () => {
  const input = expandSnapshot(snapshot());
  const plan = buildA2Plan(input);
  const db = fakeDb(input);
  await applyPlan({ db, plan, backupTable: "backup_2757_race_stage_profiles_20261024" });
  const slot = db.rows.find((r) => r.race_id === RACE_A1 && r.stage_number === plan.items[0].stage_number);
  slot.distance_km = 1;
  const verify = await postVerify({ db, plan });
  assert.equal(verify.ok, false);
  assert.equal(verify.mismatched, 1);
});

test("liveStateViolations: et startet løb, en claim eller et manglende løb stopper apply", () => {
  const input = expandSnapshot(snapshot());
  const plan = buildA2Plan(input);
  assert.deepEqual(liveStateViolations(input, plan), []);
  const started = expandSnapshot(snapshot());
  started.races[0].stages_completed = 2;
  assert.match(liveStateViolations(started, plan).join(" "), /startet/);
  assert.match(liveStateViolations({ ...input, claims: [{ race_id: RACE_A1, stage_index: 0 }] }, plan).join(" "), /claims/);
  assert.match(liveStateViolations({ ...input, races: input.races.filter((r) => r.id !== RACE_A2) }, plan).join(" "), /findes ikke/);
});

// ── #2757 rækkefølge-variation ──────────────────────────────────────────────────────

const RACE_C1 = "44444444-4444-4444-8444-444444444444";
const RACE_C2 = "55555555-5555-4555-8555-555555555555";
const POOL_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const fullRow = (stage, type, km, extra = {}) => ({
  stage_number: stage, profile_type: type, finale_type: "flat_sprint", demand_vector: { sprint: 1 }, generator_version: 7, is_manual: false,
  distance_km: km, elevation_gain_m: km * 10, climbs: [], sprints: [], sectors: [], segments: [{ km }], weather: { t: km }, elevation_profile: [km], ...extra,
});

/** Snapshottet + en rute med fast stigende skabelon (ingen flad etape) i begge puljer, med fulde rækker. */
function withTemplateRoute(overrides = {}) {
  const base = snapshot();
  const route = [fullRow(1, "rolling", 151), fullRow(2, "rolling", 152), fullRow(3, "hilly", 153), fullRow(4, "medium_mountain", 154), fullRow(5, "hilly", 155)];
  const race = (id, div) => ({ id, name: "Giro Skabelon", race_type: "stage_race", race_class: "ProSeries", stages: 5, stages_completed: 0, pool_race_id: POOL_C, league_division_id: div, engine_rules_revision: null, route: "C", game_days: [20, 21, 22, 23, 24], first_date: "2026-11-01" });
  return {
    ...base,
    races: [...base.races, race(RACE_C1, 4), race(RACE_C2, 5)],
    catalog: [...base.catalog, { id: POOL_C, external_id: "cz-test-c", name: "Giro Skabelon", race_type: "stage_race", race_class: "ProSeries", terrain_archetype: "hilly_tour", race_identity_type: "hilly", signature: null }],
    routes: { ...base.routes, C: route },
    ...overrides,
  };
}

test("#2757 plan: skabelon-ruten får ny rækkefølge af de samme etaper (samme indhold, kun ny plads), derefter A2", () => {
  const input = expandSnapshot(withTemplateRoute());
  const plan = buildA2Plan(input);
  assert.deepEqual(plan.planErrors, []);
  const [c1, c2] = plan.items.filter((it) => it.pool_race_id === POOL_C);
  assert.ok(c1.order, "ruten får en ny rækkefølge");
  assert.deepEqual(c1.order, c2.order, "puljerne kører samme rute (#2276)");
  assert.deepEqual(c1.writes, c2.writes.map((w) => ({ ...w })), "samme skrivninger i begge puljer");
  assert.equal(c1.order[4], 5, "finalen står fast");
  assert.equal(c1.order[3], 4, "kongeetapen står fast");
  assert.deepEqual([...c1.order].sort(), [1, 2, 3, 4, 5]);
  const types = c1.after.map((p) => p.profile_type);
  assert.ok(c1.stage_number != null && types[c1.stage_number - 1] === "flat", "A2's flade etape ligger ovenpå");
  const rows = input.profiles.filter((p) => p.race_id === RACE_C1).sort((a, b) => a.stage_number - b.stage_number);
  for (const w of c1.writes) {
    if (w.source_stage_number == null) { assert.equal(w.content.profile_type, "flat"); continue; }
    assert.deepEqual(w.content, writeContent(rows[w.source_stage_number - 1]), `plads ${w.stage_number}: hele etapen fra plads ${w.source_stage_number}`);
    assert.notEqual(w.source_stage_number, w.stage_number);
  }
  const gates = evaluateGates({ input, plan, orderBands: BANDS });
  assert.equal(gates.ok, true, gates.violations.join(" · "));
  assert.ok(gates.order.after.ascending < gates.order.before.ascending, "færre ruter med fast stigende rækkefølge");
  assert.ok(gates.order.violationsBefore.length === 0 && gates.order.violationsAfter.length === 0);
  const strict = evaluateGates({ input, plan, orderBands: { ...BANDS, distinctShareMin: 2 } });
  assert.match(strict.violations.join(" "), /rækkefølge-gaten/);
  assert.throws(() => evaluateGates({ input, plan }), /order-variation band/);
});

test("#2757 apply: en ny rækkefølge skrives plads for plads, kan genoptages, og post-verify holder", async () => {
  const input = expandSnapshot(withTemplateRoute());
  const plan = buildA2Plan(input);
  const db = fakeDb(input);
  const slots = planSlots(plan);
  const failing = { ...db, updateStage: async (raceId, stageNumber, content) => { if (db.writes.length === 3) throw new Error("netværk"); return db.updateStage(raceId, stageNumber, content); } };
  await assert.rejects(applyPlan({ db: failing, plan, backupTable: "backup_2757_race_stage_profiles_20261024" }), /netværk/);
  const res = await applyPlan({ db, plan, backupTable: "backup_2757_race_stage_profiles_20261024" });
  assert.deepEqual(res, { written: slots.length - 3, skipped: 3 });
  assert.equal((await postVerify({ db, plan })).ok, true);
  const c1 = db.rows.filter((r) => r.race_id === RACE_C1).sort((a, b) => a.stage_number - b.stage_number);
  const item = plan.items.find((it) => it.race_id === RACE_C1);
  assert.deepEqual(c1.map((r) => r.profile_type), item.after.map((p) => p.profile_type));
  assert.deepEqual(c1.map((r) => r.id), fakeDb(input).rows.filter((r) => r.race_id === RACE_C1).sort((x, y) => x.stage_number - y.stage_number).map((r) => r.id), "samme række-id'er pr. plads");
});

test("#2757 managerplaner (etaperoller/holdordrer) på en ændret etape blokerer; uden fulde rækker kan ruten ikke flyttes", () => {
  const input = expandSnapshot(withTemplateRoute({ stage_plans: [{ race_id: RACE_C1, stage_number: 1, kind: "race_stage_roles" }] }));
  const plan = buildA2Plan(input);
  assert.match(evaluateGates({ input, plan, orderBands: BANDS }).violations.join(" "), /etaperoller eller holdordrer/);
  assert.match(liveStateViolations(input, plan).join(" "), /etaperoller\/holdordrer/);
  const thin = withTemplateRoute();
  thin.routes.C = thin.routes.C.map((r) => ({ ...r, segments: undefined, weather: undefined, elevation_profile: undefined }));
  assert.match(buildA2Plan(expandSnapshot(thin)).planErrors.join(" "), /fulde etaperækker mangler/);
});
