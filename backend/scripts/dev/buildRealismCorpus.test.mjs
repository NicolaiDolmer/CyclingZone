// #7588 realisme-gate PR 3: korpusset. Låser (a) det committede korpus: dækker alle
// celler, er frosset (signatur), anonymiseret og kan læses som foreslåede ruter, og
// (b) byggescriptet: deterministisk, anonymiserer og bevarer scenarierne.
// Syntetiske eksporter i (b); ingen målte tal (hard rule 17).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CORPUS_FORMAT, DEFAULT_OUT, FORBIDDEN_KEYS, SCENARIOS_FORMAT, SCENARIO_DEFS, SQUADS_FORMAT,
  buildCorpus, canonical, contentSignature, parseArgs, readExistingScenarios, selectCorpusRaces, stageCells, toJson, writeCorpus,
} from "./buildRealismCorpus.mjs";
import { loadRoutesDir, validateRouteDoc } from "./lib/motorTestportInputs.mjs";
import { ABILITY_KEYS } from "../../lib/raceSimulator.js";
import { parseCellKey } from "../../lib/realismGateBands.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.resolve(here, "..", "..", "lib", "__fixtures__", "realismCorpus");
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const ROUTE_NAME_HOLDERS = new Set(["climbs", "sprints", "sectors"]);

const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));
function corpusFiles(dir = CORPUS) {
  const files = new Map();
  const walk = (rel) => {
    for (const e of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.name.endsWith(".json")) files.set(r, readJson(path.join(dir, r)));
    }
  };
  walk("");
  return files;
}

/** Forbudte nøgler i et dokument; `name` er kun tilladt i rute-indholdet (stigninger, spurter, sektorer). */
function forbiddenKeyHits(v, trail = []) {
  const hits = [];
  if (Array.isArray(v)) v.forEach((x, i) => hits.push(...forbiddenKeyHits(x, [...trail, i])));
  else if (v && typeof v === "object") {
    const inRoute = trail.some((t) => ROUTE_NAME_HOLDERS.has(t));
    for (const [k, x] of Object.entries(v)) {
      if (FORBIDDEN_KEYS.includes(k) && !(k === "name" && inRoute)) hits.push([...trail, k].join("."));
      hits.push(...forbiddenKeyHits(x, [...trail, k]));
    }
  }
  return hits;
}

// ── (a) Det committede korpus ────────────────────────────────────────────────

const files = corpusFiles();
const manifest = files.get("manifest.json");
const routeDocs = new Map(manifest.races.map((r) => [r.id, files.get(r.file)]));
const asCache = (doc) => ({ race: { id: doc.race_id, ...doc.race }, profiles: doc.profiles });

test("#7588 korpus: manifestet peger på default-mappen og har det rigtige format", () => {
  assert.equal(path.resolve(DEFAULT_OUT), CORPUS);
  assert.equal(manifest.format, CORPUS_FORMAT);
  assert.equal(manifest.squad, "senior");
  assert.equal(files.get("squads.json").format, SQUADS_FORMAT);
  assert.equal(files.get("scenarios.json").format, SCENARIOS_FORMAT);
  assert.ok(Number.isInteger(manifest.measurementContract));
});

test("#7588 korpus: frosset, signaturen passer med filerne (redigér aldrig i hånden)", () => {
  assert.equal(contentSignature(files), manifest.contentSignature, "kør buildRealismCorpus.mjs igen i stedet for at rette filerne");
  // Ingen løse filer: alt på disken står i manifestet eller scenarierne.
  const listed = new Set(["manifest.json", manifest.squads, manifest.scenarios, ...manifest.races.map((r) => r.file), ...files.get("scenarios.json").scenarios.map((s) => s.file)]);
  assert.deepEqual([...files.keys()].filter((f) => !listed.has(f)), []);
});

test("#7588 korpus: hver celle har etaper, og hver etape står i præcis sin egen celle", () => {
  assert.ok(manifest.cells.length > 0);
  const listed = new Map();
  for (const { cell, stages } of manifest.cells) {
    assert.ok(parseCellKey(cell), `ugyldig celle ${cell}`);
    assert.ok(stages.length >= 1, `${cell} har ingen etaper`);
    for (const s of stages) { assert.ok(!listed.has(s), `${s} står i to celler`); listed.set(s, cell); }
  }
  let total = 0;
  for (const [id, doc] of routeDocs) {
    for (const { stage, cell } of stageCells(asCache(doc))) {
      total += 1;
      assert.equal(listed.get(`${id}:${stage}`), cell, `${id}:${stage} har forkert celle i manifestet`);
    }
  }
  assert.equal(listed.size, total, "manifestet nævner etaper der ikke findes");
  // Korpusset spænder alle løbsgrupper og alle afslutninger, der findes i senior-kalenderen.
  const groups = new Set(manifest.cells.map((c) => parseCellKey(c.cell).group));
  for (const g of ["one_day", "stage_race", "gt"]) assert.ok(groups.has(g), `ingen ${g}-celler`);
  const finishes = new Set(manifest.cells.map((c) => parseCellKey(c.cell).finish));
  for (const f of ["summit", "descent", "sprint", "punch", "tt"]) assert.ok(finishes.has(f), `ingen ${f}-afslutning`);
});

test("#7588 korpus: ruterne kan læses som foreslåede ruter (cz-race-routes/v1) og er hele løb", () => {
  const routes = loadRoutesDir(path.join(CORPUS, "routes"));
  assert.equal(routes.byRace.size, manifest.races.length);
  for (const r of manifest.races) {
    const doc = routeDocs.get(r.id);
    assert.equal(doc.race_id, r.id);
    assert.equal(doc.race.stages, doc.profiles.length, `${r.id}: etapeløb skal være hele (træthed i rækkefølge)`);
    assert.equal(r.stages, doc.profiles.length);
    assert.equal(doc.race.squad, "senior");
    assert.equal(routes.byRace.get(r.id).length, doc.profiles.length);
  }
});

test("#7588 korpus: anonymiseret (ingen prod-id'er, navne, user_id eller holdordrer)", () => {
  for (const [rel, doc] of files) {
    const text = JSON.stringify(doc);
    assert.ok(!UUID.test(text), `${rel} indeholder et prod-id`);
    assert.deepEqual(forbiddenKeyHits(doc), [], `${rel} har forbudte felter`);
    assert.ok(!/"orders"|"breakaway_stance"|"try_break"/.test(text), `${rel} indeholder holdordrer`);
  }
  for (const doc of routeDocs.values()) {
    assert.ok(/^c\d{3,}$/.test(doc.race_id));
    for (const p of doc.profiles) {
      assert.equal(p.generated_at, null);
      assert.equal(p.id, `${doc.race_id}-s${p.stage_number}`);
    }
  }
});

test("#7588 korpus: trup-fixturen hænger sammen og har kun aliaser", () => {
  const sq = files.get("squads.json");
  assert.deepEqual(sq.ability_keys, [...ABILITY_KEYS]);
  const teamIds = new Set(sq.teams.map((t) => t.id));
  assert.equal(teamIds.size, sq.teams.length);
  for (const t of sq.teams) {
    assert.ok(/^t\d{3,}$/.test(t.id));
    assert.equal(typeof t.is_ai, "boolean");
    assert.ok(Number.isInteger(t.league_division_id), `${t.id} mangler division`);
    assert.deepEqual(Object.keys(t).sort(), ["id", "is_ai", "league_division_id"]);
  }
  const riderIds = new Set(sq.riders.map((r) => r.id));
  assert.equal(riderIds.size, sq.riders.length);
  for (const r of sq.riders) {
    assert.ok(/^r\d{4,}$/.test(r.id));
    assert.ok(teamIds.has(r.team_id), `${r.id} peger på et ukendt hold`);
    assert.deepEqual(Object.keys(r).sort(), ["id", "team_id"]);
  }
  assert.equal(sq.abilities.length, sq.riders.length);
  for (const a of sq.abilities) {
    assert.ok(riderIds.has(a.rider_id));
    assert.deepEqual(Object.keys(a).sort(), ["rider_id", ...ABILITY_KEYS].sort());
  }
  // Hver division i korpusset har hold at udtage fra.
  const divs = new Set(sq.teams.map((t) => t.league_division_id));
  for (const doc of routeDocs.values()) assert.ok(divs.has(doc.race.league_division_id), `${doc.race_id}: ingen hold i divisionen`);
});

test("#7588 korpus: scenariepakken dækker de kendte fejl og peger på rigtige etaper", () => {
  const { scenarios } = files.get("scenarios.json");
  assert.deepEqual(scenarios.map((s) => s.id), SCENARIO_DEFS.map((d) => d.id));
  assert.deepEqual([...new Set(scenarios.map((s) => s.issue))].sort(), [6912, 7236]);
  for (const s of scenarios) {
    const doc = files.get(s.file);
    assert.ok(doc, `${s.id}: filen mangler`);
    validateRouteDoc(doc, s.race);
    assert.equal(doc.race_id, s.race);
    assert.ok(s.focusStages.length >= 1);
    const cells = new Map(stageCells(asCache(doc)).map((x) => [x.stage, x.cell]));
    for (const st of s.focusStages) assert.equal(cells.get(st), s.cell, `${s.id}: etape ${st} er ikke i cellen ${s.cell}`);
    assert.equal(s.runWholeRace, doc.profiles.length > 1);
  }
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  assert.match(byId.get("queen-short-descent-a").cell, /\|high_mountain\|descent$/);
  assert.match(byId.get("queen-short-descent-b").cell, /^gt\|high_mountain\|descent$/);
  assert.match(byId.get("mountain-long-let-go").cell, /^stage_race\|mountain\|/);
  assert.equal(byId.get("flat-sprint").cell, "stage_race|flat|sprint");
});

test("#7588 korpus: udbrudsvilje kun som signatur (satserne er private)", () => {
  const bi = manifest.breakawayIntent;
  if (bi === null) return;
  assert.deepEqual(Object.keys(bi).sort(), ["signature", "source"]);
  assert.equal(bi.source, "private");
  assert.match(bi.signature, /^[0-9a-f]{16}$/);
  for (const [rel, doc] of files) assert.ok(!/"rows"|"minCellTeamStages"/.test(JSON.stringify(doc)), `${rel} indeholder satser`);
});

// ── (b) Byggescriptet på en syntetisk eksport ────────────────────────────────

const DV = { climbing: 0.4, flat: 0.3, sprint: 0.2, randomness: 0.1 };
let seq = 0;
const uuid = () => { seq += 1; return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`; };
function profile(n, profile_type, finale_type, extra = {}) {
  return {
    id: uuid(), race_id: "x", stage_number: n, profile_type, finale_type, demand_vector: { ...DV }, generator_version: 7, is_manual: false,
    generated_at: "2026-10-21T10:00:00+00:00", distance_km: 150, elevation_gain_m: 1000,
    climbs: [{ name: "Côte de Test", category: "2", crest_km: 120, length_km: 5, avg_gradient: 6, summit_finish: false }],
    sprints: [{ km: 150, kind: "finish", name: "Finish" }], sectors: [],
    segments: [{ kind: "flat", from_km: 0, to_km: 115 }, { kind: "climb", from_km: 115, to_km: 120 }, { kind: "flat", from_km: 120, to_km: 150 }],
    weather: { kind: "sun" }, elevation_profile: { h: [1, 2, 3] }, ...extra,
  };
}
function race({ name, stages, division = 3, raceClass = "ProSeries", squad = "senior", teams }) {
  const id = uuid();
  const profs = stages.map(([t, f, extra], i) => ({ ...profile(i + 1, t, f, extra), race_id: id }));
  const entries = [];
  const abilities = [];
  for (const t of teams) for (const rid of t.riders) {
    entries.push({ rider_id: rid, team_id: t.id, race_role: "helper" });
    abilities.push({ rider_id: rid, ...Object.fromEntries(ABILITY_KEYS.map((k, i) => [k, (i * 7) % 50])) });
  }
  return {
    race: { id, name, stages: profs.length, squad, race_class: raceClass, status: "scheduled", league_division_id: division },
    profiles: profs, entries,
    orders: [{ team_id: teams[0].id, race_id: id, stage_number: 1, breakaway_stance: "neutral", riders: [] }],
    teams: teams.map((t) => ({ id: t.id, is_ai: t.ai, user_id: t.ai ? null : uuid() })), abilities,
  };
}
function syntheticExport() {
  seq = 0;
  const teamA = { id: uuid(), ai: false, riders: [uuid(), uuid()] };
  const teamB = { id: uuid(), ai: true, riders: [uuid(), uuid()] };
  const teamC = { id: uuid(), ai: true, riders: [uuid()] };
  const T = [teamA, teamB];
  return [
    race({ name: "Klassiker Et", stages: [["flat", "flat_sprint"]], teams: T }),
    race({ name: "Klassiker To", stages: [["hilly", "punch"]], teams: T }),
    race({ name: "Klassiker Tre", stages: [["flat", "flat_sprint"]], teams: T }),
    race({ name: "Monument Et", stages: [["cobbles", "flat_sprint"]], raceClass: "Monuments", division: 1, teams: [teamC] }),
    race({ name: "Tour des Volcans d'Auvergne", stages: [["flat", "flat_sprint"], ["mountain", "long_climb"], ["high_mountain", "descent"], ["itt", "solo_tt"]], teams: T }),
    race({ name: "Rundt Om Test", stages: [["flat", "flat_sprint", { distance_km: 210 }], ["mountain", "long_climb", { segments: [{ kind: "flat", from_km: 0, to_km: 140 }, { kind: "climb", from_km: 140, to_km: 150 }] }], ["rolling", "flat_sprint"]], teams: T }),
    race({ name: "Ungdomsløb", stages: [["flat", "flat_sprint"]], squad: "u23", teams: T }),
  ];
}

const shuffleKeys = (v) => {
  if (Array.isArray(v)) return v.map(shuffleKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).reverse().map((k) => [k, shuffleKeys(v[k])]));
  return v;
};
const serialize = (filesMap) => [...filesMap].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}\n${toJson(v)}`).join("");

test("#7588 build: deterministisk (samme eksport i anden rækkefølge og nøgle-orden giver samme bytes)", () => {
  const a = buildCorpus({ caches: syntheticExport(), perCell: 2, sourceLabel: "syn" });
  const b = buildCorpus({ caches: syntheticExport().reverse().map(shuffleKeys), perCell: 2, sourceLabel: "syn" });
  assert.equal(serialize(a.files), serialize(b.files));
  assert.equal(a.files.get("manifest.json").contentSignature, b.files.get("manifest.json").contentSignature);
  assert.deepEqual(canonical({ b: 1, a: { d: 1, c: 2 } }), { a: { c: 2, d: 1 }, b: 1 });
});

test("#7588 build: dækker alle senior-celler, hele løb, ungdom udeladt", () => {
  const caches = syntheticExport();
  const { files: out } = buildCorpus({ caches, perCell: 1, sourceLabel: "syn" });
  const m = out.get("manifest.json");
  const expected = new Set(caches.filter((c) => c.race.squad === "senior").flatMap((c) => stageCells(c).map((x) => x.cell)));
  assert.deepEqual(m.cells.map((c) => c.cell).sort(), [...expected].sort());
  for (const c of m.cells) assert.ok(c.stages.length >= 1);
  assert.ok(m.cells.some((c) => c.cell === "monument|cobbles|sprint"));
  for (const r of m.races) assert.equal(out.get(r.file).profiles.length, r.stages);
  // perCell=1: de tre flade endagsløb giver kun ét med (de andre celler er dækket).
  const flatOneDay = m.cells.find((c) => c.cell === "one_day|flat|sprint");
  assert.equal(flatOneDay.stages.length, 1);
});

test("#7588 build: grådig udvælgelse foretrækker mest ny dækning pr. etape", () => {
  const caches = syntheticExport().filter((c) => c.race.squad === "senior");
  const { raceIds } = selectCorpusRaces(caches, { perCell: 1 });
  const names = caches.filter((c) => raceIds.includes(c.race.id)).map((c) => c.race.name).sort();
  assert.ok(names.includes("Klassiker To") && names.includes("Monument Et"));
  assert.equal(names.filter((n) => n.startsWith("Klassiker")).length, 2, "kun én flad klassiker er nødvendig");
});

test("#7588 build: anonymiserer (ingen prod-id, navn, user_id eller ordrer i output)", () => {
  const caches = syntheticExport();
  const { files: out, privateMap } = buildCorpus({ caches, perCell: 2, sourceLabel: "syn" });
  const text = serialize(out);
  assert.ok(!UUID.test(text));
  for (const c of caches) assert.ok(!text.includes(c.race.name), `løbsnavnet ${c.race.name} er med`);
  assert.ok(!text.includes("user_id"));
  assert.ok(!text.includes("breakaway_stance"));
  for (const [rel, doc] of out) assert.deepEqual(forbiddenKeyHits(doc), [], rel);
  // Rute-indholdet er bevaret (stigningens navn er rute, ikke person).
  assert.ok(text.includes("Côte de Test"));
  // Det private kort har koblingen tilbage (kun til balance-internals).
  assert.ok(privateMap.races.every((r) => UUID.test(r.raceId)));
});

test("#7588 build: trupperne: division fra puljen, aliaser i id-orden, kun senior", () => {
  const { files: out } = buildCorpus({ caches: syntheticExport(), perCell: 2, sourceLabel: "syn" });
  const sq = out.get("squads.json");
  assert.deepEqual(sq.teams.map((t) => t.id), ["t001", "t002", "t003"]);
  assert.deepEqual(sq.teams.map((t) => t.league_division_id), [3, 3, 1]);
  assert.deepEqual(sq.teams.map((t) => t.is_ai), [false, true, true]);
  assert.equal(sq.riders.length, 5);
  assert.deepEqual(sq.riders.map((r) => r.team_id), ["t001", "t001", "t002", "t002", "t003"]);
});

test("#7588 build: scenarier vælges efter navn eller regel, og bevares ved genbygning", () => {
  const caches = syntheticExport();
  const first = buildCorpus({ caches, perCell: 2, sourceLabel: "syn" });
  const sc = first.files.get("scenarios.json").scenarios;
  const byId = new Map(sc.map((s) => [s.id, s]));
  assert.equal(byId.get("queen-short-descent-a").focusStages[0], 3);
  assert.equal(byId.get("queen-short-descent-a").cell, "stage_race|high_mountain|descent");
  assert.ok(!byId.has("queen-short-descent-b"), "et scenarie der ikke findes i eksporten springes over");
  // Regel: bjergetapen med længst vej før første stigning (Rundt Om Test et. 2).
  const let_go = first.files.get(byId.get("mountain-long-let-go").file);
  assert.equal(let_go.profiles.length, 3);
  assert.equal(byId.get("mountain-long-let-go").focusStages[0], 2);
  // Regel: længste flade spurtetape i et etapeløb (Rundt Om Test et. 1, 210 km).
  assert.equal(first.files.get(byId.get("flat-sprint").file).profiles[0].distance_km, 210);

  // Genbygning på en ny sæson uden Auvergne: scenariet bevares uændret.
  const dir = mkdtempSync(path.join(os.tmpdir(), "realism-corpus-"));
  try {
    writeCorpus(dir, first.files);
    const { existing, files: existingFiles } = readExistingScenarios(dir);
    const next = syntheticExport().filter((c) => c.race.name !== "Tour des Volcans d'Auvergne");
    const second = buildCorpus({ caches: next, perCell: 2, sourceLabel: "syn2", existingScenarios: existing, existingScenarioFiles: existingFiles });
    const kept = second.files.get("scenarios.json").scenarios.find((s) => s.id === "queen-short-descent-a");
    assert.deepEqual(kept, byId.get("queen-short-descent-a"));
    assert.deepEqual(second.files.get(kept.file), first.files.get(kept.file));
    const refreshed = buildCorpus({ caches: next, perCell: 2, sourceLabel: "syn2", existingScenarios: existing, existingScenarioFiles: existingFiles, refreshScenarios: true });
    assert.ok(!refreshed.files.get("scenarios.json").scenarios.some((s) => s.id === "queen-short-descent-a"));
    // writeCorpus rydder gamle rute-filer.
    writeCorpus(dir, refreshed.files);
    const onDisk = readdirSync(path.join(dir, "scenarios")).sort();
    assert.ok(!onDisk.includes("sc-queen-short-descent-a.json"));
    assert.ok(existsSync(path.join(dir, "manifest.json")));
    assert.equal(contentSignature(corpusFiles(dir)), refreshed.files.get("manifest.json").contentSignature);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("#7588 build: udbrudsvilje-satser giver kun en signatur", () => {
  const rates = { format: "cz-breakaway-intent-rates/v2", rows: [{ cell: "x", rate: 0.5 }], minCellTeamStages: 3 };
  const { files: out } = buildCorpus({ caches: syntheticExport(), perCell: 2, sourceLabel: "syn", intentRates: rates });
  const m = out.get("manifest.json");
  assert.equal(m.breakawayIntent.source, "private");
  assert.match(m.breakawayIntent.signature, /^[0-9a-f]{16}$/);
  assert.ok(!serialize(out).includes("minCellTeamStages"));
});

test("#7588 build: argumenter og fail-closed", () => {
  assert.throws(() => parseArgs([]), /--from-dir/);
  assert.throws(() => parseArgs(["--from-dir=x", "--per-cell=0"]), /--per-cell/);
  assert.throws(() => parseArgs(["--from-dir=x", "--season=S 6"]), /--season/);
  const a = parseArgs(["--from-dir=a/b/races", "--season=S6"]);
  assert.equal(a.season, "S6");
  assert.equal(path.basename(a.intentRates), "breakaway-intent-rates.json");
  assert.equal(path.basename(path.dirname(a.intentRates)), "b");
  // Codex P2: relativ eksport -> satserne findes ved siden af eksporten under repo-roden, uanset cwd.
  assert.equal(path.resolve(a.intentRates), path.resolve(DEFAULT_OUT, "..", "..", "..", "..", "a", "b", "breakaway-intent-rates.json"));
  assert.throws(() => buildCorpus({ caches: [], sourceLabel: "x" }), /ingen senior-løb/);
  // En rute uden demand_vector kommer ikke med (samme validator som testporten).
  const bad = syntheticExport().filter((c) => c.race.squad === "senior");
  bad[0].profiles[0].demand_vector = null;
  const { files: out } = buildCorpus({ caches: bad, perCell: 5, sourceLabel: "x" });
  assert.equal(out.get("manifest.json").races.length, bad.length - 1);
});
