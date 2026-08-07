# #3458 Fase 2 — Eftersyn af type-rating-formlernes vægte

**Status:** READ-ONLY beslutningsmateriale. Ingen filer i repoet er ændret, ingen DB-writes, ingen issues/PR'er.
**Dato:** 2026-08-07
**Grundlag:** `docs/superpowers/specs/2026-08-06-ryttertype-fundament-v2-design.md`, `backend/lib/riderTypes.js`, `backend/lib/abilityDerivation.js`, `backend/lib/riderProgression.js`, `backend/lib/scoutingReport.js`, `backend/lib/riderValuation.js`, `measureBestType3372.js`/`measureNormalizedTypes3372.js` (kørt live mod prod) + en ny lokal variant-måling (`scratchpad/variantWeightMeasure.mjs`, kørt mod prod, kun SELECT).

---

## 1. Metode

1. **Baseline-genkørsel** af de to eksisterende måle-scripts mod prod (n=6.749 human-ejede, ikke-pensionerede ryttere med `primary_type` sat) — bekræfter spec'ens 6/8-tal og giver et frisk udgangspunkt.
2. **Ny variant-måling** (`scratchpad/variantWeightMeasure.mjs`): genbruger `scoreRiderType`, `GUARDS` og `riderTypesBaseline.json` fra repoet uændret, men injicerer 3 kandidat-vægttabeller lokalt (ingen repo-filer rørt). Klassificerer **hele populationens ægte, persisterede `ability_caps`** (ikke en kontrafaktisk "hvad-nu-hvis"-cap som `measureBestType3372.js` gør) — dette er den mekanisme der rent faktisk bestemmer `primary_type` i produktion (`computeRiderTypes`/`backfillRiderTypes.js`).
3. **outputScore-delta** (0-99-skala, `riderValuation.outputScore`) beregnes pr. rytter på **live abilities** (ikke caps) — dette er indgangen til `predictBaseValue`, så delta'en er en direkte proxy for hvor meget en vægtændring flytter `base_value`.

Vigtig metodisk pointe, fordi de to baseline-scripts og variant-målingen bruger **forskellige mekanismer** og derfor giver forskellige tal, der ikke må sammenblandes:

| Måling | Mekanisme | Spørgsmål den svarer på |
|---|---|---|
| `measureBestType3372.js` | Kontrafaktisk: `buildCapsForRider(abilities, …, t, null)` for hver af de 8 typer `t`, derefter `ratingFromAbilities` | "Hvis alle ryttere blev omklassificeret til deres bedst mulige rolle, hvordan ville fordelingen se ud?" (= risikoen ved en fremtidig generator/reklassificering, IKKE dagens tilstand) |
| `measureNormalizedTypes3372.js` | Samme kontrafaktiske caps, men percentil-normaliseret pr. rolle | Samme spørgsmål, på en skala hvor "80" betyder det samme i alle 8 roller |
| **Ny variant-måling** | `computeRiderTypes` på **faktiske, persisterede** `ability_caps` | "Hvordan ser DAGENS DB-klassifikation ud under vægtsæt X — og hvor mange ville reelt skifte type, hvis man kørte samme klassifikator igen med nye vægte?" |

---

## 2. Baseline-tal (bekræftet live 7/8, n=6.749 — matcher spec'ens 6/8-måling)

**Kontrafaktisk argmax (measureBestType3372.js):**
Tildelt primær = bedste kontrafaktiske rolle: **26,5 %** (top-2: 37,3 %). Gap median 3, P90 7, max 18.
Fordeling hvis alle fik deres argmax-rolle: `baroudeur 77,3 % · gc 15,2 % · sprinter 5,0 % · climber 1,3 % · rouleur 0,5 % · tt 0,3 % · puncheur 0,2 % · brostensrytter 0,2 %` — **bekræfter #3325-kollapset 1:1** med spec'en.

**Normaliseret (measureNormalizedTypes3372.js):** Tildelt = normaliseret bedste: **10,7 %** (top-2: 20,3 %). Specialiserings-dybde median **0** (62,2 % har bogstaveligt dybde 0).

**NB — vigtig kontekst der IKKE står eksplicit i spec'en:** min egen kontrolmåling af **dagens faktiske DB-klassifikation** (samme vægte, men på ægte caps i stedet for kontrafaktiske) viser en langt sundere fordeling end 77/15-kollapset: `baroudeur 32,1 % · climber 26,3 % · sprinter 18,8 % · tt 11,2 % · gc 5,3 % · puncheur 2,9 % · brostensrytter 2,5 % · rouleur 0,9 %`. Det 77/15-kollapset er altså en advarsel om hvad der sker HVIS man reklassificerede alle mod deres "ideelle" rolle (præcis derfor Del C afviser det) — det er ikke en beskrivelse af dagens spil. Dagens reelle problem er smallere, men stadig ægte: **rouleur (0,9 %) og brostensrytter (2,5 %) er under ejerens ~5 %-gulv, og gc (5,3 %) balancerer lige på kanten.**

---

## 3. Kritisk gennemgang pr. type

### Sprinter — `acceleration:3, sprint:2, flat:1, durability:1, climbing:-2, endurance:-1`
- **Kritik:** Formen er velbegrundet fysiologisk (spidskraft + flad udholdenhed), men mangler enhver form for **positionering/lead-out-evne** — i virkeligheden er en sprinters resultat lige så meget positionering ind til de sidste 200 m som ren spidsfart (Biketips/PCS-taksonomien nævner "lead-out"-rollen eksplicit). Spillets `positioning`-evne findes allerede (afledt i `abilityDerivation.js`), men er **strukturelt udelukket** fra `ABILITY_KEYS` (se afsnit 4) — sprinteren kan derfor aldrig belønnes for det.
- **Anbefaling (kræver Fase 2's ABILITY_KEYS-udvidelse, se afsnit 4):** tilføj `positioning` som lav-til-moderat positiv vægt (fx +1) når/hvis `positioning` optages i `ABILITY_KEYS`. Uden den udvidelse: ingen ændring anbefalet — formen er intern konsistent og velisoleret (0 % lækage i mine variant-målinger, se afsnit 5).

### TT — `time_trial:3, climbing:-2, sprint:-1, punch:-1`
- **Kritik:** Bevidst smal (kun ÉT signatur-tal), med tre negative vægte der specifikt forhindrer overlap med gc (dokumenteret i kildekoden, #1122). Det matcher PCS' "TT-specialist"-kategori, som reelt IKKE deler point med andre kategorier i PCS' system. Ingen mangler fundet — formen er den mest "ærlige" af de otte (høj neg/pos-ratio ≈1,33, dvs. den straffer bredt og korrekt).
- **Anbefaling:** ingen ændring. Bekræftet i mine målinger: 0 lækage til/fra tt i "baroudeur_fix"-kandidaten (som ikke rørte tt) — tt's fordeling var byte-identisk.

### Climber — `climbing:3, tempo:2, punch:1, endurance:1, sprint:-1`
- **Kritik:** Mangler `recovery`. En ren klatrer i virkeligheden er ikke kun defineret af watt/kg på en enkelt stigning, men af evnen til at levere den samme præstation dag efter dag i en bjergetape-blok (jf. GT-truppelogik-kilderne i spec'ens afsnit 6). I dag har KUN `gc` recovery som signaturevne — hvilket betyder klatrere og GC-ryttere kun adskilles på `time_trial` og `recovery` (og guarden), selvom en "ren" klatrer-stage-hunter (uden GC-ambition) reelt også har brug for recovery mellem summit-finishes.
- **Mangler også `descending`** (teknisk nedkørsel efter bjergtoppe er en reel færdighed der adskiller topklatrere som Pogačar/Vingegaard) — men `baroudeur` har allerede `descending` som signatur, så at give climber samme evne risikerer at udvande netop det signal der adskiller de to typer. **Vurderet og bevidst fravalgt** i mine kandidater af den grund.
- **Anbefaling:** tilføj `recovery:1` (lav vægt — climber skal stadig ligge klart under gc's `recovery:2`, så guarden forbliver meningsfuld).

### Puncheur — `punch:3, tempo:2, endurance:1, time_trial:-1, sprint:-1`
- **Kritik:** Solid, matcher "puncheur/classics"-kategorien i alle tre research-kilder (PCS, CyclingScoop, Biketips). Eneste svaghed: ingen teknisk differentiering fra `baroudeur` på kuperet terræn — begge kan score højt på et Amstel/Flèche-agtigt profil. `descending` blev afprøvet som tilføjelse (se kandidat "full") men **målingen viser det TRÆKKER ryttere væk fra puncheur mod baroudeur/gc** i stedet for at styrke puncheur (677→516 i argmax under "full" vs. "conservative") — sandsynligvis fordi `descending` allerede er signatur for baroudeur (og i "full" også for gc), så tilføjelsen skaber ny konkurrence i stedet for at løse noget. **Konkret lærdom: at give samme evne til flere typer samtidig kan forværre overlap i stedet for at forbedre det.**
- **Anbefaling:** ingen ændring uden dybere afprøvning — `descending` bør IKKE tilføjes uden at fjerne den fra en konkurrerende type samtidig.

### Brostensrytter — `cobblestone:6, flat:2, endurance:1, punch:1, climbing:-1`
- **Kritik:** `cobblestone:6` er ikke i sig selv problematisk i kontrast-formlen (vægtet gennemsnit er skala-invariant — det er *proportionen* der tæller: cobblestone udgør 60 % af brostensrytterens positive vægtsum, mod fx climberens 43 % på `climbing`). Det reelle problem er at **brostensrytteren dermed er den mest monolitiske af alle 8 typer** — næsten hele scoren hviler på én evne. Virkeligheden (Roubaix/Flandrien-litteraturen) viser at brostens-specialister også kræver ekstrem robusthed/holdbarhed (durability) — evnen til at holde balance og kraft gennem 250 km brostensbrutalitet — hvilket IKKE er repræsenteret i dag.
- **Anbefaling:** tilføj `durability:1`. Lav neg/pos-ratio (0,10) betyder typen er "let" at ramme, men den rammes alligevel ikke af nok ryttere (kun 2,5 % i dag) — det tyder på at **populationens faktiske cobblestone-caps-fordeling** (ikke selve vægtformlen) er den bindende begrænsning, hvilket peger tilbage på Del A (generator) som den egentlige løsning, ikke yderligere vægt-justering her.

### Baroudeur — `aggression:3, flat:1, punch:1, endurance:1, descending:1, recovery:1, time_trial:-1`
- **Kritik — den klart mest problematiske formel:** 6 positive signaturevner (flest af alle 8 typer, delt kun med gc) mod kun ÉN svag negativ vægt (`time_trial:-1`, neg/pos-ratio 0,125 — næstlavest efter brostensrytter). Wikipedia-kilden i spec'en er eksplicit: *"breakaway specialist"* er en **taktisk rolle**, ikke en fysiologisk arketype — enhver fysiologi kan i princippet være baroudeur. Formlen afspejler det for godt: den straffer næsten intet, og signaturevnen `aggression` er selv bredt fordelt (skill-stat + ungdoms-bias, `0.85·pcmFrac(stat_ftr) + 0.15·youth` — se `abilityDerivation.js:213`), så den diskriminerer dårligt. Dette er hovedårsagen til #3325-kollapset (77 % under kontrafaktisk argmax).
- **Anbefaling:** (a) sænk `aggression` fra 3→2 (reducer dens dominans i den vægtede sum), (b) tilføj 2-3 flere svage negative vægte (`sprint:-1, climbing:-1, tempo:-1`) — en ægte baroudeur er hverken sprinter, klatrer eller tempo-rytter, kun en opportunist. Isoleret målt ("baroudeur_fix"-kandidaten, se afsnit 5): dette ALENE flytter baroudeurs andel af dagens faktiske klassifikation fra 32,1 %→21,8 % og løfter puncheur fra 2,9 %→7,7 % — uden at røre nogen anden type.

### Rouleur — `flat:4, endurance:1, climbing:-1, sprint:-1`
- **Kritik:** Allerede opjusteret i #3325 (flat 2→4) for at komme over gulvet — men er stadig den TYNDESTE type i dagens faktiske klassifikation (0,9 %). Formlen er monolitisk på `flat` (80 % af positiv vægtsum). Research-kilderne (theconversation.com, inrng.com) beskriver rouleuren/domestiquen som pelotonets "rygrad" — en bred arbejdshest-profil, ikke en snæver specialist. Det argumenterer for BREDERE (ikke smallere) positiv vægtfordeling, fx `durability` (evnen til at arbejde hele løbet igennem for kaptajnen).
- **VIGTIGT NEGATIVT FUND (fra min måling):** i "full"-kandidaten forsøgte jeg at tynde `flat`-vægten ud (4→3) og tilføje `durability:1` — resultatet var **VÆRRE**, ikke bedre: rouleur faldt fra 60→37 ryttere (0,9 %→0,5 %). At udvande den ene stærke diskriminator uden at kompensere kraftigt nok gør typen SVAGERE i konkurrencen mod de andre 7. **Konklusion: rouleur skal ikke udvandes — hvis den skal styrkes, skal det være en TILFØJELSE oven på `flat:4`, ikke en omfordeling væk fra den.** Dette er en konkret lærdom fra den empiriske måling, ikke kun teori.
- **Anbefaling:** behold `flat:4` uændret; hvis rouleur skal styrkes, afprøv `durability` som en RENT ADDITIV 5. vægt (ikke en omfordeling) i en fremtidig iteration — ikke gjort i mine 3 kandidater, da det kræver egen isoleret måling.

### GC — `climbing:3, time_trial:3, recovery:2, tempo:2, endurance:1, durability:1, sprint:-2`
- **Kritik 1 (mangler descending):** Den mest komplette moderne GC-profil (Pogačar, Vingegaard) vinder i stigende grad tid på **teknisk nedkørsel**, ikke kun opad. `descending` er slet ikke i gc's formel i dag.
- **Kritik 2 (guard, ikke vægt — men lige så vigtig):** `GUARDS.isGc` kræver `punch ≤ time_trial`. Det betyder **en rytter med høj klatring + tt + recovery MEN OGSÅ høj punch kan aldrig blive klassificeret gc** — han bliver i stedet climber eller puncheur. Spec'ens egen kilde (CyclingScoop "Sorting Hat") fremhæver netop at de bedste moderne ryttere (Pogačar, Van Aert) er *"transcenderende anomalier"* der ikke passer i én kasse — men her er systemet designet til aktivt at UDELUKKE den mest eksplosive, punchy GC-arketype fra selve GC-kassen. Dette kan være et bevidst valg (for at forhindre "høj i alt = altid gc"-kollaps), men bør eksplicit ejer-bekræftes, ikke bare arves stiltiende — det er ikke en vægt-fejl, men en definitions-beslutning der er let at overse.
- **Anbefaling:** tilføj `descending:1` (eller `2` i en mere aggressiv variant). Guard-spørgsmålet (punch≤tt) anbefales taget op eksplicit med ejeren som en separat, lille beslutning — ikke løst stiltiende i denne rapport.

---

## 4. Strukturelt fund: `positioning` og `tactics` kan aldrig indgå i nogen type-formel

`abilityDerivation.js`'s `VISIBLE_ABILITIES` har 15 evner (inkl. `positioning`, `tactics`), men `riderTypes.js`'s `ABILITY_KEYS` — den liste type-formlerne, guards, `outputScore` og `riderTypesBaseline.json` overhovedet KAN referere — har kun **13** evner. `positioning` og `tactics` er ikke "vægtet 0" i nogen formel, de er **fysisk umulige at vægte**, fordi der ikke findes en baseline mean/std for dem i `riderTypesBaseline.json`, og `scoreRiderType` ville falde tilbage til NEUTRAL_BASELINE (mean 0, std 1) hvis man forsøgte — hvilket ville forvride z-scoren for alle typer der brugte dem.

Dette er sandsynligvis et bevidst design (`abilityDerivation.js`'s kommentarer skelner eksplicit mellem "fysiske" evner, som CONTRAST-mekanismen opererer på, og "tekniske/mentale", som ikke er en del af mætnings-problemet) — men det betyder konkret at **sprinterens lead-out-positionering og baroudeurens/rouleurens taktiske snilde aldrig kan blive en del af deres identitet**, selvom evnerne findes og vises for spilleren. Anbefales taget op som en selvstændig beslutning i Fase 2 (kræver en baseline-refit hvis den skal ind, ikke kun en vægt-tilføjelse) — ikke løst her.

---

## 5. Kandidat-vægtsæt — empirisk målt (n=6.749, ægte persisterede caps)

Tre kandidater afprøvet mod **dagens faktiske klassifikationsmekanisme** (`computeRiderTypes` på ægte `ability_caps` + eksisterende `riderTypesBaseline.json`, guards uændrede i alle 3):

| Kandidat | Ændringer | Baroudeur-andel | Min/max typeandel | Skifter type vs. i dag | Dybde (z, median) | outputScore-delta (median / P90 / max) |
|---|---|---:|---:|---:|---:|---:|
| **Kontrol** (dagens vægte) | — | 32,1 % | 0,9 % / 32,1 % | — | 0,552 | — |
| **1. Konservativ** | +recovery(climber), +descending(gc), +durability(brosten), +3 neg-vægte(baroudeur) | 21,6 % | 1,3 % / 24,2 % | 15,1 % | 0,623 | 0 / 0,63 / 33,68 |
| **2. Baroudeur-fix (isoleret)** | KUN baroudeur: aggression 3→2, +3 neg-vægte | 21,8 % | 1,3 % / 26,3 % | 10,4 % | 0,642 | 0 / 0,07 / 33,68 |
| **3. Fuld** | Konservativ + baroudeur-fix + puncheur(+descending) + rouleur(flat 4→3, +durability) | 22,1 % | **0,5 %** / 24,2 % | 14,3 % | 0,640 | 0 / 0,93 / 33,68 |

**Nøglefund:**
- **Baroudeur-problemet er isoleret og billigt at fixe:** kandidat 2 rører KUN baroudeurs egen formel og opnår næsten samme effekt som den fulde konservative kandidat (baroudeur 32,1 %→21,8 % vs. →21,6 %), med kun halvdelen af populations-forstyrrelsen (10,4 % skifter type vs. 15,1 %). **Dette er den mest kirurgiske, lavest-risiko intervention.**
- **Ingen af de tre kandidater løser rouleur/brostensrytter-gulvet** (begge forbliver <5 % i alle tre varianter — brostensrytter 2,4-2,5 %, rouleur 0,5-1,3 %). Det bekræfter spec'ens egen konklusion: **gulv-problemet for DEN EKSISTERENDE population er strukturelt (populationens caps-fordeling selv), ikke retteligt via vægt-justering alene** — det er Del A (generator med arketype-prior), ikke Del B/Fase 2, der kan løse det for fremtidige ryttere. For eksisterende ryttere er der efter Del C ingen vej uden om at gulvet forbliver skævt, indtil populationen udskiftes naturligt.
- **"Fuld"-kandidaten er ikke strengt bedre end de mindre kandidater** — den forværrer faktisk rouleur (0,9 %→0,5 %) pga. rouleur-omfordelingen (se afsnit 3), og forstyrrer 14,3 % af populationens type i alt uden en tilsvarende gevinst i dybde eller gulv-opfyldelse ift. kandidat 1/2.
- **outputScore-delta har en tung hale i alle tre kandidater** (max ≈ +33,7 point på en 0-99-skala, mens medianen er 0) — de fleste ryttere er upåvirkede, men et lille antal individuelle ryttere kan opleve dramatiske værdi-forskydninger. Med V4-modellens `b≈0,101` ville et outputScore-hop på 34 point isoleret svare til en `exp(0,101×34) ≈ 31×`-multiplikator på `base_value` for netop den rytter — et kraftigt argument for at **G7 (markedsfit-revalidering) er obligatorisk**, ikke valgfri, uanset hvor lille kandidaten er.

---

## 6. Anbefaling

**Vælg Kandidat 2 (Baroudeur-fix, isoleret) som Fase 2's første leverance**, eventuelt efterfulgt af de øvrige konservative tilføjelser (climber+recovery, gc+descending, brostensrytter+durability) som en **separat, selvstændig commit** — ikke i samme skridt. Begrundelse:

- Baroudeur-problemet er den dokumenterede hovedårsag til #3325-kollapset (77 % af kontrafaktisk argmax) og er nu isoleret empirisk til ÉN types formel — laveste risiko, størst gevinst pr. ændring.
- De øvrige tilføjelser (climber/gc/brostensrytter) er research-begrundede, men bør måles ÉN AD GANGEN (som "fuld"-kandidatens rouleur-lektion viser: gode intentioner kan give uventede modsatrettede effekter når flere typer ændres samtidig).
- **Rouleur bør IKKE røres** i første omgang — mit forsøg på at styrke den gjorde den svagere; den kræver en selvstændig, isoleret afprøvning af en RENT additiv 5. vægt, ikke en omfordeling.
- **`positioning`/`tactics`-udvidelsen (afsnit 4) er en større, selvstændig beslutning** (kræver ny baseline-refit) og hører hjemme som en separat ejer-samtale, ikke bagt ind i vægt-justeringen.
- **Gulv-problemet for rouleur/brostensrytter (dagens population) lukkes IKKE af nogen af kandidaterne** — kommuniker det eksplicit til ejeren som en forventning, ikke en overraskelse: det er Del A's (generator) opgave, ikke denne fases.

---

## 7. Konsekvens-afsnit

**Hvad SKAL følge med en vægtændring (uanset hvilken kandidat):**
1. **`typeRatingCalibration.json` skal genopbygges** (`scripts/buildTypeRatingCalibration.js`) — de viste ratings er kalibreret mod DE NUVÆRENDE vægte; enhver vægtændring flytter `ratingFromAbilities`-outputtet og gør den frosne kalibrering forkert (Del B's "absolut skala"-løfte til spillerne holder ikke længere uden genopbygning).
2. **G7-revalidering af #3448's markedsfit ER OBLIGATORISK, ikke situationel** — se outputScore-delta-halen i afsnit 5 (op til ~31× enkelt-rytter-forskydning i teori). #3448 (markedsdrevne værdier) går live søndag 9/8 med 50/50-blend og lærer ugentligt af markedet — en type-vægtændring der rammer FØR eller UNDER den indkøringsperiode vil kontaminere v1.1-modellens fit, fordi modellen ikke kan skelne "markedet lærte noget nyt" fra "vægtformlen ændrede sig under fødderne på den".
3. **Timing: EFTER 9/8-base_value-snapshottet**, og helst efter markedsmodellens første par ugentlige refits har stabiliseret sig (#3448's leveranceplan punkt 5) — ikke samtidig med eller lige før 9/8-blenden.
4. **Patch notes + help.json (en+da)** hvis viste ratings flytter sig mærkbart for spillerne (Del B/Fase 3's kommunikations-pakke dækker dette, men en efterfølgende vægtændring bør nævnes eksplicit hvis den sker efter Fase 3 er sendt).

**Hvad IKKE sker (Del C, uændret af denne rapport):**
- **Ingen reklassificering af eksisterende ryttere.** `primary_type`/`secondary_type`/`ability_caps`/`potentiale` for de 6.749 målte ryttere røres ikke — variant-målingens "15,1 % skifter type"-tal (kandidat 1) er en **teoretisk eksponering** (hvad der ville ske HVIS man kørte klassifikatoren igen), ikke noget der udføres. `riders.valuation_type`-frysningen (#3345) fortsætter uændret indtil #3448's markedsmodel afvikler den ved sæsonskiftet 23/8.
- **Ingen ændring af `buildCapsForRider`'s rolle-faktorer (1,0/0,82/0,45/0,12)** — denne rapport dækker kun `RIDER_TYPES`-vægtene, ikke progressions-mekanikken. En vægtændring i `RIDER_TYPES` PÅVIRKER dog automatisk `youthRoleFactor` (samme `WEIGHTS_BY_TYPE`-kilde), så nye ryttere født efter en vægtændring vil få deres caps formet af de nye vægte — det er tilsigtet (og præcis Del A's pointe: vægtene er den samme formnings-prior for alle fire forbrugere), men bør stå eksplicit i PR-beskrivelsen så ejeren ikke overraskes af sideeffekten.
