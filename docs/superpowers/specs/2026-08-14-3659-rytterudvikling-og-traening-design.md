# Design: rytterudvikling og træning skal kunne stoles på

**Issue:** [#3659](https://github.com/NicolaiDolmer/CyclingZone/issues/3659) · **Dato:** 2026-08-14 · **Form:** design-session, ingen kode
**Status:** 13 ejer-beslutninger truffet. Måling gennemført mod dateret snapshot. Klar til leveranceplan.

> Prompt-dokumentet der startede sessionen: [`docs/sessions/2026-08-14-traening-og-udvikling-designsession-prompt.md`](../../sessions/2026-08-14-traening-og-udvikling-designsession-prompt.md)

---

## 1. Hvad problemet viste sig at være

Ejeren bad om, at lofterne skulle holde op med at blokere, og at farten skulle være det, der styrer. Målingen viser, at farten **allerede** styrer — `dailyAbilityDelta` vokser proportionalt med afstanden til loftet — og at det derfor ikke var problemet.

Det egentlige problem ligger et lag dybere, og det blev målt sådan her:

| Program (hele karrieren, samme rytter) | Bedste evne ved 30 år |
|---|---:|
| Rigtigt fokus, normal intensitet | 59 |
| Rigtigt fokus, let intensitet | 58 |
| **Forkert** fokus | 56 |
| Hvile hver dag | 20 |

**Forskellen mellem at træne rigtigt og forkert i en hel karriere er 3 point ud af 60.** Intensiteten er 1 point værd. Det eneste valg, der flytter noget, er "hvil eller lad være".

Årsagen er, at hver evne mætter sit loft inden for karrieren under **alle** indstillinger. Raten bestemmer kun, hvornår rytteren ankommer, og ti sæsoner er rigeligt uanset hvad manageren gør. Slutresultatet blev afgjort ved genereringen — af type og potentiale.

Det ærlige svar på "kan managers stole på rytterudviklingen" er derfor: **de kan stole fuldstændig på den. Den er bare ikke deres.** Loft-teksterne (`focusOptionCapped`, `focusCappedTitle`, `focusPartiallyCappedTitle`) er ikke problemet — de er stedet, hvor spilleren opdager det.

### Muren, målt

Under dagens model rammer en neutral evne sit loft som 22-årig og står derefter stille i **seks sæsoner**, før forfaldet sætter ind. For en sprinter med potentiale 3 er **11 af 15 evner** låst på 27 eller derunder, mens hans fire signatur-evner går til 60.

### To evner ingen kan røre

Målt over alle otte typer i `capsShapingWeights.js`:

- `positioning` og `tactics` har positiv vægt hos **nul af otte typer**. Ingen ryttertype låser dem op. Hver eneste rytter er derfor låst på `0,45 × grundloft` på dem, for altid.
- `tactics` og `aggression` trænes af **intet fokus**. `tactics` er dermed spillets mest låste evne: ingen type ejer den, intet fokus træner den. `aggression` er baroudeurens tungeste evne (vægt 3) og kan ikke vælges af nogen manager.

---

## 2. Den valgte model

### 2.1 Rolleklasser

Hver (rytter, evne) hører til én af fem klasser, udledt af `capsShapingWeights.js`:

| Klasse | Definition | Eksempel for en sprinter |
|---|---|---|
| `signatur` | positiv vægt i primærtype | acceleration, sprint, flat, durability |
| `sekundaer` | positiv vægt i sekundærtype | (afhænger af sekundær) |
| `haandvaerk` | `positioning`, `tactics` — ingen type ejer dem | positioning, tactics |
| `andenRolle` | vægt 0, men ejet af mindst én anden type | tempo, punch, time trial, cobblestone |
| `svaghed` | negativ vægt | climbing, endurance |

### 2.2 To knapper i stedet for én

Loftet gør i dag to ting: det sætter både **hvor højt** og **hvor hurtigt** (fordi væksten er gap-proportional). De skilles ad.

| Klasse | Tag (× `loftByPotential`) | Rate |
|---|---:|---:|
| `signatur` | 1,30 | 0,45 |
| `sekundaer` | 1,10 | 0,36 |
| `haandvaerk` | 0,95 | 0,22 |
| `andenRolle` | 0,70 | 0,15 |
| `svaghed` | 0,20 | 0,05 |

`offFocusMult`: **0,97 → 0,35**.

Begge håndtag er nødvendige. Negativ-testen nedenfor beviser det.

### 2.3 Nyt fokus: løbslære

| Fokus | Evner |
|---|---|
| **løbslære** (ny) | positioning, tactics, aggression |
| technique | descending, cobblestone |

De øvrige fem fokus står uændret. **Bemærk:** fokusene er allerede ulige store (`endurance` træner tre evner, `sprint` og `aero` to). Så længe fokus næsten intet betød, var det ligegyldigt. Under den nye model bliver størrelsen et balance-håndtag og skal kalibreres, ikke arves.

### 2.4 Akademi og senior bliver én model

`ACADEMY.INTERIM_RATE_MULT` (1/3) og `computeAcademySeasonCeiling` (sæson-loft 16 %/11 %/8 % efter alder) fjernes. De fandtes kun for at bremse en model, der mættede. Akademiet adskiller sig herefter **kun** ved `youthMultiplier` — 1,50 ved 16 år, aftagende til 1,00 ved 22.

Akademiet var i praksis allerede den model, vi nu vælger. Den midlertidige knap fra #2437 forsvinder efter at have løst sit problem permanent.

### 2.5 Ingen rytter når sit tag

Taget bliver "hvad han kunne være blevet". Manageren afgør, hvor tæt rytteren kommer, og på hvilke evner. Målt: andelen af taget nået falder fra median **1,00** til **0,82**.

---

## 3. Scorecard

Population: `docs/snapshots/3591/riders_full.json`, taget 2026-08-13 (spec §4.6 — aldrig den levende DB). 8.717 ryttere i snapshottet, 4.429 i vækstalder 17-26, **1.500 simuleret** dag for dag frem til 30 år gennem produktionens egen vækstformel.

**Selvtest:** modellen med neutrale parametre er bit-identisk med `applyDailyTick` over 9 sæsoner × 28 dage × 15 evner. Uden den er målingen værdiløs.

| Mål | I dag | Kandidat | Negativ-test | Krav |
|---|---:|---:|---:|---|
| Agens-spænd, bedste evne (forkert → spids) | 4 point | **13 point** | 7 point | skal stige markant |
| Andel af taget nået, median | 1,00 | **0,82** | 0,82 | < 1,0 |
| Feltets forskellighed | 0,44 | **0,69** | 0,56 | må ikke falde |
| Arketype-skarphed, bedste strategi | 0,84 | 0,78 | 0,80 | ⚠️ falder |
| Arketype-**spænd** (forkert → bedste) | 0,03 | **0,19** | 0,03 | skal stige |
| Sprintere der når tempo ≥ 40 | 1 af 235 | 1 af 235 | 3 af 235 | uændret |
| Evnesum ved 30 år, median | 351 | 241 | 307 | — |

**Ingen mister noget.** Ryttere i vækstalder har i dag en evnesum på median **169**. Under dagens model vokser de til 351 frem mod 30 år; under kandidaten til 241. De vokser altså stadig mærkbart — de får det bare ikke gratis.

**Manageren vælger form, ikke mængde.** Spids og rotation giver nøjagtig samme evnesum (241), men forskellig top: 42 mod 35. Det er en langt bedre beslutning at give en spiller end "træn eller lad være".

**Rolle-identitet holder.** En sprinter kommer ikke til at klatre: `climbing` under den nye model tager **1.553 dage** til ét point — 55 sæsoner. Længere end en karriere, uden at nogen tekst skal sige "aldrig".

### 3.1 Negativ-test (spec §4.4)

Kandidaten kørt med `offFocusMult` uændret på 0,97:

- agens-spænd **7 point** i stedet for 13
- feltets forskellighed **0,56** i stedet for 0,69
- arketype-spænd **0,03** i stedet for 0,19 — altså uændret fra i dag

Gaten fejler beviseligt på den defekte konfiguration. De to håndtag skal begge drejes, og målingen kan se forskellen.

### 3.2 Arketype-skarpheden falder — og hvorfor det er acceptabelt

0,84 → 0,78 går imod #3503's mål om skarpere arketyper. Forklaringen: dagens høje skarphed skyldes, at loftet bestemmer alt. Hver rytter mætter et loft, der er formet af hans type, så hans top-3 evner **er** hans type. Når manageren får indflydelse, bliver skarpheden noget, der skal opnås — se spændet, 0,03 → 0,19. Og den skarpeste strategi (rotation, 0,78) er også den, der udvikler flest signatur-evner: god ledelse og skarp identitet peger samme vej.

Det er stadig et fald. Det skal måles igen på et friskt kuld, før det accepteres endeligt.

---

## 4. Kendte huller i målingen — skal lukkes før ship

1. **Stock, ikke flow.** Spec §4.3 kræver måling pr. kuld. Målingen simulerer de eksisterende 4.429 ryttere fremad fra evner, der allerede er mættede under dagens model. Et frisk kuld genereret under den nye model er ikke målt. **Største hul.**
2. **Akademiets sæson-loft blev ikke modelleret.** Ryttere på 17-21 blev simuleret med senior-semantik, så deres vækst er overvurderet i **begge** modeller. Sammenligningen er retvisende, fordi fejlen rammer ens, men de absolutte tal for unge ryttere er for høje.
3. **Arvede ryttere over deres formel-loft.** `buildCapsForRider` gulver ved `max(tapered, current)`, så enhver rytter på eller over sit formel-loft har forholdet 1,00 per konstruktion (p90 er stadig 1,00). Snapshottet indeholder fx en rytter med `tactics: 61` mod et formel-loft på 24. Beslutning 6 gælder ikke for dem uden en særskilt regel.
4. **Taget klipper ved 99 for højt potentiale.** `signatur`-tag 1,30 giver 104 ved potentiale 5 og 114 ved 6 — begge klippet til 99. Potentiale mister opløsning i toppen. Beslutning 8 (potentiale = fart) løser det, men den er udskudt til et selvstændigt trin.
5. **Markedsværdi er ikke målt direkte.** Evnesummen (input) er målt; `predictBaseValue`-outputtet er ikke.
6. **Staff-stien er uverificeret.** `facilityTrainingMultiplier` er målt til maks **+8,3 %** ved tier 5. `staffTrainingBonus` returnerede 1,0 mod en syntetisk chef-profil, hvilket lige så godt kan skyldes forkert input som ingen effekt.

---

## 5. Fladen: kvittering, ikke forudsigelse

**Princippet:** en kvittering kan ikke være løgn, en forudsigelse kan. Hele problemet hedder "kan managers stole på udviklingen", så det, der fylder mest, skal være dét, rytteren *fik*.

**To flader, samme enhed** — point pr. sæson — så spilleren kan holde os fast på det: vi lovede +7 på sprint, og fanen viser, at han fik +7.

### 5.1 Kvitteringen (rytterprofil)

Pr. evne: `nu → tag`, point opnået i denne sæson, og en fremdriftsbar mod næste point.

| evne | nu → tag | sæson | på vej |
|---|---|---:|---|
| acceleration | 38 → 78 | +4 | 50 % |
| sprint | 41 → 78 | +4 | 16 % |
| tactics | 20 → 57 | +0 | 44 % |
| climbing | 8 → 12 | +0 | 1 % |

`tactics`-rækken er hele designet i én linje: **+0 i denne sæson, men baren står på 44 %.** Der sker noget hver eneste dag; der er bare ikke landet et helt point endnu. Muren er væk, uden at et eneste ord skal love noget.

**`nu → tag` som par, aldrig et restbeløb alene.** Et restbeløb kan lyve: `climbing` mangler 4 point, det laveste tal i listen, så spillets mest låste evne ville se ud som den, der er tættest på at være færdig. `8 → 12` mod `41 → 78` kan ikke misforstås.

**Aldrig dage.** Aldrig ordet "aldrig". Alt under +0,1 pr. sæson vises som "under +0,1", aldrig som et blankt nul.

### 5.2 Fokusvælgeren (det eneste sted med et tal, der peger fremad)

Pr. fokus: de evner det flytter mest, i point pr. sæson. Målt for en sprinter/rouleur, potentiale 3, 22 år, hård intensitet:

| Fokus | Top 3 |
|---|---|
| sprint | acceleration +7,4 · sprint +6,9 · durability +2,0 |
| endurance | durability +9,1 · endurance +7,7 · flat +1,8 |
| aero | flat +8,2 · durability +2,0 · endurance +1,7 |
| løbslære | tactics +3,4 · positioning +3,3 · aggression +1,6 |
| vo2max | durability +2,0 · flat +1,8 · tempo +1,4 |

Gevinsten ligger, hvor der er mest luft: `endurance`-fokus giver +9,1 på durability — mere end `sprint`-fokus giver på sprint — fordi durability står på 29 med tag 78. Det gør fokusvalget til en ægte afvejning i stedet for "vælg det, der hedder det samme som rytteren".

### 5.3 Tekster der skal dø

`focusOptionCapped` ("ceiling reached") · `focusCappedTitle` ("Training this focus gains nothing more.") · `focusPartiallyCappedTitle` ("…will not rise again, no matter how this rider trains.")

---

## 6. Leveranceplan

Hvert trin kan shippes og måles for sig.

| Trin | Indhold | Motor-ændring | Gate |
|---|---|---|---|
| **0** | Ret harnessen: akademi-sæsonloft ind, flow-måling på friskt kuld | nej | flow-scorecard foreligger |
| **1** | Fladen: kvittering, `nu → tag`, fokusvælger med point pr. sæson. Slet de tre loft-tekster | nej | ejer-godkendt visuelt; #3649, #3651 lukkes |
| **2** | Nyt fokus `løbslære` (positioning, tactics, aggression); technique reduceres | lille, isoleret | fokus-størrelser kalibreret, ikke arvet |
| **3** | Håndværks-taget: positioning + tactics. #3682 er allerede målt (+2,83 potentiel rating for 4.747 ryttere i fire roller) | ja | dry-run-diff med absolutte deltaer, ejer-gated |
| **4** | Rolleklasser, rater, `offFocusMult` 0,97 → 0,35 | ja, stor | flow-scorecard + negativ-test + snapshot før mutation |
| **5** | Akademi og senior samlet: `INTERIM_RATE_MULT` og sæson-loftet fjernes | ja | egen akademi-gate; #3583 lukkes |
| **6** | *Separat issue:* ingen vokser af tid alene — AI-hold kører den daglige motor, frie agenter får intet eller et minimum | ja | rører 5.258 ryttere; egen måling |
| **7** | *Separat issue:* potentiale = fart. `rateByPotential` spredes, taget flades ud | ja | scouting, økonomi, #3503's G3-præcision |
| **8** | *Senere:* træningslejre som betalt, tidsbegrænset handling | ja | bygges oven på et fokus-system der beviseligt virker |

**Rækkefølgen er ikke forhandlelig mellem 3 og 4:** trin 3 kan måles isoleret mod #3682's eksisterende tal, netop fordi trin 4 endnu ikke har flyttet noget andet.

---

## 7. Spillerkommunikation

Det er en ændring, der skal forklares, ikke bare shippes. Tre ting skal frem, i den rækkefølge:

1. **Hvad du får:** din træning afgør nu, hvad rytteren bliver. To identiske talenter under to managers ender forskelligt.
2. **Hvad du mister:** ryttere udvikler sig langsommere end før, hvis du ikke vælger. Ingen mister noget, de allerede har — men det, der før kom gratis, skal nu vælges.
3. **Hvad der forsvinder:** beskeden om, at en evne aldrig stiger igen. Den var sand under den gamle model. Den bliver usand under den nye.

Formen: kort patch note (ejer-krav 13/8 — de nuværende er for lange og rodede), og en separat forklarende tekst i hjælpen, der dækker #3456 (hvornår træning kører og restituerer), #3583 (akademi vs seniortrup — nu ét svar) og #3623 (de otte ryttertyper).

Udkast skrives til copy-paste. **Ejeren poster selv.**

---

## 8. De 13 beslutninger

| # | Spørgsmål | Valg |
|---|---|---|
| 1 | Skal der stadig findes et tal, en evne nærmer sig? | Absolut tag, aldrig nået |
| 2 | Skal taget uden for rollen afhænge af hvilken evne det er? | Ja — to slags neutral |
| 3 | Hvor går grænsen for håndværk? | Kun `positioning` og `tactics` |
| 4 | Hvad skal raten matche? | Slutresultatet, ikke ungdommen |
| 5 | Skal "ingen vokser af tid alene" gælde alle? | Ja — men som selvstændigt issue |
| 6 | Skal ryttere holde op med at nå deres lofter? | Ja |
| 7 | Hvor skal ankeret ligge? | Fremragende træning = dagens niveau |
| 8 | Potentiale: højde eller fart? | Fart — men udskudt til eget trin |
| 9 | Hvilken enhed på fladen? | Point pr. sæson |
| 10 | Hvordan vises taget? | `nu → tag` som par |
| 11 | Hvor skal `tactics` og `aggression` hen? | Nyt fokus: løbslære |
| 12 | Hvad kan manageren gøre ved en langsom evne? | Fokus og tid; træningslejre senere |
| 13 | Akademi og senior samme model? | Ja, én model |

---

## 9. Kilder

#3659 · #3503 · #3682 · #3564 (spec §4, §11-12) · #3643 · #3644 · #3660 · #3649 · #3651 · #3592 · #3629 · #3616 · #3614 · #3634 · #2720 · #3456 · #3583 · #3623 · #2437 · #1305 · #2082/#1938

Kode: `backend/lib/dailyTraining.js` · `backend/lib/riderProgression.js` · `backend/lib/riderProgressionEngine.js` · `backend/lib/training.js` · `backend/lib/weights/capsShapingWeights.js` · `backend/lib/academyFlag.js` · `backend/lib/staffTrainingBonus.js`

Data: `docs/snapshots/3591/riders_full.json` (2026-08-13) · `app_config` verificeret 14/8: `daily_training_enabled = on`, `race_day_engine_enabled = off`
