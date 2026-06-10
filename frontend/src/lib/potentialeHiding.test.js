import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #1162/#1242 — forward-guard mod potentiale-lækage i klienten.
//
// riders.potentiale + rider_derived_abilities.hidden_potential er server-skjulte
// (column privilege i Supabase). hidden_potential er med fordi den er EKSAKT
// invertérbar til potentiale (ungdom + seeded FNV-1a-støj kan begge beregnes i
// klienten — se abilityDerivation.js).
//   1. INGEN Supabase-select i frontend må indeholde `potentiale` eller
//      `hidden_potential` — PostgREST afviser HELE kaldet (permission denied),
//      så en regression brækker siden.
//   2. INGEN `select=*` på riders/rider_derived_abilities — samme konsekvens.
//   3. INGEN filter/order på potentiale-kolonnen.
//   4. UI læser aldrig `rider.potentiale` — visningen kommer fra det server-
//      beregnede estimat (useScouting.estimateFor / POST /api/scouting/estimates).

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(__dirname, "..");

function collectSources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) collectSources(p, out);
    else if (/\.(jsx?|tsx?)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

const sources = collectSources(SRC_ROOT)
  // PatchNotesPage er historik-tekst; database.types.ts er genereret.
  .filter((p) => !/PatchNotesPage\.jsx$|database\.types\.ts$/.test(p))
  .map((p) => ({ path: p, code: readFileSync(p, "utf8") }));

test("ingen frontend-Supabase-select indeholder potentiale/hidden_potential (#1162)", () => {
  const offenders = [];
  for (const { path, code } of sources) {
    // Fang de skjulte kolonner inde i .select(`...`)/.select("...")-strenge.
    const selects = code.match(/\.select\(\s*(`[^`]*`|"[^"]*")/g) ?? [];
    for (const sel of selects) {
      if (/\b(potentiale|hidden_potential)\b/.test(sel)) offenders.push(path);
    }
  }
  assert.deepEqual(offenders, [], `Supabase-selects med skjulte kolonner fundet i: ${offenders.join(", ")}`);
});

for (const table of ["riders", "rider_derived_abilities"]) {
  test(`ingen select=* på ${table}-tabellen (#1162 — column privilege afviser hele kaldet)`, () => {
    const offenders = [];
    for (const { path, code } of sources) {
      // Find hver from("<table>") og tjek DENS første .select(-argument for `*`.
      const fromRe = new RegExp(`from\\(\\s*["']${table}["']\\s*\\)`, "g");
      let m;
      while ((m = fromRe.exec(code)) !== null) {
        const after = code.slice(m.index, m.index + 400);
        const selIdx = after.indexOf(".select(");
        if (selIdx === -1) continue;
        // Første ikke-whitespace-tegn inde i select-argumentets streng.
        const sel = after.slice(selIdx).match(/^\.select\(\s*[`"']\s*(\S)/);
        if (sel && sel[1] === "*") {
          offenders.push(path);
          break;
        }
      }
    }
    assert.deepEqual(offenders, [], `select("*") på ${table} fundet i: ${offenders.join(", ")}`);
  });
}

test("ingen filter/order på potentiale-kolonnen (#1162 — oracle-lækage)", () => {
  const offenders = [];
  for (const { path, code } of sources) {
    if (/\.(gte|lte|gt|lt|eq|order)\(\s*["']potentiale["']/.test(code)) offenders.push(path);
  }
  assert.deepEqual(offenders, [], `potentiale-filter/-order fundet i: ${offenders.join(", ")}`);
});

test("UI læser aldrig rider.potentiale — visning kommer fra server-estimatet (#1242)", () => {
  const offenders = [];
  for (const { path, code } of sources) {
    if (/\b(?:rider|r)\??\.potentiale\b/.test(code)) offenders.push(path);
  }
  assert.deepEqual(offenders, [], `rå rider.potentiale-læsninger fundet i: ${offenders.join(", ")}`);
});

test("UI læser aldrig hidden_potential — feltet er server-skjult (#1162)", () => {
  const offenders = [];
  for (const { path, code } of sources) {
    if (/\.hidden_potential\b|\[\s*["']hidden_potential["']\s*\]/.test(code)) offenders.push(path);
  }
  assert.deepEqual(offenders, [], `hidden_potential-læsninger fundet i: ${offenders.join(", ")}`);
});

test("ScoutablePotentiale bruger server-estimatet og PotentialeStars viser aldrig rå tal", () => {
  const scoutable = readFileSync(join(SRC_ROOT, "components", "rider", "ScoutablePotentiale.jsx"), "utf8");
  assert.match(scoutable, /estimateFor\(/, "ScoutablePotentiale skal læse estimatet via scouting.estimateFor");
  assert.match(scoutable, /requestEstimates\(/, "ScoutablePotentiale skal requeste estimatet (batched)");

  const stars = readFileSync(join(SRC_ROOT, "components", "PotentialeStars.jsx"), "utf8");
  assert.doesNotMatch(stars, /showValue/, "showValue (råt tal ved siden af stjernerne) er fjernet i #1242");
});

test("TeamPage bruger ScoutablePotentiale (ingen hardcoded showValue/eksakt-visning) (#1242)", () => {
  const teamPage = readFileSync(join(SRC_ROOT, "pages", "TeamPage.jsx"), "utf8");
  assert.match(teamPage, /ScoutablePotentiale/, "TeamPage skal vise potentiale via ScoutablePotentiale");
  assert.doesNotMatch(teamPage, /<PotentialeStars/, "TeamPage må ikke rendere PotentialeStars direkte med rå værdi");
});
