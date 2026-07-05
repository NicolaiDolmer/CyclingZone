# Staff-rigdom A4 (backend: evne-model + ability-drevet effekt + harness) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) eller superpowers:executing-plans. Steps bruger checkbox (`- [ ]`).

**Goal:** Giv staff evner (dimension Fysisk/Mental/Teknisk × niveau Ungdom/Junior/Senior) persisteret i `staff_derived_abilities` (spejler `rider_derived_abilities`); erstat A3's tier→udnyttelses-skalar med en **ability-drevet effekt-model** (`staffFactor(overall) × specializationMatch`); gør staff-løn rating-drevet (så løn bider — Q1); wire training-effekten ind i trænings-motoren (dimension×niveau, kun UNDER caps); og genkør hele harness-suiten mod den nye model. Frontend-profil = separat følgeplan (A4b). Flag-flip er ejer-only efter harness grøn.

**Architecture:** Ny ren `staffAbilityDerivation.js` (spejler `abilityDerivation.js` + kontrast-disciplinen, ingen I/O) genererer deterministiske staff-evner fra (role, tier, navn-hash). Effekt-modellen flyttes fra `staffUtilization(tier)` til `staffEffectFactor(staff)` i `facilityEngine.js` (bagud-kompatibel signatur bevares hvor A3-UI kalder). Training-hooket er ét ekstra multiplikator-led i `dailyAbilityDelta` gated på et staff-bonus-opslag (dimension×niveau), som er 1.0 når ingen chef/flag off → nul regression. Al balance bevises i `facilityInvestmentScorecard` (udvidet) + `inflationScorecard` + fresh/Gini-non-regression FØR flip.

**Tech Stack:** Node.js ESM, `node --test`. Migration = ejer-merge (som Fase 1). Harness = 100% syntetisk.

**Spec:** `docs/superpowers/specs/2026-07-05-staff-richness-design.md` §1/§2/§6/§7. Grunding (denne session): trænings-hook `backend/lib/dailyTraining.js` `dailyAbilityDelta`; kategorier `abilityDerivation.js` VISIBLE_ABILITIES; niveauer `academyFlag.js` (is_academy, 16–21) + `riderProgression.js`; pension FULDT implementeret (`is_retired`, `retirementDecision` 36–40); persistens `rider_derived_abilities` (+ `ability_progress`/`ability_caps` JSONB). **Issue:** [#2216](https://github.com/NicolaiDolmer/CyclingZone/issues/2216).

**Mekaniske rammer (ikke-omsættelige):**
- Worktree `feat/1441-staff-richness-a4` branchet fra **A3-branchen** (`feat/1441-facilities-staff-a3`) — bygger ovenpå A3-UI'et. Verificér branch i selve commit-kæden.
- **Migration = ejer-merge-only** (rører DB i prod). PR med `database/*.sql` auto-merger ALDRIG.
- `FACILITIES_ENABLED` forbliver disabled indtil ejer-flip; A4 rører KUN opførsel bag flaget + træningshook der er no-op uden ansat staff.
- **Non-regression obligatorisk:** dailyTraining uden staff = bit-identisk; fresh/Gini uændret; `npm test` grøn.
- `pwsh -File scripts/verify-local.ps1` før push.
- Ingen player-facing copy her (profil-UI er A4b) → ingen patch note (skriv hvorfor i PR-body).

**Verificér mod ægte kode:** grunding-line-numre stammer fra en stale worktree — hver implementer LÆSER den faktiske fil i A4-worktree'et før edit.

---

### Task 1: Worktree + branch + baseline

- [ ] **Step 1:** `pwsh -File scripts/new-worktree.ps1 -Branch feat/1441-staff-richness-a4 -From feat/1441-facilities-staff-a3` (hvis `-From` ikke understøttes: `git worktree add <sti> -b feat/1441-staff-richness-a4 feat/1441-facilities-staff-a3`). `cd backend && npm ci`; `cd frontend && npm ci`.
- [ ] **Step 2:** Verificér: `git rev-parse --show-toplevel` = worktree; `git branch --show-current` = `feat/1441-staff-richness-a4`; `cd backend && npm test` grøn baseline; bekræft A3-koden er til stede (`ls backend/lib/facilityEngine.js frontend/src/pages/KlubPage.jsx`).

---

### Task 2: Staff-evne-konstanter + dimension/niveau-mapping (TDD)

**Files:** Create `backend/lib/staffAbilityConstants.js` + `backend/lib/staffAbilityConstants.test.js`.

Definér SSOT for staff-evne-modellen. Ingen I/O.

- [ ] **Step 1: Skriv fejlende test** — assertér: `DIMENSION_TO_ABILITIES` grupperer de 15 rytter-evner i physical(10)/mental(2)/technical(3) præcis som `abilityDerivation.VISIBLE_ABILITIES`; `STAFF_ROLES` = de 5 roller; `LEVEL_BANDS` = ["youth","junior","senior"]; `riderLevelBand(rider)` returnerer bånd fra `is_academy`/alder (youth: is_academy && age≤21; senior: age≥26; junior: ellers); `TIER_OVERALL_BAND[tier]` = {lo,hi} monotont stigende 1→5.
- [ ] **Step 2:** Kør → FAIL.
- [ ] **Step 3: Implementér** — importér `VISIBLE_ABILITIES` fra `abilityDerivation.js` (drift-guard: byg `DIMENSION_TO_ABILITIES` og assertér i test at union == VISIBLE_ABILITIES). Definér:
```js
export const STAFF_ROLES = Object.freeze(["training","scouting","medical","academy","commercial"]);
export const LEVEL_BANDS = Object.freeze(["youth","junior","senior"]);
export const DIMENSION_TO_ABILITIES = Object.freeze({
  physical: ["climbing","time_trial","flat","tempo","sprint","acceleration","punch","endurance","recovery","durability"],
  mental: ["aggression","tactics"],
  technical: ["descending","cobblestone","positioning"],
});
// Afledt kvalitets-bånd pr. tier (overall-interval kandidat trækkes inden for; kalibreres i harness).
export const TIER_OVERALL_BAND = Object.freeze({ 1:{lo:28,hi:44}, 2:{lo:40,hi:56}, 3:{lo:52,hi:68}, 4:{lo:63,hi:79}, 5:{lo:72,hi:90} });
// Alders-bånd → niveau (grunding: is_academy 16–21 = youth; 22–25 = junior; 26+ = senior).
export function riderLevelBand({ is_academy, age }) {
  if (is_academy && age <= 21) return "youth";
  if (age >= 26) return "senior";
  return "junior";
}
```
- [ ] **Step 4:** Kør → PASS. `npm test` grøn.
- [ ] **Step 5: Commit** — `git branch --show-current && git add backend/lib/staffAbilityConstants.js backend/lib/staffAbilityConstants.test.js && git commit -m "feat(staff): evne-konstanter — dimension/niveau/tier-bånd (#2216 A4)"`.

---

### Task 3: `staffAbilityDerivation.js` — deterministisk evne-generering (TDD)

**Files:** Create `backend/lib/staffAbilityDerivation.js` + `.test.js`. Study-first: LÆS `backend/lib/abilityDerivation.js` (kontrast-boost-blokken + mulberry32/hashString-mønsteret i `staffCandidates.js`).

Genererer en staff-evne-profil: 3 coaching-dimensioner (physical/mental/technical training) + 3 niveau-affiniteter (youth/junior/senior) + rolle-evner (rolle-specifikke) + `overall`. Deterministisk fra (role, tier, name). Rolle-skew: training-rollen har fuld dimension×niveau; øvrige roller får rolle-relevante akser (scouting: evaluation/reach + niveau; medical: recovery/injury; academy: intake/growth; commercial: negotiation/marketing).

- [ ] **Step 1: Skriv fejlende tests:**
```js
import test from "node:test"; import assert from "node:assert/strict";
import { deriveStaffAbilities, staffOverall } from "./staffAbilityDerivation.js";
import { TIER_OVERALL_BAND } from "./staffAbilityConstants.js";

test("deterministisk: samme (role,tier,name) → samme profil", () => {
  const a = deriveStaffAbilities({ role:"training", tier:3, name:"Sofie Lindqvist" });
  const b = deriveStaffAbilities({ role:"training", tier:3, name:"Sofie Lindqvist" });
  assert.deepEqual(a, b);
});
test("overall ligger i tier-båndet", () => {
  for (const tier of [1,2,3,4,5]) {
    const p = deriveStaffAbilities({ role:"training", tier, name:"Test Navn" });
    const band = TIER_OVERALL_BAND[tier];
    assert.ok(p.overall >= band.lo - 3 && p.overall <= band.hi + 3, `tier ${tier} overall ${p.overall} uden for ${band.lo}-${band.hi}`);
  }
});
test("training-rollen har dimensioner + niveau-affiniteter i [1,99]", () => {
  const p = deriveStaffAbilities({ role:"training", tier:4, name:"A B" });
  for (const d of ["physical","mental","technical"]) assert.ok(p.dimensions[d] >= 1 && p.dimensions[d] <= 99);
  for (const l of ["youth","junior","senior"]) assert.ok(p.levels[l] >= 1 && p.levels[l] <= 99);
});
test("kontrast: en specialisering rager op (ikke flad profil)", () => {
  const p = deriveStaffAbilities({ role:"training", tier:5, name:"Spec Ialist" });
  const dims = Object.values(p.dimensions);
  assert.ok(Math.max(...dims) - Math.min(...dims) >= 10, "for flad — kontrast mangler");
});
```
- [ ] **Step 2:** Kør → FAIL.
- [ ] **Step 3: Implementér** — mulberry32(hashString(`${role}:${tier}:${name}`)); træk hver akse inden for tier-båndet; anvend kontrast-skew (spejl `abilityDerivation.js`-blokken, floor clamp) så én dimension + ét niveau rager op; `overall` = vægtet gennemsnit af de bærende akser. Rolle-skab per `STAFF_ROLES` (training: dimensions+levels; andre: rolle-akser). Returnér `{ role, tier, overall, dimensions:{physical,mental,technical}, levels:{youth,junior,senior}, roleSkills:{...} }`.
- [ ] **Step 4:** Kør → PASS. `npm test` grøn.
- [ ] **Step 5: Commit** — `feat(staff): staffAbilityDerivation — deterministisk evne-profil m. rolle-skew + kontrast (#2216 A4)`.

---

### Task 4: Migration — `staff_derived_abilities` (ejer-merge)

**Files:** Create `database/2026-07-05-staff-abilities.sql`.

Spejler `rider_derived_abilities`-mønsteret. **Denne task producerer KUN SQL-filen + en migration-idempotens-note; ejeren applier den.**

- [ ] **Step 1: Skriv migrationen:**
```sql
-- #2216 A4 — staff-evner (spejler rider_derived_abilities). Idempotent.
CREATE TABLE IF NOT EXISTS staff_derived_abilities (
  staff_id UUID PRIMARY KEY REFERENCES team_staff(id) ON DELETE CASCADE,
  overall SMALLINT NOT NULL CHECK (overall BETWEEN 1 AND 99),
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { physical, mental, technical } 1..99
  levels JSONB NOT NULL DEFAULT '{}'::jsonb,        -- { youth, junior, senior } 1..99
  role_skills JSONB NOT NULL DEFAULT '{}'::jsonb,   -- rolle-specifikke akser
  formula_version SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE staff_derived_abilities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_abilities_select_own ON staff_derived_abilities;
CREATE POLICY staff_abilities_select_own ON staff_derived_abilities FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM team_staff s JOIN teams t ON t.id = s.team_id
                 WHERE s.id = staff_derived_abilities.staff_id AND t.user_id = auth.uid()));
```
- [ ] **Step 2: Verificér idempotens** — `IF NOT EXISTS`/`DROP POLICY IF EXISTS` gør re-run sikker (matcher repoets migration-idempotency-guard). Kør migration-lint hvis den findes (`scripts/…migration-idempotency…`).
- [ ] **Step 3: Commit** (i EGEN commit, så ejer-merge-classifier fanger den) — `feat(db): staff_derived_abilities-tabel + RLS (#2216 A4) [ejer-merge]`.

---

### Task 5: Persistér evner ved ansættelse + expose i club-API (TDD)

**Files:** Modify `backend/lib/facilityService.js` (`hireStaff` → derive + insert abilities), `backend/lib/facilityRoutesHandlers.js` (GET facilities + ny GET `/api/club/staff/:id`), `backend/lib/staffCandidates.js` (kandidat får `overall` + top-specialisering til visning), + tests.

- [ ] **Step 1: Skriv fejlende tests** — `hireStaff` inserter en `staff_derived_abilities`-række (mock supabase); `generateStaffCandidates` returnerer nu `overall` + `topSpecialization` pr. kandidat; GET `/api/club/facilities` staff-objekt inkluderer `overall`; ny handler `getStaffProfileHandler({staffId})` returnerer fuld profil (role/tier/salary/abilities) eller 404.
- [ ] **Step 2:** Kør → FAIL.
- [ ] **Step 3: Implementér** — i `hireStaff`: efter staff-insert, `deriveStaffAbilities({role,tier,name})` + upsert til `staff_derived_abilities` (samme transaktion/rækkefølge). I `generateStaffCandidates`: berig med `overall` (fra derivation) + `topSpecialization`. Ny `getStaffProfileHandler` + route `GET /api/club/staff/:id` (requireAuth + ejerskab). Flag-gated som resten.
- [ ] **Step 4:** Kør → PASS. `npm test` grøn.
- [ ] **Step 5: Commit** — `feat(staff): persistér evner ved hire + expose overall/profil i API (#2216 A4)`.

---

### Task 6: Ability-drevet effekt-model + rating-løn (TDD)

**Files:** Modify `backend/lib/facilityEngine.js` (`staffEffectFactor` erstatter/supplerer `staffUtilization`; `effectiveBonus` bruger den), `backend/lib/facilityConstants.js` (rating-løn-kurve i stedet for/ud over `STAFF_SALARY_BY_TIER`), + tests. **Bevar bagud-kompat:** A3-UI + A1-service kalder `effectiveBonus(track, facilityTier, staffTier)` — behold en overload/adapter så eksisterende kald ikke breaker, men internt bruges overall.

- [ ] **Step 1: Skriv fejlende tests** — `staffEffectFactor(null)` = 0.5 (gulv, uændret); `staffEffectFactor({overall:99})` ≈ 1.0; monotont stigende i overall; `specializationMatch(staff, {dimension, level})` > 1 når chefens dimension+niveau matcher, = 1 for generalist-baseline; `staffSalaryFor(overall)` monotont stigende + i kalibrerings-bånd.
- [ ] **Step 2:** Kør → FAIL.
- [ ] **Step 3: Implementér** — `staffEffectFactor(staff)`: `staff==null ? 0.5 : 0.5 + 0.5 * (overall/99)` (kurve-parametre i konstant, harness-kalibreres). `specializationMatch(staff, {dimension, level})`: baseline 1.0 + vægtet bidrag fra `dimensions[dimension]` og `levels[level]` normaliseret (loftet). `staffSalaryFor(overall)`: monoton kurve (erstatter tier-tabel; behold `STAFF_SALARY_BY_TIER` som deprecated-fallback indtil A4b). Opdatér `effectiveBonus` til at tage staff-objekt (adapter for gammelt tier-kald).
- [ ] **Step 4:** Kør → PASS. Kør fuld `npm test` — **eksisterende facility-tests skal opdateres til den nye model, ikke svækkes**; verificér A3-UI-kontrakten (effectiveBonus-shape) stadig holder.
- [ ] **Step 5: Commit** — `feat(staff): ability-drevet effekt-model (staffEffectFactor + specializationMatch) + rating-løn (#2216 A4)`.

---

### Task 7: Training-effekt-hook i trænings-motoren (TDD, no-op uden staff)

**Files:** Modify `backend/lib/dailyTraining.js` (`dailyAbilityDelta` → ekstra `staffBonus`-led), + en tynd `staffTrainingBonus.js` (opslag: team's training-staff × rytterens dimension×niveau → multiplikator ≥ 1.0), + tests. Study-first: LÆS den faktiske `dailyAbilityDelta` + `dailyTrainingEngine.js` cap-loop.

- [ ] **Step 1: Skriv fejlende tests** — `staffTrainingBonus(null-staff, ...)` = 1.0 (nul regression); en Fysisk-Youth-coach giver >1.0 for en ung rytters *fysiske* evne, = 1.0 for hans *mentale* evne (dimension-target) og for en senior-rytter (niveau-target); bonussen hæver `dailyAbilityDelta` proportionalt MEN gains overstiger ALDRIG `ability_caps` (cap-respekt — test med rytter nær cap: delta klippes af cap-loopet, ikke af bonussen).
- [ ] **Step 2:** Kør → FAIL.
- [ ] **Step 3: Implementér** — `staffTrainingBonus({ facilityTier, staff, ability, riderLevel })`: 1.0 hvis ingen staff/flag off; ellers `1 + k · specializationContribution(staff, dimensionOf(ability), riderLevel) · facilityScale(facilityTier)`. I `dailyAbilityDelta`: gang ét ekstra led ind i kæden (før/efter `bonus`-clicket, dokumentér rækkefølge). **KRITISK:** bonussen ændrer KUN daglig delta; cap-loopet i `dailyTrainingEngine.js` klipper stadig ved `ability_caps` → caps udvides aldrig. Bevis i test.
- [ ] **Step 4:** Kør → PASS. **Non-regression:** kør en dailyTraining-fixture UDEN staff → bit-identisk med baseline (gem before/after). `npm test` grøn.
- [ ] **Step 5: Commit** — `feat(staff): training-effekt-hook (dimension×niveau, kun under caps, no-op uden staff) (#2216 A4)`.

---

### Task 8: Harness — genkør + udvid + kalibrér (simulér-før-ship)

**Files:** Modify `backend/scripts/lib/facilityInvestmentModel.js` (ny effekt-model: staffFactor+specialization erstatter util-skalar), `backend/scripts/facilityInvestmentScorecard.js` (ny gate: specialiserings-balance), + kør `inflationScorecard` + `moneySupplyScorecard --synthetic-only` + `prizeDistributionScorecard`. Opdatér `docs/audits/2026-07-05-facility-investment-calibration.md` (eller ny A4-audit).

- [ ] **Step 1:** Opdatér modellen til at bruge `staffEffectFactor`/`specializationMatch`/`staffSalaryFor` (importér fra prod som co-SSOT, som A2). Tilføj **specialiserings-balance-gate:** generalist- OG specialist-strategier konkurrencedygtige inden for ±10% (ingen enkelt-specialisering dominant).
- [ ] **Step 2: Kalibrér** — kør scorecardet; juster `staffFactor`-kurve + `staffSalaryFor` + specialiserings-vægt til ALLE gates grønne (anti-optimal-path + payback + tid-som-valuta + relevans + specialiserings-balance). Empirisk søgning som A2 (scratch, ikke committet); afrund til rene tal.
- [ ] **Step 3: Non-regression** — `moneySupplyScorecard --synthetic-only` grøn (D1 +3.557 / D2 +13.557 / D3 +8.557); `prizeDistributionScorecard` Gini uændret; grep-bevis at fresh-harness ikke importerer de nye staff-konstanter.
- [ ] **Step 4:** Skriv audit-rapporten (ærlige marginer, antagelser, følsomhed — som A2-audit). Kør `pwsh scripts/verify-local.ps1` → exit 0.
- [ ] **Step 5: Commit** — `feat(economy): A4 harness — ability-drevet effekt kalibreret, alle gates grønne + audit (#2216)`.

---

### Task 9: Flag-migration til app_config (ejer-merge) + PR

**Files:** Create `database/2026-07-05-facilities-flag-appconfig.sql` (seed `facilities_enabled` app_config-række = false), Modify backend flag-læsning (`facilityConstants.FACILITIES_ENABLED` → runtime `app_config`-opslag med konstant som fallback-default), Modify `useFacilities`/handlers hvis nødvendigt (frontend gater stadig på 403). Study-first: LÆS hvordan `academy_enabled` læses runtime.

- [ ] **Step 1:** Migration: `INSERT ... ON CONFLICT DO NOTHING` app_config `facilities_enabled=false`. Backend: læs flaget runtime (spejl academy) — default false. Instant SQL-flip muligt efter merge.
- [ ] **Step 2:** Tests: flag off (default) → 403 som før; injiceret on → aktiv. `npm test` grøn.
- [ ] **Step 3: Commit** (egen commit, ejer-merge) — `feat(economy): migrér FACILITIES_ENABLED til app_config (instant flip) (#2216 A4) [ejer-merge]`.
- [ ] **Step 4: PR** — push; PR-body fra template + Brugerverifikation (backend-only + harness-bevis; UI-profil er A4b) + "ingen patch note (flag-gated, profil-UI følger i A4b)" + **migration-note: ejer merger**. `Refs #2216`.

---

## Self-review (mod spec §1/§2/§6/§7)

- §1 ability-model (dimension×niveau, rolle-skew, kontrast, retired-kompat): Task 2/3. ✅
- §2 ability-drevet effekt (staffFactor+specialization) + rating-løn (Q1): Task 6. ✅
- §2 training-hook (dimension×niveau, kun under caps): Task 7. ✅
- §6.1 migration (staff_derived_abilities, RLS): Task 4. §6.4 harness: Task 8. §6.5 flag→app_config: Task 9. ✅
- §7 gates (fresh/Gini/anti-optimal/relevans/specialiserings-balance): Task 8. ✅
- retired-rytter-kompat (§1.3): evne-strukturen (dimensions afledt af kategori-styrker) er mappe-kompatibel — pipeline i #2218.
- **A4b (frontend profil-side, klikbar, kandidat-sammenligning, cost-strip): SEPARAT PLAN** efter A4a-backend er grøn.

**Placeholder/type-konsistens:** staff-profil-objektet `{role,tier,overall,dimensions,levels,roleSkills}` er identisk i Task 3 (derivation), Task 4 (SQL JSONB), Task 5 (API), Task 6 (effekt), Task 7 (træning). `effectiveBonus`-adapteren bevarer A3-UI-kontrakten.
