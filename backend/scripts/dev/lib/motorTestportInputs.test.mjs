// #6909: syntetisk startfelt + foreslaaede ruter i motor-testporten. Kun syntetiske fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ROUTES_FORMAT, applyRoutes, assertRoutesCover, createProdSource, entriesFromStaged, loadRoutesDir,
  prepareInputs, readOnlyDb, validateRouteDoc, withField,
} from "./motorTestportInputs.mjs";
import { inputLines } from "./motorTestportReport.mjs";

const tmp = (tag) => mkdtempSync(path.join(tmpdir(), `testport-6909-${tag}-`));
const profile = (n, type = "flat") => ({ stage_number: n, profile_type: type, finale_type: "bunch_sprint", distance_km: 100 + n, climbs: [], demand_vector: { sprint: 0.6, climbing: 0.4 } });
const routeDoc = (raceId, n = 2) => ({ format: ROUTES_FORMAT, race_id: raceId, stages: n, profiles: Array.from({ length: n }, (_, i) => profile(i + 1, i ? "hilly" : "flat")) });
const raceData = (id, { stages = 2, entries = [] } = {}) => ({
  race: { id, name: `Loeb ${id}`, stages, squad: "senior" },
  profiles: Array.from({ length: stages }, (_, i) => ({ ...profile(i + 1, "mountain"), race_id: id })),
  entries, orders: [{ team_id: "t1", stage_number: 1 }], teams: entries.length ? [{ id: "t1", is_ai: true }] : [], abilities: entries.map((e) => ({ rider_id: e.rider_id, sprint: 1 })),
});
const field = (tag) => ({ entries: [{ rider_id: `${tag}-r1`, team_id: "tx", race_role: "captain" }], teams: [{ id: "tx", is_ai: false }], abilities: [{ rider_id: `${tag}-r1`, climbing: 1 }] });

test("#6909 validateRouteDoc: gyldig fil sorteres og stemples med loebets id", () => {
  const doc = routeDoc("race-a", 3);
  doc.profiles.reverse();
  const out = validateRouteDoc(doc, "race-a");
  assert.deepEqual(out.map((p) => p.stage_number), [1, 2, 3]);
  assert.ok(out.every((p) => p.race_id === "race-a"));
});

test("#6909 validateRouteDoc: fail-closed paa format, id, etaper og ukendte kolonner", () => {
  const bad = (mut, re) => { const d = routeDoc("race-a", 2); mut(d); assert.throws(() => validateRouteDoc(d, "race-a"), re); };
  bad((d) => { d.format = "v0"; }, /format/);
  bad((d) => { d.race_id = "race-b"; }, /filnavnet/);
  bad((d) => { d.stages = 3; }, /stages/);
  bad((d) => { d.profiles = []; d.stages = 0; }, /ikke-tom/);
  bad((d) => { d.profiles[1].stage_number = 1; }, /uden huller/);
  bad((d) => { d.profiles[0].stage_numbr = 1; }, /ukendte kolonner: stage_numbr/);
  bad((d) => { d.profiles[0].race_id = "race-z"; }, /passer ikke/);
  bad((d) => { delete d.profiles[0].profile_type; }, /profile_type/);
  assert.throws(() => validateRouteDoc([], "race-a"), /JSON-objekt/);
});

test("#6909 loadRoutesDir: én fil pr. loeb + valgfrit manifest; tom mappe og forkert manifest afvises", () => {
  const dir = tmp("routes");
  try {
    writeFileSync(path.join(dir, "race-b.json"), JSON.stringify(routeDoc("race-b")));
    writeFileSync(path.join(dir, "race-a.json"), JSON.stringify(routeDoc("race-a", 1)));
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ format: ROUTES_FORMAT, label: "proeve" }));
    const r = loadRoutesDir(dir);
    assert.deepEqual([...r.byRace.keys()], ["race-a", "race-b"]);
    assert.equal(r.label, "proeve");
    assertRoutesCover(["race-a"], r);
    assert.throws(() => assertRoutesCover(["race-a", "race-c"], r), /mangler rute for 1 loeb: race-c/);
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ format: "x" }));
    assert.throws(() => loadRoutesDir(dir), /manifest/);
    const empty = tmp("empty");
    assert.throws(() => loadRoutesDir(empty), /ingen <race_id>.json/);
    rmSync(empty, { recursive: true, force: true });
    assert.throws(() => loadRoutesDir(path.join(dir, "findes-ikke")), /findes ikke/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("#6909 applyRoutes: etaperne udskiftes; forkert antal etaper er en fejl", () => {
  const data = raceData("race-a", { stages: 2 });
  const out = applyRoutes(data, validateRouteDoc(routeDoc("race-a", 2), "race-a"));
  assert.deepEqual(out.profiles.map((p) => p.profile_type), ["flat", "hilly"]);
  assert.equal(data.profiles[0].profile_type, "mountain", "input roeres ikke");
  assert.throws(() => applyRoutes(data, validateRouteDoc(routeDoc("race-a", 3), "race-a")), /rute har 3 etaper, loebet har 2/);
});

test("#6909 entriesFromStaged: pr. loeb, holdets id paa hver rytter, dubletter og tomme enheder vaek", () => {
  const byRace = entriesFromStaged([
    { race_id: "r1", team_id: "t1", picks: [{ rider_id: "a", race_role: "captain" }, { rider_id: "a", race_role: "helper" }] },
    { race_id: "r1", team_id: "t2", picks: [{ rider_id: "b", race_role: "helper" }] },
    { race_id: "r2", team_id: "t1", picks: [] },
  ]);
  assert.deepEqual(byRace.get("r1"), [{ rider_id: "a", team_id: "t1", race_role: "captain" }, { rider_id: "b", team_id: "t2", race_role: "helper" }]);
  assert.equal(byRace.has("r2"), false);
});

test("#6909 withField: startliste, hold og evner fra feltet, ingen holdordrer", () => {
  const out = withField(raceData("r"), field("s"));
  assert.equal(out.entries[0].rider_id, "s-r1");
  assert.deepEqual(out.orders, []);
  assert.equal(out.profiles.length, 2);
});

// Lille falsk Supabase: from(t).select().in/eq/order/range -> thenable over tabellens raekker.
function fakeDb(tables, log = []) {
  const builder = (table) => {
    const filters = [];
    let range = null;
    const b = {
      select() { return b; },
      in(col, vals) { filters.push((r) => vals.includes(r[col])); return b; },
      eq(col, v) { filters.push((r) => r[col] === v); return b; },
      order() { return b; },
      range(from, to) { range = [from, to]; return b; },
      insert() { log.push(`insert:${table}`); return Promise.resolve({ data: null, error: null }); },
      then(resolve) {
        const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        return resolve({ data: range ? rows.slice(range[0], range[1] + 1) : rows, error: null });
      },
    };
    return b;
  };
  return { from: builder, rpc: () => { log.push("rpc"); return Promise.resolve({ data: null, error: null }); } };
}

test("#6909 readOnlyDb: SELECT gaar igennem, enhver skrivning og rpc kaster", async () => {
  const log = [];
  const db = readOnlyDb(fakeDb({ races: [{ id: "a" }, { id: "b" }] }, log));
  const { data } = await db.from("races").select("id").in("id", ["b"]);
  assert.deepEqual(data, [{ id: "b" }]);
  for (const m of ["insert", "update", "upsert", "delete"]) assert.throws(() => db.from("race_entries")[m]({}), /read-only/);
  assert.throws(() => db.rpc("apply_race_entry_unit_batch"), /read-only/);
  assert.deepEqual(log, [], "intet naaede den rigtige klient");
});

test("#6909 createProdSource.generatorField: dry-run, read-only klient, late_fill med nu = saesonens sidste start", async () => {
  const tables = {
    races: [{ id: "r1", season_id: "s5" }, { id: "r2", season_id: "s5" }, { id: "r3", season_id: "s5" }],
    race_stage_schedule: [
      { race_id: "r1", stage_number: 1, scheduled_at: "2026-10-25T10:00:00Z" },
      { race_id: "r3", stage_number: 2, scheduled_at: "2026-12-01T10:00:00Z" },
    ],
    teams: [{ id: "t1", is_ai: true }, { id: "t2", is_ai: false }],
    rider_derived_abilities: [{ rider_id: "a", climbing: 1 }, { rider_id: "b", climbing: 2 }],
  };
  const calls = [];
  const runner = async (args) => {
    calls.push(args);
    assert.throws(() => args.supabase.from("race_entries").insert([]), /read-only/);
    return { races: 3, teams: 2, generated: 2, staged: [
      { race_id: "r1", team_id: "t1", picks: [{ rider_id: "a", race_role: "captain" }] },
      { race_id: "r2", team_id: "t2", picks: [{ rider_id: "b", race_role: "captain" }] },
    ] };
  };
  const src = createProdSource(fakeDb(tables), { generatorRunner: runner, log: () => {} });
  const out = await src.generatorField(["r1"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].dryRun, true);
  assert.equal(calls[0].mode, "late_fill");
  assert.equal(calls[0].includeStaged, true);
  assert.equal(calls[0].seasonId, "s5");
  // #6909 (Codex P2): r1 udtages paa sin egen start, ikke saesonens sidste.
  assert.equal(calls[0].now, Date.parse("2026-10-25T10:00:00Z"));
  assert.deepEqual([...out.keys()], ["r1"], "kun de oenskede loeb");
  assert.deepEqual(out.get("r1").teams, [{ id: "t1", is_ai: true }]);
  assert.deepEqual(out.get("r1").abilities, [{ rider_id: "a", climbing: 1 }]);
});

test("#6909 createProdSource.raceData + withField: tourDryRun-formen fra prod-tabellerne", async () => {
  const tables = {
    races: [{ id: "r1", name: "X", stages: 1 }],
    race_stage_profiles: [{ race_id: "r1", stage_number: 1, profile_type: "flat" }],
    race_entries: [{ race_id: "r1", rider_id: "a", team_id: "t1", race_role: "captain" }],
    race_team_orders: [],
    teams: [{ id: "t1", is_ai: true }],
    rider_derived_abilities: [{ rider_id: "a", climbing: 3 }],
  };
  const src = createProdSource(fakeDb(tables), { log: () => {} });
  const d = (await src.raceData(["r1"])).get("r1");
  assert.deepEqual(d.entries, [{ rider_id: "a", team_id: "t1", race_role: "captain" }]);
  assert.deepEqual(d.teams, [{ id: "t1", is_ai: true }]);
  assert.equal(d.profiles.length, 1);
  assert.deepEqual([...(await src.withField(["r1", "r2"]))], ["r1"]);
});

test("#6909 prepareInputs (prod, kun syntetisk felt): felt-loeb koeres som foer, resten faar generatorens felt eller springes over", async () => {
  const outDir = tmp("prep");
  const asked = [];
  const source = {
    withField: async (ids) => { asked.push(["withField", ids]); return new Set(["a"]); },
    raceData: async (ids) => { asked.push(["raceData", ids]); return new Map(ids.map((id) => [id, raceData(id)])); },
    generatorField: async (ids) => { asked.push(["generatorField", ids]); return new Map([["b", field("b")]]); },
  };
  try {
    const res = await prepareInputs({ raceIds: ["a", "b", "c"], outDir, synthetic: "generator", source });
    assert.deepEqual(res.ids, ["a", "b"]);
    assert.deepEqual([...res.prebuilt], ["b"]);
    assert.equal(existsSync(path.join(outDir, "races", "a", "cache.json")), false, "felt-loeb hentes af tourDryRun selv");
    const cache = JSON.parse(readFileSync(path.join(outDir, "races", "b", "cache.json"), "utf8"));
    assert.equal(cache.fieldSource, "generator");
    assert.deepEqual(cache.orders, []);
    assert.equal(cache.entries[0].rider_id, "b-r1");
    assert.equal(cache.profiles[0].profile_type, "mountain", "prod's ruter uden --routes-from");
    assert.deepEqual({ prod: res.field.prod, synthetic: res.field.synthetic, skipped: res.field.skippedNoField, kind: res.field.kind }, { prod: 1, synthetic: 1, skipped: 1, kind: "generator" });
    assert.deepEqual(res.field.skippedIds, ["c"]);
    assert.equal(res.routes, null);
    assert.deepEqual(asked.find(([k]) => k === "generatorField")[1], ["b", "c"]);

    // Genoptagelse: b's cache genbruges; generatoren koeres kun for loeb uden cache.
    asked.length = 0;
    const again = await prepareInputs({ raceIds: ["a", "b"], outDir, synthetic: "generator", source });
    assert.deepEqual(again.ids, ["a", "b"]);
    assert.equal(asked.some(([k]) => k === "generatorField"), false);
    assert.equal(again.field.synthetic, 1);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("#6909 prepareInputs (eksport + ruter + bench): alle loeb bygges med de foreslaaede etaper", async () => {
  const root = tmp("export");
  const fromDir = path.join(root, "export");
  const outDir = path.join(root, "out");
  const routesDir = path.join(root, "routes");
  try {
    for (const [id, entries] of [["a", [{ rider_id: "x", team_id: "t1", race_role: "captain" }]], ["b", []]]) {
      mkdirSync(path.join(fromDir, id), { recursive: true });
      writeFileSync(path.join(fromDir, id, "cache.json"), JSON.stringify(raceData(id, { entries })));
    }
    mkdirSync(routesDir);
    for (const id of ["a", "b"]) writeFileSync(path.join(routesDir, `${id}.json`), JSON.stringify(routeDoc(id)));
    const routes = loadRoutesDir(routesDir);
    let benchCalls = 0;
    const source = { benchField: async () => { benchCalls += 1; return field("bench"); } };
    const res = await prepareInputs({ raceIds: ["a", "b"], outDir, fromDir, routes, synthetic: "bench", source });
    assert.deepEqual(res.ids, ["a", "b"]);
    assert.deepEqual([...res.prebuilt].sort(), ["a", "b"]);
    assert.equal(benchCalls, 1);
    const a = JSON.parse(readFileSync(path.join(outDir, "races", "a", "cache.json"), "utf8"));
    const b = JSON.parse(readFileSync(path.join(outDir, "races", "b", "cache.json"), "utf8"));
    assert.deepEqual(a.profiles.map((p) => p.profile_type), ["flat", "hilly"]);
    assert.equal(a.fieldSource, "prod");
    assert.equal(a.orders.length, 1, "prod-feltets holdordrer bevares");
    assert.equal(b.fieldSource, "bench");
    assert.equal(b.routesFrom, "routes");
    assert.deepEqual(res.routes, { dir: "routes", label: null, races: 2 });

    // Uden syntetisk felt springes loebet uden startliste over (#6805-semantik).
    const res2 = await prepareInputs({ raceIds: ["a", "b"], outDir: path.join(root, "out2"), fromDir, routes, synthetic: null, source });
    assert.deepEqual(res2.ids, ["a"]);
    assert.equal(res2.field.skippedNoField, 1);
    assert.equal(res2.field.kind, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("#6909 prepareInputs uden --routes-from og --synthetic-field: intet bygges, intet hentes", async () => {
  const res = await prepareInputs({ raceIds: ["a"], outDir: "ikke-brugt", source: null });
  assert.deepEqual(res.ids, ["a"]);
  assert.equal(res.prebuilt.size, 0);
  assert.equal(res.field, null);
});

test("#6909 inputLines: feltets og ruternes kilde staar paa kortet", () => {
  assert.deepEqual(inputLines({}), ["Startfelt: prod-tilmeldinger", "Ruter: prod's nuvaerende race_stage_profiles"]);
  const lines = inputLines({ field: { kind: "generator", note: "dry-run", prod: 2, synthetic: 3, skippedNoField: 1 }, routes: { dir: "l3", label: "S5 v7", races: 5 } });
  assert.equal(lines[0], "Startfelt: 2 loeb med prod-tilmeldinger · 3 med syntetisk felt (generator: dry-run) · 1 uden felt sprunget over");
  assert.equal(lines[1], "Ruter: foreslaaede fra l3 (S5 v7), 5 loeb");
});

test("#6909 (Codex P2) readOnlyDb overlay: generatoren ser de foreslaaede etaper, ikke prod's", async () => {
  const tables = { race_stage_profiles: [
    { race_id: "r1", stage_number: 1, profile_type: "mountain" }, { race_id: "r1", stage_number: 2, profile_type: "mountain" },
    { race_id: "r2", stage_number: 1, profile_type: "flat" },
  ] };
  const overlay = { table: "race_stage_profiles", key: "race_id", rowsByKey: new Map([["r1", [
    { race_id: "r1", stage_number: 1, profile_type: "hilly" }, { race_id: "r1", stage_number: 2, profile_type: "flat" },
  ]]]) };
  const db = readOnlyDb(fakeDb(tables), { overlay });
  const { data } = await db.from("race_stage_profiles").select("*").in("race_id", ["r1", "r2"]).order("race_id"); // pagination-safe: syntetisk fake-db i test, faa raekker
  assert.deepEqual(data.map((r) => `${r.race_id}:${r.profile_type}`), ["r1:hilly", "r1:flat", "r2:flat"]);
  assert.throws(() => db.from("race_stage_profiles").insert([]), /read-only/);
});

test("#6909 (Codex P2) generatorField med routesByRace sender overlay-klienten til generatoren", async () => {
  const tables = {
    races: [{ id: "r1", season_id: "s5" }],
    race_stage_schedule: [{ race_id: "r1", stage_number: 1, scheduled_at: "2026-11-01T10:00:00Z" }],
    race_stage_profiles: [{ race_id: "r1", stage_number: 1, profile_type: "mountain" }],
  };
  let seen = null;
  const runner = async (args) => {
    seen = (await args.supabase.from("race_stage_profiles").select("*").in("race_id", ["r1"])).data; // pagination-safe: syntetisk fake-db i test, faa raekker
    return { races: 1, teams: 0, generated: 0, staged: [] };
  };
  const src = createProdSource(fakeDb(tables), { generatorRunner: runner, log: () => {} });
  await src.generatorField(["r1"], { routesByRace: new Map([["r1", [{ stage_number: 1, profile_type: "hilly" }]]]) });
  assert.deepEqual(seen.map((r) => r.profile_type), ["hilly"]);
});

test("#6909 (Codex P1) generatorField: ingen planlagt start = klar fejl, aldrig vaeguret", async () => {
  const tables = { races: [{ id: "r1", season_id: "s5" }], race_stage_schedule: [] };
  const src = createProdSource(fakeDb(tables), { generatorRunner: async () => ({ staged: [] }), log: () => {} });
  await assert.rejects(src.generatorField(["r1"]), /uden planlagt start/);
});

test("#6909 (Codex P2) loadRoutesDir: fingeraftrykket skifter naar en rutefil aendres", () => {
  const dir = tmp("sig");
  writeFileSync(path.join(dir, "race-a.json"), JSON.stringify(routeDoc("race-a", 2)));
  const a = loadRoutesDir(dir).signature;
  assert.equal(loadRoutesDir(dir).signature, a, "samme indhold = samme fingeraftryk");
  const doc = routeDoc("race-a", 2); doc.profiles[1].profile_type = "mountain";
  writeFileSync(path.join(dir, "race-a.json"), JSON.stringify(doc));
  assert.notEqual(loadRoutesDir(dir).signature, a);
  rmSync(dir, { recursive: true, force: true });
});

test("#6909 (Codex P2) validateRouteDoc: demand_vector skal findes og have mindst ét positivt krav", () => {
  for (const dv of [undefined, {}, { sprint: 0 }, { sprint: -1, climbing: 1 }, { sprint: "x" }, [1], { sprit: 1 }, { randomness: 1 }]) {
    const d = routeDoc("race-a", 1); d.profiles[0].demand_vector = dv;
    assert.throws(() => validateRouteDoc(d, "race-a"), /demand_vector/);
  }
});

test("#6909 (Codex P2) generatorField: én generator-koersel pr. startdato, hvert loeb faar sit eget felt", async () => {
  const tables = {
    races: [{ id: "r1", season_id: "s5" }, { id: "r2", season_id: "s5" }],
    race_stage_schedule: [
      { race_id: "r1", stage_number: 1, scheduled_at: "2026-10-28T10:00:00Z" },
      { race_id: "r1", stage_number: 2, scheduled_at: "2026-10-29T10:00:00Z" },
      { race_id: "r2", stage_number: 1, scheduled_at: "2026-12-01T10:00:00Z" },
    ],
    teams: [{ id: "t1", is_ai: true }], rider_derived_abilities: [],
  };
  const nows = [];
  const runner = async (args) => {
    nows.push(args.now);
    return { generated: 2, staged: [
      { race_id: "r1", team_id: "t1", picks: [{ rider_id: `a@${args.now}`, race_role: "captain" }] },
      { race_id: "r2", team_id: "t1", picks: [{ rider_id: `b@${args.now}`, race_role: "captain" }] },
    ] };
  };
  const src = createProdSource(fakeDb(tables), { generatorRunner: runner, log: () => {} });
  const out = await src.generatorField(["r1", "r2"]);
  assert.deepEqual(nows, [Date.parse("2026-10-28T10:00:00Z"), Date.parse("2026-12-01T10:00:00Z")]);
  assert.equal(out.get("r1").entries[0].rider_id, `a@${Date.parse("2026-10-28T10:00:00Z")}`);
  assert.equal(out.get("r2").entries[0].rider_id, `b@${Date.parse("2026-12-01T10:00:00Z")}`);
});

test("#6909 (Codex P2) generatorField: hvert loeb paa sin egen start; overlappende binding-vinduer (game_day) giver ingen dobbeltbooking", async () => {
  const tables = {
    races: [{ id: "r1", season_id: "s5" }, { id: "r2", season_id: "s5" }, { id: "r3", season_id: "s5" }],
    race_stage_schedule: [
      { race_id: "r1", stage_number: 1, scheduled_at: "2026-10-28T10:00:00Z", game_day: 1 },
      { race_id: "r1", stage_number: 2, scheduled_at: "2026-10-28T12:00:00Z", game_day: 3 },
      { race_id: "r2", stage_number: 1, scheduled_at: "2026-10-28T14:00:00Z", game_day: 2 },
      { race_id: "r3", stage_number: 1, scheduled_at: "2026-10-28T16:00:00Z", game_day: 5 },
    ],
    teams: [], rider_derived_abilities: [],
  };
  const nows = [];
  const runner = async (args) => {
    nows.push(args.now);
    return { generated: 3, staged: ["r1", "r2", "r3"].map((race_id) => ({ race_id, team_id: "t1", picks: [{ rider_id: "same", race_role: "captain" }, { rider_id: `own-${race_id}`, race_role: "helper" }] })) };
  };
  const src = createProdSource(fakeDb(tables), { generatorRunner: runner, log: () => {} });
  const out = await src.generatorField(["r1", "r2", "r3"]);
  assert.equal(nows.length, 3, "én koersel pr. startdato (egen late-fill/skade-vurdering)");
  assert.ok(out.get("r1").entries.some((e) => e.rider_id === "same"), "foerste loeb beholder rytteren");
  assert.ok(!out.get("r2").entries.some((e) => e.rider_id === "same"), "overlappende game_day-vindue: droppet");
  assert.ok(out.get("r3").entries.some((e) => e.rider_id === "same"), "samme dato, men intet overlap i game_day: beholdt");
});

test("#6909 (Codex P2) generatorField: bundne ryttere skjules for senere overlappende koersler, saa generatoren selv finder erstatninger", async () => {
  const tables = {
    races: [{ id: "r1", season_id: "s5" }, { id: "r2", season_id: "s5" }],
    race_stage_schedule: [
      { race_id: "r1", stage_number: 1, scheduled_at: "2026-10-28T10:00:00Z", game_day: 1 },
      { race_id: "r1", stage_number: 2, scheduled_at: "2026-10-28T12:00:00Z", game_day: 3 },
      { race_id: "r2", stage_number: 1, scheduled_at: "2026-10-28T14:00:00Z", game_day: 2 },
    ],
    riders: [{ id: "star", team_id: "t1" }, { id: "spare", team_id: "t1" }],
    teams: [], rider_derived_abilities: [],
  };
  const runner = async (args) => {
    const { data } = await args.supabase.from("riders").select("id, team_id").in("team_id", ["t1"]); // pagination-safe: test-fake
    const pick = data.filter((r) => r.team_id === "t1").map((r) => r.id)[0];
    return { generated: 1, staged: [{ race_id: args.now === Date.parse("2026-10-28T10:00:00Z") ? "r1" : "r2", team_id: "t1", picks: [{ rider_id: pick, race_role: "captain" }] }] };
  };
  const src = createProdSource(fakeDb(tables), { generatorRunner: runner, log: () => {} });
  const out = await src.generatorField(["r1", "r2"]);
  assert.equal(out.get("r1").entries[0].rider_id, "star");
  assert.equal(out.get("r2").entries[0].rider_id, "spare", "generatoren valgte en erstatning, ingen tom plads");
});

test("#6909 readOnlyDb excludeKeys: skjuler raekker og afviser stadig skrivning", async () => {
  const db = readOnlyDb(fakeDb({ riders: [{ id: "a", team_id: "t" }, { id: "b", team_id: "t" }] }), { overlays: [{ table: "riders", key: "id", excludeKeys: new Set(["a"]), nullField: "team_id" }] });
  const { data } = await db.from("riders").select("id").in("id", ["a", "b"]); // pagination-safe: test-fake
  assert.deepEqual(data, [{ id: "a", team_id: null }, { id: "b", team_id: "t" }], "siden beholder sin laengde; den skjulte rytter er frakoblet holdet");
  assert.throws(() => db.from("riders").update({}), /read-only/);
});

test("#6909 (Codex P2) prepareInputs: en cache fra andre ruter (afbrudt koersel uden meta) bygges forfra", async () => {
  const outDir = tmp("stale");
  const dir = tmp("stale-routes");
  writeFileSync(path.join(dir, "r1.json"), JSON.stringify(routeDoc("r1", 2)));
  const routes = loadRoutesDir(dir);
  mkdirSync(path.join(outDir, "races", "r1"), { recursive: true });
  writeFileSync(path.join(outDir, "races", "r1", "cache.json"), JSON.stringify({ ...raceData("r1", { entries: [{ rider_id: "x", team_id: "t1" }] }), fieldSource: "prod", routesSignature: "gammel" }));
  const source = { withField: async () => new Set(["r1"]), raceData: async () => new Map([["r1", raceData("r1", { entries: [{ rider_id: "x", team_id: "t1" }] })]]) };
  const out = await prepareInputs({ raceIds: ["r1"], outDir, routes, source });
  const cache = JSON.parse(readFileSync(path.join(outDir, "races", "r1", "cache.json"), "utf8"));
  assert.equal(cache.routesSignature, routes.signature, "genbygget med de aktuelle ruter");
  assert.deepEqual(out.ids, ["r1"]);
  rmSync(outDir, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true });
});

test("#6909 (Codex P2) readOnlyDb: et NYT builder-objekt fra .select() (som supabase-js) faar stadig laget", async () => {
  const realish = { from: () => ({ select() { return { in() { return this; }, then(res) { return res({ data: [{ race_id: "r1", profile_type: "mountain" }], error: null }); } }; } }) };
  const db = readOnlyDb(realish, { overlay: { table: "race_stage_profiles", key: "race_id", rowsByKey: new Map([["r1", [{ race_id: "r1", profile_type: "hilly" }]]]) } });
  const { data } = await db.from("race_stage_profiles").select("*").in("race_id", ["r1"]); // pagination-safe: test-fake
  assert.deepEqual(data.map((r) => r.profile_type), ["hilly"]);
  assert.throws(() => db.from("race_stage_profiles").select("*").update({}), /read-only/);
});

test("#6909 (Codex P2) prepareInputs: cache med et andet syntetisk felt bygges forfra", async () => {
  const outDir = tmp("kind");
  mkdirSync(path.join(outDir, "races", "r1"), { recursive: true });
  writeFileSync(path.join(outDir, "races", "r1", "cache.json"), JSON.stringify({ ...raceData("r1"), fieldSource: "generator", routesSignature: null }));
  const source = { withField: async () => new Set(), raceData: async () => new Map([["r1", raceData("r1")]]), benchField: async () => field("b") };
  await prepareInputs({ raceIds: ["r1"], outDir, synthetic: "bench", source });
  const cache = JSON.parse(readFileSync(path.join(outDir, "races", "r1", "cache.json"), "utf8"));
  assert.equal(cache.fieldSource, "bench");
  rmSync(outDir, { recursive: true, force: true });
});

test("#6909 (Codex P2) readOnlyDb overlay: et loeb UDEN prod-etaper faar de foreslaaede", async () => {
  const tables = { race_stage_profiles: [{ race_id: "r2", stage_number: 1, profile_type: "flat" }] };
  const rowsByKey = new Map([["r1", [{ race_id: "r1", stage_number: 1, profile_type: "hilly" }, { race_id: "r1", stage_number: 2, profile_type: "mountain" }]], ["r9", [{ race_id: "r9", stage_number: 1, profile_type: "flat" }]]]);
  const db = readOnlyDb(fakeDb(tables), { overlay: { table: "race_stage_profiles", key: "race_id", rowsByKey } });
  const { data } = await db.from("race_stage_profiles").select("*").in("race_id", ["r1", "r2"]); // pagination-safe: test-fake
  assert.deepEqual(data.map((r) => `${r.race_id}:${r.profile_type}`), ["r2:flat", "r1:hilly", "r1:mountain"], "r9 blev ikke spurgt om");
});

test("#6909 (Codex P2) readOnlyDb overlay: pagineret laesning injicerer kun paa sidste side, aldrig dobbelt", async () => {
  const tables = { race_stage_profiles: [{ race_id: "r2", stage_number: 1 }, { race_id: "r2", stage_number: 2 }, { race_id: "r2", stage_number: 3 }] };
  const db = readOnlyDb(fakeDb(tables), { overlay: { table: "race_stage_profiles", key: "race_id", rowsByKey: new Map([["r1", [{ race_id: "r1", stage_number: 1 }]]]) } });
  const all = [];
  for (let from = 0; ; from += 2) {
    const { data } = await db.from("race_stage_profiles").select("*").in("race_id", ["r1", "r2"]).range(from, from + 1); // pagination-safe: range-sider i test
    all.push(...data);
    if (data.length < 2) break;
  }
  assert.deepEqual(all.map((r) => `${r.race_id}:${r.stage_number}`), ["r2:1", "r2:2", "r2:3", "r1:1"]);
});

test("#6909 (Codex P2) generatorField: hver koersel ser kun sin egen gruppe af de valgte loeb", async () => {
  const tables = {
    races: [{ id: "r1", season_id: "s5" }, { id: "r2", season_id: "s5" }, { id: "other", season_id: "s5" }],
    race_stage_schedule: [
      { race_id: "r1", stage_number: 1, scheduled_at: "2026-10-28T10:00:00Z", game_day: 1 },
      { race_id: "r2", stage_number: 1, scheduled_at: "2026-11-05T10:00:00Z", game_day: 9 },
    ],
    teams: [], rider_derived_abilities: [],
  };
  const seen = [];
  const runner = async (args) => {
    const { data } = await args.supabase.from("races").select("id").eq("season_id", "s5"); // pagination-safe: test-fake
    seen.push(data.map((r) => r.id).join(","));
    return { generated: 0, staged: [] };
  };
  const src = createProdSource(fakeDb(tables), { generatorRunner: runner, log: () => {} });
  await src.generatorField(["r1", "r2"]);
  assert.deepEqual(seen, ["r1,other", "r2,other"], "det andet valgte loeb er skjult; ikke-valgte loeb er urørte");
});
