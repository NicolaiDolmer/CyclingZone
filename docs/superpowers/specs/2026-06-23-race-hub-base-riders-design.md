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
6. **Antal N = 12** (4 unge + 4 kerne-dom + **4 hale-dom**), **hale-vindue [50,52]** (top-evner ~7). Valgt af ejer 2026-06-23 fra sim-scorecardet (§6).
7. **Top-up dækker ALLE eligible konkurrerende hold** (27 managere + 141 AI; 0 bank), ikke kun managere — så overlap-løb har fulde modstander-felter. Ejer-valg 2026-06-23.

## 3. Trup-struktur

Hver trup = **4 unge** [50,57] + **4 kerne-domestiques** [50,57] + **hale på 4 ekstra-svage domestiques** i vindue [50,52].

Konstanter afkobles fra `MIN_RIDERS_FOR_RACE`:
- `STARTER_SQUAD.CORE_SIZE = 8` (4 unge + 4 kerne-dom — uændret kerne).
- `STARTER_SQUAD.TAIL_SIZE = 4` (ny — den svage hale; `0` reproducerer nuværende adfærd).
- `STARTER_SQUAD.TOTAL_SIZE = 12` (= CORE_SIZE + TAIL_SIZE; afløser `SQUAD_SIZE` for total-trup; alle interne brug opdateres).
- `STARTER_TAIL_STAT_WINDOW = { lo: 50, hi: 52 }` (ny — lavere end `STARTER_POOL_STAT_WINDOW = [50,57]`).
- `MIN_RIDERS_FOR_RACE` (8) forbliver løbs-reglen.

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
- **Selector = ALLE eligible konkurrerende hold** (ikke-test, ikke-frosset) — managere **OG** AI (verificeret 0 bank-hold). Ejer-valg 2026-06-23: AI-felter skal også fyldes så overlap-løb har modstandere. (Bemærk: afviger fra relaunchens `getBetaManagerTeams`, som er manager-only.)

## 6. Simulering (simulér-før-ship — UDFØRT 2026-06-23)

Harness: `backend/scripts/dev/simulate-base-rider-depth.mjs` (read-only, søsker til `simulate-overlap-fill.mjs`). Modellerer top-up'en in-memory: top hvert eligible hold op til N med friskt-genererede hale-ryttere (`buildWeakStarterPool` + pure `deriveAbilities`-fallback, ingen DB-writes), kør `assignTeamAcrossRaces` mod overlap-kalenderen (tracks=2), sweep N × hale-vindue. Fyldning er antals-/binding-drevet (autopick `.slice(0,max)`, ingen kvalitets-tærskel) → window-uafhængig; kun styrke-spredning afhænger af vinduet.

**Resultat (målt på ægte manageres egne felter):**
- Baseline (intet top-up): 54 % fuldt, 8 % forceret no-show.
- **N=12: 100 % fuldt, 0 forceret no-show** (knæk-punkt 6+6; N=8/10 = 62 %; N=14/16 tilføjer intet til deltagelse men udvasker valget).
- Felt-styrke @ N=12 p10/p50/p90: [50,57] 11.6/18.7/22.6 (for stærk) · [50,54] 10.3/17.2/19.9 · **[50,52] 8.5/15.8/19.9** (skarpest trade-off, valgt).

Sæson 1 er 61 ProSeries + 1 GiroVuelta → mest min-6 → N=12 robust for denne sæson; konstanten er tunbar for fremtidige tungere klasse-mix. "Fuldt" (≥ `min`) = kan stille *lovligt* hold; opportunity cost ligger i kvalitet (overflow-løb kører på hale-dregs, p10 8.5), ikke deltagelse.

**Valgt:** N=12, hale-vindue [50,52], top-up af alle eligible hold.

## 7. Økonomi-sanity

Top-up (alle ~168 hold op til 12) + dybere start-trup tilføjer op til ~4 × 168 ≈ 670 billige ryttere til økonomien. `backend/scripts/moneySupplyScorecard.js` + `prizeDistributionScorecard.js` antager 8-trup. Flag + verificér effekten er negligibel (hale-ryttere base_value ~7k, lav løn) + opdatér deres antagelses-kommentarer/konstant-reference.

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
