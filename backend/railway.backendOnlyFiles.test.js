// backend/railway.backendOnlyFiles.test.js
// #6367: Railway bygger backenden med root directory /backend. Alt uden for backend/
// (docs/, scripts/, database/, frontend/ ...) findes ikke i prod. Lokalt og i CI er
// hele repoet tjekket ud, saa en sti som join(__dirname, "..", "..", "docs", ...) virker
// overalt UNDTAGEN i prod. Det ramte S5-kalendergaten (benchmark-JSON i docs/, #6639).
//
// Vagten: start i Railways egne entrypoints (startCommand i railway.json), foelg ALLE
// relative imports transitivt (statiske, import("...") og specifier-strenge som
// "./engine/v4/index.ts"), og fejl hvis et modul serveren faktisk loader
//   1. importerer et modul uden for backend/, eller
//   2. bygger en filsti der forlader backend/: en relativ streng ("../../docs/x.json",
//      new URL("../../x", import.meta.url)) eller join/resolve fra modulets egen mappe
//      (__dirname, import.meta.dirname eller en konstant afledt af dem).
// CLI-scripts der ikke importeres af runtime (fx backend/scripts/dev/) maa gerne laese
// uden for backend/; de koeres lokalt. Moduler under backend/scripts/ der importeres af
// runtime (routes/api.js -> ../scripts/marketValueLevelCorrectionApply.js) tjekkes som
// alt andet runtime-kode.
//
// Testen er statisk (laeser kildekode, importerer intet), saa den ogsaa daekker kode
// bag slukkede flag og dynamiske imports, der aldrig koerer i en test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BACKEND_ROOT = dirname(fileURLToPath(import.meta.url));
const CODE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts"]);
const MODULE_EXTENSIONS = new Set([...CODE_EXTENSIONS, ".json"]);

// Undtagelser: "<fil relativt til backend/>": "begrundelse". Kun for en sti der
// BEVISELIGT aldrig laeses i prod (fx kun i en CLI-main-blok). Tom er maalet.
const ALLOWED = Object.freeze({});

function isInside(root, p) {
  const rel = relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// Fjerner kommentarer og regex-literaler (JSDoc-typer som import("./x.js") og
// regex'er med "../" maa ikke taelle), men bevarer strenge og template-literaler.
export function stripComments(src) {
  let out = "";
  let i = 0;
  let lastSignificant = "";
  const templateDepth = [];
  const regexMayStart = () => lastSignificant === "" || "(,=:[!&|?{};+-*%<>~^".includes(lastSignificant)
    || /\b(return|typeof|case|do|else|in|of|void|yield|await)$/.test(out.slice(-16).trimEnd());
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      out += " ";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\") j++;
        else if (c === "`" && src[j] === "$" && src[j + 1] === "{") break;
        else if (c !== "`" && src[j] === "\n") break;
        j++;
      }
      if (c === "`" && src[j] === "$") {
        out += src.slice(i, j + 2);
        templateDepth.push(0);
        i = j + 2;
        lastSignificant = "{";
        continue;
      }
      out += src.slice(i, j + 1);
      i = j + 1;
      lastSignificant = c;
      continue;
    }
    if (templateDepth.length > 0) {
      if (c === "{") templateDepth[templateDepth.length - 1]++;
      if (c === "}") {
        if (templateDepth[templateDepth.length - 1] === 0) {
          templateDepth.pop();
          // Fortsaet template-literalen efter ${...}.
          let j = i + 1;
          while (j < src.length && src[j] !== "`") {
            if (src[j] === "\\") j++;
            else if (src[j] === "$" && src[j + 1] === "{") break;
            j++;
          }
          if (src[j] === "$") {
            out += src.slice(i, j + 2);
            templateDepth.push(0);
            i = j + 2;
            lastSignificant = "{";
          } else {
            out += src.slice(i, j + 1);
            i = j + 1;
            lastSignificant = "`";
          }
          continue;
        }
        templateDepth[templateDepth.length - 1]--;
      }
    }
    if (c === "/" && regexMayStart()) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length && src[j] !== "\n") {
        if (src[j] === "\\") j++;
        else if (src[j] === "[") inClass = true;
        else if (src[j] === "]") inClass = false;
        else if (src[j] === "/" && !inClass) break;
        j++;
      }
      if (src[j] === "/") {
        out += "/r/";
        i = j + 1;
        while (/[a-z]/i.test(src[i] ?? "")) i++;
        lastSignificant = "/";
        continue;
      }
    }
    out += c;
    if (!/\s/.test(c)) lastSignificant = c;
    i++;
  }
  return out;
}

const STRING_LITERAL = String.raw`(?:"[^"\n]*"|'[^'\n]*'|\x60[^\x60$]*\x60)`;
const unquote = (lit) => lit.slice(1, -1);

// Navne der peger paa modulets egen mappe (eller en mappe afledt af den).
function collectDirBindings(code, moduleDir) {
  const dirs = new Map([["__dirname", moduleDir], ["import.meta.dirname", moduleDir]]);
  const fromUrl = /\b(?:const|let|var)\s+([\w$]+)\s*=\s*(?:path\.)?dirname\(\s*(?:url\.)?fileURLToPath\(\s*import\.meta\.url\s*\)\s*\)/g;
  for (const m of code.matchAll(fromUrl)) dirs.set(m[1], moduleDir);
  const urlDir = /\b(?:const|let|var)\s+([\w$]+)\s*=\s*(?:url\.)?fileURLToPath\(\s*new URL\(\s*(STRING)\s*,\s*import\.meta\.url\s*\)\s*\)/g;
  for (const m of code.matchAll(new RegExp(urlDir.source.replace("STRING", STRING_LITERAL), "g"))) {
    dirs.set(m[1], resolve(moduleDir, unquote(m[2])));
  }
  // const ROOT = join(__dirname, "..") osv. - gentag til fixpunkt, saa kaeder virker.
  const derived = new RegExp(String.raw`\b(?:const|let|var)\s+([\w$]+)\s*=\s*(?:path\.)?(?:join|resolve)\(\s*([\w$.]+)\s*((?:,\s*${STRING_LITERAL}\s*)+)\)`, "g");
  for (let changed = true; changed;) {
    changed = false;
    for (const m of code.matchAll(derived)) {
      if (dirs.has(m[1]) || !dirs.has(m[2])) continue;
      const parts = [...m[3].matchAll(new RegExp(STRING_LITERAL, "g"))].map((x) => unquote(x[0]));
      dirs.set(m[1], resolve(dirs.get(m[2]), ...parts));
      changed = true;
    }
  }
  return dirs;
}

/**
 * Foelg runtime-importgrafen fra entrypoints og returnér { modules, violations }.
 * @param {string} root  backend-roden (eller en test-fixture)
 * @param {string[]} entrypoints  stier relativt til root
 */
export function scanBackendOnlyFiles(root, entrypoints, allowed = {}) {
  const violations = [];
  const seen = new Set();
  const queue = entrypoints.map((e) => resolve(root, e));
  const report = (file, detail) => {
    const rel = relative(root, file).replaceAll("\\", "/");
    if (allowed[rel]) return;
    violations.push(`${rel}: ${detail}`);
  };

  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!existsSync(file)) {
      violations.push(`${relative(root, file).replaceAll("\\", "/")}: entrypoint/import findes ikke`);
      continue;
    }
    const moduleDir = dirname(file);
    const code = stripComments(readFileSync(file, "utf8"));
    const dirs = collectDirBindings(code, moduleDir);

    // 1+2a: enhver relativ streng ("./x.js", "../../docs/y.json", new URL("../..", ...)).
    for (const m of code.matchAll(new RegExp(STRING_LITERAL, "g"))) {
      const value = unquote(m[0]);
      if (!/^\.\.?\//.test(value) && value !== "..") continue;
      const target = resolve(moduleDir, value);
      if (!isInside(root, target)) {
        report(file, `sti "${value}" peger uden for backend/ (${relative(root, target).replaceAll("\\", "/")})`);
        continue;
      }
      const ext = extname(target);
      if (MODULE_EXTENSIONS.has(ext) && existsSync(target) && CODE_EXTENSIONS.has(ext)) queue.push(target);
    }

    // 2b: join/resolve(<modulmappe>, "..", "..", "docs", ...).
    const joinCall = new RegExp(String.raw`\b(?:join|resolve)\(\s*([\w$.]+)\s*((?:,\s*${STRING_LITERAL}\s*)+)[,)]`, "g");
    for (const m of code.matchAll(joinCall)) {
      if (!dirs.has(m[1])) continue;
      const parts = [...m[2].matchAll(new RegExp(STRING_LITERAL, "g"))].map((x) => unquote(x[0]));
      const target = resolve(dirs.get(m[1]), ...parts);
      if (!isInside(root, target)) {
        report(file, `${m[0].replace(/[,)]$/, ")")} peger uden for backend/ (${relative(root, target).replaceAll("\\", "/")})`);
      }
    }
  }
  return { modules: [...seen].map((f) => relative(root, f).replaceAll("\\", "/")).sort(), violations: [...new Set(violations)] };
}

function railwayEntrypoints() {
  const config = JSON.parse(readFileSync(join(BACKEND_ROOT, "railway.json"), "utf8"));
  const start = config.deploy?.startCommand ?? "";
  return [...start.matchAll(/(?:^|\s)(?:\.\/)?([\w./-]+\.(?:m?js|ts))\b/g)].map((m) => m[1]);
}

test("#6367: Railway-entrypoints udledes af railway.json (server.js + instrument.mjs)", () => {
  const entrypoints = railwayEntrypoints();
  assert.ok(entrypoints.includes("server.js"), `startCommand skal starte server.js, fandt ${entrypoints}`);
  assert.ok(entrypoints.includes("instrument.mjs"), `startCommand skal preloade instrument.mjs, fandt ${entrypoints}`);
});

test("#6367: intet modul serveren loader laeser eller importerer en fil uden for backend/", () => {
  const { modules, violations } = scanBackendOnlyFiles(BACKEND_ROOT, railwayEntrypoints(), ALLOWED);
  // Sanity: grafen naar faktisk ud i cron, routes, runtime-importerede scripts og v4-motoren.
  for (const expected of ["cron.js", "routes/api.js", "lib/s5BenchmarkGate.js", "scripts/marketValueLevelCorrectionApply.js", "scripts/fitMarketValueModelV2.js", "lib/engine/v4/index.ts"]) {
    assert.ok(modules.includes(expected), `importgrafen naaede ikke ${expected} (${modules.length} moduler) - er scanneren gaaet i stykker?`);
  }
  assert.deepEqual(violations, [], [
    "Runtime-kode peger paa filer uden for backend/. Railway bygger kun backend/, saa de findes ikke i prod.",
    "Flyt data ind under backend/ (fx backend/lib/__fixtures__/), se docs/DEPLOYMENT.md \"Backend ser kun backend/\".",
    ...violations,
  ].join("\n"));
});

test("#6367: ALLOWED-undtagelser peger paa moduler der stadig findes", () => {
  for (const rel of Object.keys(ALLOWED)) assert.ok(existsSync(join(BACKEND_ROOT, rel)), `${rel} findes ikke - fjern undtagelsen`);
});

// Negativ proeve: vagten skal kunne fejle. Bygger en mini-backend i tmp med hver
// fejlklasse og et lovligt CLI-script, og kraever at netop de ulovlige fanges.
test("#6367: vagten fanger hver fejlklasse og lader CLI-scripts vaere", () => {
  const repo = mkdtempSync(join(tmpdir(), "backend-only-"));
  const root = join(repo, "backend");
  const write = (rel, src) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), src);
  };
  try {
    write("server.js", [
      'import "./lib/a.js";',
      'import { b } from "./routes/b.js";',
      "// import \"../../docs/kommentar.js\" maa ikke taelle",
      "const re = /\\.\\.\\/\\.\\.\\//; // heller ikke en regex",
    ].join("\n"));
    write("lib/a.js", [
      'import { dirname, join } from "node:path";',
      'import { fileURLToPath } from "node:url";',
      "const __dirname = dirname(fileURLToPath(import.meta.url));",
      'export const BENCH = join(__dirname, "..", "..", "docs", "bench.json");',
      'const ROOT = join(__dirname, "..");',
      'export const VIA_ROOT = join(ROOT, "..", "database", "x.sql");',
      'export const OK = join(__dirname, "__fixtures__", "ok.json");',
      'export const load = () => import("./lazy.js");',
    ].join("\n"));
    write("lib/lazy.js", 'export const U = new URL("../../docs/u.json", import.meta.url);\n');
    write("routes/b.js", 'export * from "../scripts/runtimeHelper.js";\nexport const b = 1;\n');
    write("scripts/runtimeHelper.js", 'import "../../scripts/shared.js";\n');
    write("scripts/dev/cli.js", 'import { readFileSync } from "node:fs";\nreadFileSync("../../../docs/cli.json");\n');

    const { modules, violations } = scanBackendOnlyFiles(root, ["server.js"]);
    assert.ok(!modules.includes("scripts/dev/cli.js"), "CLI-script der ikke importeres af runtime maa ikke scannes");
    const hit = (file, needle) => violations.some((v) => v.startsWith(`${file}:`) && v.includes(needle));
    assert.ok(hit("lib/a.js", "docs"), `join(__dirname, "..", "..", "docs") ikke fanget: ${violations.join(" | ")}`);
    assert.ok(hit("lib/a.js", "database"), `afledt ROOT + ".." ikke fanget: ${violations.join(" | ")}`);
    assert.ok(hit("lib/lazy.js", "docs/u.json"), `new URL("../../docs") i dynamisk importeret modul ikke fanget: ${violations.join(" | ")}`);
    assert.ok(hit("scripts/runtimeHelper.js", "scripts/shared.js"), `runtime-importeret script der importerer uden for backend/ ikke fanget: ${violations.join(" | ")}`);
    assert.ok(!violations.some((v) => v.startsWith("server.js:")), `kommentar/regex gav falsk alarm: ${violations.join(" | ")}`);
    assert.ok(!violations.some((v) => v.includes("ok.json")), `lovlig sti under backend/ gav falsk alarm: ${violations.join(" | ")}`);
    assert.equal(violations.length, 4, violations.join("\n"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
