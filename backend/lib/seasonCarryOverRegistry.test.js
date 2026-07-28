// #2916 — FORWARD-GUARD for carry-over-kontrakten.
//
// Dette er selve mekanikken issue #2916 beder om: listen over "ting manageren
// har sat op, som forsvinder ved sæsonskifte" må ikke skulle huskes af et
// menneske næste gang. Testen scanner ALLE checkede migrationer for tabeller
// der er sæson-scopede OG hænger på et hold/en rytter — altså formen en ny
// manager-opsætnings-tabel uundgåeligt har — og kræver at hver eneste af dem
// står i MANAGER_SETUP_REGISTRY med en eksplicit disposition.
//
// Lander en ny tabel uden klassifikation, fejler denne test (og dermed CI) med
// tabelnavnet i beskeden. Så kan man ikke gentage #2916 ved et uheld; man kan
// kun gøre det bevidst, ved at skrive NOT_MANAGER_SETUP og hvorfor.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CARRY_OVER_DISPOSITION,
  MANAGER_SETUP_REGISTRY,
  findHandlerDrift,
  registryTables,
  unclassifiedTables,
} from "./seasonCarryOver.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATABASE_DIR = path.resolve(HERE, "..", "..", "database");

// `proposals/` er ikke-anvendte udkast — de beskriver ikke prod-skemaet.
const SKIP_DIRS = new Set(["proposals"]);

function sqlFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...sqlFiles(path.join(dir, entry.name)));
    } else if (entry.name.endsWith(".sql")) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/**
 * Find kroppen af en CREATE TABLE ved at balancere parenteser fra åbnings-
 * parentesen. En simpel regex på `\(([^)]*)\)` ville stoppe ved den første
 * indlejrede `)` (fx `NUMERIC(10,2)` eller en CHECK-constraint) og derfor
 * overse `season_id`-kolonner længere nede i kroppen.
 */
function tableBody(src, openParenIndex) {
  let depth = 0;
  for (let i = openParenIndex; i < src.length; i += 1) {
    if (src[i] === "(") depth += 1;
    else if (src[i] === ")") {
      depth -= 1;
      if (depth === 0) return src.slice(openParenIndex + 1, i);
    }
  }
  return src.slice(openParenIndex + 1);
}

/**
 * Alle tabeller i migrationerne hvis krop har både `season_id` og
 * `team_id`/`rider_id`. Eksporteret form af scanneren så fejlbeskeden kan vise
 * hvor tabellen blev fundet.
 *
 * @returns {Map<string, string>} tabelnavn → første fil den blev set i
 */
function seasonScopedOwnerTables() {
  const found = new Map();
  const createTable = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?\s*\(/gi;
  for (const file of sqlFiles(DATABASE_DIR)) {
    const src = fs.readFileSync(file, "utf8");
    let match;
    while ((match = createTable.exec(src)) !== null) {
      const name = match[1];
      const body = tableBody(src, createTable.lastIndex - 1);
      const seasonScoped = /\bseason_id\b/i.test(body);
      const ownerScoped = /\bteam_id\b|\brider_id\b/i.test(body);
      if (seasonScoped && ownerScoped && !found.has(name)) {
        found.set(name, path.relative(DATABASE_DIR, file));
      }
    }
  }
  return found;
}

test("forward-guard: scanneren finder faktisk de kendte carry-over-tabeller", () => {
  const found = seasonScopedOwnerTables();
  // Sanity: fejler scanneren stille (fx fordi database/ er flyttet), ville
  // hoved-testen nedenfor bestå trivielt. Disse to ER sæson-scopede
  // hold-/rytter-tabeller og SKAL findes.
  assert.ok(found.has("training_plans"), "scanneren fandt ikke training_plans");
  assert.ok(found.has("rider_peak_plans"), "scanneren fandt ikke rider_peak_plans");
  assert.ok(found.size >= 10, `scanneren fandt kun ${found.size} tabeller — mistænkeligt lavt`);
});

test("forward-guard: hver sæson-scoped hold-/rytter-tabel har en eksplicit carry-over-disposition", () => {
  const found = seasonScopedOwnerTables();
  const missing = unclassifiedTables(found.keys());
  assert.deepEqual(
    missing,
    [],
    `Nye sæson-scopede hold-/rytter-tabeller mangler en carry-over-disposition i ` +
      `MANAGER_SETUP_REGISTRY (backend/lib/seasonCarryOver.js):\n` +
      missing.map((t) => `  - ${t}  (${found.get(t)})`).join("\n") +
      `\n\nTag stilling: bæres managerens opsætning over (COPY), skal den kun ` +
      `valideres (REVALIDATE), nulstilles den bevidst (RESET_BY_DESIGN), eller ` +
      `er tabellen motor-output (NOT_MANAGER_SETUP)?`
  );
});

test("forward-guard: en uklassificeret tabel BLIVER fanget (guarden bider)", () => {
  // Bevis for at guarden ikke består trivielt: en hypotetisk ny tabel som ingen
  // har taget stilling til, skal komme ud som uklassificeret.
  assert.deepEqual(
    unclassifiedTables(["training_plans", "team_season_lineup_presets"]),
    ["team_season_lineup_presets"]
  );
});

test("registret: hver post har en gyldig disposition og en begrundelse", () => {
  const valid = new Set(Object.values(CARRY_OVER_DISPOSITION));
  for (const entry of MANAGER_SETUP_REGISTRY) {
    assert.ok(entry.table, "post uden tabelnavn");
    assert.ok(valid.has(entry.disposition), `${entry.table}: ukendt disposition '${entry.disposition}'`);
    assert.ok(
      typeof entry.why === "string" && entry.why.length > 20,
      `${entry.table}: mangler en brugbar begrundelse`
    );
  }
});

test("registret: ingen dubletter", () => {
  assert.equal(registryTables().size, MANAGER_SETUP_REGISTRY.length);
});

test("registret: hver COPY/REVALIDATE-flade har en implementeret handler", () => {
  assert.deepEqual(findHandlerDrift(), []);
});
