# Scouting-fane (Fase 1 af talentspejder-systemet) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Erstat "coming soon"-placeholderen i rytterprofilens Scouting-fane med den rigtige fane: server-beregnet scouting-rapport (verdict + per-ryttertype loft-bånd + værdi-sammenligning) + rest-bånd-model (ingen når 100% præcision, heller ikke på egne ryttere).

**Architecture:** Ren lib (`backend/lib/scoutingReport.js`) bygget oven på eksisterende `backend/lib/scouting.js` + `riderValuation.js`; ét nyt endpoint `GET /api/riders/:id/scouting-report`; frontend `RiderScoutingTab.jsx` wired ind hvor placeholderen sidder i `RiderStatsPage.jsx`. Alle potentiale-afledte tal forlader serveren som BÅND, aldrig eksakt (#1162-gaten udvides).

**Tech Stack:** Node/Express + Supabase (service_role), `node --test`, React + Tailwind `cz-*`, i18next (EN først, DA under).

**Spec:** `docs/superpowers/specs/2026-07-07-talentspejder-design.md` (beslutning 3+4 implementeres her; spejder-entiteten (beslutning 1,2,5,6) er Fase 3 og er IKKE i denne plan — båndbredder parametriseres så spejder-rating kan kobles på senere).

**Branch:** `feat/1543-scouting-tab-fase1` (PR mod main; INGEN database-migration i denne fase).

---

## Design-kerne (læs før Task 1)

**Rest-bånd-modellen (beslutning 3+4).** I dag: level 3 og egne ryttere → eksakt (`lo == hi`). Nyt:
- `SCOUT_DISPLAY_CONFIG` udvides med `residualHalfWidth: 0.5` (stjerner) og `residualBiasFactor: 0.25`.
- Ved `level >= maxLevel` OG for egne ryttere: halvbredde = `residualHalfWidth`, bias = seeded uniform i `±residualBiasFactor` (persistent pr. (rytter, hold)) — så båndets MIDTPUNKT ikke er sandheden (anti-inversion).
- `exact` fjernes aldrig fra payload-formen (bagudkomp.), men bliver altid `false` — undtagen ryttere med `potentiale == null` (stadig `null`).
- `{ hidden: true }` for uscoutede ikke-egne er UÆNDRET.

**Rapporten (nyt endpoint).** `GET /api/riders/:id/scouting-report` returnerer for viewer med scout-level ≥ 1 ELLER egen rytter:
```
{
  level, maxLevel, own,
  stars: { lo, hi },                      // samme bånd som /scouting/estimates
  types: [{ key, now, ceilLo, ceilHi }],  // 8 typer; now = rating fra synlige evner,
                                          // ceil* = BÅNDET typeRating fra ability_caps
  verdict: { headlineKey, confidence, factorKeys: [..4] },
  value: { market, expectedLo, expectedHi } | null
}
```
For level 0 ikke-egen: `{ hidden: true, level: 0 }`. Rå `potentiale`/`ability_caps` forlader ALDRIG serveren.

**Loft-bånd pr. type:** genbrug backend-værdimodellens blendede output på `ability_caps` (samme formel som frontend `riderTypeRating`, men server-side — importér fra `backend/lib/riderValuation.js`, dupliker IKKE formlen). Bånd i rating-punkter: halvbredde `[12, 8, 5, 3]` for level `[0(egen u. scouting findes ikke), 1, 2, 3/egen]` + seeded center-bias (samme seed-familie). Kvantiseres til heltal, clamp [1,99], og `ceilLo >= now` (loft kan ikke være under nuværende).

**Verdict (v1, deterministisk — ingen AI):** beregnes af ren funktion fra båndede tal + alder + kontraktstatus:
- headlineKey ∈ `keep_and_develop | bid_worth_considering | solid_contributor | past_peak | monitor` (regler i Task 3-koden).
- confidence ∈ `low | medium | high` fra båndbredde (level/own).
- factorKeys: 4 udvalgte fra et fast katalog (age_upside, ceiling_gap, near_ceiling, type_match, decline_risk, value_gap, contract_short) — regler i koden.

**Inverterbarhed:** `potentialeHiding.routes.test.js` udvides (whitelist 3→4 potentiale-selects) + nyt empirisk harness-script der forsøger at rekonstruere sandheden fra alle bånd-outputs på tværs af levels og fejler hvis medianfejlen < 0,25 stjerner.

---

### Task 1: Rest-bånd i `backend/lib/scouting.js` (TDD)

**Files:**
- Modify: `backend/lib/scouting.js`
- Test: `backend/lib/scouting.test.js` (udvid)

- [ ] **Step 1: Skriv fejlende tests** — tilføj i `scouting.test.js`:

```js
test("level 3 giver rest-bånd, aldrig eksakt (#1543 beslutning 3)", () => {
  const e = estimatePotentialRange(4.0, 3, 22, "r1", "t1");
  assert.equal(e.exact, false);
  assert.ok(e.hi - e.lo >= 0.5 && e.hi - e.lo <= 1.5, `rest-bånd forventet, fik ${e.lo}–${e.hi}`);
});

test("egne ryttere får smalt bånd, ikke eksakt (#1543 beslutning 4)", () => {
  const rider = { id: "r1", potentiale: 4.0, birthdate: "2004-01-01", team_id: "t1" };
  const e = buildScoutEstimate(rider, 0, "t1");
  assert.equal(e.exact, false);
  assert.ok(e.hi > e.lo, "egen rytter skal have et bånd");
});

test("rest-båndets midtpunkt er IKKE altid sandheden (anti-inversion)", () => {
  let offCenter = 0;
  for (let i = 0; i < 50; i++) {
    const e = estimatePotentialRange(3.5, 3, 22, `r${i}`, "t1");
    if ((e.lo + e.hi) / 2 !== 3.5) offCenter++;
  }
  assert.ok(offCenter > 10, `bias-spredning for lav: ${offCenter}/50`);
});
```

- [ ] **Step 2: Kør og se dem fejle:** `cd backend && node --test lib/scouting.test.js` — forventet FAIL (exact=true i dag).
- [ ] **Step 3: Implementér** i `scouting.js`: tilføj `residualHalfWidth: 0.5, residualBiasFactor: 0.25` til `SCOUT_DISPLAY_CONFIG`; erstat eksakt-branchen i `estimatePotentialRange`:

```js
  if (level >= maxLevel) {
    const half = SCOUT_DISPLAY_CONFIG.residualHalfWidth;
    const bias = (seededUnit(`scout-residual:${riderId}:${teamId}`) * 2 - 1)
      * SCOUT_DISPLAY_CONFIG.residualBiasFactor;
    const center = clamp(truth + bias, 1, 6);
    return {
      lo: clamp(roundHalf(center - half), 1, 6),
      hi: clamp(roundHalf(center + half), 1, 6),
      exact: false,
      scoutLevel: level,
    };
  }
```
(Bemærk separat seed-nøgle `scout-residual:` — rest-biasen må ikke være lineært koblet til level-biasen, ellers kan sandheden løses fra to levels.) `buildScoutEstimate` er uændret bortset fra at egen-rytter-branchen nu naturligt giver bånd via `effectiveLevel = maxLevel`.

- [ ] **Step 4: Kør tests:** `node --test lib/scouting.test.js` — alle PASS. Justér evt. eksisterende tests der forventede `exact: true` (bevidst adfærdsændring — opdatér forventningen + kommentér med `#1543 beslutning 3+4`).
- [ ] **Step 5: Commit:** `git add backend/lib/scouting.js backend/lib/scouting.test.js && git commit -m "feat(scouting): rest-baand - ingen naar 100% praecision, heller ikke egne ryttere (#1543)"`

### Task 2: Ryd op i afledte forventninger (eksakt-antagelser)

**Files:**
- Modify: `frontend/src/components/rider/ScoutablePotentiale.jsx` (eksakt-branch bliver død kode — behold som defensive fallback, opdatér kommentar)
- Check: `grep -rn "exact" frontend/src backend --include=*.js --include=*.jsx | grep -i scout`

- [ ] **Step 1:** Gennemgå alle forbrugere af `estimate.exact` / `lo === hi` (kendte: `ScoutablePotentiale.jsx`, `potentialLabelKey` i `frontend/src/lib/scouting.js`, `PotentialeStars.jsx` range-visning, academy-flows). Eksakt-branchen skal ikke fjernes (server kan stadig sende `lo===hi` efter clamping ved truth nær 1 eller 6), men kommentarer/labels der siger "egne = eksakt" opdateres.
- [ ] **Step 2:** Kør frontend-tests: `cd frontend && node --test` — PASS.
- [ ] **Step 3: Commit:** `git commit -am "chore(scouting): opdater eksakt-antagelser efter rest-baand (#1543)"`

### Task 3: `backend/lib/scoutingReport.js` — ren rapport-lib (TDD)

**Files:**
- Create: `backend/lib/scoutingReport.js`
- Create: `backend/lib/scoutingReport.test.js`

- [ ] **Step 1: Skriv fejlende tests** (`scoutingReport.test.js`):

```js
import test from "node:test";
import assert from "node:assert/strict";
import { buildTypeCeilingBands, buildVerdict, CEIL_HALF_WIDTH_BY_LEVEL } from "./scoutingReport.js";

const CAPS = { climbing: 80, time_trial: 60, flat: 55, tempo: 70, sprint: 40, acceleration: 45, punch: 65, endurance: 72, recovery: 68, durability: 66, descending: 58, cobblestone: 35, aggression: 50 };
const NOW  = Object.fromEntries(Object.entries(CAPS).map(([k, v]) => [k, v - 15]));

test("loft-bånd: 8 typer, heltal, clamp [1,99], ceilLo >= now", () => {
  const bands = buildTypeCeilingBands({ nowAbilities: NOW, caps: CAPS, level: 1, riderId: "r1", teamId: "t1", primaryType: "climber" });
  assert.equal(bands.length, 8);
  for (const b of bands) {
    assert.ok(Number.isInteger(b.now) && Number.isInteger(b.ceilLo) && Number.isInteger(b.ceilHi));
    assert.ok(b.ceilLo >= b.now, `${b.key}: ceilLo ${b.ceilLo} < now ${b.now}`);
    assert.ok(b.ceilHi >= b.ceilLo && b.ceilHi <= 99 && b.ceilLo >= 1);
  }
});

test("loft-bånd indsnævres med level, men lukker aldrig helt", () => {
  const w = (level) => {
    const b = buildTypeCeilingBands({ nowAbilities: NOW, caps: CAPS, level, riderId: "r1", teamId: "t1", primaryType: "climber" });
    return b[0].ceilHi - b[0].ceilLo;
  };
  assert.ok(w(1) >= w(2) && w(2) >= w(3));
  assert.ok(w(3) >= 2, "selv fuldt scoutet har et bånd");
});

test("verdict: ungt talent med stort loft-gap → keep_and_develop/bid, high confidence ved level 3", () => {
  const v = buildVerdict({ age: 19, own: true, level: 3, maxLevel: 3, bestNow: 55, bestCeilMid: 80, valueGap: 0 });
  assert.equal(v.headlineKey, "keep_and_develop");
  assert.equal(v.confidence, "high");
  assert.equal(v.factorKeys.length, 4);
});

test("verdict: gammel rytter forbi peak → past_peak", () => {
  const v = buildVerdict({ age: 33, own: false, level: 1, maxLevel: 3, bestNow: 70, bestCeilMid: 71, valueGap: 0 });
  assert.equal(v.headlineKey, "past_peak");
  assert.equal(v.confidence, "low");
});
```

- [ ] **Step 2:** `node --test lib/scoutingReport.test.js` — FAIL (modul findes ikke).
- [ ] **Step 3: Implementér** `scoutingReport.js` (ren JS, ingen DB/Math.random):

```js
// Scouting-rapport (#1543 Fase 1) — RENE funktioner. Loft-bånd pr. ryttertype
// beregnes fra ability_caps via værdimodellens blendede output (riderValuation)
// og maskeres som BÅND før de forlader serveren (#1162). Verdict er deterministisk
// (ingen AI) og bygget af i18n-nøgler så copy lever i locales (EN/DA).
import { blendedOutput } from "./riderValuation.js";
import { RIDER_TYPE_KEYS } from "./riderTypes.js";
import { seededUnit } from "./scouting.js";

// Halvbredde i rating-punkter pr. scout-level (index = level; egen rytter = maxLevel).
// Parametriseret så Fase 3 kan gøre den spejder-rating-afhængig.
export const CEIL_HALF_WIDTH_BY_LEVEL = Object.freeze([12, 8, 5, 3]);
export const CEIL_BIAS_FACTOR = 0.5; // andel af halvbredden center kan ligge skævt

const clampInt = (n, lo, hi) => Math.round(Math.max(lo, Math.min(hi, n)));

export function buildTypeCeilingBands({ nowAbilities, caps, level, riderId, teamId, primaryType }) {
  const half = CEIL_HALF_WIDTH_BY_LEVEL[Math.min(level, CEIL_HALF_WIDTH_BY_LEVEL.length - 1)];
  return RIDER_TYPE_KEYS.map((key) => {
    const now = clampInt(ratingFromAbilities(nowAbilities, key), 1, 99);
    const ceilTruth = ratingFromAbilities(caps, key);
    const bias = (seededUnit(`scout-ceil:${riderId}:${teamId}:${key}`) * 2 - 1) * half * CEIL_BIAS_FACTOR;
    const center = ceilTruth + bias;
    const ceilLo = clampInt(Math.max(center - half, now), 1, 99);
    const ceilHi = clampInt(Math.max(center + half, now), 1, 99);
    return { key, now, ceilLo, ceilHi };
  });
}
```
`ratingFromAbilities` = tynd wrapper om `blendedOutput` + de faste ankre — **verificér de præcise eksport-navne i `backend/lib/riderValuation.js` og `backend/lib/riderTypes.js` FØR implementering** (frontend-pendanten er `riderTypeRating` i `frontend/src/lib/riderRating.js` med ankre `RATING_O_MIN=2.04`, `RATING_O_ELITE=67.38`, `alpha=0.5` — backend skal bruge SAMME tal fra sin egen SSOT, ikke hardcode på ny). Findes ingen genbrugelig backend-eksport, eksportér den fra `riderValuation.js` i stedet for at duplikere.

`buildVerdict({ age, own, level, maxLevel, bestNow, bestCeilMid, valueGap })`:
```js
export function buildVerdict({ age, own, level, maxLevel, bestNow, bestCeilMid, valueGap }) {
  const gap = bestCeilMid - bestNow;
  const headlineKey =
    age >= 31 && gap < 4 ? "past_peak"
    : gap >= 12 && age <= 23 ? (own ? "keep_and_develop" : "bid_worth_considering")
    : gap >= 6 ? "monitor"
    : "solid_contributor";
  const confidence = own || level >= maxLevel ? "high" : level >= 2 ? "medium" : "low";
  const pool = [];
  if (age <= 23) pool.push("age_upside");
  if (gap >= 12) pool.push("ceiling_gap");
  if (gap < 4) pool.push("near_ceiling");
  if (age >= 31) pool.push("decline_risk");
  if (valueGap > 0) pool.push("value_gap");
  pool.push("type_match", "form_unknown", "watch_races");
  return { headlineKey, confidence, factorKeys: pool.slice(0, 4) };
}
```

- [ ] **Step 4:** `node --test lib/scoutingReport.test.js` — PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat(scouting): rapport-lib med type-loft-baand + deterministisk verdict (#1543)"`

### Task 4: Endpoint `GET /api/riders/:id/scouting-report`

**Files:**
- Modify: `backend/routes/api.js` (registrér i scouting-sektionen ~linje 1248, EFTER `/scouting/:riderId`)
- Modify: `backend/lib/potentialeHiding.routes.test.js` (whitelist 3→4)

- [ ] **Step 1: Udvid guard-testen FØRST** — i `potentialeHiding.routes.test.js` ændres forventningen til 4 potentiale-selects med kommentar: `// 4. GET /riders/:id/scouting-report — rapport-beregning (#1543), maskeres som bånd`. Tilføj ny test:

```js
test("scouting-report returnerer aldrig raa potentiale eller ability_caps (#1543)", () => {
  const idx = apiSource.indexOf('"/riders/:id/scouting-report"');
  assert.ok(idx !== -1, "scouting-report-routen skal findes");
  const block = apiSource.slice(idx, idx + 3500);
  assert.doesNotMatch(block, /res\.json\([^)]*\b(potentiale|ability_caps)\b/, "raa felter maa ikke i payload");
  assert.match(block, /buildTypeCeilingBands\(/, "skal bruge bånd-beregningen");
});
```
Kør: `node --test lib/potentialeHiding.routes.test.js` — FAIL (route findes ikke).

- [ ] **Step 2: Implementér routen** i `api.js`:

```js
// GET /api/riders/:id/scouting-report — fuld scouting-rapport (#1543 Fase 1).
// Viewer-maskeret: bånd, aldrig rå potentiale/ability_caps. Level 0 + ikke-egen
// → { hidden: true } (samme kontrakt som /scouting/estimates).
router.get("/riders/:id/scouting-report", requireAuth, async (req, res) => {
  if (!req.team) return res.status(400).json({ error: "No team found" });
  try {
    const [{ state }, { data: rider, error }] = await Promise.all([
      loadScoutState(req.team.id),
      supabase.from("riders").select("id, team_id, potentiale, birthdate, primary_type, market_value").eq("id", req.params.id).maybeSingle(),
    ]);
    if (error) throw new Error(error.message);
    if (!rider) return res.status(404).json({ error: "Rider not found" });
    const own = rider.team_id != null && rider.team_id === req.team.id;
    const level = own ? state.maxLevel : (state.levels[rider.id] ?? 0);
    if (!own && level <= 0) return res.json({ hidden: true, level: 0, maxLevel: state.maxLevel });

    const { data: ab, error: abErr } = await supabase
      .from("rider_derived_abilities").select("*").eq("rider_id", rider.id).maybeSingle();
    if (abErr) throw new Error(abErr.message);
    // ... byg nowAbilities (synlige evne-kolonner) + caps (ab.ability_caps),
    // bands = buildTypeCeilingBands(...), stars = buildScoutEstimate(...),
    // verdict = buildVerdict(...) — se scoutingReport.js.
    res.json({ level, maxLevel: state.maxLevel, own, stars, types: bands, verdict, value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```
Detaljer der SKAL med: `nowAbilities` = de synlige evne-felter fra `ab` (samme keys som `RIDER_TYPE_KEYS`-formlerne bruger); `caps = ab?.ability_caps` — hvis `null` (data-gap), fald tilbage til `{ hidden:false, types: [] }` + `capsMissing: true` frem for at kaste; `value` = `{ market: rider.market_value, expectedLo/Hi }` fra værdimodellen HVIS der findes en genbrugelig eksport i `riderValuation.js` — ellers `value: null` i v1 og Røverkøb-kortet viser kun markedsværdi (skriv beslutningen i PR-body). `bestNow/bestCeilMid` til verdict = maks over `types`.

- [ ] **Step 3:** `node --test lib/potentialeHiding.routes.test.js lib/scouting.test.js` — PASS. Manuel røgtest mod lokal backend hvis kørende; ellers dækkes af Step 4-harnesset.
- [ ] **Step 4: Commit:** `git commit -am "feat(api): GET /riders/:id/scouting-report - baandet rapport (#1543)"`

### Task 5: Anti-inversions-harness (gate #1162)

**Files:**
- Create: `backend/scripts/scoutingInversionHarness.js`
- Test: kør som script (ingen DB — ren simulering)

- [ ] **Step 1: Skriv harnesset:** simulér 2.000 syntetiske ryttere (potentiale uniform 1–6, alder 17–35), og lad en "angriber" der KENDER formlerne forsøge at rekonstruere sandheden fra ALT hvad serveren udleverer på tværs af level 1→3 (stjerne-bånd + type-loft-bånd). Angriber-strategi: least-squares over de kendte lineære relationer. Print scorecard: median |fejl|, p10-fejl, andel med fejl < 0,25.

```js
// Gate (#1162 + #1543): rekonstruktionsfejlen skal forblive ≥ 0,25 stjerner for
// medianen — ellers er rest-båndet reelt inverterbart og designet skal justeres.
if (medianError < 0.25) { console.error("FAIL: inverterbar"); process.exit(1); }
console.log("PASS", { medianError, p10Error, fracBelow025 });
```

- [ ] **Step 2:** Kør: `node scripts/scoutingInversionHarness.js` — forventet PASS. Hvis FAIL: justér `residualBiasFactor` op (0.25 → 0.35) og/eller afkobl level-bias-seedet yderligere; kør igen. Dokumentér den endelige konfiguration i script-headeren.
- [ ] **Step 3: Commit:** `git commit -am "test(scouting): anti-inversions-harness for rest-baand + loft-baand (#1543/#1162)"`

### Task 6: Frontend `RiderScoutingTab.jsx`

**Files:**
- Create: `frontend/src/components/rider/profile/RiderScoutingTab.jsx`
- Modify: `frontend/src/pages/RiderStatsPage.jsx:1642-1660` (erstat placeholder)
- Modify: `frontend/src/locales/en/rider.json` + `frontend/src/locales/da/rider.json` (nye nøgler under `profile.scouting.*`)

- [ ] **Step 1: Byg komponenten** efter design-SSOT (`docs/design/design_handoff_rider_profile/` — Scouting-fanen; pixel-reference `Rider-Profile-standalone.html`, screenshot `05-own-light.png`):
  - **Scout verdict-kort:** "Din spejders vurdering" (egen) / "Talentspejder-rapport" (andres); headline fra `verdict.headlineKey` (i18n), confidence-chip, 4 factor-linjer (i18n-nøgler). Ingen jargon.
  - **Potentiale pr. ryttertype:** alle 8 typer — nuværende værdi, bar (current fill + skraveret loft-bånd `ceilLo→ceilHi`), fuzzy loft-stjerner (stjerne-båndet fra `stars`). "Scout igen"-knap (genbrug `useScouting().scout`) på andres ryttere.
  - **Røverkøb?-kort:** markedsværdi vs `value.expectedLo–Hi` bar + one-line read; INGEN "Underpris"-verdict-label. Skjul kortet hvis `value == null`.
  - **Tilstande:** `hidden` → "Ikke scoutet"-kort + Scout-knap (genbrug mønstret fra `ScoutablePotentiale`); `capsMissing` → kun verdict+stjerner.
  - Data: nyt fetch af `GET /api/riders/:id/scouting-report` i tabben (samme auth-mønster som `useScouting`), refetch efter `scout()` succes.
  - Æstetik: eksisterende `cz-*`-tokens, `font-display` (Bebas) til overskrifter, ingen AI-slop. Match placeholderens kort-ramme-stil.
- [ ] **Step 2: Wire ind:** erstat placeholder-blokken `{tab === "scouting" && (...)}` i `RiderStatsPage.jsx` med `<RiderScoutingTab rider={rider} scouting={scouting} />` (scouting-hooket findes allerede på siden til hero'en). Tilføj `logEvent("feature_rider_scouting_tab_opened", { rider_id: rider.id })` i tab-switch (samme mønster som de andre faner). Fjern de forældede `profile.scouting.coming*`-nøgler KUN hvis de ikke bruges andre steder (`grep -rn "scouting.coming" frontend/src`).
- [ ] **Step 3: i18n:** EN først, DA under — alle nye nøgler i BEGGE locales (CI's i18n-key-gate fejler ellers). Verdict-copy: kort, klart sprog, ingen em-dashes, ingen opfundne fakta.
- [ ] **Step 4: Verificér:** `cd frontend && node --test && npm run lint && npm run build` — alle PASS (lint er CI-only-gaten der bed i #2044).
- [ ] **Step 5: Commit:** `git commit -am "feat(riders): scouting-fane - verdict + type-loft-baand + roeverkoeb (#1543)"`

### Task 7: Patch notes + Hjælp/FAQ + visuel verifikation

**Files:**
- Modify: `frontend/src/pages/PatchNotesPage.jsx` (brugerrettet: ny fane + egne ryttere viser nu bånd)
- Modify: `frontend/src/locales/*/help.json` (scouting-afsnit: hvad ses hvornår, rest-bånd-princippet)

- [ ] **Step 1:** Patch notes-entry (EN+DA): "Scouting tab on rider profiles" + "Potential is now always a range — nobody knows a rider's exact ceiling, not even for your own riders."
- [ ] **Step 2:** help.json (en+da): opdatér scouting-afsnittet med de nye regler.
- [ ] **Step 3: Playwright:** `npx playwright test core-smoke.spec.js` (ALLE 3 projekter — intet `--project`-flag). Visuelle ændringer → kør alle 3.
- [ ] **Step 4: Preview til ejer:** kør preview-serveren og tag RIGTIGE screenshots af fanen (egen + andres rytter) til PR-body — Playwright-mock-screenshots tæller ikke som ejer-bevis.
- [ ] **Step 5: Commit:** `git commit -am "docs(patch-notes): scouting-fane + rest-baand (#1543)"`

### Task 8: Fuld verifikation + PR

- [ ] **Step 1:** `pwsh -File scripts/verify-local.ps1` (backend-tests + frontend-tests + build) — PASS.
- [ ] **Step 2:** `node backend/scripts/scoutingInversionHarness.js` — PASS; vedhæft scorecard-output i PR.
- [ ] **Step 3:** Push + opret PR mod main med PULL_REQUEST_TEMPLATE (inkl. Brugerverifikation-sektion). Body: beslutnings-referat (spec-link), harness-scorecard, screenshots, note om `value: null`-fallback hvis relevant. `Refs #1543 #1138 #1162 #2000`.
- [ ] **Step 4:** Balance-gate: rest-bånd + loft-bånd-bredder er balance-følsomme → **ejer-review før merge** (ingen auto-merge). Ingen migration i PR'en, så ejer-merge-reglen for SQL er ikke i spil, men ejer skal se båndene på preview.

## Self-review (udført ved plan-skrivning)

- Spec-dækning Fase 1: per-ryttertype-estimat ✔ (Task 3+4), verdict ✔ (Task 3), RiderScoutingTab ✔ (Task 6), beslutning 3+4 rest-bånd ✔ (Task 1), inverterbarheds-gate ✔ (Task 5 + guard-test i Task 4), patch notes/help ✔ (Task 7). Fase 2–4 bevidst udenfor.
- Kendt usikkerhed flagget i Task 3/4: præcise eksport-navne i `riderValuation.js`/`riderTypes.js` skal verificeres før kodning; `value`-beregningen kan blive `null`-fallback i v1.
- Balance-tal (halvbredder, bias-faktorer) er startværdier — harnesset + ejer-review på preview er den rigtige gate, ikke planen.
