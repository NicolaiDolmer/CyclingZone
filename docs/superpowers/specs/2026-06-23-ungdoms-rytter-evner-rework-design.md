# Ungdoms-rytter-evner rework — design

> Status: design godkendt af ejer 2026-06-23 (brainstorm-session). Næste skridt: implementerings-plan via writing-plans.
> Relaterer: akademi-epic [#932], progression-epic [#1136], progression-L0 [#1137], værdimodel [#1364], start-trup-balance [#1487] (UDE af scope, se §8).

## 1. Problem (audit-fund 2026-06-23)

Akademi-ryttere som managers har hentet er for stærke og har urealistiske profiler. Audit af de 33 hentede (prod, 2026-06-23):

- **Top-evnerne er for høje.** Hentede akademi-rytteres top-evne er i snit **57,5** — stort set på niveau med voksne profryttere (59,0) og langt over almindelige unge (44,2). 4 af 33 (12 %) har mindst én evne ≥ 70 hos 16-19-årige (værst: Jiho Cho, 16 år, en evne på 91).
- **Profilerne er karikaturer.** I snit ligger 2,7 af de 10 fysiske evner i bund (≤8) samtidig med én høj evne. 12 af 33 har ≥ 3 evner på gulvet.
- **Snittet (30,5) er fint** — mellem unge (27,9) og seniorer (33,5). Problemet er fordelingen: for spidse toppe + for dybe huller.

Rod-årsag: ikke selve stat-genereringen (rå stats ~58, clamp 40-85 er rimelig), men derive-pipelinen:
1. `academyGenerator.js` genererer høje rå stats → høje afledte evner.
2. Loftet (`abilityCap`) er **ankret til start-evnen**: `cap = baseline + headroom(potentiale)×type-vægt`, headroom maks +38. Sænker vi bare start-evnen, dør rejsen (pot-6.0-talent med start 15 → loft 53).
3. Kontrast-forstærkningen (`CONTRAST.k=1.52`, floor 8) er kalibreret til voksne superstjerner; på en ung smal profil skaber den karikaturer.

## 2. Mål

Ungdomsryttere skal **starte svagt** og gennemgå en **reel rejse fra ungdom til peak**, drevet af spillerens træning og rytterens potentiale. Et stort talent bliver både hurtigere klar og når højere; et lille talent bliver en solid domestique, ikke en stjerne.

## 3. Design-beslutninger (ejer-besluttet i denne session)

| # | Beslutning | Valg |
|---|---|---|
| 1 | **Loft-model** | Loftet beregnes direkte fra potentiale + anlæg, **afkoblet** fra start-evnen. |
| 2 | **Potentiale-rolle** | Styrer **både** hvor højt loftet ligger **og** hvor effektivt/hurtigt rytteren træner. |
| 3 | **Frihedsgrad** | Anlæg med bias: fysiologien hælder *og* begrænser — man former inden for anlægget, ikke udenom. |
| 4 | **Start-form** | Lav, flad profil med let hældning mod anlæg: top ~15 / bund ~7 ved 16 år. |
| 5 | **Anlæggets bredde** | ~2 beslægtede naturlige retninger får højt loft; fjernere lavere; modsatte ~ingen. |
| 6 | **Alders-skalering** | Ingen separat tal-trappe pr. alder. 16-års-startpunkt + "spol kurven frem" til faktisk alder via vækstmotoren. |
| 7 | **Scope (nu)** | Kilde-fix fremadrettet + migrér **kun `is_academy`** (de 76). Købte ikke-akademi-unge og AI-verdenen lades stå (observeres; flytter med på sigt — ejer B). |

Kontekst: hjemmesiden er **permanent reset** (ingen flere nulstillinger forventet), og brugerne er varslet om at ungdomsstats sænkes. Migrering af de eksisterende akademi-ryttere er derfor påkrævet, ikke valgfri.

## 4. Den nye model

### 4.1 Start-profil (generering)
- En ung fødes med **alders-passende lav fysiologi/stats** (en 16-årig har realistisk lav w/kg → nær fysiologi-ankrenes bund).
- Anlægget = fysiologiens **form** (hvilke power-profiler er relativt stærkest) → ~2 beslægtede naturlige retninger.
- De afledte evner beregnes **uden kontrast-forstærkning** for unge → flad profil, top ~15 / bund ~7 ved 16, med en let hældning fra anlægget alene.
- **Spol frem:** En genereret ung ældre end 16 kører 16-års-baseline gennem vækstmotoren (`developRiderSeason`/`stepAbility`) år-for-år til faktisk alder, med rytterens potentiale, mod hans caps. En genereret 19-årig bliver dermed ikke til at skelne fra en organisk udviklet 19-årig. Deterministisk pr. rytter-seed.

### 4.2 Loft-model (caps)
- Caps sættes **ved generering/migrering** ud fra potentiale + anlæg, **afkoblet** fra start-evnen:
  - Et potentiale-bestemt mål-niveau pr. naturlig evne (kalibreres; fx pot 6 → ~85-88 på de 2 naturlige retninger).
  - Fjernere retninger: lavere loft. Modsatte: ~ingen vækst.
- Dette er en **ny loft-formel for den unge-genererede sti** (akademi-generator + migrering) — den eksisterende `baseline + headroom`-formel forbliver uændret for alle andre ryttere (voksne/købte), så vi ikke forstyrrer deres progression (en voksen med høj current ville ellers få et loft *under* sin current).
- Caps er uforanderlige efter init (eksisterende kontrakt) → en akademi-ung beholder sit potentiale-bestemte loft hele karrieren.

### 4.3 Potentiale → træningsfart (ny kobling)
- I dag påvirker potentiale **ikke** træningsraten — kun gap'et (via loftet). Vi tilføjer en eksplicit potentiale-rate-faktor i vækst-stien (`stepAbility` for sæson, `dailyAbilityDelta` for daglig træning).
- Den eksisterende `youthMultiplier(age)` (alders-boost, 1,5 ved 16 → 1,0 ved 22) bevares.
- Nettoeffekt: høj-potentiale unge udvikler sig markant hurtigere (større gap × højere rate). Kalibreres så det ikke bliver for hurtigt.

### 4.4 Derive-konsistens
- Fordi unges fysiologi/stats seedes konsistent lavt og kontrasten springes, giver enhver **re-derive** (heal-sweep, backfill) idempotent de samme lave evner — ingen risiko for at en strandet-heal genskaber det høje (verificeret: `riderDeriveHealSweep` rører kun ryttere uden derived-række/base_value; race-motoren bruger `rider_derived_abilities`, ikke fysiologi direkte).

## 5. Berørte komponenter

| Fil | Ændring |
|---|---|
| `backend/lib/academyGenerator.js` | Føder alders-passende lav fysiologi/stats + lav-flad anlægs-profil i stedet for stats 40-85. |
| `backend/lib/abilityDerivation.js` | Unge undtages `applyContrast` (kontrast kun for ikke-unge). |
| `backend/lib/riderProgression.js` | Ny afkoblet loft-formel for unge-genererede caps (`abilityCap`/`buildCaps`-variant); potentiale-rate-faktor i `stepAbility`. |
| `backend/lib/dailyTraining.js` | Potentiale-rate-faktor i `dailyAbilityDelta`. |
| `backend/lib/academyIntake.js` | Sikrer at den nye generator-sti + caps-init bruges i begge intake-veje (batch + per-hold). |
| Migrerings-script (nyt, `backend/scripts/`) | Re-generér de 76 `is_academy` (se §6). |
| Sim-harness (`backend/scripts/`) | Dry-run + scorecard (se §7). Genbrug `previewRiderProgression.js` / `academyEconomySimulation.js`-mønstre. |

## 6. Migrering (kun `is_academy`, de 76)

- **Identitets-bevarende:** navn, alder, potentiale, anlæg/primary_type, hold, kontrakt, ejerskab står. Kun current-evner + caps ændres.
- **Deterministisk** pr. rytter (reproducerbart, samme seed-familie som generatoren).
- En climber forbliver en climber — bare svagere med højt loft.
- Re-generér start-profil ud fra eksisterende anlæg, spol frem til rytterens faktiske alder, byg caps fra potentiale+anlæg.
- **Re-beregn base_value/market_value** efter migrering (lavere evner → lavere værdi → korrekt løn/signing-fee).
- Tabt udvikling er minimal (rytterne er få dage gamle, næsten ingen træning at miste) → ren re-generering frem for "bevar relativ udvikling".

## 7. Før ship: simulér + verificér (ejer-regel for balance-systemer)

- Dry-run af den nye model mod **prod-klon** med et **scorecard**:
  - Peak-rejse: en pot-6.0 16-årig skal nå ~loft over en plausibel årrække; en pot-2.5 skal toppe lavt.
  - Top-evne-fordeling for unge: ingen 16-19-årige med superstjerne-enkeltevner; ingen karikatur-huller (få/ingen evner på gulvet uden grund).
  - Værdi-konsistens: market_value falder som forventet.
- Migrering verificeres mod prod-klon før den køres mod prod.
- Database/SQL i denne ændring **auto-applies ved merge** → ejer merger (ingen auto-merge).

## 8. Bevidst UDE af scope (nu)

- Købte ikke-akademi-unge (≤21) — observeres; flytter med på modellen senere (ejer B).
- AI-holdenes unge / hele verdens unge-segment.
- Voksne rytteres loft-model (uændret).
- Start-trup-rebalance [#1487] — samme grundproblem (start-population for stærk), men holdes som separat issue.

## 9. Acceptkriterier

- [ ] En nygenereret 16-årig har top-evne ~15, bund ~7, uden karikatur-huller.
- [ ] En nygenereret 18-19-årig kommer automatisk lidt højere ud (spol-frem), uden separat alders-trappe.
- [ ] Loftet afspejler potentiale + anlæg, ikke start-evnen (pot-6.0-talent kan nå verdensklasse trods start 15).
- [ ] Høj-potentiale unge træner hurtigere end lav-potentiale (synlig forskel i sim).
- [ ] Spilleren kan forme en ung mod ~2 beslægtede retninger; modsatte retninger vokser ~ikke.
- [ ] De 76 `is_academy` migreret: identitet bevaret, evner sænket, caps potentiale-bestemte, værdi re-beregnet.
- [ ] Re-derive (heal/backfill) af en ung er idempotent (genskaber ikke høje evner).
- [ ] Sim-scorecard godkendt af ejer før prod-migrering.

## 10. Risici / kanter

- **Købt ung med current > nyt loft:** Ikke i scope nu (deres loft-model er uændret), men en evt. fremtidig B-migrering skal håndtere at karikatur-current kan ligge over et potentiale-bestemt loft (rytteren sidder fast til peak, derefter fald). Acceptabelt i observations-perioden.
- **Race-balance:** Sænkede ungdoms-evner gør unge svagere i løb (korrekt), men verificér at akademi-hold ikke bliver ukonkurrencedygtige på en måde der bryder board-mål/økonomi for hold der satsede på akademi.
- **To loft-formler i koden** (unge-afkoblet vs. voksen baseline+headroom) er bevidst teknisk gæld for at holde scope; dokumentér tydeligt, så de ikke drifter. Konsolideres når B (alle unge) og evt. #1487 tages.

## 11. Åbne kalibrerings-parametre (afgøres empirisk i sim, ikke her)

- Præcise potentiale→loft-ankre pr. naturlig/fjern/modsat retning.
- Potentiale-rate-faktorens styrke (pot 2 vs pot 6).
- 16-års-startpunktets præcise top/bund + hældning.
- Spol-frem-kurvens tempo (hvornår når et stort talent ~loft).
