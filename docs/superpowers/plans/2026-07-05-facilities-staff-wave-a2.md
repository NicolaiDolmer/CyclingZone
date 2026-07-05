# Faciliteter + Staff (Slice A, bølge A2: harness-kalibrering) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Byg `facilityInvestmentScorecard` (anti-optimal-path-sweep + kommerciel-payback-gate + tid-som-valuta-prisvalidering) + inflations-scorecardet (Fase 2-restance, coherence-design §6), kalibrér alle START-KANDIDATER i `backend/lib/facilityConstants.js` empirisk, og dokumentér i en audit-rapport. Harness grøn = merge-gate for at flippe `FACILITIES_ENABLED` (selve flip'et er en separat ejer-beslutning — IKKE i denne bølge).

**Architecture:** Ren simulerings-model i `backend/scripts/lib/facilityInvestmentModel.js` (ingen I/O, node-testet) + tynd CLI-rapport `backend/scripts/facilityInvestmentScorecard.js` (report-pattern som `moneySupplyScorecard`: ingen `exit(1)`, HEADLINE-linjer med ✅/❌). Inflations-scorecardet (`backend/scripts/inflationScorecard.js`) genbruger den syntetiske fresh-lønbyrde-model, som først ekstraheres til `backend/scripts/lib/freshPopulationBurden.js` (delt med `moneySupplyScorecard`). Kalibrering sker via `--config`-overrides (samme mønster som `economyCalibrationOverrides`) — prod-konstanterne røres først når et gate-grønt sæt er fundet.

**Tech Stack:** Node.js ESM, `node --test` (backend-suiten opdager `backend/scripts/lib/*.test.js` automatisk — `npm test` = `node --test --import ./test-setup.js` fra `backend/`). 100% syntetisk — ingen DB-krav (live-linser er optionelle reference-only).

**Spec:** `docs/superpowers/specs/2026-07-05-economy-fase3-empire-design.md` §2.3 (anti-optimal-path), §2.4 (tid-som-valuta), §5 (gates). Coherence-design §6 (inflations-scorecard). A1-fundament: PR #2213 (merged), `backend/lib/facilityConstants.js` + `facilityEngine.js`.

**Mekaniske rammer (ikke-omsættelige):**
- Alt arbejde i dedikeret worktree (`scripts/new-worktree.ps1`), branch `feat/1441-facilities-staff-a2` — hoved-checkoutet er frit.
- INGEN migration i denne PR → normal PR-merge efter CI grøn (ingen ejer-merge-krav).
- Ingen patch note (intet player-facing — flag stadig false; skriv "hvorfor ikke" i PR-body).
- `FACILITIES_ENABLED` forbliver `false` — kalibreringen ændrer KUN tal-værdier i `facilityConstants.js`.
- Fresh-gate + Gini-gates må IKKE regressere (spec §5) — bevises i Task 7, ikke antages.
- `pwsh -File scripts/verify-local.ps1` før push (backend + frontend tests + build).

---

### Task 1: Worktree + branch

- [ ] **Step 1: Opret worktree**

```powershell
pwsh -File scripts/new-worktree.ps1 -Branch feat/1441-facilities-staff-a2
```

Hvis scriptet fejler/ikke findes i forventet form, fallback:

```bash
git worktree add C:/Dev/CyclingZone-worktrees/a2-harness -b feat/1441-facilities-staff-a2 origin/main
cd C:/Dev/CyclingZone-worktrees/a2-harness/backend && npm ci
```

- [ ] **Step 2: Verificér** — `git rev-parse --show-toplevel` peger på worktree-stien; `git branch --show-current` = `feat/1441-facilities-staff-a2`. `cd backend && npm test` er grøn baseline (2743/0 fra A1).

**Alle efterfølgende tasks eksekveres i worktree'et.** Verificér branch i selve commit-kæden på HVER commit (memory-regel): `git branch --show-current` som del af commit-kommandoen.

---

### Task 2: `facilityInvestmentModel.js` — ren simulerings-model (TDD)

**Files:**
- Create: `backend/scripts/lib/facilityInvestmentModel.js`
- Modify: `backend/lib/facilityEngine.js` (eksportér `staffUtilization` — én linje)
- Test: `backend/scripts/lib/facilityInvestmentModel.test.js`

Modellen er 100% ren (ingen I/O). Den tager et `constants`-bundle som parameter (default = prod-`facilityConstants`), så kalibrerings-sweeps kan variere tallene uden at røre prod-filen — samme princip som `economyCalibrationOverrides`.

- [ ] **Step 1: Eksportér `staffUtilization` fra `facilityEngine.js`** (co-SSOT-guard: modellen må ikke duplikere formlen)

I `backend/lib/facilityEngine.js`, ændr:

```js
// staffTier null = ingen ansat → 50% udnyttelse. Tier 1..5 → 0.6..1.0.
function staffUtilization(staffTier) {
```

til:

```js
// staffTier null = ingen ansat → 50% udnyttelse. Tier 1..5 → 0.6..1.0.
// Eksporteret så harness-modellen (facilityInvestmentModel) deler formlen (co-SSOT).
export function staffUtilization(staffTier) {
```

Kør `cd backend && npm test` — stadig grøn (ren tilføjelse af export).

- [ ] **Step 2: Skriv de fejlende tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { effectiveBonus } from "../../lib/facilityEngine.js";
import {
  DEFAULT_MODEL_CONSTANTS, DEFAULT_LEVERAGE, STRATEGIES,
  PRIZE_ESTIMATE_BY_DIVISION, computeBonus, strengthValuePerSeason,
  simulateStrategy, runAntiOptimalPath, computeCommercialPayback, computePriceInSeasons,
} from "./facilityInvestmentModel.js";

test("computeBonus matcher prod-effectiveBonus på prod-konstanterne (drift-guard)", () => {
  for (const [track, fac, staff] of [["training", 5, 5], ["training", 3, 1], ["commercial", 2, null], ["academy", 4, 2], ["scouting", 0, null]]) {
    assert.equal(computeBonus(DEFAULT_MODEL_CONSTANTS, track, fac, staff), effectiveBonus(track, fac, staff));
  }
});

test("strengthValuePerSeason: commercial i sponsor-kroner, training via leverage×præmie", () => {
  const c = DEFAULT_MODEL_CONSTANTS;
  // commercial tier 5 + staff 5 i D1: 0.05 × 1.0 × 600.000 = 30.000
  assert.equal(strengthValuePerSeason(c, DEFAULT_LEVERAGE, "commercial", 5, 5, 1), 0.05 * 600000);
  // training tier 5 + staff 5 i D1: 0.10 × 1.0 × leverage(3.0) × 160.000 = 48.000
  assert.equal(strengthValuePerSeason(c, DEFAULT_LEVERAGE, "training", 5, 5, 1), 0.10 * 3.0 * 160000);
  // academy tier 2 uden staff: slots-effekt 2 × util 0.5 × slotValue 5.000 = 5.000
  assert.equal(strengthValuePerSeason(c, DEFAULT_LEVERAGE, "academy", 2, null, 1), 2 * 0.5 * 5000);
  // intet bygget = 0
  assert.equal(strengthValuePerSeason(c, DEFAULT_LEVERAGE, "training", 0, null, 1), 0);
});

test("simulateStrategy: deterministisk, budget-begrænset, recurring-cap holdes", () => {
  const args = { priorities: STRATEGIES["training-first"], division: 2, seasons: 10 };
  const a = simulateStrategy(args);
  const b = simulateStrategy(args);
  assert.deepEqual(a, b); // ingen tilfældighed
  assert.ok(a.strength > 0);
  assert.ok(a.spent > 0);
  // recurring (upkeep+staff-løn) må aldrig overstige cap × sæson-budget
  assert.ok(a.recurring <= 0.5 * PRIZE_ESTIMATE_BY_DIVISION[2] + 1e-9);
});

test("simulateStrategy: D1-budget bygger mere end D3-budget over samme horisont", () => {
  const d1 = simulateStrategy({ priorities: STRATEGIES["balanced"], division: 1, seasons: 10 });
  const d3 = simulateStrategy({ priorities: STRATEGIES["balanced"], division: 3, seasons: 10 });
  assert.ok(d1.spent > d3.spent);
});

test("runAntiOptimalPath: returnerer alle strategier med competitive-markering mod max", () => {
  const r = runAntiOptimalPath({ division: 1, seasons: 10 });
  assert.equal(r.results.length, Object.keys(STRATEGIES).length);
  const max = Math.max(...r.results.map((x) => x.strength));
  for (const x of r.results) {
    assert.equal(x.competitive, x.strength >= 0.9 * max);
  }
  assert.equal(r.competitiveCount, r.results.filter((x) => x.competitive).length);
});

test("computeCommercialPayback: payback = pris/netto-marginal; Infinity ved netto ≤ 0", () => {
  // Syntetisk bundle hvor payback er trivielt at regne: tier 1 giver 10% af 100k sponsor = 10k/sæson,
  // 0 upkeep-delta, pris 30k → payback 3.0 sæsoner.
  const c = {
    ...DEFAULT_MODEL_CONSTANTS,
    price: { 1: 30000, 2: 60000, 3: 140000, 4: 300000, 5: 600000 },
    upkeep: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    effect: { ...DEFAULT_MODEL_CONSTANTS.effect, commercial: { 0: 0, 1: 0.10, 2: 0.10, 3: 0.10, 4: 0.10, 5: 0.10 } },
    sponsorBase: { 1: 100000, 2: 100000, 3: 100000 },
  };
  const r = computeCommercialPayback({ division: 1, constants: c });
  const tier1NoStaff = r.rows.find((x) => x.tier === 1 && x.staffMode === "none");
  // uden staff: util 0.5 → 5k/sæson → 30k/5k = 6.0
  assert.equal(tier1NoStaff.paybackSeasons, 6);
  const tier2NoStaff = r.rows.find((x) => x.tier === 2 && x.staffMode === "none");
  assert.equal(tier2NoStaff.paybackSeasons, Infinity); // marginal effekt-delta = 0
  assert.equal(typeof r.minPayback, "number");
});

test("computePriceInSeasons: kumulativ pris / divisions-præmie", () => {
  const r = computePriceInSeasons({ constants: DEFAULT_MODEL_CONSTANTS });
  // prod-startkandidater: tier 1 = 25.000; D3-præmie 25.000 → 1.0 sæson
  assert.equal(r.table.find((x) => x.tier === 1).seasons[3], 1.0);
  // tier 3 kumulativ = 25+60+140 = 225.000; D2 70.000 → ~3.21
  assert.ok(Math.abs(r.table.find((x) => x.tier === 3).seasons[2] - 225000 / 70000) < 1e-9);
  assert.ok(Array.isArray(r.gates));
  for (const g of r.gates) {
    assert.ok(["tier1_d3", "tier3cum_d2", "tier5cum_d1"].includes(g.key));
    assert.equal(typeof g.pass, "boolean");
  }
});
```

- [ ] **Step 3: Kør — verificér FAIL** — `cd backend && node --test scripts/lib/facilityInvestmentModel.test.js` → FAIL (modul findes ikke).

- [ ] **Step 4: Implementér modellen**

```js
// #1441 Fase 3 bølge A2 — facility-investerings-model (100% syntetisk, ingen I/O).
// Spec: 2026-07-05-economy-fase3-empire-design.md §2.3 (anti-optimal-path) + §2.4
// (tid-som-valuta) + §5 (gates). Alle funktioner tager et constants-bundle så
// kalibrerings-sweeps kan variere facility-tallene UDEN at røre prod-filen
// (backend/lib/facilityConstants.js) — samme princip som economyCalibrationOverrides.
import {
  FACILITY_TRACKS, MAX_FACILITY_TIER, FACILITY_TIER_PRICE, FACILITY_TIER_UPKEEP,
  STAFF_SALARY_BY_TIER, FACILITY_BASE_EFFECT, COMMERCIAL_MIN_PAYBACK_SEASONS,
} from "../../lib/facilityConstants.js";
import { staffUtilization } from "../../lib/facilityEngine.js";
import { SPONSOR_INCOME_BY_DIVISION } from "../../lib/economyConstants.js";

// ── ASSUMPTION: repræsentativ PRÆMIE-indkomst pr. division (ambitions-laget) ─────
// Samme proxy som moneySupplyScorecard.PRIZE_ESTIMATE_BY_DIVISION (ejer-reviewet for
// #1309): kompetent mid-table-hold. Facilitets-budgettet er OVERSKUDS-forbrug — driften
// (sponsor − løn − upkeep) er ~break-even by design, så det investérbare råderum ≈ præmien.
export const PRIZE_ESTIMATE_BY_DIVISION = Object.freeze({ 1: 160000, 2: 70000, 3: 25000 });

// ── Constants-bundle (default = prod-startkandidaterne) ──────────────────────────
export const DEFAULT_MODEL_CONSTANTS = Object.freeze({
  tracks: FACILITY_TRACKS,
  maxTier: MAX_FACILITY_TIER,
  price: FACILITY_TIER_PRICE,
  upkeep: FACILITY_TIER_UPKEEP,
  staffSalary: STAFF_SALARY_BY_TIER,
  effect: FACILITY_BASE_EFFECT,
  sponsorBase: SPONSOR_INCOME_BY_DIVISION,
  minPaybackSeasons: COMMERCIAL_MIN_PAYBACK_SEASONS,
});

// ── ASSUMPTION: leverage — hvor meget hvert spors bonus er "værd" (BLØDT input) ──
// Oversætter effekt-bonusser til en fælles CZ$-ækvivalent styrke-værdi pr. sæson, så
// spor kan sammenlignes i én proxy. Tallene er antagelser (effekt-hooks for scouting/
// medical/academy er ikke live endnu) — scorecardet udskriver sensitivitet ±50%, og
// anti-optimal-path-gaten skal holde over hele leverage-intervallet (robusthed).
//   training : bonus komposterer i rytterudvikling → resultater (høj leverage)
//   medical  : form-genopretning → flere point i tætte perioder (medium)
//   scouting : info-fordel → bedre køb/intake (lav-medium, indirekte)
//   academy  : værdi pr. ekstra slot pr. sæson, NETTO efter 5k slot-drift
//   commercial: direkte CZ$ (bonus × sponsor-base) — ingen leverage-antagelse
export const DEFAULT_LEVERAGE = Object.freeze({
  training: 3.0,
  medical: 1.5,
  scouting: 0.8,
  academySlotValue: 5000,
});

// Andel af sæson-budgettet der maksimalt må bindes i løbende facility-omkostninger
// (tier-upkeep + staff-løn). Guard mod at strategi-sim'en køber sig til insolvens.
export const RECURRING_CAP = 0.5;

// ── Investerings-strategier (rækkefølger) — spec §2.3 kræver ≥3 konkurrencedygtige ─
// null = "balanced": køb altid den billigste næste opgradering på tværs af spor.
export const STRATEGIES = Object.freeze({
  "training-first":   ["training", "academy", "medical", "scouting", "commercial"],
  "commercial-first": ["commercial", "training", "academy", "scouting", "medical"],
  "academy-first":    ["academy", "training", "scouting", "medical", "commercial"],
  "support-first":    ["medical", "scouting", "training", "academy", "commercial"],
  "balanced":         null,
});

// Delt bonus-formel med sweepbar effekt-tabel. staffUtilization importeres fra prod
// (facilityEngine) — drift-guard-testen sikrer paritet med effectiveBonus.
export function computeBonus(constants, track, facilityTier, staffTier) {
  const base = constants.effect[track]?.[facilityTier] ?? 0;
  return base * staffUtilization(staffTier);
}

export function strengthValuePerSeason(constants, leverage, track, facilityTier, staffTier, division) {
  const bonus = computeBonus(constants, track, facilityTier, staffTier);
  if (track === "commercial") return bonus * (constants.sponsorBase[division] || 0);
  if (track === "academy") return bonus * leverage.academySlotValue;
  return bonus * (leverage[track] ?? 1) * (PRIZE_ESTIMATE_BY_DIVISION[division] || 0);
}

function recurringCost(constants, tiers, staff) {
  let sum = 0;
  for (const t of constants.tracks) {
    sum += constants.upkeep[tiers[t]] || 0;
    if (staff[t] != null) sum += constants.staffSalary[staff[t]] || 0;
  }
  return sum;
}

// Vælg næste køb efter strategi: priorities = ordnet spor-liste (fyld ét spor ad
// gangen); null = balanced (billigste næste opgradering på tværs).
function nextPurchase(constants, priorities, tiers) {
  if (priorities) {
    for (const track of priorities) {
      if (tiers[track] < constants.maxTier) return { track, price: constants.price[tiers[track] + 1] };
    }
    return null;
  }
  let best = null;
  for (const track of constants.tracks) {
    if (tiers[track] >= constants.maxTier) continue;
    const price = constants.price[tiers[track] + 1];
    if (!best || price < best.price) best = { track, price };
  }
  return best;
}

// Simulér én strategi over N sæsoner. Budget = repræsentativ præmie-indkomst pr.
// division (overskuds-laget). Politik pr. sæson: (1) betal recurring, (2) køb næste
// opgradering i strategi-rækkefølgen mens der er råd, (3) opgradér staff (op til
// facilitets-tier) i prioritets-rækkefølge så længe recurring-cap'en holder,
// (4) akkumulér styrke-værdi. Deterministisk — ingen tilfældighed.
export function simulateStrategy({
  priorities, division, seasons = 10,
  constants = DEFAULT_MODEL_CONSTANTS, leverage = DEFAULT_LEVERAGE,
}) {
  const budget = PRIZE_ESTIMATE_BY_DIVISION[division] || 0;
  const tiers = Object.fromEntries(constants.tracks.map((t) => [t, 0]));
  const staff = Object.fromEntries(constants.tracks.map((t) => [t, null]));
  let cash = 0, spent = 0, strength = 0;

  for (let s = 1; s <= seasons; s++) {
    // Indkomst: budget + kommerciel bonus-indkomst (den ENESTE effekt der er penge).
    cash += budget + strengthValuePerSeason(constants, leverage, "commercial", tiers.commercial, staff.commercial, division);
    cash -= recurringCost(constants, tiers, staff);

    // Køb opgraderinger mens der er råd og recurring-cap'en holder EFTER købet.
    for (;;) {
      const buy = nextPurchase(constants, priorities, tiers);
      if (!buy || buy.price > cash) break;
      const after = { ...tiers, [buy.track]: tiers[buy.track] + 1 };
      if (recurringCost(constants, after, staff) > RECURRING_CAP * budget) break;
      tiers[buy.track] += 1;
      cash -= buy.price;
      spent += buy.price;
    }

    // Staff: hæv mod facilitets-tier i prioritets-rækkefølge under recurring-cap'en.
    for (const track of priorities || constants.tracks) {
      while ((staff[track] ?? 0) < tiers[track]) {
        const cand = { ...staff, [track]: (staff[track] ?? 0) + 1 };
        if (recurringCost(constants, tiers, cand) > RECURRING_CAP * budget) break;
        staff[track] = cand[track];
      }
    }

    for (const track of constants.tracks) {
      strength += strengthValuePerSeason(constants, leverage, track, tiers[track], staff[track], division);
    }
  }
  return {
    strength: Math.round(strength), spent,
    recurring: recurringCost(constants, tiers, staff),
    endTiers: tiers, endStaff: staff,
  };
}

// §2.3-gaten: ≥3 strategier inden for ±10% af bedste langsigtede styrke-proxy.
export function runAntiOptimalPath({ division, seasons = 10, constants = DEFAULT_MODEL_CONSTANTS, leverage = DEFAULT_LEVERAGE }) {
  const results = Object.entries(STRATEGIES).map(([name, priorities]) => ({
    name, ...simulateStrategy({ priorities, division, seasons, constants, leverage }),
  }));
  const max = Math.max(...results.map((r) => r.strength));
  for (const r of results) r.competitive = r.strength >= 0.9 * max;
  return { results, max, competitiveCount: results.filter((r) => r.competitive).length };
}

// §2.1-anti-runaway-gaten: kommerciel payback pr. tier (marginal) + fuldt udbygget
// (kumulativ), med og uden staff. Payback = pris / netto-marginal-indkomst pr. sæson;
// Infinity når netto ≤ 0 (aldrig selvfinansierende = gate-PASS per definition).
export function computeCommercialPayback({ division, constants = DEFAULT_MODEL_CONSTANTS }) {
  const sponsor = constants.sponsorBase[division] || 0;
  const rows = [];
  for (const staffMode of ["none", "matched"]) {
    for (let tier = 1; tier <= constants.maxTier; tier++) {
      const staffAt = (t) => (staffMode === "matched" ? (t >= 1 ? t : null) : null);
      const grossDelta = (computeBonus(constants, "commercial", tier, staffAt(tier))
        - computeBonus(constants, "commercial", tier - 1, staffAt(tier - 1))) * sponsor;
      const upkeepDelta = (constants.upkeep[tier] || 0) - (constants.upkeep[tier - 1] || 0);
      const salaryDelta = staffMode === "matched"
        ? (constants.staffSalary[tier] || 0) - (tier >= 2 ? constants.staffSalary[tier - 1] || 0 : 0)
        : 0;
      const netDelta = grossDelta - upkeepDelta - salaryDelta;
      rows.push({
        tier, staffMode, grossDelta, netDelta,
        paybackSeasons: netDelta > 0 ? constants.price[tier] / netDelta : Infinity,
      });
    }
    // Fuldt udbygget (kumulativ): total capex / netto-indkomst ved tier 5.
    const cumPrice = [1, 2, 3, 4, 5].reduce((s, t) => s + constants.price[t], 0);
    const netAtFull = computeBonus(constants, "commercial", 5, staffMode === "matched" ? 5 : null) * sponsor
      - (constants.upkeep[5] || 0)
      - (staffMode === "matched" ? constants.staffSalary[5] || 0 : 0);
    rows.push({
      tier: "full", staffMode, grossDelta: null, netDelta: netAtFull,
      paybackSeasons: netAtFull > 0 ? cumPrice / netAtFull : Infinity,
    });
  }
  const finite = rows.map((r) => r.paybackSeasons).filter((p) => Number.isFinite(p));
  const minPayback = finite.length ? Math.min(...finite) : Infinity;
  return { rows, minPayback, pass: minPayback >= constants.minPaybackSeasons };
}

// §2.4-gaten: tier-priser i "sæsoner af repræsentativ præmie-indkomst" pr. division.
// Bånd forankret i spec-målene (T1 ≈ 0,5 · T3 ≈ 1 · T5 ≈ 2+), med kalibrerings-rum:
//   tier1/D3 ∈ [0.25, 1.0] · tier3-kumulativ/D2 ∈ [0.5, 2.0] · tier5-kumulativ/D1 ∈ [2.0, 6.0]
// (øvre T5-grænse = opnåelighed: skal kunne nås af et vedholdende D1-hold).
export const TIME_AS_CURRENCY_BANDS = Object.freeze({
  tier1_d3: { lo: 0.25, hi: 1.0 },
  tier3cum_d2: { lo: 0.5, hi: 2.0 },
  tier5cum_d1: { lo: 2.0, hi: 6.0 },
});

export function computePriceInSeasons({ constants = DEFAULT_MODEL_CONSTANTS }) {
  let cum = 0;
  const table = [];
  for (let tier = 1; tier <= constants.maxTier; tier++) {
    cum += constants.price[tier];
    const seasons = {};
    for (const d of [1, 2, 3]) seasons[d] = cum / PRIZE_ESTIMATE_BY_DIVISION[d];
    table.push({ tier, price: constants.price[tier], cumPrice: cum, seasons });
  }
  const val = (tier, d) => table.find((x) => x.tier === tier).seasons[d];
  const gates = [
    { key: "tier1_d3", value: val(1, 3), ...TIME_AS_CURRENCY_BANDS.tier1_d3 },
    { key: "tier3cum_d2", value: val(3, 2), ...TIME_AS_CURRENCY_BANDS.tier3cum_d2 },
    { key: "tier5cum_d1", value: val(5, 1), ...TIME_AS_CURRENCY_BANDS.tier5cum_d1 },
  ].map((g) => ({ ...g, pass: g.value >= g.lo && g.value <= g.hi }));
  return { table, gates, allPass: gates.every((g) => g.pass) };
}
```

- [ ] **Step 5: Kør — verificér PASS** — `cd backend && node --test scripts/lib/facilityInvestmentModel.test.js` → alle PASS. Kør også `npm test` (fuld suite grøn — facilityEngine-exporten må intet breake).

- [ ] **Step 6: Commit**

```bash
git branch --show-current && git add backend/scripts/lib/facilityInvestmentModel.js backend/scripts/lib/facilityInvestmentModel.test.js backend/lib/facilityEngine.js && git commit -m "feat(economy): facility-investerings-model — strategi-sim, payback, tid-som-valuta (#1441 A2)"
```

---

### Task 3: `facilityInvestmentScorecard.js` — CLI-rapport

**Files:**
- Create: `backend/scripts/facilityInvestmentScorecard.js`

Report-pattern som `moneySupplyScorecard` (ingen `exit(1)`; HEADLINE-linjer). `--config=fil.json` overrider constants-bundlet (kalibrering uden at røre prod-filen); `--seasons=N`; `--markdown`.

- [ ] **Step 1: Skriv CLI'en**

```js
#!/usr/bin/env node
// #1441 Fase 3 bølge A2 — facility-investment-scorecard. MERGE-GATE for FACILITIES_ENABLED.
// Tre gates (spec §2.3 + §2.4 + §2.1/§5):
//   (1) Anti-optimal-path: ≥3 investerings-strategier inden for ±10% af bedste
//       langsigtede holdstyrke-proxy — pr. division, robust over leverage-sensitivitet.
//   (2) Kommerciel payback ≥ COMMERCIAL_MIN_PAYBACK_SEASONS (aldrig selvfinansierende
//       hurtigere) — mest gunstige kombination af tier/staff/division tæller.
//   (3) Tid-som-valuta: tier-priser i "sæsoner af repræsentativ præmie-indkomst" inden
//       for spec-forankrede bånd (T1≈0,5 D3 · T3≈1 D2 · T5≈2+ D1).
// 100% syntetisk — ingen DB, prod-konstanter UÆNDREDE af en kørsel.
//   node scripts/facilityInvestmentScorecard.js [--config=fil.json] [--seasons=10] [--markdown]
import { readFileSync } from "node:fs";
import {
  DEFAULT_MODEL_CONSTANTS, DEFAULT_LEVERAGE, STRATEGIES, PRIZE_ESTIMATE_BY_DIVISION,
  runAntiOptimalPath, computeCommercialPayback, computePriceInSeasons, RECURRING_CAP,
} from "./lib/facilityInvestmentModel.js";

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  if (process.argv.includes(`--${name}`)) return true;
  return def;
}
const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("da-DK"));
const fseas = (n) => (Number.isFinite(n) ? n.toFixed(1) : "∞");

// --config: delvis override af constants-bundlet (kun angivne nøgler erstattes).
function resolveConstants() {
  const cfgArg = arg("config", null);
  if (!cfgArg || cfgArg === true) return { constants: DEFAULT_MODEL_CONSTANTS, overridden: false };
  const cfg = JSON.parse(readFileSync(cfgArg, "utf8"));
  const merged = { ...DEFAULT_MODEL_CONSTANTS };
  for (const key of ["price", "upkeep", "staffSalary", "effect", "sponsorBase", "minPaybackSeasons"]) {
    if (cfg[key] != null) {
      merged[key] = key === "effect"
        ? { ...DEFAULT_MODEL_CONSTANTS.effect, ...cfg.effect }
        : (typeof cfg[key] === "object" ? { ...DEFAULT_MODEL_CONSTANTS[key], ...cfg[key] } : cfg[key]);
    }
  }
  return { constants: merged, overridden: true, file: cfgArg };
}

function main() {
  const seasons = parseInt(arg("seasons", "10"), 10);
  const markdown = !!arg("markdown", false);
  const { constants, overridden, file } = resolveConstants();

  console.log("=== #1441 FACILITY-INVESTMENT-SCORECARD (bølge A2 — merge-gate for FACILITIES_ENABLED) ===\n");
  if (overridden) console.log(`OVERRIDE AKTIV (--config=${file}) — prod-konstanter uændrede.\n`);
  console.log("Antagelser (eksplicitte — ejer sanity-tjekker):");
  console.log(`  • Investérbart budget    : repræsentativ præmie-indkomst D1 ${fmt(PRIZE_ESTIMATE_BY_DIVISION[1])} / D2 ${fmt(PRIZE_ESTIMATE_BY_DIVISION[2])} / D3 ${fmt(PRIZE_ESTIMATE_BY_DIVISION[3])} pr. sæson`);
  console.log(`                             (driften er ~break-even by design → overskuds-laget ≈ præmien; BLØDT input)`);
  console.log(`  • Leverage (BLØDT)       : training ${DEFAULT_LEVERAGE.training} · medical ${DEFAULT_LEVERAGE.medical} · scouting ${DEFAULT_LEVERAGE.scouting} · academy-slot ${fmt(DEFAULT_LEVERAGE.academySlotValue)}/sæson`);
  console.log(`  • Recurring-cap          : ${RECURRING_CAP} × budget (køb stopper før insolvens)`);
  console.log(`  • Horisont               : ${seasons} sæsoner\n`);

  // ── Gate 3: tid-som-valuta (§2.4) ──────────────────────────────────────────────
  const pis = computePriceInSeasons({ constants });
  console.log("── GATE: tid-som-valuta (§2.4) — kumulativ pris i sæsoners præmie-indkomst ──");
  console.log("  tier   pris        kumulativ    D1-sæsoner  D2-sæsoner  D3-sæsoner");
  for (const row of pis.table) {
    console.log(`  ${row.tier}      ${fmt(row.price).padStart(9)}  ${fmt(row.cumPrice).padStart(9)}    ${row.seasons[1].toFixed(1).padStart(6)}      ${row.seasons[2].toFixed(1).padStart(6)}      ${row.seasons[3].toFixed(1).padStart(6)}`);
  }
  for (const g of pis.gates) {
    console.log(`  Gate [${g.key}: ${g.value.toFixed(2)} ∈ [${g.lo}, ${g.hi}]]: ${g.pass ? "✅ PASS" : "❌ FAIL"}`);
  }
  console.log();

  // ── Gate 2: kommerciel payback (§2.1 anti-runaway) ────────────────────────────
  console.log("── GATE: kommerciel payback ≥ " + constants.minPaybackSeasons + " sæsoner (aldrig selvfinansierende hurtigere) ──");
  let minPaybackAll = Infinity;
  for (const d of [1, 2, 3]) {
    const r = computeCommercialPayback({ division: d, constants });
    minPaybackAll = Math.min(minPaybackAll, r.minPayback);
    const worst = r.rows.reduce((a, b) => (b.paybackSeasons < a.paybackSeasons ? b : a));
    console.log(`  D${d}: hurtigste payback ${fseas(r.minPayback)} sæsoner (tier ${worst.tier}, staff=${worst.staffMode})`);
    if (markdown) {
      for (const row of r.rows) {
        console.log(`      tier ${String(row.tier).padEnd(4)} staff=${row.staffMode.padEnd(7)} netto ${fmt(row.netDelta)}/sæson → payback ${fseas(row.paybackSeasons)}`);
      }
    }
  }
  const paybackPass = minPaybackAll >= constants.minPaybackSeasons;
  console.log(`  Gate [min payback ${fseas(minPaybackAll)} ≥ ${constants.minPaybackSeasons}]: ${paybackPass ? "✅ PASS" : "❌ FAIL — kommerciel er en pengemaskine, rekalibrér"}\n`);

  // ── Gate 1: anti-optimal-path (§2.3) — pr. division + leverage-robusthed ──────
  console.log("── GATE: anti-optimal-path (§2.3) — ≥3 strategier inden for ±10% af bedste ──");
  const leverageScenarios = [
    { name: "leverage ×1,0 (baseline)", mult: 1.0 },
    { name: "leverage ×0,5", mult: 0.5 },
    { name: "leverage ×1,5", mult: 1.5 },
  ];
  let antiOptimalPass = true;
  const baselineByDiv = {};
  for (const sc of leverageScenarios) {
    const leverage = {
      training: DEFAULT_LEVERAGE.training * sc.mult,
      medical: DEFAULT_LEVERAGE.medical * sc.mult,
      scouting: DEFAULT_LEVERAGE.scouting * sc.mult,
      academySlotValue: DEFAULT_LEVERAGE.academySlotValue * sc.mult,
    };
    const isBaseline = sc.mult === 1.0;
    if (isBaseline) console.log(`  [${sc.name}]`);
    for (const d of [1, 2, 3]) {
      const r = runAntiOptimalPath({ division: d, seasons, constants, leverage });
      if (isBaseline) {
        baselineByDiv[d] = r;
        const parts = r.results
          .sort((a, b) => b.strength - a.strength)
          .map((x) => `${x.name} ${fmt(x.strength)}${x.competitive ? "✓" : ""}`);
        console.log(`    D${d}: ${parts.join(" · ")}`);
        console.log(`    D${d} konkurrencedygtige: ${r.competitiveCount}/${r.results.length} ${r.competitiveCount >= 3 ? "✅" : "❌"}`);
      }
      if (r.competitiveCount < 3) antiOptimalPass = false;
    }
    if (!isBaseline) {
      const counts = [1, 2, 3].map((d) => runAntiOptimalPath({ division: d, seasons, constants, leverage }).competitiveCount);
      console.log(`  [${sc.name}] konkurrencedygtige pr. division: D1=${counts[0]} D2=${counts[1]} D3=${counts[2]} ${counts.every((c) => c >= 3) ? "✅" : "❌"}`);
    }
  }
  console.log(`  Gate [≥3 konkurrencedygtige i ALLE divisioner × ALLE leverage-scenarier]: ${antiOptimalPass ? "✅ PASS" : "❌ FAIL — én rækkefølge dominerer, rekalibrér effekter/priser"}\n`);

  if (markdown) {
    console.log("### Anti-optimal-path (baseline-leverage, markdown)\n");
    console.log("| Division | " + Object.keys(STRATEGIES).join(" | ") + " | konkurrencedygtige |");
    console.log("|---|" + Object.keys(STRATEGIES).map(() => "---|").join("") + "---|");
    for (const d of [1, 2, 3]) {
      const r = baselineByDiv[d];
      const cells = Object.keys(STRATEGIES).map((name) => {
        const x = r.results.find((y) => y.name === name);
        return `${fmt(x.strength)}${x.competitive ? " ✓" : ""}`;
      });
      console.log(`| D${d} | ${cells.join(" | ")} | ${r.competitiveCount}/${r.results.length} |`);
    }
    console.log();
  }

  const allPass = pis.allPass && paybackPass && antiOptimalPass;
  console.log("──────────────────────────────────────────────────────────────────────");
  console.log(`HEADLINE: facility-gates ${allPass ? "✅ PASS — A2-merge-gate opfyldt" : "❌ FAIL — rekalibrér før FACILITIES_ENABLED"}`);
  console.log(`  tid-som-valuta ${pis.allPass ? "✅" : "❌"} · kommerciel payback ${paybackPass ? "✅" : "❌"} · anti-optimal-path ${antiOptimalPass ? "✅" : "❌"}`);
  console.log("NOTE: flag-flip er en separat EJER-beslutning — harness grøn er forudsætningen, ikke beslutningen.\n");
}

main();
```

- [ ] **Step 2: Kør mod startkandidaterne** — `cd backend && node scripts/facilityInvestmentScorecard.js`. Forventet: kører uden fejl; gates viser reelt billede (tid-som-valuta forventes ❌ på startkandidaterne — T3-kumulativ ≈ 3,2 sæsoners D2-præmie mod bånd [0,5, 2,0], T5 ≈ 7,0 mod [2, 6]). Det er OK — kalibreringen er Task 6.

- [ ] **Step 3: Commit**

```bash
git branch --show-current && git add backend/scripts/facilityInvestmentScorecard.js && git commit -m "feat(economy): facilityInvestmentScorecard — anti-optimal-path + payback + tid-som-valuta-gates (#1441 A2)"
```

---

### Task 4: Ekstrahér `freshPopulationBurden` (delt lib, ren refactor)

**Files:**
- Create: `backend/scripts/lib/freshPopulationBurden.js`
- Modify: `backend/scripts/moneySupplyScorecard.js`

`computeFreshSalaryBurden()` skal genbruges af inflations-scorecardet, men `moneySupplyScorecard.js` kører `main()` ved import → ekstrahér til delt lib. REN refactor — outputtet skal være bit-identisk.

- [ ] **Step 1: Gem baseline-output** — `cd backend && node scripts/moneySupplyScorecard.js --synthetic-only > /tmp/msc-before.txt` (Git Bash; på PowerShell: `> $env:TEMP\msc-before.txt`).

- [ ] **Step 2: Opret `backend/scripts/lib/freshPopulationBurden.js`** — flyt funktionen UÆNDRET (inkl. dens kommentarblok "── (A) SYNTETISK fresh-population-net ──" og assumption-kommentaren om roster-størrelse + `RELAUNCH_TEAM_COUNT = 22`):

```js
// Delt fresh-population-lønbyrde-model (ekstraheret fra moneySupplyScorecard i #1441 A2
// så inflationScorecard kan genbruge den — funktionen er UÆNDRET, flyttet 1:1).
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateLaunchPopulation } from "../../lib/fictionalLaunchPopulation.js";
import { deriveAbilities, VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";
import { computeRiderTypes } from "../../lib/riderTypes.js";
import { predictBaseValue } from "../../lib/riderValuation.js";
import { allocateStarterSquads, STARTER_SQUAD } from "../../lib/starterSquadAllocator.js";
import { computeFrozenSalary } from "../../lib/contractSeed.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REFERENCE_YEAR = 2026;
export const RELAUNCH_TEAM_COUNT = 22; // relaunch-rehearsal 2026-06-11: 22 beta-manager-hold (#1191).

const median = (arr) => {
  const a = [...arr].sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : 0;
};

export function computeFreshSalaryBurden() {
  // ... (flyt kroppen 1:1 fra moneySupplyScorecard.js linje 133-176 — bemærk at
  //  riderValuationModel.json/riderTypesBaseline.json-stierne nu er "../../lib/..."
  //  fordi filen ligger ét niveau dybere)
}
```

I `moneySupplyScorecard.js`: slet den lokale funktion + `RELAUNCH_TEAM_COUNT`-konstanten og importér i stedet: `import { computeFreshSalaryBurden } from "./lib/freshPopulationBurden.js";`. De imports der KUN blev brugt af funktionen (generateLaunchPopulation, deriveAbilities, VISIBLE_ABILITIES, computeRiderTypes, predictBaseValue, allocateStarterSquads, computeFrozenSalary) fjernes fra moneySupplyScorecard — men STARTER_SQUAD og readFileSync bruges muligvis andre steder: tjek med grep før sletning, behold det der stadig bruges. NB: `printSyntheticSection` bruger `fresh.teamCount` — behold feltet i return-objektet.

- [ ] **Step 3: Verificér bit-identisk** — `node scripts/moneySupplyScorecard.js --synthetic-only > /tmp/msc-after.txt && diff /tmp/msc-before.txt /tmp/msc-after.txt` → ingen diff. Kør `npm test` → grøn.

- [ ] **Step 4: Commit**

```bash
git branch --show-current && git add backend/scripts/lib/freshPopulationBurden.js backend/scripts/moneySupplyScorecard.js && git commit -m "refactor(economy): ekstrahér freshPopulationBurden til delt scripts-lib (bit-identisk output)"
```

---

### Task 5: `inflationScorecard.js` — pengemængde vs. mål-kurve (Fase 2-restance)

**Files:**
- Create: `backend/scripts/inflationScorecard.js`

Coherence-design §6: "Inflations-scorecard (pengemængde vs mål-kurve)". Syntetisk primær-linse (mål-kurve = §2.1-båndet 0,8–1,3× start over 5 sæsoner) + facility-scenario (beviser at sinket virker uden at vælte feltet) + optionel live-reference (`--live`, aggregeret `finance_transactions` pr. type — read-only, springes over uden env).

- [ ] **Step 1: Skriv CLI'en**

```js
#!/usr/bin/env node
// #1441 Fase 3 bølge A2 — inflations-scorecard (Fase 2-restancen fra coherence-design §6).
// Spørgsmål: vokser den aggregerede pengemængde M(s) forbi mål-kurven?
//   Mål-kurve: M(s)/M(0) ∈ [0,8, 1,3] for alle s ≤ 5 (§2.1-konsistent: økonomien er
//   designet ~flad — D1 break-even, D2/D3 lille buffer).
// Linser:
//   (A) SYNTETISK baseline (PRIMÆR gate) — fresh-population-nettoen (samme model som
//       moneySupplyScorecard (A)) aggregeret over divisions-fordelingen af hold.
//   (B) SYNTETISK + faciliteter — hvert hold følger "balanced"-strategien fra
//       facilityInvestmentModel → beviser at facility-sinket ABSORBERER overskud
//       (M_fac < M_base) uden at vælte feltet (M_fac(5)/M(0) ≥ 0,5).
//   (C) LIVE (--live, reference only) — aggregeret finance_transactions pr. type.
// Report-pattern (ingen exit(1)).
//   node scripts/inflationScorecard.js [--seasons=5] [--live] [--markdown]
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { INITIAL_BALANCE, SPONSOR_INCOME_BY_DIVISION, UPKEEP_BY_DIVISION } from "../lib/economyConstants.js";
import { computeFreshSalaryBurden, RELAUNCH_TEAM_COUNT } from "./lib/freshPopulationBurden.js";
import { renownSponsorFor, resolveOverrides } from "./lib/economyCalibrationOverrides.js";
import {
  DEFAULT_MODEL_CONSTANTS, DEFAULT_LEVERAGE, STRATEGIES, PRIZE_ESTIMATE_BY_DIVISION,
  simulateStrategy,
} from "./lib/facilityInvestmentModel.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("da-DK"));

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  if (process.argv.includes(`--${name}`)) return true;
  return def;
}

// ── ASSUMPTION: divisions-fordeling af de 22 relaunch-hold ───────────────────────
// Pool-træet er 1/2/4/8-pyramide, men 22 beta-hold fylder ikke alle puljer; 8/8/6 er
// den repræsentative fordeling fra relaunch-rehearsal (D1-pulje fuld, D2 to puljer,
// resten i D3). BLØDT input — kun vægtningen af per-division-nets, ikke nets selv.
const TEAMS_BY_DIVISION = { 1: 8, 2: 8, 3: 6 };

// Mål-kurve (§2.1): pengemængden skal holde sig i [0,8, 1,3] × start over horisonten.
const TARGET_BAND = { lo: 0.8, hi: 1.3 };

function main() {
  const seasons = parseInt(arg("seasons", "5"), 10);
  const live = !!arg("live", false);
  const markdown = !!arg("markdown", false);

  const overrides = resolveOverrides();
  const fresh = computeFreshSalaryBurden();
  const salary = fresh.burdenMedian;
  const teamsTotal = Object.values(TEAMS_BY_DIVISION).reduce((a, b) => a + b, 0);

  console.log("=== INFLATIONS-SCORECARD — pengemængde vs. mål-kurve (coherence §6, Fase 2-restance) ===\n");
  console.log("Antagelser (eksplicitte — ejer sanity-tjekker):");
  console.log(`  • Hold-fordeling         : D1=${TEAMS_BY_DIVISION[1]} / D2=${TEAMS_BY_DIVISION[2]} / D3=${TEAMS_BY_DIVISION[3]} (${teamsTotal} hold, relaunch-rehearsal-split)`);
  console.log(`  • Lønbyrde (division-blind): ${fmt(salary)}/hold (samme fresh-model som moneySupplyScorecard)`);
  console.log(`  • Præmie-estimat (BLØDT) : D1 ${fmt(PRIZE_ESTIMATE_BY_DIVISION[1])} / D2 ${fmt(PRIZE_ESTIMATE_BY_DIVISION[2])} / D3 ${fmt(PRIZE_ESTIMATE_BY_DIVISION[3])}`);
  console.log(`  • Mål-kurve              : M(s)/M(0) ∈ [${TARGET_BAND.lo}, ${TARGET_BAND.hi}] for s ≤ ${seasons}\n`);

  // Per-division fresh-net (renown fresh = base per konstruktion).
  const netByDiv = {};
  for (const d of [1, 2, 3]) {
    const sponsor = renownSponsorFor({
      divisionBase: overrides.sponsorBase[d] ?? SPONSOR_INCOME_BY_DIVISION[d],
      standing: null, divisionStandings: [],
      wResults: overrides.wResults, maxMultiplier: overrides.maxMultiplier,
    });
    netByDiv[d] = sponsor + PRIZE_ESTIMATE_BY_DIVISION[d] - salary - (overrides.upkeep[d] ?? UPKEEP_BY_DIVISION[d]);
  }

  // ── (A) Baseline: M(s) = M(0) + s × Σ_d hold[d] × net[d] ────────────────────────
  const M0 = teamsTotal * INITIAL_BALANCE;
  const totalNetPerSeason = [1, 2, 3].reduce((s, d) => s + TEAMS_BY_DIVISION[d] * netByDiv[d], 0);

  // ── (B) Faciliteter: per-division facility-cashflow fra "balanced"-strategien ────
  // simulateStrategy returnerer slut-tilstand; til KURVEN behøver vi per-sæson-forbrug,
  // så vi kører sim'en for hver horisont s = 1..seasons og differentierer (spent +
  // recurring er kumulative/øjebliksværdier). Facility-sinket pr. hold pr. sæson s =
  // (spent(s) − spent(s−1)) + recurring(s). Kommerciel bonus-indkomst er en FAUCET og
  // skal tælles med: + commercialIncome(s) (aflæses som strengthValue for commercial —
  // brug simulateStrategy-output pr. horisont).
  const facilityFlowByDiv = {};
  for (const d of [1, 2, 3]) {
    const flows = [];
    let prevSpent = 0;
    for (let s = 1; s <= seasons; s++) {
      const r = simulateStrategy({ priorities: STRATEGIES["balanced"], division: d, seasons: s });
      const capex = r.spent - prevSpent;
      prevSpent = r.spent;
      // recurring ved horisont s (øjebliksværdi) + kommerciel indkomst ved slut-tilstand
      const commercialIncome = (DEFAULT_MODEL_CONSTANTS.effect.commercial[r.endTiers.commercial] ?? 0)
        * (r.endStaff.commercial != null ? 0.5 + 0.1 * r.endStaff.commercial : 0.5)
        * (DEFAULT_MODEL_CONSTANTS.sponsorBase[d] || 0);
      flows.push({ capex, recurring: r.recurring, commercialIncome });
    }
    facilityFlowByDiv[d] = flows;
  }

  console.log("Per-division fresh-net/sæson (baseline):");
  for (const d of [1, 2, 3]) console.log(`  D${d}: net ${fmt(netByDiv[d])} × ${TEAMS_BY_DIVISION[d]} hold`);
  console.log();

  console.log("Pengemængde-kurve (M(0) = " + fmt(M0) + "):");
  console.log("  sæson   M_baseline      ratio    M_faciliteter   ratio    facility-sink/sæson");
  let mBase = M0, mFac = M0;
  let basePass = true, facFloorPass = true;
  const curve = [];
  for (let s = 1; s <= seasons; s++) {
    mBase += totalNetPerSeason;
    let facSink = 0;
    for (const d of [1, 2, 3]) {
      const f = facilityFlowByDiv[d][s - 1];
      facSink += TEAMS_BY_DIVISION[d] * (f.capex + f.recurring - f.commercialIncome);
    }
    mFac = mFac + totalNetPerSeason - facSink;
    const rBase = mBase / M0, rFac = mFac / M0;
    if (rBase < TARGET_BAND.lo || rBase > TARGET_BAND.hi) basePass = false;
    if (rFac < 0.5) facFloorPass = false;
    curve.push({ s, mBase, rBase, mFac, rFac, facSink });
    console.log(`  ${s}       ${fmt(mBase).padStart(12)}  ${rBase.toFixed(2)}×   ${fmt(mFac).padStart(12)}  ${rFac.toFixed(2)}×   ${fmt(facSink)}`);
  }
  const sinkWorks = curve[curve.length - 1].mFac < curve[curve.length - 1].mBase;
  console.log();
  console.log(`  Gate [baseline i mål-kurve [${TARGET_BAND.lo}, ${TARGET_BAND.hi}]× alle sæsoner]: ${basePass ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`  Gate [facility-sinket absorberer overskud: M_fac(${seasons}) < M_base(${seasons})]: ${sinkWorks ? "✅ PASS" : "❌ FAIL — sinket bider ikke"}`);
  console.log(`  Gate [faciliteter vælter ikke feltet: M_fac/M(0) ≥ 0,5 alle sæsoner]: ${facFloorPass ? "✅ PASS" : "❌ FAIL — sinket er for voldsomt"}`);

  if (markdown) {
    console.log("\n### Pengemængde-kurve (markdown)\n");
    console.log("| sæson | M_baseline | ratio | M_faciliteter | ratio | facility-sink |");
    console.log("|---|---|---|---|---|---|");
    for (const r of curve) console.log(`| ${r.s} | ${fmt(r.mBase)} | ${r.rBase.toFixed(2)}× | ${fmt(r.mFac)} | ${r.rFac.toFixed(2)}× | ${fmt(r.facSink)} |`);
  }

  const allPass = basePass && sinkWorks && facFloorPass;
  console.log(`\nHEADLINE: inflations-gate ${allPass ? "✅ PASS" : "❌ FAIL"} (syntetisk primær; §2.1-mål-kurve).`);
  console.log("NOTE: 100% syntetisk. Live-linsen (--live) er reference only.\n");

  if (live) printLiveSection();
}

// ── (C) LIVE-reference (aggregeret finance_transactions pr. type) ─────────────────
async function printLiveSection() {
  dotenv.config({ path: path.resolve(SCRIPT_DIR, "../../.codex.local/supabase-readonly.env"), quiet: true });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_READONLY_KEY) {
    console.log("=== (C) LIVE-reference — SPRUNGET OVER (mangler readonly-env) ===\n");
    return;
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_READONLY_KEY);
  // Aggregér pr. type med paginering (fetchAll-mønster fra moneySupplyScorecard).
  const pageSize = 1000;
  const byType = new Map();
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from("finance_transactions").select("type, amount").range(from, from + pageSize - 1);
    if (error) throw new Error(`finance_transactions: ${error.message}`);
    for (const r of data || []) byType.set(r.type, (byType.get(r.type) || 0) + (r.amount || 0));
    if (!data || data.length < pageSize) break;
  }
  console.log("=== (C) LIVE-reference — aggregeret flow pr. type (REFERENCE ONLY) ===");
  for (const [type, sum] of [...byType.entries()].sort((a, b) => a[1] - b[1])) {
    console.log(`  ${type.padEnd(24)} ${fmt(sum).padStart(14)}`);
  }
  console.log();
}

main();
```

- [ ] **Step 2: Kør** — `cd backend && node scripts/inflationScorecard.js`. Forventet: baseline-gate ✅ (fresh-nets er små positive → kurven holder sig i bånd); facility-scenario viser sink > 0 og M_fac < M_base. Hvis facility-gate fejler på STARTKANDIDATERNE er det data til Task 6 — notér tallene, fortsæt.

- [ ] **Step 3: Commit**

```bash
git branch --show-current && git add backend/scripts/inflationScorecard.js && git commit -m "feat(economy): inflations-scorecard — pengemængde vs. mål-kurve + facility-sink-scenario (#1441 A2, coherence §6)"
```

---

### Task 6: Empirisk kalibrering af `facilityConstants` + audit-rapport

**Files:**
- Modify: `backend/lib/facilityConstants.js` (KUN tal-værdier)
- Modify: `backend/lib/facilityEngine.test.js` + evt. `facilityService.test.js`/`economyEngine.test.js` (testene bruger konkrete priser/lønninger — opdatér forventningerne til de kalibrerede tal)
- Create: `docs/audits/2026-07-05-facility-investment-calibration.md`

**Kalibrerings-procedure (empirisk loop — kør, aflæs, justér via `--config`, gentag):**

- [ ] **Step 1: Baseline-kørsel** — kør `node scripts/facilityInvestmentScorecard.js --markdown` + `node scripts/inflationScorecard.js --markdown` på startkandidaterne; gem outputs (de går i rapporten som "før").

- [ ] **Step 2: Iterér via config-filer** (i `backend/scripts/calibration/` eller scratchpad — config-filer committes IKKE). Justerings-prioritet og håndtag:
  1. **Tid-som-valuta ❌** → sænk `price` for mellem-/top-tiers. Startpunkt-kandidat der rammer alle tre bånd: `{1: 15000, 2: 35000, 3: 80000, 4: 180000, 5: 400000}` (T1/D3 = 0,6 · T3-kum/D2 = 1,86 · T5-kum/D1 = 4,4). Regn båndene efter FØR kørsel.
  2. **Kommerciel payback ❌** (payback < 4 ved billigere priser) → sænk `effect.commercial` eller hæv `upkeep`-kurven for de tiers der bryder. Husk: Infinity-payback er PASS (aldrig selvfinansierende er OK per spec — kommerciel er et bevidst loftet sink, ikke en pengemaskine).
  3. **Anti-optimal-path ❌** (én strategi dominerer) → justér `effect`-relationerne (den dominerende tracks effekt ned ELLER de svage tracks op) og/eller leverage-antagelserne HVIS de er urimelige (dokumentér ændringen eksplicit i rapporten — leverage er antagelser, ikke prod-konstanter). Gaten skal holde i alle 3 divisioner × alle 3 leverage-scenarier.
  4. **Inflations-gates ❌** → justér `upkeep`/`staffSalary` (recurring-siden af sinket).
- [ ] **Step 3: Konvergens-kriterium** — ét konstant-sæt hvor BEGGE scorecards viser HEADLINE ✅ samtidig. Max ~10 iterationer; kan gates ikke mødes samtidig → STOP og eskalér til hovedsessionen med de bedste 2 kandidater + trade-off (ejer-beslutning, ikke autonom slækning af bånd).
- [ ] **Step 4: Skriv de kalibrerede værdier ind i `backend/lib/facilityConstants.js`** — kun tal; opdatér kommentaren "ALLE tal er START-KANDIDATER" til "Kalibreret i bølge A2 (se docs/audits/2026-07-05-facility-investment-calibration.md); FACILITIES_ENABLED flippes stadig kun med ejer-go". Kør begge scorecards UDEN `--config` → begge HEADLINE ✅ (beviset for at prod-filen nu selv er grøn).
- [ ] **Step 5: Opdatér tests der hardkoder de gamle tal** — `cd backend && npm test`; ret forventede priser/lønninger i `facilityEngine.test.js` (og `facilityService.test.js`/`economyEngine.test.js` hvis de bruger konkrete beløb). Testene skal afspejle de NYE kalibrerede konstanter — ændr forventningerne, ikke logikken.
- [ ] **Step 6: Skriv audit-rapporten** `docs/audits/2026-07-05-facility-investment-calibration.md`:

```markdown
# Facility-kalibrering bølge A2 (#1441 Fase 3) — harness-bevis

> 2026-07-05 · merge-gate for FACILITIES_ENABLED (flip = separat ejer-beslutning).
> Harness: `backend/scripts/facilityInvestmentScorecard.js` + `backend/scripts/inflationScorecard.js`.
> Spec: `docs/superpowers/specs/2026-07-05-economy-fase3-empire-design.md` §2.3/§2.4/§5.

## Resultat (efter kalibrering)
[HEADLINE-linjer fra begge scorecards — indsæt faktisk output]

## Konstanter: før (A1-startkandidater) → efter (kalibreret)
| Konstant | Før | Efter | Hvorfor |
[én række pr. ændret konstant, med gate-henvisning]

## Gate-detaljer
### Tid-som-valuta (§2.4)  [tabel fra --markdown]
### Kommerciel payback (§2.1)  [tal + mest gunstige kombination]
### Anti-optimal-path (§2.3)  [strategi-tabel pr. division + leverage-robusthed]
### Inflations-kurve (coherence §6)  [kurve-tabel baseline + faciliteter]

## Antagelser + følsomhed
[leverage-tabel, budget=præmie-antagelsen, recurring-cap, TEAMS_BY_DIVISION — og hvad ±50% leverage gør ved gaten]

## Non-regression (Task 7-output indsættes her)
[moneySupplyScorecard --synthetic-only HEADLINE + prizeDistributionScorecard Gini-tal + npm test-resultat]

## Anbefaling
Harness grøn → A2-merge-gaten er opfyldt. FACILITIES_ENABLED-flip afventer ejer-go (+A3-UI).
```

- [ ] **Step 7: Commit**

```bash
git branch --show-current && git add backend/lib/facilityConstants.js backend/lib/facilityEngine.test.js docs/audits/2026-07-05-facility-investment-calibration.md && git commit -m "feat(economy): kalibrér facility-konstanter empirisk — alle A2-gates grønne (#1441)"
```

(tilføj evt. andre opdaterede test-filer til `git add`)

---

### Task 7: Non-regression — fresh-gate + Gini-gates + fuld suite

- [ ] **Step 1: Fresh-gate** — `cd backend && node scripts/moneySupplyScorecard.js --synthetic-only` → HEADLINE "✅ PASS". (Facility-konstanterne indgår ikke i denne model — kørslen er BEVISET, ikke en formalitet.)
- [ ] **Step 2: Gini-gate** — `node scripts/prizeDistributionScorecard.js` (default seed) → notér per-division Gini; sammenlign mod senest dokumenterede baseline (renown-kalibreringen, W_RESULTS=0.45/MAX_MULTIPLIER=1.40) — uændret forventet (scriptet importerer ikke facilityConstants; verificér med `grep -rn "facilityConstants" backend/scripts/prizeDistributionScorecard.js scripts/moneySupplyScorecard.js` → 0 hits udenfor de nye A2-filer).
- [ ] **Step 3: Fuld verifikation** — `pwsh -File scripts/verify-local.ps1` (fra worktree-roden) → backend + frontend tests + build grønne.
- [ ] **Step 4: Indsæt outputs i rapportens "Non-regression"-sektion** + commit:

```bash
git branch --show-current && git add docs/audits/2026-07-05-facility-investment-calibration.md && git commit -m "docs(economy): non-regressions-bevis i A2-kalibreringsrapporten (#1441)"
```

---

### Task 8: PR + close-out

- [ ] **Step 1: Push + PR** — `git push -u origin feat/1441-facilities-staff-a2`; opret PR efter `PULL_REQUEST_TEMPLATE` (inkl. Brugerverifikation-sektion). PR-body: link spec + rapport; eksplicit "Ingen patch note: intet player-facing — FACILITIES_ENABLED stadig false, UI kommer i A3"; eksplicit "Ingen migration i denne PR". INGEN `database/*.sql` → normal merge efter CI grøn.
- [ ] **Step 2: Efter merge** — kommentar på #1441: A2-status (gates grønne, link til rapport), næste = A3 (Klub-UI) + ejer-beslutning om flag-flip. Flip IKKE `claude:todo`→`claude:done` (epic'en fortsætter med A3).
- [ ] **Step 3: NOW.md** (i hoved-checkoutet, main) — opdatér Økonomi Fase 3-blokken: A2 merged, næste A3; nulstil 🤖 Working agent. Budget ≤ ~1.200 tokens.
- [ ] **Step 4: Token-hygiejne** — `pwsh -File scripts/check-agent-token-hygiene.ps1` → exit 0.
- [ ] **Step 5: Worktree-oprydning** — `git worktree remove <worktree-sti>` efter merge.

---

## Self-review-noter

- **Spec-dækning:** §2.3 anti-optimal-path → Task 2/3 (gate 1, inkl. leverage-robusthed); §2.4 tid-som-valuta → Task 2/3 (gate 3, spec-forankrede bånd) + kalibrering Task 6; §2.1 kommerciel payback ≥ 4 → gate 2; §5 inflations-scorecard (coherence §6) → Task 5; §5 fresh/Gini-non-regression → Task 7; "hver ny konstant har harness-bevis før merge" → Task 6-rapporten.
- **Bevidst udeladt:** lønpres-projektionen (§5) er Slice B-gate, ikke A2. `economyCalibrationOverrides` udvides IKKE — facility-sweeps kører via scorecardets egen `--config` (facility-konstanterne deler ingen flader med prize/sponsor-scorecards, så delt override-mekanisme er YAGNI).
- **Kendt kalibrerings-spænding (forventet, ikke en fejl):** startkandidat-priserne fejler tid-som-valuta-båndene (T3-kum 3,2 vs. [0,5-2,0]; T5-kum 7,0 vs. [2-6]) — Task 6 sænker priserne; det gør payback KORTERE, så payback-gaten skal re-tjekkes i samme loop. Kan båndene ikke mødes samtidig → eskalér (Step 3-stopregel), slæk ikke bånd autonomt.
- **Type-konsistens:** `simulateStrategy` returnerer `{strength, spent, recurring, endTiers, endStaff}` — bruges konsistent i Task 3 (scorecard) og Task 5 (inflations-scenario). `computePriceInSeasons` returnerer `{table, gates, allPass}` — matcher test + CLI. `computeCommercialPayback` returnerer `{rows, minPayback, pass}`.
