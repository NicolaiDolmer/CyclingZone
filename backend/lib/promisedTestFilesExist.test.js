// Forward-guard #4479 mod fejlKLASSEN, ikke kun mod det ene fund.
//
// #4479 var ikke "en test manglede". Den var: `docs/ECONOMY_RULES.md` og TO
// kodekommentarer navngav `frontend/src/lib/salaryRateParity.test.js` som den
// aktive vagt mod løn-drift, og brugte den som eksplicit BEGRUNDELSE for at
// duplikere satsen. Filen har aldrig eksisteret. En lovet vagt der aldrig blev
// bygget er værre end ingen vagt: den fjerner mistanken, så ingen kigger efter.
//
// Denne test scanner SSOT-dokumenter og kildekode-kommentarer for enhver
// omtale af en `*.test.js` / `*.test.ts`-fil og kræver at filen findes. Den er
// tekstlig, ikke semantisk — den beviser ikke at testen tester det den lover,
// kun at den eksisterer. Men præcis #4479-mønstret (navnet står tre steder,
// filen står ingen steder) kan ikke overleve den.
//
// SCOPE — kun kilder der udtaler sig om NUTIDEN:
//   · `docs/`s TOPNIVEAU (ECONOMY_RULES.md, GAME_INVARIANTS.md, ...) — SSOT.
//   · al kildekode i backend/lib, backend/routes, backend/scripts, frontend/src.
// Bevidst UDE: `docs/`s undermapper (superpowers/plans, specs, slices,
// sessions, audits, archive) og `.claude/learnings/`. De er historiske
// dokumenter: en plan fra juni må gerne nævne en test der blev omdøbt eller
// aldrig blev bygget, for den beskriver hvad man dengang havde tænkt sig. Et
// SSOT-dokument eller en kodekommentar der påstår "dette håndhæves af X" må ikke.
// Målt 31/8: 34 sådanne historiske referencer findes i docs-undermapperne — at
// rette dem ville forfalske historikken, ikke fjerne gæld.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const BACKEND_ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // backend/
const REPO_ROOT = dirname(BACKEND_ROOT);

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "dist-ssr", "coverage", "playwright-report", "test-results"]);

function walk(dir, accept, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, accept, out);
    else if (accept(entry.name)) out.push(full);
  }
  return out;
}

// Alle testfiler der faktisk findes — både fuld sti og bart filnavn, fordi en
// kommentar lige så ofte skriver "salaryRateParity.test.js" som hele stien.
function buildExistingTestIndex() {
  const files = walk(REPO_ROOT, (n) => /\.test\.(js|ts|jsx|tsx)$/.test(n));
  return new Set(files.map((f) => basename(f)));
}

// Kilder der udtaler sig om NUTIDEN: SSOT-docs + al kildekode (kommentarerne
// deri). Testfilernes egen kode er med: en test der refererer en anden test
// ved navn er samme løfte.
function topLevelDocs() {
  const dir = join(REPO_ROOT, "docs");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => join(dir, e.name));
}

function sourcesToScan() {
  const docs = topLevelDocs();
  const beCode = [
    ...walk(join(BACKEND_ROOT, "lib"), (n) => /\.(js|ts)$/.test(n)),
    ...walk(join(BACKEND_ROOT, "routes"), (n) => /\.(js|ts)$/.test(n)),
    ...walk(join(BACKEND_ROOT, "scripts"), (n) => /\.(js|ts)$/.test(n)),
  ];
  const feCode = walk(join(REPO_ROOT, "frontend", "src"), (n) => /\.(js|jsx|ts|tsx)$/.test(n));
  return [...docs, ...beCode, ...feCode];
}

// Fanger både "frontend/src/lib/x.test.js" og bart "x.test.js". Glob-mønstre
// (`*.test.js`, `**/*.test.js`) er IKKE fil-løfter og filtreres fra.
const REFERENCE_RE = /[A-Za-z0-9_@./-]*[A-Za-z0-9_-]\.test\.(?:js|ts|jsx|tsx)/g;

test("#4479 forward-guard: ingen doc eller kodekommentar lover en testfil der ikke findes", () => {
  const existing = buildExistingTestIndex();
  assert.ok(
    existing.size > 200,
    `forventede mange testfiler i repoet, fandt ${existing.size} — er scanneren gået i stykker?`
  );

  const broken = [];
  for (const file of sourcesToScan()) {
    // Guarden selv indeholder bevidst et ikke-eksisterende navn i sin selvtest.
    if (basename(file) === basename(fileURLToPath(import.meta.url))) continue;
    const src = readFileSync(file, "utf8");
    for (const match of src.match(REFERENCE_RE) || []) {
      if (match.includes("*")) continue;
      const name = basename(match);
      // Endelses-fragmenter fra prosa ("...`.i18n.test.js`-mønstret") er ikke
      // fil-løfter: ingen fil hedder noget der begynder med et punktum.
      if (name.startsWith(".")) continue;
      if (existing.has(name)) continue;
      // Absolut/rod-relativ sti der peger på en fil der findes under et andet
      // basename-opslag (fx en genereret fil) accepteres hvis stien findes.
      if (match.includes("/") && existsSync(join(REPO_ROOT, match))) continue;
      broken.push(`${file.slice(REPO_ROOT.length + 1).replaceAll("\\", "/")} → ${match}`);
    }
  }

  assert.deepEqual(
    [...new Set(broken)].sort(),
    [],
    "Disse steder navngiver en testfil der ikke findes. Enten er filen slettet/omdøbt uden at " +
      "referencen fulgte med, eller vagten blev aldrig bygget (#4479). Byg testen, eller fjern " +
      "løftet — en vagt der kun findes i prosa fjerner mistanken uden at dække noget."
  );
});

// Ekstra tandhjul, samme klasse: sanity på at scanneren rent faktisk SER en
// kendt reference. Uden denne kan REFERENCE_RE gå i stykker og guarden blive
// permanent grøn — præcis den fejl den er bygget for at fange.
test("#4479 forward-guard: scanneren finder faktisk test-referencer i kilderne", () => {
  let seen = 0;
  for (const file of sourcesToScan()) {
    seen += (readFileSync(file, "utf8").match(REFERENCE_RE) || []).filter((m) => !m.includes("*")).length;
  }
  assert.ok(seen >= 20, `forventede mindst 20 test-fil-referencer i docs+kode, fandt ${seen} — regex'en er gået i stykker`);
});

// Statisk selvtest af selve matcheren: en syntetisk kilde med ét gyldigt og ét
// brudt løfte skal give præcis ét brud. Fanger at en fremtidig ændring af
// REFERENCE_RE stille holder op med at matche.
test("#4479 forward-guard: matcheren skelner eksisterende fra ikke-eksisterende løfte", () => {
  const existing = buildExistingTestIndex();
  const sample = "se promisedTestFilesExist.test.js og frontend/src/lib/derFindesIkke.test.js";
  const hits = (sample.match(REFERENCE_RE) || []).map((m) => basename(m));
  assert.deepEqual(hits, ["promisedTestFilesExist.test.js", "derFindesIkke.test.js"]);
  assert.ok(existing.has("promisedTestFilesExist.test.js"));
  assert.ok(!existing.has("derFindesIkke.test.js"));
});
