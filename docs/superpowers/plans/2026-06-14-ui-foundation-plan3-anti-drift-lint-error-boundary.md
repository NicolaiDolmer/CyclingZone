# UI-fundament Plan 3: Anti-drift lint-guard + global error-boundary (hærdning)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lås primitiv-laget mod fremtidig slop-drift med en CI-wired anti-drift-lint (forbyd NYE rå hex + `rounded-xl/2xl/3xl`/glow/`backdrop-blur`/blob-blur + emoji-som-ikon i `frontend/src`, baseline-ratchet så KUN nye overtrædelser fejler) OG hærd den eksisterende globale error-boundary så den altid fanger render-fejl (ikke kun når Sentry er aktivt) og render en on-spec branded fallback bygget på `ErrorState`/`Button`-primitiverne i stedet for et white-screen.

**Architecture:** To uafhængige spor i én PR. **Spor 1 (anti-drift):** mirror det eksisterende forward-guard-mønster nøjagtigt — `scripts/lint-ui-slop.mjs` (rene detektor-funktioner + per-fil/per-kategori baseline-ratchet, præcis som `scripts/i18n-check-leaks.mjs` + `scripts/i18n-leaks-baseline.json`), `scripts/lint-ui-slop.test.mjs` (`node --test`, synthetiske detektor-cases + "nul NYE fund mod committet baseline" som `lint-sql-strings.test.mjs`), npm-scripts, lint-staged-entry, ny CI-job. Backwards-check = generér baseline fra hele det nuværende træ; forward-guard = fejl kun på stigninger. **Spor 2 (error-boundary):** den eksisterende `SentryBoundary`/`AppErrorFallback` i `frontend/src/lib/sentry.jsx` (wired i `main.jsx`) findes allerede og er solid (statisk EN/DA-copy pr. #1170, eventId, chunk-reload). Plan 3 fjerner `if (!ENABLED) return children`-gaten (altid-aktiv boundary → fanger crashes også i dev/preview/uden DSN → ingen white-screen + gør ejer-lås-demoen mulig) og re-skinner fallback'en oven på `ErrorState` + `Button` med on-spec tokens (DIREKTE imports, ikke barrel, så main-bundlen ikke trækker hele ui-laget ind). Adfærd verificeret med kilde-streng-asserts (repo-konvention, ingen jsdom/RTL) + en Playwright-spec der fremtvinger en render-fejl i en prod-build og asserter den branded fallback.

**Tech Stack:** Node 24 (`node --test`, ESM `.mjs`), React 18 + Vite 8, `@sentry/react` 10.x, Playwright 1.60, lint-staged 17, GitHub Actions.

**Spec:** [`2026-06-14-design-system-foundation-design.md`](../specs/2026-06-14-design-system-foundation-design.md) DEL-C **C1** (anti-re-drift-guard) + **C2-step-1** (error-boundary del af "fundament lander") + **C3** (gates). Forudgående (alt merged): Plan 1 (PR #1388) tokens+primitiver, Plan 2a (PR #1391) Field/Table/states, Plan 2b (PR #1392) overlays, Plan 2c (PR #1393) ikon-sæt+Chip/Avatar/ProgressMeter. Plan 4 = udrulning side-for-side (emoji→ikoner, inline-kopi→primitiver) — det er Plan 4 der konverterer de ~366 callsites + al emoji; Plan 3 baseliner dem.

---

## Vigtigt fund (verifikation FØR build) — error-boundary findes ALLEREDE

Spec C2-step-1 siger "error-boundary" som del af fundamentet. Grep af `main.jsx`/`App.jsx` + `@sentry/react`:

- **`frontend/src/main.jsx`** wrapper hele app-træet i `<SentryBoundary>` (over providers + `<App/>`).
- **`frontend/src/lib/sentry.jsx`** definerer `SentryBoundary` (et `Sentry.ErrorBoundary`) + `AppErrorFallback` (branded, statisk EN/DA-copy pr. #1170, eventId, chunk-reload-recovery, reset-knap).

Den er altså IKKE greenfield. To reelle huller mod Plan 3-intentionen styrer arbejdet:

1. **`if (!ENABLED) return children` (sentry.jsx:42)** — `ENABLED = import.meta.env.PROD && Boolean(DSN)`. I dev, i Vercel-preview uden DSN, og i en e2e-prod-build (ingen DSN) er der **ingen** boundary → en render-fejl white-screener. Det modarbejder spec'ens "fallback i stedet for white-screen" OG gør ejer-lås-demoen umulig (kan ikke vise fallback live lokalt). **Plan 3 gør boundary'en altid-aktiv.**
2. **Off-spec styling** — `AppErrorFallback` er hånd-rullet med `rounded-lg` + `shadow-sm` og genbruger IKKE `ErrorState`/`Button`. Task'en beder eksplicit om at genbruge `ErrorState`. **Plan 3 re-skinner oven på primitiverne med `rounded-cz` + hairline.**

**Bevidst afvigelse fra task-instruktionen "Wire ind i App.jsx":** boundary'en bliver i `main.jsx` (over providers), ikke flyttet ned i `App.jsx`. Begrundelse: (a) den nuværende placering fanger også provider-fejl (ThemeProvider/LanguageProvider/ConsentProvider) — at flytte den ned ville tabe coverage; (b) `ThemeProvider.applyTheme` sætter `data-theme="dark"` på `<html>` og **rydder det ikke ved unmount** (verificeret i `theme.jsx:22-26,38-45`), så fallback'en render korrekt i begge temaer selv når et crash unmounter ThemeProvider. "Wire ind i App.jsx" var skrevet til greenfield-tilfældet ("Hvis ikke: byg en … Wire ind i App.jsx"); da en bredere-dækkende boundary allerede findes, er det rigtige at hærde den hvor den er. (Noteres i PR-body.)

## Setup (før Task 1)

Kør på en feature-branch i et worktree (`superpowers:using-git-worktrees` / `scripts/new-worktree.ps1`). Alt er `feat(ui)`/`build(ci)` via branch + PR (ingen migration → normal PR-flow). I worktree: `npm ci` i `frontend/` + kun `VITE_`-vars i `.env` (memory [[feedback_local_logged_in_verify_via_playwright_mocks]]).

```powershell
pwsh -File scripts/new-worktree.ps1 -Branch feat/ui-foundation-3-anti-drift-error-boundary
```

Branch fra **origin/main**. Åbn ny session i worktree-pathen FØR Task 1. Verificér branch i selve commit-kæden (delt checkout, [[feedback_verify_branch_before_commit_shared_checkout]]) — også for de trivielle docs/CI-commits.

## Anti-slop-vagt (gælder hver task)

Mod spec A9 + [[feedback_anti_ai_slop_design_taste]]: **ingen** `rounded-xl/2xl/3xl`, **ingen** glow (`shadow-[0_0…]`), **ingen** gradient-blob/`backdrop-blur`, **ingen emoji som ikon**. Kun token-klasser. Den re-skinned fallback bruger `rounded-cz` (5px), hairline-border, `ErrorState`+`Button`. Lint-scriptet selv er det værktøj der håndhæver dette fremadrettet.

## Genbrug fra fundamentet (laves IKKE om)

- **`scripts/i18n-check-leaks.mjs` + `scripts/i18n-leaks-baseline.json`** — den eksakte forward-guard-skabelon: per-fil-count-ratchet, `--update-baseline`, `stripComments`, `walk(dir, out, skipDirs)` der springer `.test.`-filer over, deterministisk fuld-repo-scan (lint-staged-args ignoreres). `lint-ui-slop.mjs` kopierer denne form.
- **`scripts/lint-sql-strings.mjs` + `.test.mjs`** — `isMain()`-detektion, `export function scan(...)` testet med synthetiske strenge, "nul fund på nuværende træ"-integrationstest. Samme test-form.
- **`scripts/check-eslint-warning-budget.mjs`** — eksempel på en simpel CI-wired guard.
- **`frontend/src/components/ui/ErrorState.jsx`** — `ErrorState({title, description, action, className})` med `AlertTriangleIcon`. Genbruges i fallback'en. **Røres ikke.**
- **`frontend/src/components/ui/Button.jsx`** — `Button({variant, size, onClick, …})`. Genbruges til reload/retry-knapper.
- **`frontend/src/lib/sentry.jsx`** — `getPreferredLanguage`, `isChunkLoadError`, `shouldAttemptChunkReload`, `ENABLED`, `RELEASE`, statisk EN/DA-`copy`-objekt, `setSentryUser`/`clearSentryUser`. Al denne logik **bevares uændret**; kun boundary-gaten + fallback-JSX ændres.
- **`frontend/tests/e2e/fixtures.js`** (`installNetworkMocks`, `stabilizePage` der sætter `cz_lang=da`) + **`playwright.config.js`** (CI = statisk preview-build, `VITE_E2E=1`, ingen DSN → boundary aktiv efter altid-aktiv-ændringen).

## Fil-struktur (Plan 3)

| Fil | Ansvar |
|---|---|
| `scripts/lint-ui-slop.mjs` (create) | Detektorer (`countHex`/`countSlop`/`countEmoji`/`scanSource`) + `walkSrc`/`scanRepo` + `compareAgainstBaseline` + `main` (`--update-baseline`) |
| `scripts/lint-ui-slop.test.mjs` (create) | `node --test`: synthetiske detektor-cases + baseline-parse + "nul NYE fund på nuværende træ mod baseline" |
| `scripts/ui-slop-baseline.json` (create, generated) | Per-fil/per-kategori count-ratchet af ALLE eksisterende overtrædelser (backwards-check) |
| `package.json` (modify, root) | `lint:ui-slop` + `test:lint-ui-slop` + `check:ui-slop-baseline` npm-scripts |
| `lint-staged.config.mjs` (modify) | `frontend/src/**/*.{js,jsx,css}` → kør `lint-ui-slop.mjs` (full-repo, args ignoreres) |
| `.github/workflows/ci.yml` (modify) | Ny `ui-anti-drift`-job: `test:lint-ui-slop` + guard |
| `frontend/src/lib/sentry.jsx` (modify) | Fjern `!ENABLED`-gate (altid-aktiv) + re-skin `AppErrorFallback` på `ErrorState`/`Button` (direkte imports), eventId kun når `ENABLED` |
| `frontend/src/lib/sentry.boundary.test.js` (create) | Kilde-assert: altid-aktiv + ErrorState/Button-genbrug + bevaret copy/chunk-reload/eventId-gate |
| `frontend/src/pages/KitchenSinkPage.jsx` (modify) | Gated forced-error-trigger (`?boom=1` + DEV/E2E) — påvirker IKKE default-`/ui`-snapshot |
| `frontend/tests/e2e/error-boundary.spec.js` (create) | Fremtving render-fejl i prod-build → assert branded fallback (tekst, ingen ny PNG-baseline) |
| `frontend/src/pages/PatchNotesPage.jsx` | **Ikke ændret** — hvorfor-ikke dokumenteret (Task 6) |

---

## Task 1: Anti-drift-detektorer (rene funktioner) + unit-tests

Byg KUN detektorerne først (rene funktioner på strenge), TDD. Walk/baseline/CLI kommer i Task 2.

**Files:**
- Create: `scripts/lint-ui-slop.mjs`
- Test: `scripts/lint-ui-slop.test.mjs`

- [ ] **Step 1: Write the failing test** (`scripts/lint-ui-slop.test.mjs`)

```js
// scripts/lint-ui-slop.test.mjs
// ============================================================
// Tests for the UI anti-drift forward-guard (#671 Plan 3, spec DEL-C C1).
// Run: node --test scripts/lint-ui-slop.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { countHex, countSlop, countEmoji, scanSource } from "./lint-ui-slop.mjs";

test("countHex flags raw hex colors (3/4/6/8-digit)", () => {
  assert.equal(countHex("color: #e8c547;"), 1);
  assert.equal(countHex('fill="#fff" stroke="#0e0f15"'), 2);
  assert.equal(countHex("#abcd and #abcdef12"), 2); // 4-digit + 8-digit
});

test("countHex ignores hex inside comments", () => {
  assert.equal(countHex("// guld er #e8c547"), 0);
  assert.equal(countHex("/* #0e0f15 navy */"), 0);
});

test("countHex does not false-positive on non-color text", () => {
  assert.equal(countHex("const x = 12;"), 0);
  assert.equal(countHex("href=\"#section\""), 0); // #section is not hex-shaped
  assert.equal(countHex("rgb(var(--accent))"), 0);
});

test("countSlop flags rounded-xl/2xl/3xl, glow, backdrop-blur, blob-blur", () => {
  assert.equal(countSlop('className="rounded-2xl"'), 1);
  assert.equal(countSlop("rounded-xl rounded-3xl"), 2);
  assert.equal(countSlop("shadow-[0_0_40px_rgba(0,0,0,.5)]"), 1);
  assert.equal(countSlop("backdrop-blur-sm"), 1);
  assert.equal(countSlop("blur-2xl blur-3xl"), 2);
});

test("countSlop allows on-spec tokens (rounded-cz, shadow-overlay)", () => {
  assert.equal(countSlop("rounded-cz rounded-cz-pill shadow-overlay"), 0);
  assert.equal(countSlop("// avoid rounded-2xl in new UI"), 0); // comment stripped
});

test("countEmoji flags emoji used as icons but not text symbols", () => {
  assert.equal(countEmoji("🏁 finish line"), 1);
  assert.equal(countEmoji("💰🔭⛰️"), 3);
  assert.equal(countEmoji("© 2026 Cycling Zone"), 0); // ©®™ exempt
  assert.equal(countEmoji("plain ascii text"), 0);
  assert.equal(countEmoji("// 🏁 in a comment"), 0); // comment stripped
});

test("scanSource returns per-category counts", () => {
  const r = scanSource('<div className="rounded-2xl" style={{color:"#fff"}}>🏁</div>');
  assert.deepEqual(r, { hex: 1, slop: 1, emoji: 1 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/lint-ui-slop.test.mjs`
Expected: FAIL (`Cannot find module './lint-ui-slop.mjs'` / detektorer ikke defineret).

- [ ] **Step 3: Implement detectors** (`scripts/lint-ui-slop.mjs` — kun toppen + detektorer i denne task)

```js
#!/usr/bin/env node
// scripts/lint-ui-slop.mjs
// ============================================================
// UI anti-drift forward-guard — #671 Plan 3 (spec DEL-C C1).
//
// REGEL (dokumenteret her som single source of truth):
//   Ny UI bruger ui/-primitiver + design-tokens. INGEN raa hex-farver i
//   frontend/src (kun index.css token-definitioner), INGEN slop-tells
//   (rounded-xl/2xl/3xl, glow `shadow-[0_0...]`, backdrop-blur, blob-blur
//   `blur-2xl/3xl`), INGEN emoji som ikon i JSX (brug ui/icons/).
//
// FORWARD-GUARD, ikke retroaktivt brud: de ~366 eksisterende callsites + al
// nuvaerende emoji er Plan 4's job. Kendte overtraedelser ligger i
// scripts/ui-slop-baseline.json (per-fil/per-kategori count-ratchet — maa kun
// skrumpe). Guarden fejler KUN paa NYE overtraedelser (flere i en fil end
// baseline, eller en ny fil). Praecis samme form som i18n-check-leaks.mjs.
//
// Brug:
//   node scripts/lint-ui-slop.mjs                    # check (CI + pre-commit)
//   node scripts/lint-ui-slop.mjs --update-baseline  # regenerér baseline
//
// Evt. fil-sti-args fra lint-staged ignoreres — scannen er altid fuld-repo
// (frontend/src) saa resultatet er deterministisk uanset hvad der er staged.
//
// Refs #671.

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const BASELINE_PATH = join(ROOT, "scripts", "ui-slop-baseline.json");
const SRC_DIR = join(ROOT, "frontend", "src");

// index.css er token-definitions-filen: raa hex er LEGITIMT der (det er hele
// pointen — tokens defineres ét sted). Helt undtaget fra scannen.
export const EXEMPT_FILES = new Set(["frontend/src/index.css"]);

// --- Detektorer (rene funktioner paa kildestrenge) ------------------------

// Raa hex: #RGB / #RGBA / #RRGGBB / #RRGGBBAA, ikke efterfulgt af endnu et
// hex-tegn (saa #ffff0 / #section ikke fejl-matcher).
const HEX_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g;

// Slop-tells (navngivne saa fejlbeskeden er handlingsbar).
export const SLOP_PATTERNS = [
  ["rounded-xl", /\brounded-xl\b/g],
  ["rounded-2xl", /\brounded-2xl\b/g],
  ["rounded-3xl", /\brounded-3xl\b/g],
  ["glow-shadow", /shadow-\[0_0/g],
  ["backdrop-blur", /\bbackdrop-blur\b/g],
  ["blob-blur", /\bblur-(?:2xl|3xl)\b/g],
];

// Emoji-som-ikon: Extended_Pictographic minus tekst-symboler (©®™) der teknisk
// er pictographic men legitime i copy.
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const EMOJI_TEXT_EXEMPT = new Set(["©", "®", "™"]); // © ® ™

export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

export function countHex(src) {
  return (stripComments(src).match(HEX_RE) ?? []).length;
}

export function countSlop(src) {
  const clean = stripComments(src);
  let n = 0;
  for (const [, re] of SLOP_PATTERNS) n += (clean.match(re) ?? []).length;
  return n;
}

export function countEmoji(src) {
  const matches = stripComments(src).match(EMOJI_RE) ?? [];
  return matches.filter((ch) => !EMOJI_TEXT_EXEMPT.has(ch)).length;
}

export function scanSource(src) {
  return { hex: countHex(src), slop: countSlop(src), emoji: countEmoji(src) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/lint-ui-slop.test.mjs`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lint-ui-slop.mjs scripts/lint-ui-slop.test.mjs
git commit -m "feat(ci): anti-drift lint detektorer (hex/slop/emoji) + unit-tests (#671)"
```

---

## Task 2: Repo-walk + baseline-ratchet + CLI + generér baseline

Tilføj fuld-repo-scan, baseline-sammenligning og `main`/`--update-baseline` til `lint-ui-slop.mjs`, generér baseline fra det nuværende træ (backwards-check), og udvid testen med "nul NYE fund mod baseline".

**Files:**
- Modify: `scripts/lint-ui-slop.mjs` (append efter detektorerne)
- Modify: `scripts/lint-ui-slop.test.mjs` (tilføj integrationstest)
- Create (generated): `scripts/ui-slop-baseline.json`

- [ ] **Step 1: Write the failing test** — tilføj til `scripts/lint-ui-slop.test.mjs`:

```js
import { scanRepo, compareAgainstBaseline } from "./lint-ui-slop.mjs";
import { readFileSync as _read } from "node:fs";
import { fileURLToPath as _f } from "node:url";
import { dirname as _d, join as _j } from "node:path";

test("compareAgainstBaseline only flags increases over baseline", () => {
  const findings = { "a.jsx": { hex: 2, slop: 0, emoji: 1 } };
  const baseline = { files: { "a.jsx": { hex: 2, slop: 0, emoji: 0 } } };
  const { newViolations } = compareAgainstBaseline(findings, baseline);
  assert.equal(newViolations.length, 1); // emoji 1 > 0
  assert.match(newViolations[0], /a\.jsx/);
  assert.match(newViolations[0], /emoji/);
});

test("compareAgainstBaseline reports stale baseline when violations shrink", () => {
  const findings = { "a.jsx": { hex: 1, slop: 0, emoji: 0 } };
  const baseline = { files: { "a.jsx": { hex: 2, slop: 0, emoji: 0 } } };
  const { newViolations, stale } = compareAgainstBaseline(findings, baseline);
  assert.equal(newViolations.length, 0);
  assert.ok(stale.length >= 1);
});

test("nul NYE anti-drift-fund paa nuvaerende traae mod committet baseline", () => {
  const here = _d(_f(import.meta.url));
  const baseline = JSON.parse(_read(_j(here, "ui-slop-baseline.json"), "utf8"));
  const findings = scanRepo();
  const { newViolations } = compareAgainstBaseline(findings, baseline);
  assert.equal(
    newViolations.length,
    0,
    `Nye anti-drift-overtraedelser (kør \`node scripts/lint-ui-slop.mjs\` for detaljer):\n${newViolations.join("\n")}`
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/lint-ui-slop.test.mjs`
Expected: FAIL (`scanRepo`/`compareAgainstBaseline` ikke eksporteret + `ui-slop-baseline.json` findes ikke).

- [ ] **Step 3: Implement walk/scan/compare/main** — append til `scripts/lint-ui-slop.mjs`:

```js

// --- Fuld-repo-scan (frontend/src) ----------------------------------------

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      walk(p, out);
    } else if (/\.(jsx?|css)$/.test(f) && !/\.test\.(jsx?|mjs)$/.test(f)) {
      out.push(p);
    }
  }
  return out;
}

// Returnér { "<rel-sti>": {hex, slop, emoji} } for filer med >0 i mindst én kategori.
export function scanRepo() {
  const counts = {};
  for (const file of walk(SRC_DIR)) {
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    if (EXEMPT_FILES.has(rel)) continue;
    const r = scanSource(readFileSync(file, "utf8"));
    if (r.hex || r.slop || r.emoji) counts[rel] = r;
  }
  return counts;
}

// --- Baseline-ratchet (kun stigninger fejler) -----------------------------

const CATS = ["hex", "slop", "emoji"];

export function compareAgainstBaseline(findings, baseline) {
  const base = baseline.files || {};
  const newViolations = [];
  const stale = [];

  for (const [file, counts] of Object.entries(findings)) {
    const allowed = base[file] || { hex: 0, slop: 0, emoji: 0 };
    for (const cat of CATS) {
      const cur = counts[cat] || 0;
      const max = allowed[cat] || 0;
      if (cur > max) {
        newViolations.push(`${file} — ${cat}: ${cur} (baseline tillader ${max}, +${cur - max} ny(e))`);
      }
    }
  }
  for (const [file, allowed] of Object.entries(base)) {
    const cur = findings[file] || { hex: 0, slop: 0, emoji: 0 };
    for (const cat of CATS) {
      if ((cur[cat] || 0) < (allowed[cat] || 0)) {
        stale.push(`${file} — ${cat}: ${cur[cat] || 0}/${allowed[cat] || 0} tilbage (baseline kan strammes)`);
      }
    }
  }
  return { newViolations, stale };
}

function buildBaseline(findings) {
  const files = {};
  for (const file of Object.keys(findings).sort()) files[file] = findings[file];
  return {
    $comment:
      "Kendte UI-anti-drift-overtraedelser (ratchet — maa kun skrumpe). Genereret af scripts/lint-ui-slop.mjs --update-baseline. Refs #671 Plan 3. Nye overtraedelser maa IKKE tilfoejes her — brug ui/-primitiver + tokens, eller (legitimt) udvid EXEMPT_FILES i scriptet med begrundelse. Plan 4 skrumper denne ved at konvertere callsites + emoji.",
    files,
  };
}

// --- Main -----------------------------------------------------------------

function main() {
  const updateBaseline = process.argv.includes("--update-baseline");
  const findings = scanRepo();

  if (updateBaseline) {
    writeFileSync(BASELINE_PATH, JSON.stringify(buildBaseline(findings), null, 2) + "\n");
    const total = Object.values(findings).reduce((s, c) => s + c.hex + c.slop + c.emoji, 0);
    console.log(`✅ Baseline skrevet til scripts/ui-slop-baseline.json (${Object.keys(findings).length} filer, ${total} overtraedelser).`);
    return;
  }

  let baseline = { files: {} };
  if (existsSync(BASELINE_PATH)) baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));

  const { newViolations, stale } = compareAgainstBaseline(findings, baseline);

  if (stale.length) {
    console.log(`ℹ️  ${stale.length} baseline-entr${stale.length === 1 ? "y" : "ies"} skrumpet (fixet) — stram ratchet'en i en dedikeret commit:`);
    for (const s of stale.slice(0, 12)) console.log(`   - ${s}`);
    console.log("   → node scripts/lint-ui-slop.mjs --update-baseline");
  }

  if (newViolations.length) {
    console.error(`\n❌ ${newViolations.length} NY(E) UI-anti-drift-overtraedelse(r) (ikke i baseline):`);
    for (const v of newViolations) console.error(`   - ${v}`);
    console.error(`
Fix:
  - Raa hex  → brug en design-token (cz-*-farve / CSS-var i index.css), ikke #rrggbb.
  - Slop-tell → brug rounded-cz/rounded-cz-pill + hairline-border + shadow-overlay;
               ingen rounded-xl/2xl/3xl, glow (shadow-[0_0...]), backdrop-blur, blur-2xl/3xl.
  - Emoji     → brug et ui/icons/-ikon i stedet for emoji-tegn.
  - Legitim undtagelse? → udvid EXEMPT_FILES i scripts/lint-ui-slop.mjs med begrundelse.
Baseline maa IKKE udvides med nye overtraedelser (ratchet, Refs #671).`);
    process.exit(1);
  }

  const knownFiles = Object.keys(baseline.files || {}).length;
  console.log(`\n✅ UI anti-drift-guard: ingen nye overtraedelser (${knownFiles} kendte baseline-filer).`);
}

function isMain() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMain()) main();
```

- [ ] **Step 4: Generér baseline fra det nuværende træ** (backwards-check — find ALLE eksisterende overtrædelser → baseline dem)

Run: `node scripts/lint-ui-slop.mjs --update-baseline`
Expected: `✅ Baseline skrevet … (N filer, M overtraedelser).` Åbn `scripts/ui-slop-baseline.json` og eyeball: forvent kendte emoji-callsites (fx `pages/admin/*`, `DashboardCustomizeMenu`, Board-flader) + evt. rå hex (fx `JerseyDot`-callsites, recharts-farver) + evt. `rounded-xl/2xl`. Det er teknisk gæld Plan 4 skrumper — IKKE noget Plan 3 fixer.

- [ ] **Step 5: Verify guard is green + tests pass**

Run: `node scripts/lint-ui-slop.mjs`
Expected: `✅ UI anti-drift-guard: ingen nye overtraedelser (…)`.
Run: `node --test scripts/lint-ui-slop.test.mjs`
Expected: PASS (alle 10 tests, inkl. "nul NYE fund").

- [ ] **Step 6: Commit**

```bash
git add scripts/lint-ui-slop.mjs scripts/lint-ui-slop.test.mjs scripts/ui-slop-baseline.json
git commit -m "feat(ci): anti-drift baseline-ratchet + fuld-repo-scan + genereret baseline (#671)"
```

---

## Task 3: Wire anti-drift-lint ind (npm-scripts + lint-staged + CI)

**Files:**
- Modify: `package.json` (root)
- Modify: `lint-staged.config.mjs`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Tilføj npm-scripts** — i root `package.json`, i `"scripts"`-blokken lige efter `"lint:sql"`/`"test:lint-sql"`-linjerne:

```json
    "lint:ui-slop": "node scripts/lint-ui-slop.mjs",
    "test:lint-ui-slop": "node --test scripts/lint-ui-slop.test.mjs",
    "check:ui-slop-baseline": "node scripts/lint-ui-slop.mjs --update-baseline",
```

- [ ] **Step 2: Tilføj lint-staged-entry** — i `lint-staged.config.mjs`, tilføj som ny nøgle i det returnerede objekt (efter i18n-leaks-entryen):

```js
  // #671 Plan 3 forward-guard: UI anti-drift (raa hex + slop-tells + emoji-som-
  // ikon i frontend/src). Scriptet laver altid en fuld-repo-scan mod
  // scripts/ui-slop-baseline.json (ratchet) — staged-args passeres per
  // lint-staged-konventionen men ignoreres, saa resultatet er deterministisk.
  "frontend/src/**/*.{js,jsx,css}": (files) =>
    `node scripts/lint-ui-slop.mjs ${files.map(escape).join(" ")}`,
```

- [ ] **Step 3: Tilføj CI-job** — i `.github/workflows/ci.yml`, tilføj som ny job efter `warning-budget`-jobben (samme struktur):

```yaml
  ui-anti-drift:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    # #671 Plan 3 (spec DEL-C C1): forward-guard mod slop-drift i frontend/src.
    # Fejler KUN paa NYE raa hex / slop-tells (rounded-xl/2xl/3xl, glow,
    # backdrop-blur, blob-blur) / emoji-som-ikon ud over scripts/ui-slop-baseline.json
    # (ratchet — maa kun skrumpe). Kendte callsites + emoji er Plan 4's job.
    steps:
      - name: Check out repository
        uses: actions/checkout@v6

      - name: Set up Node.js
        uses: actions/setup-node@v6
        with:
          node-version: 24

      - name: Test anti-drift guard
        run: node --test scripts/lint-ui-slop.test.mjs

      - name: Run anti-drift guard
        run: node scripts/lint-ui-slop.mjs
```

- [ ] **Step 4: Verify locally**

Run: `npm run test:lint-ui-slop`
Expected: PASS.
Run: `npm run lint:ui-slop`
Expected: `✅ UI anti-drift-guard: ingen nye overtraedelser`.
Run: `node scripts/yaml-validate.mjs .github/workflows/ci.yml` HVIS et yaml-lint-script findes (ellers spring over — `yaml-validate.yml`-workflowet validerer i CI). Bekræft mindst at indrykningen matcher de øvrige jobs (2-space, `steps:` under jobben).

- [ ] **Step 5: Commit**

```bash
git add package.json lint-staged.config.mjs .github/workflows/ci.yml
git commit -m "build(ci): wire anti-drift lint (npm + lint-staged + ci job) (#671)"
```

---

## Task 4: Hærd error-boundary — altid-aktiv + re-skin på ErrorState/Button

Fjern `!ENABLED`-gaten (boundary fanger nu render-fejl uanset Sentry-status) og re-skin `AppErrorFallback` oven på `ErrorState` + `Button` med on-spec tokens. **Bevar** statisk EN/DA-copy (#1170), chunk-reload-recovery og eventId — men vis eventId KUN når `ENABLED` (deterministisk i dev/e2e + meningsfuldt: vi viser kun et id vi faktisk har rapporteret). DIREKTE imports (ikke barrel) så main-bundlen ikke trækker hele ui-laget ind (#479).

**Files:**
- Create: `frontend/src/lib/sentry.boundary.test.js`
- Modify: `frontend/src/lib/sentry.jsx`

- [ ] **Step 1: Write the failing test** (`frontend/src/lib/sentry.boundary.test.js`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "sentry.jsx"), "utf8");

test("boundary er altid-aktiv (ingen !ENABLED early-return der dropper boundary)", () => {
  assert.ok(!/if\s*\(\s*!ENABLED\s*\)\s*return\s+children/.test(src),
    "SentryBoundary maa ikke kortslutte til children naar Sentry er disabled — saa white-screener crashes i dev/preview");
  assert.match(src, /Sentry\.ErrorBoundary/);
});

test("fallback genbruger ErrorState + Button via DIREKTE imports (ikke barrel)", () => {
  assert.match(src, /import\s+ErrorState\s+from\s+["']\.\.\/components\/ui\/ErrorState\.jsx["']/);
  assert.match(src, /import\s+Button\s+from\s+["']\.\.\/components\/ui\/Button\.jsx["']/);
  assert.ok(!/from\s+["']\.\.\/components\/ui\/index\.js["']/.test(src),
    "importér primitiver direkte, ikke via barrel (undgaa at trække hele ui-laget ind i main-bundlen, #479)");
  assert.match(src, /<ErrorState/);
  assert.match(src, /<Button/);
});

test("fallback er on-spec (rounded-cz container, ingen rounded-lg/shadow-sm slop)", () => {
  assert.ok(!/rounded-lg/.test(src), "brug rounded-cz, ikke rounded-lg");
  assert.ok(!/shadow-sm/.test(src), "ingen shadow paa fallback-overflade (hairline)");
});

test("bevarer statisk EN/DA-copy (ingen i18n-runtime i boundary, #1170)", () => {
  assert.match(src, /getPreferredLanguage/);
  assert.ok(!/useTranslation|[^a-zA-Z]t\(/.test(src), "boundary maa ikke afhaenge af i18n-runtime");
  assert.match(src, /eyebrow|Something went wrong|Noget gik galt/);
});

test("bevarer chunk-reload-recovery + reset", () => {
  assert.match(src, /shouldAttemptChunkReload/);
  assert.match(src, /resetError/);
});

test("eventId vises kun naar Sentry er ENABLED (deterministisk fallback)", () => {
  assert.match(src, /ENABLED\s*&&\s*eventId/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/lib/sentry.boundary.test.js`
Expected: FAIL (`!ENABLED return children` findes stadig; ingen ErrorState/Button-import).

- [ ] **Step 3: Implement** — rediger `frontend/src/lib/sentry.jsx`:

**3a.** Tilføj direkte primitiv-imports øverst (efter de eksisterende imports, linje 1-3):

```jsx
import ErrorState from "../components/ui/ErrorState.jsx";
import Button from "../components/ui/Button.jsx";
```

**3b.** Erstat `SentryBoundary` (nuværende linje 41-54) — fjern `!ENABLED`-gaten så boundary'en altid wrapper. `beforeCapture` er en no-op uden aktiv client, så det er sikkert at lade den køre altid:

```jsx
export function SentryBoundary({ children }) {
  // Altid-aktiv: Sentry.ErrorBoundary fungerer som en almindelig React-
  // error-boundary selv uden init (captureException er en no-op uden client),
  // saa render-fejl fanges OGSAA i dev/preview/uden DSN -> branded fallback i
  // stedet for white-screen (#671 Plan 3). Rapportering sker kun naar ENABLED.
  return (
    <Sentry.ErrorBoundary
      beforeCapture={(scope, error) => {
        scope.setTag("frontend_error_kind", isChunkLoadError(error) ? "chunk_load_error" : "render_error");
        if (RELEASE) scope.setTag("frontend_release", RELEASE);
      }}
      fallback={(props) => <AppErrorFallback {...props} />}
    >
      {children}
    </Sentry.ErrorBoundary>
  );
}
```

**3c.** Erstat `AppErrorFallback`-returblokken (nuværende linje 107-138, dvs. fra `return (` til komponentens afsluttende `}`) — behold copy-objektet + `useEffect`-chunk-reload-blokken uændret OVENFOR; udskift KUN JSX'en:

```jsx
  return (
    <main className="flex min-h-screen items-center justify-center bg-cz-body px-4 py-10 text-cz-1">
      <ErrorState
        className="w-full max-w-lg border-cz-border bg-cz-card"
        title={copy.title}
        description={copy.body}
        action={
          <div className="flex flex-col items-center gap-3">
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" size="sm" onClick={() => window.location.reload()}>
                {copy.reload}
              </Button>
              {!chunkError && (
                <Button variant="secondary" size="sm" onClick={() => resetError?.()}>
                  {copy.retry}
                </Button>
              )}
            </div>
            {ENABLED && eventId && (
              <p className="font-mono text-[11px] text-cz-3">
                {copy.event}: {eventId}
              </p>
            )}
          </div>
        }
      />
    </main>
  );
```

> Note: `copy.eyebrow` udgår (ErrorState har titel+beskrivelse; chunk-vs-render-distinktionen bæres af `copy.title`/`copy.body`). Behold `eyebrow`-nøglerne i `copy`-objektet så testens `eyebrow|...`-assert + fremtidig brug er intakt, ELLER fjern dem og lad assert matche `Noget gik galt`. (Simplest: behold `copy`-objektet uændret.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/lib/sentry.boundary.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Verify build + warning-budget**

Run: `cd frontend && npm run build`
Expected: build OK, ingen import-fejl (verificerer at de direkte `.jsx`-imports resolver — ESM-loader er striks, #803).
Run: `cd frontend && npm run lint`
Expected: ingen nye warnings/errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/sentry.jsx frontend/src/lib/sentry.boundary.test.js
git commit -m "fix(ui): altid-aktiv error-boundary + on-spec ErrorState/Button-fallback (#671)"
```

---

## Task 5: Forced-error-demo (gated) + Playwright-bevis

Gør den branded fallback observerbar (ejer-lås + automatiseret bevis) uden at forstyrre den eksisterende `/ui`-snapshot. Trigger gates på `?boom=1` + (DEV eller `VITE_E2E`), så den ALDRIG er i prod og IKKE påvirker default-`/ui`-renderen (kitchen-sink-baseline uændret).

**Files:**
- Modify: `frontend/src/pages/KitchenSinkPage.jsx`
- Create: `frontend/tests/e2e/error-boundary.spec.js`

- [ ] **Step 1: Tilføj forced-error-mekanisme** i `frontend/src/pages/KitchenSinkPage.jsx`.

**1a.** Lige under den eksisterende `import`-blok (efter linje 12-15), tilføj:

```jsx
// #671 Plan 3 — gated forced-error-trigger til error-boundary-demo/-test.
// Kun naar `?boom=1` OG (dev eller e2e): aldrig i prod, og default-/ui
// (snapshot-target) er upaavirket. En render der kaster -> top-niveau-
// SentryBoundary fanger -> branded fallback.
const BOOM_ENABLED = import.meta.env.DEV || import.meta.env.VITE_E2E === "1";
function boomRequested() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("boom") === "1";
}
function Boom() {
  throw new Error("Kitchen-sink forced render error (error-boundary demo)");
}
```

**1b.** I `KitchenSinkPage`-komponenten, tilføj state øverst (efter de eksisterende `useState`-linjer, ~linje 29-30):

```jsx
  const [boom, setBoom] = useState(false);
```

**1c.** Render trigger-sektionen + det kastende barn — indsæt lige FØR den afsluttende `</main>` (nuværende linje 294):

```jsx
      {BOOM_ENABLED && boomRequested() && (
        <Section title="Error boundary (dev/e2e)">
          <Button variant="danger" size="sm" onClick={() => setBoom(true)}>
            Trigger render error
          </Button>
          {boom && <Boom />}
        </Section>
      )}
```

- [ ] **Step 2: Verify default-/ui-snapshot er upåvirket**

Run: `cd frontend && npx playwright test kitchen-sink`
Expected: PASS (3 projekter lokalt) UDEN snapshot-opdatering — boom-sektionen rendres ikke uden `?boom=1`, så `kitchen-sink.png`-baselines er uændrede. (Hvis denne fejler på en pixel-diff er noget galt — fix, snapshot ikke væk.)

- [ ] **Step 3: Write the Playwright spec** (`frontend/tests/e2e/error-boundary.spec.js`)

```js
import { expect, test } from "@playwright/test";
import { installNetworkMocks, stabilizePage } from "./fixtures.js";

// Verificér at den altid-aktive boundary (Task 4) fanger en render-fejl i en
// PROD preview-build (ingen Sentry-DSN i e2e -> foer Plan 3 var boundary'en
// disabled her -> white-screen) og render den branded fallback paa
// ErrorState/Button. stabilizePage saetter cz_lang=da -> DA-copy.
test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

test("error-boundary fanger render-fejl og viser branded fallback (DA)", async ({ page }) => {
  await page.goto("/ui?boom=1");
  await page.getByRole("button", { name: "Trigger render error" }).click();

  // Branded fallback (DA, render-fejl-variant) — IKKE white-screen.
  await expect(page.getByRole("heading", { name: "Siden kunne ikke vises" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Genindlæs siden" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Prøv igen" })).toBeVisible();
  // Ingen eventId-linje naar Sentry er disabled (e2e har ingen DSN).
  await expect(page.getByText(/Fejl-id:/)).toHaveCount(0);
});

test("fallback render i EN naar cz_lang=en", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("cz_lang", "en"));
  await page.goto("/ui?boom=1");
  await page.getByRole("button", { name: "Trigger render error" }).click();
  await expect(page.getByRole("heading", { name: "The page could not be shown" })).toBeVisible();
});
```

> Bemærk: `stabilizePage` sætter `cz_lang=da` via `addInitScript`; test 2's egen `addInitScript` kører EFTER og overskriver til `en` (sidst registrerede init-script vinder rækkefølgen). Verificér i Step 4 at EN-testen faktisk rammer EN-copy; hvis init-rækkefølgen driller, sæt i stedet `cz_lang` direkte i test 2 via `page.context().addInitScript` før `installNetworkMocks` — men standard-rækkefølgen virker (beforeEach kører først, testens egen init sidst).

- [ ] **Step 4: Run the error-boundary spec**

Run: `cd frontend && npx playwright test error-boundary`
Expected: PASS (begge tests × 3 projekter lokalt; CI kører 2 projekter). Hvis EN-testen rammer DA-heading → init-script-rækkefølge; flyt `cz_lang=en`-sætningen som noten beskriver.
**Verifikations-gotcha (Plan 2b):** kør med frisk `PW_PORT` ved manuel/interaktiv verifikation — `reuseExistingServer: true` kan ellers servere et stale build → false-red (`.claude/learnings/2026-06-14-playwright-reuse-existing-server-stale-build-false-red.md`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/KitchenSinkPage.jsx frontend/tests/e2e/error-boundary.spec.js
git commit -m "test(ui): gated forced-error-demo + error-boundary e2e-bevis (#671)"
```

---

## Task 6: Docs (hvorfor-ikke) + fuld gate + PR + ejer-lås

**Files:**
- Modify: `docs/NOW.md` (close-out + 🎯 Next action + 🤖 Working agent)
- (Ingen `PatchNotesPage.jsx`/`help.json`-ændring — begrundet nedenfor)

- [ ] **Step 1: Patch notes + help — hvorfor IKKE** (skriv beslutningen i PR-body + NOW close-out)

**Patch notes:** ingen. Begrundelse: i PRODUKTION havde error-boundary'en allerede en branded fallback (Sentry `ENABLED` = prod+DSN). Plan 3-ændringen er (a) intern hærdning — boundary'en er nu også aktiv i dev/preview/uden DSN (en kant rigtige spillere ikke rammer) — og (b) en design-system-kosmetisk re-skin (`rounded-lg`→`rounded-cz`, ErrorState/Button) af en fejl-skærm de færreste ser. Ingen netto prod-bruger-adfærdsændring → en patch note ville være støj (og ville koble en version-bump + NOW.md-krav på via `check-patch-notes-version.js`). Hvis ejeren ønsker en linje, er "Fixed · Reliability" trivielt at tilføje (bump 5.35 → 5.36).
**Help/FAQ:** ingen — ingen ny/ændret spilmekanik (anti-drift-lint er internt/CI; error-boundary er en fejl-skærm).

- [ ] **Step 2: Full local gate** (jf. CLAUDE.md pre-flight + [[feedback_full_ci_gate_before_pr]])

Run: `pwsh -File scripts/verify-local.ps1` (backend + frontend `node --test` + frontend build)
Run: `cd frontend && npm run lint`
Run (repo-root): `npm run check:i18n`
Run (repo-root): `node scripts/check-eslint-warning-budget.mjs`
Run (repo-root): `npm run test:lint-ui-slop && npm run lint:ui-slop`
Run: `cd frontend && npx playwright test core-smoke` (verificér INGEN regression — boundary-ændringen rører ikke normale flader; en utilsigtet diff = regression der fixes, ikke snapshottes væk)
Run: `cd frontend && npx playwright test kitchen-sink error-boundary` (de to /ui-specs)
Expected: alt grønt. Warning-budget ikke overskredet.

> Bemærk: `verify-local.ps1` kører backend + frontend `node --test`, men de NYE root-niveau-`node --test`-filer (`scripts/lint-ui-slop.test.mjs`) køres eksplicit via `npm run test:lint-ui-slop` ovenfor (verify-local dækker kun backend/+frontend/). `sentry.boundary.test.js` ligger i `frontend/src/` → dækkes af frontend `node --test` i verify-local.

- [ ] **Step 3: Push + PR**

```bash
git push -u origin feat/ui-foundation-3-anti-drift-error-boundary
```

Opret PR. **PR-body SKAL have en Brugerverifikation-sektion med mindst én `- [x]` afkrydset** (ellers fejler `PR user-verification check` — bidt 3x, senest #1393). Konkret PR-body-skelet:

```markdown
## Hvad
Plan 3 (#671): anti-drift lint-guard (forward-guard, baseline-ratchet) + hærdning af den globale error-boundary (altid-aktiv + on-spec ErrorState/Button-fallback).

## Afvigelser fra task-spec (bevidste)
- Error-boundary FANDTES allerede (SentryBoundary i lib/sentry.jsx, wired i main.jsx). Plan 3 hærder den i stedet for at bygge ny: fjerner `!ENABLED`-gaten (ingen white-screen i dev/preview/uden DSN) + re-skinner paa ErrorState/Button.
- Boundary BLIVER i main.jsx (ikke flyttet til App.jsx): bredere coverage (provider-fejl) + data-theme ryddes ikke ved unmount, saa fallback render korrekt i begge temaer.

## Patch notes
Ingen (begrundet): ingen netto prod-bruger-adfaerdsaendring — prod havde allerede branded boundary; aendringen er intern hardning + kosmetisk re-skin af en fejl-skaerm. Help: N/A (ingen spilmekanik).

## Brugerverifikation
- [x] `npm run test:lint-ui-slop` + `npm run lint:ui-slop` grønne (anti-drift: nul nye overtraedelser)
- [x] `npx playwright test error-boundary` grøn (branded fallback fanger render-fejl i prod-build, EN+DA)
- [x] `npx playwright test core-smoke kitchen-sink` grøn (nul visuel regression)
- [ ] Ejer: set fallback live i begge temaer paa /ui?boom=1 (ejer-laas, Step 4)
```

Ingen migration → normal PR-flow (men ejer-lås før merge, Step 4). Backend-only/docs-only label er IKKE relevant (frontend-ændring).

- [ ] **Step 4: EJER-LÅS (visuelt gate)**

Start preview (frisk `PW_PORT`), åbn `/ui?boom=1`, klik "Trigger render error", og vis ejeren den branded fallback i **begge temaer** (theme-toggle) + begge sprog (sæt `localStorage cz_lang` = `en`/`da`, reload). Verificér:
- **On-spec:** `rounded-cz` (5px) container, hairline-border, AlertTriangle-ikon fra ui/icons, primær "Reload"-knap (guld) + sekundær "Try again" (neutral outline). Ingen `rounded-lg`, ingen glow/shadow-slop.
- **Begge temaer:** korrekt baggrund/kontrast i light "Chalk" + dark navy (verificerer data-theme-persistens efter crash).
- **Begge sprog:** EN-copy default, DA ved `cz_lang=da`.
- **Ingen eventId-linje** i preview (Sentry disabled) — den dukker kun op i prod hvor vi faktisk rapporterer.
- **Chunk-error-variant** (valgfrit): svær at fremtvinge manuelt; dækket af bevaret `shouldAttemptChunkReload`-logik + boundary.source-test.

Eksekutoren kan fange begge temaer via preview-screenshot-værktøjet og vise ejeren (memory [[feedback_show_visuals_via_widget_not_read]]) frem for at bede om manuel browsing. **Lås looket eller noter justeringer FØR Plan 3 afsluttes.**

---

## Self-review (udført)

- **Spec-dækning:**
  - **C1 anti-re-drift-guard:** Task 1-3. Forbyder NYE rå hex (`countHex`, index.css undtaget) + slop-tells `rounded-xl/2xl/3xl`/glow `shadow-[0_0`/`backdrop-blur`/blob-`blur-2xl/3xl` (`countSlop`) + emoji-som-ikon (`countEmoji`, ©®™ undtaget). Baseline-snapshot (`scripts/ui-slop-baseline.json`, genereret Task 2 Step 4) = præcis samme mønster som `i18n-leaks-baseline.json` (per-fil count-ratchet, `--update-baseline`, fejl kun på stigninger). Backwards-check (find alle eksisterende → baseline) + forward-guard (CI + lint-staged). Følger `lint-*.mjs`+`lint-*.test.mjs`+npm-script+CI-mønsteret. Reglen dokumenteret i scriptets header-blok (single source of truth) + PR-body.
  - **C2-step-1 error-boundary:** Task 4-5. Verificeret FØRST at en findes (afsnit "Vigtigt fund") → hærdet: altid-aktiv (ingen white-screen) + branded fallback der GENBRUGER `ErrorState`-primitiven (+`Button`), on-spec/anti-slop/reduced-motion-aware (ErrorState arver token-systemet; ingen egen animation). `Sentry.ErrorBoundary` bevaret → crashes rapporteres + eventId (kun når ENABLED). Wiring: boundary forbliver i main.jsx (begrundet afvigelse fra "App.jsx").
  - **C3 gates:** Task 6 Step 2 — verify-local + eslint + check:i18n + check:warnings + core-smoke + den nye anti-drift-lint + error-boundary-spec. a11y: ErrorState/Button arver fundamentets focus-ring + role-semantik; reduced-motion overholdt (ingen ny animation).
  - Eksplicit ude af scope: konvertering af de ~366 callsites + emoji→ikoner = Plan 4 (Plan 3 baseliner dem). Endelig stramning af ui-slop-baselinen sker løbende i Plan 4.
- **Placeholders:** ingen TBD/TODO; hvert kode-trin har faktisk kode + kommando + forventet output. Baselinen er bevidst maskin-genereret (Task 2 Step 4), ikke hårdkodet — dens indhold afhænger af det nuværende træ.
- **Type-konsistens:** detektorerne `countHex`/`countSlop`/`countEmoji`/`scanSource` (Task 1) forbruges af `scanRepo` (Task 2) og testet i begge tasks. `compareAgainstBaseline(findings, baseline)` returnerer `{ newViolations, stale }` — samme form i implementering (Task 2 Step 3), test (Task 2 Step 1) og `main` (Task 2 Step 3). Baseline-shape `{ files: { "<rel>": {hex,slop,emoji} } }` konsistent i `buildBaseline`/`compareAgainstBaseline`/testen. `lint:ui-slop`/`test:lint-ui-slop` (Task 3) peger på samme script. `ErrorState`/`Button`-imports (Task 4) matcher de eksisterende default-exports (`ErrorState.jsx`/`Button.jsx`). `BOOM_ENABLED`/`boomRequested`/`Boom` (Task 5) konsistente.
- **Anti-slop:** den re-skinned fallback bruger `rounded-cz` + hairline + ErrorState/Button (testet: ingen `rounded-lg`/`shadow-sm`). Lint-scriptet håndhæver resten fremadrettet. Boom-triggeren er gated væk fra prod + fra default-snapshot.

## Åbne afhængigheder / noter

- **Boundary-placering:** forbliver i `main.jsx` (begrundet afvigelse fra "wire ind i App.jsx"). Hvis ejeren foretrækker en ekstra rute-niveau-boundary (så et enkelt side-crash bevarer app-shell/sidebar i stedet for fuld-skærm-fallback) er det en separat, additiv forbedring — ikke nødvendig for "fallback i stedet for white-screen".
- **`Sentry.ErrorBoundary` uden init:** fungerer som almindelig React-boundary (`componentDidCatch` → `captureException` no-op uden client). eventId kan være en genereret uuid uden init → derfor gates visningen på `ENABLED` (deterministisk + meningsfuld). Verificeret antagelse; bekræftes endeligt af e2e-spec'en (Task 5: ingen `Fejl-id:`-linje i preview).
- **Emoji-detektor** matcher `\p{Extended_Pictographic}` minus ©®™. Hvis Plan 4 (eller en ny flade) introducerer et legitimt nyt tekst-symbol der fejl-flagges, udvides `EMOJI_TEXT_EXEMPT`/`EXEMPT_FILES` med begrundelse (ikke baselinen — baseline = gæld der skal væk).
- **Hex-detektor** undtager KUN `frontend/src/index.css` (token-filen). Andre `.css`-filer i `frontend/src` scannes; hvis der er nogen med legitime token-lignende hex, fanges de i baselinen Task 2 Step 4 (gæld Plan 4 rydder).
- **Bundle-påvirkning:** de direkte `ErrorState`/`Button`-imports i `sentry.jsx` (eager i main-bundlen) trækker kun `ErrorState`+`AlertTriangleIcon`+`IconBase`+`Button`+`buttonStyles` ind (tree-shakeable named icon-exports) — ikke hele ui-barrel'en. Verificeres ikke-regressivt af `npm run build` (Task 4 Step 5) + warning-budget.
- **Playwright-snapshots er win32-baseline** (frontend-smoke advisory, [[reference_frontend_smoke_teardown_flake]]). error-boundary-spec'en bruger KUN tekst-asserts (ingen ny PNG-baseline) → ingen cross-OS-snapshot-gæld.
