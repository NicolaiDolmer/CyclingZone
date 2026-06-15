# Rider Ability System v2 — redesign af evner + ryttertyper (#1101-kæden)

> **Status: DESIGN-FORSLAG til review.** Besluttet i fællesskab 2026-06-07 (Nicolai + Claude Code).
> Evne-beregnings-formlerne (physiology → evne) er Claudes forslag og **rettes i en senere session**.
> Implementeres IKKE før Nicolai har godkendt dette dokument.
>
> Afløser ability-model v1 (`backend/lib/abilityDerivation.js`, `FORMULA_VERSION=1`) og
> ryttertype-fase-1 (`backend/lib/riderTypes.js`, legacy-stat z-score). Forudsætning for
> at #1101-værdisystemet bliver realistisk.

## 0. Låste arkitektur-beslutninger (2026-06-15, ejer-session)

Disse beslutninger låser §5/§6/§8's åbne punkter på arkitektur-niveau. Den detaljerede design (fuld evne-liste, fysiologi-metric-sæt, derivations-formler, kalibrerings-ankre, endelig type-liste) færdiggøres i en **fokuseret evne-design-session** (se "Pending" nedenfor) før implementering.

1. **Fysiologi er FUNDAMENTET (ikke deferred).** Omgør den tidligere "ability-first, fysiologi senere". Vi seeder **fysiologi** skævt pr. arketype (§5 mulighed A) → udleder evnerne fra fysiologien → viser **både** de rå metrics OG spil-evnerne. Fysiologi-metrics (best practice, TrainingPeaks/Strava/Zwift/WKO): **højde, vægt, FTP (watt + w/kg), VO2max, power-kurve (15s/30s/1m/2m/5m/10m/20min…), zone2, W′/HIE** + flere fastlægges i evne-design-sessionen.
2. **Specialisering = STÆRK.** Specialister er tydeligt svage i modsatte discipliner (sprinter climbing ~32, klatrer sprint ~28) — ikke karikatur. Kommer fra den skæve fysiologi-seeding pr. arketype. Løser §1.1.
3. **Kalibrering = TOP-TUNG.** Kun ~top 2% i et speciale rammer 90+; elite-specialist ~88-95, kontinental topper ~68-74. Eksakte ankre fastlægges når vi ser fordelingen. Løser §1.2.
4. **Evne-kategorier = Mental / Teknisk / Fysisk (3)** + et **separat skjult-lag** (potentiale, hidden_potential) afsløret via scouting (#1138) — vises IKKE i de 3 kategorier. **Taktiske evner (tactics, aggression) → Mental.**
5. **Hver evne skal eksistere af en årsag** og kunne forklares: enten hvad den gør i **race engine** eller hvad den gør i **manager-spillet**. Gennemgås evne-for-evne i evne-design-sessionen (ejer-ønske 15/6).
6. **Ryttertyper VISES ved launch**, udledt fra de nye evner. Type-listen skal låses: **allrounder UD** (jf. `docs/research/genre-benchmark-june-2026.md`: all-rounder/domestique/goat = holdfunktion, ikke draftbart), goat/domestique allerede ude (§2). NB: "domestique" lever videre som **kvalitets-tier / startholds-rolle** (relaunch-orchestrator), IKKE som draftbar type — de to betydninger blandes ikke.
7. **PCM-stats fjernes fra hjemmesiden FØRST når det nye fysiologi+evne-view er klar** (ren overgang, intet tomt mellemtrin). Repo-data/navne-fjernelse (#1276 legal) er et separat spor.

### Pending → evne-design-session (fokuseret, før implementering)

- Fuld evne-liste pr. kategori (Mental/Teknisk/Fysisk + skjult) med årsag + race-engine-rolle + manager-spil-rolle for HVER evne.
- Endeligt fysiologi-metric-sæt (best practice).
- Derivations-formler (fysiologi → evne) — §3-formlerne rettes her (var "RETTES SENERE").
- Specialiserings-mekanik konkret: skæv fysiologi-seeding pr. arketype.
- Kalibrerings-ankre (elite = X, kontinental = Y).
- Endelig type-liste + type-formler (vægtet evne-gennemsnit, §4 minus allrounder).
- Derefter: implementerings-plan (writing-plans) → byg → skift PCM-view ud.

## 0.1 Evne-design-session (2026-06-15, ejer-session 2) — låste beslutninger

Færdiggør §0's "Pending". Disse er ejer-godkendt i live-dialog (sess 2, 15/6) og er nu SSOT. **Ved konflikt vinder §0.1 over §3–§9** (historisk forslag fra 7/6, bevaret som kontekst — fx 16+2 evner, 10 typer m. allrounder, "RETTES SENERE"-formler er superseded her).

**Beslutning 0 — motor-input = A′.** Motoren scorer fortsat **evnerne** (den frosne `simulateStage`-kontrakt bevares). Fysiologi er fundamentet der ① **genererer evnerne** (kilden til specialisering) og ② **driver form/træthed/durability/recovery i de eksisterende seams** (#1021). Fravalgt: B = motor scorer fysiologi direkte (= motor-omskrivning, smider den kalibrerede motor væk; benchmarken validerer vægtet-sum-af-evner). Konsekvens: en evnes "race-rolle" = enten dens **vægt i terræn-demand-vektoren** (terræn-kraft) ELLER at den **driver en seam** (dynamik).

**Beslutning 2 — evne-liste = 15 synlige + 1 skjult (rig + retfærdiggjort).** Hver evne har en rolle via **to-rolle-modellen**: terræn-kraft (demand-vægt) eller dynamik-seam.
- **Fysisk:** `sprint`, `acceleration`, `punch` (=Hills, 1–2 min), `tempo` (=Mid-mountain, 5–15 min), `climbing` (=High-mountain, 25 min+), `time_trial` (flad solo, watt+aero — `prolog` merged ind), `flat` (rouleur/bunch-kraft), `endurance`, `recovery` (seam: genopretning mellem efforts/dage), `durability` (seam: fade sent i hårde lange løb).
- **Teknisk:** `cobblestone`, `positioning`, `descending` (finale-modifier på descent-finaler + lille bjerg-vægt).
- **Mental:** `aggression` (driver udbruds-CHANCEN), `tactics` (udførelse/beslutning: udbruds-/echelon-valg, troskab mod managerens hold-instrukser, kaptajn→hjælper-koordinering, lille energi-effektivitet).
- **Skjult:** `hidden_potential`.
- **`prolog` FJERNES** (merged i `time_trial`).
- **Klatre-trioen = power-duration-kurven** udtrykt som stignings-varighed. Visnings-navne: **Hills / Mid-mountain / High-mountain** (EN-first; DA: Bakker / Mellembjerg / Bjerg). Interne kolonne-nøgler forbliver `punch` / `tempo` / `climbing`.

**ITT-model:** ÉN `time_trial`-evne, men kort vs. lang aptitude er **inferbar fra rytterens profil** via terræn-split: `itt_short` (prolog/≤~8 km) = `time_trial + punch + acceleration`; `itt_long` (≥~25 km) = `time_trial + endurance + durability + aero`. Ingen separat prolog-evne.

**Motor-vokabular udvides (følger af A′ + §2-listen):** `ABILITY_DIMENSIONS`/`DEMAND_VECTORS` skal udvides med `flat` + `tempo`; nye terræn-typer `medium_mountain` + `itt_short`/`itt_long`; `descending` som finale-modifier; **`aggression`-evnen skal læses af breakaway-mekanikken** (i dag regner den sin egen af tactics/endurance/acceleration — bug); `durability`/`recovery` driver trætheds-/genopretnings-seam.

**Beslutning 1 — fysiologi-metric-sæt.** Behold de 14 nuværende (højde, vægt, FTP w/kg+watt, VO2max-power, zone2, pmax, power 5s/15s/1m/5m, W′/HIE, TTE@FTP, fatigue_resistance, recovery_rate) + **tilføj `power_2m_wkg`, `power_10m_wkg`, `aero`**. **Drop** de gamle §3-placeholders `lightness` + `weight_stability` (w/kg dækker lethed; cobblestone-handling dækker stabilitet). **Vigtig split:** fysiologi afleder kun de **fysiske** evner + driver durability/recovery-seams; **tekniske/mentale** evner (`descending`, `positioning`, handling-delen af `cobblestone`, `tactics`, `aggression`) seedes som **skills** (skæv pr. arketype), IKKE fra fysiologi (ingen power-kurve-basis).

**Beslutning 3 — derivations-mapping + VO2max-trekant.** Hver evne aflæses fra sin power-duration-bøtte (koefficienterne er en tuning-flade sat i dry-run, ikke gættet):
- sprint / acceleration ← pmax, power_5s, power_15s
- punch (Hills) ← power_1m, power_2m
- tempo (Mid-mountain) ← power_5m, power_10m, VO2max
- climbing (High-mountain) ← FTP w/kg **+ VO2max-loft-led** (en monster-VO2max-rytter er stærk på begge klatre-længder)
- time_trial ← FTP watt + aero · flat ← FTP watt + aero + endurance
- endurance ← zone2, TTE, fatigue_resistance
- durability *(seam)* ← fatigue_resistance, W′ · recovery *(seam)* ← recovery_rate
- cobblestone ← handling-skill + FTP watt/power_1m/durability · positioning/descending/tactics/aggression = rene skill-seeds

**VO2max-trekant** (aflæselig af spilleren, realisme-anker): VO2max = motor-størrelse (Mid-mountain + loftet for klatring; de bedste VO2max/kg-ryttere ER klatrere/GC); FTP w/kg = den *holdbare brøkdel* (High-mountain + lang TT); durability/TTE = hvor højt og hvor *længe* brøkdelen holdes. → komplet klatrer (høj VO2max + høj brøk) vs. Mid-mountain-puncheur (høj VO2max, lav brøk) vs. diesel-grinder (lavere VO2max, meget høj brøk + durability).

**MAP / VO2max / TMAP — anerkendte cykel-metrics (sess 2, 15/6).** Tre komplementære udtryk for samme aerobe motor, alle gængse i cykelsport: **VO2max (ml/kg/min)** = kapaciteten, **beholdes som det genkendelige headline-tal** og vises prominent (de fleste i sporten bruger det). **MAP (w/kg)** = power'en *ved* VO2max = vores `vo2max_power_wkg` (korrekt navngivet; bliver det kanoniske 5-min-anker og fjerner near-dubletten med `power_5m_wkg`). **TMAP (min)** = hvor længe MAP holdes — afledt af kurven (Pinot & Grappe 2014), vises + fodrer Mid-mountain + durability (komplementært til TTE@FTP, som er det samme men ved tærskel). Kæden er: kapacitet (VO2max) → effekt (MAP) → holdbarhed (TMAP/TTE). Påvirker IKKE evne-listen eller motoren — kun fysiologi-visning + derivations-input.

**Beslutning 4 — specialisering = (A) direkte arketype-skew.** Seed fysiologien skævt pr. arketype (born-in specialisering); seeding-arketyperne ≈ de viste typer (en seeded climber klassificeres som climber). Afløser dagens "skæve legacy-stats → generisk seed". (B) per-rytter kontrast-forstærkning ikke nødvendig for 100% fiktiv sæson 1.

**Beslutning 6 — 8 typer, z-score + kontrast.** **leadout SKÅRET** (benchmark: næsten-død uden leadout-tog-modellering; foldes i sprinter/rouleur). allrounder/goat/domestique allerede ude. Endelige 8: **sprinter, tt, climber, puncheur, brostensrytter, baroudeur, rouleur, gc.** Metode = shippet **z-score + kontrast** med guards (ikke doc §4's vægtede gennemsnit); re-fit baseline efter re-derivation. Start-vægte (tunes i dry-run; positiv = definerer, negativ = anti-type):
- sprinter: {sprint:3, acceleration:2, flat:1, positioning:1, climbing:−2, endurance:−1}
- tt: {time_trial:3, flat:1, endurance:1, durability:1, positioning:1, sprint:−1, punch:−1}
- climber: {climbing:3, tempo:2, endurance:1, recovery:1, durability:1, sprint:−2, flat:−1}
- puncheur: {punch:3, tempo:2, acceleration:1, climbing:−1, endurance:−1, sprint:−1}
- brostensrytter: {cobblestone:3, flat:1, durability:1, punch:1, positioning:1, climbing:−1}
- baroudeur: {aggression:3, endurance:1, durability:1, tactics:1, flat:1, punch:1, sprint:−1}
- rouleur: {flat:3, endurance:1, time_trial:1, durability:1, climbing:−1, punch:−1}
- gc: {climbing:3, time_trial:2, tempo:1, recovery:1, durability:1, endurance:1, sprint:−2}

**Beslutning 5 — kalibrering = top-tung, ankre mod dry-run-fordeling (simulér-før-ship).** Kun ~top 2% i et speciale rammer 90+; provisorisk: elite-specialist ~88-95, kontinental ~68-74 (bekræftes når vi ser den genererede fordeling).

**Tilbage (empirisk, i implementeringen — IKKE gættet i design):** derivations-koefficienter + kalibrerings-ankre sættes via **dry-run-harness mod genereret fiktiv population + mål-scorecard FØR live** (`race:gate`). Implementerings-rækkefølge: writing-plans → migration (fysiologi +3 kolonner m. GRANT SELECT, evne-kolonner: fjern prolog; motor-vokabular +flat/tempo + terræn medium_mountain/itt_short/itt_long) → skæv arketype-seeding → re-derive → tune mod scorecard → re-fit type-baseline → re-backfill typer (8) → motor: udvid ABILITY_DIMENSIONS + demand-vektorer + aggression-i-breakaway + durability/recovery-seams → frontend fysiologi+evne-view → skift PCM-stats ud (ren overgang).

## 1. Problem (verificeret mod prod 2026-06-07, 8.994 ryttere)

Tre rod-årsager til at evnerne er "ramt dårligt og urealistisk":

1. **Manglende specialisering** — fysisk stærke ryttere er høje i *alt*. Mads Pedersen
   (classics/sprinter) har climbing 87; de bedste rigtige ryttere ligger 85-99 på tværs af
   næsten alle evner. Årsag: mange evner deler samme physiology-driver (`ftp_wkg` driver
   både climbing og tt; `pmax` driver både sprint og acceleration), så ét stærkt motor-tal
   løfter alle evner samtidig. Der findes ingen trade-off-mekanik.
2. **Mætning i toppen** — for mange rammer 96-99; climbing-toppen er fem ryttere på 99.
   Percentil-skaleringen differentierer ikke eliten.
3. **Døde evner + forkerte typer** — `tactics`/`positioning` har sd=5 (alle ~62, ubrugelige).
   Typerne (legacy z-score) er nonsens: tidskørere har ikke høj tt, sprintere klassificeres
   som leadout, "goat" er svagest. Bekræfter at typer skal udledes fra (rettede) evner.

## 2. Låste beslutninger

- **Type-score = vægtet gennemsnit:** Σ(evne × vægt) / Σ(vægt). Alle typer på samme 0-99-skala,
  rangerbare direkte mod hinanden.
- **Typer udledes fra de nye EVNER**, ikke legacy stats.
- **Goat** og **domestique** udgår som typer.
- **Brosten ≠ klassiker:** `cobblestone` er en selvstændig evne; typen hedder **brostensrytter**
  (ingen "classics"-kobling i hverken evne- eller type-navn).
- **Specialisering er målet:** en ren specialist skal være tydeligt svag i de modsatte discipliner.
- **Kalibrering: top-tung** — kun de reelt bedste i deres *speciale* rammer 90+.
- **Lagring:** primær type i `primary_type`, sekundær i `secondary_type`. ALDRIG i status-/badge-kolonnen
  (nuværende frontend-fejl der skal rettes).
- **Evne-systemet skal være udvideligt** — flere evner + skjulte evner kommer senere. Kategorier:
  fysiske / tekniske / taktisk-mentale / skjulte.

## 3. Evne-liste (16 synlige + 2 skjulte)

| Kategori | Evne | Kilde (legacy) | Foreslået physiology-formel (RETTES SENERE) |
|---|---|---|---|
| Fysisk | `climbing` | Bj | 0.50 ftp_wkg + 0.20 power_5m_wkg + 0.15 fatigue_resistance + 0.15 lightness |
| | `time_trial` | Tt | 0.35 ftp_watts + 0.30 ftp_wkg + 0.20 tte_ftp + 0.15 aero |
| | `prolog` ⭐ | Prl | 0.40 power_5m_wkg + 0.30 ftp_watts + 0.20 power_1m_wkg + 0.10 aero |
| | `flat` ↻ | Fl | 0.45 ftp_watts + 0.25 pmax_watts + 0.20 aero + 0.10 zone2_power_wkg |
| | `tempo` ⭐ | Kb | 0.45 ftp_wkg + 0.30 power_5m_wkg + 0.15 tte_ftp + 0.10 fatigue_resistance |
| | `sprint` | Sp | 0.35 pmax_watts + 0.25 power_5s_wkg + 0.20 power_15s_wkg + 0.10 positioning + 0.10 recovery_rate |
| | `acceleration` | Acc | 0.60 pmax_watts + 0.40 power_5s_wkg |
| | `punch` | Bk | 0.35 power_1m_wkg + 0.25 power_5m_wkg + 0.20 high_intensity_energy + 0.20 recovery_rate |
| | `endurance` | Udh | 0.35 zone2_power_wkg + 0.30 tte_ftp + 0.25 fatigue_resistance + 0.10 recovery_rate |
| | `recovery` | Res | 0.60 recovery_rate + 0.40 fatigue_resistance |
| | `durability` ⭐ | Mod | 0.45 fatigue_resistance + 0.30 tte_ftp + 0.25 high_intensity_energy |
| Teknisk | `descending` ⭐ | Ned | 0.70 norm(stat_ned) + 0.30 norm(stat_bro) |
| | `cobblestone` ↻ | Bro | 0.25 ftp_watts + 0.20 power_1m_wkg + 0.20 fatigue_resistance + 0.20 norm(stat_bro) + 0.15 weight_stability |
| | `positioning` ↻ | Fl + Ned | 0.50 norm(stat_fl) + 0.30 norm(stat_ned) + 0.20 norm(stat_ftr) |
| Taktisk/mental | `aggression` ⭐ | Ftr | 0.80 norm(stat_ftr) + 0.20 (eksplosivitet/ungdom) |
| | `tactics` ↻ | (afledt) | ÅBEN — fx erfaring(alder) + aggression. Mod bruges IKKE her (nu durability) |
| Skjult | `potentiale` | findes | eksisterende kolonne, skjult |
| | `hidden_potential` ⭐ | — | afledt af potentiale + ung alder + seeded støj |

**Definitioner af de nye evner (Nicolais ord):**
- `durability` (Mod): ydelse sent i et hårdt løb — hvor længe kan du bruge din VO2max efter 200 km
  og mange dybe angreb.
- `tempo` (Kb): din effort i mellemlange perioder, fx hvor hurtigt du kan køre i 15-25 minutter.
- `descending` (Ned): teknik/nedkørsel + bike-handling.
- `aggression` (Ftr): angrebsiver — må også påvirke `tactics`.
- `prolog` (Prl): kort/eksplosiv enkeltstart, adskilt fra lang `time_trial`.

## 4. Ryttertyper (10) — vægtet gennemsnit af evner

| Type | Formel (÷ vægt-sum) |
|---|---|
| rouleur | (flat×2 + endurance) / 3 |
| tt | (time_trial×3 + prolog×2) / 5 |
| climber | (climbing×3 + tempo×2 + punch + endurance) / 7 |
| puncheur | (punch×3 + tempo×2 + flat×2 + durability×2 + climbing + endurance) / 11 |
| baroudeur | (aggression×3 + flat×2 + punch + endurance + recovery + durability + sprint + descending) / 11 |
| brostensrytter | (cobblestone×3 + flat×2 + endurance×2 + punch) / 8 |
| sprinter | (acceleration×3 + sprint×2 + flat + durability) / 7 |
| gc | (climbing×3 + recovery×3 + time_trial×2 + tempo×2 + durability + endurance + flat + prolog + punch) / 15 |
| leadout | (flat + sprint×3 + acceleration×2 + durability) / 7 |
| allrounder | (flat + time_trial + endurance×2 + punch + tempo) / 6 |

Primær = højeste type-score; sekundær = næsthøjeste. Deterministisk tie-break (stabil rækkefølge).

## 5. Specialiserings-mekanik (ÅBEN — vælges næste session)

Problemet i §1.1 løses ikke af top-tung kalibrering alene. To kandidater:

- **(A) Arketype-styret physiology-seeding** for de fiktive ryttere (relaunch-population, #669/#677):
  generér physiology *skævt* efter rytterens tiltænkte arketype (en sprinter får høj pmax, lav
  ftp_wkg). Specialisering bliver indbygget fra fødslen. Ren løsning — men virker kun på fiktive,
  ikke på de importerede PCM-ryttere.
- **(B) Specialiserings-kontrast i evne-beregningen:** efter rå evne, forstærk afstanden fra
  rytterens egen evne-median (spidskompetencer op, svagheder ned). Virker på alle ryttere, men
  skal kalibreres så absolut niveau ikke ødelægges.

Da relaunch går til fiktiv population, er (A) sandsynligvis primærvejen; (B) som supplement.

## 6. Kalibrering (top-tung)

- Behold percentil-skalering, men læg en kurve på toppen så 90+ bliver sjældent (kun ~top 2% i
  speciale). Konkrete anker-tal (elite vs. kontinental) gives af Nicolai næste session.
- Kombineret med specialisering: selv eliten er svag i sine ikke-specialer.

## 7. Kobling til #1101-værdi

`base_value` = model på (evner) + **rider_type** + **forventet-point-heuristik** som nye features.
Forventet point afledes som heuristik fra type + evne-niveau (lookup), uden fuld race-simulering
(besluttet: "heuristik nu"). Kan senere erstattes af simulerede point fra race-motoren (#1102).

## 8. Åbne punkter til næste session

1. Ret evne-beregnings-formlerne i §3 (Nicolais review).
2. Vælg specialiserings-mekanik (A / B / begge), §5.
3. `tactics`-driver uden Mod, §3.
4. `hidden_potential`-formel + endelig liste over hvilke evner der er skjulte.
5. Arketype-skæv physiology-seeding til fiktiv population (#669/#677).
6. Konkrete kalibrerings-ankre (elite = X, kontinental = Y).

## 9. Implementerings-rækkefølge (efter godkendelse)

1. Migration: udvid `rider_derived_abilities` med nye evne-kolonner (prolog, flat, tempo, durability,
   descending, cobblestone, positioning, aggression, tactics, hidden_potential).
2. Omskriv `abilityDerivation.js` (nye evner + specialisering + top-tung kalibrering), bump `FORMULA_VERSION`.
3. Re-derive abilities for hele pool + verificér fordelinger (sanity-checks).
4. Omskriv `riderTypes.js` → udled fra abilities (vægtet gennemsnit), fjern goat/domestique, brostensrytter.
5. Re-backfill `primary_type`/`secondary_type`.
6. Frontend: vis typer i egne kolonner (ikke status/badge-kolonnen).
7. `riderValuation.js` (#1101): tilføj rider_type + forventet-point-heuristik, re-fit modellen.
8. Senere: færdiggør de 25 fiktive rytteres evner (#669/#677).
