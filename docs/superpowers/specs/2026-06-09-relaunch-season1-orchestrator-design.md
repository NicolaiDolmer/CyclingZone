# Design — Relaunch-orchestrator + founder-badge + starthold (#1103)

**Dato:** 2026-06-09
**Issue:** [#1103](https://github.com/NicolaiDolmer/CyclingZone/issues/1103) · Epic [#1105](https://github.com/NicolaiDolmer/CyclingZone/issues/1105)
**Status:** Design godkendt (komponent-vis via AskUserQuestion 2026-06-09). Afventer spec-review før implementeringsplan.
**Hård gate:** #1101 base_value-cutover (ejer-verifikation) blokerer den *rigtige* prod-relaunch — ikke dry-run.

## Formål

20/6 = hard reset til en frisk, juridisk uafhængig sæson 1. Alle legacy-ryttere (rigtige navne, `pcm_id IS NOT NULL`) pensioneres; kun fiktive ryttere er aktive. Brugerkonti bevares — kun game-state nulstilles. Beta-testere får et permanent founder-badge. **Nyt ift. oprindeligt issue:** managers starter ikke med tom trup, men med et løbsklart starthold (koldstart-fix + læner sig ind i progression-kernen #1136).

`backend/scripts/relaunchSeason1.js` (ny) er en dry-run-default orchestrator der *komponerer* eksisterende, verificerede byggeklodser.

## Runtime-evidens (verificeret 2026-06-09)

Prod-state ved design-tid: **18 rigtige managers**, 25 fiktive ryttere (puljen ikke genereret endnu), 8.969 legacy PCM-ryttere. Med kun 18 managers er 800-puljen ingen begrænsning for startholds-allokering.

| Byggeklods | Fil | Status |
|---|---|---|
| Beta-reset | `backend/lib/betaResetService.js` — `runFullBetaReset()` | ✅ verificeret |
| Launch-population (seed 2026, count 800) | `backend/lib/fictionalLaunchPopulation.js` — `generateLaunchPopulation()` | ✅ |
| Fiktiv generering + insert + prod-deny | `backend/scripts/generateFictionalRiders.js` (`--apply`-mønster) | ✅ |
| Physiology + abilities backfill | `backend/scripts/backfillRacePhysiology.js` (`seedPhysiologyFromLegacy` + `deriveAbilities`) | ✅ (CLI-formet) |
| Rytter-typer backfill | `backend/scripts/backfillRiderTypes.js` | ✅ (CLI-formet) |
| base_value backfill (SHADOW) | `backend/scripts/backfillRiderBaseValue.js` | ✅ (CLI-formet) |
| Sæson-transition | `backend/lib/seasonTransition.js` — `transitionToNextSeason()` (0→1-specialsti) | ✅ |

## Orchestrator-sekvens

1. **Pensionér legacy-ryttere** — `UPDATE riders SET is_retired=true, team_id=null WHERE pcm_id IS NOT NULL`. Bevares for historik/rollback. *(net-ny logik)*
2. **Nulstil game-state** — `runFullBetaReset()`. Marked, rosters, balancer, board, race-kalender, sæsoner, manager-progress, achievements.
3. **Generér fiktiv population** — `generateLaunchPopulation()` (seed 2026, 800) + batch-insert. Pre-flight: hver payload `pcm_id === null`. Navne-unikhed mod resterende DB-navne.
4. **Backfill-kæde** — physiology+abilities → typer → base_value (SHADOW). Kører via nye importérbare lib-funktioner (se Beslutning ①).
5. **Allokér startholds** — hver af de aktive managers får en løbsklar trup på 8, stratificeret-lige fra puljen (se Starthold-design).
6. **Opret frisk sæson 1** — genindsæt sæson 0 → `transitionToNextSeason()` 0→1 (se Beslutning ②).
7. **Tildel founder-badge** — ny `founder_badge` achievement-def + INSERT i `manager_achievements` pr. beta-tester; undtaget fra fremtidig reset (se Net-nye stykker).

## Beslutninger (godkendt 2026-06-09)

### ① Backfill-kæde → ekstrahér til lib-funktioner
De 3 backfill-scripts er CLI-formede (egen env-klient, in-memory pool-building til percentil-skalering, `process.exit`). Kernelogikken ekstraheres til importérbare funktioner (fx `runPhysiologyBackfill(supabase, {dryRun})`); CLI'erne bliver tynde wrappers. Ét sandhedssted, ingen duplikering, ingen skrøbelig child-process-shelling. **Koster:** refaktor af 3 scripts (med forward-guard at CLI-output er uændret).

### ② Sæson-1-row → genindsæt sæson 0 → transition 0→1
`transitionToNextSeason()` har en eksplicit sæson-0→1-specialsti (springer `processSeasonEnd` over, sponsor-modifier=1.0 fredet by-design, opretter transfer_window + board-baseline + admin_log). Reset (trin 2) sletter alle sæsoner, så orchestratoren genindsætter sæson 0 og kører transition. Genbruger den motor der kørte fejlfrit ved #1155 (sæson 1→2). **Orthogonalt fra startholds** — dette er kun kalender-/standings-containeren.

### ③ Prod-guard → én orchestrator, lagdelt prod-opt-in
Dry-run-default. Prod kræver `--apply` + eksplicit `--target-prod` + typed bekræftelse, og dry-run-summary vises *før* prod røres. Kopierer `PROD_PROJECT_REF`-deny-mønstret fra `generateFictionalRiders.js`, men som allowlist-gate frem for permanent deny (launch-dagen skal være repeterbar + auditbar).

## Starthold-design (ny scope)

**Beslutning:** Hybrid løbsklar trup. Hver aktiv manager får **8 ryttere** = ~4 unge (18-21, højt potentiale) + ~4 domestiques. `MIN_RIDERS_FOR_RACE = 8`, så holdet kan stille op til løb fra dag 1 → koldstart løst. Auktionen bliver dybde/opgradering frem for byg-fra-nul. Unge fyre at udvikle læner sig ind i progression-kernen ([#1136](https://github.com/NicolaiDolmer/CyclingZone/issues/1136)).

**Defaults (åbne for spec-review):**
- **Split:** 4 unge + 4 domestiques pr. hold.
- **Kilde:** startholdene tages *fra* de 800 (én verden). 18 × 8 = 144 forhåndstildelt → 656 til markedet.
- **Fairness:** stratificeret-lige — alle hold ~lige stærke; **ingen** får en stjerne/solid (top af pyramiden bliver i markedet og vindes i auktionen).
- **Determinisme:** allokering seeded (reproducerbar) så dry-run = rigtig kørsel.

## Net-nye stykker

1. **Population-swap** (trin 1) — triviel bulk-UPDATE; ikke-destruktiv (bevarer rows).
2. **Startholds-allokering** (trin 5) — seeded, stratificeret fordeling fra puljen til `MIN_RIDERS_FOR_RACE`. Bruger samme manager-selector som reset (`getBetaManagerTeams`: `is_ai=false, is_bank=false, is_frozen=false, is_test_account=false`).
3. **`founder_badge`** (trin 7) — ny achievement-def + INSERT pr. beta-tester (samme selector). `resetBetaAchievements()` ([betaResetService.js:389](../../../backend/lib/betaResetService.js)) sletter i dag **alle** `manager_achievements` ubetinget — modificeres til at undtage `founder_badge` (lille ændring i delt reset-funktion → kræver forward-guard test).

## #1101-gaten (vigtigst)

`backfillRiderBaseValue.js` skriver base_value som **SHADOW** — kolonnen er ikke wired ind i price/market_value/salary før #1101 slice 2-cutover, som er blokeret på ejer-verifikation af shadow-værdier. Konsekvens: dry-run af #1103 kan køres når som helst; den *rigtige* relaunch hvor markedet bruger base_value kan ikke ske før #1101-cutover er kvitteret. #1103 og #1101 er koblede.

## Verifikationssti

Kør hele sekvensen på preview-DB (dry-run → rigtig). Verificér:
- Sekvensen kører end-to-end: reset → population → backfills → startholds → sæson 1.
- Ingen legacy (`pcm_id IS NOT NULL`) aktive; kun fiktive i markedet.
- Hver manager har præcis 8 ryttere, ~lige stærke hold, ingen stjerne forhåndstildelt.
- Founder-badge tildelt alle beta-testere + overlever en efterfølgende reset.
- Brugerkonti bevaret (kun game-state nulstillet).
- Rollback-sti dokumenteret (legacy kan re-aktiveres: `is_retired=false`).

## Testing / forward-guards

- Unit: startholds-allokering (deterministisk, 8 pr. hold, ingen stjerne, fairness-spænd).
- Unit: `resetBetaAchievements` undtager `founder_badge`, sletter alt andet.
- Unit: backfill-lib-funktioner giver samme output som de gamle CLI'er (regression-guard på refaktoren).
- Integration: dry-run-summary mod preview-DB matcher faktisk kørsel.

## Åbne punkter til implementeringsplanen

- Eksakt rækkefølge population vs. physiology-backfill (abilities kræver stats før derive).
- Hvordan startholds-fairness måles/asserteres (samlet base_value-spænd pr. hold?).
- Om sæson 0 skal have en transfer_window for at 0→1-transition kører rent.
