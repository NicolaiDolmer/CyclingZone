# Rider Valuation v3 (alsidigheds-blend + krumning) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Model v3 for `riders.base_value` (#1101): alsidigheds-blend (α=0,5) + kvadratisk krumning + permanent ordens-guard, re-fit mod ejerens 22 anchors (9/6-niveauer), backfill i shadow til prod, og dokumentér den datadrevne 3-fase-roadmap.

**Architecture:** `riderValuation.js` udvides bagudkompatibelt: `predictBaseValue` læser `model.alpha` (blend) og `model.c` (krumning) med defaults der replikerer v2. Fit-matematikken ekstraheres til ny ren lib `riderValuationFit.js` (OLS + ordens-guard, testbar), som `scripts/fitRiderValuationModel.js` bruger. Alle forbrugere (backfillCores, api.js-preview, progression-engine, sæson-dry-run) går gennem `predictBaseValue` og opgraderes automatisk af den nye model-JSON.

**Tech Stack:** Node.js ESM, `node --test`, Supabase service-client (kun fit/backfill-scripts), ingen nye dependencies.

**Empirisk grundlag (tmp-experiment 9/6, 22 anchors):** α=0,5 + kvadratisk: R²(log) 0,942 (mod 0,865 i v2), Pogačar 142,7M > MvdP 89,9M (ejer-orden genoprettet), 0 hårde ordensbrud (≥15M-båndet), 12 bløde i 2,5-13M-båndet (ægte anchor/ability-uenigheder, rapporteres men blokerer ikke).

**Beslutninger truffet af ejer (9/6):** Top-anchors hævet (Pogačar 125M, MvdP 95M, Philipsen 65M m.fl. — allerede i `riderValuationAnchors.json`). Fiktive ryttere røres IKKE i denne omgang. Backfill = shadow only; cutover (slice 2) forbliver gated på ejer-verify af de nye værdier.

---

## Fasekort (kort og langt sigt — dokumenteres i Task 6)

- **Fase 1 (denne plan):** Perception-model v3, anchors = træningsdata. Manuel re-fit med ordens-guard.
- **Fase 2 (efter egen race-motor #1102/#676):** Værdi = forventet sæsonproduktion: simulér sæsonkalenderen N gange, fit værdi mod forventede point/præmier. Anchors degraderes til validering.
- **Fase 3 (live, del af #1101-scope):** Dynamisk glidning af `base_value` mod faktiske auktions-/handelspriser ved finalization + periodisk re-fit. Markedet bliver sandheden.

---

### Task 1: v3 i `riderValuation.js` (blend + krumning, bagudkompatibel)

**Files:**
- Modify: `backend/lib/riderValuation.js`
- Test: `backend/lib/riderValuation.test.js`

- [ ] **Step 1: Skriv de fejlende tests**

Tilføj nederst i `backend/lib/riderValuation.test.js`, og udvid importen øverst med `meanAbilityScore, blendedOutput`:

```js
test("meanAbilityScore er det uafrundede snit af alle abilities", () => {
  assert.equal(meanAbilityScore(abilities(50)), 50);
  // 13 evner på 40 + climbing 95 → 615/14 (uafrundet, modsat riderOverall).
  assert.equal(meanAbilityScore(abilities(40, { climbing: 95 })), 615 / 14);
});

test("blendedOutput: alpha=1 → ren speciale-score, alpha=0 → snit af alt, 0.5 → midt imellem", () => {
  const ab = abilities(40, { cobblestone: 90, flat: 90, endurance: 90, punch: 90 });
  const spec = outputScore(ab, "brostensrytter");
  const mean = meanAbilityScore(ab);
  assert.equal(blendedOutput(ab, "brostensrytter", 1), spec);
  assert.equal(blendedOutput(ab, "brostensrytter", 0), mean);
  assert.equal(blendedOutput(ab, "brostensrytter", 0.5), (spec + mean) / 2);
});

test("predictBaseValue v2-model (uden alpha/c) er uændret", () => {
  const model = { a: Math.log(1000), b: 0, offset: { gc: Math.log(2) } };
  assert.equal(predictBaseValue({ primary_type: "gc" }, abilities(50), model), 2000);
});

test("predictBaseValue v3: kvadratisk led (c>0) strækker toppen relativt mere", () => {
  const base = { a: 0, b: 0.05, offset: {} };
  const quad = { ...base, c: 0.001 };
  const liftLo = predictBaseValue({ primary_type: "gc" }, abilities(40), quad)
    / predictBaseValue({ primary_type: "gc" }, abilities(40), base);
  const liftHi = predictBaseValue({ primary_type: "gc" }, abilities(90), quad)
    / predictBaseValue({ primary_type: "gc" }, abilities(90), base);
  assert.ok(liftHi > liftLo, `c>0 skal løfte toppen relativt mere (${liftHi} > ${liftLo})`);
});

test("v3 med alpha<1 værdsætter alsidighed: bred elite slår smal specialist", () => {
  // "Pogacar-profil": elite i ALT. "MvdP-profil": uslåelig på specialet, hul i klatring.
  const broad = abilities(85, { climbing: 96, tempo: 99, endurance: 99 });
  const narrow = abilities(55, { cobblestone: 95, flat: 92, endurance: 93, punch: 86, climbing: 45 });
  const model = { alpha: 0.5, a: 0, b: 0.1, c: 0.0005, offset: {} };
  const vBroad = predictBaseValue({ primary_type: "gc" }, broad, model);
  const vNarrow = predictBaseValue({ primary_type: "brostensrytter" }, narrow, model);
  assert.ok(vBroad > vNarrow, `bred elite (${vBroad}) skal slå smal specialist (${vNarrow})`);
});
```

- [ ] **Step 2: Kør testene og se dem fejle**

Kør (fra `backend/`): `node --test lib/riderValuation.test.js`
Forventet: FAIL — `meanAbilityScore is not defined` (importfejl) eller tilsvarende.

- [ ] **Step 3: Implementér v3 i `riderValuation.js`**

Indsæt efter `outputScore`-funktionen:

```js
// Uafrundet snit over alle abilities (0-99). riderOverall er display-versionen (afrundet).
export function meanAbilityScore(abilities = {}) {
  let sum = 0, n = 0;
  for (const k of ABILITY_KEYS) {
    const v = Number(abilities?.[k]);
    if (Number.isFinite(v)) { sum += v; n += 1; }
  }
  return n > 0 ? sum / n : 0;
}

// v3-output: alsidigheds-blend mellem speciale-score og snit af alle evner.
// alpha=1 → ren speciale-score (v2-adfærd). Kalibreret alpha ligger i model-JSON.
export function blendedOutput(abilities = {}, primaryType = null, alpha = 1) {
  const a = Number.isFinite(Number(alpha)) ? Math.min(1, Math.max(0, Number(alpha))) : 1;
  const spec = outputScore(abilities, primaryType);
  if (a >= 1) return spec;
  return a * spec + (1 - a) * meanAbilityScore(abilities);
}
```

Erstat i `predictBaseValue` de to linjer der beregner `O` og `value`:

```js
  const type = rider?.primary_type ?? null;
  const O = blendedOutput(abilities, type, model.alpha ?? 1);
  const offset = model.offset?.[type] ?? 0;
  const c = Number.isFinite(Number(model.c)) ? Number(model.c) : 0;
  const value = Math.exp(model.a + model.b * O + c * O * O + offset);
```

Opdatér fil-hovedkommentaren: model-formlen er nu `ln(base_value) = a + b·O + c·O² + offset[primary_type]` med `O = alpha·speciale + (1−alpha)·snit` (v3, 9/6-2026); v2-JSON (uden `alpha`/`c`) opfører sig uændret.

- [ ] **Step 4: Kør testene igen**

Kør: `node --test lib/riderValuation.test.js`
Forventet: PASS (alle, inkl. de eksisterende v2-tests — bagudkompatibilitet bevist).

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/1101-valuation-v3
git add backend/lib/riderValuation.js backend/lib/riderValuation.test.js
git commit -m "feat(valuation): #1101 model v3 - alsidigheds-blend + kvadratisk krumning i predictBaseValue (bagudkompatibel)"
```

---

### Task 2: Ny lib `riderValuationFit.js` (OLS + ordens-guard, ren og testbar)

**Files:**
- Create: `backend/lib/riderValuationFit.js`
- Test: `backend/lib/riderValuationFit.test.js`

- [ ] **Step 1: Skriv de fejlende tests**

Opret `backend/lib/riderValuationFit.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import { olsSolve, fitValuationModel, checkAnchorOrdering } from "./riderValuationFit.js";

test("olsSolve løser y=2x eksakt", () => {
  const beta = olsSolve([[1, 1], [1, 2], [1, 3]], [2, 4, 6]);
  assert.ok(Math.abs(beta[0]) < 1e-9, `intercept ~0 (${beta[0]})`);
  assert.ok(Math.abs(beta[1] - 2) < 1e-9, `hældning ~2 (${beta[1]})`);
});

test("olsSolve genfinder et kvadratisk polynomium eksakt", () => {
  const f = (x) => 1 + 2 * x + 0.5 * x * x;
  const xs = [1, 2, 3, 5, 8];
  const beta = olsSolve(xs.map((x) => [1, x, x * x]), xs.map(f));
  assert.ok(Math.abs(beta[0] - 1) < 1e-9 && Math.abs(beta[1] - 2) < 1e-9 && Math.abs(beta[2] - 0.5) < 1e-9,
    `beta=[1,2,0.5] (${beta})`);
});

test("fitValuationModel rammer syntetiske anchors perfekt når data følger modellen", () => {
  const mk = (type, output) => ({
    name: `${type}-${output}`, type, output,
    target: Math.exp(2 + 0.1 * output + 0.001 * output ** 2 + (type === "gc" ? 0.3 : -0.3)),
  });
  const anchors = [mk("gc", 60), mk("gc", 70), mk("gc", 90), mk("tt", 55), mk("tt", 75), mk("tt", 85)];
  const fit = fitValuationModel(anchors);
  assert.ok(fit.r2 > 0.999, `R² ~1 (${fit.r2})`);
  assert.ok(Math.abs(fit.offset.gc - 0.3) < 0.01 && Math.abs(fit.offset.tt + 0.3) < 0.01,
    `type-offsets genfundet (${JSON.stringify(fit.offset)})`);
});

test("checkAnchorOrdering skelner hårde (mål ≥15M) og bløde brud", () => {
  const anchors = [
    { name: "Stjerne", target: 100e6 }, { name: "Naeststjerne", target: 50e6 },
    { name: "Mellem", target: 8e6 }, { name: "Billig", target: 3e6 },
  ];
  // predict inverterer Stjerne/Naeststjerne (hård zone) og Mellem/Billig (blød zone).
  const preds = { Stjerne: 40e6, Naeststjerne: 60e6, Mellem: 2e6, Billig: 4e6 };
  const { hard, soft } = checkAnchorOrdering(anchors, (a) => preds[a.name]);
  assert.equal(hard.length, 1);
  assert.equal(hard[0].high, "Stjerne");
  assert.equal(soft.length, 1);
  assert.equal(soft[0].high, "Mellem");
});

test("checkAnchorOrdering er tom når ordenen holder", () => {
  const anchors = [{ name: "A", target: 10e6 }, { name: "B", target: 1e6 }];
  const { hard, soft } = checkAnchorOrdering(anchors, (a) => a.target);
  assert.equal(hard.length + soft.length, 0);
});
```

- [ ] **Step 2: Kør testene og se dem fejle**

Kør: `node --test lib/riderValuationFit.test.js`
Forventet: FAIL — `Cannot find module './riderValuationFit.js'`.

- [ ] **Step 3: Implementér `riderValuationFit.js`**

Opret `backend/lib/riderValuationFit.js`:

```js
// Fit-kerne for værdimodellen (#1101 v3) — ren og testbar; bruges af
// scripts/fitRiderValuationModel.js.
//
//   ln(value) = a + b·O + c·O² + offset[primary_type]
//   O = blendet output (riderValuation.js: blendedOutput)
//
// To-trins-fit (samme princip som v2): (1) OLS af ln(target) på [1, O, O²];
// (2) type-offset = gennemsnitlig residual pr. type (fixed effect; typer uden
// anchor får 0 = neutral). checkAnchorOrdering håndhæver ejer-rækkefølgen:
// "MvdP dyrere end Pogačar" må aldrig slippe stille igennem et re-fit igen.

// OLS via normalligninger + Gauss-Jordan. Lille (k ≤ 3) og eksakt nok her;
// generel numerik er bevidst fravalgt (YAGNI).
export function olsSolve(X, y) {
  const k = X[0].length;
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0));
  const Xty = new Array(k).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let r = 0; r < k; r++) {
      Xty[r] += X[i][r] * y[i];
      for (let c = 0; c < k; c++) XtX[r][c] += X[i][r] * X[i][c];
    }
  }
  const A = XtX.map((row, i) => [...row, Xty[i]]);
  for (let col = 0; col < k; col++) {
    let p = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(A[r][col]) > Math.abs(A[p][col])) p = r;
    [A[col], A[p]] = [A[p], A[col]];
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let c = col; c <= k; c++) A[r][c] -= f * A[col][c];
    }
  }
  // Diagonalen er A[i][i] = row[i] efter Gauss-Jordan; løsningen er row[k]/row[i].
  return A.map((row, i) => row[k] / row[i]);
}

// anchors: [{ name, type, output, target }] → { a, b, c, offset, r2, predictLn }.
export function fitValuationModel(anchors, { quadratic = true } = {}) {
  const Ys = anchors.map((an) => Math.log(an.target));
  const X = anchors.map((an) => (quadratic ? [1, an.output, an.output ** 2] : [1, an.output]));
  const [a, b, c = 0] = olsSolve(X, Ys);
  const lin = (o) => a + b * o + c * o * o;

  const resByType = {};
  anchors.forEach((an, i) => (resByType[an.type] ??= []).push(Ys[i] - lin(an.output)));
  const offset = {};
  for (const [t, arr] of Object.entries(resByType)) {
    offset[t] = arr.reduce((s, v) => s + v, 0) / arr.length;
  }

  const predictLn = (an) => lin(an.output) + (offset[an.type] ?? 0);
  let ssRes = 0, ssTot = 0;
  const mY = Ys.reduce((s, v) => s + v, 0) / Ys.length;
  anchors.forEach((an, i) => {
    ssRes += (Ys[i] - predictLn(an)) ** 2;
    ssTot += (Ys[i] - mY) ** 2;
  });
  return { a, b, c, offset, r2: 1 - ssRes / ssTot, predictLn };
}

// Ordens-guard: for alle anchor-par hvor mål adskiller sig > ratio skal forudsigelsen
// bevare ejerens rækkefølge. Brud med høj-anchor-mål ≥ hardMin er HÅRDE (fit afvises);
// resten er bløde (rapporteres — ægte anchor/ability-uenigheder i midterfeltet).
export function checkAnchorOrdering(anchors, predict, { ratio = 1.3, hardMin = 15e6 } = {}) {
  const hard = [], soft = [];
  for (const hi of anchors) {
    for (const lo of anchors) {
      if (hi.target > lo.target * ratio && predict(hi) <= predict(lo)) {
        (hi.target >= hardMin ? hard : soft).push({
          high: hi.name, low: lo.name,
          predHigh: Math.round(predict(hi)), predLow: Math.round(predict(lo)),
        });
      }
    }
  }
  return { hard, soft };
}
```

- [ ] **Step 4: Kør testene igen**

Kør: `node --test lib/riderValuationFit.test.js`
Forventet: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add backend/lib/riderValuationFit.js backend/lib/riderValuationFit.test.js
git commit -m "feat(valuation): #1101 fit-kerne som ren lib (OLS + ordens-guard) med tests"
```

---

### Task 3: Omskriv `fitRiderValuationModel.js` til v3 + guard, verificér med dry-run

**Files:**
- Modify: `backend/scripts/fitRiderValuationModel.js`

- [ ] **Step 1: Omskriv scriptet**

Erstat indholdet af `backend/scripts/fitRiderValuationModel.js` med:

```js
#!/usr/bin/env node
// Træn rider-valuation-modellen (#1101) på EJER-KALIBREREDE anchors.
//
// MODEL v3 (9/6-2026): ln(base_value) = a + b·O + c·O² + offset[primary_type],
//   O = ALPHA·speciale-output + (1−ALPHA)·snit af alle evner (alsidigheds-blend).
// Afløser v2 (ren speciale-output, lineær): den kunne ikke se alsidighed og satte
// MvdP over Pogačar. Manuel re-fit (ejer-godkendt) — INGEN auto-læring. Skriver
// koefficienter + metadata til backend/lib/riderValuationModel.json (committes og
// bruges af riderValuation.js + alle forbrugere af predictBaseValue).
//
//   node scripts/fitRiderValuationModel.js            # fit + skriv JSON
//   node scripts/fitRiderValuationModel.js --dry-run  # fit + rapportér, skriv intet
//
// ORDENS-GUARD: anchors med mål ≥15M og >30% målafstand SKAL forudsiges i ejerens
// rækkefølge — ellers fejler fittet højt (exit 1). Bløde brud (<15M) rapporteres kun.
// Anchors: backend/lib/riderValuationAnchors.json. Se docs/decisions/rider-valuation-model-v1.md.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { blendedOutput } from "../lib/riderValuation.js";
import { fitValuationModel, checkAnchorOrdering } from "../lib/riderValuationFit.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const DRY_RUN = process.argv.includes("--dry-run");
const MODEL_PATH = join(__dirname, "../lib/riderValuationModel.json");
const ANCHORS_PATH = join(__dirname, "../lib/riderValuationAnchors.json");

// Alsidigheds-blend (ejer-kalibreret 9/6: bedste R² + korrekt top-orden i eksperiment).
const ALPHA = 0.5;

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Accent-ufølsom navne-normalisering til anchor-matching.
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
const fmtM = (n) => (n / 1e6).toFixed(1) + "M";

async function main() {
  const fittedAt = new Date().toISOString().slice(0, 10);
  console.log(`=== Fit rider valuation model v3 ${DRY_RUN ? "(DRY-RUN)" : "(APPLY)"} — ${fittedAt} ===`);

  const { anchors: anchorDefs } = JSON.parse(readFileSync(ANCHORS_PATH, "utf8"));

  const [riders, abilities] = await Promise.all([
    fetchAllRows(() => supabase.from("riders").select("id, firstname, lastname, primary_type").order("id")),
    fetchAllRows(() => supabase.from("rider_derived_abilities").select("*").order("rider_id")),
  ]);
  const abilityByRider = new Map(abilities.map((a) => [a.rider_id, a]));

  // Resolve anchors → { name, type, output (blendet), target }.
  const anchors = [];
  for (const def of anchorDefs) {
    const key = norm(def.name);
    const r = riders.find((x) => norm(`${x.firstname} ${x.lastname}`).includes(key));
    if (!r) { console.warn(`  ⚠ anchor ikke fundet: ${def.name}`); continue; }
    const ab = abilityByRider.get(r.id);
    if (!ab) { console.warn(`  ⚠ anchor uden abilities: ${def.name}`); continue; }
    anchors.push({
      name: `${r.firstname} ${r.lastname}`, type: r.primary_type,
      output: blendedOutput(ab, r.primary_type, ALPHA), target: def.target,
    });
  }
  if (anchors.length < 5) {
    console.error(`❌ For få anchors fundet (${anchors.length}). Afbryder.`);
    process.exit(1);
  }

  const fit = fitValuationModel(anchors, { quadratic: true });
  const predict = (an) => Math.exp(fit.predictLn(an));
  const { hard, soft } = checkAnchorOrdering(anchors, predict);

  // --- Rapport ---
  console.log(`\nAnchors: ${anchors.length}/${anchorDefs.length} · alpha=${ALPHA} · a=${fit.a.toFixed(3)} · b=${fit.b.toFixed(4)} · c=${fit.c.toExponential(3)} · R²(log)=${fit.r2.toFixed(3)}`);
  console.log("Type-offset (×-effekt vs neutral):");
  for (const [t, off] of Object.entries(fit.offset).sort((x, y) => y[1] - x[1])) {
    console.log(`  ${t.padEnd(16)} ${off >= 0 ? "+" : ""}${off.toFixed(2)}  (×${Math.exp(off).toFixed(2)})`);
  }
  console.log("\nAnchors (forudsagt vs mål):");
  for (const an of [...anchors].sort((x, y) => y.target - x.target)) {
    console.log(`  ${an.name.padEnd(22)} ${an.type.padEnd(15)} o${an.output.toFixed(1).padEnd(5)} ${fmtM(predict(an)).padEnd(9)} (mål ${fmtM(an.target)})`);
  }
  if (soft.length) {
    console.log(`\nBløde ordensbrud (<15M-bånd, ${soft.length} — rapporteres, blokerer ikke):`);
    for (const v of soft) console.log(`  ${v.high} (${fmtM(v.predHigh)}) ≤ ${v.low} (${fmtM(v.predLow)})`);
  }
  if (hard.length) {
    console.error(`\n❌ HÅRDE ordensbrud (mål ≥15M) — fittet afvises:`);
    for (const v of hard) console.error(`  ${v.high} (${fmtM(v.predHigh)}) ≤ ${v.low} (${fmtM(v.predLow)})`);
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log("\n(DRY-RUN) Skriver ikke model-fil.");
    return;
  }
  const model = {
    version: 3,
    method: "log-linear: ln(value)=a+b*O+c*O^2+offset[primary_type], O=alpha*speciale+(1-alpha)*snit (anchor-calibrated)",
    fitted_at: fittedAt,
    n_anchor: anchors.length,
    r2_log: Number(fit.r2.toFixed(4)),
    alpha: ALPHA,
    a: Number(fit.a.toFixed(6)),
    b: Number(fit.b.toFixed(6)),
    c: Number(fit.c.toExponential(6)),
    offset: Object.fromEntries(Object.entries(fit.offset).map(([t, v]) => [t, Number(v.toFixed(6))])),
    anchors_fit: [...anchors].sort((x, y) => y.target - x.target).map((an) => ({
      name: an.name, type: an.type, output: Number(an.output.toFixed(1)),
      target: an.target, predicted: Math.round(predict(an)),
    })),
    notes: "Eget data-drevet base_value, v3 (alsidigheds-blend + krumning, 9/6). SHADOW — styrer ikke økonomi før cutover (#1101 slice 2). INGEN bund. Fase 2: simulations-drevet (efter #1102). Fase 3: markeds-glidning.",
  };
  writeFileSync(MODEL_PATH, JSON.stringify(model, null, 2) + "\n");
  console.log(`\n✅ Skrev ${MODEL_PATH}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

Bemærk: `model.c` skrives som `toExponential` (lille tal ~1e-3) — `predictBaseValue` parser med `Number()`, som læser exponential-notation fint.

- [ ] **Step 2: Kør dry-run mod prod og verificér mod eksperimentet**

Kør: `node scripts/fitRiderValuationModel.js --dry-run`
Forventet: `R²(log)=0.942` (±0,01), Pogačar forudsagt ~142M (mål 125M) og OVER MvdP ~90M (mål 95M), 0 hårde brud, ~12 bløde brud, exit 0.

- [ ] **Step 3: Kør hele backend-testsuiten**

Kør (fra `backend/`): `node --test`
Forventet: PASS (1191 eksisterende + de nye fra Task 1-2; ingen regressioner — v2-JSON ligger stadig på disk og er bagudkompatibel).

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/fitRiderValuationModel.js
git commit -m "feat(valuation): #1101 fit-script v3 - blend, krumning og haard ordens-guard"
```

---

### Task 4: Apply fit → ny model-JSON

**Files:**
- Modify (genereret): `backend/lib/riderValuationModel.json`

- [ ] **Step 1: Kør fittet i apply-mode**

Kør: `node scripts/fitRiderValuationModel.js`
Forventet: samme rapport som dry-run + `✅ Skrev .../riderValuationModel.json`.

- [ ] **Step 2: Sanity-tjek den skrevne JSON**

Kør: `node -e "const m=require('./lib/riderValuationModel.json'); console.log(m.version, m.alpha, m.b>0, Number(m.c)>0, m.r2_log)"`
Forventet: `3 0.5 true true 0.94x`.

- [ ] **Step 3: Kør hele backend-testsuiten igen (nu med v3-JSON på disk)**

Kør: `node --test`
Forventet: PASS — beviser at forbrugere (progression-engine, sæson-dry-run m.fl.) tåler v3-JSON.

- [ ] **Step 4: Commit**

```bash
git add backend/lib/riderValuationModel.json backend/lib/riderValuationAnchors.json
git commit -m "feat(valuation): #1101 re-fit v3 mod haevede ejer-anchors (R2log ~0.94, Pogacar > MvdP)"
```

(`riderValuationAnchors.json` har de ejer-hævede top-8-mål fra tidligere i sessionen og committes sammen med modellen.)

---

### Task 5: Backfill shadow til prod + verifikation

**Files:** ingen kodeændringer — kører eksisterende scripts.

- [ ] **Step 1: Dry-run backfill**

Kør: `node scripts/backfillRiderBaseValue.js --dry-run`
Forventet: rapport over gammel→ny uden skrivning; ~8.99x ryttere værdisat; ingen fejl.

- [ ] **Step 2: Apply backfill (skriver KUN `riders.base_value` — shadow, ikke økonomi)**

Kør: `node scripts/backfillRiderBaseValue.js`
Forventet: `✅ Skrev base_value. Værdisat ~8990 · skrevet ~8990`.

- [ ] **Step 3: SQL-spotcheck i prod**

Kør mod Supabase (read-only):

```sql
select count(*) filter (where base_value is null or base_value = 0) as bad, count(*) as n
from riders where not coalesce(is_retired, false);

select firstname || ' ' || lastname as name, pcm_id is null as fiktiv, base_value
from riders where not coalesce(is_retired, false)
order by base_value desc limit 8;
```

Forventet: `bad = 0`; blandt VIRKELIGE ryttere (fiktiv=false) skal Pogačar stå over van der Poel.

- [ ] **Step 4: Befolknings-preview til ejeren**

Kør tmp-preview-scriptet (eksisterer fra tidligere i sessionen): `node scripts/tmp-preview-refit-1101.js`
Rapportér i chatten: percentiler, top 15, 5-15M-båndet — ejerens verify-grundlag for cutover-beslutningen.

---

### Task 6: Dokumentation, oprydning og close-out

**Files:**
- Modify: `docs/decisions/rider-valuation-model-v1.md`
- Delete: `backend/scripts/tmp-preview-refit-1101.js`, `backend/scripts/tmp-experiment-v3-fit.js`
- Modify: `docs/NOW.md`

- [ ] **Step 1: Tilføj v3-sektion + datadrevet roadmap til decision-doc**

Tilføj nederst i `docs/decisions/rider-valuation-model-v1.md`:

```markdown
## v3 (9/6-2026): alsidigheds-blend + krumning + ordens-guard

Ejer-finding: v2 satte MvdP (107M) over Pogačar (67M) trods anchors 95M/125M — speciale-
output er blind for alsidighed (Pogačars snit over ALLE evner: 84,6 vs MvdP 76,6).

**Formel:** `ln(v) = a + b·O + c·O² + offset[type]`, `O = 0,5·speciale + 0,5·snit(alle evner)`.
Empirisk (22 anchors): R²(log) 0,865 → 0,942; Pogačar > MvdP genoprettet; ordensbrud 26 → 12
(alle bløde, 2,5-13M-båndet = ægte anchor/ability-uenigheder).

**Ordens-guard (permanent):** fit-scriptet AFVISER (exit 1) ethvert fit hvor anchors med mål
≥15M og >30% målafstand bytter rækkefølge. Bløde brud rapporteres. Fit-kerne: `riderValuationFit.js`.

## Datadrevet roadmap (besluttet 9/6-2026)

1. **Fase 1 (nu, launch 20/6):** Perception-model v3; anchors = træningsdata; manuel re-fit
   med guard. Shadow indtil cutover (slice 2, ejer-gated).
2. **Fase 2 (efter egen race-motor #1102/#676):** Værdi = forventet sæsonproduktion — simulér
   sæsonkalenderen N gange, fit mod forventede point/præmier pr. rytter. Anchors degraderes
   til VALIDERING. Modellen funderes i spillets egen fysik i stedet for håndsatte mål.
3. **Fase 3 (live drift, #1101-scope):** Dynamisk glidning af base_value mod faktiske
   auktions-/handelspriser ved finalization (triviel v1: vægtet glid) + periodisk re-fit.
   Markedet bliver sandheden; fiktive outliers (Ward/Bergström) korrigeres af spillerne selv.
```

- [ ] **Step 2: Slet tmp-scripts**

```bash
git rm --cached backend/scripts/tmp-preview-refit-1101.js backend/scripts/tmp-experiment-v3-fit.js 2>$null
rm backend/scripts/tmp-preview-refit-1101.js backend/scripts/tmp-experiment-v3-fit.js
```

(De er untracked — slet bare filerne; `git rm --cached` er no-op-sikring.)

- [ ] **Step 3: Commit docs + push + PR**

```bash
git add docs/decisions/rider-valuation-model-v1.md docs/superpowers/plans/2026-06-09-rider-valuation-v3.md
git commit -m "docs(valuation): #1101 v3-beslutning + datadrevet 3-fase-roadmap"
git push -u origin feat/1101-valuation-v3
gh pr create --title "feat(valuation): #1101 model v3 - alsidigheds-blend, krumning, ordens-guard" --label "backend-only" --body "..."
```

PR-body skal indeholde: Refs #1101 · empirisk grundlag (R² 0,865→0,942, Pogačar>MvdP) · shadow-only (ingen patch note: beta-flade, ingen gameplay-effekt — samme rationale som slice 1) · cutover stadig ejer-gated.

- [ ] **Step 4: Issue-kommentar + NOW.md**

`gh issue comment 1101` med: v3 merged-status, nye anchors, fit-resultat, backfill-status, de 12 bløde uenigheder (ejer kan justere anchors eller abilities senere), fase 2+3-roadmap. Opdatér `docs/NOW.md`: Next action = ejer-verify af nye shadow-værdier (cutover-gate), Working agent = nulstil ved session-slut.

---

## Self-review (udført)

- **Spec-dækning:** blend ✓ (Task 1), krumning ✓ (Task 1), guard ✓ (Task 2+3), re-fit ✓ (Task 4), "live her og nu" = shadow-backfill ✓ (Task 5), "dynamisk på sigt efter best practice" = 3-fase-roadmap dokumenteret ✓ (Task 6). Cutover (slice 2) er BEVIDST udenfor — ejer-gated.
- **Placeholder-scan:** ingen TBD/TODO; al kode komplet.
- **Type-konsistens:** `blendedOutput(abilities, type, alpha)` ens i Task 1/3; `fitValuationModel(anchors, {quadratic})` og `checkAnchorOrdering(anchors, predict, opts)` ens i Task 2/3; model-JSON-felter `alpha`/`c` matcher `predictBaseValue`-læsningen.
