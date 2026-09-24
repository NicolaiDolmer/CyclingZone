// #5568: drift-vagt + forward-guard for ungdomstruppernes loft (U23 / junior).
//
// 1. DRIFT: frontend/src/lib/squadCaps.ts er frontendens ENE spejl af
//    squads.js (SQUAD_CAPS, SQUAD_MAX_AGE.junior, ACADEMY_SQUAD_WHEN_AGE_UNKNOWN).
//    Testen læser frontend-filen som tekst og fejler, hvis et tal afviger.
//    Samme disciplin som rulesNumbers.test.js (#1604) og #4479-vagten: to
//    pakker kan ikke dele en build-import, så spejlet pinnes af en test.
//
// 2. FORWARD-GUARD: før #5568 talte budrummet, nedrykningsdialogen, akademi-
//    siden og bud-gaten i api.js mod et fladt akademi-loft på 8, mens RPC'erne
//    (siden #5547) talte pr. mål-trup. 27 hold med præcis 8 akademiryttere blev
//    stoppet uden grund. Testen fælder de former det gamle loft havde, hvis de
//    dukker op igen i frontend/src, backend/lib eller backend/routes, og det
//    gamle "8 pladser" i spillertekster.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { SQUAD_CAPS, SQUAD_MAX_AGE, ACADEMY_SQUAD_WHEN_AGE_UNKNOWN } from "./squads.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");
const FRONTEND_CAPS_FILE = join(REPO, "frontend", "src", "lib", "squadCaps.ts");
const frontendCaps = readFileSync(FRONTEND_CAPS_FILE, "utf8");

function parseFrontendSquadCaps(source) {
  const block = /export const SQUAD_CAPS\b[^=]*=\s*Object\.freeze\(\{([^}]*)\}\)/.exec(source);
  assert.ok(block, "squadCaps.ts skal definere `export const SQUAD_CAPS = Object.freeze({ ... })`");
  const caps = {};
  for (const m of block[1].matchAll(/(\w+)\s*:\s*(\d+)/g)) caps[m[1]] = Number(m[2]);
  return caps;
}

test("drift: frontend SQUAD_CAPS er identisk med backend squads.js SQUAD_CAPS", () => {
  assert.deepEqual(parseFrontendSquadCaps(frontendCaps), { ...SQUAD_CAPS });
});

test("drift: frontendens junior-aldersgrænse er identisk med SQUAD_MAX_AGE.junior", () => {
  const m = /export const JUNIOR_MAX_SEASON_AGE\s*=\s*(\d+)\s*;/.exec(frontendCaps);
  assert.ok(m, "squadCaps.ts skal definere JUNIOR_MAX_SEASON_AGE som et heltal");
  assert.equal(Number(m[1]), SQUAD_MAX_AGE.junior);
});

test("drift: trup ved ukendt alder er identisk med backend ACADEMY_SQUAD_WHEN_AGE_UNKNOWN", () => {
  const m = /export const ACADEMY_SQUAD_WHEN_AGE_UNKNOWN\b[^=]*=\s*"(\w+)"/.exec(frontendCaps);
  assert.ok(m, "squadCaps.ts skal definere ACADEMY_SQUAD_WHEN_AGE_UNKNOWN");
  assert.equal(m[1], ACADEMY_SQUAD_WHEN_AGE_UNKNOWN);
});

// ── Forward-guard ────────────────────────────────────────────────────────────

const CODE_ROOTS = [
  join(REPO, "frontend", "src"),
  join(REPO, "backend", "lib"),
  join(REPO, "backend", "routes"),
];
const CODE_EXT = /\.(js|jsx|mjs|ts|tsx)$/;
const SKIP_FILE = [
  /\.test\.(js|jsx|mjs|ts|tsx)$/, // tests må gerne bruge tal som fixtures
  /[\\/]data[\\/]patchNotes\.js$/, // historiske patch notes beskriver det gamle loft
];

// De to eneste steder et ungdoms-loft må stå som tal.
const CAP_SOURCES = new Set([
  join(REPO, "backend", "lib", "squads.js"),
  FRONTEND_CAPS_FILE,
]);

// Eksisterende brug af ACADEMY.SLOTS der IKKE er et loft. Hver post kræver en
// begrundelse; alt andet der læser det flade tal i runtime-kode fejler.
const ACADEMY_SLOTS_ALLOWED = new Map([
  [join(REPO, "backend", "lib", "seasonAcademyIntake.js"),
    "TARGET_PIPELINE: intake-pipelinens mål (balance-parameter fra scorecardet), ikke en pladsgrænse"],
]);

const FORBIDDEN = [
  { re: /\bACADEMY_CAP\s*=/, why: "håndskrevet ACADEMY_CAP-konstant (brug squadCaps.ts / squads.js SQUAD_CAPS)" },
  { re: /\bslots\?\.max\s*\?\?\s*\d/, why: "fallback til et fladt akademi-loft (slots?.max ?? N)" },
  { re: /\}\s*\/\s*8`/, why: "håndskrevet \"x / 8\"-loft i en label" },
  { re: /\bacademySlots\s*:\s*\d/, why: "håndskrevet academySlots-tal" },
  { re: /\bslots\b[^\n]*\bmax\s*:\s*\d/, why: "håndskrevet akademi-slots-loft ({ used, max: N })" },
  { re: /\bSQUAD_CAPS\b[^=\n(]*=\s*(Object\.freeze\()?\{/, why: "ny kopi af SQUAD_CAPS (kun squads.js + squadCaps.ts må definere den)" },
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (CODE_EXT.test(name) && !SKIP_FILE.some((re) => re.test(full))) out.push(full);
  }
  return out;
}

const CODE_FILES = CODE_ROOTS.flatMap((root) => walk(root));

test("forward-guard: scanneren ser faktisk kodebasen", () => {
  assert.ok(CODE_FILES.length > 200, `for få filer scannet (${CODE_FILES.length}) — er stierne flyttet?`);
  assert.ok(CODE_FILES.includes(join(REPO, "backend", "routes", "api.js")));
  assert.ok(CODE_FILES.includes(join(REPO, "frontend", "src", "lib", "auctionBidRoom.js")));
});

test("forward-guard: intet håndskrevet akademi-loft i frontend/src, backend/lib eller backend/routes", () => {
  const hits = [];
  for (const file of CODE_FILES) {
    if (CAP_SOURCES.has(file)) continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const { re, why } of FORBIDDEN) {
        if (re.test(line)) hits.push(`${relative(REPO, file).split(sep).join("/")}:${i + 1}  ${why}\n    ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(hits, [], `gammelt fladt akademi-loft fundet:\n${hits.join("\n")}`);
});

test("forward-guard: ingen runtime-kode læser det flade ACADEMY.SLOTS som loft", () => {
  const hits = [];
  for (const file of CODE_FILES) {
    if (ACADEMY_SLOTS_ALLOWED.has(file)) continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (/\bACADEMY\.SLOTS\b/.test(line)) hits.push(`${relative(REPO, file).split(sep).join("/")}:${i + 1}  ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, [], `ACADEMY.SLOTS brugt som loft (brug squads.js capForSquad / youthSquadRoom):\n${hits.join("\n")}`);
});

test("forward-guard: undtagelserne for ACADEMY.SLOTS findes stadig (ellers slet dem)", () => {
  for (const [file, reason] of ACADEMY_SLOTS_ALLOWED) {
    assert.match(readFileSync(file, "utf8"), /\bACADEMY\.SLOTS\b/, `${relative(REPO, file)} bruger ikke længere ACADEMY.SLOTS: fjern undtagelsen (${reason})`);
  }
});

test("forward-guard: spillertekster nævner ikke det gamle faste akademi-loft", () => {
  const LOCALES = join(REPO, "frontend", "public", "locales");
  const OLD_CAP_TEXT = [/\b8\s*\/\s*8\b/, /\b8 places\b/i, /\b8 pladser\b/i, /\b8-(slot|place|plads)/i];
  const hits = [];
  for (const lng of readdirSync(LOCALES)) {
    for (const file of readdirSync(join(LOCALES, lng))) {
      if (!file.endsWith(".json") || file === "patchnotes.json") continue;
      const lines = readFileSync(join(LOCALES, lng, file), "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        if (/academ|akadem/i.test(line) && OLD_CAP_TEXT.some((re) => re.test(line))) {
          hits.push(`${lng}/${file}:${i + 1}  ${line.trim().slice(0, 140)}`);
        }
      });
    }
  }
  assert.deepEqual(hits, [], `gammelt akademi-loft i spillertekst:\n${hits.join("\n")}`);
});
