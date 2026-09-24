#!/usr/bin/env node
// Kontakt-vagt (#5507) - "faerdig bag kontakt" skal betyde "kan taendes".
//
// FEJLKLASSEN: en kontakt bliver merget, men en af dens ender mangler, saa den
// ikke kan taendes eller ikke goer noget naar den bliver det. 23/9 stod 16
// kontakter slukket i prod, og mindst 8 af dem kunne ikke taendes:
//   - PR #5503 eksporterede en *_FLAG_KEY som ingen laeste, uden migration og
//     uden en test med kontakten taendt.
//   - PR #5446 indfoerte en model-kontakt der kun daekkede 2 af 5 laesere
//     (postmortem .claude/learnings/2026-09-20-ny-kontakt-glemte-laesere-og-raa-tal.md).
//
// HVAD DEN TJEKKER - for hver noegle i STAGE_FLAGS (backend/lib/stageFlagCatalog.js)
// og hver eksporteret *_FLAG_KEY i backend/ og frontend/:
//   reader     mindst een laeser i produktionskode uden for *.test.*/tests/,
//              preview-mocken, scripts og kataloget selv. En laeser er en fil
//              der naevner noeglen/konstanten, ELLER som kalder en eksporteret
//              funktion i noeglens hjemmemodul, der (transitivt) laeser den.
//   migration  en database/*.sql med `INSERT INTO app_config` der naevner
//              noeglen, saa raekken findes og kan flippes. Kun filer direkte i
//              database/ - manual/, proposals/ og seed/ auto-applies ikke.
//   test-on    mindst een test der naevner noeglen/konstanten/laese-funktionen
//              med en "on"-vaerdi (`"on"`, `"beta"`, `true`, `: on`) inden for
//              3 linjer.
//
// KENDT GAELD staar i scripts/flag-liveness-baseline.json, saa vagten kan blive
// blokerende uden at vaelte CI paa dag et. Kun NYE huller fejler. Et hul der er
// lukket, men stadig staar i baselinen, meldes som "fjern fra baselinen".
//
// RATCHET (--baseline-base <ref>): baselinen maa kun skrumpe. Hvert
// (noegle, check)-par i baseline-filen, som ikke stod i filen paa <ref>, er et
// nyt hul der er lovliggjort (fx med --write-baseline), og giver exit 1.
// done-guard.yml koerer det mod PR'ens base-commit. Findes filen ikke paa
// <ref>, springes ratchet'en over (den PR der indfoerer baselinen).
//
// STATUS: advarsel foerst. .github/workflows/done-guard.yml koerer den med
// continue-on-error; trinnene til skiftet til blokerende (2026-10-01) staar i
// workflowets header - det er IKKE nok at fjerne continue-on-error (#5507).
//
// BEGRAENSNINGER (bevidste - heuristik, ikke en parser):
//   - En dynamisk laesning (noeglen bygget af strenge, eller laest generisk via
//     en liste i kataloget) ses ikke. Den slags kontakter hoerer i baselinen
//     med en begrundelse.
//   - "test-on" er et naerhedstjek, ikke et bevis for at testen koerer den
//     taendte gren. Den fanger fravaeret, ikke kvaliteten.
//
// BRUG:
//   node scripts/check-flag-liveness.mjs                 tabel + exit 1 ved nye huller
//   node scripts/check-flag-liveness.mjs --json          maskinlaesbart
//   node scripts/check-flag-liveness.mjs --write-baseline  skriv dagens huller som baseline
//                                                          (ratchet'en i CI fejler, hvis filen dermed vokser)
//   node scripts/check-flag-liveness.mjs --ref <sha>     doem et andet commit (baglaens)
//   node scripts/check-flag-liveness.mjs --baseline-base <ref>  ratchet: fejl hvis baselinen er vokset siden <ref>
//
// Refs #5507.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CATALOG_PATH = "backend/lib/stageFlagCatalog.js";
export const BASELINE_PATH = "scripts/flag-liveness-baseline.json";
export const CHECKS = Object.freeze(["reader", "migration", "test-on"]);

const CODE_EXT = /\.(?:js|mjs|cjs|jsx|ts|tsx)$/;
const IDENT = /[A-Za-z_$][\w$]*/g;
const DECL = /^(export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;
const ON_LITERAL = /(["'`])(?:on|beta)\1|\btrue\b|[:=]\s*on\b/;
const CATALOG_ASSERT = /isStageFlagKey|findStageFlag|STAGE_FLAGS/;
const NEAR_LINES = 3;

/**
 * Hvilken slags fil er det? Styrer hvad der taeller som laeser/test/mock.
 * @param {string} rawPath repo-relativ sti
 * @returns {"test"|"mock"|"script"|"docs"|"sql"|"prod"|"other"}
 */
export function classifyPath(rawPath) {
  const p = String(rawPath).replace(/\\/g, "/");
  if (p.startsWith("docs/")) return "docs";
  if (/\.sql$/i.test(p)) return "sql";
  if (!CODE_EXT.test(p)) return "other";
  if (/(^|\/)(tests?|__tests__|e2e)\//.test(p) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(p)) return "test";
  if (p.startsWith("frontend/src/preview/")) return "mock";
  if (/^(scripts|\.claude|\.github|backend\/scripts|frontend\/scripts)\//.test(p)) return "script";
  if (/^(backend|frontend|shared|api)\//.test(p)) return "prod";
  return "other";
}

// Blok-kommentarer fjernes kun, naar de STARTER en linje. En blok-kommentar-regex
// over hele filen aeder kode, naar en streng indeholder "/*" (fx "image/*") - saa
// forsvandt en aegte laeser i api.js i baglaens-koerslen mod PR #5446.
// `//`-kommentarer fjernes baade som hel linje og efter kode (`x(); // TODO FOO_FLAG_KEY`
// maa ikke goere filen til en laeser), men kun naar ingen streng er aaben foran
// `//` - saa "a // b" og "https://..." bliver staaende.
export function stripComments(text) {
  return String(text)
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/^(.*?\S)[ \t]+\/\/.*$/gm, (line, code) => (noOpenString(code) ? code : line));
}

function noOpenString(code) {
  let quote = null;
  for (let i = 0; i < code.length; i += 1) {
    const c = code[i];
    if (quote) {
      if (c === "\\") i += 1;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === "`") {
      quote = c;
    }
  }
  return quote === null;
}

function tokenSet(text) {
  return new Set(String(text).match(IDENT) || []);
}

/**
 * Byg et opslags-indeks over filerne een gang (token-saet pr. fil), saa ~40
 * noegler x ~3.500 filer ikke bliver 40 fulde regex-scanninger.
 * @param {Array<{path: string, text: string}>} files
 */
export function buildIndex(files) {
  const list = files.map((f) => {
    const path = String(f.path).replace(/\\/g, "/");
    const text = String(f.text ?? "");
    const kind = classifyPath(path);
    const tokens = kind === "prod" || kind === "test" || kind === "mock" || kind === "script" ? tokenSet(stripComments(text)) : null;
    return { path, text, kind, tokens };
  });
  const byPath = new Map(list.map((f) => [f.path, f]));
  return { files: list, byPath };
}

/** Noeglerne i STAGE_FLAGS, laest som tekst (virker ogsaa paa fixtures). */
export function parseStageFlagKeys(catalogText) {
  const text = String(catalogText || "");
  const start = text.indexOf("export const STAGE_FLAGS");
  if (start < 0) return [];
  const end = text.indexOf("]);", start);
  const block = text.slice(start, end < 0 ? undefined : end);
  return [...block.matchAll(/\bkey:\s*["']([a-z0-9_]+)["']/g)].map((m) => m[1]);
}

/** Alle `export const X_FLAG_KEY = "noegle"` i produktionskode. */
export function parseExportedFlagKeys(index) {
  const out = [];
  for (const f of index.files) {
    if (f.kind !== "prod") continue;
    for (const m of f.text.matchAll(/export\s+const\s+([A-Z][A-Z0-9_]*_FLAG_KEY)\s*=\s*["']([a-z0-9_]+)["']/g)) {
      out.push({ name: m[1], key: m[2], path: f.path });
    }
  }
  return out;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Del en modul-tekst i top-level-blokke (en deklaration til den naeste).
 * Groft, men nok til at foelge "denne eksporterede funktion laeser noeglen".
 */
export function topLevelBlocks(text) {
  const lines = String(text).split(/\r?\n/);
  const blocks = [];
  let cur = null;
  for (const line of lines) {
    const m = DECL.exec(line);
    if (m) {
      cur = { name: m[2], exported: Boolean(m[1]), lines: [line] };
      blocks.push(cur);
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  const exportList = new Set();
  for (const m of String(text).matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) exportList.add(name);
    }
  }
  return blocks.map((b) => ({
    name: b.name,
    exported: b.exported || exportList.has(b.name),
    body: stripComments(b.lines.join("\n")),
  }));
}

/**
 * Hvilke eksporterede navne i et hjemmemodul laeser (transitivt) et af tokens?
 * @param {string} text modulets kilde
 * @param {string[]} seeds noeglen + dens konstant-navne
 */
export function readerApi(text, seeds) {
  const blocks = topLevelBlocks(text);
  const tainted = new Set(seeds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const b of blocks) {
      if (tainted.has(b.name)) continue;
      const toks = tokenSet(b.body);
      for (const t of tainted) {
        if (toks.has(t)) {
          tainted.add(b.name);
          changed = true;
          break;
        }
      }
    }
  }
  return blocks.filter((b) => b.exported && tainted.has(b.name) && !seeds.includes(b.name)).map((b) => b.name);
}

function importsModule(text, homePath) {
  const base = homePath.split("/").pop().replace(CODE_EXT, "");
  return new RegExp(`["'\`][^"'\`]*\\b${escapeRe(base)}(?:\\.[cm]?[jt]sx?)?["'\`]`).test(text);
}

/**
 * Konstant-navne bundet til noeglen: `const NAVN = "noegle"` i produktionskode.
 * @returns {Array<{name: string, path: string}>}
 */
export function constantsFor(key, index) {
  const re = new RegExp(`\\bconst\\s+([A-Z][A-Z0-9_]*)\\s*=\\s*["'\`]${escapeRe(key)}["'\`]`, "g");
  const out = [];
  for (const f of index.files) {
    if (f.kind !== "prod" || !f.tokens || !f.tokens.has(key)) continue;
    for (const m of f.text.matchAll(re)) out.push({ name: m[1], path: f.path });
  }
  return out;
}

/**
 * Alle kaldesteder for en noegle i produktionskode (bruges ogsaa af
 * check-pr-claims.mjs til "list alle kaldesteder for en ny kontakt").
 * @returns {{key: string, homes: string[], constants: string[], api: string[], readers: string[], mentions: string[]}}
 */
export function findReaders(key, index, { catalogPath = CATALOG_PATH } = {}) {
  const constants = constantsFor(key, index);
  const constNames = [...new Set(constants.map((c) => c.name))];
  const homes = [...new Set(constants.map((c) => c.path))];
  const words = [key, ...constNames];
  const mentions = [];
  for (const f of index.files) {
    if (f.kind !== "prod" || f.path === catalogPath) continue;
    if (words.some((w) => f.tokens.has(w))) mentions.push(f.path);
  }
  const api = [];
  for (const h of homes) {
    const f = index.byPath.get(h);
    if (f) api.push(...readerApi(f.text, words).map((name) => ({ name, home: h })));
  }
  const readers = new Set(mentions.filter((p) => !homes.includes(p)));
  for (const f of index.files) {
    if (f.kind !== "prod" || f.path === catalogPath || homes.includes(f.path)) continue;
    for (const a of api) {
      if (f.tokens.has(a.name) && importsModule(f.text, a.home)) {
        readers.add(f.path);
        break;
      }
    }
  }
  return {
    key,
    homes,
    constants: constNames,
    api: [...new Set(api.map((a) => a.name))],
    readers: [...readers].sort(),
    mentions: mentions.sort(),
  };
}

// Kun SQL direkte i database/ taeller. database/manual/, proposals/ og seed/
// koeres ikke af auto-migrate.yml, saa en INSERT der kun staar der, giver ingen
// raekke i prod.
const APPLIED_SQL = /^database\/[^/]+\.sql$/i;

/** database/*.sql (ikke undermapper) der opretter app_config-raekken for noeglen. */
export function findMigrations(key, index) {
  const lit = `'${key}'`;
  return index.files
    .filter((f) => f.kind === "sql" && APPLIED_SQL.test(f.path) && f.text.includes(lit) && /insert\s+into\s+(?:public\.)?app_config\b/i.test(f.text))
    .map((f) => f.path)
    .sort();
}

/** Tests der naevner noeglen (eller konstant/laese-funktion) med en on-vaerdi taet paa. */
export function findTestsOn(words, index) {
  const out = [];
  for (const f of index.files) {
    if (f.kind !== "test" || !f.tokens || !words.some((w) => f.tokens.has(w))) continue;
    const lines = f.text.split(/\r?\n/);
    const hit = lines.some((line, i) => {
      if (!words.some((w) => new RegExp(`(?<![\\w$])${escapeRe(w)}(?![\\w$])`).test(line))) return false;
      for (let j = Math.max(0, i - NEAR_LINES); j <= Math.min(lines.length - 1, i + NEAR_LINES); j += 1) {
        if (ON_LITERAL.test(lines[j]) && !CATALOG_ASSERT.test(lines[j])) return true;
      }
      return false;
    });
    if (hit) out.push(f.path);
  }
  return out.sort();
}

/**
 * Doem hver noegle. Ren funktion over et indeks - testene bygger fixtures.
 * @param {ReturnType<typeof buildIndex>} index
 * @returns {Array<{key: string, sources: string[], gaps: string[], readers: string[], migrations: string[], testsOn: string[], homes: string[]}>}
 */
export function evaluateFlags(index, { catalogPath = CATALOG_PATH } = {}) {
  const sources = new Map();
  const add = (key, src) => {
    if (!sources.has(key)) sources.set(key, []);
    sources.get(key).push(src);
  };
  const catalog = index.byPath.get(catalogPath);
  for (const key of parseStageFlagKeys(catalog ? catalog.text : "")) add(key, "STAGE_FLAGS");
  for (const e of parseExportedFlagKeys(index)) add(e.key, `${e.name} (${e.path})`);

  const rows = [];
  for (const [key, src] of [...sources.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const r = findReaders(key, index, { catalogPath });
    const migrations = findMigrations(key, index);
    const testsOn = findTestsOn([key, ...r.constants, ...r.api], index);
    const gaps = [];
    if (r.readers.length === 0) gaps.push("reader");
    if (migrations.length === 0) gaps.push("migration");
    if (testsOn.length === 0) gaps.push("test-on");
    rows.push({ key, sources: src, gaps, readers: r.readers, migrations, testsOn, homes: r.homes });
  }
  return rows;
}

/**
 * Sammenlign med baselinen. Kun huller der IKKE staar der, er nye.
 * @param {ReturnType<typeof evaluateFlags>} rows
 * @param {{known?: Record<string, string[]>}} baseline
 */
export function compareToBaseline(rows, baseline) {
  const known = (baseline && baseline.known) || {};
  const newGaps = [];
  const closed = [];
  const seen = new Set();
  for (const r of rows) {
    seen.add(r.key);
    const allowed = new Set(known[r.key] || []);
    for (const g of r.gaps) if (!allowed.has(g)) newGaps.push({ key: r.key, check: g });
    for (const g of allowed) if (!r.gaps.includes(g)) closed.push({ key: r.key, check: g });
  }
  const orphaned = Object.keys(known).filter((k) => !seen.has(k)).sort();
  return { newGaps, closed, orphaned };
}

/**
 * Ratchet: de (noegle, check)-par der staar i head-baselinen, men ikke i
 * base-baselinen. Tom liste = baselinen er uaendret eller skrumpet.
 * @param {{known?: Record<string, string[]>}|null} baseBaseline
 * @param {{known?: Record<string, string[]>}|null} headBaseline
 * @returns {Array<{key: string, check: string}>}
 */
export function baselineGrowth(baseBaseline, headBaseline) {
  const base = (baseBaseline && baseBaseline.known) || {};
  const head = (headBaseline && headBaseline.known) || {};
  const out = [];
  for (const key of Object.keys(head).sort()) {
    const allowed = new Set(base[key] || []);
    for (const check of head[key] || []) if (!allowed.has(check)) out.push({ key, check });
  }
  return out;
}

/**
 * Baseline-filen som den stod paa et commit/ref (`git show <ref>:<sti>`).
 * Kaster hvis ref'en ikke er et kendt commit (fx en for flad checkout), saa
 * ratchet'en aldrig springes stille over.
 * @returns {{known?: Record<string, string[]>}|null} null hvis filen ikke findes paa ref'en
 */
export function readBaselineAt(root, ref, path = BASELINE_PATH) {
  try {
    execFileSync("git", ["-C", root, "cat-file", "-e", `${ref}^{commit}`], { stdio: "ignore" });
  } catch {
    throw new Error(`ukendt commit/ref "${ref}" - kan ikke laese ${path} der (for flad checkout?)`);
  }
  let text;
  try {
    text = execFileSync("git", ["-C", root, "show", `${ref}:${path}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
  return JSON.parse(text);
}

/**
 * Ratchet mod et base-commit: er baselinen vokset siden `ref`?
 * @returns {{ref: string, skipped: boolean, growth: Array<{key: string, check: string}>}}
 */
export function ratchetBaseline(root, ref, headBaseline) {
  const base = readBaselineAt(root, ref);
  if (base === null) return { ref, skipped: true, growth: [] };
  return { ref, skipped: false, growth: baselineGrowth(base, headBaseline) };
}

export function baselineFrom(rows, previous = {}) {
  const known = {};
  for (const r of rows) if (r.gaps.length > 0) known[r.key] = [...r.gaps];
  return {
    _comment:
      previous._comment ||
      "Kendt gaeld for scripts/check-flag-liveness.mjs (#5507). Kun huller der staar her, er tilladt. Lukker du et hul, saa slet det her (vagten melder det). Tilfoej ALDRIG et nyt hul uden ejer-go.",
    known,
  };
}

export const SCAN_DIRS = Object.freeze(["backend", "frontend", "database", "shared", "api"]);

function wanted(p) {
  return CODE_EXT.test(p) || /\.(?:sql|ya?ml|toml)$/i.test(p);
}

/** Arbejdstraeet (det der er checket ud). */
export function loadRepoFiles(root = ROOT, dirs = SCAN_DIRS) {
  const out = execFileSync("git", ["-C", root, "ls-files", "-z", "--", ...dirs], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out
    .split("\0")
    .filter(Boolean)
    .filter(wanted)
    .filter((p) => existsSync(join(root, p)))
    .map((p) => ({ path: p, text: readFileSync(join(root, p), "utf8") }));
}

/**
 * Et vilkaarligt commit/ref uden checkout (`git cat-file --batch`), fx main
 * eller en PR-head. Bruges til baglaens-koersler og af check-pr-claims.mjs.
 */
export function loadTreeFiles(root, ref, dirs = SCAN_DIRS) {
  const tree = execFileSync("git", ["-C", root, "ls-tree", "-r", "-z", ref, "--", ...dirs], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const entries = tree
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf("\t");
      const [, type, oid] = line.slice(0, tab).split(" ");
      return { type, oid, path: line.slice(tab + 1) };
    })
    .filter((e) => e.type === "blob" && wanted(e.path));
  if (entries.length === 0) return [];
  const buf = execFileSync("git", ["-C", root, "cat-file", "--batch"], {
    input: `${entries.map((e) => e.oid).join("\n")}\n`,
    maxBuffer: 1024 * 1024 * 1024,
  });
  const files = [];
  let pos = 0;
  for (const e of entries) {
    const nl = buf.indexOf(0x0a, pos);
    const size = Number(buf.slice(pos, nl).toString("utf8").split(" ")[2]);
    const start = nl + 1;
    files.push({ path: e.path, text: buf.slice(start, start + size).toString("utf8") });
    pos = start + size + 1;
  }
  return files;
}

function readBaseline(root) {
  const p = join(root, BASELINE_PATH);
  if (!existsSync(p)) return { known: {} };
  return JSON.parse(readFileSync(p, "utf8"));
}

function main(argv) {
  const args = new Set(argv);
  const refAt = argv.indexOf("--ref");
  const ref = refAt >= 0 ? argv[refAt + 1] : null;
  const index = buildIndex(ref ? loadTreeFiles(ROOT, ref) : loadRepoFiles(ROOT));
  const rows = evaluateFlags(index);
  // Med --ref doemmes commit'et mod DETS baseline, ikke arbejdstraeets.
  const baseline = ref ? readBaselineAt(ROOT, ref) || { known: {} } : readBaseline(ROOT);
  if (ref && args.has("--write-baseline")) {
    console.error("--write-baseline kan ikke kombineres med --ref.");
    return 2;
  }

  if (args.has("--write-baseline")) {
    writeFileSync(join(ROOT, BASELINE_PATH), `${JSON.stringify(baselineFrom(rows, baseline), null, 2)}\n`);
    console.log(`Skrev ${BASELINE_PATH} med ${rows.filter((r) => r.gaps.length).length} noegle(r) med huller.`);
    return 0;
  }

  // Ratchet mod base (#5507). En tom vaerdi (fx BASE_SHA uden PR-event) = slaaet fra.
  const baseAt = argv.indexOf("--baseline-base");
  const baselineBase = baseAt >= 0 && argv[baseAt + 1] && !argv[baseAt + 1].startsWith("--") ? argv[baseAt + 1] : null;
  let ratchet = null;
  if (baselineBase) {
    try {
      ratchet = ratchetBaseline(ROOT, baselineBase, baseline);
    } catch (err) {
      console.error(`Kontakt-vagt: ratchet'en kunne ikke koere - ${err.message}`);
      return 2;
    }
  }
  const grew = ratchet ? ratchet.growth.length > 0 : false;

  const cmp = compareToBaseline(rows, baseline);
  if (args.has("--json")) {
    console.log(JSON.stringify({ rows, ...cmp, ratchet }, null, 2));
    return cmp.newGaps.length > 0 || grew ? 1 : 0;
  }

  const gh = process.env.GITHUB_ACTIONS === "true";
  console.log(`Kontakt-vagt (#5507): ${rows.length} noegler, ${rows.filter((r) => r.gaps.length === 0).length} hele, ${rows.filter((r) => r.gaps.length > 0).length} med huller (baseline: ${Object.keys(baseline.known || {}).length}).`);
  console.log("");
  const w = Math.max(...rows.map((r) => r.key.length), 4);
  console.log(`${"noegle".padEnd(w)}  reader  migration  test-on  laesere`);
  for (const r of rows) {
    const cell = (c) => (r.gaps.includes(c) ? "MANGLER" : "ok");
    console.log(`${r.key.padEnd(w)}  ${cell("reader").padEnd(6)}  ${cell("migration").padEnd(9)}  ${cell("test-on").padEnd(7)}  ${r.readers.length}`);
  }
  console.log("");
  for (const c of cmp.closed) {
    const msg = `${c.key}: hullet "${c.check}" er lukket - slet det fra ${BASELINE_PATH}.`;
    console.log(gh ? `::notice title=Kontakt-vagt::${msg}` : `NOTE ${msg}`);
  }
  for (const k of cmp.orphaned) {
    const msg = `${k} staar i baselinen men findes ikke laengere - slet posten.`;
    console.log(gh ? `::notice title=Kontakt-vagt::${msg}` : `NOTE ${msg}`);
  }
  if (ratchet) {
    const short = ratchet.ref.slice(0, 12);
    if (ratchet.skipped) {
      const msg = `${BASELINE_PATH} findes ikke paa ${short} - ratchet'en springes over (den PR der indfoerer baselinen).`;
      console.log(gh ? `::notice title=Kontakt-vagt::${msg}` : `NOTE ${msg}`);
    } else if (!grew) {
      console.log(`Ratchet: ${BASELINE_PATH} er ikke vokset siden ${short}.`);
    }
    for (const g of ratchet.growth) {
      const msg = `${g.key}: "${g.check}" er tilfoejet til ${BASELINE_PATH} siden ${short} - baselinen maa kun skrumpe. Luk hullet i stedet; et nyt hul i baselinen kraever ejer-go.`;
      console.log(gh ? `::warning title=Kontakt-vagt ratchet (#5507)::${msg}` : `BASELINE VOKSER ${msg}`);
    }
  }
  if (cmp.newGaps.length === 0) {
    console.log("Ingen nye huller ud over baselinen.");
    return grew ? 1 : 0;
  }
  const why = { reader: "ingen laeser i produktionskode", migration: "ingen database/*.sql opretter app_config-raekken", "test-on": "ingen test med kontakten taendt" };
  for (const g of cmp.newGaps) {
    const msg = `${g.key}: ${why[g.check]} (${g.check}).`;
    console.log(gh ? `::warning title=Kontakt-vagt (#5507)::${msg}` : `NYT HUL ${msg}`);
  }
  console.log("");
  console.log(`${cmp.newGaps.length} nyt/nye hul(ler). "Faerdig bag kontakt" = kan taendes: laeser + migration + test med kontakten taendt.`);
  return 1;
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase();
if (isCli) process.exitCode = main(process.argv.slice(2));
