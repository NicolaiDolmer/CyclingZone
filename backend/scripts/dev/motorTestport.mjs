#!/usr/bin/env node
// #6750 Motor-testport: én kommando der tester en kandidat-revision af motoren
// mod den aktuelle paa ALLE kommende loeb og laver ét samlet kort.
//
//   1. Finder de kommende loeb (read-only SELECT i prod, eller en eksisterende
//      eksport: en mappe med <race_id>/cache.json som tourDryRun --save-cache skriver).
//   2. Koerer tourDryRun.mjs pr. loeb (baseline OG kandidat, --seeds seeds) som
//      child-processer, --parallel ad gangen. Genoptagelig: et loeb med `done` springes over.
//   3. Koerer S5-motor-benchen (s5MotorBench, --scope=all) under begge revisioner.
//   4. Samler ét kort (testport.md + testport.json + testport.png) med
//      lib/motorTestportReport.mjs.
//
// HARD RULE 17: kortet indeholder maalte tal og loebsnavne og skrives KUN til
// balance-internals/ (gitignoreret). Scriptet aendrer intet i motoren og skriver
// aldrig til prod (kun SELECT).
//
// Koer:
//   infisical run --env=prod --silent -- node backend/scripts/dev/motorTestport.mjs --candidate=<revision>
//   node backend/scripts/dev/motorTestport.mjs --candidate=<rev> --from-dir=<mappe med <id>/cache.json> --limit=5
//   node backend/scripts/dev/motorTestport.mjs --candidate=<rev> --report-only --out=<tidligere out>
//
// Flag:
//   --candidate=<rev>        revisionen der testes (kraeves)
//   --baseline=<rev>         default: den aktuelle (CURRENT_RACE_RULES_REVISION)
//   --seeds=<n>              seeds pr. revision pr. loeb (default 8)
//   --parallel=<n>           child-processer ad gangen (default 4)
//   --out=<dir>              default balance-internals/<issue>/<dato>/ (dansk dato)
//   --issue=<n>              mappe-navnet i default --out (default 6750)
//   --limit=<n>              kun de foerste n loeb (roegtest)
//   --races=<id,id>          kun disse loeb · --ids-file=<fil> ét id pr. linje
//   --from-dir=<dir>         eksisterende eksport i stedet for prod
//   --include-running        ogsaa loeb hvor foerste etape er koert (default: kun ikke-startede)
//   --no-bench               spring S5-benchen over · --bench-only kun benchen
//   --bench-scope=<s>        default all (gate, gt, all)
//   --report-only            koer intet, saml kortet fra --out
//   --no-png                 spring PNG-kortet over
//   --season=<n>             kun loeb i saeson n (prod-listen)
//   --synthetic-field[=generator|bench]  loeb uden tilmeldinger faar et felt i hukommelsen
//                            (generator = tilmeldingsgeneratoren som dry-run paa nuvaerende
//                            trupper; bench = det anonymiserede Giro-felt). #6909
//   --routes-from=<dir>      foreslaaede ruter (cz-race-routes/v1, se docs/MOTOR_TESTPORT.md)
//                            i stedet for prod's etapeprofiler; default-udvaelgelse = mappens loeb. #6909
//   --breakaway-intent=<prod|none>  syntetisk felt: menneskeholdenes udbrudsvilje som i prod
//                            (default prod med --synthetic-field; none = intet, som foer). #6804 P0
//   --intent-rates=<fil>     satserne fra en tidligere koersel (breakaway-intent-rates.json);
//                            kraeves med --from-dir, ellers laeses de read-only fra prod. #6804 P0
//   --intent-season=<n>      satserne fra saeson n (default: seneste afsluttede). #6804 P0
//   --track-fatigue          traethed og form mellem etaperne (#6984-modellen), saa G17 ogsaa
//                            giver G17 realistisk traethed mellem etaperne (og sygdom, naar den bygges). #6938
//   --time-budget=<min>      start ingen nye opgaver efter <min> minutter; koer samme kommando
//                            igen for at genoptage (lange koersler i korte, forgrunds-bidder). #6909
//
// Refs #6750 #6909
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { benchView, buildTestportCard, copenhagenDate, raceResultFromDryRun, renderTestportHtml, renderTestportMarkdown } from "./lib/motorTestportReport.mjs";
import { SYNTHETIC_KINDS, assertRoutesCover, createProdSource, loadRoutesDir, prepareInputs } from "./lib/motorTestportInputs.mjs";
import { raceContextFromCache } from "./lib/v3Gates.mjs";
import { isMountainNonSummit } from "./lib/tourScorecard.mjs";
import { INTENT_MODES, ratesSignature, validateRates } from "./lib/breakawayIntent.mjs";
import { raceGroupOf, routeFavourites } from "./lib/raceGroupGates.mjs"; // #7214
import { suitabilityScore } from "../../lib/raceAutopick.js"; // #7214: spillets egnethed (favoritter til ruten)

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..", "..", "..");
const SELF = fileURLToPath(import.meta.url);
const TOUR_DRY_RUN = path.join(here, "tourDryRun.mjs");
const abs = (p) => (path.isAbsolute(p) ? p : path.join(REPO_ROOT, p));

/** Parse CLI-argumenterne (rent, testbart). `defaultBaseline` injiceres (den aktuelle revision). */
export function parseArgs(argv, { defaultBaseline = null, now = new Date() } = {}) {
  const get = (name, fallback = null) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  const flag = (name) => argv.includes(`--${name}`);
  const int = (name, fallback, min = 1) => {
    const v = Number(get(name, String(fallback)));
    if (!Number.isInteger(v) || v < min) throw new Error(`--${name} skal vaere et heltal >= ${min}`);
    return v;
  };
  const benchWorker = flag("bench-worker");
  const candidate = get("candidate");
  if (!benchWorker && !candidate && !flag("report-only")) throw new Error("--candidate=<revision> kraeves");
  const baseline = get("baseline", defaultBaseline);
  if (!benchWorker && !baseline && !flag("report-only")) throw new Error("--baseline=<revision> kraeves (den aktuelle revision kunne ikke laeses)");
  const issue = get("issue", "6750");
  if (!/^[\w-]+$/.test(issue)) throw new Error("--issue maa kun indeholde bogstaver, tal, - og _");
  const benchScope = get("bench-scope", get("scope", "all"));
  if (!["gate", "gt", "all"].includes(benchScope)) throw new Error("--bench-scope skal vaere gate, gt eller all");
  const limit = get("limit") === null ? null : int("limit", 1);
  // #6909: --synthetic-field (= generator) eller --synthetic-field=bench|generator.
  const syntheticRaw = flag("synthetic-field") ? "generator" : get("synthetic-field");
  if (syntheticRaw !== null && !SYNTHETIC_KINDS.includes(syntheticRaw)) throw new Error(`--synthetic-field skal vaere ${SYNTHETIC_KINDS.join(" eller ")}`);
  const season = get("season") === null ? null : int("season", 1);
  // #6804 P0 (ejer 21/10): et syntetisk felt faar som standard menneskeholdenes udbrudsvilje fra prod.
  // Review P2: kun generator-feltet har menneskehold; bench-feltet er lutter AI-hold (udbrudsvilje virker ikke dér).
  const breakawayIntent = get("breakaway-intent", syntheticRaw === "generator" ? "prod" : "none");
  if (!INTENT_MODES.includes(breakawayIntent)) throw new Error(`--breakaway-intent skal vaere ${INTENT_MODES.join(" eller ")}`);
  if (breakawayIntent === "prod" && syntheticRaw !== "generator") throw new Error("--breakaway-intent=prod kraever --synthetic-field=generator (prod-tilmeldinger har deres egne ordrer, bench-feltet har kun AI-hold)");
  return {
    candidate, baseline,
    seeds: int("seeds", 8),
    parallel: int("parallel", 4),
    issue,
    out: get("out", path.join("balance-internals", issue, copenhagenDate(now))),
    limit,
    raceIds: get("races") ? get("races").split(",").map((s) => s.trim()).filter(Boolean) : null,
    idsFile: get("ids-file"),
    fromDir: get("from-dir"),
    includeRunning: flag("include-running"),
    bench: !flag("no-bench"),
    benchOnly: flag("bench-only"),
    benchScope,
    reportOnly: flag("report-only"),
    // #6750 (Codex): balance-taersklerne (fx "stort forspring") staar i en privat
    // fil, aldrig i det offentlige repo (hard rule 17).
    thresholds: get("thresholds", path.join("balance-internals", "motor-testport-thresholds.json")),
    thresholdsExplicit: get("thresholds") !== null,
    png: !flag("no-png"),
    benchWorker,
    revision: get("revision"),
    syntheticField: syntheticRaw,
    breakawayIntent,
    intentRates: get("intent-rates"),
    intentSeason: get("intent-season") === null ? null : int("intent-season", 1),
    routesFrom: get("routes-from"),
    season,
    timeBudgetMin: get("time-budget") === null ? null : int("time-budget", 1),
    trackFatigue: flag("track-fatigue"),
  };
}

/** Unikke, ikke-tomme id'er i raekkefoelge, evt. begraenset til `limit`. */
export function selectRaceIds(ids, limit = null) {
  const seen = [...new Set(ids.map((s) => String(s).trim()).filter(Boolean))];
  return limit ? seen.slice(0, limit) : seen;
}

/** En ids-fil: ét id pr. linje (eller adskilt af mellemrum/komma); # er kommentar. */
export function parseIdsText(text) {
  return String(text).split(/\r?\n/).map((l) => l.replace(/#.*/, "")).flatMap((l) => l.split(/[\s,]+/)).filter(Boolean);
}

/** Loeb i en eksisterende eksport: undermapper med cache.json. */
export function raceIdsFromDir(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(dir, d.name, "cache.json")))
    .map((d) => d.name)
    .sort();
}

/** Service-role-klient til prod. Bruges KUN til SELECT (generatoren faar readOnlyDb). */
export async function prodDb() {
  const { createClient } = await import("@supabase/supabase-js");
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY (infisical run --env=prod), eller brug --from-dir/--races/--ids-file");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
}

/**
 * De kommende loeb i prod (READ-ONLY: kun SELECT). Default: ikke afsluttede og
 * ikke startede (ingen etape koert), dvs. de loeb en ny revision binder til.
 * #6909: `season` begraenser til én saeson (nummer); `keepNoField` beholder loeb
 * uden startfelt (de faar et syntetisk felt), men de taelles stadig.
 */
export async function listUpcomingRaceIds({ includeRunning = false, season = null, keepNoField = false } = {}) {
  const db = await prodDb();
  const ids = [];
  const PAGE = 1000;
  let seasonId = null;
  if (season !== null) {
    const { data, error } = await db.from("seasons").select("id").eq("number", season).maybeSingle();
    if (error) throw new Error(`seasons: ${error.message}`);
    if (!data) throw new Error(`Saeson ${season} findes ikke`);
    seasonId = data.id;
  }
  // pagination-safe: .range() i sider af PAGE til en kort side
  for (let from = 0; ; from += PAGE) {
    let q = db.from("races").select("id, scheduled_for, stages_completed").neq("status", "completed");
    if (seasonId) q = q.eq("season_id", seasonId);
    if (!includeRunning) q = q.or("stages_completed.is.null,stages_completed.eq.0");
    const { data, error } = await q.order("scheduled_for", { ascending: true }).order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`races: ${error.message}`);
    ids.push(...(data ?? []).map((r) => r.id));
    if (!data || data.length < PAGE) break;
  }
  // #6805: et loeb uden startfelt (ingen race_entries endnu, fx S5 foer
  // tilmelding) kan ikke koeres og er ikke en motorfejl. Det springes over og
  // taelles paa kortet i stedet for at staa som FEJL.
  const withField = new Set();
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    // pagination-safe: .range() i sider, da et loeb kan have mange tilmeldinger
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db.from("race_entries").select("race_id").in("race_id", chunk).order("race_id", { ascending: true }).range(from, from + PAGE - 1);
      if (error) throw new Error(`race_entries: ${error.message}`);
      for (const row of data ?? []) withField.add(row.race_id);
      if (!data || data.length < PAGE) break;
    }
  }
  const split = splitByStartField(ids, withField);
  return keepNoField ? { ...split, ids } : split;
}

/** #6805: del loebene i dem med startfelt og dem uden (rent, testbart). Raekkefoelgen bevares. */
export function splitByStartField(ids, withField) {
  const kept = ids.filter((id) => withField.has(id));
  return { ids: kept, skippedNoField: ids.length - kept.length };
}

/**
 * Argumenterne til tourDryRun.mjs for ét loeb. Samme revision = én koersel
 * (--compare=none). En eksisterende eksport laeses kun (ingen --save-cache);
 * ellers hentes loebet én gang og gemmes i loebsmappen til genkoersler.
 */
export function tourDryRunArgs({ raceId, candidate, baseline, seeds, raceDir, cachePath, saveCache = true, trackFatigue = false }) {
  return [
    TOUR_DRY_RUN, `--race=${raceId}`, `--revision=${candidate}`, `--compare=${candidate === baseline ? "none" : baseline}`,
    `--seeds=${seeds}`, "--no-legacy-ref", `--cache=${cachePath}`, ...(saveCache ? [`--save-cache=${cachePath}`] : []), `--out-dir=${raceDir}`,
    ...(trackFatigue ? ["--track-fatigue"] : []),
  ];
}

/** Opgaverne (loeb + bench) for en koersel. Opgaver med `done` er sprunget over (genoptagelse). */
export function planTasks({ raceIds, opts, outDir, fromDir = null, prebuilt = new Set() }) {
  const tasks = [];
  if (!opts.benchOnly) {
    for (const raceId of raceIds) {
      const dir = path.join(outDir, "races", raceId);
      // #6909: en forbygget cache.json (syntetisk felt / foreslaaede ruter) i loebsmappen
      // vinder over eksporten og laeses kun.
      const isPrebuilt = prebuilt.has(raceId);
      const exported = fromDir && !isPrebuilt ? path.join(fromDir, raceId, "cache.json") : null;
      const fromExport = Boolean(exported && existsSync(exported));
      const cachePath = fromExport ? exported : path.join(dir, "cache.json");
      tasks.push({ kind: "race", id: raceId, dir, args: tourDryRunArgs({ raceId, candidate: opts.candidate, baseline: opts.baseline, seeds: opts.seeds, raceDir: dir, cachePath, saveCache: !fromExport && !isPrebuilt, trackFatigue: opts.trackFatigue === true }) });
    }
  }
  if (opts.bench) {
    for (const revision of [...new Set([opts.baseline, opts.candidate])]) {
      const dir = path.join(outDir, "bench", revision);
      tasks.push({ kind: "bench", id: `bench:${revision}`, dir, args: [SELF, "--bench-worker", `--revision=${revision}`, `--scope=${opts.benchScope}`, `--out=${dir}`] });
    }
  }
  return tasks.map((t) => ({ ...t, done: existsSync(path.join(t.dir, "done")) }));
}

/**
 * Koerer `tasks` med hoejst `parallel` ad gangen. `run(task)` -> Promise<exitkode>.
 * Returnerer {ok, failed} (id'er). En fejl stopper ikke de andre.
 */
export async function runPool(tasks, parallel, run, { onDone = null, shouldStop = () => false } = {}) {
  const queue = tasks.slice();
  const ok = [];
  const failed = [];
  const worker = async () => {
    // #6909: shouldStop (tidsbudget) starter ingen nye opgaver; de koerende goeres faerdige.
    while (queue.length && !shouldStop()) {
      const t = queue.shift();
      let code;
      try { code = await run(t); } catch (err) { code = 1; t.error = String(err?.message ?? err); }
      (code === 0 ? ok : failed).push(t.id);
      onDone?.(t, code, { ok: ok.length, failed: failed.length, total: tasks.length });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, tasks.length)) }, worker));
  return { ok, failed, pending: queue.map((t) => t.id) };
}

/** Child-proces med log til <dir>/log.txt og `done` ved exit 0. */
function runChild(task) {
  mkdirSync(task.dir, { recursive: true });
  const fd = openSync(path.join(task.dir, "log.txt"), "w");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, task.args, { cwd: REPO_ROOT, env: process.env, stdio: ["ignore", fd, fd] });
    child.on("error", () => { closeSync(fd); resolve(1); });
    child.on("close", (code) => {
      closeSync(fd);
      if (code === 0) writeFileSync(path.join(task.dir, "done"), `${new Date().toISOString()}\n`);
      resolve(code ?? 1);
    });
  });
}

/** Den nyeste tourDryRun-JSON i en loebsmappe (navnene ender paa -YYYY-MM-DD-HH-MM.json). */
export function latestDryRunJson(dir) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "cache.json");
  if (!files.length) return null;
  files.sort((a, b) => statSync(path.join(dir, a)).mtimeMs - statSync(path.join(dir, b)).mtimeMs || a.localeCompare(b));
  return path.join(dir, files[files.length - 1]);
}

/**
 * Hard rule 17: maalte tal og loebsdata maa kun skrives under en mappe der
 * hedder balance-internals (gitignoreret i repoet, privat i OneDrive-context).
 */
export function assertPrivateOutDir(dir) {
  const segments = path.resolve(dir).split(/[\\/]+/);
  if (!segments.includes("balance-internals")) throw new Error(`--out skal ligge under en balance-internals/-mappe (hard rule 17): ${dir}`);
  return dir;
}

/**
 * Saml kortet fra en out-mappe. De forventede loeb er ids.txt (hvis den findes);
 * et forventet loeb uden et laesbart scorecard er en FEJL paa kortet
 * (`missingScorecards`), aldrig et stille mindre datasaet.
 */
/** Private balance-taerskler for kortet. Mangler filen, er de maalinger null. */
export function loadThresholds(file) {
  if (!file || !existsSync(file)) {
    console.warn(`motor-testport: ingen privat taerskelfil (${file}); maalinger der kraever den vises som "-".`);
    return {};
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * #6804 P0 (Codex P1): graensen for smaa celler i udbrudsvilje-satserne er privat (hard rule 17)
 * og har intet offentligt default. Mangler filen eller noeglen, stopper koerslen (fail closed).
 */
export function privateMinCellTeamStages(file) {
  const v = file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).breakawayIntentMinCellTeamStages : undefined;
  if (!Number.isFinite(v) || v < 0) {
    throw new Error(`udbrudsvilje-satser fra prod kraever breakawayIntentMinCellTeamStages (tal >= 0) i den private taerskelfil (${file}); eller giv --intent-rates=<fil>`);
  }
  return v;
}

/**
 * #6750 (Codex): en output-mappe tilhoerer EN loebsudvaelgelse. Genoptagelse med
 * samme loeb er ok; et andet saet ville blande gamle scorecards ind i kortet.
 */
export function assertSameRaceSelection(previousIds, nextIds, outDir) {
  if (!previousIds || previousIds.length === 0) return;
  const a = [...new Set(previousIds)].sort().join(",");
  const b = [...new Set(nextIds)].sort().join(",");
  if (a !== b) throw new Error(`${outDir} er koert med en anden loebsudvaelgelse (${previousIds.length} loeb mod ${nextIds.length}). Brug en ny --out.`);
}

/**
 * #6777: --report-only bruger de taerskler koerslen gemte i testport-meta.json (fil + snapshot),
 * saa et kort ikke aendrer sig fordi standardfilen er blevet rettet siden. Et eksplicit
 * --thresholds=<fil> vinder; meta uden snapshot (aeldre koersler) falder tilbage til filen.
 */
/**
 * #6777 (Codex): stien der faktisk blev brugt. Ved genoptagelse uden eksplicit
 * --thresholds beholdes den gemte sti, ikke default-stien.
 */
export function resolveThresholdsFile(prev, opts) {
  if (opts?.thresholdsExplicit || !prev) return opts?.thresholds ?? null;
  return prev.thresholdsFile ?? opts?.thresholds ?? null;
}

export function resolveReportThresholds(prev, opts) {
  if (opts.thresholdsExplicit) return loadThresholds(abs(opts.thresholds));
  if (prev?.thresholds && typeof prev.thresholds === "object") return prev.thresholds;
  return loadThresholds(abs(prev?.thresholdsFile ?? opts.thresholds));
}

/**
 * #6794: meta til et --report-only-kort. Bygges i hukommelsen og skrives aldrig til
 * testport-meta.json. thresholdsFile/thresholds foelger de taerskler kortet faktisk
 * er regnet med (et eksplicit --thresholds=<fil> vinder over de gemte), og
 * generatedAt stemples fra det injicerede ur.
 */
export function buildReportMeta(prev, opts, thresholds, now = new Date()) {
  return { ...prev, thresholdsFile: resolveThresholdsFile(prev, opts), thresholds, generatedAt: now.toISOString() };
}

/**
 * En out-mappe tilhoerer én koersel: samme revisioner, seeds, bench-scope og (#6909)
 * samme input (syntetisk felt, rute-mappe, saeson). Aeldre meta uden de felter = null.
 */
export function assertSameRun(prev, opts, outDir) {
  if (!prev) return;
  const same = prev.candidate === opts.candidate && prev.baseline === opts.baseline && prev.seeds === opts.seeds
    && (prev.benchScope ?? "all") === opts.benchScope
    && (prev.syntheticField ?? null) === (opts.syntheticField ?? null)
    && (prev.breakawayIntent?.mode ?? "none") === (opts.breakawayIntent ?? "none")
    && (prev.routesFrom ?? null) === (opts.routesFrom ?? null)
    && (prev.routesSignature ?? null) === (opts.routesSignature ?? null)
    && (prev.season ?? null) === (opts.season ?? null)
    // #6938 (Codex P2): med/uden traethed mellem etaperne er to forskellige koersler; aeldre meta = uden.
    && (prev.trackFatigue === true) === (opts.trackFatigue === true);
  if (!same) {
    const input = [prev.syntheticField ? `syntetisk felt ${prev.syntheticField}` : null, prev.routesFrom ? `ruter ${prev.routesFrom}` : null, prev.season ? `saeson ${prev.season}` : null, prev.trackFatigue === true ? "med traethed" : null].filter(Boolean);
    throw new Error(`${outDir} er en anden koersel (${prev.baseline} -> ${prev.candidate}, ${prev.seeds} seeds, bench ${prev.benchScope}${input.length ? `, ${input.join(", ")}` : ""}). Brug en ny --out.`);
  }
}

/**
 * #6804/#2757: loebskonteksten til v3-gaterne og S0 (startliste, roller, sprint-
 * rang, etaper) fra loebets cache.json: loebsmappens egen (forbygget/gemt) foerst,
 * ellers eksportens (`cacheDir`). Et loeb uden laesbar cache faar ingen kontekst
 * (gaterne der kraever den er da MANGLER, aldrig gaettet).
 */
export function loadRaceContexts({ outDir, raceIds, cacheDir = null }) {
  const contexts = new Map();
  for (const id of raceIds) {
    const candidates = [path.join(outDir, "races", id, "cache.json"), ...(cacheDir ? [path.join(cacheDir, id, "cache.json")] : [])];
    const file = candidates.find((f) => existsSync(f));
    if (!file) continue;
    try {
      const cache = JSON.parse(readFileSync(file, "utf8"));
      const ctx = raceContextFromCache(cache, { isMountainNonSummit });
      if (ctx) {
        // #7214: loebsgruppe med monumenter + favoritterne til ruten. ctx.group (v3-gaterne) er uaendret.
        ctx.raceClass = cache.race?.race_class ?? null;
        ctx.raceGroup = raceGroupOf({ stages: ctx.stages, raceClass: ctx.raceClass });
        ctx.favourites = routeFavourites(cache, { suitability: suitabilityScore });
        contexts.set(id, ctx);
      }
    } catch (err) {
      console.warn(`motor-testport: cache for ${id} kunne ikke laeses (${err.message}); loebet faar ingen kontekst til v3-gaterne/S0.`);
    }
  }
  return contexts;
}

export function collectCard({ outDir, baseline, candidate, meta, benchScope = meta?.benchScope ?? "all", thresholds = {} }) {
  const racesDir = path.join(outDir, "races");
  const idsFile = path.join(outDir, "ids.txt");
  const expected = existsSync(idsFile) ? parseIdsText(readFileSync(idsFile, "utf8")) : [];
  const present = existsSync(racesDir) ? readdirSync(racesDir).sort() : [];
  const raceResults = [];
  const missingScorecards = [];
  for (const id of [...new Set([...expected, ...present])]) {
    const file = latestDryRunJson(path.join(racesDir, id));
    if (!file) { missingScorecards.push(`${id} (intet scorecard)`); continue; }
    try {
      const rr = raceResultFromDryRun(JSON.parse(readFileSync(file, "utf8")));
      if (rr) raceResults.push(rr);
      else missingScorecards.push(`${id} (tomt scorecard)`);
    } catch (err) {
      missingScorecards.push(`${id} (${err.message})`);
    }
  }
  const benchByRevision = {};
  for (const revision of [...new Set([baseline, candidate])]) {
    const file = path.join(outDir, "bench", revision, `motor-bench-${benchScope}.json`);
    if (existsSync(file)) benchByRevision[revision] = benchView(JSON.parse(readFileSync(file, "utf8")));
  }
  const contexts = loadRaceContexts({ outDir, raceIds: raceResults.map((r) => r.raceId).filter(Boolean), cacheDir: meta?.cacheDir ?? null });
  return buildTestportCard({ raceResults, baseline, candidate, benchByRevision, meta: { ...meta, missingScorecards }, thresholds, contexts });
}

/** PNG af kortets overblik via Playwright fra frontend/node_modules. Best-effort. */
async function renderPng(html, file) {
  const pw = path.join(REPO_ROOT, "frontend", "node_modules", "@playwright", "test", "index.mjs");
  if (!existsSync(pw)) return "Playwright findes ikke i frontend/node_modules";
  const { chromium } = await import(pathToFileURL(pw).href);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 2 });
    await page.setContent(html);
    await page.screenshot({ path: file, fullPage: true });
  } finally {
    await browser.close();
  }
  return null;
}

/** --bench-worker: S5-motor-benchen under én revision (child-proces). */
async function benchWorker(opts) {
  if (!opts.revision) throw new Error("--bench-worker kraever --revision");
  const { buildS5BenchRaces, runS5MotorBench, summarizeS5MotorBench, renderS5MotorBenchMarkdown, loadWinnerThresholds, S5_MOTOR_BENCH_CONFIG } = await import("./s5MotorBench.mjs");
  const { loadS5Benchmark } = await import("../../lib/s5BenchmarkGate.js");
  const config = { ...S5_MOTOR_BENCH_CONFIG, revision: opts.revision };
  const dir = assertPrivateOutDir(abs(opts.out));
  const t0 = performance.now();
  const rows = await runS5MotorBench({ races: buildS5BenchRaces({ scope: opts.benchScope }), revision: opts.revision });
  const summary = summarizeS5MotorBench(rows, loadS5Benchmark());
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `motor-bench-${opts.benchScope}.json`), JSON.stringify({ config, scope: opts.benchScope, summary, rows }, null, 2));
  writeFileSync(path.join(dir, `motor-bench-${opts.benchScope}.md`), renderS5MotorBenchMarkdown(summary, { scope: opts.benchScope, config, thresholds: loadWinnerThresholds() }));
  console.log(`${rows.length} etape-koersler paa ${((performance.now() - t0) / 1000).toFixed(1)} s (${opts.revision})`);
}

async function defaultBaseline() {
  try {
    const { CURRENT_RACE_RULES_REVISION } = await import("../../lib/raceEngineRulesRevision.ts");
    return CURRENT_RACE_RULES_REVISION;
  } catch {
    return null;
  }
}

/**
 * #6794: uret kan injiceres. `now` er starttidspunktet (default-out-datoen);
 * `clock` stempler generatedAt naar kortet bygges, saa en lang koersel ikke
 * faar starttiden paa kortet. Gives kun `now`, bruger kortet samme tid, saa en
 * test kan fastlaase begge. `defaultBaseline` kan injiceres
 * af samme grund (default: den aktuelle revision).
 */
/**
 * #6909 (Codex P1): tidsbudgettets stop-tjek. Maaler forbrugt tid paa et monotont ur
 * (default performance.now), som kan injiceres, saa en test styrer praecist hvilke
 * opgaver der bliver ventende. Uden budget stoppes aldrig.
 */
export function budgetStop(timeBudgetMin, monotonic = () => performance.now()) {
  if (!timeBudgetMin) return () => false;
  const stopAt = monotonic() + timeBudgetMin * 60_000;
  return () => monotonic() >= stopAt;
}

export async function main(argv = process.argv.slice(2), { now, clock, monotonic, defaultBaseline: baselineOverride } = {}) {
  const stamp = clock ?? (now ? () => now : () => new Date());
  now ??= stamp();
  let opts = parseArgs(argv, { defaultBaseline: baselineOverride ?? await defaultBaseline(), now });
  if (opts.benchWorker) return benchWorker(opts);
  const outDir = assertPrivateOutDir(abs(opts.out));
  const metaFile = path.join(outDir, "testport-meta.json");
  const prev = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, "utf8")) : null;
  if (opts.reportOnly) {
    // Kortet samles igen med koerslens EGNE parametre; meta-filen roeres ikke.
    if (!prev) throw new Error(`--report-only: ${metaFile} findes ikke`);
    const thresholds = resolveReportThresholds(prev, opts);
    const card = collectCard({ outDir, baseline: prev.baseline, candidate: prev.candidate, meta: buildReportMeta(prev, opts, thresholds, stamp()), thresholds });
    return writeCard({ card, outDir, png: opts.png, failed: prev.failedRaces ?? [] });
  }
  // #6909 (Codex P2): ruterne valideres og fingeraftrykkes FOER sammenligningen med en tidligere koersel.
  const routesEarly = !opts.benchOnly && opts.routesFrom ? loadRoutesDir(abs(opts.routesFrom)) : null;
  if (routesEarly) opts = { ...opts, routesSignature: routesEarly.signature };
  assertSameRun(prev, opts, outDir);
  mkdirSync(outDir, { recursive: true });
  // #6909 (Codex P2): uret starter foer forberedelsen (prod-laesning, syntetisk felt, ruter),
  // saa --time-budget daekker hele kaldet, ikke kun opgaverne bagefter.
  const shouldStop = budgetStop(opts.timeBudgetMin, monotonic);

  let source = prev?.source ?? null;
  let raceIds = [];
  let inputs = { prebuilt: new Set(), field: prev?.field ?? null, routes: prev?.routes ?? null };
  let breakawayIntentMeta = prev?.breakawayIntent ?? null;
  const fromDir = opts.fromDir ? abs(opts.fromDir) : null;
  if (!opts.benchOnly) {
    // #6909: foreslaaede ruter valideres i sin helhed foer noget koeres.
    const routes = routesEarly;
    if (opts.raceIds) { raceIds = opts.raceIds; source = "--races"; }
    else if (opts.idsFile) { raceIds = parseIdsText(readFileSync(abs(opts.idsFile), "utf8")); source = `--ids-file ${path.basename(opts.idsFile)}`; }
    else if (routes) { raceIds = [...routes.byRace.keys()]; source = `--routes-from ${path.basename(routes.dir)}`; }
    else if (fromDir) { raceIds = raceIdsFromDir(fromDir); source = `--from-dir ${path.basename(fromDir)}`; }
    else {
      const upcoming = await listUpcomingRaceIds({ includeRunning: opts.includeRunning, season: opts.season, keepNoField: Boolean(opts.syntheticField) });
      raceIds = upcoming.ids;
      const what = `${opts.includeRunning ? "prod (ikke afsluttede)" : "prod (ikke startede)"}${opts.season ? `, saeson ${opts.season}` : ""}`;
      const noField = opts.syntheticField ? `, ${upcoming.skippedNoField} uden startfelt faar syntetisk felt` : `, ${upcoming.skippedNoField} uden startfelt sprunget over`;
      source = `${what}${upcoming.skippedNoField ? noField : ""}`;
      if (upcoming.skippedNoField && !opts.syntheticField) console.log(`${upcoming.skippedNoField} kommende loeb har intet startfelt endnu og koeres ikke (#6805; --synthetic-field giver dem et felt).`);
    }
    raceIds = selectRaceIds(raceIds, opts.limit);
    if (routes) assertRoutesCover(raceIds, routes);
    // #6909 (Codex P2): en aendret udvaelgelse afvises FOER der skrives caches/loebsmapper, saa
    // en forkert genoptagelse ikke efterlader mapper uden scorekort i --out.
    const selectedPath = path.join(outDir, "selected-ids.txt");
    if (prev && existsSync(selectedPath)) assertSameRaceSelection(parseIdsText(readFileSync(selectedPath, "utf8")), raceIds, outDir);
    writeFileSync(selectedPath, `${raceIds.join("\n")}\n`);
    if (routes || opts.syntheticField) {
      const offline = { benchField: async () => (await import("./s5MotorBench.mjs")).loadBenchField(), generatorField: async () => { throw new Error("--synthetic-field=generator kraever prod (infisical run --env=prod), ikke --from-dir"); } };
      const src = fromDir ? offline : createProdSource(await prodDb());
      // #6804 P0: satserne for menneskeholdenes udbrudsvilje (fil, ellers read-only fra prod), gemt i --out.
      let intent = null;
      if (opts.breakawayIntent === "prod") {
        const ratesPath = path.join(outDir, "breakaway-intent-rates.json");
        const rates = opts.intentRates
          ? validateRates(JSON.parse(readFileSync(abs(opts.intentRates), "utf8")))
          : existsSync(ratesPath) ? validateRates(JSON.parse(readFileSync(ratesPath, "utf8")))
            : fromDir ? (() => { throw new Error("--from-dir med --breakaway-intent=prod kraever --intent-rates=<fil> (eller --breakaway-intent=none)"); })()
              : await src.breakawayIntentRates({ now, seasonNumber: opts.intentSeason,
                // Hard rule 17: graensen for smaa celler er privat (taerskelfilen), aldrig i koden.
                minCellTeamStages: privateMinCellTeamStages(abs(opts.thresholds)) });
        // Review P2: en valgt saeson skal passe med satserne (fil eller gemte satser i --out).
        if (opts.intentSeason !== null && rates.seasonNumber !== opts.intentSeason) {
          throw new Error(`--intent-season=${opts.intentSeason} passer ikke med satserne (saeson ${rates.seasonNumber ?? "ukendt"}); brug en ny --out eller den rigtige --intent-rates`);
        }
        const signature = ratesSignature(rates);
        // Codex P2: andre satser end en genoptaget koersels er en anden koersel (dens done-markoerer gaelder de gamle).
        if (prev?.breakawayIntent?.signature && prev.breakawayIntent.signature !== signature) {
          throw new Error(`${outDir} er en anden koersel (andre udbrudsvilje-satser end ${prev.breakawayIntent.signature}). Brug en ny --out.`);
        }
        writeFileSync(ratesPath, JSON.stringify(rates, null, 2));
        intent = { rates, signature };
        breakawayIntentMeta = { mode: "prod", signature: intent.signature, seasonId: rates.seasonId ?? null, ratesFile: path.basename(ratesPath) };
      }
      inputs = await prepareInputs({ raceIds, outDir, fromDir, routes, synthetic: opts.syntheticField, source: src, intent });
      if (inputs.field?.skippedNoField) console.log(`${inputs.field.skippedNoField} loeb fik intet startfelt og koeres ikke.`);
      raceIds = inputs.ids;
    }
    const idsPath = path.join(outDir, "ids.txt");
    if (prev && existsSync(idsPath)) assertSameRaceSelection(parseIdsText(readFileSync(idsPath, "utf8")), raceIds, outDir);
    writeFileSync(idsPath, `${raceIds.join("\n")}\n`);
  }
  const thresholds = prev ? resolveReportThresholds(prev, opts) : loadThresholds(abs(opts.thresholds));
  const meta = {
    candidate: opts.candidate, baseline: opts.baseline, seeds: opts.seeds, parallel: opts.parallel, source, limit: opts.limit ?? prev?.limit ?? null, benchScope: opts.benchScope, thresholdsFile: resolveThresholdsFile(prev, opts), thresholds,
    syntheticField: opts.syntheticField, breakawayIntent: breakawayIntentMeta ?? { mode: opts.breakawayIntent ?? "none" }, routesFrom: opts.routesFrom, routesSignature: opts.routesSignature ?? null, season: opts.season, trackFatigue: opts.trackFatigue === true, field: inputs.field, routes: inputs.routes,
    // #6804/#2757: eksportens mappe, saa kortet (ogsaa --report-only) finder loebenes cache.json.
    cacheDir: fromDir ?? prev?.cacheDir ?? null,
  };
  writeFileSync(metaFile, JSON.stringify(meta, null, 2));

  const tasks = planTasks({ raceIds, opts, outDir, fromDir, prebuilt: inputs.prebuilt });
  const todo = tasks.filter((t) => !t.done);
  console.log(`${tasks.length} opgaver (${tasks.length - todo.length} allerede faerdige), ${opts.parallel} ad gangen: ${opts.baseline} -> ${opts.candidate}, ${opts.seeds} seeds`);
  const res = await runPool(todo, opts.parallel, runChild, {
    onDone: (t, code, p) => console.log(`[${p.ok + p.failed}/${p.total}] ${t.id}: ${code === 0 ? "ok" : `FEJL (exit ${code}, se ${path.relative(REPO_ROOT, path.join(t.dir, "log.txt"))})`}`),
    shouldStop,
  });
  if (res.pending.length) console.log(`Tidsbudget naaet: ${res.pending.length} opgaver venter. Koer samme kommando igen for at genoptage.`);
  meta.failedRaces = res.failed;
  // #6909 (Codex): opgaver tidsbudgettet ikke naaede (ogsaa bench), saa kortet og
  // --report-only ved at koerslen er ufaerdig.
  meta.pendingTasks = res.pending;
  writeFileSync(metaFile, JSON.stringify(meta, null, 2));
  const card = collectCard({ outDir, baseline: opts.baseline, candidate: opts.candidate, meta: { ...meta, generatedAt: stamp().toISOString() }, thresholds });
  return writeCard({ card, outDir, png: opts.png, failed: res.failed });
}

/** Skriv kortet (md + json + evt. png). Fejlede, ventende opgaver eller manglende scorecards = exit 1. */
async function writeCard({ card, outDir, png, failed }) {
  const pending = card.meta?.pendingTasks ?? [];
  writeFileSync(path.join(outDir, "testport.json"), JSON.stringify(card, null, 2));
  writeFileSync(path.join(outDir, "testport.md"), renderTestportMarkdown(card));
  if (png) {
    try {
      const why = await renderPng(renderTestportHtml(card), path.join(outDir, "testport.png"));
      if (why) console.warn(`PNG sprunget over: ${why}`);
    } catch (err) {
      console.warn(`PNG sprunget over: ${err.message}`);
    }
  }
  const missing = card.meta?.missingScorecards ?? [];
  console.log(`Kort: ${path.join(outDir, "testport.md")} (+ .json${png ? ", .png" : ""}) · ${card.races} loeb${failed.length ? ` · ${failed.length} opgaver FEJLEDE` : ""}${missing.length ? ` · ${missing.length} scorecards mangler` : ""}${pending.length ? ` · ${pending.length} opgaver venter (tidsbudget)` : ""}`);
  // #6804 (ejer valg 8 A): en v3-kandidat med en roed eller manglende G16-G19/G2-flad er blokeret.
  const v3Blocked = Boolean(card.v3Gates?.applies && card.v3Gates.candidate?.blocked);
  if (v3Blocked) console.log(`TAEND-GATE v3 BLOKERET: ${card.v3Gates.candidate.reasons.join("; ")}`);
  // #7214 (ejer 26/10): loebsgruppe-gaten blokerer kun kandidater efter s5_profiles_v3.
  const groupBlocked = Boolean(card.raceGroupGates?.applies && card.raceGroupGates.candidate?.blocked);
  if (groupBlocked) console.log(`LOEBSGRUPPE-GATE BLOKERET: ${card.raceGroupGates.candidate.reasons.join("; ")}`);
  if (failed.length || missing.length || pending.length || v3Blocked || groupBlocked) process.exitCode = 1;
  return { card, outDir, failed };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => { console.error(err?.stack ?? err); process.exit(1); });
}
