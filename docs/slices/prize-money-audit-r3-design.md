# Design · R3 — Rytter-værdier opdateres ved præmie-udbetaling (progress-vægtet gennemsnit)

**Issue:** [#895](https://github.com/NicolaiDolmer/CyclingZone/issues/895) · **Epic:** [#893](https://github.com/NicolaiDolmer/CyclingZone/issues/893) · **Slice:** [`prize-money-audit.md`](prize-money-audit.md)

**Status:** 🆕 Design (ingen kode endnu — afventer ejer-godkendelse af §4 + §5).

**Ejer-beslutning (AskUserQuestion 2026-06-01):** vægtning af aktiv sæson = **progress-vægtet divisor** (aktiv sæson tæller som sin fremgangs-brøk i nævneren — ingen kunstig dyk når ny sæson starter, glider sømløst over i "fuld sæson" ved sæson-slut).

---

## 1. Mål (genopfriskning)

I dag genberegnes rytter-værdier **kun ved sæson-slut**: `updateRiderValues` ([economyEngine.js:1146](../../backend/lib/economyEngine.js)) kaldes fra `processDivisionEnd` og snitter `race_results.prize_money` pr. rytter over op til **3 seneste `completed` sæsoner**.

Ønske (R3): værdierne skal genberegnes **i samme øjeblik admin udbetaler præmier** (`paySeasonPrizesToDate` i [prizePayoutEngine.js:106](../../backend/lib/prizePayoutEngine.js)), så den **aktive** sæsons præmier tæller løbende — uden at lægges oveni som en ekstra fuld sum (behold gennemsnits-modellen).

Værdi-/løn-formlen er **uændret** og rører jeg ikke: `market_value = max(5, uci_points) × 4000 + prize_earnings_bonus`, `salary = round(market_value × 0.10)` (GENERATED kolonner). R3 ændrer **kun** hvordan `prize_earnings_bonus` udregnes, og **hvornår** den genberegnes. `uci_points` forbliver ekstern (Google Sheets).

---

## 2. Hvad findes allerede (verificeret i kode 2026-06-01)

| Byggesten | Kilde | Note |
|---|---|---|
| Snit-logik pr. rytter pr. sæson | `updateRiderValues` (economyEngine.js:1146-1224) | Summerer `prize_money` pr. `rider_id` **uden** team-filter → fri/AI tæller med. |
| Sæson-fremgang | `seasons.race_days_completed` / `seasons.race_days_total` | #804. `race_days_total` default 60. `race_days_completed` = SUM(stages) over `completed` løb — idempotent, selv-helende ([seasonRaceDays.js](../../backend/lib/seasonRaceDays.js)). |
| Aktiv sæson | `seasons WHERE status='active'` (`.maybeSingle()`) | Præcis 0 eller 1 aktiv sæson. |
| Udbetalings-entrypoint | `paySeasonPrizesToDate` (prizePayoutEngine.js:106) | Admin-trigger, sjælden → performance-budget rigeligt. |
| GENERATED salary/value | `database/2026-05-04-salary-generated-column.sql` | DB genberegner automatisk når `prize_earnings_bonus` opdateres. **Ingen migration nødvendig.** |

**Konsekvens:** R3 er en ren backend-logik-ændring i `updateRiderValues` + ét nyt kald i `paySeasonPrizesToDate`. Intet DB-skema, ingen frontend.

---

## 3. Fremgangs-mål

`progress(aktiv sæson) = clamp(race_days_completed / race_days_total, 0, 1)`

Begge felter findes på `seasons`. Race-days vælges frem for "antal løb" fordi det matcher præmie-kilden: et `completed` løb bidrager **både** med `prize_money` (tæller) **og** med sine race-days (fremgang/nævner). Ikke-completed løb har `prize_money = 0/null` og tæller 0 race-days → ekskluderes naturligt i begge ender. Tæller og nævner er dermed altid drevet af de samme løb → ingen skævhed.

---

## 4. Model (progress-vægtet gennemsnit)

**Vindue:** de **op til 3 nyeste sæsoner** efter `number` (faldende), hvor den aktive sæson (hvis nogen) optager den nyeste plads. Rullende vindue — ikke "3 completed + aktiv oveni".

**Vægt pr. sæson:**
- `completed` sæson → `w = 1`
- aktiv sæson → `w = progress` (§3)

**Bonus:**

```
prize_earnings_bonus = round( Σ earnings_s  /  max( Σ w_s , 1 ) )
```

hvor `earnings_s` = rytterens samlede `prize_money` i sæson `s` (rå sum, også den aktive sæsons partielle indtjening).

### 4.1 Hvorfor `max(…, 1)`-gulvet i nævneren

Ren progress-vægtning (`Σearnings / Σw`) kollapser til **annualisering** når den aktive sæson er den **eneste** sæson (ingen completed at ankre på): partiel indtjening divideret med lille fremgang → kæmpe ekstrapolering. Det er præcis den volatilitet ejer **fravalgte** ("annualiseret run-rate").

Det er ikke et hjørnetilfælde lige nu: beta kører **sæson 1**, så der er **0 completed sæsoner** at ankre på. Uden gulvet ville én tidlig sejr blæse værdien op.

Gulvet `max(Σw, 1)` løser det uden at bryde ejer-valget:
- **Anker findes** (≥1 completed) → `Σw ≥ 1` → gulvet bider aldrig → ren progress-vægtning (ejer-valget).
- **Kun aktiv sæson** → nævner = 1 → partiel indtjening tæller som en brøkdel af én fuld sæson (konservativt, ikke volatilt). Når sæsonen nærmer sig 100%, `progress → 1`, nævner → 1, og det konvergerer sømløst til "fuld sæson".

Gulvet er stadig en vægtet middelværdi (ikke "oveni som ekstra sum") → konsistent med gennemsnits-princippet.

> **⚠️ Judgment-call der kræver ejer-OK:** gulvet `max(Σw, 1)` er en forfining ud over det rene spørgsmål du svarede på. Det er den eneste vej til *både* progress-vægtning *og* ingen tidlig volatilitet (som du fravalgte). Veto i review hvis du hellere vil have ren `Σearnings/Σw` (volatil i sæson 1) eller fuld-divisor-fra-dag-1.

### 4.2 Eksempler

| Scenarie | Vindue (earnings, w) | Σearnings | max(Σw,1) | bonus |
|---|---|---|---|---|
| Anker + aktiv 10% | S1(100k, 1), S2-aktiv(8k, 0.10) | 108k | 1.10 | **98k** |
| Anker, ny sæson 0% | S1(100k, 1), S2-aktiv(0, 0.00) | 100k | 1.00 | **100k** (ingen dyk ✓) |
| Kun aktiv 10% (sæson 1, dagens beta) | S1-aktiv(8k, 0.10) | 8k | 1.00 | **8k** (konservativt, ikke 80k) |
| Sæson-slut (ingen aktiv) | S1(100k,1), S0(60k,1) | 160k | 2.00 | **80k** |

### 4.3 Bagudkompatibilitet

Når der **ingen aktiv sæson** er (fx kaldet fra `processDivisionEnd` ved sæson-slut), er alle vægte = 1 og `max(Σw, 1) = antal completed sæsoner` → formlen reducerer **bit-for-bit til dagens logik**. R3 er additiv: den eksisterende sæson-slut-sti opfører sig uændret.

---

## 5. Implementeringsplan (efter §4-godkendelse)

1. **`updateRiderValues` (economyEngine.js):**
   - Hent aktiv sæson (`status='active'`, `id, number, race_days_completed, race_days_total`) udover de op til 3 nyeste `completed`.
   - Byg det rullende 3-sæsoners vindue (aktiv + completed, sorter på `number` desc, slice 3).
   - Beregn `progress` for aktiv sæson; vægt completed = 1.
   - Udvid `race`-fetch til at inkludere den aktive sæsons løb (allerede grupperet pr. sæson via `raceSeasonMap`).
   - Erstat den nuværende lige-vægts-middelværdi med `Σearnings / max(Σw, 1)`.
   - Ingen ændring i PATCH-batch-skrivningen eller GENERATED-kolonner.
2. **`paySeasonPrizesToDate` (prizePayoutEngine.js):** efter udbetalings-loopet + `import_log`-insert, kald `updateRiderValues(supabase)`. Returnér evt. `riders_updated` i svaret til admin-UI'et (nice-to-have, ikke krav).
3. **Tests:** udvid `economyEngine`-tests med de 4 §4.2-scenarier (anker+aktiv, ny-sæson-0%, kun-aktiv-gulv, sæson-slut-bagudkompat). Verificér `max(Σw,1)`-gulvet eksplicit.
4. **Notering:** `GAME_INVARIANTS.md` (værdi-genberegnings-trigger: sæson-slut **+ præmie-udbetaling**) · `FEATURE_STATUS.md` hvis relevant.
5. **Patch notes:** intern/admin-ændring — vurder om den er brugerrettet (rytter-værdier kan ændre sig mellem sæsoner nu). Sandsynligt ja → kort note.

**Performance:** `updateRiderValues` er fuld-scan + batched PATCH pr. rytter, men kaldes kun ved admin-udbetaling (sjælden). Inden for budget (jf. issue).

---

## 6. Åbne punkter

- §4.1-gulvet (`max(Σw,1)`) — ejer-OK udestår.
- Skal admin-UI'et vise "X ryttere fik værdi opdateret" efter udbetaling? (Lav prioritet, kan udelades i v1.)
