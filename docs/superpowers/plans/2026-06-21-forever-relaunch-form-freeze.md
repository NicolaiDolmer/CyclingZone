# Forever-relaunch — Form-Freeze Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fryse den *permanente* form for en 4-divisions / 15-pulje liga-pyramide (1/2/4/8) i forever-relaunch-vinduet, så de dyre mekanik-dele kan bygges additivt EFTER forever uden et nyt reset.

**Architecture:** Path (A) fra reset-krævende-analysen (21/6): kun FORM-minimummet er granit. Ny `league_divisions`-tabel (tier + pulje) + `teams.league_division_id`-FK; `teams.division` bevares som denormaliseret TIER (1-4) så al eksisterende tier-keyet økonomi-kode er urørt (minimal blast radius). Pulje er KUN race- og standings-gruppering; økonomi forbliver tier-keyet. Parallelle løb-instanser, AI-fyld-generator og 4-tier op/nedrykning er IKKE i denne plan — de glider efter forever (#1608-children).

**Tech Stack:** Node.js/Express backend, Supabase Postgres (auto-migrate ved deploy af `database/*.sql`), `node --test` (backend), `moneySupplyScorecard.js` (balance-harness).

---

## Scope

**I scope (form-frys-minimum — 5 verificerede reset-krævende punkter):**
1. Skema-form: `league_divisions`-tabel + `teams.league_division_id`-FK + pulje-akse på `season_standings`.
2. Tier-4 net-økonomi-konstanter (kalibreret) + `MAX_DIVISION=4` + `loan_config` tier-4-rækker.
3. Reset-allokering der spreder hold pr. tier+pulje (i dag flad).
4. Fix hardcodet `[1,2,3]`-loop i `economyEngine.js:850` + `DIVISION_BONUSES[4]`.
5. Pulje-rang i `season_standings` + board-mål.

**Ude af scope (additivt EFTER forever — separate #1608-children, ingen reset):**
- Parallelle løb-instanser + 24-cap + pulje-filter i `raceRunner.js:fillMissingTeamEntries`.
- AI-fyld-generator (`generateAiTeams`/betinget per-pulje-opfyldning) — findes IKKE i dag.
- 4-tier op/nedrykning mellem puljer (gated af `FIRST_PROMOTION_RELEGATION_SEASON=3`).
- `StandingsPage.jsx` pulje-faner (ren frontend, glider).

## Frosne design-beslutninger (granit — gennemgås i granit-frys-session §7)

- **`league_divisions`-tabel** (navn valgt for at undgå kollision med eksisterende race-`pool`): hver række ER en pulje inden for en tier. 15 rækker: tier 1×1, tier 2×2, tier 3×4, tier 4×8.
- **Økonomi er TIER-keyet** (`*_BY_DIVISION[tier]`), IKKE pulje-keyet. `teams.division` bevares = tier (1-4). Pulje (`league_division_id`) påvirker kun race-feltinddeling + standings-rang.
- **Pulje-target-størrelse = race-feltcap = 24** (`POOL_TARGET_SIZE = 24`). Erstatter `DIVISION_CAPACITY=20` som pulje-kapacitet (forenet med #1608's 24-cap).
- **GT (grand tours): kun tier 1.** (Design-intent frosset her; selve race-tildelingen bygges additivt.)
- **AI-fyld-politik** (bygges additivt, men politikken er frosset): tier 1+2 = altid AI-fyldt til target; tier 3+4 = AI fylder KUN puljer med ≥1 rigtig manager, op til target.
- **Nye signups** placeres pulje-bevidst (fyld-fra-toppen pr. pulje); ægte managere ind fra bunden (tier 4) som default, AI viger.

## File Structure

- `database/2026-06-21-league-divisions-pyramid.sql` (NEW) — `league_divisions`-tabel + seed + `teams`/`season_standings` FK-kolonner + CHECK-udvidelse + backfill af eksisterende hold. **Ejeren merger (auto-migrate).**
- `database/2026-06-21-tier4-economy.sql` (NEW) — `loan_config` tier-4-rækker. **Ejeren merger.**
- `backend/lib/economyConstants.js` (MODIFY) — tier-4 net-konstanter, `MAX_DIVISION=4`, `POOL_TARGET_SIZE`.
- `backend/lib/economyEngine.js` (MODIFY:850, :90-94, :760-767) — MIN..MAX_DIVISION-loop, `DIVISION_BONUSES[4]`.
- `backend/lib/betaResetService.js` (MODIFY:212-225) — pulje-spredende reset-allokering.
- `backend/lib/relaunchOrchestrator.js` (MODIFY) — kald pulje-allokering i reset-sekvensen.
- `backend/lib/economyEngine.js` updateStandings (MODIFY:~1679) — rang pr. pulje (`league_division_id`).
- `backend/lib/boardGoals.js` (VERIFY:824,1102) — `rank_in_division` læser pulje-rang.
- `backend/lib/teamProfileEngine.js` (MODIFY:163-187) — pulje-bevidst `pickDivisionForNewTeam`.
- `backend/scripts/moneySupplyScorecard.js` (MODIFY) — tier-4 + 100-mgr syntetisk population.
- `database/schema.sql` (MODIFY) — spejl migrationen (kanonisk schema-doc).

---

## Task 1: `league_divisions`-tabel + seed (migration)

**Files:**
- Create: `database/2026-06-21-league-divisions-pyramid.sql`
- Modify: `database/schema.sql` (spejl)

- [ ] **Step 1: Skriv migrationen (idempotent)**

```sql
-- Forever-relaunch: 4-tier / 15-pulje pyramide. Tier = økonomi-bånd; pulje = race/standings-gruppe.
CREATE TABLE IF NOT EXISTS league_divisions (
  id SERIAL PRIMARY KEY,
  tier INTEGER NOT NULL CHECK (tier IN (1, 2, 3, 4)),
  pool_index INTEGER NOT NULL,            -- 0-baseret indeks inden for tier
  label TEXT NOT NULL,
  UNIQUE (tier, pool_index)
);

-- Seed 15 puljer: tier1×1, tier2×2, tier3×4, tier4×8.
INSERT INTO league_divisions (tier, pool_index, label) VALUES
  (1, 0, 'Division 1'),
  (2, 0, 'Division 2 — A'), (2, 1, 'Division 2 — B'),
  (3, 0, 'Division 3 — A'), (3, 1, 'Division 3 — B'), (3, 2, 'Division 3 — C'), (3, 3, 'Division 3 — D'),
  (4, 0, 'Division 4 — A'), (4, 1, 'Division 4 — B'), (4, 2, 'Division 4 — C'), (4, 3, 'Division 4 — D'),
  (4, 4, 'Division 4 — E'), (4, 5, 'Division 4 — F'), (4, 6, 'Division 4 — G'), (4, 7, 'Division 4 — H')
ON CONFLICT (tier, pool_index) DO NOTHING;

ALTER TABLE league_divisions ENABLE ROW LEVEL SECURITY;
-- Læs-adgang for klienten (standings/league-visning).
DROP POLICY IF EXISTS "league_divisions_read" ON league_divisions;
CREATE POLICY "league_divisions_read" ON league_divisions FOR SELECT TO anon, authenticated USING (true);
```

- [ ] **Step 2: Spejl i `database/schema.sql`** (tilføj `league_divisions`-blokken under TEAMS-sektionen).

- [ ] **Step 3: Verificér idempotens lokalt** mod en frisk Postgres (kør migrationen 2× — anden kørsel må ikke fejle). Run: migration-linter `node backend/scripts/...` (eksisterende idempotency-linter, #401).

- [ ] **Step 4: Commit** (branch `feat/1608-form-freeze`, IKKE auto-merge — ejer merger SQL).

## Task 2: `teams.league_division_id` FK + tier-CHECK-udvidelse (migration)

**Files:**
- Modify: `database/2026-06-21-league-divisions-pyramid.sql` (samme migration)
- Modify: `database/schema.sql:41`

- [ ] **Step 1: Tilføj FK + udvid CHECK + backfill**

```sql
-- Udvid tier-domænet (teams.division ER nu tier-tallet 1-4).
ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_division_check;
ALTER TABLE teams ADD CONSTRAINT teams_division_check CHECK (division IN (1, 2, 3, 4));

-- Pulje-reference (race/standings-gruppe). NULL tilladt indtil allokering.
ALTER TABLE teams ADD COLUMN IF NOT EXISTS league_division_id INTEGER REFERENCES league_divisions(id);
GRANT SELECT (league_division_id) TO anon, authenticated; -- #1162 kolonne-privilege-mønster

-- Backfill: map eksisterende heltals-division til tier-puljens pulje 0.
UPDATE teams t SET league_division_id = ld.id
  FROM league_divisions ld
  WHERE ld.tier = t.division AND ld.pool_index = 0 AND t.league_division_id IS NULL;
```

- [ ] **Step 2: Spejl `schema.sql:41`** → `division INTEGER DEFAULT 4 CHECK (division IN (1,2,3,4))` + tilføj `league_division_id` kolonne. (Default-division skifter til 4 = bunden, jf. nye-spillere-fra-bunden.)

- [ ] **Step 3: Verificér kolonne-privilege** mod prod-klon (memory: `ADD COLUMN` giver IKKE klient-læseadgang uden GRANT, #1162/#1309). Bekræft `anon`/`authenticated` kan SELECT'e `league_division_id`.

- [ ] **Step 4: Commit.**

## Task 3: `season_standings` pulje-akse + rang-pr-pulje

**Files:**
- Modify: `database/2026-06-21-league-divisions-pyramid.sql`
- Modify: `backend/lib/economyEngine.js` (updateStandings, ~:1679)
- Test: `backend/test/standings-pool-rank.test.js` (NEW)

- [ ] **Step 1: Migration — tilføj pulje-FK til standings**

```sql
ALTER TABLE season_standings ADD COLUMN IF NOT EXISTS league_division_id INTEGER REFERENCES league_divisions(id);
GRANT SELECT (league_division_id) TO anon, authenticated;
CREATE INDEX IF NOT EXISTS idx_standings_pool ON season_standings(season_id, league_division_id);
```

- [ ] **Step 2: Skriv fejlende test** — `updateStandings` skal sætte `rank_in_division` = rang INDEN FOR puljen (`league_division_id`), ikke på tværs af hele tier'en. Test: to puljer i tier 4, hold med samme point i hver pulje → begge får rank 1.

- [ ] **Step 3: Kør test → FAIL.**

- [ ] **Step 4: Implementér** — i `updateStandings` (`economyEngine.js:~1679`), gruppér + ranger pr. `league_division_id` i stedet for `division`. Sæt både `division` (tier, til økonomi/visning) og `league_division_id` på hver standings-række.

- [ ] **Step 5: Kør test → PASS. Commit.**

## Task 4: Tier-4 net-økonomi-konstanter (FØDES af Task 8-kalibrering)

**Files:**
- Modify: `backend/lib/economyConstants.js:22,33,71,76`
- Modify: `backend/lib/economyEngine.js:90-94` (DIVISION_BONUSES)
- Create: `database/2026-06-21-tier4-economy.sql` (loan_config-rækker)

> **Afhænger af Task 8.** Værdierne nedenfor er PLADSHOLDERE markeret `<KALIBRERET>` og MÅ ikke landes før `moneySupplyScorecard --synthetic` (Task 8) har bekræftet net-mål for tier 4 mod 100-mgr-population OG ejeren har granit-frosset dem (§7). Frys aldrig usimulerede tal.

- [ ] **Step 1: Udvid konstanterne**

```js
export const SPONSOR_INCOME_BY_DIVISION = { 1: 600000, 2: 400000, 3: 340000, 4: /* <KALIBRERET> */ };
export const UPKEEP_BY_DIVISION = { 1: 440000, 2: 140000, 3: 40000, 4: /* <KALIBRERET, typ. 0-20k> */ };
export const DEBT_CEILING_BY_DIVISION = { 1: 1200000, 2: 900000, 3: 600000, 4: /* <KALIBRERET> */ };
export const MAX_DIVISION = 4;
export const POOL_TARGET_SIZE = 24;
```

- [ ] **Step 2: `DIVISION_BONUSES[4]`** i `economyEngine.js:90-94` (sæson-slut-bonus pr. pulje-placering; tier 4 lavest — `<KALIBRERET>`, fx `[50000, 25000, 10000]`).

- [ ] **Step 3: `loan_config` tier-4-rækker** (migration) — short+long for division=4, så `createLoan`-RPC ikke fejler. Værdier matcher `DEBT_CEILING_BY_DIVISION[4]`.

- [ ] **Step 4: Test** — `economyEngine` bonus/upkeep/debt-lookups returnerer definerede tal (ikke `undefined`/0) for division=4. Commit (SQL: ejer merger).

## Task 5: Fix hardcodet `[1,2,3]`-loop + tavse div-4-huller

**Files:**
- Modify: `backend/lib/economyEngine.js:850`
- Test: `backend/test/season-end-all-divisions.test.js` (NEW)

- [ ] **Step 1: Skriv fejlende test** — `processSeasonEnd` skal køre `processDivisionEnd` for ALLE tiers `MIN_DIVISION..MAX_DIVISION` (inkl. 4). Mock 4 tiers, assert `processDivisionEnd` kaldes for tier 4.

- [ ] **Step 2: Kør → FAIL** (i dag springes tier 4 over).

- [ ] **Step 3: Implementér** — erstat `for (const division of [1, 2, 3])` (`economyEngine.js:850`) med:

```js
for (let division = MIN_DIVISION; division <= MAX_DIVISION; division++) {
```

(import `MIN_DIVISION`/`MAX_DIVISION` hvis ikke allerede). Verificér at `payDivisionBonuses` (`:760-767`) har `DIVISION_BONUSES[4]` fra Task 4 så div-4-hold ikke får tavst `undefined → continue`.

- [ ] **Step 4: Kør → PASS. Commit.**

## Task 6: Pulje-spredende reset-allokering

**Files:**
- Modify: `backend/lib/betaResetService.js:212-225` (`resetBetaDivisions`)
- Modify: `backend/lib/relaunchOrchestrator.js` (kald allokering i sekvensen)
- Test: `backend/test/reset-pool-allocation.test.js` (NEW)

- [ ] **Step 1: Skriv fejlende test** — efter reset-allokering skal alle manager-hold have et `league_division_id` (ikke NULL), og fordelingen følger politikken (ægte managere placeres; tier 1+2-puljer fyldes med AI; tier 3+4-puljer kun AI hvor ≥1 manager). For en lille fixture (fx 5 managere) assert: ingen NULL `league_division_id`, og tier-1+2-puljer har AI.

- [ ] **Step 2: Kør → FAIL.**

- [ ] **Step 3: Implementér** allokerings-funktion (`allocateLeaguePools(supabase)`): hent league_divisions; placér managere fyld-fra-toppen pr. pulje (target = `POOL_TARGET_SIZE`); sæt `teams.division` = pulje.tier + `teams.league_division_id` = pulje.id. Erstat den flade `resetBetaDivisions`-bulk-update. (AI-fyld af tomme slots = additiv senere; her sættes kun de eksisterende holds pulje korrekt.)

- [ ] **Step 4: Kobl ind i `relaunchOrchestrator.js`** efter trup-allokering, før sæson-transition.

- [ ] **Step 5: Kør → PASS. Commit.**

## Task 7: Board-mål læser pulje-rang

**Files:**
- Modify/Verify: `backend/lib/boardGoals.js:824,1102`
- Test: `backend/test/board-goals-pool-rank.test.js` (NEW)

- [ ] **Step 1: Test** — board-mål baseret på `rank_in_division` + `division_manager_count` skal regne på PULJEN (efter Task 3 er `rank_in_division` pulje-rang). Assert et board-mål "top 3 i din division" evaluerer mod pulje-rang, ikke tier-bred rang.

- [ ] **Step 2: Kør → FAIL eller PASS** (afhænger af om `boardGoals` allerede læser den opdaterede kolonne). Hvis PASS efter Task 3: dokumentér at det blot var en bekræftelse. Hvis FAIL: ret `division_manager_count`-kilden til pulje-tælling.

- [ ] **Step 3: Commit.**

## Task 8: Tier-4-kalibrering (PARALLEL — føder Task 4 + granit-frys §7)

**Files:**
- Modify: `backend/scripts/moneySupplyScorecard.js`

- [ ] **Step 1: Udvid scorecard** til tier 4 + en syntetisk 100-manager-population fordelt på 15 puljer (1/2/4/8). Genbrug `--synthetic`-grenen.

- [ ] **Step 2: Kør** `node backend/scripts/moneySupplyScorecard.js --synthetic` og find tier-4 net-mål (D4 ≈ overskud/break-even som D3, |net|-mål jf. §2.2). Foreslå `SPONSOR_INCOME_BY_DIVISION[4]` + `UPKEEP_BY_DIVISION[4]` + `DEBT_CEILING_BY_DIVISION[4]` + `DIVISION_BONUSES[4]`.

- [ ] **Step 3: Præsentér tallene for ejeren** (granit-frys §7) → ved godkendelse: udfyld `<KALIBRERET>` i Task 4. **Ejer-gate — ikke autonomt.**

## Task 9: Pulje-bevidst nye-signup-placering (kan fast-followe)

**Files:**
- Modify: `backend/lib/teamProfileEngine.js:163-187` (`pickDivisionForNewTeam`)
- Test: `backend/test/new-team-pool-placement.test.js` (NEW)

> Ren applikationskode (additiv), men nødvendig for "klar til 100 managers fra dag 1". Kan landes lige efter vinduet hvis tiden kniber.

- [ ] **Step 1: Test** — ny manager placeres i en tier-4-pulje med plads (fyld-fra-bunden for ægte managere), får både `division`=4 og et gyldigt `league_division_id`.

- [ ] **Step 2: Implementér** pulje-bevidst placering (returnér `{division, league_division_id}`); opdatér insert-payload i `teamProfileEngine.js:104,309-315`.

- [ ] **Step 3: Kør → PASS. Commit.**

---

## Self-Review

**Spec coverage (5 frys-punkter):** (1) skema-form = Task 1+2+3 ✅ · (2) tier-4-konstanter+MAX_DIVISION = Task 4+8 ✅ · (3) reset-allokering = Task 6 ✅ · (4) `[1,2,3]`-fix+DIVISION_BONUSES[4] = Task 5 ✅ · (5) pulje-rang board-mål = Task 3+7 ✅. Nye-signup-placering (verify-fund) = Task 9.

**Placeholder-scan:** Eneste bevidste pladsholdere er `<KALIBRERET>` i Task 4 — de er gated af Task 8 + granit-frys §7 (legitim "fødes-af-task", ikke skjult mangel). Alt andet har eksakt kode/fil.

**Type-konsistens:** `league_division_id` (INTEGER FK → `league_divisions.id` SERIAL) bruges konsistent på `teams` + `season_standings`. `teams.division` = tier (1-4) overalt; pulje = `league_division_id`. `POOL_TARGET_SIZE`/`MAX_DIVISION` defineret i Task 4, brugt i Task 6+9.

**Risici:** (a) 2 migrationer skal være anvendt i prod FØR reset-vinduet (ejer-merge + auto-migrate + verificér). (b) Task 4 gated af kalibrering — hvis ikke nået ordentligt 21/6, slip vinduet 1 dag (fallback-regel). (c) `teams.division`-bevaring som tier holder blast radius lille, men kræver at allokering ALTID sætter både `division` (tier) OG `league_division_id` i sync.

## Execution Handoff

Form-frysen er den permanente del; resten af dagens køreplan (3 kode-blockers #1673/#1678/#1680, WS1 §6.1-bevis, comms, dry-run-test) kører som separate spor.
