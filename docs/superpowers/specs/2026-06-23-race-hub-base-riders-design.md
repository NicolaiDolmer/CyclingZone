# Race Hub — bund-rytter-dybde ("Fase 0c", design)

> **Status:** udkast til review · **Dato:** 2026-06-23 · Brainstormet datadrevet med ejeren.
> Forudsætning shippet: kalender-overlap ([`2026-06-23-race-hub-calendar-overlap-design.md`](2026-06-23-race-hub-calendar-overlap-design.md), PR #1814 merged, men ikke aktiveret). SSOT: [`2026-06-23-race-hub-redesign-design.md`](2026-06-23-race-hub-redesign-design.md) §6.5. Memory: [[project-race-hub-redesign]].

## 1. Formål

Overlap er bygget men **ikke aktiveret**: simuleringen viste at overlap uden dybere trupper giver kun **46 % fuldt hold / 24 % no-show** (mod sekventiel 71 %/11 %). Denne fase kalibrerer den eksisterende bund-rytter-mekanik (`starterSquadAllocator.js`) op, så hold *kan* dække overlappende løb men stadig har incitament til at bygge eget — så overlap + dybde kan aktiveres samtidig som én hel oplevelse.

## 2. Låste beslutninger (brainstorm 2026-06-23)

1. **Indgang (D1): kun udvid start-truppen.** Ingen nye markeds-/akademi-systemer. Auktion + akademi + træning forbliver det uændrede byg-selv-loft. Ren backend-fase.
2. **Styrke (D2): lagdelt.** Kerne i [50,57]; den ekstra hale i et lavere vindue → skarpere "nød-fyldere vs. kerne"-tekstur + stærkere upgrade-pres.
3. **Hale-sammensætning:** unge fast på **4** uanset N; *al* ekstra dybde er svage domestique-fyldere.
4. **Eksisterende live-hold toppes op nu** (engangs additiv top-up) så overlap er spilbart for sæson 1 straks.
5. **`MIN_RIDERS_FOR_RACE = 8` røres ikke.** Løbs-minimummet afkobles fra trup-størrelsen.
6. **Antal (N) + hale-vindue afgøres empirisk** af simuleringen (§5), ikke gættet. Ejer vælger fra scorecard-tabellen før commit.

## 3. Trup-struktur

Hver trup = **4 unge** [50,57] + **4 kerne-domestiques** [50,57] + **hale på (N−8) ekstra-svage domestiques** i et lavere vindue.

Konstanter afkobles fra `MIN_RIDERS_FOR_RACE`:
- `STARTER_SQUAD.CORE_SIZE = 8` (4 unge + 4 kerne-dom — uændret kerne).
- `STARTER_SQUAD.TAIL_SIZE = N − 8` (ny — den svage hale; `0` reproducerer nuværende adfærd).
- `STARTER_TAIL_STAT_WINDOW` (ny — lavere vindue end `STARTER_POOL_STAT_WINDOW = [50,57]`).
- `SQUAD_SIZE` udfases/omdøbes til `TOTAL_SIZE = CORE_SIZE + TAIL_SIZE`; alle interne brug opdateres.

Den eksisterende generator giver allerede 4 distinkte rytter-typer med variation inden for et vindue → naturlig spredning uden yderligere lag.

## 4. Allocator-ændringer (`backend/lib/starterSquadAllocator.js`)

1. **To-puljes generering.** `buildWeakStarterPool` kaldes to gange pr. call-site: kerne-pulje (CORE_SIZE × hold, vindue [50,57]) + hale-pulje (TAIL_SIZE × hold, hale-vindue). Begge derive's (data-hale-garanti uændret). Snake-draften balancerer fortsat på base_value.
2. **Allokerings-fordeling:** hvert hold får 4 unge + 4 kerne-dom (fra kerne-puljen) + TAIL_SIZE hale-dom (fra hale-puljen). Hale-ryttere er aldrig unge.
3. **Begge call-sites opdateres** — ellers får nye hold anden dybde end relaunch-hold:
   - `runStarterSquadAllocation` (relaunch-batch).
   - `insertWeakSquadForTeam` / `allocateStarterSquadForTeam` (single-team-signup). `insertWeakSquadForTeam` skal generere både kerne + hale.
4. **Invariant-test opdateres:** `starterSquadAllocator.test.js` asserter i dag `youth + dom = MIN_RIDERS_FOR_RACE` og `SQUAD_SIZE === MIN_RIDERS_FOR_RACE`. Skift til den nye struktur (kerne = 8, total = 8 + TAIL_SIZE; løbs-minimum forbliver 8).

## 5. Engangs dybde-top-up af eksisterende hold

Re-scheduling af live sæson 1 til overlap kræver at de nuværende hold har dybden nu. De har allerede passeret `starter_squad_allocated_at`. Derfor en separat, idempotent top-up:

- **Ny markør:** `teams.starter_depth_topped_up_at` (egen migration; markør = sandhed, ikke rytter-antal — samme anti-exploit-filosofi som #1563).
- **Additiv, ikke re-allokering:** for hvert hold med markør NULL, generér og tilføj **kun hale-domestiques** op til TOTAL_SIZE (giver aldrig gratis kerne-ryttere til hold der har solgt ned). Hold der allerede er ≥ TOTAL_SIZE: sæt blot markøren (no-op).
- **Insert-med-team_id** (intet orphan-vindue, samme mønster som `insertWeakSquadForTeam`) + derive-kæden + sæt markør.
- **Script:** `backend/scripts/dev/topup-starter-depth.mjs`, dry-run default (rapporterer hvor mange hold/ryttere der ville tilføjes), `--live` kræver ejer-go. Skriver til prod → **ejer merger PR'en / kører --live.**
- Samme manager-selector som relaunch (`getBetaManagerTeams`: ikke-AI/bank/frosset/test).

## 6. Simulering (simulér-før-ship — næste skridt)

Udvid `backend/scripts/dev/simulate-overlap-fill.mjs`. I dag måler den de *nuværende* rosters; den skal **modellere top-up'en in-memory**:

1. For hvert ægte (eligible) hold under N: top op med friskt-genererede hale-ryttere i hale-vinduet, derive **pure in-memory** (ingen DB-writes — find/genbrug den rene `deriveAbilities`-funktion fra derive-modulet; sim'en forbliver read-only).
2. Kør `assignTeamAcrossRaces` mod overlap-vinduerne (tracks=2) som nu.
3. **Sweep et grid:**
   - Trup-størrelse **N** ∈ {8 (baseline), 10, 12, 14, 16}.
   - Hale-vindue ∈ {[50,57] (uniform-kontrol), [50,54], [50,52]}.
4. **Scorecard pr. celle:** fuldt hold %, no-show %, styrke-spredning p10–p90, og holdstyrke i det *sekundære* overlap-løb (felt-kvalitet holder?).

**Mål:** løft 46 % fuldt → acceptabelt, sænk 24 % no-show, uden at felterne bliver for stærke eller for elendige. Peak-concurrency = 2 (verificeret); "fuldt hold" = ≥ `min` (6 for de fleste løb, 8 for grand tours) → ~12 (6+6) er det naturlige udgangspunkt, men træthed/binding æder af puljen → sim afgør 12 vs. 13-14.

**Output:** scorecard-tabel → **ejer vælger N + hale-vindue** før commit af de endelige konstanter.

## 7. Økonomi-sanity

Top-up + dybere start-trup tilføjer ~ (N−8) × 27 billige ryttere til økonomien. `backend/scripts/moneySupplyScorecard.js` + `prizeDistributionScorecard.js` antager 8-trup. Flag + verificér effekten er negligibel (hale-ryttere base_value ~7k, lav løn) + opdatér deres antagelses-kommentarer/konstant-reference.

## 8. Aktivering (ejer-go, alt sammen samtidig)

Når sim-tal er valgt og konstanter committet:
1. Allocator-ændring live (nye hold får dybden).
2. `topup-starter-depth.mjs --live` (eksisterende hold får dybden).
3. `reschedule-overlap.mjs --live` (sæson 1 → overlap; dry-run allerede verificeret ren: peak=2, 0 binding-konflikter).
4. Flip flag `auto_entry_generator_enabled` ON.
5. Patch note (en+da) + help/FAQ hvis mekanik ændrer sig for spilleren.

Alt sammen som én leverance → overlap + dybde går live som én hel oplevelse.

## 9. Afgrænsning (ud af scope)

- **Free agents / akademi-fødsel som ny dybde-kilde** (D1 fravalgt — loftet findes allerede).
- **Frontend-faserne 1-5** (Lag 1 trup-fordeling → Lag 3 taktik → andre divisioner) følger efter denne backend-fase.
- **Fuld fysiologi (#1021):** træthedens effekt forbliver lille indtil da.
- **Selve race-afviklingen:** uændret.

## 10. Test-strategi

- **Allocator-enheds-tests:** TAIL_SIZE=0 reproducerer nuværende output (regression); TAIL_SIZE>0 → hvert hold får 4 unge + 4 kerne + TAIL_SIZE hale-dom; hale-ryttere er aldrig unge; hale-evner < kerne-evner; determinisme (samme seed → samme trup); begge call-sites giver samme struktur.
- **Top-up-script:** dry-run-tal mod prod-klon/capture; idempotens (markør sat → no-op); additiv (rører ikke eksisterende ryttere); hold ≥ TOTAL_SIZE → no-op.
- **Sim-harness:** read-only mod prod (capture-mønster); scorecard-tal, ingen writes.
- Fuldt CI-gate-sæt før PR (verify-local + lint + i18n + warning-budget).

## 11. Risici

- **Prod-data-mutation (top-up):** riders insert + team_id (ikke schema bortset fra markør-kolonnen). Mitigering: dry-run-først, idempotent markør, insert-med-team_id (intet orphan-vindue), ejer-go, verificeret backup + PITR. **PR med `database/*.sql` (markør-migration) → ejer merger.**
- **For stærke/for svage felter:** sim måler styrke-spredning + sekundær-løbs-styrke før valg.
- **Begge call-sites drifter fra hinanden:** delt kerne + test der asserter samme struktur.
- **Loop-guard:** 2 CI-fails på samme symptom → STOP + spørg.
