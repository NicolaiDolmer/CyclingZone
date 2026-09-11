#!/usr/bin/env node
// #5158 — skralde-gate ("ratchet") for TypeScript i kernen.
//
// HVORFOR: ejer-beslutningen 11/9 er A+ — slut-tilstanden er strict TypeScript
// for kernen (oekonomi, auktion, akademi/ejerskab, finalisering/scheduler), men
// UDEN en omskrivning. Det kraever en mekanik der goer det umuligt at gaa den
// forkerte vej, mens man konverterer i sit eget tempo:
//
//   1. Antallet af utjekkede .js-filer i en kerne-mappe maa ALDRIG stige.
//   2. Antallet af tsc-fejl pr. fil (checkJs, strict) maa ALDRIG stige.
//   3. En NY .js-fil i en kerne-mappe er en fejl — skriv den i TypeScript.
//
// Falder et tal, siger gaten det hoejt ("baseline kan saenkes") og
// --update-baseline skriver de nye tal. Den retter ALDRIG baseline af sig selv:
// et menneske (eller en agent) skal committe saenkningen, ellers kan en
// forbedring rulle tilbage ubemaerket.
//
// Kerne-listen er DATA, ikke kode: scripts/ts-core-ratchet-baseline.json.
// backend/tsconfig.core.json skal have praecis de samme globs i "include" —
// divergerer de to, fejler gaten med det samme (en glob der kun staar det ene
// sted er et hul i daekningen, ikke en detalje).
//
// BEMAERK om raekkevidde: tsc type-checker hele programmet, dvs. ogsaa filer
// der bliver importeret ind fra kerne-filerne uden selv at vaere kerne. Gaten
// taeller KUN fejl i filer der matcher en kerne-glob. Det er med vilje: ellers
// ville en aendring i en vilkaarlig importeret hjaelpefil kunne faelde gaten i
// en PR der slet ikke roerer kernen.
//
// Brug:
//   node scripts/check-ts-core-ratchet.mjs                  # gate (CI)
//   node scripts/check-ts-core-ratchet.mjs --update-baseline # skriv nye tal
//   node scripts/check-ts-core-ratchet.mjs --json            # maskinlaesbart
//
// Se docs/TYPESCRIPT_DIRECTION.md for beslutningen og konverterings-opskriften.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const BASELINE_PATH = path.join(HERE, "ts-core-ratchet-baseline.json");

// ---------------------------------------------------------------------------
// Rene funktioner (unit-testbare uden at koere tsc)
// ---------------------------------------------------------------------------

/**
 * Oversaetter en tsconfig-agtig glob til et regulaert udtryk.
 * `*` matcher alt undtagen `/`; `**` matcher paa tvaers af mapper.
 * Globs er MED VILJE uden filendelse, saa `lib/economy*` daekker baade
 * economyEngine.js og economyEngine.ts (se tsconfig.core.json).
 */
export function globToRegExp(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i += 1;
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  return new RegExp(`^${out}$`);
}

/** Normaliserer til posix-separatorer, saa Windows og CI giver samme noegler. */
export function toPosix(p) {
  return p.split(path.sep).join("/").split("\\").join("/");
}

/** En fil er en test-fil hvis den ender paa .test.js/.test.ts osv. */
export function isTestFile(relPath) {
  return /\.test\.[cm]?[jt]sx?$/.test(relPath);
}

/** Kun .js-varianter taeller som "utjekket JS" i skraldespanden. */
export function isJsFile(relPath) {
  return /\.[cm]?jsx?$/.test(relPath);
}

/**
 * Fordeler filer paa omraader. Et omraade "ejer" en fil ved FOERSTE match, saa
 * tallene forbliver disjunkte (auctionFinalization.js hoerer til auktion, ikke
 * til finalisering, selvom begge globs kunne matche).
 */
export function assignArea(relPath, areas) {
  for (const [areaId, area] of Object.entries(areas)) {
    for (const glob of area.globs) {
      if (globToRegExp(glob).test(relPath)) return areaId;
    }
  }
  return null;
}

/**
 * Parser `tsc --pretty false`-output til { relPath: antalFejl }.
 * Fortsaettelseslinjer (indrykkede forklaringer) taelles IKKE med.
 */
export function parseTscErrors(stdout) {
  const counts = new Map();
  const re = /^(\S[^(]*)\((\d+),(\d+)\): error TS\d+:/;
  for (const rawLine of String(stdout).split(/\r?\n/)) {
    const m = re.exec(rawLine);
    if (!m) continue;
    const rel = toPosix(m[1]);
    counts.set(rel, (counts.get(rel) ?? 0) + 1);
  }
  return counts;
}

/**
 * Kernen i gaten. Rent input -> rent resultat, saa den kan testes med fixtures.
 *
 * @param {object} args
 * @param {object} args.baseline  indholdet af ts-core-ratchet-baseline.json
 * @param {string[]} args.files   kerne-filer der findes NU (backend-relative)
 * @param {Map<string, number>} args.errors  fejl pr. fil fra tsc (alle filer)
 * @returns {{ok: boolean, failures: string[], improvements: string[], next: object}}
 */
export function evaluateRatchet({ baseline, files, errors }) {
  const failures = [];
  const improvements = [];
  const areas = baseline.areas;

  /** Nyt baseline-objekt bygget af den faktiske tilstand. */
  const next = {
    ...baseline,
    areas: Object.fromEntries(
      Object.entries(areas).map(([id, area]) => [
        id,
        { ...area, jsFileCount: 0, tsErrorCount: 0, files: {} },
      ]),
    ),
  };

  const seen = new Set();

  for (const rel of [...files].sort()) {
    const areaId = assignArea(rel, areas);
    if (!areaId) continue;
    seen.add(rel);
    const errorCount = errors.get(rel) ?? 0;
    const area = next.areas[areaId];
    area.files[rel] = errorCount;
    if (isJsFile(rel)) area.jsFileCount += 1;
    area.tsErrorCount += errorCount;

    const baselineFiles = areas[areaId].files ?? {};
    if (!(rel in baselineFiles)) {
      if (isJsFile(rel)) {
        // Regel 3: nye filer i kernen skal vaere TypeScript.
        failures.push(
          `NY .js-fil i kerne-omraadet "${areaId}": ${rel} — skriv den i TypeScript (.ts). ` +
            `Kernen er paa vej mod strict TS; nye .js-filer goer vejen laengere. ` +
            `Se docs/TYPESCRIPT_DIRECTION.md.`,
        );
      } else if (errorCount > 0) {
        failures.push(
          `NY TypeScript-fil med fejl i "${areaId}": ${rel} har ${errorCount} tsc-fejl. ` +
            `Nye .ts-filer i kernen skal vaere fejlfri.`,
        );
      } else {
        improvements.push(`ny fejlfri TS-fil i "${areaId}": ${rel}`);
      }
      continue;
    }

    const before = baselineFiles[rel];
    if (errorCount > before) {
      failures.push(
        `${rel}: ${before} -> ${errorCount} tsc-fejl (+${errorCount - before}). ` +
          `Fejl i kernen maa aldrig stige.`,
      );
    } else if (errorCount < before) {
      improvements.push(`${rel}: ${before} -> ${errorCount} tsc-fejl`);
    }
  }

  // Filer der er forsvundet (slettet eller konverteret .js -> .ts) er altid
  // en forbedring — men de skal ud af baseline, ellers kan de snige sig ind
  // igen uden at nogen opdager det.
  for (const area of Object.values(areas)) {
    for (const rel of Object.keys(area.files ?? {})) {
      if (!seen.has(rel)) {
        improvements.push(`${rel}: ude af kernen (slettet eller konverteret)`);
      }
    }
  }

  // Omraade-totaler. Per-fil-checket ovenfor fanger det meste, men totalerne
  // fanger ogsaa "en fil blev sletttet og en ny med samme fejl kom ind".
  for (const [areaId, area] of Object.entries(areas)) {
    const now = next.areas[areaId];
    if (now.jsFileCount > area.jsFileCount) {
      failures.push(
        `omraade "${areaId}": ${area.jsFileCount} -> ${now.jsFileCount} .js-filer. ` +
          `Antallet af utjekkede JS-filer i kernen maa aldrig stige.`,
      );
    } else if (now.jsFileCount < area.jsFileCount) {
      improvements.push(
        `omraade "${areaId}": ${area.jsFileCount} -> ${now.jsFileCount} .js-filer`,
      );
    }
    if (now.tsErrorCount > area.tsErrorCount) {
      failures.push(
        `omraade "${areaId}": ${area.tsErrorCount} -> ${now.tsErrorCount} tsc-fejl.`,
      );
    }
  }

  next.totals = {
    jsFileCount: Object.values(next.areas).reduce((a, x) => a + x.jsFileCount, 0),
    tsErrorCount: Object.values(next.areas).reduce((a, x) => a + x.tsErrorCount, 0),
  };

  return { ok: failures.length === 0, failures, improvements, next };
}

/**
 * tsconfig.core.json's include SKAL vaere praecis unionen af omraade-globs.
 * En glob der kun staar det ene sted er et hul: enten checkes filer der ikke
 * ratchettes, eller ratchettes filer der ikke checkes.
 */
export function diffGlobs(baselineAreas, tsconfigInclude) {
  const fromBaseline = new Set(
    Object.values(baselineAreas).flatMap((a) => a.globs),
  );
  const fromTsconfig = new Set(tsconfigInclude);
  const missingInTsconfig = [...fromBaseline].filter((g) => !fromTsconfig.has(g));
  const missingInBaseline = [...fromTsconfig].filter((g) => !fromBaseline.has(g));
  return { missingInTsconfig, missingInBaseline };
}

// ---------------------------------------------------------------------------
// I/O-laget
// ---------------------------------------------------------------------------

/** Minimal JSONC-laesning: tsconfig.core.json har `//`-kommentarer. */
export function parseJsonc(text) {
  const stripped = text
    .split(/\r?\n/)
    .map((line) => {
      // Naiv, men tilstraekkelig: vi ejer filen, og den har ingen `//` i
      // strengvaerdier. Ville den faa det, faelder JSON.parse med det samme.
      const idx = line.indexOf("//");
      if (idx === -1) return line;
      return line.slice(0, idx);
    })
    .join("\n");
  return JSON.parse(stripped);
}

/** Alle filer under backend/ der matcher mindst een kerne-glob. */
export function listCoreFiles(backendDir, areas) {
  const globs = Object.values(areas).flatMap((a) => a.globs);
  const dirs = new Set(
    globs.map((g) => {
      const idx = g.lastIndexOf("/");
      return idx === -1 ? "" : g.slice(0, idx);
    }),
  );
  const found = [];
  for (const dir of dirs) {
    const abs = path.join(backendDir, dir);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (isTestFile(rel)) continue;
      if (!/\.[cm]?[jt]sx?$/.test(rel)) continue;
      if (globs.some((g) => globToRegExp(g).test(rel))) found.push(rel);
    }
  }
  return [...new Set(found)].sort();
}

function runTsc(backendDir) {
  // Kald compileren via dens node-entrypoint i stedet for `npx`: npx er en
  // .cmd-shim paa Windows, og execFileSync uden shell kan ikke starte den.
  const tscEntry = path.join(backendDir, "node_modules", "typescript", "bin", "tsc");
  if (!fs.existsSync(tscEntry)) {
    throw new Error(
      `Fandt ikke ${toPosix(tscEntry)} — koer npm ci i backend/ foerst.`,
    );
  }
  try {
    const stdout = execFileSync(
      process.execPath,
      [tscEntry, "-p", "tsconfig.core.json", "--pretty", "false"],
      { cwd: backendDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return stdout;
  } catch (err) {
    // tsc afslutter med kode 1 naar der er fejl — det er den FORVENTEDE vej
    // her: baseline er i dag > 0 fejl. Kun manglende output er en rigtig fejl.
    const stdout = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    if (!stdout.trim()) {
      throw new Error(
        `tsc gav hverken output eller fejl-linjer (exit ${err.status}). ` +
          `Er backend/node_modules installeret?`,
      );
    }
    return stdout;
  }
}

function main() {
  const args = process.argv.slice(2);
  const updateBaseline = args.includes("--update-baseline");
  const asJson = args.includes("--json");

  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  const backendDir = path.join(REPO_ROOT, "backend");
  const tsconfigPath = path.join(backendDir, "tsconfig.core.json");
  const tsconfig = parseJsonc(fs.readFileSync(tsconfigPath, "utf8"));

  const globDiff = diffGlobs(baseline.areas, tsconfig.include ?? []);
  if (globDiff.missingInTsconfig.length || globDiff.missingInBaseline.length) {
    console.error("FEJL: kerne-globs divergerer mellem baseline og tsconfig.");
    for (const g of globDiff.missingInTsconfig) {
      console.error(`  mangler i backend/tsconfig.core.json include: ${g}`);
    }
    for (const g of globDiff.missingInBaseline) {
      console.error(`  mangler i scripts/ts-core-ratchet-baseline.json: ${g}`);
    }
    process.exit(1);
  }

  const files = listCoreFiles(backendDir, baseline.areas);
  const errors = parseTscErrors(runTsc(backendDir));
  const result = evaluateRatchet({ baseline, files, errors });

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  }

  if (result.improvements.length) {
    console.log(
      `Skralde-gaten kan saenkes (${result.improvements.length} forbedringer):`,
    );
    for (const line of result.improvements.slice(0, 40)) console.log(`  ${line}`);
    if (result.improvements.length > 40) {
      console.log(`  ... og ${result.improvements.length - 40} mere`);
    }
    console.log(
      "  Koer: node scripts/check-ts-core-ratchet.mjs --update-baseline (og commit resultatet)",
    );
  }

  if (updateBaseline) {
    const next = { ...result.next, generatedAt: new Date().toISOString().slice(0, 10) };
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    console.log(
      `Baseline skrevet: ${next.totals.jsFileCount} .js-filer, ${next.totals.tsErrorCount} tsc-fejl i kernen.`,
    );
    process.exit(0);
  }

  if (!result.ok) {
    console.error("");
    console.error("TypeScript-skralde-gaten fejler (#5158):");
    for (const line of result.failures) console.error(`  - ${line}`);
    console.error("");
    console.error(
      "Kernen bevaeger sig mod strict TypeScript. Tallene maa falde, aldrig stige.",
    );
    console.error("Baggrund + opskrift: docs/TYPESCRIPT_DIRECTION.md");
    process.exit(1);
  }

  console.log(
    `TypeScript-skralde-gaten er groen: ${result.next.totals.jsFileCount} .js-filer, ` +
      `${result.next.totals.tsErrorCount} tsc-fejl i kernen (baseline: ` +
      `${baseline.totals.jsFileCount} / ${baseline.totals.tsErrorCount}).`,
  );
}

// Koer kun gaten naar filen er entrypoint — test-filen importerer de rene
// funktioner herfra og maa ikke starte en tsc-koersel som sideeffekt.
if (process.argv[1] && path.basename(process.argv[1]) === "check-ts-core-ratchet.mjs") {
  main();
}
