# #1101 Slice 2: Værdi-cutover (uci_points → base_value) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip spillets økonomi fra uci_points-afledte GENERATED-kolonner til `base_value` (v3, ejer-verificeret i shadow), afkobl alle duplikerede runtime-formler, fjern `uci_points` fra player-facing UI, og lever et cutover-audit der beviser konsistens.

**Architecture:** Kode-først, migration-sidst: alle læsere (backend + frontend) omskrives til at læse DB-kolonnen `market_value` direkte (DB-først) i stedet for at genberegne fra uci_points. Det gør selve cutoveren atomisk — én migration (DROP+ADD af generated columns, præcedens: `2026-05-04-salary-generated-column.sql`) flipper alle værdier på samme tid, uden inkonsistens-vindue mellem deploy og migration. `price`-kolonnen droppes (død: ingen runtime-læser). NULL-guard: `COALESCE(base_value, 1000)` i DB (1000 = bundskala-fallback, ejer-direktiv "ingen bund" / dårligste ≈ 1.000) — fiktiv-generatorens insert→backfill-vindue producerer aldrig NULL-økonomi.

**Tech Stack:** Postgres generated columns (Supabase), Node.js ESM + `node --test`, React/Vite, i18next (en+da), Playwright core-smoke.

**Ejer-gate:** Ejer gav eksplicit cutover-go 10/6 (denne session). Dynamisk glidning mod handelspris er BEVIDST udenfor (brief: separat produktbeslutning med egen kalibrering).

---

### Task 1: Backend — `calculateRiderMarketValue` DB-først (TDD)

**Files:**
- Modify: `backend/lib/marketUtils.js:23-24,61-67`
- Modify: `backend/lib/economyConstants.js:12-15,70-72`
- Modify: `backend/routes/api.js:1030-1032` (auction-create select), `api.js:3368-3370` (admin preview select), `api.js:6162-6164` (manager-endpoint select+order)
- Modify: `backend/lib/backfillCores.js:125,138`
- Test: `backend/lib/marketUtils.test.js`

- [ ] **Step 1: Skriv de fejlende tests** — tilføj nederst i `backend/lib/marketUtils.test.js`, udvid importen med `calculateRiderMarketValue, RIDER_BASE_VALUE_FALLBACK`:

```js
test("calculateRiderMarketValue er DB-først: market_value vinder", () => {
  assert.equal(calculateRiderMarketValue({ market_value: 900000, base_value: 100, prize_earnings_bonus: 5 }), 900000);
});

test("calculateRiderMarketValue falder tilbage til base_value + bonus", () => {
  assert.equal(calculateRiderMarketValue({ base_value: 50000, prize_earnings_bonus: 1500 }), 51500);
});

test("calculateRiderMarketValue uden base_value bruger fallback (aldrig uci_points)", () => {
  assert.equal(calculateRiderMarketValue({ uci_points: 500, prize_earnings_bonus: 0 }), RIDER_BASE_VALUE_FALLBACK);
});
```

- [ ] **Step 2: Kør og se fail** — `node --test lib/marketUtils.test.js` fra `backend/`. Forventet: FAIL (export findes ikke / gammel formel).

- [ ] **Step 3: Implementér** — i `marketUtils.js` erstat linje 23-24 + `calculateRiderBaseValue`/`calculateRiderMarketValue` med:

```js
// #1101 cutover: værdi kommer fra DB-kolonnen market_value (GENERATED fra
// base_value + prize_earnings_bonus). Fallback spejler DB'ens COALESCE(base_value, 1000)
// for callsites uden market_value i select. uci_points indgår ALDRIG.
export const RIDER_BASE_VALUE_FALLBACK = 1000;

export function calculateRiderMarketValue(rider = {}) {
  const explicit = Number(rider.market_value);
  if (Number.isFinite(explicit)) return explicit;
  const base = Number(rider.base_value) > 0 ? Number(rider.base_value) : RIDER_BASE_VALUE_FALLBACK;
  return base + (Number(rider.prize_earnings_bonus) || 0);
}
```

Slet `calculateRiderBaseValue`, `RIDER_VALUE_FACTOR`, `MIN_RIDER_UCI_POINTS` (ingen andre forbrugere — verificeret via grep 10/6).

- [ ] **Step 4: Opdatér callsites**
  - `api.js:1031` select: `uci_points` → `market_value` (auction-create; `riderValue` læser nu DB-kolonnen).
  - `api.js:3370` admin-preview select: tilføj `base_value, market_value` (old_value = aktuel DB-værdi).
  - `api.js:6163-6164` manager-endpoint: select `uci_points` → `market_value`; `.order("uci_points"...)` → `.order("market_value"...)`.
  - `backfillCores.js:125` select: tilføj `base_value, market_value` (GAMMEL-distribution = aktuel DB-værdi).
  - `economyConstants.js`: slet `MARKET_VALUE_MULTIPLIER` + `MIN_UCI_POINTS_FOR_VALUE` + uci-kommentaren (L12-15, ingen forbrugere); opdatér `SALARY_RATE_INFO`-kommentaren til at pege på `database/2026-06-10-value-cutover-base-value.sql`.

- [ ] **Step 5: Kør hele backend-suiten** — `node --test` fra `backend/`. Forventet: PASS (1204+3).

- [ ] **Step 6: Commit** — `feat(valuation): #1101 cutover - backend laeser market_value DB-foerst, uci-formler afkoblet`

---

### Task 2: Frontend — `marketValues.js` DB-først + select-sweep

**Files:**
- Modify: `frontend/src/lib/marketValues.js:1-14`
- Test: `frontend/src/lib/marketValues.test.js:40-70`
- Modify (selects): `TransfersPage.jsx:594,819,1078` · `ActivityPage.jsx:161,169,185,191` · `RiderStatsPage.jsx:205` · `AuctionsPage.jsx:702` · `DashboardPage.jsx:128` · `WatchlistPage.jsx:64` · `TeamPage.jsx:468-474,486` · `TeamProfilePage.jsx:57-65` · `HeadToHeadPage.jsx:135-136,165` · `SeasonPreviewPage.jsx:26` · `RiderComparePage.jsx:45,48`

- [ ] **Step 1: Omskriv tests** — i `marketValues.test.js`: slet de to uci-fallback-tests (L45-57: "bruger pris før UCI-point", "minimum UCI-point") og bonus-fallback-testen (L66-70); tilføj:

```js
test("getRiderMarketValue — market_value vinder", () => {
  assert.equal(getRiderMarketValue({ market_value: 900000, base_value: 100 }), 900000);
});

test("getRiderMarketValue — base_value + bonus som fallback", () => {
  assert.equal(getRiderMarketValue({ base_value: 50000, prize_earnings_bonus: 15000 }), 65000);
});

test("getRiderMarketValue — uci_points indgår aldrig", () => {
  assert.equal(getRiderMarketValue({ uci_points: 500 }), 1000);
});
```

Fjern `getRiderBaseValue` fra test-importen.

- [ ] **Step 2: Kør og se fail** — `node --test src/lib/marketValues.test.js` fra `frontend/`.

- [ ] **Step 3: Implementér** — `marketValues.js`: slet `getRiderBaseValue`, `RIDER_VALUE_FACTOR`, `MIN_RIDER_UCI_POINTS`; ny:

```js
// #1101 cutover: DB-kolonnen market_value (GENERATED fra base_value + bonus) er
// sandheden. Fallback spejler DB'ens COALESCE(base_value, 1000). Aldrig uci_points.
const RIDER_BASE_VALUE_FALLBACK = 1000;

export function getRiderMarketValue(rider = {}) {
  const explicit = Number(rider?.market_value);
  if (Number.isFinite(explicit)) return explicit;
  const base = Number(rider?.base_value) > 0 ? Number(rider.base_value) : RIDER_BASE_VALUE_FALLBACK;
  return base + (Number(rider?.prize_earnings_bonus) || 0);
}
```

(Tjek først at `getRiderBaseValue` ikke har andre importer end testen — grep.)

- [ ] **Step 4: Select-sweep** — alle steder der kalder `getRiderMarketValue` SKAL have `market_value` i select; `uci_points` fjernes hvor den kun fodrede fallbacken/var ubrugt:
  - `TransfersPage` 594/819/1078: `uci_points` → `market_value` (behold `prize_earnings_bonus` hvis vist).
  - `ActivityPage` 161/169/185/191: `uci_points` → `market_value`.
  - `RiderStatsPage` 205: `uci_points, prize_earnings_bonus` → `market_value` (compare-dropdown L263).
  - `AuctionsPage` 702: fjern `uci_points` (ubrugt — verificér med grep i filen før sletning).
  - `DashboardPage` 128: fjern `uci_points` (ubrugt — verificér).
  - `WatchlistPage` 64: `uci_points` → `market_value` (L255 bruger getRiderMarketValue).
  - `TeamPage` 468/472: `uci_points` → `market_value`; `.order("uci_points")` (470/474) → `.order("market_value")`; 486 loan-join: `uci_points` → `market_value`.
  - `TeamProfilePage` 57/63: samme swap + `.order` (59/65); tjek client-sort `tableSort.key === "uci_points"` (L41) — behold key-navnet, men sørg for at sort-værdien læses via `getRiderMarketValue` (følg eksisterende mønster i filen).
  - `HeadToHeadPage` 135/136: `uci_points` → `market_value`; tie-break L165: `(b.market_value || 0) - (a.market_value || 0)`.
  - `SeasonPreviewPage` 26: fjern `uci_points` (market_value er allerede i select; verificér ubrugt).
  - `RiderComparePage` 45: fjern `uci_points` fra select; 48: `.order("uci_points")` → `.order("market_value")`.
  - Interne sort-keys `"uci_points"` i SortTh/DEFAULT_FILTERS/useRiderFilters BEHOLDES (ikke player-facing; mapper allerede til market_value).

- [ ] **Step 5: Kør frontend-tests + lint-tjek** — `node --test` fra `frontend/`. Forventet: PASS.

- [ ] **Step 6: Commit** — `feat(valuation): #1101 cutover - frontend laeser market_value DB-foerst, uci-fallback fjernet`

---

### Task 3: Frontend — ægte UCI-visninger fjernes (player-facing)

**Files:**
- Modify: `frontend/src/pages/ManagerProfilePage.jsx:221,237` + namespace-JSON (en+da)
- Modify: `frontend/src/pages/AuctionHistoryPage.jsx:72,246` + `frontend/public/locales/{en,da}/auctions.json:72`
- Modify: `frontend/src/components/RiderDevelopmentTab.jsx` (UCI-graf + UCI-kolonne ud)
- Modify: `frontend/src/pages/RiderStatsPage.jsx:806-812` (drop rider_uci_history-fetch)
- Modify: `frontend/tests/e2e/fixtures.js:49-95` (market_value på mock-ryttere)

- [ ] **Step 1: ManagerProfilePage** — find sidens namespace (useTranslation-kaldet øverst); tilføj key `manager.thValue` = EN `"Value"` / DA `"Værdi"` i begge locale-filer; header L221 `UCI` → `{t("manager.thValue")}`; celle L237 `formatNumber(r.uci_points)` → `formatNumber(r.market_value)` (backend-endpointet leverer market_value efter Task 1).

- [ ] **Step 2: AuctionHistoryPage** — locale-key `history.riderMeta`: EN `"Value: {value} · Salary: {salary}"` / DA `"Værdi: {value} · Løn: {salary}"`; komponent L246: `points: formatNumber(a.rider?.uci_points)` → `value: formatNumber(getRiderMarketValue(a.rider))` (importér fra marketValues hvis ikke allerede); select L72: `uci_points` → `market_value`.

- [ ] **Step 3: RiderDevelopmentTab** — fjern: `uciHistory`-prop'en, UCI-graf-sektionen (L105-114), `uciChartData` (L85), UCI-kolonnen i "Seneste datapunkter" (L151, L159) og `uci_points`-feltet i `recentDevelopmentRows` (L88, L95) — tabellen viser herefter dato + valgt stat fra `statHistory` alene. Empty-state betingelsen bliver `statHistory.length === 0`.

- [ ] **Step 4: RiderStatsPage** — `loadDevelopmentHistory` (L806+): fjern `rider_uci_history`-query'en og `uciHistory`-state/prop-passing til `RiderDevelopmentTab`.

- [ ] **Step 5: Playwright-fixtures** — tilføj på rider-1: `market_value: 1680000, base_value: 1680000` og rider-2: `market_value: 1400000, base_value: 1400000` (identisk med hvad uci-fallbacken rendrer i dag: 420×4000 / 350×4000 — snapshots forbliver uændrede).

- [ ] **Step 6: Verificér ingen player-facing uci tilbage** — `grep -rn "uci_points" frontend/src --include="*.jsx"` må kun ramme: admin-sider (`AdminPage`, `AdminUsersTab`), interne sort-keys (SortTh/RiderFilters/useRiderFilters — kun hvis stadig nødvendige), `database.types.ts`, PatchNotes-historik. Alt andet = miss, fix det.

- [ ] **Step 7: Frontend-tests + build + i18n-parity** — `node --test` + `npm run build` fra `frontend/` (i18n-key-check kører i build-pipeline). Forventet: PASS/grøn.

- [ ] **Step 8: Commit** — `feat(valuation): #1101 cutover - uci_points ude af player-facing UI (manager-profil, auktionshistorik, udvikling-fane)`

---

### Task 4: Migration + schema.sql + cutover-audit-script

**Files:**
- Create: `database/2026-06-10-value-cutover-base-value.sql`
- Modify: `database/schema.sql:57-64` (+ `database/supabase_setup.sql` hvis den duplikerer formlerne — tjek)
- Create: `backend/scripts/auditValuationCutover.js`

- [ ] **Step 1: Guard-grep før price-drop** — `grep -rn '\bprice\b' backend --include='*.js' | grep -i rider` og tjek at ingen kode læser `riders.price` (auctions.price/notification-payloads er urelaterede). Ligeså `grep -rn '"price"' frontend/src`.

- [ ] **Step 2: Skriv migrationen** — `database/2026-06-10-value-cutover-base-value.sql`:

```sql
-- #1101 slice 2 CUTOVER: økonomien flipper fra uci_points til base_value (v3).
--
-- market_value/salary var GENERATED fra uci_points (juridisk + designmæssig
-- IRL-afhængighed). base_value (v3: alsidigheds-blend + krumning, ejer-verificeret
-- i shadow 9-10/6) er nu kilden. Generated-kolonner kan ikke ALTER'es — DROP+ADD
-- (præcedens: 2026-05-04-salary-generated-column.sql). DB rewriter alle rækker.
--
-- price DROPPES: ingen runtime-læser (verificeret 10/6) — den var uci_points*4000.
-- COALESCE(base_value, 1000): fiktiv-generatorens insert→backfill-vindue må aldrig
-- give NULL-økonomi; 1000 = bundskala (ejer: "dårligste ryttere ≈ 1.000"). Audit
-- (scripts/auditValuationCutover.js) fejler hvis NULL/0 base_value persisterer.
--
-- Rollback: DROP de to kolonner + ADD med de gamle uci-formler fra git-historik.

BEGIN;

ALTER TABLE riders DROP COLUMN price;
ALTER TABLE riders DROP COLUMN market_value;
ALTER TABLE riders DROP COLUMN salary;

ALTER TABLE riders ADD COLUMN market_value INTEGER GENERATED ALWAYS AS (
  COALESCE(base_value, 1000) + prize_earnings_bonus
) STORED;

ALTER TABLE riders ADD COLUMN salary INTEGER GENERATED ALWAYS AS (
  GREATEST(1, ROUND(
    (COALESCE(base_value, 1000) + prize_earnings_bonus) * 0.10
  ))::INTEGER
) STORED;

CREATE INDEX idx_riders_market_value ON riders (market_value DESC);

COMMENT ON COLUMN riders.base_value IS
  'Data-drevet rytter-værdi (#1101, model v3). LIVE siden cutover 2026-06-10: '
  'market_value/salary er GENERATED herfra. uci_points er afkoblet (ikke droppet '
  '- oprydning post-launch). Skrives af backfillRiderBaseValue/relaunch-orchestrator.';

COMMIT;
```

- [ ] **Step 3: Opdatér schema.sql** — L57-64: slet `price`-linjen; erstat market_value/salary-formlerne med de nye (identisk tekst som migrationen); opdatér salary-kommentaren (L59). Tjek `supabase_setup.sql` for samme formler og ret tilsvarende.

- [ ] **Step 4: Skriv audit-scriptet** — `backend/scripts/auditValuationCutover.js`:

```js
#!/usr/bin/env node
// Cutover-audit for #1101 slice 2: beviser at økonomien konsistent kører på
// base_value. Fejler (exit 1) ved: (a) aktive ryttere med base_value NULL/0,
// (b) market_value/salary der ikke matcher de nye GENERATED-formler,
// (c) runtime-formlen (calculateRiderMarketValue) der divergerer fra DB.
// Read-only. Kør efter migration + efter enhver re-backfill.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { calculateRiderMarketValue, RIDER_BASE_VALUE_FALLBACK } from "../lib/marketUtils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const fmt = (n) => Math.round(n).toLocaleString("da-DK");

const riders = await fetchAllRows(() => supabase
  .from("riders")
  .select("id, firstname, lastname, base_value, prize_earnings_bonus, market_value, salary, is_retired, pcm_id")
  .order("id"));

const active = riders.filter((r) => !r.is_retired);
const failures = [];

const badBase = active.filter((r) => !(Number(r.base_value) > 0));
if (badBase.length > 0) {
  failures.push(`${badBase.length} aktive ryttere med base_value NULL/0 (fx ${badBase.slice(0, 3).map((r) => `${r.firstname} ${r.lastname}`).join(", ")})`);
}

let mvMismatch = 0, salMismatch = 0, runtimeMismatch = 0;
for (const r of riders) {
  const base = Number(r.base_value) > 0 ? Number(r.base_value) : RIDER_BASE_VALUE_FALLBACK;
  const expectMv = base + (Number(r.prize_earnings_bonus) || 0);
  const expectSal = Math.max(1, Math.round(expectMv * 0.10));
  if (r.market_value !== expectMv) mvMismatch++;
  if (r.salary !== expectSal) salMismatch++;
  if (calculateRiderMarketValue(r) !== r.market_value) runtimeMismatch++;
}
if (mvMismatch) failures.push(`${mvMismatch} ryttere hvor market_value ≠ COALESCE(base_value,${RIDER_BASE_VALUE_FALLBACK}) + bonus (kører den gamle uci-formel stadig?)`);
if (salMismatch) failures.push(`${salMismatch} ryttere hvor salary ≠ max(1, round(10% af market_value))`);
if (runtimeMismatch) failures.push(`${runtimeMismatch} ryttere hvor runtime-formlen divergerer fra DB`);

const vals = active.map((r) => r.market_value).sort((a, b) => a - b);
const pct = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
console.log(`Cutover-audit: ${riders.length} ryttere (${active.length} aktive)`);
console.log(`market_value: p10 ${fmt(pct(0.1))} · median ${fmt(pct(0.5))} · p90 ${fmt(pct(0.9))} · max ${fmt(vals[vals.length - 1])}`);
console.log("Top 8 (aktive):");
for (const r of [...active].sort((a, b) => b.market_value - a.market_value).slice(0, 8)) {
  console.log(`  ${`${r.firstname} ${r.lastname}`.padEnd(24)} ${r.pcm_id == null ? "fiktiv " : "virkelig"} ${fmt(r.market_value).padStart(15)}`);
}

if (failures.length > 0) {
  console.error("\n❌ CUTOVER-AUDIT FEJLEDE:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\n✅ Cutover-audit grøn: økonomien kører konsistent på base_value.");
```

- [ ] **Step 5: Syntaks-tjek** — `node --check scripts/auditValuationCutover.js` fra `backend/`. (Kørsel mod prod sker i Task 6 EFTER migration.)

- [ ] **Step 6: Commit** — `feat(valuation): #1101 cutover-migration (market_value/salary fra base_value, price droppet) + audit-script`

---

### Task 5: PatchNotes + docs

**Files:**
- Modify: `frontend/src/pages/PatchNotesPage.jsx` (ny version-entry, EN+DA)
- Modify: `docs/GAME_INVARIANTS.md` (economy-konstanter: uci-formlen ud, base_value ind)
- Modify: `docs/decisions/rider-valuation-model-v1.md` (cutover-udført-note under v3-sektionen)
- Modify: `docs/FEATURE_STATUS.md` (værdisystem shadow → live, hvis listet)

- [ ] **Step 1: PatchNotes-entry** — følg eksisterende format/versions-konvention i filen (EN først, DA under). Indhold: rytter-værdier og lønninger drives nu af spillets eget værdisystem (v3, evne-baseret med alsidigheds-præmie) i stedet for UCI-point; værdier og lønninger har derfor flyttet sig; UCI-point vises ikke længere i spillet. Ingen em-dash (brand-regel).
- [ ] **Step 2: GAME_INVARIANTS** — find værdi-/økonomi-sektionen; erstat `uci_points × 4000`-beskrivelsen med: `market_value = COALESCE(base_value, 1000) + prize_earnings_bonus`, `salary = max(1, 10%)`, base_value skrives KUN af backfill/orchestrator, model = riderValuationModel.json (v3).
- [ ] **Step 3: Decision-doc** — under v3-sektionen: `**Cutover udført 10/6-2026** (slice 2): market_value/salary GENERATED fra base_value, price droppet, uci_points afkoblet (vises ikke player-facing). Audit: scripts/auditValuationCutover.js.`
- [ ] **Step 4: Commit** — `docs(valuation): #1101 cutover-dokumentation + patch notes`

---

### Task 6: Verifikation, PR, deploy, migration, prod-audit

- [ ] **Step 1: Fuld lokal verifikation** — `pwsh -File scripts/verify-local.ps1` (backend-tests + frontend-tests + build) + `npx playwright test core-smoke.spec.js` (alle 3 projekter, intet `--project`-flag). Forventet: alt grønt, ingen snapshot-diffs (fixtures pinnet i Task 3 Step 5).
- [ ] **Step 2: PR** — branch `feat/1101-value-cutover`, push, `gh pr create` med titel `feat(valuation): #1101 cutover - market_value/salary fra base_value, uci afkoblet`. Body: Refs #1101 · ejer-go 10/6 · atomisk cutover-design (kode DB-først → migration flipper) · **Brugerverifikation-sektion** (værdier/lønninger ændrer sig synligt; UCI-kolonner væk) · migration køres EFTER merge+deploy.
- [ ] **Step 3: Merge ved grøn CI** — auto-merge; verificér Vercel + Railway deployer (Railway: logs-timestamp vs push-tid, jf. memory).
- [ ] **Step 4: Apply migration** — Supabase MCP `apply_migration` med navn `value_cutover_base_value` og indholdet fra Task 4 Step 2 (uden BEGIN/COMMIT hvis MCP'en selv wrapper). Verificér med read-only SQL: `select column_name, generation_expression from information_schema.columns where table_name='riders' and column_name in ('market_value','salary');` + at `price` er væk.
- [ ] **Step 5: Kør prod-audit** — `node scripts/auditValuationCutover.js` fra `backend/`. Forventet: grøn, Pogačar øverst blandt virkelige, median ~45k.
- [ ] **Step 6: Regenerér DB-typer** — Supabase MCP `generate_typescript_types` → opdatér `frontend/src/types/database.types.ts` (price ud); commit som `chore(types): #1101 regen efter value-cutover` på main.
- [ ] **Step 7: Prod-UI-verify** — riders-listen på cycling-zone.vercel.app viser v3-værdier (read-only tjek; logget-ind-verify via Playwright-mocks er allerede dækket af core-smoke).
- [ ] **Step 8: Close-out** — issue-kommentar på #1101 (cutover udført + audit-output; rest-scope = fase 3 dynamisk glidning → issue forbliver åben eller splittes); NOW.md (Next action → #1194, Working agent → nulstil); postmortem ikke påkrævet (ikke bugfix). Slet evt. plan-checkbokse opdateres.

---

## Self-review (udført)

- **Spec-dækning:** GENERATED-kolonner omlagt ✓ (Task 4), runtime-paths afkoblet ✓ (Task 1-2), uci ikke player-facing ✓ (Task 3 + Step 6-grep), cutover-audit ✓ (Task 4), ejer-verify kvitteret ✓ (go 10/6), testsuite ✓ (Task 1/2/3/6), dynamisk glidning udenfor ✓ (brief).
- **Placeholder-scan:** ingen TBD/TODO; verificér-trin har konkrete grep-kommandoer.
- **Type-konsistens:** `RIDER_BASE_VALUE_FALLBACK` eksporteres fra marketUtils (Task 1) og importeres i audit (Task 4); frontend-varianten er fil-lokal konstant (bevidst — ingen cross-import). COALESCE-konstanten 1000 optræder i migration, marketUtils, marketValues og audit — alle fire SKAL matche.
