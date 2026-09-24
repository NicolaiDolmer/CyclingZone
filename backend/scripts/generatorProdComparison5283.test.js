// #5283 punkt 2 — sammenligningsscriptet (generator side om side med prod).
//
// Tre ting skal kunne bevises uden prod-adgang:
//   1. READ-ONLY: hele kørslen mod en fixture-klient kalder aldrig insert,
//      update, upsert, delete eller rpc, og fixturens tabeller er uændrede.
//   2. DETERMINISTISK: samme seed = samme tabel byte for byte; en anden seed
//      giver en anden trup.
//   3. MATCHNING: hver prod-rytter i tabellen har samme sæson-alder og
//      primary_type som mindst én genereret rytter, og pensionerede, A6-fødte
//      og ryttere uden evne-række kommer aldrig med.
import test from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import {
  parseArgs,
  pickComparisonTeams,
  generatedCaps,
  pickProdSample,
  candidateProdRiders,
  runComparison,
  defaultOutFile,
  TEAM_COUNT,
  PROD_SAMPLE_SIZE,
} from "./generatorProdComparison5283.mjs";
import { planYouthSquads, DEFAULT_SEED, DEFAULT_TARGET_SEASON } from "./generateYouthSquadsS4.js";
import { deriveForRiderIds } from "../lib/backfillCores.js";
import { createFakeSupabase } from "../lib/testUtils/fakeSupabase.js";
import { ageForSeason } from "../lib/riderSeasonAge.js";
import { U23_BIRTH_TIER, YOUTH_BIRTH_TIER } from "../lib/riderBirthPriors.js";
import { VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";
import { RIDER_TYPES } from "../lib/riderTypes.js";
import { SQUAD_CAPS } from "../lib/squads.js";
import { loadValuationModelById, DEFAULT_VALUATION_MODEL_ID } from "../lib/riderValuationModelSelect.js";

const MODEL = loadValuationModelById(DEFAULT_VALUATION_MODEL_ID);
const MODELS = { valuationModel: MODEL, productionValuationModel: MODEL };
const ACTIVE_SEASON = 3;
const TARGET_SEASON = DEFAULT_TARGET_SEASON;
const TYPES = RIDER_TYPES.map((t) => t.key);

// ── Fixture ──────────────────────────────────────────────────────────────────
const teamId = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const team = (n, division, extra = {}) => ({
  id: teamId(n),
  name: `Hold ${n}`,
  is_ai: true,
  is_bank: false,
  is_frozen: false,
  is_test_account: false,
  league_division_id: division,
  pending_removal_at: null,
  retired_at: null,
  parked_at: null,
  ...extra,
});
// Sæson-alder `age` i den aktive sæson (S3 = 2028).
const bornForActiveAge = (age) => `${2028 - age}-03-01`;
const abilityRow = (riderId) => ({
  rider_id: riderId,
  ...Object.fromEntries(VISIBLE_ABILITIES.map((k, j) => [k, 20 + j])),
  ability_caps: Object.fromEntries(VISIBLE_ABILITIES.map((k, j) => [k, 40 + j])),
});

function fixtureState() {
  const riders = [];
  const derived = [];
  const rider = (id, age, type, extra = {}) => {
    riders.push({
      id,
      firstname: "Prod",
      lastname: id,
      birthdate: bornForActiveAge(age),
      primary_type: type,
      secondary_type: TYPES[(TYPES.indexOf(type) + 1) % TYPES.length],
      potentiale: 3,
      base_value: 100000 + riders.length,
      is_retired: false,
      archetype_draw: null,
      team_id: null,
      is_academy: false,
      squad: "senior",
      ...extra,
    });
  };
  for (const type of TYPES) {
    for (const age of [19, 20, 21, 22]) {
      rider(`p-${age}-${type}-ok`, age, type);
      derived.push(abilityRow(`p-${age}-${type}-ok`));
      rider(`p-${age}-${type}-retired`, age, type, { is_retired: true });
      derived.push(abilityRow(`p-${age}-${type}-retired`));
      rider(`p-${age}-${type}-noabil`, age, type); // ingen evne-række
    }
    // Forkert alder: må aldrig matche en 19-22-årig.
    for (const age of [18, 23]) {
      rider(`p-${age}-${type}-decoy`, age, type);
      derived.push(abilityRow(`p-${age}-${type}-decoy`));
    }
    // Født af A6 selv: er ikke en "eksisterende" rytter at sammenligne med.
    rider(`p-20-${type}-a6`, 20, type, { archetype_draw: { primary: type, birth: { tier: U23_BIRTH_TIER, seed: 1, v: 1 } } });
    derived.push(abilityRow(`p-20-${type}-a6`));
    // Født af akademiets ungdomsbånd (anden tier end U23) — er STADIG et
    // priors-fødsel, ikke en "eksisterende" rytter. Lokkerytter for fund 1:
    // før fixen udelukkede isComparableProdRider kun tier "u23".
    rider(`p-20-${type}-youth`, 20, type, { archetype_draw: { primary: type, birth: { tier: YOUTH_BIRTH_TIER, seed: 1, v: 1 } } });
    derived.push(abilityRow(`p-20-${type}-youth`));
  }
  return {
    seasons: [{ id: "s3", number: ACTIVE_SEASON, status: "active" }, { id: "s2", number: 2, status: "completed" }],
    league_divisions: [1, 2, 3, 4].map((tier) => ({ id: `d${tier}`, tier, pool_index: 0 })),
    teams: [
      team(1, "d1"),
      team(2, "d2"),
      team(3, "d2"),
      team(4, "d3"),
      team(5, "d4"),
      team(6, "d1", { is_ai: false }), // menneskehold
      team(7, "d1", { is_bank: true }), // banken er ikke et AI-hold
    ],
    riders,
    rider_derived_abilities: derived,
  };
}

/**
 * Fixture-klient der registrerer HVERT kald: læsninger pr. tabel, og enhver
 * skrivning eller rpc. Læsningerne serveres af den projektions-bevidste fake,
 * så en kolonne scriptet glemmer at selecte, er `undefined` her som i prod.
 */
function readOnlyProbe(state) {
  const fake = createFakeSupabase(state);
  const calls = { reads: [], writes: [], rpc: [] };
  return {
    calls,
    rpc(name) {
      calls.rpc.push(name);
      return Promise.resolve({ data: null, error: null });
    },
    from(table) {
      const t = fake.from(table);
      return {
        select(cols) { calls.reads.push(table); return t.select(cols); },
        insert(p) { calls.writes.push(["insert", table]); return t.insert(p); },
        update(p) { calls.writes.push(["update", table]); return t.update(p); },
        upsert(p, o) { calls.writes.push(["upsert", table]); return t.upsert(p, o); },
        delete() { calls.writes.push(["delete", table]); return t.delete(); },
      };
    },
  };
}

// ── Argumenter ───────────────────────────────────────────────────────────────
// Absolut rod på alle platforme: join("C:", "repo") er relativ på POSIX (CI).
const TEST_ROOT = resolve(tmpdir(), "repo");

test("parseArgs: read-only uden undtagelse — --apply og ukendte flag afvises", () => {
  const root = TEST_ROOT;
  const opts = { root, cwd: root };
  for (const bad of [["--apply"], ["--owner-go"], ["--dry-run"], ["--whatever=1"], ["apply"]]) {
    assert.throws(() => parseArgs(bad, opts), /ukendt/, bad.join(" "));
  }
  assert.throws(() => parseArgs(["--seed=abc"], opts), /helt tal/);
  assert.throws(() => parseArgs(["--season=0"], opts), /≥ 1/);
  assert.throws(() => parseArgs([`--juniors=${SQUAD_CAPS.junior + 1}`], opts), /\[0,/);
});

test("parseArgs: defaults er A6's seed og målsæson, og tabellen lander i balance-internals/", () => {
  const root = TEST_ROOT;
  const a = parseArgs([], { root, cwd: root });
  assert.equal(a.seed, DEFAULT_SEED);
  assert.equal(a.season, DEFAULT_TARGET_SEASON);
  assert.equal(a.juniors, 0);
  assert.equal(a.out, join(root, "balance-internals", defaultOutFile({ season: a.season, seed: a.seed })));
  // Fra en undermappe er default-stien stadig repo-roden's balance-internals/.
  assert.equal(parseArgs([], { root, cwd: join(root, "backend") }).out, a.out);
  assert.throws(() => parseArgs(["--out=docs/x.md"], { root, cwd: root }), /balance-internals/);
  assert.throws(() => parseArgs(["--out=balance-internals/../docs/x.md"], { root, cwd: root }), /balance-internals/);
  assert.ok(parseArgs(["--out=balance-internals/x.md"], { root, cwd: root }).out.endsWith("x.md"));
});

// ── Holdvalg ─────────────────────────────────────────────────────────────────
test("pickComparisonTeams: 3 hold spredt over tierne, uafhængigt af rækkefølgen", () => {
  const perTeam = [
    { teamId: "t4", tier: 3, u23: 7 },
    { teamId: "t2", tier: 2, u23: 6 },
    { teamId: "t1", tier: 1, u23: 8 },
    { teamId: "t0", tier: 1, u23: 0 }, // intet U23-kuld (findes allerede) → aldrig valgt
    { teamId: "t3", tier: 2, u23: 9 },
    { teamId: "t5", tier: 4, u23: 6 },
  ];
  const picked = pickComparisonTeams(perTeam);
  assert.equal(picked.length, TEAM_COUNT);
  assert.deepEqual(picked.map((t) => t.teamId), ["t1", "t4", "t5"], "øverste, midterste og nederste tier");
  assert.deepEqual(picked.map((t) => t.alias), ["Hold A", "Hold B", "Hold C"]);
  assert.deepEqual(pickComparisonTeams([...perTeam].reverse()).map((t) => t.teamId), ["t1", "t4", "t5"]);
  // Færre tiers end hold: fyld op i (tier, id)-orden.
  const twoTiers = pickComparisonTeams(perTeam.filter((t) => t.tier <= 2));
  assert.deepEqual(twoTiers.map((t) => t.teamId), ["t1", "t2", "t3"]);
});

// ── Loftet på den genererede side = det derive'en persisterer ────────────────
test("generatedCaps: loftet er PRÆCIS det deriveForRiderIds persisterer i ability_caps", async () => {
  const teams = [{ id: teamId(1), name: "Hold A", tier: 1 }, { id: teamId(4), name: "Hold B", tier: 3 }];
  const plan = planYouthSquads({ teams, juniorsPerTeam: 0, targetSeason: TARGET_SEASON, seed: DEFAULT_SEED, ...MODELS });
  const riders = plan.rows.map((r, i) => ({ id: `m-${i}`, ...r.payload }));
  // Derive regner alder mod den AKTIVE sæson; ved cutover er det målsæsonen.
  const db = createFakeSupabase({ riders, seasons: [{ number: TARGET_SEASON, status: "active" }], rider_derived_abilities: [] });
  await deriveForRiderIds(db, riders.map((r) => r.id), { dryRun: false, ...MODELS });
  const persisted = new Map(db.state.rider_derived_abilities.map((a) => [a.rider_id, a]));
  plan.rows.forEach((row, i) => {
    assert.deepEqual(generatedCaps(row), persisted.get(`m-${i}`).ability_caps, `caps ${i}`);
  });
});

// ── Prod-udvalget (ren) ──────────────────────────────────────────────────────
test("pickProdSample: kun samme sæson-alder + type, parrene på skift, deterministisk", () => {
  const born = (age) => `${2028 - age}-06-15`;
  const riders = [
    ...Array.from({ length: 6 }, (_, i) => ({ id: `gc20-${i}`, birthdate: born(20), primary_type: "gc" })),
    { id: "sp21-0", birthdate: born(21), primary_type: "sprinter" },
    { id: "gc21-0", birthdate: born(21), primary_type: "gc" },       // gc, men forkert alder
    { id: "sp20-0", birthdate: born(20), primary_type: "sprinter" }, // 20, men forkert type
    { id: "gc20-ret", birthdate: born(20), primary_type: "gc", is_retired: true },
    { id: "gc20-a6", birthdate: born(20), primary_type: "gc", archetype_draw: { birth: { tier: U23_BIRTH_TIER, v: 1 } } },
    // Priors-født på en ANDEN tier end u23 — fund 1: skal udelukkes ligesom a6.
    { id: "gc20-youth", birthdate: born(20), primary_type: "gc", archetype_draw: { birth: { tier: YOUTH_BIRTH_TIER, v: 1 } } },
    { id: "gc20-noabil", birthdate: born(20), primary_type: "gc" },
  ];
  const abilityByRider = new Map(riders.filter((r) => r.id !== "gc20-noabil").map((r) => [r.id, {}]));
  const generated = [
    { age: 20, primary_type: "gc" }, { age: 20, primary_type: "gc" }, { age: 20, primary_type: "gc" },
    { age: 21, primary_type: "sprinter" },
    { age: 22, primary_type: "climber" }, // intet prod-match
  ];
  const run = (rs, seed = 7, size = 4) => pickProdSample({ riders: rs, abilityByRider, generated, ageSeason: ACTIVE_SEASON, seed, size });
  const a = run(riders);
  const ids = a.picks.map((p) => p.rider.id);
  assert.equal(ids.length, 4);
  assert.equal(ids[1], "sp21-0", "det næsthyppigste par kommer til før det hyppigste tages igen");
  assert.equal(ids.filter((id) => id.startsWith("gc20-")).length, 3);
  for (const id of ids) assert.ok(!["gc21-0", "sp20-0", "gc20-ret", "gc20-a6", "gc20-youth", "gc20-noabil"].includes(id), id);
  for (const p of a.picks) {
    assert.equal(ageForSeason(p.rider.birthdate, ACTIVE_SEASON), p.age);
    assert.ok(generated.some((g) => g.age === p.age && g.primary_type === p.rider.primary_type));
  }
  assert.deepEqual(a.pairs.map((p) => [p.age, p.type, p.generated, p.pool, p.picked]), [
    [20, "gc", 3, 6, 3],
    [21, "sprinter", 1, 1, 1],
    [22, "climber", 1, 0, 0],
  ]);
  // Samme input + seed = samme udvalg, uanset rækkefølgen rytterne kommer i.
  assert.deepEqual(run([...riders].reverse()).picks.map((p) => p.rider.id), ids);
  // En anden seed vælger (her) nogle andre gc-ryttere fra den samme pulje.
  const seeds = new Set([1, 2, 3, 4, 5, 6].map((s) => run(riders, s).picks.map((p) => p.rider.id).join(",")));
  assert.ok(seeds.size > 1, "udvalget følger seeden");
  // Puljen er mindre end ønsket: der returneres det der findes, ikke dubletter.
  assert.equal(run(riders, 7, 50).picks.length, 7);
  assert.equal(candidateProdRiders(riders, generated, ACTIVE_SEASON).length, 8, "6 gc + sprinter + ingen-evne-rytteren");
});

// ── Hele kørslen mod en fixture-klient ───────────────────────────────────────
test("runComparison er READ-ONLY: ingen insert/update/upsert/delete/rpc, fixturen er uændret", async () => {
  const state = fixtureState();
  const before = structuredClone(state);
  const probe = readOnlyProbe(state);
  const out = await runComparison(probe, { seed: DEFAULT_SEED, season: TARGET_SEASON });
  assert.deepEqual(probe.calls.writes, [], "ingen skrivninger");
  assert.deepEqual(probe.calls.rpc, [], "ingen rpc-kald");
  for (const table of Object.keys(before)) assert.deepEqual(state[table], before[table], `${table} uændret`);
  assert.deepEqual(
    [...new Set(probe.calls.reads)].sort(),
    ["app_config", "league_divisions", "rider_derived_abilities", "riders", "seasons", "teams"],
  );
  assert.ok(out.markdown.includes("PRIVAT (balance-internals/"));
  // Fund 3: rapporten skal sige at "–" er ikke-beregnet, ikke 0 (fx
  // teamwork/leadership, som mangler for de fleste unge prod-ryttere).
  assert.ok(out.markdown.includes("betyder ikke-beregnet"), "dash-forklaring i hovedet");
});

test("runComparison: 3 holds U23-trup + op til 10 prod-ryttere på samme alder og type", async () => {
  const out = await runComparison(readOnlyProbe(fixtureState()), { seed: DEFAULT_SEED, season: TARGET_SEASON });
  // Holdene: AI, ikke banken/menneskeholdet, spredt over tierne 1/3/4.
  assert.equal(out.teams.length, TEAM_COUNT);
  assert.deepEqual(out.teams.map((t) => t.tier), [1, 3, 4]);
  assert.equal(out.generated.length, out.teams.reduce((s, t) => s + t.u23, 0));
  for (const g of out.generated) assert.ok(g.age >= 19 && g.age <= 22, `U23-alder ${g.age}`);

  const pairs = new Set(out.generated.map((g) => `${g.age}|${g.primary_type}`));
  assert.equal(out.prod.length, Math.min(PROD_SAMPLE_SIZE, pairs.size));
  assert.equal(out.summary.prod, out.prod.length);
  for (const id of out.prodIds) assert.match(id, /-ok$/, `kun ikke-pensionerede med evne-række i 19-22 (${id})`);
  for (const p of out.prod) {
    assert.ok(pairs.has(`${p.age}|${p.primary_type}`), `prod-rytteren matcher en genereret (${p.name})`);
    assert.equal(p.caps?.climbing, 40, "loftet kommer fra ability_caps");
  }
  // Prod-alderen er målt i den AKTIVE sæson (S3), ikke i målsæsonen.
  assert.equal(out.summary.ageSeason, ACTIVE_SEASON);
  // Én tabel: hver genereret og hver prod-rytter har sin række.
  const tableRows = out.markdown.split("## Matchning")[0].split("\n").filter((l) => /^\| \d+ \|/.test(l));
  assert.equal(tableRows.length, out.generated.length + out.prod.length);
});

test("runComparison: ingen aktiv sæson → fejl, aldrig stille fallback til målsæsonen (fund 2)", async () => {
  const state = fixtureState();
  // Ingen sæson har status "active": prod-alderen kan ikke måles dér hvor
  // rytterens evner faktisk gælder.
  state.seasons = state.seasons.map((s) => ({ ...s, status: "completed" }));
  await assert.rejects(
    () => runComparison(readOnlyProbe(state), { seed: DEFAULT_SEED, season: TARGET_SEASON }),
    /aktiv sæson/,
  );
});

test("runComparison er deterministisk: samme seed = samme tabel, anden seed = anden trup", async () => {
  const a = await runComparison(readOnlyProbe(fixtureState()), { seed: DEFAULT_SEED, season: TARGET_SEASON });
  const b = await runComparison(readOnlyProbe(fixtureState()), { seed: DEFAULT_SEED, season: TARGET_SEASON });
  assert.equal(a.markdown, b.markdown);
  const c = await runComparison(readOnlyProbe(fixtureState()), { seed: DEFAULT_SEED + 1, season: TARGET_SEASON });
  assert.notEqual(c.markdown, a.markdown);
  assert.notDeepEqual(c.generated.map((g) => g.name), a.generated.map((g) => g.name));
});
