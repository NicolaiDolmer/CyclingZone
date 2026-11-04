#!/usr/bin/env node
// #7588 realisme-gate (løsning B), PR 3: byg korpusset gaten kører på.
//
// READ-ONLY: scriptet læser kun en EKSISTERENDE motor-testport-eksport (en mappe med
// <race_id>/cache.json, som `tourDryRun.mjs --save-cache`/`motorTestport.mjs` skriver,
// samme input som `--from-dir` i motorTestportInputs.mjs). Det taler aldrig med prod,
// kræver ingen secrets og ændrer intet i motoren.
//
// Output (committes, anonymiseret, ingen tal fra motor eller generator):
//   backend/lib/__fixtures__/realismCorpus/
//     manifest.json      celler (gruppe x terræn x afslutning) -> korpus-etaper, løb, signatur
//     routes/<id>.json   frosne S5-ruter (cz-race-routes/v1, kan læses med loadRoutesDir)
//     squads.json        frossen trup-fixture til tilmeldingsgeneratoren (hold + ryttere + evner)
//     scenarios.json     scenariepakken: kendte fejl som permanente vagter
//     scenarios/<id>.json  scenariernes løb (hele løbet, så træthed kan akkumuleres)
//
// Privat (hard rule 17, kun balance-internals/realism-gate/, gitignoreret):
//   corpus-map-<dato>.json        alias -> rigtigt løb (navn, id) til fejlfinding
//   corpus-intent-rates.json      menneskeholdenes udbrudsvilje-satser (kopi af eksportens)
//
// Anonymisering: løb, hold og ryttere får aliaser (c001, t001, r0001). Løbsnavne,
// prod-id'er, user_id og holdordrer kommer aldrig med. Rute-indhold (etaper, stigninger,
// segmenter) er ikke balance og bevares uændret. Udbrudsvilje-satserne er balance og
// ligger kun privat; manifestet har kun deres signatur, så runneren kan afvise forkerte satser.
//
// Determinisme: samme eksport giver byte-identisk output (sorteret efter prod-id, kanonisk
// nøgle-orden, ingen tidsstempler i de committede filer).
//
// ── Genbygning ved sæsonskifte ───────────────────────────────────────────────
// 1. Lav en frisk eksport af den nye sæsons kalender med motor-testporten (det eneste
//    skridt der læser prod, kun SELECT; samme kommando som testporten altid bruger):
//      infisical run --env=prod --silent -- node backend/scripts/dev/motorTestport.mjs \
//        --candidate=<aktuel revision> --no-bench --limit=1 --synthetic-field=generator \
//        --out=balance-internals/<mappe>
//    (eller tourDryRun.mjs --save-cache pr. løb). Mappen <out>/races er eksporten, og
//    <out>/breakaway-intent-rates.json er satserne.
// 2. Byg korpusset (ingen secrets):
//      node backend/scripts/dev/buildRealismCorpus.mjs --from-dir=balance-internals/<mappe>/races --season=S6
// 3. Scenarierne er permanente: findes et scenarie allerede i scenarios.json, beholdes
//    det uændret (også når løbet ikke findes i den nye sæson). Kun nye scenarier vælges.
//    `--refresh-scenarios` vælger alle forfra (kun når et scenarie bevidst skal skiftes).
// 4. Kør testen (backend/scripts/dev/buildRealismCorpus.test.mjs) og commit hele mappen.
//
// Flag:
//   --from-dir=<dir>        eksporten (<race_id>/cache.json), kræves
//   --out=<dir>             default backend/lib/__fixtures__/realismCorpus
//   --season=<label>        sæson-etiket i manifestet (default S5)
//   --per-cell=<n>          mål for antal distinkte etaper pr. celle (default se DEFAULT_PER_CELL)
//   --intent-rates=<fil>    default <eksportens forældermappe>/breakaway-intent-rates.json
//   --private-dir=<dir>     default balance-internals/realism-gate
//   --refresh-scenarios     vælg alle scenarier forfra
//
// Refs #7588
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROUTES_FORMAT, PROFILE_COLUMNS, validateRouteDoc } from "./lib/motorTestportInputs.mjs";
import { MEASUREMENT_CONTRACT_VERSION, finishOf, stageCellOf } from "./lib/realismMetrics.mjs";
import { raceGroupOf } from "./lib/raceGroupGates.mjs";
import { ratesSignature, validateRates } from "./lib/breakawayIntent.mjs";
import { ABILITY_KEYS } from "../../lib/raceSimulator.js";
import { cellKey } from "../../lib/realismGateBands.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..", "..", "..");
export const DEFAULT_OUT = path.join(REPO_ROOT, "backend", "lib", "__fixtures__", "realismCorpus");
export const DEFAULT_PRIVATE_DIR = path.join(REPO_ROOT, "balance-internals", "realism-gate");

export const CORPUS_FORMAT = "cz-realism-corpus/v1";
export const SQUADS_FORMAT = "cz-realism-squads/v1";
export const SCENARIOS_FORMAT = "cz-realism-scenarios/v1";
/** Korpusstørrelse, ikke balance: hvor mange distinkte etaper hver celle højst får. */
export const DEFAULT_PER_CELL = 6;
/** Korpusset er senior (designets afsnit 4: U23/junior er uden for gaten indtil der er bånd). */
export const CORPUS_SQUAD = "senior";

/** Felter der aldrig må stå i en committet fil (anonymisering; testen låser det). */
export const FORBIDDEN_KEYS = Object.freeze(["name", "firstname", "lastname", "user_id", "username", "email", "manager", "discord"]);

/**
 * Scenariepakken: de etaper der har givet fejl, så en fundet fejl bliver en permanent vagt.
 * `match` peger på et konkret løb (navnene er offentlige i issuet); `rule` vælger
 * deterministisk efter rutens form, når fejlen er et mønster og ikke én etape.
 */
export const SCENARIO_DEFS = Object.freeze([
  { id: "queen-short-descent-a", issue: 7236, title: "Dronningeetape med kort nedkørsel efter sidste top, tidligt i et etapeløb", match: { raceName: "Tour des Volcans d'Auvergne", stage: 3 } },
  { id: "queen-short-descent-b", issue: 7236, title: "Dronningeetape med kort nedkørsel sent i en grand tour (akkumuleret træthed)", match: { raceName: "Tour de l'Hexagone", stage: 17 } },
  { id: "mountain-long-let-go", issue: 6912, title: "Bjergetape i et etapeløb med lang vej før første stigning (udbruddet får lang snor)", rule: "mountainLongestRunIn" },
  { id: "flat-sprint", issue: 6912, title: "Flad etape med massespurt i et etapeløb (feltet skal hente udbruddet i finalen)", rule: "flatSprintLongest" },
]);

// ── Rene hjælpere ────────────────────────────────────────────────────────────

/** Kanonisk værdi: objekt-nøgler sorteret rekursivt (lister bevarer rækkefølgen). */
export function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  return v;
}

export const toJson = (v) => `${JSON.stringify(canonical(v))}\n`;

/** Indholds-signatur over alle filer undtagen manifestet (uafhængig af linjeslutninger). */
export function contentSignature(files) {
  const h = createHash("sha256");
  for (const rel of [...files.keys()].filter((k) => k !== "manifest.json").sort()) {
    h.update(`${rel}\0`).update(JSON.stringify(canonical(files.get(rel)))).update("\0");
  }
  return h.digest("hex").slice(0, 16);
}

const pad = (n, width) => String(n).padStart(width, "0");
const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Løbsgruppen (med monumenter) for en eksport-cache. */
export function groupOfCache(cache) {
  return raceGroupOf({ stages: cache.race.stages, raceClass: cache.race.race_class ?? null });
}

/** Etapernes celler: [{ stage, cell }] sorteret på etape. */
export function stageCells(cache) {
  const group = groupOfCache(cache);
  return [...cache.profiles]
    .sort((a, b) => a.stage_number - b.stage_number)
    .map((p) => {
      const c = stageCellOf({ stageCount: cache.race.stages, raceGroup: group, profile: p });
      return { stage: p.stage_number, cell: cellKey(c.group, c.terrain, c.finish) };
    });
}

/** Læs eksporten: senior-løb med gyldige ruter, sorteret på prod-id. */
export function readExportDir(dir) {
  if (!existsSync(dir)) throw new Error(`--from-dir: ${dir} findes ikke`);
  const out = [];
  for (const id of readdirSync(dir).sort(byString)) {
    const f = path.join(dir, id, "cache.json");
    if (!existsSync(f)) continue;
    out.push(JSON.parse(readFileSync(f, "utf8")));
  }
  return out;
}

/** Fail-closed: ruten skal kunne læses som en foreslået rute (samme validator som testporten). */
function validCache(cache) {
  if (!cache?.race?.id || !Array.isArray(cache.profiles) || !cache.profiles.length) return false;
  if (cache.race.stages !== cache.profiles.length) return false;
  try {
    validateRouteDoc({ format: ROUTES_FORMAT, race_id: cache.race.id, stages: cache.profiles.length, profiles: cache.profiles }, cache.race.id);
    return true;
  } catch {
    // Ugyldig rute (fx manglende demand_vector): løbet kommer ikke med i korpusset.
    return false;
  }
}

export function corpusCandidates(caches) {
  return caches.filter((c) => c?.race?.squad === CORPUS_SQUAD && validCache(c)).sort((a, b) => byString(a.race.id, b.race.id));
}

/**
 * Grådig, deterministisk dækning: vælg hele løb (etapeløb skal køres i rækkefølge med
 * træthed), indtil hver celle har `perCell` distinkte etaper eller alle cellens etaper.
 * Næste løb = mest ny dækning pr. etape; lighed -> mest dækning, færrest etaper, prod-id.
 */
export function selectCorpusRaces(candidates, { perCell = DEFAULT_PER_CELL } = {}) {
  const cellsOf = new Map(candidates.map((c) => [c.race.id, stageCells(c)]));
  const available = new Map();
  for (const cells of cellsOf.values()) for (const { cell } of cells) available.set(cell, (available.get(cell) ?? 0) + 1);
  const target = new Map([...available].map(([cell, n]) => [cell, Math.min(perCell, n)]));
  const have = new Map([...target.keys()].map((k) => [k, 0]));
  const chosen = [];
  const left = new Set(candidates.map((c) => c.race.id));
  const gainOf = (id) => {
    const need = new Map();
    let gain = 0;
    for (const { cell } of cellsOf.get(id)) {
      const used = need.get(cell) ?? 0;
      if (have.get(cell) + used < target.get(cell)) { gain += 1; need.set(cell, used + 1); }
    }
    return gain;
  };
  for (;;) {
    let best = null;
    for (const id of [...left].sort(byString)) {
      const gain = gainOf(id);
      if (!gain) continue;
      const cost = cellsOf.get(id).length;
      const better = !best
        || gain * best.cost > best.gain * cost
        || (gain * best.cost === best.gain * cost && (gain > best.gain || (gain === best.gain && cost < best.cost)));
      if (better) best = { id, gain, cost };
    }
    if (!best) break;
    chosen.push(best.id);
    left.delete(best.id);
    for (const { cell } of cellsOf.get(best.id)) have.set(cell, have.get(cell) + 1);
  }
  return { raceIds: chosen.sort(byString), cells: [...target.keys()].sort(byString) };
}

/** Ruten uden prod-id'er, navne og tidsstempler; kun race_stage_profiles-kolonner. */
export function anonymizeProfiles(profiles, alias) {
  return [...profiles].sort((a, b) => a.stage_number - b.stage_number).map((p) => {
    const out = {};
    for (const col of PROFILE_COLUMNS) if (p[col] !== undefined) out[col] = p[col];
    out.id = `${alias}-s${p.stage_number}`;
    out.race_id = alias;
    out.generated_at = null;
    return out;
  });
}

/** Løbets offentlige struktur (ingen navn, ingen prod-id, ingen status). */
export function raceMeta(cache) {
  return { stages: cache.race.stages, squad: cache.race.squad, race_class: cache.race.race_class ?? null, league_division_id: cache.race.league_division_id ?? null };
}

export function routeDoc(cache, alias) {
  return { format: ROUTES_FORMAT, race_id: alias, stages: cache.profiles.length, race: raceMeta(cache), profiles: anonymizeProfiles(cache.profiles, alias) };
}

/**
 * Trup-fixturen: alle senior-hold og -ryttere der står på en startliste i eksporten.
 * Holdets division = divisionen for de løb holdet er tilmeldt (puljen); ved flere den
 * hyppigste (lighed: laveste). Evnerne er rytterens rider_derived_abilities-række.
 */
export function buildSquads(caches) {
  const teams = new Map(); // prodId -> {is_ai, divs: Map}
  const riders = new Map(); // prodId -> {team, abilities}
  let conflicts = 0;
  for (const c of [...caches].sort((a, b) => byString(a?.race?.id ?? "", b?.race?.id ?? ""))) {
    if (c?.race?.squad !== CORPUS_SQUAD) continue;
    const div = c.race.league_division_id ?? null;
    const aiOf = new Map((c.teams ?? []).map((t) => [t.id, t.is_ai === true]));
    const abil = new Map((c.abilities ?? []).map((a) => [a.rider_id, a]));
    for (const e of c.entries ?? []) {
      if (!e?.team_id || !e?.rider_id || !abil.has(e.rider_id)) continue;
      if (!teams.has(e.team_id)) teams.set(e.team_id, { is_ai: aiOf.get(e.team_id) ?? false, divs: new Map() });
      const t = teams.get(e.team_id);
      if (div !== null) t.divs.set(div, (t.divs.get(div) ?? 0) + 1);
      if (!riders.has(e.rider_id)) riders.set(e.rider_id, { team: e.team_id, abilities: abil.get(e.rider_id) });
      else if (riders.get(e.rider_id).team !== e.team_id) conflicts += 1;
    }
  }
  const teamIds = [...teams.keys()].sort(byString);
  const tw = Math.max(3, String(teamIds.length).length);
  const teamAlias = new Map(teamIds.map((id, i) => [id, `t${pad(i + 1, tw)}`]));
  const riderIds = [...riders.keys()].sort((a, b) => byString(teamAlias.get(riders.get(a).team), teamAlias.get(riders.get(b).team)) || byString(a, b));
  const rw = Math.max(4, String(riderIds.length).length);
  const riderAlias = new Map(riderIds.map((id, i) => [id, `r${pad(i + 1, rw)}`]));
  const divOf = (divs) => [...divs].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
  const squads = {
    format: SQUADS_FORMAT,
    squad: CORPUS_SQUAD,
    ability_keys: [...ABILITY_KEYS],
    note: "Frosne trupper til tilmeldingsgeneratoren (dry-run i hukommelsen). Kun ryttere der står på en startliste i eksporten; ingen skader, ingen træthed, ingen holdordrer.",
    teams: teamIds.map((id) => ({ id: teamAlias.get(id), is_ai: teams.get(id).is_ai, league_division_id: divOf(teams.get(id).divs) })),
    riders: riderIds.map((id) => ({ id: riderAlias.get(id), team_id: teamAlias.get(riders.get(id).team) })),
    abilities: riderIds.map((id) => {
      const a = riders.get(id).abilities;
      const row = { rider_id: riderAlias.get(id) };
      for (const k of ABILITY_KEYS) row[k] = a[k] ?? null;
      return row;
    }),
  };
  const teamConflicts = [...teams.values()].filter((t) => t.divs.size > 1).length;
  return { squads, stats: { teams: teamIds.length, riders: riderIds.length, riderTeamConflicts: conflicts, teamDivisionConflicts: teamConflicts } };
}

const firstClimbKm = (p) => {
  const seg = (p.segments ?? []).find((s) => s?.kind === "climb");
  if (seg && Number.isFinite(Number(seg.from_km))) return Number(seg.from_km);
  const cl = (p.climbs ?? []).map((c) => Number(c.crest_km) - Number(c.length_km)).filter(Number.isFinite);
  return cl.length ? Math.min(...cl) : null;
};

/** Regel-valg til mønster-scenarier: [{cache, stage}] i prioriteret orden. */
export const SCENARIO_RULES = Object.freeze({
  mountainLongestRunIn(candidates) {
    const rows = [];
    for (const c of candidates) {
      if (groupOfCache(c) !== "stage_race") continue;
      for (const p of c.profiles) {
        if (p.profile_type !== "mountain") continue;
        const runIn = firstClimbKm(p);
        if (runIn === null) continue;
        rows.push({ cache: c, stage: p.stage_number, key: [runIn, Number(p.distance_km) || 0] });
      }
    }
    return rows.sort((a, b) => b.key[0] - a.key[0] || b.key[1] - a.key[1] || byString(a.cache.race.id, b.cache.race.id) || a.stage - b.stage);
  },
  flatSprintLongest(candidates) {
    const rows = [];
    for (const c of candidates) {
      if (groupOfCache(c) !== "stage_race") continue;
      for (const p of c.profiles) {
        if (p.profile_type !== "flat" || finishOf(p) !== "sprint") continue;
        rows.push({ cache: c, stage: p.stage_number, key: [Number(p.distance_km) || 0] });
      }
    }
    return rows.sort((a, b) => b.key[0] - a.key[0] || byString(a.cache.race.id, b.cache.race.id) || a.stage - b.stage);
  },
});

/**
 * Scenarierne. Eksisterende (fra en tidligere build) beholdes uændret, medmindre `refresh`.
 * Returnerer { scenarios: [...], files: Map rel -> doc, picks: [{id, raceId, raceName, stage}] }.
 */
export function buildScenarios(candidates, { existing = null, existingFiles = new Map(), refresh = false, defs = SCENARIO_DEFS } = {}) {
  const keep = new Map(refresh ? [] : (existing?.scenarios ?? []).map((s) => [s.id, s]));
  const used = new Set();
  const scenarios = [];
  const files = new Map();
  const picks = [];
  for (const def of defs) {
    if (keep.has(def.id) && existingFiles.has(keep.get(def.id).file)) {
      const s = keep.get(def.id);
      scenarios.push(s);
      files.set(s.file, existingFiles.get(s.file));
      picks.push({ id: def.id, kept: true });
      continue;
    }
    let hit = null;
    if (def.match) {
      const c = candidates.find((x) => x.race.name === def.match.raceName && x.profiles.some((p) => p.stage_number === def.match.stage));
      if (c) hit = { cache: c, stage: def.match.stage };
    } else {
      hit = SCENARIO_RULES[def.rule](candidates).find((r) => !used.has(`${r.cache.race.id}:${r.stage}`)) ?? null;
    }
    if (!hit) { picks.push({ id: def.id, missing: true }); continue; }
    used.add(`${hit.cache.race.id}:${hit.stage}`);
    const alias = `sc-${def.id}`;
    const file = `scenarios/${alias}.json`;
    const profile = hit.cache.profiles.find((p) => p.stage_number === hit.stage);
    const c = stageCellOf({ stageCount: hit.cache.race.stages, raceGroup: groupOfCache(hit.cache), profile });
    scenarios.push({
      id: def.id, issue: def.issue, title: def.title, file, race: alias,
      focusStages: [hit.stage], cell: cellKey(c.group, c.terrain, c.finish),
      runWholeRace: hit.cache.race.stages > 1, selection: def.match ? "match" : `rule:${def.rule}`,
    });
    files.set(file, routeDoc(hit.cache, alias));
    picks.push({ id: def.id, raceId: hit.cache.race.id, raceName: hit.cache.race.name ?? null, stage: hit.stage });
  }
  return { scenarios, files, picks };
}

/**
 * Hele korpusset i hukommelsen. Ren: ingen IO. `intentRates` (valgfri) giver kun en
 * signatur i manifestet; selve satserne skrives privat af main().
 */
export function buildCorpus({ caches, perCell = DEFAULT_PER_CELL, season = "S5", sourceLabel = null, intentRates = null, existingScenarios = null, existingScenarioFiles = new Map(), refreshScenarios = false }) {
  if (!Number.isInteger(perCell) || perCell < 1) throw new Error("--per-cell skal være et heltal >= 1");
  const candidates = corpusCandidates(caches);
  if (!candidates.length) throw new Error("eksporten har ingen senior-løb med gyldige ruter");
  const { raceIds, cells } = selectCorpusRaces(candidates, { perCell });
  const byId = new Map(candidates.map((c) => [c.race.id, c]));
  const groupOrder = ["one_day", "monument", "stage_race", "gt"];
  const ordered = raceIds.map((id) => byId.get(id)).sort((a, b) => groupOrder.indexOf(groupOfCache(a)) - groupOrder.indexOf(groupOfCache(b)) || a.race.stages - b.race.stages || byString(a.race.id, b.race.id));
  const w = Math.max(3, String(ordered.length).length);
  const raceAlias = new Map(ordered.map((c, i) => [c.race.id, `c${pad(i + 1, w)}`]));

  const files = new Map();
  const races = [];
  const cellStages = new Map(cells.map((k) => [k, []]));
  for (const c of ordered) {
    const alias = raceAlias.get(c.race.id);
    const file = `routes/${alias}.json`;
    files.set(file, routeDoc(c, alias));
    races.push({ id: alias, group: groupOfCache(c), stages: c.race.stages, file });
    for (const { stage, cell } of stageCells(c)) cellStages.get(cell).push(`${alias}:${stage}`);
  }
  const { squads, stats } = buildSquads(caches);
  files.set("squads.json", squads);
  const sc = buildScenarios(candidates, { existing: existingScenarios, existingFiles: existingScenarioFiles, refresh: refreshScenarios });
  files.set("scenarios.json", { format: SCENARIOS_FORMAT, note: "Kendte fejl som permanente vagter. Et scenarie fjernes eller skiftes kun bevidst (--refresh-scenarios).", scenarios: sc.scenarios });
  for (const [rel, doc] of sc.files) files.set(rel, doc);

  const manifest = {
    format: CORPUS_FORMAT,
    note: "Realisme-gatens korpus (#7588). Frosne, anonymiserede ruter pr. celle (gruppe|terræn|afslutning), trup-fixture og scenariepakke. Genereret af backend/scripts/dev/buildRealismCorpus.mjs; redigér aldrig i hånden.",
    season,
    squad: CORPUS_SQUAD,
    source: { kind: "motor-testport-export", label: sourceLabel },
    measurementContract: MEASUREMENT_CONTRACT_VERSION,
    perCellTarget: perCell,
    cells: cells.map((k) => ({ cell: k, stages: cellStages.get(k) })),
    races,
    squads: "squads.json",
    scenarios: "scenarios.json",
    breakawayIntent: intentRates ? { source: "private", signature: ratesSignature(intentRates) } : null,
  };
  manifest.contentSignature = contentSignature(files);
  files.set("manifest.json", manifest);
  const privateMap = {
    note: "PRIVAT (hard rule 17): alias -> rigtigt løb for realisme-korpusset.",
    races: ordered.map((c) => ({ alias: raceAlias.get(c.race.id), raceId: c.race.id, name: c.race.name ?? null })),
    scenarios: sc.picks,
    squads: stats,
  };
  return { files, privateMap, stats: { races: ordered.length, stages: ordered.reduce((s, c) => s + c.race.stages, 0), cells: cells.length, ...stats, scenarios: sc.picks } };
}

/** Læs et tidligere korpus' scenarier (så de bevares ved genbygning). */
export function readExistingScenarios(outDir) {
  const f = path.join(outDir, "scenarios.json");
  if (!existsSync(f)) return { existing: null, files: new Map() };
  const existing = JSON.parse(readFileSync(f, "utf8"));
  const files = new Map();
  for (const s of existing.scenarios ?? []) {
    const p = path.join(outDir, s.file);
    if (existsSync(p)) files.set(s.file, JSON.parse(readFileSync(p, "utf8")));
  }
  return { existing, files };
}

/** Skriv korpusset: mappen tømmes for routes/ og scenarios/ først, så intet gammelt bliver hængende. */
export function writeCorpus(outDir, files) {
  for (const sub of ["routes", "scenarios"]) rmSync(path.join(outDir, sub), { recursive: true, force: true });
  for (const [rel, doc] of [...files].sort((a, b) => byString(a[0], b[0]))) {
    const f = path.join(outDir, rel);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, toJson(doc));
  }
}

export function parseArgs(argv) {
  const get = (name, fallback = null) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  const fromDir = get("from-dir");
  if (!fromDir) throw new Error("--from-dir=<eksport med <race_id>/cache.json> kræves");
  const perCell = Number(get("per-cell", String(DEFAULT_PER_CELL)));
  if (!Number.isInteger(perCell) || perCell < 1) throw new Error("--per-cell skal være et heltal >= 1");
  const season = get("season", "S5");
  if (!/^[\w-]+$/.test(season)) throw new Error("--season må kun indeholde bogstaver, tal, - og _");
  return {
    fromDir, perCell, season,
    out: get("out", DEFAULT_OUT),
    intentRates: get("intent-rates", path.join(path.dirname(path.resolve(fromDir)), "breakaway-intent-rates.json")),
    privateDir: get("private-dir", DEFAULT_PRIVATE_DIR),
    refreshScenarios: argv.includes("--refresh-scenarios"),
  };
}

const copenhagenDate = (now = new Date()) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

export async function main(argv = process.argv.slice(2), { log = console.log } = {}) {
  const args = parseArgs(argv);
  const abs = (p) => (path.isAbsolute(p) ? p : path.join(REPO_ROOT, p));
  const fromDir = abs(args.fromDir);
  const outDir = abs(args.out);
  const privateDir = abs(args.privateDir);
  const caches = readExportDir(fromDir);
  const intentRates = existsSync(abs(args.intentRates)) ? validateRates(JSON.parse(readFileSync(abs(args.intentRates), "utf8"))) : null;
  const { existing, files: existingFiles } = readExistingScenarios(outDir);
  const { files, privateMap, stats } = buildCorpus({
    caches, perCell: args.perCell, season: args.season, sourceLabel: path.basename(path.dirname(fromDir)),
    intentRates, existingScenarios: existing, existingScenarioFiles: existingFiles, refreshScenarios: args.refreshScenarios,
  });
  writeCorpus(outDir, files);
  mkdirSync(privateDir, { recursive: true });
  writeFileSync(path.join(privateDir, `corpus-map-${copenhagenDate()}.json`), `${JSON.stringify(privateMap, null, 2)}\n`);
  if (intentRates) writeFileSync(path.join(privateDir, "corpus-intent-rates.json"), `${JSON.stringify(intentRates, null, 2)}\n`);
  // Kun struktur i konsollen (antal løb/celler), aldrig motor- eller generatortal.
  log(`realisme-korpus: ${stats.races} løb, ${stats.cells} celler, ${stats.teams} hold i trup-fixturen -> ${path.relative(REPO_ROOT, outDir)}`);
  for (const p of stats.scenarios) log(`  scenarie ${p.id}: ${p.kept ? "beholdt" : p.missing ? "IKKE FUNDET i eksporten" : `valgt (etape ${p.stage})`}`);
  if (!intentRates) log("  udbrudsvilje-satser: ingen fil fundet; manifestet har ingen signatur (runneren kører da uden menneskeholdenes udbrudsvilje)");
  log(`  privat kort: ${path.relative(REPO_ROOT, privateDir)}`);
  return stats;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  });
}
