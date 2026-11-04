// scripts/ci/backend-test-shards.mjs
// ============================================================
// #7582 (CI-hastighed del 2, punkt 4+5): backend-testene koerer i tre
// parallelle dele, og springes over paa PR'er der ikke kan paavirke dem.
//
// Filen har tre roller, alle rene og enhedstestede
// (node --test scripts/ci/backend-test-shards.test.mjs):
//
// 1. REPORTER (default-eksport). Hver del koerer `npm test -- --test-shard=i/3`
//    med denne fil som ekstra node:test-reporter. Den skriver hver testfil,
//    node:test faktisk koerte, til filen i $BACKEND_TEST_FILE_LOG. Delingen
//    sker i node:test selv (--test-shard), saa backend/scripts/run-tests.js er
//    uaendret: samme filsoegning, samme #3172-isolation, samme #6737-batching.
//
// 2. VERIFY (`verify --logs-dir <dir>`). Samle-jobbet `backend-tests` laeser de
//    tre dele-logs og sammenholder dem med HELE listen af backend-testfiler
//    (samme regel som run-tests.js). Roed hvis en fil mangler, hvis en fil koerte
//    i to dele, eller hvis en del-log mangler. Tabellen (filer pr. del mod hele
//    listen) skrives til job-summary, saa beviset staar paa hver koersel.
//
// 3. NEEDS-BACKEND (stdin: aendrede filer -> "true"/"false"). Afgoer om en PR
//    kan paavirke backend-testene. Konservativ: alt under backend/ og alle
//    testfiler taeller, og derudover enhver sti uden for backend/ som
//    backend-koden (eller kode den laeser uden for backend/) naevner. En
//    sti-reference der er bygget dynamisk, giver hele mappen som relevant.
//    Ved tvivl koerer testene. Kun pull_request bruger afgoerelsen; push til
//    main og merge_group koerer altid fuldt.
//
// Refs #7582 #7511 #3172.

import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SHARD_TOTAL = 3;

// Spejler backend/scripts/run-tests.js. Testen i backend-test-shards.test.mjs
// laeser run-tests.js og fejler, hvis de to regler driver fra hinanden.
export const TEST_FILE_SUFFIXES = Object.freeze([".test.js", ".test.ts", ".test.mjs"]);
export const IGNORED_DIRS = Object.freeze(["node_modules", ".git"]);

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..");

const toPosix = (p) => p.split(path.sep).join("/");

// ------------------------------------------------------------
// Filsoegning (samme regel som run-tests.js)
// ------------------------------------------------------------

/** @param {string} backendRoot @returns {string[]} sorterede stier relativt til backendRoot (posix) */
export function discoverBackendTestFiles(backendRoot) {
  const ignored = new Set(IGNORED_DIRS);
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (ignored.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (entry.isFile() && TEST_FILE_SUFFIXES.some((s) => entry.name.endsWith(s))) {
        out.push(toPosix(path.relative(backendRoot, path.join(dir, entry.name))));
      }
    }
  };
  walk(backendRoot);
  return out.sort();
}

// ------------------------------------------------------------
// 1. Reporter
// ------------------------------------------------------------

/** Normaliserer en node:test-filreference til en posix-sti relativt til cwd. */
export function normalizeEventFile(file, cwd = process.cwd()) {
  if (typeof file !== "string" || file === "") return null;
  let abs = file;
  if (file.startsWith("file:")) {
    try {
      abs = fileURLToPath(file);
    } catch {
      return null;
    }
  }
  return toPosix(path.relative(cwd, path.resolve(cwd, abs)));
}

/**
 * Omsaetter en event til en log-linje eller null.
 * "ran" = node:test's afsluttende summary for en hel fil (kun ved
 * process-isolation, een pr. fil). "seen" = enhver anden event med en fil
 * (bruges for --test-isolation=none-passet, hvor der ingen fil-summary er).
 */
export function eventToLogLine(event, cwd = process.cwd()) {
  const file = normalizeEventFile(event?.data?.file, cwd);
  if (!file) return null;
  const kind = event.type === "test:summary" ? "ran" : "seen";
  return `${kind}\t${file}`;
}

export default async function* backendTestFileLogReporter(source) {
  const target = process.env.BACKEND_TEST_FILE_LOG;
  const written = new Set();
  for await (const event of source) {
    if (!target) continue;
    const line = eventToLogLine(event);
    if (!line || written.has(line)) continue;
    written.add(line);
    appendFileSync(target, `${line}\n`);
  }
}

// ------------------------------------------------------------
// 2. Verify
// ------------------------------------------------------------

/** @param {string} text @returns {{ran: Set<string>, seen: Set<string>}} */
export function parseShardLog(text) {
  const ran = new Set();
  const seen = new Set();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const [kind, file] = line.split("\t");
    if (!file) continue;
    if (kind === "ran") ran.add(file);
    else seen.add(file);
  }
  return { ran, seen };
}

/**
 * @param {{discovered: string[], logs: Map<number, string>, total?: number}} input
 *   logs: del-nummer (1..total) -> raa log-tekst
 */
export function verifyShardLogs({ discovered, logs, total = SHARD_TOTAL }) {
  const errors = [];
  const all = new Set(discovered);
  const parsed = new Map();
  for (let i = 1; i <= total; i += 1) {
    if (!logs.has(i)) {
      errors.push(`del ${i}/${total}: log mangler`);
      continue;
    }
    parsed.set(i, parseShardLog(logs.get(i)));
  }
  for (const key of logs.keys()) {
    if (!Number.isInteger(key) || key < 1 || key > total) errors.push(`ukendt del i logs: ${key}`);
  }

  // Ejer pr. fil: en "ran"-markering vinder; ellers "seen" (isolation=none-passet).
  const ranIn = new Map();
  const seenIn = new Map();
  for (const [i, log] of parsed) {
    for (const f of log.ran) if (all.has(f)) ranIn.set(f, [...(ranIn.get(f) ?? []), i]);
    for (const f of log.seen) if (all.has(f)) seenIn.set(f, [...(seenIn.get(f) ?? []), i]);
  }

  const perShard = new Map([...parsed.keys()].map((i) => [i, 0]));
  const missing = [];
  const duplicated = [];
  for (const f of discovered) {
    const owners = ranIn.get(f) ?? seenIn.get(f) ?? [];
    if (owners.length === 0) missing.push(f);
    else if (owners.length > 1) duplicated.push(`${f} (del ${owners.join(", ")})`);
    else perShard.set(owners[0], perShard.get(owners[0]) + 1);
  }
  if (missing.length) errors.push(`${missing.length} testfil(er) koerte i ingen del: ${missing.slice(0, 20).join(", ")}`);
  if (duplicated.length) errors.push(`${duplicated.length} testfil(er) koerte i flere dele: ${duplicated.slice(0, 20).join(", ")}`);

  const covered = [...perShard.values()].reduce((a, b) => a + b, 0);
  return { ok: errors.length === 0, errors, perShard, covered, total: discovered.length, missing, duplicated };
}

export function formatVerifySummary(result, shardTotal = SHARD_TOTAL) {
  const lines = [
    "### backend-tests: filer pr. del mod hele listen (#7582)",
    "",
    "| Del | Testfiler |",
    "|---|---:|",
  ];
  for (let i = 1; i <= shardTotal; i += 1) {
    lines.push(`| ${i}/${shardTotal} | ${result.perShard.has(i) ? result.perShard.get(i) : "log mangler"} |`);
  }
  lines.push(`| **Sum** | **${result.covered}** |`);
  lines.push(`| Hele listen (run-tests.js-reglen) | ${result.total} |`);
  lines.push("");
  lines.push(result.ok ? "Alle testfiler koerte i praecis een del." : `**ROED:** ${result.errors.join("; ")}`);
  return `${lines.join("\n")}\n`;
}

function readShardLogs(dir) {
  const logs = new Map();
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      const m = entry.isFile() && /^shard-(\d+)\.txt$/.exec(entry.name);
      if (m) {
        const i = Number(m[1]);
        logs.set(i, (logs.get(i) ?? "") + readFileSync(full, "utf8"));
      }
    }
  };
  if (existsSync(dir)) walk(dir);
  return logs;
}

// ------------------------------------------------------------
// 3. Needs-backend
// ------------------------------------------------------------

// Stier der altid kan paavirke backend-tests-jobbet. Testfiler overalt taeller
// med, fordi backend/lib/promisedTestFilesExist.test.js laeser hele repoets
// testfil-navne (en slettet/omdoebt testfil kan goere den roed).
export const ALWAYS_RELEVANT_PREFIXES = Object.freeze([
  "backend/",
  ".github/workflows/ci.yml",
  "scripts/ci/backend-test-shards.",
  // Koeres i backend-tests-jobbet (ci.yml), ikke af npm test.
  "scripts/trainingRecovery5928",
  "scripts/preflight-season-cutover",
]);
const ANY_TEST_FILE_RE = /\.test\.(?:js|mjs|cjs|ts|jsx|tsx)$/;
const CODE_EXT_RE = /\.(?:js|mjs|cjs|ts|jsx|tsx)$/;
const SCAN_EXT_RE = /\.(?:js|mjs|cjs|ts|jsx|tsx|json)$/;
const SKIP_SCAN_NAMES = new Set(["package-lock.json"]);
const PATH_CHARS = "A-Za-z0-9_.\\-/@";

/**
 * Finder repo-stier uden for backend/, som en kildefil naevner.
 * Returnerer {ref, cut}: cut=true betyder at stien blev afbrudt af et
 * dynamisk led (`${...}`, `*` eller en variabel), saa alt under praefikset
 * taeller som relevant.
 *
 * @param {string} source
 * @param {string} fileRel  filens sti relativt til repo-roden (posix)
 * @param {string[]} topNames top-level navne i repoet (uden backend)
 */
export function extractRepoReferences(source, fileRel, topNames) {
  const refs = [];
  const fileDir = path.posix.dirname(fileRel);
  const tops = new Set(topNames);
  const add = (ref, cut) => {
    let r = ref.replace(/\/+$/u, "");
    if (!r || r === "." || r.startsWith("../") || r === "..") return;
    if (r === "backend" || r.startsWith("backend/")) return;
    const top = r.split("/")[0];
    if (!tops.has(top)) return;
    refs.push({ ref: r, cut });
  };
  const cutDynamic = (lit) => {
    const idx = lit.search(/\$\{|\*/u);
    return idx === -1 ? { text: lit, cut: false } : { text: lit.slice(0, idx), cut: true };
  };

  // (a) Relative strenge ("./x", "../x"): imports, new URL(...), join(__dirname, "../..").
  // Loeses mod filens egen mappe. Base-mappen kan vaere en anden (fx
  // BACKEND_ROOT), saa (b) nedenfor tager ogsaa stien uden at loese den.
  for (const m of source.matchAll(/(["'`])(\.{1,2}\/[^"'`\n]*)\1/gu)) {
    const { text, cut } = cutDynamic(m[2]);
    add(path.posix.normalize(path.posix.join(fileDir, text)), cut);
  }

  // (b) "top/..."-stier inde i strenge ("frontend/src/x.js", "../../docs/y.json",
  // globs som "docs/**"). Kun i strenge: kommentarer naevner stier i flaeng.
  const topAlt = topNames.map((t) => t.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|");
  if (topAlt) {
    const re = new RegExp(`(?<![A-Za-z0-9_\\-])(?<!backend/)((?:${topAlt})/[${PATH_CHARS}$\\{*]*)`, "gu");
    for (const lit of source.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/gu)) {
      // "!/docs/**" er et negeret glob (fx Railways watchPatterns): stien er
      // netop IKKE relevant, saa den taeller ikke.
      if (lit[2].startsWith("!")) continue;
      for (const m of lit[2].matchAll(re)) {
        const { text, cut } = cutDynamic(m[1]);
        add(text, cut);
      }
    }
  }

  // (c) Sti-led som separate strenge: join(BASE, "..", "frontend", "src", x).
  // BASE afgoer hvor stien starter: modulets egen mappe (__dirname, here,
  // import.meta.dirname, et kald), backend-roden (BACKEND_ROOT) eller
  // repo-roden (REPO_ROOT, ROOT). En ukendt BASE med kun eet led er ikke en
  // sti-konstruktion (fx `entry === "scripts"`); med flere led tages stien.
  const seqRe = /(["'])[^"'\n]*\1(?:\s*,\s*(["'])[^"'\n]*\2)*/gu;
  for (const m of source.matchAll(seqRe)) {
    const segs = [...m[0].matchAll(/(["'])([^"'\n]*)\1/gu)].map((s) => s[2]);
    // Kun sti-agtige led; en fejltekst eller "" er ikke en sti.
    if (!segs.every((s) => /^[A-Za-z0-9_.@\-/${}*]+$/u.test(s))) continue;
    const before = source.slice(Math.max(0, m.index - 120), m.index);
    let base;
    const identBase = /(?:join|resolve)\s*\(\s*([A-Za-z_$][\w$.]*)\s*,\s*$/u.exec(before);
    if (identBase) base = identBase[1];
    else if (/(?:join|resolve)\s*\([^;]*\)\s*,\s*$/u.test(before)) base = ")";
    else if (/\(\s*$/u.test(before) && tops.has(segs[0]) && segs.length >= 2) base = "REPO_ROOT";
    else continue;
    let baseDir;
    if (base === ")" || /^(?:__dirname|here|HERE|dir|DIR|import\.meta\.dirname|moduleDir|thisDir|THIS_DIR|SCRIPT_DIR|scriptDir|testDir|TEST_DIR)$/u.test(base)) {
      baseDir = fileDir;
    } else if (/backend/iu.test(base) || /^BE_/u.test(base)) {
      baseDir = "backend";
    } else if (/repo|^root$|^ROOT$|ROOT_DIR|rootDir/iu.test(base)) {
      baseDir = "";
    } else {
      // Ukendt base: kun en sti hvis den starter med et top-level-navn og har flere led.
      let i = 0;
      while (i < segs.length && segs[i] === "..") i += 1;
      if (i >= segs.length || !tops.has(segs[i]) || segs.length - i < 2) continue;
      baseDir = "";
      segs.splice(0, i);
    }
    const clean = [];
    let cut = false;
    for (const p of segs) {
      if (p.includes("${") || p.includes("*")) {
        const { text } = cutDynamic(p);
        if (text) clean.push(text);
        cut = true;
        break;
      }
      clean.push(p);
    }
    add(path.posix.normalize(path.posix.join(baseDir || ".", ...clean)), cut);
  }
  return refs;
}

function listTopNames(repoRoot) {
  return readdirSync(repoRoot, { withFileTypes: true })
    .map((e) => e.name)
    .filter((n) => n !== "backend" && n !== "node_modules" && n !== ".git");
}

function walkScanFiles(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.includes(entry.name)) continue;
      walkScanFiles(full, out);
    } else if (entry.isFile() && SCAN_EXT_RE.test(entry.name) && !SKIP_SCAN_NAMES.has(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Samler alle repo-stier uden for backend/, som backend-koden naevner, plus
 * den transitive lukning: naevnt kode uden for backend/ (fx scripts/dev/lib/x.mjs)
 * scannes selv, saa dens egne imports og fil-laesninger ogsaa taeller.
 * @returns {{ref: string, cut: boolean}[]}
 */
export function collectBackendRelevantRefs(repoRoot = REPO_ROOT) {
  const topNames = listTopNames(repoRoot);
  const backendRoot = path.join(repoRoot, "backend");
  const byKey = new Map();
  const queue = walkScanFiles(backendRoot, []);
  const scanned = new Set();
  while (queue.length) {
    const abs = queue.pop();
    if (scanned.has(abs)) continue;
    scanned.add(abs);
    let source;
    try {
      source = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const rel = toPosix(path.relative(repoRoot, abs));
    for (const r of extractRepoReferences(source, rel, topNames)) {
      const key = `${r.ref}\0${r.cut}`;
      if (byKey.has(key)) continue;
      byKey.set(key, r);
      // Transitiv lukning: naevnt kode uden for backend/ scannes ogsaa.
      const target = path.join(repoRoot, r.ref);
      if (!r.cut && CODE_EXT_RE.test(r.ref) && existsSync(target) && statSync(target).isFile()) {
        queue.push(target);
      }
    }
  }
  return [...byKey.values()].sort((a, b) => a.ref.localeCompare(b.ref));
}

/** @returns {{file: string, rule: string} | null} */
export function relevanceOf(file, refs) {
  if (ALWAYS_RELEVANT_PREFIXES.some((p) => file === p || file.startsWith(p))) return { file, rule: "altid relevant" };
  if (ANY_TEST_FILE_RE.test(file)) return { file, rule: "testfil (promisedTestFilesExist laeser alle testfil-navne)" };
  for (const { ref, cut } of refs) {
    if (file === ref || file.startsWith(`${ref}/`) || (cut && file.startsWith(ref))) {
      return { file, rule: `naevnt af backend-kode: ${ref}${cut ? " (dynamisk, hele praefikset)" : ""}` };
    }
  }
  return null;
}

/** @param {string[]} files @param {{ref: string, cut: boolean}[]} refs */
export function classifyChangedFiles(files, refs) {
  const reasons = [];
  for (const f of files) {
    const r = relevanceOf(f, refs);
    if (r) reasons.push(r);
  }
  // En tom filliste er ikke et bevis for "ingen aendringer" - koer.
  if (files.length === 0) return { needsBackend: true, reasons: [{ file: "(ingen)", rule: "tom filliste, koerer for sikkerheds skyld" }] };
  return { needsBackend: reasons.length > 0, reasons };
}

// ------------------------------------------------------------
// CLI
// ------------------------------------------------------------

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

async function main(argv) {
  const [command] = argv;
  if (command === "needs-backend") {
    const files = (await readStdin())
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const refs = collectBackendRelevantRefs(REPO_ROOT);
    const { needsBackend, reasons } = classifyChangedFiles(files, refs);
    process.stderr.write(`needs-backend: ${files.length} aendrede filer, ${reasons.length} relevante for backend-tests\n`);
    for (const r of reasons.slice(0, 20)) process.stderr.write(`  ${r.file}: ${r.rule}\n`);
    process.stdout.write(needsBackend ? "true\n" : "false\n");
    return 0;
  }
  if (command === "verify") {
    const dir = argValue(argv, "--logs-dir");
    if (!dir) {
      process.stderr.write("verify kraever --logs-dir <dir>\n");
      return 2;
    }
    const discovered = discoverBackendTestFiles(path.join(REPO_ROOT, "backend"));
    const result = verifyShardLogs({ discovered, logs: readShardLogs(dir) });
    const summary = formatVerifySummary(result);
    process.stdout.write(summary);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    return result.ok ? 0 : 1;
  }
  if (command === "refs") {
    for (const r of collectBackendRelevantRefs(REPO_ROOT)) process.stdout.write(`${r.cut ? "prefix" : "exact "}\t${r.ref}\n`);
    return 0;
  }
  process.stderr.write("brug: backend-test-shards.mjs needs-backend|verify --logs-dir <dir>|refs\n");
  return 2;
}

const invokedDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
