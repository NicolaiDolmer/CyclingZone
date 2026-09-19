# #3668 — evne-skalaen: måling, behandlinger og migrationsplan

> **Undersøgelsesspor 15/9 2026.** READ-ONLY mod prod, ingen mutation, ingen kodeændring.
> Formål: beslutningsgrundlag til ejeren, ikke en rettelse.
> Dom: **bekræftet — men rodårsagen i issuet er forkert, og den rigtige er smallere og lettere at rette.**

---

## 0. Kort version

1. **Skævheden findes.** `tactics` har median 22 og p90 55 hos ryttere på hold, mod 12/29 for de 10 fysiske evner poolet. `aggression` har median 20. De to er ikke på samme skala som resten.
2. **Men kun to af de fem er skæve.** `descending` (median 10), `cobblestone` (10) og `positioning` (13) ligger inden for de fysiske evners eget spænd. Issuets præmis — *"de fem lever på en anden fordeling end de ti"* — holder ikke for tre af de fem.
3. **Rodårsagen er ikke kontrast-forstærkningen.** Kontrast-forstærkningen **kører slet ikke i prod**. Alle 8.480 fysiologi-profiler er `version 1 / seeded_from_legacy` med `aero = NULL`, så `hasPhysiology()` er falsk for hver eneste rytter og `applyContrast()` bliver aldrig kaldt. Alle 15 evner kommer i dag fra den samme lineære PCM-remap.
4. **Den rigtige rodårsag er to additive alders-led i selve formlen.** `tactics = 0.55·experience + 0.45·aggressionFrac` gør taktik til et aldersmålerur: median 14 ved 16-21 år, 57 ved 31-33 år — uden nogen sammenhæng med rytterens kunnen. `aggression = 0.85·pcmFrac(stat_ftr) + 0.15·youth` giver op til +15 gratis point til unge.
5. **Anbefaling: behandling C** — fjern de additive alders-led ved kilden. Den rammer præcis de to evner der er skæve, lader de tre der er i orden være, og er en *regel* der også holder for nye ryttere. A (udvid kontrasten) gør det aktivt **værre**; B (kvantil-mapning) er et øjebliksbillede, ikke en regel.
6. **Migrér eksisterende ryttere** — men som en *delta*-migration, ikke en re-derivation, og lofterne skal med. Uden et loft-fix trækker træningen tallet tilbage.

---

## 1. Hvad der faktisk kører i prod

### 1.1 Kontrasten er død kode i den kørende sti

`backend/lib/abilityDerivation.js:212` — kontrasten kører kun på fysiologi-stien:

```js
if (fromPhysiology) applyContrast(out);
```

`hasPhysiology()` (`abilityDerivation.js:160-164`) kræver både `ftp_wkg` og `aero`. Målt mod prod 15/9:

| `rider_physiology_profiles` | antal |
|---|---:|
| rækker i alt | 8.480 |
| med `ftp_wkg` | 8.480 |
| **med `aero`** | **0** |
| version/source | 100 % `version 1` / `seeded_from_legacy` |
| aktive ryttere med en profil | 8.160 (alle) |

Task D2 i rating-fundament-specen — re-seed af PCM-ryttere til v2-profiler **før** re-derivation — er aldrig kørt. Resultat: `fromPhysiology === false` for alle 8.160 aktive ryttere, alle 10 fysiske evner kommer fra PCM-fallbacken (`abilityDerivation.js:196-207`), og `CONTRAST_ABILITIES` / `applyContrast` påvirker ingen rytter i spillet.

**Konsekvens for issuet:** forklaringen i #3668 ("de 10 køres gennem kontrast-forstærkning, de 5 gør ikke") beskriver en mekanisme der ikke er tændt. Skævheden er ægte, men den kommer et andet sted fra.

> **Den er dog latent.** Tændes fysiologi v2 (Task D2), begynder kontrasten at virke på de 10 — og *så* bliver issuets oprindelige framing også sand, oveni den skævhed der findes i dag. Rækkefølgen betyder noget: retter man kun issuets påstand, får man skævhed nummer to uden at have fjernet nummer et.

### 1.2 Kilden er ensartet — formlen er ikke

Alle 13 PCM-stats har praktisk talt identisk fordeling i populationen (ryttere på hold, uden `fill_tail`, n = 5.756):

| stat | p10 | p25 | median | p75 | p90 | max |
|---|---:|---:|---:|---:|---:|---:|
| `stat_bj` | 49 | 50 | 52 | 55 | 57 | 82 |
| `stat_fl` | 50 | 52 | 54 | 57 | 57 | 75 |
| `stat_ned` | 49 | 50 | 52 | 56 | 57 | 75 |
| `stat_bro` | 49 | 50 | 52 | 55 | 57 | 83 |
| `stat_ftr` | 49 | 50 | 52 | 56 | 57 | 82 |
| *(de øvrige 8)* | 49-50 | 50-51 | 52-53 | 55-57 | 57 | 76-82 |

Kilden er altså **ikke** skæv. Skævheden opstår i de to formler der lægger noget andet end en stat oveni (`abilityDerivation.js:218-223`):

```js
const aggressionFrac = 0.85 * pcmFrac(riderRow.stat_ftr) + 0.15 * youth;
out.aggression  = scoreFrac(aggressionFrac);
out.descending  = scoreFrac(pcmFrac(riderRow.stat_ned));
out.cobblestone = scoreFrac(0.85 * pcmFrac(riderRow.stat_bro) + 0.15 * (out.durability / 99));
out.positioning = scoreFrac(0.50 * pcmFrac(riderRow.stat_fl) + 0.30 * pcmFrac(riderRow.stat_ned) + 0.20 * pcmFrac(riderRow.stat_ftr));
out.tactics     = scoreFrac(0.55 * experience + 0.45 * aggressionFrac);
```

- `experience = clamp((age − 20) / 11, 0, 1)` mætter ved 31 år. En 31-årig får derfor **mindst** `scoreFrac(0.55) = 55` i taktik, uanset hvor dårlig han er til alt andet.
- `youth = clamp((32 − age) / 11, 0, 1)` giver en 21-årig `0.15 · 1 = 0.15` → **+15 point** i aggression gratis.

### 1.3 Beviset: taktik er et aldersmålerur

Ryttere på hold, uden `fill_tail` (n = 5.756):

| alder | n | **taktik median** | taktik p90 | aggression median | descending median |
|---|---:|---:|---:|---:|---:|
| 16-21 | 2.694 | 14 | 21 | 24 | 11 |
| 22-24 | 543 | 26 | 34 | 21 | 12 |
| 25-27 | 816 | 38 | 45 | 18 | 11 |
| 28-30 | 784 | 49 | 58 | 11 | 8 |
| 31-33 | 460 | **57** | 63 | 9 | 7 |
| 34-45 | 185 | 55 | 64 | 5 | 5 |

`descending` — samme kilde-kvalitet, ingen alders-led — falder pænt og roligt med alderen (11 → 5), som man ville forvente af en aldrende population. `tactics` gør det stik modsatte og firedobles. Det er formlen, ikke ryttere der er gode til taktik.

---

## 2. Målingen: fordeling for alle 15 evner (prod, 15/9)

`rider_derived_abilities` ⋈ `riders`, `is_retired = false`. **n = 8.160** (13/8: n = 6.837).

Buckets: spillerhold 4.283 · AI-hold 2.242 · uden hold 1.635. `fill_tail` 740 · akademi 531 · testhold 36.

### 2.1 Alle aktive ryttere (n = 8.160)

| Evne | kat | p10 | p25 | **median** | p75 | p90 | max | snit |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| climbing | fys | 1 | 2 | 7 | 18 | 30 | 93 | 12,1 |
| time_trial | fys | 1 | 6 | 10 | 19 | 27 | 99 | 13,7 |
| flat | fys | 2 | 7 | 12 | 19 | 25 | 84 | 13,6 |
| tempo | fys | 1 | 4 | 9 | 19 | 31 | 85 | 13,5 |
| sprint | fys | 1 | 3 | 7 | 18 | 22 | 91 | 11,1 |
| acceleration | fys | 1 | 5 | 9 | 19 | 23 | 80 | 12,3 |
| punch | fys | 1 | 6 | 11 | 20 | 31 | 93 | 14,5 |
| endurance | fys | 1 | 4 | 10 | 20 | 31 | 83 | 13,6 |
| recovery | fys | 1 | 5 | 9 | 17 | 25 | 91 | 12,0 |
| durability | fys | 1 | 5 | 9 | 17 | 24 | 83 | 11,6 |
| descending | tek | 1 | 4 | 8 | 16 | 23 | 71 | 11,1 |
| cobblestone | tek | 1 | 4 | 8 | 15 | 22 | 85 | 11,1 |
| positioning | tek | 3 | 6 | 11 | 17 | 23 | 69 | 12,6 |
| **aggression** | men | 8 | 15 | **19** | 25 | 31 | 89 | 19,9 |
| **tactics** | men | 9 | 12 | **16** | **38** | **53** | 84 | 24,9 |

### 2.2 Spillerhold (n = 4.283) vs AI-hold (n = 2.242)

| Evne | spiller median | spiller p90 | AI median | AI p90 |
|---|---:|---:|---:|---:|
| climbing | 9 | 36 | 7 | 19 |
| time_trial | 14 | 32 | 10 | 20 |
| flat | 15 | 28 | 11 | 20 |
| tempo | 12 | 38 | 9 | 20 |
| sprint | 9 | 24 | 7 | 20 |
| acceleration | 12 | 25 | 9 | 21 |
| punch | 15 | 38 | 11 | 20 |
| endurance | 13 | 36 | 10 | 20 |
| recovery | 12 | 28 | 9 | 18 |
| durability | 12 | 26 | 9 | 19 |
| descending | 10 | 25 | 8 | 18 |
| cobblestone | 10 | 24 | 8 | 17 |
| positioning | 13 | 26 | 10 | 19 |
| **aggression** | **19** | 33 | **19** | 27 |
| **tactics** | **22** | **54** | **15** | **54** |

Skævheden er den samme i begge puljer — den ligger i formlen, ikke i hvem der ejer rytteren. Spillerholdene ligger generelt 2-4 point over AI-holdene på de fysiske evner (træning virker), men `aggression` er identisk (19/19): den er domineret af alders-leddet, som træning ikke flytter.

### 2.3 Sammenligning med issuets tal fra 13/8

| Evne | 13/8 median (n=6.837) | 15/9 median (n=8.160) | ændring |
|---|---:|---:|---|
| tactics | 38 | **16** | −22 |
| aggression | 17 | 19 | +2 |
| acceleration | 14 | 9 | −5 |
| flat | 13 | 12 | −1 |
| sprint | 12 | 7 | −5 |
| positioning | 11 | 11 | 0 |
| time_trial | 11 | 10 | −1 |
| punch / durability / recovery | 9 | 11 / 9 / 9 | ~0 |
| descending / cobblestone | 9 | 8 / 8 | −1 |
| tempo / endurance | 7 | 9 / 10 | +2 |
| climbing | 5 | 7 | +2 |

**Taktikkens median er faldet fra 38 til 16** — ikke fordi noget blev rettet, men fordi populationen er blevet yngre (medianalder 21 i dag; 11,2 % er 31+). Skævheden er ikke væk, den er flyttet ud i halen: taktik p75 = 38 og p90 = 53, mod p90 på 22-31 for alle de fysiske evner. Den samme rytter, der 13/8 var median, er i dag p75.

> **Det gør issuets "7 gange bedre"-formulering forældet, men ikke forkert i substans.** Forholdet median-til-median er i dag 16 : 7 ≈ 2,3× (taktik mod climbing). På p90 er det 53 : 22 ≈ 2,4×. Skævheden er reel og stor nok til at bryde løftet om én skala — den er bare ~2,4×, ikke 7×, og den bor i halen frem for i midten.

---

## 3. Tre behandlinger, simuleret på et prod-udtræk

Alle tre er kørt lokalt på de 5.756 ryttere på hold uden `fill_tail`. Intet er skrevet til prod.
Referencemål: **de 10 fysiske evner poolet** (n = 57.560) → p10 2 · p25 6 · **median 12** · p75 21 · **p90 29**.

| Behandling | Hvad den gør |
|---|---|
| **A** | Udvid kontrast-forstærkningen (`k = 1,52`, gulv 8) til alle 15 evner — issuets egen implicitte løsning |
| **B** | Kvantil-mapning: mål hver af de 5 evners fordeling og map den punkt-for-punkt over på den fysiske pool |
| **C** | Omskalering ved kilden: fjern de additive alders-led. `aggression = pcmFrac(stat_ftr)` (ren stat, som `descending`); `tactics = 0,15·experience + 0,85·(0,60·ftr + 0,40·ned)` |

### 3.1 Før/efter

| Evne | | p10 | p25 | median | p75 | p90 | max |
|---|---|---:|---:|---:|---:|---:|---:|
| *MÅL: 10 fysiske poolet* | | 2 | 6 | **12** | 21 | **29** | 90 |
| **descending** | i dag | 2 | 5 | 10 | 19 | 24 | 71 |
| | A | 8 | 8 | 9 | 19 | 24 | 81 |
| | B | 2 | 5 | 12 | 21 | 29 | 86 |
| | C | 2 | 5 | 10 | 19 | 24 | 71 |
| **cobblestone** | i dag | 2 | 5 | 10 | 18 | 23 | 84 |
| | A | 8 | 8 | 9 | 18 | 22 | 99 |
| | B | 1 | 5 | 12 | 21 | 29 | 86 |
| | C | 2 | 5 | 10 | 18 | 23 | 84 |
| **positioning** | i dag | 4 | 8 | 13 | 19 | 24 | 68 |
| | A | 8 | 8 | 13 | 19 | 24 | 74 |
| | B | 1 | 6 | 13 | 21 | 28 | 86 |
| | C | 4 | 8 | 13 | 19 | 24 | 68 |
| **aggression** | i dag | 7 | 16 | **20** | 26 | 32 | 89 |
| | A | 8 | 18 | **25** | 31 | 37 | 99 |
| | B | 2 | 6 | 12 | 21 | 29 | 86 |
| | C | 1 | 4 | **9** | 18 | 22 | 92 |
| **tactics** | i dag | 11 | 14 | **22** | 44 | **55** | 84 |
| | A | 12 | 15 | **23** | 60 | **78** | 99 |
| | B | 2 | 6 | 12 | 21 | 29 | 86 |
| | C | 5 | 9 | **14** | 21 | **28** | 71 |

**A gør det værre.** Kontrasten skubber væk fra rytterens egen median. `tactics` ligger allerede *over* medianen hos de fleste, så den bliver skubbet endnu højere: p90 går fra 55 til 78. Samtidig løfter gulvet på 8 bunden af `descending`/`cobblestone` fra 2 til 8 og komprimerer dem. A løser ingenting og ødelægger to evner der var i orden.

**B rammer målet præcist — men det er et øjebliksbillede.** Alle fem evner lander per konstruktion på præcis den fysiske fordeling. Prisen: (i) `descending`/`cobblestone`/`positioning` bliver *inflateret* (median 10 → 12, p90 24 → 29) selvom de ikke fejlede noget; (ii) mapningen er fittet mod dagens population og skal refittes hver gang befolkningen skifter — den er ikke en regel, der gælder for en rytter der fødes i morgen; (iii) den ødelægger signalet: en veteran med taktik 71 og en 17-årig med taktik 26 bytter reelt plads, fordi mapningen kun kender rang, ikke betydning.

**C rammer det der er i stykker og rører intet andet.** `descending`, `cobblestone` og `positioning` er bit-for-bit uændrede. `aggression` lander på median 9 / p90 22 og `tactics` på 14 / 28 — begge inde i de fysiske evners eget spænd (12 / 29). Vigtigst: C er en *formel*, så en rytter der genereres om et halvt år fødes automatisk på den rigtige skala. Det er præcis det `docs/HOWTO_ADD_ABILITY.md` linje 7 beder om.

### 3.2 Rating-konsekvens (`displayRecipes.js`, 8 roller)

| | median rolle-spredning pr. rytter | p90 spredning | laveste rolle-median | højeste rolle-median |
|---|---:|---:|---|---|
| i dag | 9 | 22 | climber 12 | baroudeur 16 |
| A | 11 | 22 | climber 12 | baroudeur 19 |
| B | 8 | 22 | climber 12 | baroudeur 13 |
| C | **8** | 21 | baroudeur 11 | rouleur 13 |

Issuets kernebekymring — *"samme rytter, dobbelt tal, alene efter hvilken rolle"* — er i dag 12 (climber) mod 16 (baroudeur) = **1,33×**. Under C bliver det 11 mod 13 = **1,18×**, og den rolle der stikker ud er ikke længere den ene der har `aggression 4` og `tactics 1` i opskriften. A gør spændet værre (12 → 19 = 1,58×).

> Bemærk at issuets tal fra 13/8 (6,7 mod 14,5 = 2,2×) heller ikke kan genskabes i dag. Den er allerede faldet til 1,33× af samme grund som taktik-medianen faldt: populationen blev yngre. C bringer den ned på 1,18×, hvilket er den restspredning der reelt kommer fra rollernes evne-sammensætning og ikke fra skalaen.

### 3.3 Fem konkrete ryttere

| | alder / type | | descending | cobblestone | positioning | aggression | tactics |
|---|---|---|---:|---:|---:|---:|---:|
| **Leon Klein** (top-GC) | 16 · gc/climber | i dag | 29 | 27 | 29 | **34** | **27** |
| | | A | 26 | 23 | 26 | 34 | 23 |
| | | B | 38 | 37 | 37 | 34 | 14 |
| | | **C** | **29** | **27** | **29** | **21** | **26** |
| **Toby Murphy** (sprinter) | 17 · sprinter/baroudeur | i dag | 31 | 25 | 33 | **38** | **29** |
| | | A | 27 | 18 | 30 | 38 | 24 |
| | | B | 40 | 34 | 43 | 41 | 15 |
| | | **C** | **31** | **25** | **33** | **25** | **26** |
| **Filip Zieliński** (klassiker) | 17 · brostensrytter/rouleur | i dag | 23 | 34 | 30 | **32** | **26** |
| | | A | 19 | 36 | 30 | 33 | 24 |
| | | B | 27 | 44 | 38 | 29 | 14 |
| | | **C** | **23** | **34** | **30** | **19** | **24** |
| **Nicolò Sartori** (akademi) | 17 · puncheur/climber | i dag | 29 | 26 | 33 | **36** | **28** |
| | | A | 30 | 25 | 36 | 40 | 28 |
| | | B | 38 | 36 | 43 | 38 | 15 |
| | | **C** | **29** | **26** | **33** | **23** | **27** |
| **Loïc Gauthier** (veteran) | 36 · gc/climber | i dag | 56 | 51 | 49 | **42** | **71** |
| | | A | 56 | 48 | 45 | 35 | 79 |
| | | B | 68 | 61 | 59 | 46 | 65 |
| | | **C** | **56** | **51** | **49** | **50** | **59** |

Det læsbare mønster: under C falder de unges `aggression` med ~13 point (de mistede gratis-ungdomsbonussen) og veteranens `tactics` falder med 12 (han mistede gratis-alderspoint), mens `aggression` hos den 36-årige *stiger* fra 42 til 50 — han er faktisk en fighter, og det var dækket af, at unge fik gratis point. **C flytter tallene fra at måle alder til at måle rytteren.**

Under B bytter Gauthiers og Kleins taktik plads på en måde der ikke svarer til noget: den 36-årige GC-kaptajn får 65 og den 16-årige 14 — ikke fordi det er sandt, men fordi rangordenen blev bevaret og skalaen strakt.

---

## 4. Konsekvensanalyse

### 4.1 Hvad der ændrer sig (behandling C)

| Område | Fil | Hvad der sker |
|---|---|---|
| **Viste evne-tal** | `frontend` via `rider_derived_abilities` | `aggression` falder median 13 point; `tactics` falder median 7 (p10 −30). `descending` / `cobblestone` / `positioning` og alle 10 fysiske: **uændret**. |
| **Rating** | `backend/lib/weights/displayRecipes.js:74-82` | Kun 2 af 8 opskrifter rører de to evner: `baroudeur` (`aggression: 4`, `tactics: 1`) og ingen andre. Målt: **bedste rolle-rating uændret hos 52 % af ryttere**, median-ændring 0, p10 −4, største fald −6, største stigning +3. Baroudeur-ratingen falder mest — den var også den mest inflaterede. |
| **Race engine v4** | `finale.ts:56` (`tactics: 0.2`), `mechanics/breakaway.ts:152` (`JOIN_SCORE_WEIGHTS.aggression`) | Motoren bruger begge. `breakaway` bliver *mere* selektiv: i dag har næsten alle unge aggression ~20-25, så udbruds-scoren er fladtrykt. Efter C spreder den sig. `finale`s `tactics`-vægt er 0,2 — lille, men peger nu på kunnen frem for fødselsår. **Verificér mod fixtures: `bjerg-selektion`, `punch-finale-forspring`, `nedkoerselsfinale` indeholder alle de to evner som input.** |
| **Markedsværdi / løn** | `backend/lib/weights/valuationWeights.js:25` | `baroudeur` har `aggression: 3`. Faldende aggression → faldende baroudeur-værdi. **Det skal måles før merge** — værdimodellen er fittet mod dagens fordeling. |
| **Lofter** | `ability_caps` (JSONB på `rider_derived_abilities`), `buildCapsForRider` i `backend/lib/riderProgression.js` | ⚠ **Kritisk, se 4.3.** |
| **Rytter-generering / AI-fill / akademi** | `generateFictionalRiders`, `academyIntake.js`, `starterSquadAllocator.js` | Nye ryttere fødes automatisk på den nye skala — det er hele pointen med et kilde-fix. `FILL_TAIL_ABILITY_CAP = 15` (`abilityDerivation.js:117`) blev indført netop fordi `tactics` (alder) og `hidden_potential` (potentiale) sprang uden om stat-klemmen. **Efter C er den bug væk ved roden** og loftet bliver et rent sikkerhedsnet i stedet for en lap. |

### 4.2 Hvad der IKKE ændrer sig

- **De 10 fysiske evner** — ikke ét tal flytter sig. C rører kun `abilityDerivation.js:218` og `:223`.
- **`descending`, `cobblestone`, `positioning`** — uændrede, de var aldrig skæve.
- **Ryttertyper** — `tactics` og `positioning` er ikke i klassifikatoren (`inClassifier: false`, `abilityRegistry.js`). `aggression` ER (`inClassifier: true`), så baroudeur-klassificeringen kan flytte sig; skal måles. Klassifikator-vægttabellen er frosset og røres ikke.
- **Potentiale, `hidden_potential`, rolleklasser, træningsrater** — samme formler.
- **Kontrast-forstærkningen** — forbliver slukket. C gør ingenting ved den. Det er et separat spor (Task D2, fysiologi v2-seed), som skal køres *efter* dette, ikke i stedet for.
- **Økonomi-balancen, sponsorer, kalenderen** — urørt.

### 4.3 Den fælde der skal lukkes samtidig: træningen trækker tallet tilbage

`dailyTraining.js:132`:

```js
const gap = Math.max(0, (cap ?? current) - current);
```

Træning er **gap-proportional**. Målt cap-fordeling i prod (n = 5.756):

| Evne | cap median | cap p90 | cap max |
|---|---:|---:|---:|
| climbing | 45 | 93 | 93 |
| flat | 80 | 93 | 93 |
| descending | 55 | 80 | 93 |
| positioning | 80 | 93 | 93 |
| aggression | 55 | 80 | 93 |
| **tactics** | **70** | **70** | **70** |

Lofterne ligger langt over de nuværende værdier, og `tactics` har et fladt håndværks-loft på 70 for **alle** (`CRAFT_ABILITIES`, `PROGRESSION_RULES.md` §1). Sænker man kun den nuværende værdi og lader loftet stå, bliver gappet *større* og træningen trækker tallet op igen. Ændringen ville ikke holde.

**Derfor skal loft-siden med i samme PR:** enten sænkes `craftFactor`/håndværks-taget for `tactics` og `aggression` til samme niveau som de øvrige evners rolleklasser, eller også accepteres at de to evner har et højere naturligt loft — og det skal så være en bevidst, dokumenteret designbeslutning, ikke en bivirkning. `capsShapingWeights.js` er i den låste kategori (`HOWTO_ADD_ABILITY.md`, "Det du IKKE skal røre") og kræver **eksplicit ejer-go + bevis for hvad der flytter sig**.

---

## 5. Migrationsplan

### 5.1 Skal eksisterende ryttere migreres?

**Ja — men som delta, ikke som re-derivation.**

- **Hvorfor ikke bare re-derive:** `rider_derived_abilities` er den *levende* værdi. Re-derivation viste 21,6 % eksakt match mod en frisk `deriveAbilities()`-kørsel; de resterende 78,4 % afviger fordi træning og aldersaftrapning har flyttet tallene siden. En ren re-derivation ville **slette al træningsfremgang** for hver rytter i spillet. Det er uacceptabelt.
- **Hvorfor ikke kun nye ryttere:** så ville to ryttere med identisk kunnen og alder vise forskellig taktik afhængigt af hvornår de blev født i databasen. Det er den værste af de tre udfald — det er ikke en skala, det er to.
- **Løsningen:** migrér med `ny = gammel + (derivNew − derivOld)`, clampet til [1, 99]. Rytteren beholder præcis den fremgang han har optjent; kun det forkerte alders-offset fjernes.

### 5.2 Blast radius (målt på alle 8.160 ikke-pensionerede)

| | falder | stiger | uændret | median-ændring | p10 | p90 | største fald | største stigning |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `aggression` | 7.183 | 845 | 132 | **−13** | −15 | +1 | −15 | +12 |
| `tactics` | 7.742 | 356 | 62 | **−7** | −30 | −1 | −40 | +21 |

- Ryttere hvis **taktik** flytter sig 20+ point: **1.895 (23,2 %)** — heraf **1.143 på spillerhold**.
- Bedste rolle-**rating**: uændret hos 52 %, median 0, p10 −4, største fald −6.

Det er "den tredje rystelse" #3458 Del C advarer om, men i en mild udgave: halvdelen af ryttere ser intet rating-skift, og ingen rytter falder mere end 6 point i sin bedste rolle.

### 5.3 Idempotent SQL — **UDKAST, ligger bevidst ikke i `database/`**

> Dette er ikke en migration. Det er et udkast der viser formen. Den rigtige migration skrives i det byggespor der implementerer den valgte behandling, og køres af `auto-migrate.yml` post-merge per #2642.

```sql
-- UDKAST #3668 — omskalering af aggression + tactics ved kilden.
-- Delta-migration: bevarer træningsfremgang, fjerner kun alders-offsettet.
-- Idempotent via en markør-tabel; kører aldrig to gange.
-- KRÆVER at backend allerede kører den nye deriveAbilities (deploy FØR migration).

BEGIN;

CREATE TABLE IF NOT EXISTS ability_scale_migrations (
  migration_key text PRIMARY KEY,
  applied_at   timestamptz NOT NULL DEFAULT now(),
  rows_touched integer
);

-- Sikkerhedskopi af de to kolonner, så rollback er et rent UPDATE ... FROM.
CREATE TABLE IF NOT EXISTS rider_ability_scale_backup_3668 (
  rider_id       uuid PRIMARY KEY,
  old_aggression smallint,
  old_tactics    smallint,
  captured_at    timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE
  v_rows integer := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM ability_scale_migrations WHERE migration_key = 'issue-3668-rescale') THEN
    RAISE NOTICE '#3668 rescale allerede anvendt - springer over';
    RETURN;
  END IF;

  INSERT INTO rider_ability_scale_backup_3668 (rider_id, old_aggression, old_tactics)
  SELECT d.rider_id, d.aggression, d.tactics
  FROM rider_derived_abilities d
  ON CONFLICT (rider_id) DO NOTHING;

  WITH src AS (
    SELECT
      d.rider_id,
      d.aggression AS cur_agg,
      d.tactics    AS cur_tac,
      GREATEST(0, LEAST(1.0,
        (COALESCE(r.stat_ftr, 50)::numeric - 50) / 35)) AS ftr,
      GREATEST(0, LEAST(1.0,
        (COALESCE(r.stat_ned, 50)::numeric - 50) / 35)) AS ned,
      GREATEST(0, LEAST(1.0,
        (LEAST(45, GREATEST(16,
          2026 - EXTRACT(YEAR FROM r.birthdate)::int)) - 20)::numeric / 11)) AS exp_f,
      GREATEST(0, LEAST(1.0,
        (32 - LEAST(45, GREATEST(16,
          2026 - EXTRACT(YEAR FROM r.birthdate)::int)))::numeric / 11)) AS youth_f
    FROM rider_derived_abilities d
    JOIN riders r ON r.id = d.rider_id
  ),
  calc AS (
    SELECT
      rider_id, cur_agg, cur_tac,
      -- gammel formel
      ROUND(1 + LEAST(1.0, 0.85 * ftr + 0.15 * youth_f) * 98)                       AS old_agg,
      ROUND(1 + LEAST(1.0, 0.55 * exp_f
            + 0.45 * (0.85 * ftr + 0.15 * youth_f)) * 98)                            AS old_tac,
      -- ny formel (behandling C)
      ROUND(1 + LEAST(1.0, ftr) * 98)                                                AS new_agg,
      ROUND(1 + LEAST(1.0, 0.15 * exp_f
            + 0.85 * (0.60 * ftr + 0.40 * ned)) * 98)                                AS new_tac
    FROM src
  )
  UPDATE rider_derived_abilities d
  SET aggression = GREATEST(1, LEAST(99, c.cur_agg + (c.new_agg - c.old_agg)))::smallint,
      tactics    = GREATEST(1, LEAST(99, c.cur_tac + (c.new_tac - c.old_tac)))::smallint
  FROM calc c
  WHERE d.rider_id = c.rider_id
    AND (c.new_agg <> c.old_agg OR c.new_tac <> c.old_tac);

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  INSERT INTO ability_scale_migrations (migration_key, rows_touched)
  VALUES ('issue-3668-rescale', v_rows);

  RAISE NOTICE '#3668 rescale: % raekker', v_rows;
END $$;

COMMIT;
```

**Post-verify (skal køres og vises FØR issuet lukkes):**

```sql
SELECT
  percentile_cont(0.5) WITHIN GROUP (ORDER BY aggression) AS agg_median,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY aggression) AS agg_p90,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY tactics)    AS tac_median,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY tactics)    AS tac_p90,
  count(*)                                                AS n
FROM rider_derived_abilities d
JOIN riders r ON r.id = d.rider_id
WHERE COALESCE(r.is_retired, false) = false;
-- Forventet: agg_median ≈ 9, agg_p90 ≈ 22, tac_median ≈ 14, tac_p90 ≈ 28
```

### 5.4 Rollback

```sql
BEGIN;
UPDATE rider_derived_abilities d
SET aggression = b.old_aggression,
    tactics    = b.old_tactics
FROM rider_ability_scale_backup_3668 b
WHERE d.rider_id = b.rider_id;
DELETE FROM ability_scale_migrations WHERE migration_key = 'issue-3668-rescale';
COMMIT;
```

Rollback er komplet så længe backup-tabellen står, og den skal først droppes når en hel sæson er kørt uden indsigelser. Bemærk at rollback **ikke** ruller kode-ændringen tilbage — backend skal rulles tilbage først, ellers genskaber næste derivation de nye tal for nye ryttere.

**Rækkefølge ved udrulning:**
1. Merge kode-ændringen (`abilityDerivation.js` + loft-siden) → deploy backend.
2. `auto-migrate.yml` kører migrationen post-merge.
3. Post-verify-forespørgslen ovenfor køres og tallene vises.
4. Spillerkommunikation + patch note.

**Timing:** kør den i sæsonskiftet, ikke midt i en sæson. En rytter hvis taktik falder 30 point midt i et etapeløb er et supportspørgsmål; den samme rytter mellem to sæsoner er en patch note.

### 5.5 Udkast til spillerkommunikation (5 linjer, EN først, DA under)

> **EN**
> Two abilities — aggression and tactics — were partly measuring a rider's age instead of his ability.
> A 31-year-old got a high tactics number for free; a 21-year-old got a high aggression number for free.
> I have removed that, so all 15 abilities now sit on the same scale: a 9 means the same thing everywhere.
> Most riders' aggression drops by about 13 points and tactics by about 7. The other 13 abilities do not move.
> Nobody got worse — the number just stopped flattering the birth year and started describing the rider.

> **DA**
> To evner — aggression og taktik — målte delvist rytterens alder i stedet for hans kunnen.
> En 31-årig fik et højt taktik-tal gratis; en 21-årig fik et højt aggressions-tal gratis.
> Det har jeg fjernet, så alle 15 evner nu ligger på samme skala: et 9-tal betyder det samme overalt.
> De fleste rytteres aggression falder omkring 13 point og taktik omkring 7. De øvrige 13 evner flytter sig ikke.
> Ingen er blevet dårligere — tallet er bare holdt op med at smigre fødselsåret og begyndt at beskrive rytteren.

---

## 6. Anbefaling

### ✅ C — omskalering ved kilden (anbefalet)

Fjern de to additive alders-led i `abilityDerivation.js:218` og `:223`.

**Fordel:** rammer præcis de to evner der er skæve; rører ikke de tretten der er i orden; er en regel, så nye ryttere fødes rigtigt; fjerner rodårsagen bag `FILL_TAIL_ABILITY_CAP`-lappen; rating-spændet falder fra 1,33× til 1,18×; kun 6 point værste rating-fald.
**Omkostning:** 7.742 ryttere får et lavere taktik-tal, 1.143 spiller-ejede ryttere flytter sig 20+ point. Kræver migration, patch note og spillerkommunikation. Loft-siden (`capsShapingWeights`) skal med i samme PR og kræver eksplicit ejer-go.
**Alternativ hvis den afvises:** B.

### ◻ B — kvantil-mapning pr. evne

**Fordel:** rammer måltallene eksakt; ingen designdiskussion om hvad taktik *bør* måle.
**Omkostning:** inflaterer tre evner der ikke fejlede noget; er fittet mod dagens population og skal refittes ved hver befolkningsændring; løser ikke problemet for nye ryttere; giver meningsløse enkeltudfald (den 36-årige kaptajns taktik 71 → 65 og den 16-årige 27 → 14 på samme mapping).

### ❌ A — udvid kontrast-forstærkningen

**Afvises.** Den gør `tactics` p90 *værre* (55 → 78) fordi kontrasten skubber væk fra rytterens egen median og taktik allerede ligger over den. Den komprimerer samtidig `descending` og `cobblestone` mod gulvet på 8. Og den bygger på en mekanisme der ikke engang er tændt i prod.

### Anbefalet rækkefølge

1. **Dette issue (C)** — retter skalaen ved kilden. Gør #3664's rating ærlig og opfylder forudsætningen i `HOWTO_ADD_ABILITY.md` linje 7.
2. **Nyt spor: fysiologi v2-seed (Task D2)** — tænd kontrasten som designet. Det er et separat, uafhængigt hul der bør have sit eget issue: `aero = NULL` på alle 8.480 profiler betyder at hele `applyContrast` + `PHYS_ANCHORS`-vejen er ubrugt kode i prod i dag.
3. **#3512** — baseline-refit, som planlagt efter dette.

---

## 7. Hvad denne undersøgelse IKKE dækker

- **Værdimodellen er ikke målt.** `valuationWeights.js:25` giver baroudeur `aggression: 3`. Hvor meget markedsværdi og løn flytter sig under C er **ikke** beregnet — det kræver at køre `riderValuationModel` over udtrækket og er et krav før merge.
- **Race engine v4 er ikke kørt.** Jeg har lokaliseret forbrugerne (`finale.ts:56`, `breakaway.ts:152`, `incidents.ts:472`, `cobbles.ts`, `descent.ts`, `weather.ts:102`) men ikke kørt en eneste fixture med de nye tal. Resultat-effekten er argumenteret, ikke målt.
- **Ryttertype-klassifikation er ikke genkørt.** `aggression` har `inClassifier: true`; hvor mange ryttere der skifter primær type under C er ukendt.
- **Loft-siden er identificeret, ikke designet.** Jeg har målt at `tactics`-loftet er fladt 70 for alle og at træningen er gap-proportional, men ikke foreslået konkrete nye tag-værdier. Det er et designvalg der kræver ejeren.
- **`W_EXP = 0.15` i behandling C er ikke tunet.** Den er valgt så median og p90 lander inden for de fysiske evners spænd. Om taktik *bør* have et erfaringselement overhovedet er en designbeslutning, ikke en måling.
- **Ingen prod-mutation er foretaget.** Alt er læst; alle behandlinger er simuleret lokalt på et udtræk.

---

## Kilder

- Måling: `rider_derived_abilities` ⋈ `riders` ⋈ `rider_physiology_profiles`, prod 15/9 2026, n = 8.160 aktive.
- `backend/lib/abilityDerivation.js` · `backend/lib/abilityRegistry.js` · `backend/lib/weights/displayRecipes.js` · `backend/lib/weights/valuationWeights.js` · `backend/lib/weights/capsShapingWeights.js` · `backend/lib/dailyTraining.js` · `backend/lib/engine/v4/`
- `docs/PROGRESSION_RULES.md` §0-§1 · `docs/HOWTO_ADD_ABILITY.md` · `docs/TONE_OF_VOICE.md`
- Issues: #3668 · #3664 · #3665 · #3666 · #3512 · #3458 (Del C) · #4311

**Dom: bekræftet + fix-plan.**
