# Værdimodel: rytterværdi følger udviklede evner (#1364) — design

- **Dato:** 2026-06-13
- **Status:** Godkendt (ejer-go på design 2026-06-13)
- **Issue:** [#1364](https://github.com/NicolaiDolmer/CyclingZone/issues/1364) (priority:high, slice:tdf-launch, epic:progression)
- **Relaterer:** #1308 (akademi — forretningsmodel-blocker), #1101 (`base_value`-model), #1281 (markeds-glidning mod handelspris), #1305 (daglig træning — udviklings-kilde).
- **Type:** Balance-følsom spil-økonomi-feature → **simulér-før-ship**.

## 1. Problem

Ejer-besluttet 13/6: **en rytters værdi skal stige når hans evner stiger.** Det er den økonomiske forudsætning for akademiets kerne-fantasi ("udvikl-og-sælg" / "vær bedst til at udvikle talent", #1308). I dag er `base_value` **frosset**: den backfilles én gang ved relaunch fra værdimodellen (#1101) og genberegnes IKKE når evner udvikles. Så stiger en rytters værdi kun via præmiepenge (race-resultater) — ikke via udviklede stats — og akademiet bliver en fælde-option.

**Verificeret nuværende tilstand (kode-gennemgang 13/6):**
- `database/schema.sql`: `market_value` er GENERATED: `COALESCE(base_value, 1000) + prize_earnings_bonus`.
- `backend/lib/riderValuation.js`: `predictBaseValue(rider, abilities, model)` er en **ren funktion** af aktuelle evner + primær type (+ milde alders-/potentiale-led). Vægter primært current stats (akademi-noten: youth-værdi ~11k netop fordi modellen kun ser current stats).
- `base_value` skrives kun ved relaunch-backfill (`backend/lib/backfillCores.js` → `runBaseValueBackfill`) — ingen genberegning ved evne-ændring.

## 2. Beslutninger (brainstorm 13/6)

**Værdi-arkitektur = Model 1 (objektiv rating).** Værdi er en live-aflæsning af modellen på aktuelle evner — ikke ét lagret tal med hukommelse. Konkret:

```
market_value  = base_value + prize_earnings_bonus            (uændret, GENERATED)
base_value    = predictBaseValue(rider, aktuelle evner, model)   (genberegnes når evner ændrer sig)
[fremtid #1281: en SEPARAT markeds-præmie oven på, ikke samme tal]
```

Fordi `base_value` altid er det rene model-output for de aktuelle evner, **driver den aldrig** og kan ikke blive "skæv" af gentagne genberegninger (det ville en glidende tal-model kunne — derfor blev Model 2 fravalgt).

**Genberegnings-mekanik = A+B-blanding:**
- **Trigger (A, event-drevet):** kun ryttere hvis **heltals**-evne faktisk ændrer sig markeres til genberegning. Evner er heltal (0-99); daglig træning ophober brøkdel-progress, og heltallet krydser kun lejlighedsvis. Vi trigger på heltals-krydset — **ikke** på den daglige brøkdel (ingen daglig churn, ingen sub-heltals-jitter).
- **Eksekvering (B, batchet):** ét samlet recompute-pass i slutningen af den daglige trænings-sweep (`trainingSweep.js`, som allerede kører + allerede genberegner afledte evner). Ingen per-rytter-skrivninger i hot-path.
- **Sikkerhedsnet (B, sjælden fuld reconcile):** et lavfrekvent fuldt recompute (ved sæson-tick) der fanger evne-ændringer udenom den normale sti (admin-edits, aldring) og garanterer at `base_value` aldrig driver fra `model(aktuelle evner)`.

**Symmetri:** modellen har milde alders-/potentiale-led, så genberegning betyder også at værdi falder mildt når en aldrende rytter daler — den realistiske "sælg før forfald"-spænding. Dominerende signal er stadig evner.

**Hvem:** alle ryttere (også AI-ejede + frie), så markeds-/auktionsværdier er konsistente (auktions-AI-cap = 110 % af `base_value` osv. skal se en konsistent værdi).

## 3. Arkitektur & komponenter

### 3.1 Delt recompute-funktion
En ny lille funktion (genbruger eksisterende kæde), fx i `backend/lib/backfillCores.js` eller en ny `backend/lib/riderValueRefresh.js`:
- `recomputeBaseValue(riderRow, abilities, baseline, model) → number` — tynd wrapper om `computeRiderTypes` (for `primary_type`) + `predictBaseValue`. Samme kæde som relaunch-backfill og `fictionalPopulationPreview`, så preview/relaunch/live-refresh giver identiske tal.

### 3.2 Event-trigger i træning/progression
`backend/lib/trainingSweep.js` / `riderProgressionEngine.js` genberegner allerede afledte evner pr. trænet rytter. Tilføj:
- For hver rytter: sammenlign heltals-evner FØR vs EFTER. Hvis mindst én ændrede sig, læg rytteren i et `valueDirty`-sæt.
- Efter sweep'ens evne-skrivninger: ét batch-pass der for hver dirty rytter genberegner `base_value` og skriver kolonnen (`market_value` følger via GENERATED).

### 3.3 Sikkerhedsnet (fuld reconcile)
Ved sæson-tick (eller et lavfrekvent job): kald den eksisterende `runBaseValueBackfill(supabase)` (allerede idempotent + deterministisk) for hele populationen. Fanger enhver drift. Ingen ny mekanik — genbrug.

### 3.4 Ingen migration
`base_value`/`market_value`-kolonnerne findes. Dirty-detektion sker in-memory i sweep'en (ingen ny kolonne). **Ingen `database/*.sql` i denne slice.**

## 4. Interaktion med #1281 (markeds-glidning)
Under Model 1 må #1281 IKKE glide `base_value` selv (den ville snappe tilbage til model-værdien ved næste evne-ændring). #1281 skal i stedet glide en **separat markeds-præmie-komponent** oven på. Denne slice bygger IKKE #1281; den efterlader blot plads (rører ikke nogen præmie-komponent) og noterer reglen, så #1281 designes korrekt bagefter.

## 5. Balance / simulér-før-ship (acceptance-krav)
Harness der udvider `backend/scripts/previewRiderProgression.js`: kør progressions-motoren over N sæsoner på de 800 fiktive ryttere og lever et **scorecard** (ejer godkender FØR ship):

1. **Udvikl-og-sælg-P&L:** for en repræsentativ ung prospect — værdi-gevinst over en udviklings-periode vs. omkostningen at udvikle ham (akademi-drift + løn + evt. signing). Skal være net-positiv nok til at akademiet er attraktivt, men ikke dominerende (jf. spec afsnit 13 balance-gates, #1308).
2. **Ingen runaway-inflation:** populationens samlede/median `base_value` over sæsoner — skal være bundet (loftet af evne-cap 99 + udviklings-tempo), ikke eksponentielt voksende.
3. **Symmetri-sanity:** aldrende/dalende ryttere taber værdi.
4. **Trajectory-eksempler:** ung udvikler stiger, veteran daler — vist som konkrete kurver/tal.

## 6. Rollout / flag
Ingen separat flag. Genberegningen trigges af træning, som er flag-gatet (`daily_training_enabled`) og først ON ved relaunch. Pre-relaunch (træning OFF) ændrer ingen evner sig via træning → `base_value` står stille → at merge dette nu er dvalende og sikkert. Ved relaunch backfilles `base_value` frisk, og recompute aktiveres naturligt med træningen. **Ship er dog gated på ejer-godkendt sim-scorecard** (balance-følsomt).

## 7. Non-goals
- Ikke re-fitte selve værdimodellen (#1101/#1194).
- Ikke bygge #1281's markeds-præmie.
- Ikke ændre akademi-økonomi-konstanter (drift/signing/løn — #1308-tunet; hvis sim viser P&L ikke hænger sammen, surfaces det som ejer-beslutning, ikke en model-ændring her).
- Ingen UI-"din rytter steg i værdi"-notifikation (mulig fast-follow for feedback-loop-feel).

## 8. Test-strategi
- **Unit:** `recomputeBaseValue` (samme output som relaunch-kæden for given evne-vektor). Dirty-detektion: heltals-ændring → dirty; kun brøkdel-ændring → ikke dirty.
- **Integration:** trænings-sweep der hæver en evne et heltal → `base_value` opdateres i samme cyklus; brøkdel-tick → ingen skrivning.
- **Sim:** scorecard-harness (afsnit 5) — kørbar + deterministisk.
- **Pre-flight:** fuld CI-gate-sæt før PR.

## 9. Åbne punkter (fast-follow)
- #1281 markeds-præmie-lag (separat komponent).
- Model re-fit på renere relaunch-data (#1194).
- UI-værdistignings-signal til ejeren af rytteren.
