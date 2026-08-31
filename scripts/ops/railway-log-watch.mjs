#!/usr/bin/env node
/**
 * Cycling Zone - Railway logstroem-vagt (#4453)
 * ==============================================
 * Sidestykke til `scripts/ops/supabase-log-watch.mjs` (#4014). Samme fejlmaade
 * paa den anden logflade: backenden skriver strukturerede `[tag]`-linjer til
 * Railways stdout/stderr som INGEN laeser. Sentry ser kun exceptions i vores
 * egen kode, og flere af signalerne er bevidst undtaget fra Sentry (ét issue
 * pr. request under et udfald ville vaere samme falske positiv som #4299).
 * Resultatet er korrekte signaler uden modtager: #2817 (`[alunta-webhook]`),
 * #4165 (`[auth] 401 invalid_token`), #4369 (`[auth] 503 auth_unavailable`)
 * og #4451 (`[rate-limit] 429 api-baseline`).
 *
 * Maalt nulpunkt 31/8-2026 (issue-teksten sagde ~25, tallet var foraeldet):
 *   99 kaldsteder med et struktureret [tag]-praefiks fordelt paa 52 distinkte
 *   tags i runtime-koden (backend/lib, backend/routes, backend/server.js,
 *   backend/cron.js, backend/instrument.mjs). Foerste maaling 30/8 sagde 89/49,
 *   fordi scanneren dengang kun saa console.warn/error; classifyLine taeller
 *   alle niveauer, saa scanneren gaar nu ogsaa efter log/info/debug.
 *   Tael selv: node scripts/ops/railway-log-tags.mjs
 *
 * READ-ONLY - kalder kun `railway deployment list` og `railway logs`. Ingen
 * mutationer, ingen secret-vaerdier printes nogensinde.
 *
 * Railway-specifik forskel fra #4014: logs er DEPLOYMENT-scopede, ikke
 * environment-scopede, i CLI'en. Et doegn spaender derfor typisk over flere
 * deployments (15 alene 30/8), saa vagten lister deployments i vinduet og
 * henter logs fra hver af dem.
 *
 * Env:
 *   RAILWAY_TOKEN / RAILWAY_API_TOKEN  (paakraevet i CI) - project- eller
 *                                       account-token. Lokalt raekker
 *                                       `railway login` + `railway link`.
 *   RAILWAY_PROJECT_ID   (valgfri) - noedvendig hvis mappen ikke er linket
 *                                    og token'et ikke er project-scoped.
 *   RAILWAY_LOG_SERVICE  (valgfri) - default 'CyclingZone'.
 *   RAILWAY_LOG_ENVIRONMENT (valgfri) - default 'production'.
 *   RAILWAY_CLI_BIN      (valgfri) - default 'railway'.
 *
 * Taerskler pr. tag: scripts/ops/railway-log-thresholds.json (samme rolle som
 * supabase-advisor-allowlist.json). En vagt der raaber ved hver 401 bliver
 * slaaet fra i loebet af en uge - derfor er taersklerne per-tag og ikke én
 * global. De bider pr. (tag, fejlklasse-spand); tag-TOTALEN daekkes af
 * vaekstreglen (growthMultiplier/growthMinimum), saa et udfald der spreder sig
 * over mange endpoints ikke kan gemme sig under per-spand-taersklen.
 *
 * Ufuldstaendig daekning er sit eget signal: kunne en del af logstroemmen ikke
 * hentes, eller blev den skaaret af et loft, saettes `degraded` i Actions-
 * outputtet og workflowet aabner issue paa lige fod med et fund. En vagt der
 * kun saa halvdelen af doegnet og melder groent er ingen vagt.
 *
 * Usage:
 *   node scripts/ops/railway-log-watch.mjs            # menneskelig output
 *   node scripts/ops/railway-log-watch.mjs --json     # maskinlaesbart
 *   node scripts/ops/railway-log-watch.mjs --hours 6  # kortere vindue
 *
 * Exit: 0 = koerte OK (uanset fund/ej-fund) · 1 = config/CLI-fejl.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const THRESHOLDS_PATH = path.join(HERE, "railway-log-thresholds.json");

/**
 * Prod-projektets id (workspace 'nicolaidolmer's Projects', projekt
 * 'fantastic-connection', service 'CyclingZone'). Ikke en hemmelighed - det
 * staar i enhver Railway-dashboard-URL - og samme moenster som det hardkodede
 * SUPABASE_PROJECT_REF-default i supabase-log-watch.mjs (#4014). Overstyres med
 * RAILWAY_PROJECT_ID eller --project.
 *
 * Uden den falder CLI'en tilbage paa mappe-linket fra `railway link`, og det
 * link findes ikke i CI (og matcher ikke paa tvaers af shells paa Windows).
 */
export const DEFAULT_PROJECT_ID = "eebd4f5f-e440-45bf-8adc-97a7355bc439";

function isMain() {
  if (!import.meta || !import.meta.url) return false;
  try { return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? ""); }
  catch { return false; }
}

// ── Klassifikation (ren logik, ingen netvaerk) ──────────────────────────────

/**
 * Et struktureret signal starter linjen med `[tag]`. Railways level-felt kan
 * IKKE bruges alene: `console.warn("[shutdown] ...")` kommer tilbage som
 * level=info (verificeret mod prod 30/8), saa tag-praefikset er det eneste
 * paalidelige kendetegn.
 */
export const TAG_RE = /^\[([a-zA-Z0-9_:.\- ]{1,40})\]\s*/;

/**
 * Fortsaettelseslinjer fra `console.error("[tag]", obj)` - Node udskriver
 * objektet paa egne linjer (`  key: 'value',`, `}`). De er selvstaendige
 * log-entries hos Railway og ville ellers fylde `(untagged)`-spanden.
 */
export const CONTINUATION_RE = /^(\s|[}\])])/;

/** Tag brugt naar en error-linje ikke har et [tag]-praefiks. */
export const UNTAGGED = "(untagged)";

/**
 * Fjerner den variable del af en log-linje, saa gentagelser af SAMME fejl
 * lander i samme spand. 3-cifrede tal bevares med vilje: forskellen paa
 * `[auth] 401` og `[auth] 503` er hele pointen med #4165/#4369.
 * @param {string} text
 */
export function normalizeBucket(text) {
  return String(text)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\d{4}-\d{2}-\d{2}T[0-9:.]+Z?/g, "<ts>")
    .replace(/\b\d{4,}\b/g, "<n>")
    .replace(/'[^']*'/g, "<s>")
    .replace(/"[^"]*"/g, "<s>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/**
 * @param {{message?:string, level?:string}} entry
 * @returns {{tag:string, bucket:string}|null} null = linjen er ikke et signal.
 */
export function classifyLine(entry) {
  const message = String(entry?.message ?? "");
  if (!message.trim()) return null;

  const tagged = message.match(TAG_RE);
  if (tagged) {
    return { tag: tagged[1].trim(), bucket: normalizeBucket(message.slice(tagged[0].length)) || "(tom)" };
  }

  // Utagget: kun error-niveau taeller, og aldrig objekt-fortsaettelseslinjer.
  if (String(entry?.level ?? "").toLowerCase() !== "error") return null;
  if (CONTINUATION_RE.test(message)) return null;
  return { tag: UNTAGGED, bucket: normalizeBucket(message) };
}

/**
 * @param {{message?:string, level?:string}[]} entries
 * @returns {{tag:string, bucket:string, cnt:number}[]}
 */
export function aggregate(entries) {
  const counts = new Map();
  for (const entry of entries) {
    const hit = classifyLine(entry);
    if (!hit) continue;
    const key = `${hit.tag}::${hit.bucket}`;
    const row = counts.get(key);
    if (row) row.cnt += 1;
    else counts.set(key, { tag: hit.tag, bucket: hit.bucket, cnt: 1 });
  }
  return [...counts.values()].sort((a, b) => b.cnt - a.cnt);
}

function toKey(row) {
  return `${row.tag}::${row.bucket}`;
}

/**
 * Ren klassifikationslogik - spejler computeFindings i supabase-log-watch.mjs,
 * men med taerskel PR. TAG i stedet for én global. `[fatal]` og
 * `[alunta-webhook]` er aldrig normale (taerskel 1); `[auth] 401` fra scannere
 * er normal i småt tal.
 *
 * Taersklen i `tags` bider pr. (tag, bucket) - bucketen indeholder request-stien,
 * saa `auth: 300` betyder 300 linjer for EN rute+metode. Et bredt udfald (30
 * ruter x 250 linjer) holder derfor hver spand under taersklen. Derfor bider
 * `growth` paa tag-TOTALEN: er tagget mindst `growthMultiplier` gange stoerre
 * end i det foregaaende vindue og over `growthMinimum`, er det et fund. Det er
 * ogsaa den regel der besvarer acceptkriteriet i #4453: "er tallet stigende?"
 *
 * @param {{tag:string, bucket:string, cnt:number}[]} current
 * @param {{tag:string, bucket:string, cnt:number}[]} previous
 * @param {{default?:number, newClassThreshold?:number, growthMultiplier?:number, growthMinimum?:number, tags?:Record<string,number>, ignore?:string[]}} config
 */
export function computeFindings(current, previous, config = {}) {
  const defaultThreshold = config.default ?? 25;
  const newClassThreshold = config.newClassThreshold ?? 5;
  const growthMultiplier = config.growthMultiplier ?? 3;
  const growthMinimum = config.growthMinimum ?? 100;
  const perTag = config.tags ?? {};
  const ignored = new Set(config.ignore ?? []);

  const previousByKey = new Map(previous.map((r) => [toKey(r), r.cnt]));
  const watched = current.filter((r) => !ignored.has(r.tag));

  const spikes = watched
    .filter((r) => r.cnt >= (perTag[r.tag] ?? defaultThreshold))
    .map((r) => ({ ...r, threshold: perTag[r.tag] ?? defaultThreshold, previousCnt: previousByKey.get(toKey(r)) ?? 0 }))
    .sort((a, b) => b.cnt - a.cnt);

  const newClasses = watched
    .filter((r) => !previousByKey.has(toKey(r)) && r.cnt >= newClassThreshold)
    .map((r) => ({ ...r, previousCnt: 0 }))
    .sort((a, b) => b.cnt - a.cnt);

  const growth = tagTotals(current, previous)
    .filter((t) => !ignored.has(t.tag))
    .filter((t) => t.cnt >= growthMinimum && t.cnt >= growthMultiplier * t.previousCnt)
    .map((t) => ({ ...t, multiplier: growthMultiplier, minimum: growthMinimum }))
    .sort((a, b) => b.cnt - a.cnt);

  return {
    spikes,
    newClasses,
    growth,
    hasFindings: spikes.length > 0 || newClasses.length > 0 || growth.length > 0,
  };
}

/**
 * Totaler pr. tag - svarer paa acceptkriteriet i #4453: "hvor mange
 * [auth] 401-linjer producerer prod paa et doegn, og er tallet stigende?"
 * @param {{tag:string, bucket:string, cnt:number}[]} current
 * @param {{tag:string, bucket:string, cnt:number}[]} previous
 */
export function tagTotals(current, previous) {
  const sum = (rows) => {
    const m = new Map();
    for (const r of rows) m.set(r.tag, (m.get(r.tag) ?? 0) + r.cnt);
    return m;
  };
  const now = sum(current);
  const before = sum(previous);
  return [...new Set([...now.keys(), ...before.keys()])]
    .map((tag) => ({ tag, cnt: now.get(tag) ?? 0, previousCnt: before.get(tag) ?? 0 }))
    .sort((a, b) => b.cnt - a.cnt);
}

/**
 * Railway-logs er deployment-scopede. Et doegn spaender typisk over flere
 * deployments, saa vinduet skal oversaettes til et saet deployment-id'er.
 * En deployment daekker [createdAt, naeste-nyere-deployments createdAt).
 *
 * Trunkering ved `max` skal SIGNALERES, ikke skjules: listen er nyest-foerst, saa
 * det er de aeldste timer af vinduet der falder ud, og en undertaelling der
 * lander under alle taerskler ser ud som et sundt doegn. Derfor returnerer
 * selectDeploymentsDetailed et `truncated`-flag.
 *
 * @param {{id:string, createdAt:string}[]} deployments  nyeste foerst
 * @param {string} startIso
 * @param {string} endIso
 * @param {number} [max]
 * @returns {{ids:string[], truncated:boolean, overlapping:number}}
 */
export function selectDeploymentsDetailed(deployments, startIso, endIso, max = 40) {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  const sorted = [...deployments]
    .filter((d) => d && d.id && Number.isFinite(Date.parse(d.createdAt)))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const overlapping = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const from = Date.parse(sorted[i].createdAt);
    // Nyeste deployment koerer stadig; aeldre sluttede da den naeste startede.
    const until = i === 0 ? Number.POSITIVE_INFINITY : Date.parse(sorted[i - 1].createdAt);
    if (from >= end) continue;   // startede efter vinduet
    if (until <= start) break;   // sluttede foer vinduet (og resten er aeldre)
    overlapping.push(sorted[i].id);
  }
  return {
    ids: overlapping.slice(0, max),
    truncated: overlapping.length > max,
    overlapping: overlapping.length,
  };
}

/**
 * Bekvemmelighedsindpakning naar kun id'erne er interessante.
 * @returns {string[]}
 */
export function selectDeployments(deployments, startIso, endIso, max = 40) {
  return selectDeploymentsDetailed(deployments, startIso, endIso, max).ids;
}

// ── CLI-kald (netvaerk) ─────────────────────────────────────────────────────

/**
 * Railway CLI'en installeres som en .cmd-shim paa Windows, og spawnSync uden
 * shell finder kun rene .exe'er (Node naegter desuden at spawne .cmd/.bat uden
 * shell siden 18.20.2). Vi koerer derfor hele kommandolinjen gennem shell paa
 * win32 og citerer argumenter med mellemrum (service-navne kan have dem).
 */
const NEEDS_SHELL = process.platform === "win32";

/**
 * Tegn der er ufarlige i baade cmd.exe og POSIX-shells. Bevidst UDEN % og !
 * (variabel-ekspansion i cmd.exe sker ogsaa inde i citationstegn) og uden
 * & | ^ < > ( ) ; $ ` (kommandoseparatorer/substitution).
 */
const SAFE_ARG_RE = /^[A-Za-z0-9 _.,:+@/-]+$/;
/** Samme, men med backslash - kun til CLI-stien (RAILWAY_CLI_BIN paa Windows). */
const SAFE_PATH_RE = /^[A-Za-z0-9 _.,:+@/\\-]+$/;

/**
 * Vi ESCAPER ikke argumenterne. Indtil CodeQL-alarm #353 gjorde vi det med
 * `.replace(/"/g, '\\"')`, og den escape var ufuldstaendig: den daekkede
 * citationstegnet, men ikke selve escape-tegnet, saa et argument der ender paa
 * backslash braekkede citeringen. cmd.exe har desuden ingen paalidelig escape
 * for %, ! eller ^, og et argument uden mellemrum blev slet ikke citeret.
 *
 * I stedet VALIDERER vi. Alt scriptet sender er kendte former: faste flag,
 * service-/miljoenavn, deployment-uuid, ISO-tidsstempler, heltal og evt. en
 * CLI-sti. En allowlist er baade snaevrere og lettere at raesonnere om end en
 * escape - og efter validering kan et argument ikke indeholde tegn der kan
 * bryde ud af citeringen.
 *
 * Valideringen koerer paa ALLE platforme (ogsaa hvor vi sender argv-array og
 * ikke bruger shell), saa et forkert service-navn fejler ens i CI paa Linux og
 * lokalt paa Windows - ikke foerst naar vagten koerer paa den anden platform.
 */
export function shellQuote(arg, { allowBackslash = false } = {}) {
  const value = String(arg);
  const pattern = allowBackslash ? SAFE_PATH_RE : SAFE_ARG_RE;
  // En afsluttende backslash ville escape det lukkende citationstegn.
  if (!pattern.test(value) || value.endsWith("\\")) {
    throw new Error(
      `[railway-log-watch] argument afvist (utilladte tegn): ${JSON.stringify(value.slice(0, 80))}`,
    );
  }
  return /\s/.test(value) ? `"${value}"` : value;
}

function runRailway(bin, args, { allowFail = false, projectId, wantStatus = false } = {}) {
  // Projekt-id'et gives via env til barneprocessen, aldrig som synligt argument
  // - `railway deployment list` har ingen --project-flag.
  const env = projectId ? { ...process.env, RAILWAY_PROJECT_ID: projectId } : process.env;
  const opts = { encoding: "utf8", maxBuffer: 128 * 1024 * 1024, env };
  // Validér altid; citér kun naar vi faktisk bygger en shell-kommandolinje.
  const quoted = [shellQuote(bin, { allowBackslash: true }), ...args.map((a) => shellQuote(a))];
  const res = NEEDS_SHELL
    ? spawnSync(quoted.join(" "), { ...opts, shell: true })
    : spawnSync(bin, args, opts);
  const stderr = String(res.stderr ?? "");
  const missingCli = res.error?.code === "ENOENT" || /not recognized|command not found|No such file/i.test(stderr);
  if (missingCli) {
    throw new Error(
      `Railway CLI ikke fundet ('${bin}'). Install: npm i -g @railway/cli, derefter 'railway login' + 'railway link'. I CI: saet RAILWAY_TOKEN.`,
    );
  }
  if (res.error) throw res.error;
  if (res.status !== 0 && !allowFail) {
    throw new Error(`railway ${args[0]} fejlede (exit ${res.status}): ${String(stderr || res.stdout).trim().slice(0, 300)}`);
  }
  if (wantStatus) return { stdout: res.stdout ?? "", stderr: stderr.trim(), status: res.status };
  return res.stdout ?? "";
}

function listDeployments(bin, ctx, limit) {
  const out = runRailway(
    bin,
    ["deployment", "list", "--service", ctx.service, "--environment", ctx.environment, "--json", "--limit", String(limit)],
    { projectId: ctx.projectId },
  );
  const parsed = JSON.parse(out);
  return Array.isArray(parsed) ? parsed : [];
}

function fetchDeploymentLogs(bin, ctx, deploymentId, startIso, endIso, lines) {
  // Enkelte deployments kan vaere rullet helt bort; en fejl paa én maa ikke
  // vaelte hele koerslen (samme isolationsprincip som per-rytter try/catch i
  // graduerings-sweepet). En SYSTEMATISK fejl skal derimod raabe - se
  // collectWindow: en vagt der stille rapporterer nul fund er praecis den
  // fejlmaade #4453 handler om.
  const res = runRailway(
    bin,
    [
      "logs", deploymentId,
      "--service", ctx.service,
      "--environment", ctx.environment,
      "--json", "--since", startIso, "--until", endIso, "--lines", String(lines),
    ],
    { allowFail: true, projectId: ctx.projectId, wantStatus: true },
  );
  const entries = [];
  let jsonLines = 0;
  for (const line of res.stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    jsonLines += 1;
    try { entries.push(JSON.parse(trimmed)); } catch { /* ikke-JSON stoej fra CLI'en */ }
  }
  // Rammer vi loftet praecist, har CLI'en efter al sandsynlighed skaaret aeldre
  // linjer af. Paa en stille weekend daekker ét deployment hele doegnet, og saa
  // er --lines loftet for en hel dags logstroem - undertaelling der ligner ro.
  return { entries, ok: res.status === 0, stderr: res.stderr, lineCapHit: jsonLines >= lines };
}

export function loadThresholds(file = THRESHOLDS_PATH) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * Et tomt maaleresultat maa ALDRIG kunne fremstaa som et sundt nul. Tre veje til
 * "groent med nul data", alle tre lukket her:
 *  - listen er tom: Railway har altid mindst ét deployment i drift, saa nul
 *    raekker betyder at CLI'ens JSON-form har aendret sig (pakket i et objekt,
 *    createdAt omdoebt) - ikke at backenden ikke koerte. Workflowet installerer
 *    @railway/cli upinnet, saa den dag kommer.
 *  - listen er fyldt, men INTET blev valgt: samme aarsag, blot fanget i
 *    selectDeployments' createdAt-filter.
 *  - alle hentninger fejlede: "nul fund" er saa en loegn, ikke et resultat.
 *
 * @returns {string|null} fejlbesked, eller null hvis daekningen er brugbar.
 */
export function windowCoverageError({ deploymentTotal, selectedCount, failedCount = 0, startIso = "", endIso = "", lastError = "" }) {
  if (deploymentTotal === 0) {
    return "'railway deployment list --json' returnerede nul deployments. "
      + "Enten er service/environment forkert, eller CLI'ens JSON-form er aendret. "
      + "Tjek med: railway deployment list --service CyclingZone --environment production --json";
  }
  if (selectedCount === 0) {
    return `ingen af de ${deploymentTotal} deployments overlapper vinduet ${startIso} -> ${endIso}. `
      + "Feltet 'createdAt' mangler eller kan ikke parses paa alle raekker - vagten ville ellers "
      + "rapportere nul fund uden at have set en eneste linje.";
  }
  if (failedCount === selectedCount) {
    return `ingen af de ${selectedCount} deployments kunne hentes. Sidste fejl: ${String(lastError).slice(0, 300)}`;
  }
  return null;
}

function collectWindow(bin, ctx, config, startIso, endIso) {
  const deployments = listDeployments(bin, ctx, config.deploymentListLimit ?? 100);
  const { ids, truncated, overlapping } = selectDeploymentsDetailed(
    deployments, startIso, endIso, config.maxDeployments ?? 40,
  );
  const selectionError = windowCoverageError({
    deploymentTotal: deployments.length, selectedCount: ids.length, startIso, endIso,
  });
  if (selectionError) throw new Error(selectionError);

  const entries = [];
  let failed = 0;
  let lineCapHits = 0;
  let lastError = "";
  for (const id of ids) {
    const res = fetchDeploymentLogs(bin, ctx, id, startIso, endIso, config.linesPerDeployment ?? 5000);
    entries.push(...res.entries);
    if (!res.ok) { failed += 1; lastError = res.stderr || lastError; }
    if (res.lineCapHit) lineCapHits += 1;
  }
  const fetchError = windowCoverageError({
    deploymentTotal: deployments.length, selectedCount: ids.length, failedCount: failed, startIso, endIso, lastError,
  });
  if (fetchError) throw new Error(fetchError);
  return {
    entries,
    deploymentCount: ids.length,
    failedDeployments: failed,
    // Delvis daekning: baade afskaarne deployments og afskaarne logstroemme.
    // Surfaces i GITHUB_OUTPUT som degraded - se main().
    truncatedDeployments: truncated ? overlapping - ids.length : 0,
    lineCapHits,
  };
}

async function main() {
  const bin = process.env.RAILWAY_CLI_BIN || "railway";
  const argValue = (flag) => {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const ctx = {
    service: argValue("--service") || process.env.RAILWAY_LOG_SERVICE || "CyclingZone",
    environment: argValue("--environment") || process.env.RAILWAY_LOG_ENVIRONMENT || "production",
    projectId: argValue("--project") || process.env.RAILWAY_PROJECT_ID || DEFAULT_PROJECT_ID,
  };
  const asJson = process.argv.includes("--json");
  const hours = argValue("--hours") !== undefined ? Number(argValue("--hours")) : 24;

  if (!Number.isFinite(hours) || hours <= 0) {
    console.error("[railway-log-watch] FAIL: --hours skal vaere et positivt tal.");
    process.exit(1);
  }

  let config;
  try {
    config = loadThresholds();
  } catch (err) {
    console.error(`[railway-log-watch] FAIL: kunne ikke laese ${THRESHOLDS_PATH}: ${err.message}`);
    process.exit(1);
  }

  const now = new Date();
  const windowMs = hours * 3600 * 1000;
  const currentStart = new Date(now.getTime() - windowMs);
  const previousStart = new Date(now.getTime() - 2 * windowMs);

  let current, previous, deploymentCount, failedDeployments, truncatedDeployments, lineCapHits;
  try {
    const cur = collectWindow(bin, ctx, config, currentStart.toISOString(), now.toISOString());
    const prev = collectWindow(bin, ctx, config, previousStart.toISOString(), currentStart.toISOString());
    current = aggregate(cur.entries);
    previous = aggregate(prev.entries);
    deploymentCount = cur.deploymentCount + prev.deploymentCount;
    failedDeployments = cur.failedDeployments + prev.failedDeployments;
    truncatedDeployments = cur.truncatedDeployments + prev.truncatedDeployments;
    lineCapHits = cur.lineCapHits + prev.lineCapHits;
  } catch (err) {
    console.error(`[railway-log-watch] FAIL: ${err.message}`);
    console.error("  Lokalt: 'railway login' + 'railway link -p <projekt> -e production -s CyclingZone'.");
    console.error("  I CI: saet RAILWAY_TOKEN som GitHub-secret (aldrig i kode/logs).");
    process.exit(1);
  }

  const { spikes, newClasses, growth, hasFindings } = computeFindings(current, previous, config);
  const totals = tagTotals(current, previous);

  // Delvis daekning er sit eget alarmsignal. Fejler 49 af 50 hentninger, summerer
  // tallene til naesten ingenting, ingen taerskel brydes og jobbet ville ellers
  // vaere groent - praecis den tavse fejlmaade #4453 blev oprettet for.
  const degradations = [];
  if (failedDeployments > 0) degradations.push(`${failedDeployments} af ${deploymentCount} deployments kunne ikke hentes`);
  if (truncatedDeployments > 0) degradations.push(`${truncatedDeployments} overlappende deployments faldt ud af maxDeployments-loftet (${config.maxDeployments ?? 40})`);
  if (lineCapHits > 0) degradations.push(`${lineCapHits} deployments ramte linje-loftet (${config.linesPerDeployment ?? 5000}) og er sandsynligvis afkortet`);
  const degraded = degradations.length > 0;

  if (asJson) {
    console.log(JSON.stringify({
      hasFindings, degraded, degradations, spikes, newClasses, growth, totals,
      deploymentCount, failedDeployments, truncatedDeployments, lineCapHits,
      window: { start: currentStart.toISOString(), end: now.toISOString() },
    }, null, 2));
  } else {
    console.log(`[railway-log-watch] Vindue: ${currentStart.toISOString()} -> ${now.toISOString()} (${hours}t, ${deploymentCount} deployments)`);
    for (const note of degradations) {
      console.log(`[railway-log-watch] ADVARSEL: ${note} - tallene nedenfor er ufuldstaendige.`);
    }
    console.log(`[railway-log-watch] Taerskler: default ${config.default}/vindue, ny-klasse ${config.newClassThreshold}, ${Object.keys(config.tags ?? {}).length} tag-specifikke, ${(config.ignore ?? []).length} ignorerede`);

    console.log("\n== Totaler pr. tag (dette vindue vs. det foregaaende) ==");
    if (!totals.length) {
      console.log("  (ingen strukturerede signaler i vinduet)");
    } else {
      for (const t of totals.slice(0, 30)) {
        const delta = t.cnt - t.previousCnt;
        const arrow = delta > 0 ? `+${delta}` : String(delta);
        console.log(`  ${String(t.cnt).padStart(6)}  (foreg.: ${String(t.previousCnt).padStart(6)}, ${arrow.padStart(6)})  [${t.tag}]`);
      }
    }

    if (!hasFindings && !degraded) {
      console.log("\n[railway-log-watch] OK - ingen taerskel-brud, ingen nye fejlklasser, fuld daekning af vinduet.");
    } else {
      if (spikes.length) {
        console.log("\n== Taerskel-brud (pr. tag + fejlklasse) ==");
        for (const s of spikes) console.log(`  ${String(s.cnt).padStart(6)} (>= ${s.threshold}, foreg. ${s.previousCnt})  [${s.tag}] ${s.bucket}`);
      }
      if (growth.length) {
        console.log("\n== Vaekst paa tag-totalen (bredt udfald spredt over mange spande) ==");
        for (const g of growth) console.log(`  ${String(g.cnt).padStart(6)} (foreg. ${g.previousCnt}, >= ${g.multiplier}x og >= ${g.minimum})  [${g.tag}]`);
      }
      if (newClasses.length) {
        console.log(`\n== Nye fejlklasser (saas ikke i foregaaende vindue, >= ${config.newClassThreshold}) ==`);
        for (const n of newClasses) console.log(`  ${String(n.cnt).padStart(6)}  [${n.tag}] ${n.bucket}`);
      }
    }
  }

  // GitHub Actions output-kontrakt - som supabase-log-watch.mjs, plus
  // degraded/failed_deployments. Workflowet reagerer paa BEGGE: en vagt der kun
  // rapporterer fund, men tier om at den kun saa halvdelen af logstroemmen, er
  // stadig en tavs vagt.
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `has_findings=${hasFindings}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `degraded=${degraded}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `failed_deployments=${failedDeployments}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `deployment_count=${deploymentCount}\n`);
    const body = [];
    if (degradations.length) {
      body.push("UFULDSTAENDIG DAEKNING (tallene nedenfor er undertaellinger):");
      for (const note of degradations) body.push(`- ${note}`);
    }
    if (spikes.length) {
      body.push("Taerskel-brud (pr. tag + fejlklasse):");
      for (const s of spikes.slice(0, 15)) body.push(`- ${s.cnt} (taerskel ${s.threshold}, foreg. ${s.previousCnt}) | [${s.tag}] | ${s.bucket}`);
    }
    if (growth.length) {
      body.push("Vaekst paa tag-totalen:");
      for (const g of growth.slice(0, 15)) body.push(`- ${g.cnt} (foreg. ${g.previousCnt}, >= ${g.multiplier}x og >= ${g.minimum}) | [${g.tag}]`);
    }
    if (newClasses.length) {
      body.push(`Nye fejlklasser (>= ${config.newClassThreshold}):`);
      for (const n of newClasses.slice(0, 15)) body.push(`- ${n.cnt} | [${n.tag}] | ${n.bucket}`);
    }
    if (totals.length) {
      body.push("Totaler pr. tag (dette vindue vs. foregaaende):");
      for (const t of totals.slice(0, 15)) body.push(`- ${t.cnt} (foreg. ${t.previousCnt}) | [${t.tag}]`);
    }
    if (body.length) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `findings<<RAILWAYWATCH_EOF\n${body.join("\n")}\nRAILWAYWATCH_EOF\n`);
    }
  }

  process.exit(0);
}

if (isMain()) {
  main();
}
