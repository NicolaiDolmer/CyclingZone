# Træning: alle beslutninger fra de tre specs, og om de faktisk er bygget

> **Første leverance i [#4192](https://github.com/NicolaiDolmer/CyclingZone/issues/4192)** (ejer-direktiv 24/8: *"lav en single source of truth angående træning, find alt vi har lavet og planlagt, stil spørgsmålstegn ved alt"*).
>
> **Sådan bruges den:** sæt et kryds i **Genåbn?**-kolonnen ved hver beslutning du vil have taget op igen. Der bygges intet før listen er markeret. `docs/TRAINING_RULES.md` skrives EFTER, med udgangspunkt i det du lader stå.

Kilder: `2026-08-06-loebsdags-model-design.md` · `2026-08-09-3564-progressionskaede-samlet-design.md` · `2026-08-14-3659-rytterudvikling-og-traening-design.md`. Alt er verificeret mod koden på `main` og mod prod 24/8 (season-filtreret hvor det gælder sæson-data).

## Status-nøgle

| | Betydning |
|---|---|
| ✅ | Bygget og live |
| 🟡 | Delvist: bygget men rullet tilbage, bag flag der ikke er tændt, eller kun halvdelen |
| ❌ | Ikke bygget |
| ⛔ | **Overhalet**: en senere ejer-beslutning har ophævet den, uden at spec'en blev rettet |
| ⚠ | **Afvigelse**: koden gør noget andet end den godkendte spec siger |

---

## A. Løbsdags-modellen (spec 6/8, #3459): 8 beslutninger

| # | Dato | Beslutningen | Status | Evidens | Genåbn? |
|---|---|---|---|---|---|
| A1 | 6/8 | Racing udvikler ~10-20 % MERE end det pas det erstatter, kun i løbets relevante evner | ✅ | `RACE_DEV_CONFIG.devMult = 1.15` (`dailyTraining.js:52`), `RACE_PROFILE_ABILITY_MAP` mapper 9 profiltyper | ☐ |
| A2 | 6/8 | Motor-skiftet går live ved sæsonskiftet: ét nulpunkt | ✅ | `race_day_engine_enabled = on` i `app_config` siden 7/8 11:04 | ☐ |
| A3 | 6/8 | Managerens træningsvalg må ALDRIG overskrives eller bogholderi-fuskes | 🟡 | Planen muteres ikke i DB. **Men den bruges som input på en dag hvor den ikke skal gælde**, se A4 | ☐ |
| A4 | 6/8 | **D1: på løbsdage udføres det planlagte pas ikke** | ⚠ | `applyRaceDevelopmentTick` beregner løbets udbytte som `replacedTotal × 1,15`, hvor `replacedTotal` er summen af `dailyAbilityDelta` med rytterens **planlagte program** (`dailyTraining.js:270-281`). Planen er altså input. Og `abilityMult` returnerer 0 for `rest` (`:85`) → **en rytter på Hvile får nul udvikling af at køre løb** | ☐ |
| A5 | 6/8 | D2: løbet giver udviklings-stimulus mappet fra løbsprofilen | ✅ | `RACE_PROFILE_ABILITY_MAP` + `applyRaceDevelopmentTick`; budget fordeles ligeligt på de relevante evner | ☐ |
| A6 | 6/8 | D3: raceLoad ×1,0 uændret + recoveryBase 4→4,5 + recoveryFraction 0,13→0,15 | ✅ | `RACE_DAY_ENGINE_RECOVERY_CONFIG` (`riderCondition.js`), sendes fra `dailyTrainingEngine.js:415` når flaget er on | ☐ |
| A7 | 6/8 | D4: AI kører samme motor; `aiRecoverySweep.js` NEDLÆGGES | 🟡 | Filen findes stadig, men springer sig selv over når flaget er on (`aiRecoverySweep.js:145-152`). Funktionelt nedlagt, ikke slettet | ☐ |
| A8 | 6/8 | K4/K4′ afvist: ingen auto-nedgradering af intensitet, ingen fatigue-rabat på træning | ✅ | Ingen sådan mekanik i motoren | ☐ |

**Success-kriterierne G1-G6** fra spec §3 (median-fatigue 40-60, <15 % over 70, etapeløb skal kunne skubbe over 70, udviklingstempo ≥ i dag, nul plan-mutation, skadesfrekvens ±20 %) blev målt i sim FØR ship. **Ingen af dem er en gate i dag**. Der findes ingen tilbagevendende måling mod prod. Det er samme hul som kalenderen havde før #4176.

---

## B. Progressionskæden (spec 9/8, #3564): 13 beslutninger

| # | Dato | Beslutningen | Status | Evidens | Genåbn? |
|---|---|---|---|---|---|
| B1 | 9/8 | Potentiale bliver **eksakt 1-99 i DB**; migration + skæv estimat-generator bygges sammen | ⛔ | **Ejer-beslutning 13/8 ("tredje vej") ophævede den:** potentiale forbliver 1-6 internt, UI viser potentiel rating i evnernes point-skala. Leveret i PR #3683, #2454 lukket 18/8 med *"Migration af 1-6-data droppet eksplicit af ejeren"*. **Prod bekræfter: 11 distinkte værdier, 1,0-6,0, ingen over 6.** Spec'en fra 9/8 blev aldrig rettet | ☐ |
| B2 | 9/8 | Tillæg: potentiale-**overskuddet udlignes** ved migrationen (11,7 % pot 5-6 mod planens 1,4 %) | ⛔ | Bortfaldt med B1: der er ingen migration at hænge udligningen på. Overskuddet består i prod | ☐ |
| B3 | 9/8 | **#2798:** potentiale-leddet fjernes fra PUBLICERET værdi for <22-årige uden handelsevidens | ❌ | #2798 er stadig åben med `needs-decision`. Sidekanalen består | ☐ |
| B4 | 9/8 | **Ét potentiale pr. rytter + 8 type-loftprofiler** (erstatter grove rollefaktorer) | 🟡 | Rollefaktorerne ER erstattet af `ROLE_CLASS_RATE` (signatur/sekundær/anden/svaghed) via #3709. Men de **otte type-specifikke loftprofiler** findes ikke. Der er én fælles rolleklasse-tabel for alle typer | ☐ |
| B5 | 9/8 | **#2698:** kontinuert absolut-niveau-kurve; potentialet ganger på daglig trænings-kvalitet; **max ved ~27 år** | 🟡 | Potentiale-multiplikatoren findes (`youthRateForPotential`, rekalibreret op i #4063 21/8). #2698 er stadig åben. Peak-alderen er ikke genmålt efter #3791 og #4063 | ☐ |
| B6 | 9/8 | **Træningsscore = synlig daglig score 1-99** pr. rytter + 30 dages historik; udviklingen afledes af scoren | 🟡 | `tickResult.score` findes og persisteres, og kvitteringen pr. evne leveres af #3717. Men der er ingen **1-99 dagsscore** med 30-dages historik som selvstændig visning | ☐ |
| B7 | 9/8 | **Remap variant B** + to fredningsgulve (gammel 6,0'er aldrig under 80 · gammel 5,5'er aldrig under 74,5) | ⛔ | Bortfaldt med B1 | ☐ |
| B8 | 11/8 | **Træningsscorens privatliv:** dagsstøjen hæves mod en målsat gate: median ≥14 dage før potentialet kan aflæses | ❌ | `noiseSpan: 0.15` er uændret (`dailyTraining.js:17`). Gaten findes ikke, og harnessen er ikke genkørt | ☐ |
| B9 | 11/8 | **Toprytterens form:** mesterlig i primæren, god i sekundæren, jævn i resten. Sidebetingelse: en 6-stjernet rytter skal **stadig opleves god** | 🟡 | Rolleklasserne bærer princippet. Men #3791 rullede trin 4's tag tilbage 15/8 fordi 748 ryttere brød loftet. Retningen står, kalibreringen er ikke i mål | ☐ |
| B10 | 11/8 | D-1: to ryttere af samme type skal kunne blive **forskellige** | ❌ | `riders.archetype_draw` indeholder kun `{primary, secondary}`, altså typeparret, ikke en pr.-evne-hældning. To sprintere med samme type og potentiale får samme profil | ☐ |
| B11 | 11/8 | D-2: kilden = **medfødt hældning** (vægt pr. evne, ligger fast hele livet) **+ spillerens fokus** | ❌ | Den medfødte hældning pr. evne findes ikke. Kun fokus-siden er bygget | ☐ |
| B12 | 11/8 | D-3: ligevægt arv/arbejde: vedholdende fokus over flere sæsoner kan flytte tyngdepunktet. **Antal sæsoner SKAL måles og sættes bevidst** | ❌ | Ikke bygget, ikke målt | ☐ |
| B13 | 11/8 | D-4: **median-gab ~12 ved 28 år**. 6 fravalgt (usynligt), 20 fravalgt (skrøbelige ryttere, straffer små trupper). Verifikations-krav: 6/12/20 mod ægte population + race-motor FØR låsning | ⚠ | **Målt i prod 24/8 er median-gabbet 25 ved 28 år, 30 ved 29, 36 ved 30 og 40 ved 32**, altså 2-3× målet, og langt over de 20 ejeren udtrykkeligt fravalgte. Se forbehold nedenfor | ☐ |
| B14 | 11/8 | D-5: scouting afslører **retningen**, aldrig niveauet | ❌ | Ikke bygget; afhænger af B8 | ☐ |

---

## C. Rytterudvikling og træning (spec 14/8, #3659): 17 beslutninger

| # | Dato | Beslutningen | Status | Evidens | Genåbn? |
|---|---|---|---|---|---|
| C1 | 14/8 | Der findes et **absolut tag**, som en evne nærmer sig men aldrig når | 🟡 | `tagForClass` + `roleTags` findes (`riderProgression.js:209-227`). **Trin 4's tag blev rullet tilbage 15/8** (#3791) fordi 748 ryttere kom over 95 | ☐ |
| C2 | 14/8 | Taget uden for rollen afhænger af hvilken evne det er: **to slags neutral** | ✅ | `neutralFactor: 0.45` + `craftFactor: 0.95` | ☐ |
| C3 | 14/8 | Håndværk = **kun** `positioning` og `tactics` | ✅ | Listen står eksplicit i `riderProgression.js:161` | ☐ |
| C4 | 14/8 | Raten matcher **slutresultatet**, ikke ungdommen | ✅ | `ROLE_CLASS_RATE` kalibreret mod 30-års-rating | ☐ |
| C5 | 14/8 | "Ingen vokser af tid alene" gælder alle, men som **selvstændigt issue** | ❌ | Ikke fundet som bygget mekanik; issue-nummeret er ikke navngivet i spec'en | ☐ |
| C6 | 14/8 | Ryttere skal **holde op med at nå deres lofter** | 🟡 | `taperedAbsoluteCap` findes (#2472, ejer-valg 16/7). Men spec'ens eget hul nr. 4 står stadig åbent: arvede ryttere over deres formel-loft rammes ikke af reglen | ☐ |
| C7 | 14/8 | Ankeret: **fremragende træning = dagens niveau** | ⛔ | Ophævet af C17 15/8: genmålingen viste at ankeret vender den forkerte vej | ☐ |
| C8 | 14/8 | Potentiale: **fart, ikke højde**, udskudt til eget trin | ✅ | Trin 7 leveret i PR #3798, merged 20/8. #3746 er dog stadig åben | ☐ |
| C9 | 14/8 | Enhed på fladen: **point pr. sæson** | ✅ | Leveret i #3717 (kvittering pr. evne: nu, sæson, på vej) | ☐ |
| C10 | 14/8 | Taget vises som **`nu → tag`** som par | 🟡 | Delvist, se C15, taget blev flyttet ud af trin 1 | ☐ |
| C11 | 14/8 | `tactics` og `aggression` får et **nyt fokus: løbslære** | ✅ | `TRAINING_FOCUSES.loebslaere = ["positioning","tactics","aggression"]` (`training.js:77`) | ☐ |
| C12 | 14/8 | Mod en langsom evne kan manageren bruge **fokus og tid**; træningslejre senere | 🟡 | Fokus findes. Træningslejre er ikke bygget og har intet issue jeg kunne finde | ☐ |
| C13 | 14/8 | Akademi og senior bliver **én model** | ✅ | Leveret i #3741 (trin 4+5), `INTERIM_RATE_MULT` fjernet | ☐ |
| C14 | 14/8 | Ankr **rating**, ikke spidsen. **Signatur-rate 0,45** | ✅ | `ROLE_CLASS_RATE.signatur = 0.45` (`riderProgression.js:180`), markeret som ankeret i koden | ☐ |
| C15 | 14/8 | Taget vises **ikke** i trin 1, flyttet til trin 3 (#1162) | ✅ | #1162 er lukket | ☐ |
| C16 | 14/8 | **Sæson**, ikke uge, på kvitteringen | ✅ | #3717 | ☐ |
| C17 | 15/8 | Ankeret holdt ikke i genmålingen → **accepter**, genåbn ikke raten. Prisen: alle ender ~2 point lavere, evnesummen falder ~22 %, men agens-spændet går fra 1 til 7 ratingpoint | ✅ | Ejer-ramme 15/8: *"et spil hvor alle bliver lidt bedre men manageren ikke har indflydelse, mod et hvor de bliver lidt dårligere i snit men hvor det manageren gør afgør hvad rytteren bliver"* | ☐ |

---

## Det vigtigste at kigge på

### 1. Afvigelsen: planen er input på en dag hvor den ikke skal gælde (A4)

Spec'en fra 6/8 siger at det planlagte pas **ikke udføres** på en løbsdag. Koden beregner i stedet løbets udbytte som *det planlagte pas × 1,15*. Konsekvensen er at planen stadig bestemmer, og at intensiteten `rest` giver faktor 0, så en rytter på Hvile udvikler sig **ikke** af at køre løb.

**Målt i prod 24/8, sæson 3:**

| Plan-intensitet | Ryttere med S3-plan | Heraf tilmeldt et S3-løb | Andel |
|---|---|---|---|
| Hvile (`rest`) | 458 | **404** | **88 %** |
| Aktiv restitution (`recovery`) | 92 | 84 | 91 % |
| Let | 467 | 370 | 79 % |
| Normal | 143 | 107 | 75 % |
| Hård | 1.037 | 694 | 67 % |

404 ryttere på 69 hold er sat til Hvile og tilmeldt et løb i S3. De får nul udvikling af at køre. Hvile og aktiv restitution har de **højeste** løbsandele af alle indstillinger, præcis som issuet beskrev: assistenten udtager de friske.

> **Rettelse til #4192's tal.** Issuet siger 1.520 ryttere på 103 hold. Det tal er målt **uden season-filter**. `training_plans` har 1.386 ryttere på `rest` på tværs af alle sæsoner. Sæson 3-tallet er **404 på 69 hold**. Problemet er det samme, størrelsen er en tredjedel.

Ejerens dom 24/8: *"Hvis man kører løb eller træner, så kan man ikke begge dele."* Det udelukker den nuværende konstruktion: planen må ikke være input på en løbsdag. Hvad der så skal bestemme udbyttet er en åben beslutning.

### 2. To specs beskriver en verden der ikke findes længere (B1, B2, B7)

Spec'en fra 9/8 bygger sit trin 1 på at potentiale migreres 1-6 → 1-99. **Den migration blev droppet af ejeren 13/8** til fordel for "tredje vej" (1-6 internt, potentiel rating i UI). Prod bekræfter det: potentiale har stadig 11 distinkte værdier fra 1,0 til 6,0.

Tre beslutninger (B1, B2, B7) og hele trin 1's remap-arbejde hviler på en forudsætning der er ophævet, men spec'en siger stadig at de er låst. Det er nøjagtig samme fejlklasse som kalenderen havde: **en regel der kun findes som en hensigt.**

### 3. Specialiserings-gabbet er ikke kollapset, det er løbet løbsk (B13)

Ejeren valgte median-gab **~12 ved 28 år** og fravalgte eksplicit 20, fordi *"ryttere bliver skrøbelige og små trupper straffes, hvilket kolliderer med 'straf aldrig styrke' ad bagvejen."*

Målt mod prod 24/8 (bedste minus næstbedste afledte evne, median pr. årgang):

| Alder | 16 | 20 | 22 | 24 | 26 | **28** | 30 | 32 |
|---|---|---|---|---|---|---|---|---|
| Median-gab | 6 | 7 | 2 | 7 | 16 | **25** | 36 | 40 |
| Andel med nul-gab | 6 % | 12 % | 28 % | 8 % | 2 % | 3 % | 2 % | 1 % |

To ting på én gang: de **21-23-årige** har et gab på 2-3 med op til 28 % på nul. Det gamle kollaps er stadig synligt i den kohorte. Og fra 24 år og op eksploderer gabbet til **det dobbelte af det ejeren fravalgte**.

> **Forbehold, som spec'en selv insisterer på:** dette er målt på **stock**, ikke flow. De 28-33-årige voksede ikke op under #3709's rater. De er i vid udstrækning seedet ved lanceringen. Tallene beviser derfor ikke at modellen *producerer* gab 25. Men det er de tal spilleren ser i dag, og verifikations-kravet fra 11/8 (kør 6/12/20 mod ægte population + race-motoren FØR konstanterne låses) er aldrig blevet indfriet.

### 4. "3 point ud af 60" er ikke længere den rigtige anklage

Målingen fra 14/8-spec'en (*"forskellen mellem at træne rigtigt og forkert i en hel karriere er 3 point ud af 60"*) beskriver modellen **før** #3709. Spec'ens eget scorecard siger at trin 3-5 hæver agens-spændet fra 2 til 10 ratingpoint, genmålt til 7 den 15/8.

Men: #3791 rullede trin 4's tag tilbage 15/8, og #4063 skruede `rateByPotential` op 21/8. **Ingen har målt agens-spændet siden.** Tallet skal altså hverken forsvares eller forkastes. Det skal måles om mod den motor der faktisk kører. Det er den første måling jeg vil anbefale.

### 5. Ingen af de tre specs' mål er en gate

Spec 6/8 har G1-G6. Spec 9/8 har porte pr. trin. Spec 14/8 har S1-S5 fra #3791. Alle blev målt **én gang, før ship**. Ingen af dem kører tilbagevendende mod prod.

Det er præcis den tilstand kalenderen var i før #4176, og begge kalender-hændelser i august opstod i DATA med korrekt kode. Træningen har samme eksponering.

---

## Hvad jeg ikke har verificeret

Ærligt regnskab, så listen ikke læses som mere sikker end den er:

- **C5** ("ingen vokser af tid alene"): spec'en henviser til et selvstændigt issue uden nummer. Jeg fandt ikke mekanikken i koden, men kan ikke udelukke at den ligger et sted jeg ikke greppede.
- **B6's træningsscore**: jeg har verificeret at `tickResult.score` findes og persisteres, men ikke gennemgået hver trænings-flade for om en 1-99-visning med 30-dages historik alligevel findes.
- **C12's træningslejre**: jeg søgte ikke systematisk efter et issue.
- **De ~40 åbne træningsissues** nævnt i #4192 (#3709, #3806, #1136, #2337, #1922, #3705, #4059, #4128, #3966 …) er ikke gennemgået. Det hører til leverance 4 (den langsigtede plan), ikke til denne liste.
- **Staff- og facilitets-stien** er spec 14/8's eget kendte hul nr. 7 og står stadig åbent.
