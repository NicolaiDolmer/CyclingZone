# PCM + uci_points — permanent retirement plan

> **Status (2026-06-20):** Planlægnings-doc. Ejer-ønske 20/6: "alt gammelt med PCM/uci_points skal permanent ud på sigt — planlæg en løsning." Dette er den sekvenserede, gate-styrede vej dertil. **Intet slettes nu** ud over hvad WS2 Option B (#1595) allerede dækker (resultat-pipeline-fjernelse, selv gated). Hver gate har eksplicitte forudsætninger + verifikation; ingen gate fyres før dens forudsætninger er kode-/prod-verificerede.
>
> **Kilder:** [`specs/2026-06-19-forever-relaunch-readiness-design.md`](../specs/2026-06-19-forever-relaunch-readiness-design.md) §WS2 (Option B-erratum) · issue [#1595](https://github.com/NicolaiDolmer/CyclingZone/issues/1595) (Option B-beslutning) · kode-scan 2026-06-20 (verificeret mod `main`).
>
> **Vigtig korrektion (#1595):** Den oprindelige WS2-plan ("slet `stat_*` + pipeline helt") var faktuelt forkert. PCM efterlader **tre uafhængige legacy-spor** med hver sin LIVE-læser. De kan kun fjernes når deres respektive læser er erstattet. Denne plan adskiller dem.

---

## 0. Hvorfor PCM ikke bare kan slettes

PCM (Pro Cycling Manager) var den oprindelige data- og resultat-kilde. Tre artefakter overlever stadig i prod-koden, hvert med en LIVE læser — derfor er "slet PCM" ikke én handling, men tre gatede udfasninger:

| Spor | Artefakt | LIVE-læser (hvorfor det IKKE er dødt) | Gate |
|------|----------|----------------------------------------|------|
| **A** | 14 `riders.stat_*`-kolonner + `PRIMARY_STAT` | `abilityDerivation.js:213-217` læser `stat_ned`/`stat_bro`/`stat_fl`/`stat_ftr` **UBETINGET** → 5 tekniske/mentale evner (`descending`, `cobblestone`, `positioning`, `aggression`, `tactics`). `rider_physiology_profiles` har KUN watt-metrics. | **Gate A** (#1021) |
| **B** | `riders.uci_points`-kolonne | `boardIdentity.js:367` (`calculateRiderStarScore`) → `uciScore = uci_points / 4.5`, vægter 30% af rytterens star-score. #1208 kalder det "sidste funktionelle læser". | **Gate B** (#1208) |
| **C** | `pcm*.js` resultat-pipeline + `POST /admin/import-results-pcm` | Eneste manuelle løbsresultat-recovery-sti. WS1 Fase 3 stage-automatisering er MERGED men IKKE aktiveret på beta (#1596 afventer ejer-flag-flip). | **Gate C** (#1596) |

**Bemærk også `pcm_id`:** kolonnen er IKKE et dødt PCM-artefakt. `pcm_id IS NULL` er den live fiktiv-vs-ægte-diskriminator (`api.js`, `youthMarket.js`) og `pcm_id IS NOT NULL` driver legacy-pensioneringen i `legacyRiderRetirement.js`. `pcm_id` fjernes som et fjerde, sidste skridt (Gate D) — først når populationen er bevisligt 100% fiktiv efter forever-vinduet.

---

## 1. Den fælles forudsætning: forever-vinduet

Alle gates antager at det destruktive forever-reset (spec §8) er kørt, så populationen er 100% fiktive ryttere med fuld v2/v3-fysiologi-profil. FØR vinduet kan ingen `stat_*`-/`pcm_id`-sletning ske uden at brække eksisterende beta-ryttere. Denne plan er derfor primært en **post-forever oprydningsplan** — med undtagelse af Gate C's pipeline-del, som kan ske før vinduet (kun gated af WS1-bevis, ikke af reset).

---

## Gate A — `stat_*`-kolonner slettes (efter native fysiologi #1021)

### Hvad skal være sandt
1. **#1021 leverer skill-metrics i fysiologien.** I dag indeholder `rider_physiology_profiles` kun fysiske watt-metrics (`PHYS_ANCHORS`: ftp/vo2/sprint-power/aero/...). De 5 evner `descending`/`cobblestone`/`positioning`/`aggression`/`tactics` har INGEN fysiologisk kilde og hentes derfor fra `stat_ned`/`stat_bro`/`stat_fl`/`stat_ftr`. Gate A er først åben når #1021 (eller en efterfølger) tilføjer en native, ikke-PCM-kilde for disse 5 evner — fx terræn-/teknik-metrics på fysiologi-profilen eller et separat skill-felt.
2. **`abilityDerivation.js:213-217` er omskrevet** til at læse den nye kilde i stedet for `pcmFrac(riderRow.stat_*)`. Den fysiologi-løse fallback (linje 191-200, `PRIMARY_STAT`) fjernes samtidig — den er reelt død for forever-ryttere (alle har profil), men må ikke fjernes før den ubetingede skill-stat-læsning er erstattet.
3. **Hele populationen re-derives** mod den nye kilde, og evne-fordelingen er verificeret uændret nok til at value-modellen (`riderValuationModel.json`, fittet mod evne-fordelingen) ikke skal refittes — ELLER refit er planlagt som del af samme reset-vindue. **Dette er reset-krævende** (evne-ændring → base_value → market_value → økonomi).

### Hvad slettes
- Migration: `ALTER TABLE riders DROP COLUMN stat_ned, stat_bro, stat_fl, stat_ftr, stat_bj, stat_tt, stat_kb, stat_sp, stat_acc, stat_bk, stat_udh, stat_res, stat_mod, stat_prl;` (14 kolonner). **Ejer merger selv** (migration auto-applies i prod).
- `abilityDerivation.js`: `PRIMARY_STAT`-map (linje 93-100), `pcmFrac`-helper hvis ingen anden bruger, hele `else`-fallback-grenen (191-200), og skill-stat-læsningerne (213-217 → ny kilde).
- `economyBaselineSimulation.js:256` (selecter `stat_bj, stat_sp, stat_tt, stat_fl`) → opdatér select.
- Tilhørende GRANT-oprydning: `stat_*`-kolonne-privilegier på `riders`.

### Verifikation
- `node --test backend/` grøn (abilityDerivation-tests opdateret til ny kilde).
- Dry-run: re-derive hele populationen FØR migration, diff evne-fordeling pre/post, bekræft value-model-impact (simulér-før-ship, jf. memory `feedback_simulate_before_ship_balance`).
- Grep efter `stat_` i `backend/` returnerer 0 ikke-test-referencer efter omskrivning.
- Migration kørt mod PROD-klon (ikke frisk DB) — bekræft ingen "permission denied"/"column does not exist"-fejl i runtime-stier.

---

## Gate B — `uci_points`-kolonne droppes (efter boardIdentity-kalibrering #1208)

### Hvad skal være sandt
1. **#1208 er merged + deployet:** `boardIdentity.js:367` (`calculateRiderStarScore`) læser ikke længere `rider.uci_points`. Star-score skal genberegnes fra en levende kilde (fx `market_value` eller `popularity` alene — #1208 ejer designet). #1208-titlen bekræfter: `uci_points` er "sidste funktionelle læser".
2. **Ingen anden funktionel læser tilbage.** Verificér med grep (se nedenfor) at de resterende `uci_points`-referencer er enten (a) generator-skrivning (`fictionalRiderGenerator.js:393`, sætter en default-værdi), (b) allerede-døde sort-aliaser (`api.js:842` mapper `uci_points`-sort → `market_value`), (c) `boardConstants.js:185`-listen (bruges KUN som tie-break-felt-navn — fjernes med #1208 eller dokumentér), eller (d) test-fixtures. Skrive-only + døde aliaser blokerer ikke et column-drop, men ryddes i samme PR for renlighed.

### Hvad slettes
- Migration: `ALTER TABLE riders DROP COLUMN uci_points;` **Ejer merger selv.**
- `fictionalRiderGenerator.js`: fjern `uci_points`-generering (linje 381/393) + `tier.uci`-range i tier-config.
- `boardConstants.js:185`, `api.js:842`-sort-alias, `driftMonitor.js`/`economyBaselineSimulation.js`/`responseCacheLoadCheck.js`-selects + test-fixtures der sætter `uci_points`.
- `server.js:46`-kommentar + øvrige "frossen uci_points"-kommentarer opdateres/fjernes.

### Verifikation
- `grep -rn "uci_points" backend/` returnerer 0 funktionelle (ikke-kommentar, ikke-test) referencer efter PR.
- `node --test backend/` grøn (board-tests opdateret — fx `boardConsequences.test.js`/`boardEngine.test.js`-fixtures der i dag sætter `uci_points`).
- Star-score for et sample-hold er numerisk plausibelt efter #1208-kalibrering (board-legibility, jf. #1208 acceptance).

---

## Gate C — resultat-pipeline + `/admin/import-results-pcm` slettes (efter WS1 bevist på beta #1596)

### Hvad skal være sandt
1. **WS1 Fase 3 stage-automatisering er aktiveret på beta og bevist** (#1596): løb afvikles automatisk + præmier udbetales + sæson-skift kører ≥1 fuld cyklus uden manuel indgriben (forever-gate §6.1). Indtil da er `POST /admin/import-results-pcm` den ENESTE manuelle løbsresultat-recovery-sti — derfor må den ikke fjernes.
2. **`foldNameNordic`-afhængigheden er løst.** `pcmRiderMatcher.js` eksporterer `foldNameNordic`, som bruges af IKKE-PCM-kode: `academyIntake.js`, `fictionalRiderGenerator.js`, `relaunchOrchestrator.js`, `starterSquadAllocator.js`, `generateFictionalRiders.js`, `gateMutationAudit.js`. Før `pcmRiderMatcher.js` slettes, skal `foldNameNordic` (+ evt. `foldName`) flyttes til et neutralt navne-util-modul (fx `backend/lib/nameNormalization.js`) og importerne opdateres. **Dette flyt kan ske NU** (uafhængigt af gaten) for at af-koble den ikke-PCM-brug fra PCM-pipelinen.

### Hvad slettes (når begge forudsætninger er sande)
- `backend/lib/pcmResultsImport.js`, `pcmResultsParser.js`, `pcmTeamAliases.js`, `pcmRiderAliases.js` + `pcmResultsImport.test.js`.
- `pcmRiderMatcher.js` — KUN efter `foldNameNordic`/`foldName` er flyttet ud (se forudsætning 2); ellers bevares filen som ren navne-util eller omdøbes.
- `api.js`: import linje 221, hele `POST /admin/import-results-pcm`-handleren (~6172-slut), kommentar 3246.
- `audit-feature-liveness.js:228` (`"POST /admin/import-results-pcm"`-listing) + `adminRouteOwnership.test.js:24/34` (assertion på endpointets eksistens).
- Kommentar-referencer i `boardWeekendFinalization.js:5`, `raceRunner.js:11/473/528`, `raceResultsEngine.js:14`.

### Verifikation
- WS1-bevis dokumenteret (≥1 fuld auto-cyklus på beta uden manuel indgriben).
- `grep -rn "pcm" backend/` (case-insensitive) returnerer 0 referencer efter PR (på nær evt. bevidst bevarede historik-kommentarer).
- `node --test backend/` grøn (`adminRouteOwnership.test.js` opdateret til ikke at kræve endpointet).
- Backend-only-ændring → ingen patch note (intern admin-sti, aldrig spiller-rettet).

### Bemærkning: ingen `pcm*.js` er pt. provably orphaned
Kode-scan 2026-06-20 (grep af hele repo): alle 5 `pcm*.js`-filer er reachable — enten fra recovery-endpointet (`pcmResultsImport` → `pcmResultsParser`/`pcmTeamAliases`/`pcmRiderMatcher` → `pcmRiderAliases`) eller fra ikke-PCM-kode via `foldNameNordic` (`pcmRiderMatcher`). Derfor slettes INGEN `pcm*.js`-fil i WS2 Option B-PR'en (#1595). Først efter Gate C's to forudsætninger er opfyldt.

---

## Gate D — `pcm_id`-kolonne droppes (sidst, efter 100% fiktiv population)

### Hvad skal være sandt
1. **Forever-vinduet er kørt** og legacy-pensioneringen (`legacyRiderRetirement.js`, drevet af `pcm_id IS NOT NULL`) har kørt sin sidste gang. Efter vinduet er der ingen `pcm_id IS NOT NULL`-ryttere tilbage.
2. **Fiktiv-vs-ægte-diskriminatoren er erstattet.** `pcm_id IS NULL`-tjekket (`api.js`, `youthMarket.js`) skal erstattes af en eksplicit invariant/flag (fx en boolean `is_fictional DEFAULT true`, eller "alle aktive ryttere er fiktive post-forever"-antagelse hårdkodet). Gate D åbner først når dette tjek ikke længere afhænger af `pcm_id`.

### Hvad slettes
- Migration: `ALTER TABLE riders DROP COLUMN pcm_id;` **Ejer merger selv.**
- `legacyRiderRetirement.js` (hele filen — relaunch-pensioneringen er kørt for sidste gang) eller dens `pcm_id`-afhængige sti.
- `api.js`/`youthMarket.js`: `pcm_id IS NULL`-diskriminatorer → erstattet invariant.

### Verifikation
- `SELECT count(*) FROM riders WHERE pcm_id IS NOT NULL` = 0 i prod FØR drop.
- `grep -rn "pcm_id" backend/ frontend/` returnerer 0 referencer efter PR.
- `node --test backend/` grøn.

---

## Sekvensering (samlet)

```
NU ──────────────────────────────────────────────────────────────────────►
 │
 ├─ WS2 Option B (#1595): reconcilér spec + (senere) fjern pipeline gated af #1596
 ├─ Forbered Gate C: flyt foldNameNordic → neutralt util-modul (kan ske nu)
 │
 ▼  (forever-vinduet kører — spec §8)
 │
 ├─ Gate C: pipeline + endpoint slettes  ◄── kræver #1596 (WS1 bevist på beta)
 ├─ Gate B: uci_points droppes           ◄── kræver #1208 (boardIdentity kalibreret)
 ├─ Gate A: stat_* droppes               ◄── kræver #1021 (native fysiologi-skill-kilde)
 └─ Gate D: pcm_id droppes               ◄── kræver 100% fiktiv population + ny diskriminator
```

Gate C er den eneste der ikke er reset-krævende (ren kode + endpoint) — den kan fyres så snart WS1 er bevist, uafhængigt af de tre kolonne-drops. Gate A/B/D rører schema → **ejer merger hver migration selv** (auto-applies i prod, jf. memory `pr-with-migration-owner-merges`).

## Åbne ejer-beslutninger (afgøres når hver gate nærmer sig)
- **Gate A:** hvor kommer de 5 tekniske evners native kilde fra i #1021-modellen? (terræn-metrics på fysiologi-profil vs. separat skill-felt). Reset-krævende → afgøres FØR granit-frys.
- **Gate B:** ny star-score-formel uden `uci_points` (#1208's design) — vægt mellem `popularity` og `market_value`.
- **Gate D:** ny fiktiv-diskriminator (`is_fictional`-boolean vs. hårdkodet invariant).
