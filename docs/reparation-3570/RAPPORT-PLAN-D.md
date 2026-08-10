# #3570 — skriveplan for ejerens indstilling D

**Spor PLAN.** Bygget 2026-08-10 mod snapshot `snap-2026-08-10` (taget 2026-08-09T22:30:17Z, n = 8.199).
**Ingen prod-mutation. Ingen migrationer. Ingen repo-edits. Ingen PR merged.** Der er kørt tre
read-only `SELECT` mod prod (flag-tilstand + hold-flag), intet andet.

**Leverancer**

| fil | indhold |
|---|---|
| `plan/skriveplan-D.json` | 8.199 poster, rev2's format 1:1 + ét additivt felt (`skriver_kolonner`) — 22,9 MB |
| `plan/skriveplan-D.csv` | 8.199 rækker × 43 kolonner, semikolon, UTF-8 BOM — rev2's header 1:1 |
| `plan/RAPPORT.md` | denne fil |

Målekode og rå output ligger et niveau op: `10-paritet.mjs`, `20-byg-D.mjs`, `30-noegletal.mjs`,
`40-dekomponering.mjs`, `50-totrins.mjs`, `60-negativtest.mjs` + `out-*.json`.

---

## 0. Kort svar

* **D reproducerer eksakt.** Alle otte facit-tal rammer. Én "afvigelse" i briefen er ikke en
  afvigelse: pasnings-rang segment B er **2,663** i sporets egen konvention og **2,561** i
  verifikatorens strenge konvention. Briefens 2,56 er den strenge. Begge reproduceres til
  tre decimaler. Se §2.
* **Planen er bygget og porteret.** 7 porte, alle grønne, alle konstrueret så de KAN fejle —
  bevist i §7 hvor de to kendte historiske defekter får dem til at fejle.
* **To-trins-anbefalingen: NEJ.** Den tekniske kerne holder (bit-identisk, 0 afvigelser på
  3.360 ryttere), men selv-helingen dækker kun **41 %** af skrive-scopet. Se §6.
* **Dekomponeringen er klar til to separate godkendelser.** Se §5.

---

## 1. Hvad planen er

Strukturen er arvet uændret fra rev2. **Kun tildelingen er erstattet.**

| | rev2 | D |
|---|---|---|
| segment A/C (2.582) | F4's genfundne fødsels-anlæg | **uændret** (verificeret: 0 afvigelser) |
| de 6 med `archetype_draw` | udelades helt | **uændret** (verificeret: 0 felter, tom kolonne-liste) |
| tildelings-puljen (5.611) | min-cost-flow der maksimerer fødsels-pasning | **færrest mulige ændringer** |
| sekundær-type | næstbedste fødsels-evidens ≠ primær | **uændret regel** |
| kvoter | ejerens præcise mål (δ = 0) | **uændret** |

D's målfunktion: `c(i, fødselstype_i) = 0` · nær-ækvivalente typepar koster 0,25 · øvrige flytninger
koster 1 · tie-break på F4's stats-only log-likelihood med ε = 1e-3.

De fire nær-ækvivalente par (`tt≈gc`, `puncheur≈climber`, `rouleur≈brostensrytter`,
`rouleur≈baroudeur`) er verificeret mod repoets **egne** vægte i `backend/lib/riderTypes.js`:
alle fire er ægte delmængde-par på de positive vægte, og der findes **ingen** ikke-listede
delmængde-par. Ejerens liste er komplet.

**2.211 ryttere i puljen får en anden primærtype under D end under rev2.** Alt andet er identisk.

### Løserens certifikat

```
primal 3676,75 · dual 3676,75 · dualitetsgab 0 · transportgab 6,7e-9 · 1.807 cyklus-runder · 0 swaps
```

Flytningerne (4.027) er **det kombinatoriske minimum** `Σ_k max(0, født_k − kvote_k)` = 4.027.
Ingen tildeling kan flytte færre ryttere under de præcise kvoter. Verificeret som selvstændig
port (P7), ikke taget på løserens ord.

---

## 2. Reproduktion af D's facit

Målt på den byggede plan-fil, ikke på løserens interne tilstand.

| tal | facit | målt | Δ |
|---|---:|---:|---:|
| flytninger | 4.027 | **4.027** | 0 |
| typeskift i alt | 5.977 | **5.977** | 0 |
| typeskift menneske-ejede | 2.700 | **2.700** | 0 |
| L1 alle | 7,7 | **7,72** | +0,02 |
| L1 menneske-ejede 22+ | 23,6 | **23,65** | +0,05 |
| baroudeur % menneske-ejede 22+ | 11,0 | **10,97** | −0,03 |
| rigtige managere | 192 | **192** | 0 |
| pasnings-rang segment B | 2,56 | **2,561** | +0,001 |

### Den ene ting der så ud som en afvigelse

Briefen siger pasnings-rang segment B = **2,56**. `LOESER/indstillinger.json` siger for D's egen
post **2,663**. Det er ikke to målinger af det samme tal med forskelligt resultat — det er to
konventioner for hvordan ligestillinger tælles, og **begge reproducerer eksakt**:

| konvention | definition | målt |
|---|---|---:|
| sporets (`rankOf` fra sorteringen) | rang = pladsen i den sorterede liste | **2,663** |
| verifikatorens (streng) | rang = 1 + antal typer med strengt højere log-posterior | **2,561** |

Verifikatoren skrev det selv i `LOESER/VERIFIKATION.md`: *"Min rang-værdi ligger 0,06-0,17 under
sporets — ren konventionsforskel ved ligestillinger. Rækkefølgen er identisk under begge
konventioner."* Rapporten her fører **begge** tal, så ingen fremtidig læser genopdager
uenigheden som en fejl.

**Ingen ægte afvigelser fundet.**

---

## 3. Porte på selve planen

Alle syv er skrevet så de kan fejle. §7 beviser det.

| port | resultat |
|---|---|
| **G1** de 6 med eksisterende `archetype_draw` udelades helt | **6 ryttere**, `skrives: false`, 0 felter, tom kolonne-liste, 0 caps-celler ændret, `primary_skifter`/`secondary_skifter` begge `false` |
| **G2** `archetype_draw` bærer BÅDE `primary` og `secondary` | 8.193/8.193, 0 brud |
| **G3** `ability_caps` = repoets `buildCapsForRider(evner, {potentiale, SÆSON-alder}, nyP, nyS)` | **122.895 celler, 0 afvigelser** |
| **G4** alders-kilden er load-bearing | wall-clock ville ændre lofterne for **2.998 ryttere / 36.300 celler** ⇒ G3 er ikke tom |
| **G5** kolonne-blokken utvetydig pr. tabel | `public.riders` → nøgle `id` · `public.rider_derived_abilities` → nøgle `rider_id` · `ability_caps` ligger IKKE på `riders` |
| **G6** backup-skemaet arves fra apply-værktøjet | importeret fra `BACKUP_SKEMA`, ikke afskrevet |
| **G7** D rører kun tildelings-puljen | segment A/C-ankre: 0 afvigelser · de 6: 0 afvigelser · pulje: 2.211 |

Forud for dem: paritets-beviset (§8).

### Kolonne-blokken — B1 lukket på plan-siden

Blokker B1′ var at `rollback.sql`, apply-værktøjet og `skriveplan.json` bar **tre** forskellige
backup-skemaer. Værktøjet har siden fået ét kanonisk `BACKUP_SKEMA`
(`backend/scripts/dev/repair3570Apply.mjs`), som både DDL'en og `rollbackSQL()` genereres af.

`skriveplan-D.json` **importerer det objekt** i stedet for at gentage det, så plan-filen ikke
kan drive fra værktøjet igen. Konkret betyder det tre rettelser mod rev2's plan-fil:

* tabelnavnene er `riders_3570_backup_20260816` / `rider_derived_abilities_3570_backup_20260816`
  (rev2 skrev `…_2026_08_16` med understreger — det navn findes ikke i nogen kørende kode)
* nøglekolonnen står nu eksplicit pr. tabel (`id` mod `rider_id`) — det var netop forvekslingen
* `is_retired` er med i riders-kopien (rev2's liste manglede den)

Pr. rytter er der desuden tilføjet ét additivt felt, `skriver_kolonner`: en eksplicit liste af
`{tabel, noegle, kolonne}` — **tom** for de 6 udeladte. Alle rev2-felter er bevaret uændret, så
formatet er bagudkompatibelt.

### Én ting migrations-forfatteren skal vide

`repair3570Apply.mjs` **læser ikke** `skriveplan.json`. Den har sin egen `buildPlan()`, som
regenererer tildelingen på skrivedagen — og den bygger **rev2's** målfunktion
(`solveAssignment(S, kvoterArr)` der maksimerer fødsels-pasning), ikke D's. Det er korrekt
designet (bestanden driver, listen skal genberegnes), men det betyder at **apply-værktøjets
objektfunktion skal skiftes til D's før den kan køre denne plan.** Ellers skriver den rev2's
tildeling uanset hvad der står i filen. Det står også i planens `skrive_scope`.

---

## 4. Spillervendt effekt — til varslet

### 4.1 Hvor mange mærker det

| | antal | andel |
|---|---:|---:|
| menneske-ejede ryttere i alt | 3.396 | |
| … der skifter synlig primærtype | **2.700** | **79,5 %** |
| menneske-ejede uden testkonti | 3.360 | |
| … der skifter synlig primærtype | **2.677** | **79,7 %** |
| rigtige managere (testkonti ude) | **192** | |

**Median-manageren får 82,6 % af sin trup omdøbt.** p10 = 66,7 %, p90 = 92,3 %.
Yderpunkter: mildest ramte hold 48,1 % (27 ryttere, 13 skift), hårdest ramte 100 % (fem hold).
**Ingen manager slipper med 0 skift.** 99,5 % af managerne får over halvdelen af truppen ændret.
Median-trup er 14 ryttere.

Det er prisen for "intet manager-loft": ejeren valgte præcise mål frem for et tag på hvor meget
én manager må rammes. Tallet skal stå i varslet — det er ikke et tal spillerne skal opdage selv.

### 4.2 Loft-rating før/efter (`ratingFromAbilities(ability_caps, primærtype)`)

Det er tallet spejder-rapporten viser som rytterens loft i sin primærtype
(`scoutingReport.js:51`, `buildTypeCeilingBands`).

**Menneske-ejede (n = 3.396)**

| potentiale | n | median før→efter | p10 før→efter | falder | stiger | værste fald | største stigning |
|---|---:|---|---|---:|---:|---:|---:|
| 1-2 | 1.087 | 47 → 47 | 27 → 28 | 52,2 % | 29,6 % | −7 | +20 |
| 3 | 489 | 71 → 70 | 48 → 47 | 55,6 % | 34,6 % | −7 | +18 |
| 4 | 333 | 86 → 83 | 67 → 67 | 52,9 % | 37,8 % | −13 | +14 |
| 5 | 304 | 99 → 99 | 95 → 93 | 29,6 % | 17,8 % | −11 | +10 |

**AI-ejede + frie agenter (n = 4.797)**

| potentiale | n | median før→efter | p10 før→efter | falder |
|---|---:|---|---|---:|
| 1-2 | 1.973 | 45 → 43 | 31 → 28 | 25,4 % |
| 3 | 698 | 68 → 70 | 52 → 41 | 25,9 % |
| 4 | 369 | 81 → 83 | 66 → 60 | 24,1 % |
| 5 | 196 | 93 → 99 | 89 → 74 | 18,9 % |

**Læg mærke til forskellen.** For menneske-ejede flytter medianen sig 0-3 point og det værste
enkelt-fald er 13. For AI og frie falder p10 med 11-16 point. Det er ikke fordi identiteten
rammer dem hårdere — det er fordi deres persisterede lofter er forældede i forvejen (§5).
Skelnen hører til i varslet: **spillernes egne ryttere flytter sig lidt; markedets ryttere
flytter sig meget.**

### 4.3 Klatre-loftet (#3450 — spillerne spørger til det)

| population | n | hævet | sænket | uændret |
|---|---:|---:|---:|---:|
| alle skrevne | 8.193 | 1.179 (14,4 %) | 3.445 (42,0 %) | 3.569 |
| **menneske-ejede** | 3.396 | **1.117 (32,9 %)** | **245 (7,2 %)** | 2.034 |
| menneske-ejede <22 | 952 | 372 (39,1 %) | 157 (16,5 %) | 423 |
| menneske-ejede 22+ | 2.444 | 745 (30,5 %) | 88 (3,6 %) | 1.611 |
| AI-ejede + frie | 4.797 | 62 (1,3 %) | 3.200 (66,7 %) | 1.535 |

Det korte svar til spillerne: **for jeres egne ryttere hæves klatre-loftet 4,5 gange oftere end
det sænkes** (1.117 mod 245). Det er markedets AI-ryttere der får klatre-loftet sat ned, og det
sker fordi deres lofter aldrig er blevet genopbygget.

### 4.4 T4 "identiteten holder" — 0,00 %, og det betyder intet

| måling | resultat |
|---|---|
| T4: primærtype uændret over 10 nætter med `archetype_draw` skrevet | **0/8.193 brud = 0,00 %** |
| **status** | **TAUTOLOGI.** `resolveRiderTypes()` returnerer `draw.primary` uændret. Porten kan ikke fejle. |
| **kontrafaktisk:** samme ryttere, samme lofter, **uden** draw | **5.034/8.193 = 61,4 % drifter** — menneske-ejede 1.918/3.396 = **56,5 %** |

Den kontrafaktiske måling er den der bærer beslutningen: uden et fast draw skifter **56,5 % af
spillernes ryttere type inden for ti nætter**. Det er problemet #3570 løser. 0,00 % er blot
kvitteringen for at koden gør hvad den siger.

---

## 5. Dekomponeringen — to beslutninger, ikke én

Planen pakker to ting: **hvem rytteren er** (identiteten) og **hvor højt han kan nå**
(loft-genopbygningen). De skal forelægges hver for sig.

### 5.1 Er dagens lofter overhovedet en meningsfuld baseline?

Nej — ikke for AI og frie. Test: for hver rytter er alle **56 (primær, sekundær)-par × {med
sæson-alder, uden alder} = 112 arme** bygget og sammenlignet celle for celle med den persisterede
`ability_caps`.

| population | n | kan IKKE reproduceres af NOGEN kombination |
|---|---:|---:|
| menneske-ejede | 3.396 | **31 (0,9 %)** |
| AI-ejede | 3.473 | 3.133 (90,2 %) |
| frie agenter | 1.330 | 1.140 (85,7 %) |
| **AI + frie** | **4.803** | **4.273 (89,0 %)** |

4.273 reproducerer den anden sessions tal præcist. **De persisterede lofter for AI og frie er
ikke en tilstand nogen kodesti kan producere i dag.** De blev bygget af `backfillCores.js` med
derive-tidens baseline som gulv og uden alder, og `race_day_engine_enabled='off'` betyder at
intet har rørt dem siden. Rettelsen af selve fejlen er merged (#3598 / `1684d842`, i main pr.
`0bab5e25`), men den rører ikke de data der allerede står der.

For **menneske-ejede** er dagens lofter derimod stort set gyldige (0,9 % urekonstruérbare).

### 5.2 Hvor meget af ændringen skyldes hvad

**Ramme A — mod det rekonstruérbare nulpunkt A00** ("gammel type, ingen alder").
Formatet er *ændret % / sænket % / median · p90 · max sænkning*.

| population | (a) identitet alene | (b) alder/gulv alene | (c) begge |
|---|---|---|---|
| alle (8.199) | 88,4 / 82,6 / 32·53·77 | 37,2 / 37,2 / 13·30·71 | 93,3 / 90,3 / 32·53·77 |
| menneske-ejede (3.396) | 94,0 / 87,6 / 30·46·77 | 32,9 / 32,9 / 13·30·54 | 96,2 / 92,0 / 31·48·77 |
| menneske-ejede <22 (952) | 93,8 / 86,4 / 30·48·77 | **0,0 / 0,0** | 93,8 / 86,4 / 30·48·77 |
| menneske-ejede 22+ (2.444) | 94,1 / 88,1 / 30·45·66 | 45,7 / 45,7 / 13·30·54 | 97,2 / 94,1 / 33·47·66 |
| AI-ejede (3.473) | 82,8 / 76,5 / 39·57·77 | 45,4 / 45,4 / 14·33·71 | 90,8 / 88,3 / 38·57·77 |
| frie (1.330) | 88,3 / 85,7 / 26·42·74 | 27,1 / 27,1 / 13·29·50 | 92,3 / 91,2 / 26·43·74 |

**Alders-taperen er præcis nul for menneske-ejede under 22.** Ingen af dem er over peak-alder 28.

**Additiv attribuering af Σ|Δloft| (ægte Shapley, summer eksakt til totalen — restleddet er 0):**

| population | identitet | alder/gulv | Σ|Δ| |
|---|---:|---:|---:|
| alle | **79,3 %** | 20,7 % | 1.413.501 |
| menneske-ejede | 83,2 % | 16,8 % | 629.222 |
| menneske-ejede <22 | 100,0 % | 0,0 % | 157.087 |
| menneske-ejede 22+ | 77,6 % | 22,4 % | 472.135 |
| AI-ejede | 74,5 % | 25,5 % | 622.320 |
| frie | 82,1 % | 17,9 % | 161.959 |

79,3/20,7 reproducerer verifikatorens korrigerede 79,4/20,6 (hans tal var på rev2's tildeling,
mit på D's). Rapportens oprindelige 74,5/25,5 var sti-attribueringen med overlap — den er
forkert, og bruges ikke her.

**Ramme B — mod det spillerne FAKTISK ser i dag (`DB`).** Det er den ramme ejeren skal godkende
efter, fordi den svarer på "hvad ændrer sig for spilleren, og hvorfor".

| population | (b) loft-genopbygning ALENE `DB→A01` | (a) identitetens marginale effekt `A01→A11` | (c) hele planen `DB→A11` |
|---|---|---|---|
| alle (8.199) | 5.469 ændret (66,7 %) | 7.155 (87,3 %) | 7.903 (96,4 %) |
| menneske-ejede | **750 (22,1 %)** | 3.149 (92,7 %) | 3.144 (92,6 %) |
| menneske-ejede <22 | 675 (70,9 %) | 893 (93,8 %) | 884 (92,9 %) |
| menneske-ejede 22+ | **75 (3,1 %)** | 2.256 (92,3 %) | 2.260 (92,5 %) |
| AI-ejede | **3.427 (98,7 %)** | 2.845 (81,9 %) | 3.467 (99,8 %) |
| frie | **1.292 (97,1 %)** | 1.161 (87,3 %) | 1.292 (97,1 %) |

Kolonne (b) er **loft-ændringer der sker uanset hvilken type ejeren vælger.**

### 5.3 De to godkendelser, formuleret

> **Beslutning 1 — identiteten.** 8.193 ryttere får skrevet `archetype_draw`, `primary_type` og
> `secondary_type`. 5.977 skifter synlig type, heraf 2.700 menneske-ejede fordelt på 192 managere
> med median 82,6 % af truppen. Det er ejerens typevalg, og det er hele beslutningen.
>
> **Beslutning 2 — loft-genopbygningen.** 7.899 ryttere får `ability_caps` skrevet. For
> **4.719 af dem** (AI-ejede 3.427 + frie 1.292) sker det af grunde der intet har med typevalget
> at gøre: deres persisterede lofter er ikke rekonstruérbare af nogen type-kombination (4.273 af
> 4.803 = 89,0 %). Genopbygningen er **uundgåelig og uafhængig af beslutning 1** — den skal ikke
> sælges som en del af typevalget. Blandt menneske-ejede over 22 gælder det kun **75 ryttere
> (3,1 %)**; for dem er lofterne stort set gyldige i forvejen, og ændringen ER identitetens.

Praktisk konsekvens: beslutning 2 kan tages separat, og den naturlige plads for AI/frie-armen er
sæsonskiftet 23/8, hvor markedet alligevel nulstilles.

---

## 6. To-trins-anbefalingen — efterprøvet

**Påstanden:** skriv identiteten nu, ikke lofterne, fordi `dailyTrainingEngine.js:314` genopbygger
lofterne ved næste tick til noget bit-identisk med planen, så menneske-ejede selv-heler inden for
ét døgn.

### 6.1 Mekanikken holder

`dailyTrainingEngine.js:314` kalder
`buildCapsForRider(abilities, { ...rider, age }, rider.primary_type, rider.secondary_type)`
med `age = ageForSeason(...)` og skriver resultatet i `abilityPatch.ability_caps` (linje 445).
Præcis samme funktion, præcis samme argumenter som planen.

Målt for de 3.360 menneske-ejede på rigtige hold: **3.360 identiske, 0 afvigende.**

Men det tal er en identitet, ikke evidens — de to kodestier ER den samme. Negativ-kontrol med
perturberede evner (+3 endurance): **154 af 3.360 afviger**, så porten kan fejle. Bit-identiteten
gælder derfor **kun hvis de persisterede evner er uændrede mellem skrivningen og tikket.** Træning
ændrer evner præcis ved tikket, så et skriv samme dag før kl. 22 opfylder betingelsen.

### 6.2 Men den dækker kun 41 %

`trainingSweep.js:78`, med `race_day_engine_enabled = 'off'` (verificeret live, read-only):

```
teams: is_ai=false AND is_bank=false AND is_frozen=false AND is_test_account=false
riders: team_id = holdet AND is_retired=false
```

Frie agenter har intet `team_id` og tikkes **aldrig**. AI-hold og testkonto-hold er filtreret fra.
`daily_training_enabled = 'on'`, så sweepen kører — men kun efter kl. 22 dansk tid, én gang pr.
hold pr. dato.

| | antal | andel af skrevne |
|---|---:|---:|
| heler ved næste tick | **3.360** | **41,0 %** |
| heler aldrig af sig selv | **4.833** | **59,0 %** |
| — AI-ejede | 3.473 | |
| — frie agenter | 1.324 | |
| — testkonto-ryttere | 36 | |

Live prod-kontrol samme dag: 8.019 levende ryttere, hvoraf 3.364 ligger på hold sweepen tikker.

### 6.3 Hullet ingen har målt

Mellem skrivningen og næste tick står rytteren med **ny type og gamle lofter**. Spejder-rapportens
loft-rating bliver `ratingFromAbilities(gamle caps, ny primærtype)` i stedet for
`ratingFromAbilities(nye caps, ny primærtype)`.

| population | ryttere med forkert loft-rating | median | p90 | max | ≥10 point | for højt / for lavt |
|---|---:|---:|---:|---:|---:|---|
| alle skrevne (8.193) | 7.565 (92,3 %) | 8 | 29 | 81 | 3.840 | 1.721 / 5.844 |
| **heler ved næste tick (3.360)** | **2.957 (88,0 %)** | **5** | **26** | **50** | 1.258 | 799 / 2.158 |
| **heler ALDRIG (4.833)** | **4.608 (95,3 %)** | **10** | **31** | **81** | 2.582 | 922 / 3.686 |

**Varighed:** for de helende 12-36 timer (sweepen kører først efter kl. 22, og springer hold der
allerede har tikket i dag). For resten **permanent**.

### 6.4 Dom: NEJ

Besparelsen er reel — 7.899 UPDATE-rækker, 49,1 % af skrive-overfladen, altså den halvering agent 1
lover. Men:

1. **Dækningsgraden er 41 %, ikke "menneske-ejede".** For de 4.833 øvrige er trin 2 ikke udskudt,
   det er udeladt — og netop de ryttere er dem hvis lofter er mest forældede (§5.1).
2. **Hullet lander i det værste døgn.** 2.957 menneske-ejede ryttere ville vise en forkert
   loft-rating (median 5 point, p90 26, max 50) i op til 36 timer — i præcis det døgn hvor ejeren
   lige har varslet spillerne om ændringen. 2.158 af dem vises **for lavt**, altså dårligere end
   de bliver.
3. **Rækketallet er ikke risikoen.** Begge tabeller er dækket af den samme backup og den samme
   rollback, så færre rækker køber ingen ekstra sikkerhed. Ét-trins holder inkonsistensen inde i
   skrivevinduet (90-150 s, målt af den anden session).

**Anbefaling:** skriv begge dele i ét indgreb. Vil ejeren dele beslutningen op, skal delingen gå
på **population** (menneske-ejede nu, AI + frie ved sæsonskiftet 23/8) — ikke på **felt**
(identitet nu, lofter senere). Population-delingen er også den §5 lægger op til.

---

## 7. Negativ-test af plan-generatoren

Kravet: generatoren skal **fejle** på de to kendte historiske defekter og **bestå** på den sunde
reference. Samme portkode kører mod alle tre builds.

| build | G2 (draw bærer begge felter) | G3 (caps med sæson-alder) |
|---|---|---|
| **SUND REFERENCE** | BESTÅR (0/8.193) | BESTÅR (0/122.895 celler) |
| **(a) wall-clock-alder** | BESTÅR | **FEJLER — 36.300 celler / 2.998 ryttere** |
| **(b) kun `primary` i draw'et** | **FEJLER — 8.193/8.193** | **FEJLER — 27.112 celler / 6.202 ryttere** |

**Skaden ved (a):** 2.940 ryttere ville få en forkert loft-rating, median 6 point, max 18 — og
**alle 2.940 for højt**. Wall-clock-alderen er lavere end sæson-alderen i sæson 2, så taperen
underdriver og lofterne bliver for høje. 482 ryttere er unge (<22) i wall-clock men 22+ i
sæson-alder. Det var blokker 1 i natbølgen.

**Skaden ved (b):** `resolveRiderTypes()` honorerer `draw.primary`, men falder tilbage til
klassifikatorens næstbedste når `draw.secondary` mangler.

| måling | rev2 | D |
|---|---:|---:|
| anden biType end planen, steady state (mod de skrevne lofter) | 2.672 (32,6 %) | **2.872 (35,1 %)** |
| anden biType end planen, i skrivevinduet (mod de gamle lofter) | 6.143 (75,0 %) | **6.341 (77,4 %)** |

Reproduktionen af rev2's tal rammer 2.672 mod de rapporterede 2.674 — to rytteres forskel,
formentlig en definitionsdetalje, ikke en uenighed. Under D er tallet højere, fordi D flytter
flere ryttere væk fra klassifikatorens egen rangering. Følgeskaden: 6.202 ryttere ville få andre
lofter, 4.990 en anden loft-rating (median 2 point, max 10).

**Samlet: GYLDIG.** Sund reference består, begge kendte defekter fejler.

Instrumentet i §5 er negativ-testet på samme måde: (a) `ny type := gammel type` ⇒ identitets-bidrag
= 0 (og alders-bidrag = 398.985, altså ikke tomt), (b) `age` udeladt overalt ⇒ alders-bidrag = 0
(identitets-bidrag = 1.226.087), (c) wall-clock skelnes fra sæson-alder (398.985 mod 265.165,
3.009 ryttere forskellige). Alle tre består.

*(Sidebemærkning: rev2-rapporten havde de to tal i (c) byttet om. Sæson-alder = 398.985,
wall-clock = 265.165. Verifikatoren fandt det; det bekræftes her.)*

---

## 8. Paritets-bevis

Kørt **før** nogen tal blev talt.

| port | resultat |
|---|---|
| **P1** harnessens klassifikator + resolve mod repoets `computeRiderTypes`/`resolveRiderTypes` | **16.398 sammenligninger, 0 afvigelser** |
| **P2** snapshottets `age` ER sæson-alder | verificeret af `loadSnapshot` (kaster ellers); afviger fra wall-clock for alle 8.199; 1.876 unge i sæson-alder mod 2.358 i wall-clock |
| **P3** #3592's nær-par-præmis mod repoets egne vægte | alle fire holder; 0 ikke-listede delmængde-par |
| **P4** rev2's `ability_caps` reproduceres med dagens repo | **122.895 celler, 0 afvigelser** |
| **P5** rev2's `rating_efter` reproduceres | 8.199, 0 afvigelser |
| **P6** univers-roller matcher rev2's kilde-optælling | pulje 5.611 · låst 2.582 · frossen 6 |
| **P7** flytninger = kombinatorisk minimum | 4.027 = 4.027, dualitetsgab 0 |
| **P8** determinisme: to uafhængige kørsler af generatoren | `ryttere`-arrayets sha1 identisk (`1cafd0a9…5c72`) |

Ingen klassifikator, caps-kæde eller værdikæde er genimplementeret. Alt går gennem
`night-3570/lib/kandidatHarness.mjs`, som importerer repoets funktioner uændret via absolut
`file://`-URL fra `C:/Dev/CyclingZone` (main, `0bab5e25` — indeholder #3598 / `1684d842`).

P4 er den port der kunne have fanget et repo-skifte under os: rev2's plan blev bygget kl. 11:35,
og `riderProgression.js` har ikke flyttet sig siden (`c73fce72`). #3598 rørte `backfillCores.js`,
ikke caps-kæden.

---

## 9. Forbehold

1. **Populationen driver.** Snapshottet har 8.199 ryttere; prod havde 8.019 da denne rapport blev
   skrevet. `aiTeamTrimHealSweep` fjerner overskydende AI-hold hvert 5. minut efterhånden som
   spillere kommer til — **by design**, og de 180 forsvundne er 100 % AI-ejede. Planen er
   beslutningsgrundlaget, ikke UPDATE-listen; apply-værktøjet genberegner på skrivedagen.
2. **Apply-værktøjet bygger rev2's målfunktion, ikke D's.** Skal skiftes før kørsel (§3).
3. **Reparationen er ikke kørt og må ikke køres herfra.** Den er ejer-gated.
4. **`team_name` mangler i snapshottet** (0 af 6.869 med `team_id` har det). `manager_display_name`
   er brugt i stedet — det er det navn managerne kender.
5. **Pasnings-rang er stadig det eneste ikke-tautologiske identitetsmål** i materialet. κ er en
   monoton funktion af antal flytninger og bærer ingen selvstændig information; den er ikke brugt
   her.
6. **Et parallelt spor arbejder i apply-værktøjet mens dette skrives** (`D-plan/vaerktoej/`).
   Planens backup-blok blev importeret fra `BACKUP_SKEMA` kl. 15:35 og er verificeret identisk med
   værktøjets ved rapportens afslutning. Ændrer det spor skemaet, skal `20-byg-D.mjs` køres igen
   — den er deterministisk (P8), så det koster ét minut og ændrer intet andet.
7. **Hoved-checkoutet flyttede sig under kørslen** (`0bab5e25` → `3314ffea`, fem docs/CI-commits).
   Ingen af de otte repo-libs harnessen bruger er rørt (`git diff --stat` tom), så paritets-beviset
   i §8 gælder stadig mod nuværende HEAD.

---

## 10. Det ejeren skal tage stilling til

1. **Beslutning 1 — identiteten.** Godkend D's tildeling: 5.977 typeskift, 2.700 hos menneske-ejede,
   median-manager 82,6 % af truppen. Ingen manager slipper fri.
2. **Beslutning 2 — loft-genopbygningen.** Godkend separat. For 4.719 AI-ejede og frie sker den
   uanset typevalget. Kan lægges ved sæsonskiftet 23/8 i stedet.
3. **Ét-trins eller population-delt?** Anbefaling: ét-trins for menneske-ejede nu. Felt-delingen
   (identitet nu, lofter senere) frarådes med tal i §6.
4. **Varslet** skal indeholde: median-manager-tallet (82,6 %), at klatre-loftet oftest **hæves**
   for spillernes egne ryttere (1.117 mod 245), og at markedets AI-ryttere flytter sig langt mere
   end spillernes egne.
