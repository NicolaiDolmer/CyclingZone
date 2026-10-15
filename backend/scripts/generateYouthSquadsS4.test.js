import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import {
  parseArgs,
  assertBalanceInternalsPath,
  planYouthSquads,
  mirrorDerive,
  summarizePlan,
  applyPlan,
  U23_SQUAD_SIZE,
  JUNIOR_AGE_MIN,
  JUNIOR_AGE_MAX,
  DEFAULT_TARGET_SEASON,
  buildHumanLevelProfile,
  levelQuantile,
  levelOf,
  rankBirthCandidates,
  planYouthLift,
  applyLift,
  summarizeExistingByTeam,
  summarizeLevels,
} from "./generateYouthSquadsS4.js";
import {
  mirrorPool,
  poolsOfForm,
  youthRosterByTeam,
  assignPools,
  simulateForm,
  gatePasses,
  PYRAMID_FORMS,
  finishTimeSeconds,
  gap10BySquadTerrain,
  benchmarkGapByTerrain,
  gapVerdict,
  describeLevels,
} from "./measureYouthFieldGate.mjs";
import { deriveForRiderIds } from "../lib/backfillCores.js";
import { MIN_RACE_ENTRIES } from "../lib/raceAutopick.js";
import { ageForSeason } from "../lib/riderSeasonAge.js";
import { U23_BIRTH_AGE_MIN, U23_BIRTH_AGE_MAX, U23_BIRTH_TIER, YOUTH_BIRTH_TIER } from "../lib/riderBirthPriors.js";
import { SQUAD_CAPS } from "../lib/squads.js";
import { loadValuationModelById, DEFAULT_VALUATION_MODEL_ID } from "../lib/riderValuationModelSelect.js";
import { foldNameNordic } from "../lib/pcmRiderMatcher.js";

const MODEL = loadValuationModelById(DEFAULT_VALUATION_MODEL_ID);
const MODELS = { valuationModel: MODEL, productionValuationModel: MODEL };
const TEAMS = [
  { id: "00000000-0000-4000-8000-00000000000c", name: "Hold C", tier: 4 },
  { id: "00000000-0000-4000-8000-00000000000a", name: "Hold A", tier: 4 },
  { id: "00000000-0000-4000-8000-00000000000b", name: "Hold B", tier: 3 },
];
const plan = (extra = {}) => planYouthSquads({
  teams: TEAMS, juniorsPerTeam: 2, targetSeason: DEFAULT_TARGET_SEASON, seed: 5518, ...MODELS, ...extra,
});

// ── Argumenter ───────────────────────────────────────────────────────────────
test("parseArgs: --juniors er påkrævet og har intet default (ejer-valg)", () => {
  assert.throws(() => parseArgs([]), /--juniors=N er PÅKRÆVET/);
  assert.throws(() => parseArgs(["--dry-run"]), /PÅKRÆVET/);
  assert.throws(() => parseArgs(["--juniors"]), /helt tal/);
  assert.throws(() => parseArgs(["--juniors=abc"]), /helt tal/);
});

test("parseArgs: --juniors skal ligge inden for juniortruppens loft", () => {
  assert.throws(() => parseArgs(["--juniors=-1"]), /\[0,/);
  assert.throws(() => parseArgs([`--juniors=${SQUAD_CAPS.junior + 1}`]), /\[0,/);
  assert.equal(parseArgs(["--juniors=0"]).juniors, 0);
  assert.equal(parseArgs([`--juniors=${SQUAD_CAPS.junior}`]).juniors, SQUAD_CAPS.junior);
});

test("parseArgs: dry-run er default, --apply kræver --owner-go", () => {
  const dry = parseArgs(["--juniors=3"]);
  assert.equal(dry.apply, false);
  assert.equal(dry.season, DEFAULT_TARGET_SEASON);
  assert.throws(() => parseArgs(["--juniors=3", "--apply"]), /--owner-go/);
  assert.throws(() => parseArgs(["--juniors=3", "--apply", "--owner-go", "--dry-run"]), /udelukker/);
  const go = parseArgs(["--juniors=3", "--apply", "--owner-go"]);
  assert.equal(go.apply, true);
  assert.equal(go.ownerGo, true);
});

test("--out må kun pege ind i balance-internals/", () => {
  const root = join("C:", "repo");
  const opts = { root, cwd: root };
  assert.throws(() => assertBalanceInternalsPath("docs/x.md", opts), /balance-internals/);
  assert.throws(() => assertBalanceInternalsPath("balance-internals/../docs/x.md", opts), /balance-internals/);
  assert.throws(() => assertBalanceInternalsPath("balance-internals", opts), /balance-internals/);
  assert.ok(assertBalanceInternalsPath("balance-internals/5518.md", opts).endsWith("5518.md"));
  // Relativt til arbejdsmappen: fra backend/ er det ../balance-internals/.
  const fromBackend = { root, cwd: join(root, "backend") };
  assert.ok(assertBalanceInternalsPath("../balance-internals/5518.md", fromBackend).endsWith("5518.md"));
  assert.throws(() => assertBalanceInternalsPath("balance-internals/5518.md", fromBackend), /balance-internals/);
});

// ── Planen ───────────────────────────────────────────────────────────────────
test("hvert AI-hold får 6-9 U23-ryttere og præcis N juniorer", () => {
  const p = plan();
  assert.equal(p.perTeam.length, TEAMS.length);
  for (const t of p.perTeam) {
    assert.ok(t.u23 >= U23_SQUAD_SIZE.min && t.u23 <= U23_SQUAD_SIZE.max, `U23 ${t.u23}`);
    assert.equal(t.junior, 2);
    assert.equal(p.rows.filter((r) => r.teamId === t.teamId && r.squad === "u23").length, t.u23);
    assert.equal(p.rows.filter((r) => r.teamId === t.teamId && r.squad === "junior").length, 2);
  }
  const none = plan({ juniorsPerTeam: 0 });
  assert.equal(none.totals.junior, 0);
});

test("alder: U23 19-22 og junior 16-18 på MÅLSÆSONENS akse", () => {
  for (const r of plan().rows) {
    const age = ageForSeason(r.payload.birthdate, DEFAULT_TARGET_SEASON);
    assert.equal(age, r.age);
    if (r.squad === "u23") assert.ok(age >= U23_BIRTH_AGE_MIN && age <= U23_BIRTH_AGE_MAX, `u23 ${age}`);
    else assert.ok(age >= JUNIOR_AGE_MIN && age <= JUNIOR_AGE_MAX, `junior ${age}`);
  }
});

test("squad og is_academy skrives sammen; markøren bærer truppens bånd", () => {
  for (const r of plan().rows) {
    assert.equal(r.payload.squad, r.squad);
    assert.equal(r.payload.is_academy, true);
    assert.equal(r.payload.team_id, r.teamId);
    assert.equal(r.payload.generation_tag, `s${DEFAULT_TARGET_SEASON}`);
    assert.equal(r.payload.pcm_id, null);
    const birth = r.payload.archetype_draw.birth;
    assert.equal(birth.tier, r.squad === "u23" ? U23_BIRTH_TIER : YOUTH_BIRTH_TIER);
    assert.equal(birth.age, r.age, "fødselsalderen er den trukne alder");
    assert.ok(r.payload.archetype_draw.primary && r.payload.archetype_draw.secondary, "to-delt anlæg");
    for (const k of Object.keys(r.payload)) assert.ok(!k.startsWith("stat_"), `ingen PCM-stat (${k})`);
  }
});

test("navne er unikke i kuldet og kolliderer ikke med bestanden", () => {
  const first = plan();
  const taken = new Set(first.rows.slice(0, 5).map((r) => foldNameNordic(`${r.payload.firstname} ${r.payload.lastname}`)));
  const p = plan({ existingNames: taken });
  const folded = p.rows.map((r) => foldNameNordic(`${r.payload.firstname} ${r.payload.lastname}`));
  assert.equal(new Set(folded).size, folded.length);
  for (const n of folded) assert.ok(!taken.has(n), `kollision med bestanden: ${n}`);
  assert.equal(taken.size, 5, "existingNames muteres ikke");
});

test("deterministisk: samme seed = samme kuld, uanset holdenes rækkefølge", () => {
  const a = plan();
  const b = planYouthSquads({ teams: [...TEAMS].reverse(), juniorsPerTeam: 2, targetSeason: DEFAULT_TARGET_SEASON, seed: 5518, ...MODELS });
  assert.deepEqual(a.rows.map((r) => r.payload), b.rows.map((r) => r.payload));
  const c = plan({ seed: 1 });
  assert.notDeepEqual(a.rows.map((r) => r.payload.firstname), c.rows.map((r) => r.payload.firstname));
});

test("idempotens pr. trup: en eksisterende U23-trup/juniortrup fødes ikke igen", () => {
  const [a, b, c] = TEAMS;
  const p = plan({
    existingByTeam: new Map([
      [a.id, { u23Born: true, juniors: 2 }],   // alt findes → holdet springes helt over
      [b.id, { u23Born: true, juniors: 0 }],   // kun juniorerne mangler
      [c.id, { u23Born: false, juniors: 1 }],  // kun U23-truppen mangler
    ]),
  });
  assert.ok(!p.rows.some((r) => r.teamId === a.id));
  assert.deepEqual([...new Set(p.rows.filter((r) => r.teamId === b.id).map((r) => r.squad))], ["junior"]);
  assert.deepEqual([...new Set(p.rows.filter((r) => r.teamId === c.id).map((r) => r.squad))], ["u23"]);
  assert.equal(p.skipped.length, 3);
  // U23-truppens størrelse afhænger ikke af hvad der allerede findes.
  const fresh = plan();
  assert.equal(
    p.perTeam.find((t) => t.teamId === c.id).u23,
    fresh.perTeam.find((t) => t.teamId === c.id).u23,
  );
});

test("påkrævede plan-argumenter kan ikke udelades", () => {
  assert.throws(() => planYouthSquads({ teams: TEAMS, targetSeason: 4, ...MODELS }), /juniorsPerTeam/);
  assert.throws(() => planYouthSquads({ teams: TEAMS, juniorsPerTeam: 1, ...MODELS }), /targetSeason/);
});

// ── Spejlings-gaten (#2065) ──────────────────────────────────────────────────
// Et in-memory supabase der filtrerer på eq/in, så deriveForRiderIds og
// applyPlan kører deres ægte kode mod en lille fixture.
function makeStore(tables) {
  const store = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const writes = { inserts: [], updates: [], upserts: [] };
  let nextId = 1;
  function from(table) {
    const filters = [];
    const rows = () => (store[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const api = {
      select() { return api; },
      eq(col, val) { filters.push((r) => r[col] === val); return api; },
      in(col, vals) { const s = new Set(vals); filters.push((r) => s.has(r[col])); return api; },
      order() { return api; },
      range(from, to) { return Promise.resolve({ data: rows().slice(from, to + 1), error: null }); },
      maybeSingle() { return Promise.resolve({ data: rows()[0] ?? null, error: null }); },
      insert(newRows) {
        const inserted = newRows.map((r) => ({ id: `r-${String(nextId++).padStart(4, "0")}`, ...r }));
        store[table] = [...(store[table] ?? []), ...inserted];
        writes.inserts.push({ table, rows: inserted });
        return { select: () => Promise.resolve({ data: inserted.map((r) => ({ id: r.id })), error: null }) };
      },
      upsert(upRows) { writes.upserts.push({ table, rows: upRows }); return Promise.resolve({ error: null }); },
      update(patch) {
        return {
          eq(col, val) {
            for (const r of store[table] ?? []) if (r[col] === val) Object.assign(r, patch);
            writes.updates.push({ table, patch, val });
            return Promise.resolve({ error: null });
          },
        };
      },
    };
    return api;
  }
  return { from, store, writes };
}

test("#2065: spejlingen rammer PRÆCIS det deriveForRiderIds persisterer (base_value + type)", async () => {
  const p = planYouthSquads({ teams: TEAMS.slice(0, 2), juniorsPerTeam: 2, targetSeason: 4, seed: 5518, ...MODELS });
  const riders = p.rows.map((r, i) => ({ id: `m-${i}`, ...r.payload }));
  const supabase = makeStore({ riders, seasons: [{ number: 4, status: "active" }] });
  await deriveForRiderIds(supabase, riders.map((r) => r.id), { dryRun: false, ...MODELS });
  const persisted = new Map(supabase.store.riders.map((r) => [r.id, r]));
  p.rows.forEach((row, i) => {
    const got = persisted.get(`m-${i}`);
    assert.equal(got.base_value, row.mirror.base_value, `base_value ${i}`);
    assert.equal(got.primary_type, row.mirror.primary_type, `primary_type ${i}`);
    assert.equal(got.current_production_value, row.mirror.current_production_value, `cpv ${i}`);
  });
  // Evnerne derive skrev = evnerne spejlingen så (samme fødsels-seed, samme bånd).
  // Undtagelse: hidden_potential hasher rytterens DB-id, som først findes efter
  // insert. Den indgår hverken i caps, type eller værdi (derfor matcher
  // base_value ovenfor), så gaten vurderer stadig den rytter der lander.
  const abilityRows = supabase.writes.upserts.find((u) => u.table === "rider_derived_abilities").rows;
  for (const a of abilityRows) {
    const idx = Number(a.rider_id.slice(2));
    for (const [k, v] of Object.entries(p.rows[idx].mirror.abilities)) {
      if (k === "hidden_potential") continue;
      assert.equal(a[k], v, `${a.rider_id}.${k}`);
    }
  }
});

test("spejlingen afviser en rytter uden fødsels-markør", () => {
  assert.throws(
    () => mirrorDerive({ id: "x", birthdate: "2010-06-15", archetype_draw: { primary: "gc" } }, { seasonNumber: 4, ...MODELS }),
    /fødsels-markør/,
  );
});

// ── Apply-stien (mod en in-memory DB) ────────────────────────────────────────
test("applyPlan: ét insert pr. hold, derive, kontrakter, 0 spejlings-afvigelser", async () => {
  const p = planYouthSquads({ teams: TEAMS.slice(0, 2), juniorsPerTeam: 1, targetSeason: 4, seed: 5518, ...MODELS });
  const supabase = makeStore({ riders: [], seasons: [{ number: 4, status: "active" }] });
  const { inserted, mismatches } = await applyPlan(supabase, p, { ...MODELS, log: () => {} });
  assert.equal(inserted.length, p.totals.riders);
  assert.equal(supabase.writes.inserts.length, 2, "ét insert pr. hold");
  assert.deepEqual(mismatches, []);
  for (const r of supabase.store.riders) {
    assert.ok([2, 3].includes(r.contract_length), `kontraktlængde ${r.contract_length}`);
    assert.equal(r.contract_end_season, 4 + r.contract_length - 1);
    assert.ok(r.salary > 0);
    assert.equal(r.is_academy, true);
  }
});

test("applyPlan: en derive der persisterer noget andet end gaten så, rapporteres", async () => {
  const p = planYouthSquads({ teams: TEAMS.slice(0, 1), juniorsPerTeam: 0, targetSeason: 4, seed: 5518, ...MODELS });
  const supabase = makeStore({ riders: [], seasons: [{ number: 4, status: "active" }] });
  const wrongDerive = async (sb, ids) => {
    for (const id of ids) await sb.from("riders").update({ base_value: 1, primary_type: "sprinter", current_production_value: 1 }).eq("id", id);
  };
  const { mismatches } = await applyPlan(supabase, p, { ...MODELS, derive: wrongDerive, log: () => {} });
  assert.equal(mismatches.length, p.totals.riders);
});

test("applyPlan: rollback-kaldet får id'erne pr. hold, og et kort insert-svar stopper kørslen", async () => {
  const p = planYouthSquads({ teams: TEAMS.slice(0, 2), juniorsPerTeam: 0, targetSeason: 4, seed: 5518, ...MODELS });
  const seen = [];
  const ok = makeStore({ riders: [], seasons: [{ number: 4, status: "active" }] });
  await applyPlan(ok, p, { ...MODELS, log: () => {}, onInserted: (ids) => seen.push(ids.length) });
  assert.deepEqual(seen, p.perTeam.map((t) => t.u23), "ét kald pr. hold, alle id'er med");

  // Et insert der returnerer færre id'er end rækker: stop før derive, men de
  // id'er der FINDES er allerede meldt til rollback-listen fra de forrige hold.
  const short = makeStore({ riders: [], seasons: [{ number: 4, status: "active" }] });
  const realFrom = short.from;
  let calls = 0;
  short.from = (table) => {
    const api = realFrom(table);
    if (table !== "riders") return api;
    const realInsert = api.insert;
    api.insert = (rows) => {
      calls++;
      const res = realInsert(rows);
      return calls === 2 ? { select: () => res.select().then((r) => ({ ...r, data: r.data.slice(1) })) } : res;
    };
    return api;
  };
  const reported = [];
  let derived = false;
  await assert.rejects(
    () => applyPlan(short, p, { ...MODELS, log: () => {}, derive: async () => { derived = true; }, onInserted: (ids) => reported.push(...ids) }),
    /forventede .* id'er/,
  );
  assert.equal(derived, false, "derive køres ikke på et ufuldstændigt insert");
  assert.equal(reported.length, p.perTeam[0].u23, "første holds ryttere står på rollback-listen");
});

test("applyPlan: blokeret når en kandidat ligger over værdiloftet", async () => {
  const p = plan();
  const blocked = { ...p, totals: { ...p.totals, overValueCap: 1 } };
  await assert.rejects(() => applyPlan(makeStore({ riders: [] }), blocked, { ...MODELS, log: () => {} }), /værdiloft/);
});

// ── C1: felt-gatens rene kerne (measureYouthFieldGate.mjs) ───────────────────
test("C1: spejlet pulje — nederste tiers lægges sammen i forældre-puljen", () => {
  assert.deepEqual(mirrorPool({ tier: 2, pool_index: 1 }, [1, 2, 4, 8]), { tier: 2, pool_index: 1 });
  assert.deepEqual(mirrorPool({ tier: 4, pool_index: 7 }, [1, 2, 4]), { tier: 3, pool_index: 3 });
  assert.deepEqual(mirrorPool({ tier: 4, pool_index: 5 }, [1, 2]), { tier: 2, pool_index: 1 });
  assert.deepEqual(mirrorPool({ tier: 3, pool_index: 2 }, [1]), { tier: 1, pool_index: 0 });
  assert.deepEqual(PYRAMID_FORMS.map((f) => poolsOfForm(f).length), [15, 7, 3, 1]);
});

test("C1: ungdomstruppen tæller kun ungdomsryttere i truppens alder, under loftet", () => {
  const season = 4;
  const born = (age) => `${2029 - age}-06-15`;
  const riders = [
    { id: "a", team_id: "H", birthdate: born(20), squad: "u23", is_academy: true },
    { id: "b", team_id: "H", birthdate: born(23), squad: "u23", is_academy: true },    // vokset ud
    { id: "c", team_id: "H", birthdate: born(21), squad: "senior", is_academy: false }, // senior
    { id: "d", team_id: "H", birthdate: born(18), squad: "junior", is_academy: true },  // junior
    { id: "e", team_id: "X", birthdate: born(20), squad: "u23", is_academy: true },     // ikke et aktivt hold
    ...Array.from({ length: SQUAD_CAPS.u23 + 3 }, (_, i) => ({ id: `z${i}`, team_id: "F", birthdate: born(19), squad: "senior", is_academy: true })),
  ];
  const humanTeamIds = new Set(["H", "F"]);
  const base = youthRosterByTeam({ riders, humanTeamIds, squad: "u23", season });
  assert.deepEqual(base.get("H"), ["a"]);
  assert.equal(base.get("F").length, SQUAD_CAPS.u23, "loftet");
  const upper = youthRosterByTeam({ riders, humanTeamIds, squad: "u23", season, includeHumanSeniors: true });
  assert.deepEqual(upper.get("H"), ["a", "c"]);
  const junior = youthRosterByTeam({ riders, humanTeamIds, squad: "junior", season });
  assert.deepEqual(junior.get("H"), ["d"]);
  const sixteen = youthRosterByTeam({ riders: [{ id: "y", team_id: "H", birthdate: born(16), squad: "junior", is_academy: true }], humanTeamIds, squad: "junior", season });
  assert.equal(sixteen.size, 0, "16-årige er ikke løbsberettigede");
});

test("C1: et hold starter kun med mindst MIN_RACE_ENTRIES, og gaten er 100 % af løbsdagene", () => {
  const teams = [
    { id: "T1", tier: 1, pool_index: 0, is_ai: false },
    { id: "T2", tier: 2, pool_index: 0, is_ai: false },
    { id: "A1", tier: 2, pool_index: 1, is_ai: true },
  ];
  const ids = (n, p) => Array.from({ length: n }, (_, i) => `${p}${i}`);
  const rosters = new Map([["T1", ids(MIN_RACE_ENTRIES, "t")], ["T2", ids(MIN_RACE_ENTRIES - 1, "u")], ["A1", ids(9, "a")]]);
  const mirror = simulateForm({ pools: assignPools(teams, rosters, [1, 2], "mirror"), rosters, raceDays: 3, fieldMax: 6 });
  // Pulje 2:0 har kun T2 (for få) → 0 startende hold → gaten fejler ved ethvert gulv.
  assert.equal(mirror.minStarters, 0);
  assert.equal(gatePasses(mirror, 1), false);
  const single = simulateForm({ pools: assignPools(teams, rosters, [1], "mirror"), rosters, raceDays: 3, fieldMax: 6 });
  assert.equal(single.minStarters, 2);
  assert.equal(single.maxRiders, 12, "feltet er højst klassens størrelse pr. hold");
  assert.equal(gatePasses(single, 2), true);
  // ai-balanced: AI-truppen lægges hvor der mangler startende hold.
  const balanced = assignPools(teams, rosters, [1, 2], "ai-balanced");
  assert.ok(balanced.get("2:0").includes("A1") || balanced.get("2:1").includes("A1"));
  // Fravær er deterministisk og kan kun gøre feltet mindre.
  const stressed = simulateForm({ pools: assignPools(teams, rosters, [1], "mirror"), rosters, raceDays: 20, unavailable: 0.3, fieldMax: 6 });
  const again = simulateForm({ pools: assignPools(teams, rosters, [1], "mirror"), rosters, raceDays: 20, unavailable: 0.3, fieldMax: 6 });
  assert.deepEqual(stressed, again);
  assert.ok(stressed.minStarters <= single.minStarters);
});

test("summarizePlan: vækst regnes mod bestanden", () => {
  const p = plan();
  const s = summarizePlan(p, { activeRiders: 1000, aiSeniorRiders: 500, aiTeamsWithYouth: 0 });
  assert.equal(s.load.newRiders, p.totals.riders);
  assert.equal(s.load.growthPct, (100 * p.totals.riders) / 1000);
  assert.equal(s.u23.count + s.junior.count, p.totals.riders);
});

// ── #6668: niveau-matchning mod menneskeholdenes ungdom ──────────────────────
const S = DEFAULT_TARGET_SEASON;
const birthOf = (age) => `${2026 + (S - 1) - age}-06-15`;
/** En syntetisk menneske-fordeling: `n` ryttere pr. alder, niveau lineært i [lo, hi]. */
function humanRows({ ages = [17, 18, 19, 20, 21, 22], n = 40, lo = 10, hi = 60 } = {}) {
  return ages.flatMap((age) => Array.from({ length: n }, (_, i) => ({ birthdate: birthOf(age), level: lo + ((hi - lo) * i) / (n - 1) })));
}

test("parseArgs: --lift-existing indebærer --match-human-level; flagene tager ingen værdi", () => {
  assert.equal(parseArgs(["--juniors=0"]).matchHumanLevel, false);
  assert.equal(parseArgs(["--juniors=0", "--match-human-level"]).matchHumanLevel, true);
  const lift = parseArgs(["--juniors=0", "--lift-existing"]);
  assert.equal(lift.liftExisting, true);
  assert.equal(lift.matchHumanLevel, true);
  assert.throws(() => parseArgs(["--juniors=0", "--lift-existing=1"]), /ingen værdi/);
});

test("buildHumanLevelProfile: pr. målsæsonens alder, sorteret, kun aldre med nok ryttere", () => {
  const rows = [...humanRows({ ages: [19], n: 25 }), ...humanRows({ ages: [17], n: 5 })];
  const p = buildHumanLevelProfile(rows, { season: S });
  assert.deepEqual([...p.keys()], [19]);
  const xs = p.get(19);
  assert.equal(xs.length, 25);
  assert.ok(xs.every((x, i) => i === 0 || xs[i - 1] <= x));
  assert.equal(levelQuantile(xs, 0), xs[0]);
  assert.equal(levelQuantile(xs, 0.999), xs[24]);
  assert.equal(levelQuantile(undefined, 0.5), null);
});

test("rankBirthCandidates: uden mål = truppens eget bånd; med mål = tættest først, deterministisk", () => {
  const row = plan().rows.find((r) => r.squad === "u23").payload;
  const seed = row.archetype_draw.birth.seed;
  const age = row.archetype_draw.birth.age;
  const none = rankBirthCandidates({ row, seed, age, target: null });
  assert.equal(none.length, 1);
  assert.equal(none[0].birth.tier, U23_BIRTH_TIER);
  const a = rankBirthCandidates({ row, seed, age, target: 50 });
  const b = rankBirthCandidates({ row, seed, age, target: 50 });
  assert.deepEqual(a, b);
  assert.ok(a.every((c, i) => i === 0 || a[i - 1].distance <= c.distance));
  assert.ok(a[0].distance <= 3, `bedste kandidat ${a[0].level} ligger tæt på målet`);
});

test("planYouthSquads med levelProfile: kuldet følger menneske-fordelingen, og derive reproducerer markøren", () => {
  const profile = buildHumanLevelProfile(humanRows({ lo: 20, hi: 60 }), { season: S });
  const base = plan();
  const lifted = plan({ levelProfile: profile });
  // Struktur uændret: samme hold, aldre, trupper og navne.
  assert.deepEqual(lifted.rows.map((r) => [r.teamId, r.squad, r.age, r.payload.lastname]), base.rows.map((r) => [r.teamId, r.squad, r.age, r.payload.lastname]));
  const matched = lifted.rows.filter((r) => r.target != null);
  assert.ok(matched.length > 0);
  for (const r of matched) {
    assert.ok(Math.abs(levelOf(r.mirror.abilities) - r.target) <= 3, `niveau ${levelOf(r.mirror.abilities)} mod mål ${r.target}`);
    // Spejlingen ER det derive persisterer: markøren alene reproducerer niveauet.
    const again = mirrorDerive({ ...r.payload, id: "x" }, { seasonNumber: S, ...MODELS });
    assert.equal(levelOf(again.abilities), levelOf(r.mirror.abilities));
  }
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(mean(matched.map((r) => levelOf(r.mirror.abilities))) > mean(base.rows.filter((r) => r.age >= 17).map((r) => levelOf(r.mirror.abilities))));
});

test("planYouthSquads uden levelProfile er bit for bit som før (#6668 ændrer intet uden flaget)", () => {
  const a = plan();
  const b = plan({ levelProfile: null });
  assert.deepEqual(a.rows.map((r) => r.payload), b.rows.map((r) => r.payload));
});

function existingAiRiders() {
  return plan().rows.map((r, i) => ({ ...r.payload, id: `ai-${i}`, archetype_draw: { ...r.payload.archetype_draw, note: "bevares" } }));
}

test("planYouthLift: løfter mod fordelingen, bevarer rangorden, sænker aldrig og rører kun fødsels-markøren", () => {
  // Ét år frem: S4-kuldet målt i S5 (U23 22 → 23 er vokset ud).
  const riders = existingAiRiders();
  const profile = buildHumanLevelProfile(humanRows({ lo: 25, hi: 70 }), { season: S + 1 });
  const lift = planYouthLift({
    riders,
    teamsById: new Map(TEAMS.map((t) => [t.id, t])),
    targetSeason: S + 1,
    levelProfile: profile,
    ...MODELS,
  });
  assert.equal(lift.skipped.graduated, riders.filter((r) => ageForSeason(r.birthdate, S + 1) > U23_BIRTH_AGE_MAX).length);
  assert.ok(lift.totals.changed > 0);
  for (const r of lift.rows) assert.ok(r.after >= r.before, "løftet sænker aldrig");
  for (const r of lift.rows.filter((x) => x.changed)) {
    const old = riders.find((x) => x.id === r.riderId).archetype_draw;
    assert.equal(r.archetype_draw.note, "bevares");
    assert.equal(r.archetype_draw.primary, old.primary);
    assert.deepEqual(r.previousBirth, old.birth);
  }
  // Rangorden pr. alder bevares (stratificerede mål).
  for (const age of new Set(lift.rows.map((r) => r.age))) {
    const rows = lift.rows.filter((r) => r.age === age).sort((a, b) => a.before - b.before || String(a.riderId).localeCompare(String(b.riderId)));
    assert.ok(rows.every((r, i) => i === 0 || rows[i - 1].target <= r.target));
  }
  const levels = summarizeLevels({ humanProfile: profile, lift });
  assert.ok(levels.some((l) => l.aiAfter.n > 0 && l.aiAfter.mean > l.aiBefore.mean));
});

test("planYouthLift: uden menneske-fordeling på en alder står rytterne uændret", () => {
  const lift = planYouthLift({
    riders: existingAiRiders(),
    teamsById: new Map(TEAMS.map((t) => [t.id, t])),
    targetSeason: S,
    levelProfile: new Map(),
    ...MODELS,
  });
  assert.equal(lift.totals.changed, 0);
  assert.throws(() => planYouthLift({ riders: [], teamsById: new Map(), targetSeason: S, ...MODELS }), /levelProfile/);
});

test("applyLift: restore før skrivning, kun archetype_draw skrives, derive + post-verify", async () => {
  const riders = existingAiRiders();
  const profile = buildHumanLevelProfile(humanRows({ lo: 25, hi: 70 }), { season: S });
  const lift = planYouthLift({ riders, teamsById: new Map(TEAMS.map((t) => [t.id, t])), targetSeason: S, levelProfile: profile, ...MODELS });
  const changed = lift.rows.filter((r) => r.changed);
  const calls = [];
  const fake = {
    from: () => ({
      update: (patch) => ({ eq: (_c, id) => { calls.push({ id, keys: Object.keys(patch) }); return Promise.resolve({ error: null }); } }),
      select: () => ({
        in: (_c, ids) => ({
          order: () => ({
            range: () => Promise.resolve({
              // rider-type-write-ok: test-fake af tilbagelæsningen, intet skrives.
              data: ids.map((id) => { const r = changed.find((x) => x.riderId === id); return { id, base_value: r.mirror.base_value, primary_type: r.mirror.primary_type }; }),
              error: null,
            }),
          }),
        }),
      }),
    }),
  };
  let restored = null;
  let derived = null;
  const res = await applyLift(fake, lift, {
    ...MODELS,
    derive: async (_s, ids) => { derived = ids; },
    log: () => {},
    writeRestore: (rows) => { restored = rows; assert.equal(calls.length, 0, "restore skrives før første update"); },
  });
  assert.equal(restored.length, changed.length);
  assert.ok(calls.every((c) => c.keys.length === 1 && c.keys[0] === "archetype_draw"));
  assert.deepEqual(derived, changed.map((r) => r.riderId));
  assert.deepEqual(res.mismatches, []);
});

// ── #6668: benchmark af gab (measureYouthFieldGate) ──────────────────────────
test("finishTimeSeconds læser resultatlistens tidsformat", () => {
  assert.equal(finishTimeSeconds("+0:00"), 0);
  assert.equal(finishTimeSeconds("+3:40"), 220);
  assert.equal(finishTimeSeconds("+1:02:03"), 3723);
  assert.equal(finishTimeSeconds(null), null);
  assert.equal(finishTimeSeconds("s.t."), null);
});

test("gap10BySquadTerrain + benchmarkGapByTerrain + gapVerdict", () => {
  const gaps = gap10BySquadTerrain([
    { squad: "junior", profile_type: "hilly", finish_time: "+3:40" },
    { squad: "junior", profile_type: "hilly", finish_time: "+0:20" },
    { squad: null, profile_type: "hilly", finish_time: "+0:10" },
    { squad: "u23", profile_type: null, finish_time: "+1:00" },
  ]);
  assert.equal(gaps.get("junior").get("hilly").n, 2);
  assert.equal(gaps.get("junior").get("hilly").median, 120);
  assert.equal(gaps.get("senior").get("hilly").median, 10);
  assert.equal(gaps.has("u23"), false, "uden profil kan terrænet ikke afgøres");
  const ref = benchmarkGapByTerrain([
    { terrain: "kuperet", gap10_s: 0 }, { terrain: "kuperet", gap10_s: 10 }, { terrain: "kuperet", gap10_s: 60 },
    { terrain: "ttt", gap10_s: 5 }, { terrain: "kuperet", gap10_s: null },
  ]);
  assert.deepEqual([...ref.keys()], ["hilly"]);
  assert.equal(gapVerdict(120, ref.get("hilly")), "above");
  assert.equal(gapVerdict(10, ref.get("hilly")), "inside");
  assert.equal(gapVerdict(null, ref.get("hilly")), null);
  assert.equal(describeLevels([3, 1, 2]).median, 2);
  assert.equal(describeLevels([]).n, 0);
});

test("#6668: efter et løft genkender idempotensen stadig U23-truppen (ingen nye U23-rækker)", () => {
  const riders = existingAiRiders();
  const profile = buildHumanLevelProfile(humanRows({ lo: 25, hi: 70 }), { season: S });
  const lift = planYouthLift({
    riders,
    teamsById: new Map(TEAMS.map((t) => [t.id, t])),
    targetSeason: S,
    levelProfile: profile,
    ...MODELS,
  });
  // Tving alle U23-markører over på en voksen-tier, som et løft over U23-båndet kan gøre.
  const lifted = riders.map((r) => {
    const row = lift.rows.find((x) => x.riderId === r.id);
    const base = row?.changed ? { ...r, archetype_draw: row.archetype_draw } : r;
    return base.squad === "u23"
      ? { ...base, team_id: base.team_id, archetype_draw: { ...base.archetype_draw, birth: { ...base.archetype_draw.birth, tier: "solid" } } }
      : base;
  });
  const existingByTeam = summarizeExistingByTeam(lifted);
  const again = plan({ existingByTeam });
  assert.equal(again.rows.filter((r) => r.squad === "u23").length, 0);
  // Løftede ryttere tælles ikke som noMarker ved en genkørsel.
  const second = planYouthLift({
    riders: lifted,
    teamsById: new Map(TEAMS.map((t) => [t.id, t])),
    targetSeason: S,
    levelProfile: profile,
    ...MODELS,
  });
  assert.equal(second.skipped.noMarker, 0);
});
