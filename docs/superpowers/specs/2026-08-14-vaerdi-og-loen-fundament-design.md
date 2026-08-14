# Design: værdi- og løn-fundamentet

**Issues:** [#3449](https://github.com/NicolaiDolmer/CyclingZone/issues/3449) · [#3393](https://github.com/NicolaiDolmer/CyclingZone/issues/3393) · [#3360](https://github.com/NicolaiDolmer/CyclingZone/issues/3360) · **Dato:** 2026-08-14 · **Form:** design-session
**Status:** 3 ejer-beslutninger truffet. Målinger fra oplåsnings-workflowet indsættes i §4. Åbne punkter i §6.

> **Ejer-ramme 14/8, ordret:** *"Det er voldsomt vigtigt at det med værdierne bliver designet i dag fuldstændig fremragende, meget langsigtet. Og virkeligt lufttæt. Ikke quickfixes, men langvarige gode løsninger. Det er efter ratings, ryttertyper, potentiale og træning nok det vigtigste vi kan arbejde med."*
>
> **Bindende forudsætning:** ejeren har allerede kommunikeret retningen til spillerne (Discord 11/8, kanal 1524049112322932826). Den retning genåbnes ikke. Dette dokument gør den lufttæt.

---

## 1. Hvad der allerede er lovet spillerne

Ordret fra ejerens egen tekst, 11/8:

- Værdier er i dag *"their potential for prize money over their career"*, fundet ved at simulere mange sæsoner frem med rigtige rytterdata.
- Målet er *"a fully dynamic value system, created with real player data. Real actions, real consequences."*
- *"If managers are paying more for french riders? The values should pick up in that."*
- Næste opdatering: **75 % gammel formel, 25 % ny**, derefter gradvist mod 100 % spillerdrevet.
- *"Right now, the biggest problem is. No one has the money to push the prices up enough."*
- Værdierne falder, og lønnen følger med ned.

Alt herunder er additivt til det. Intet af det skal trækkes tilbage.

## 2. Hvad problemet viste sig at være

### 2.1 Den nye model er ikke dårligt bygget, den er datafattig

Fit-harnessen genkørt read-only mod prod 10/8, tidsbaseret holdout på de seneste 20 % af handlerne:

| Model | MAE |
|---|---:|
| Markedsdrevet v1.1 (#3449) | 38.176 CZ$ |
| Simuleringsbaseret v4 (LIVE) | 28.968 CZ$ |

En model forankret i **simuleret præmiepotentiale** forudsiger altså rigtige handler bedre end en model der er fittet direkte på de handler. På 6/8-datasættet var resultatet omvendt. Det er ikke en fejl i den nye model. Det er et måltal på ejerens egen sætning: *"there was simply not enough data to make the system good enough."*

**Note til fremtidige læsere:** v4 er IKKE fittet mod handelshistorik. `backend/lib/riderValuationFitV4.js` fitter mod sim-output fra `simulateSeasonProduction.js`, altså forventet præmieindtjening pr. sæson. Den fejl blev begået én gang i denne session og rettet.

### 2.2 Markedet kan ikke prissætte niveauet, kun rangordenen

Målt på prod 14/8:

| Mål | Værdi |
|---|---:|
| Spillerhold | 204 |
| Kontanter i alt | 128,9 mio. CZ$ |
| Værdi af spillernes ryttere | 360,3 mio. CZ$ |
| **Kontanter som andel af rytterværdi** | **35,8 %** |
| Median holdsaldo | 733.410 CZ$ |
| Median rytterværdi | 9.959 CZ$ |
| Dyreste rytter i spillet | 73,98 mio. CZ$ (57 % af alle penge i spillet) |

Med 129 mio. i kontanter mod 360 mio. i ryttere kan et fuldt kronedrevet marked ikke finde den rigtige pris. Det finder loftet for hvad nogen kan betale. Og det stopper ikke af sig selv: lavere værdier giver lavere lønninger, hvilket frigiver kontanter, og næste sweep måler igen mod et marked der stadig er for lille.

**Skelnen der løser det:** spillerdata er stærk til at afsløre *præferencer* (hvem er mere værd end hvem, og hvad lægger et fransk pas eller en sprint-evne oveni). Den er svag til at fastsætte *kroneniveauet*, så længe der ikke er penge nok i spillet til at handle toppen.

## 3. De tre beslutninger (ejer 14/8)

| # | Spørgsmål | Valg |
|---|---|---|
| 1 | Skal spillerdata bestemme forholdet mellem ryttere, eller også hvor mange kroner der står? | **Forholdet nu, begge dele på sigt.** Markedet sætter strukturen; simuleringen sætter niveauet. Vi bevæger os gradvist mod fuldt dynamisk |
| 2 | Hvor tit må værdier ændre sig? | **Kun om søndagen.** Aldrig dagligt |
| 3 | Hvad afgør hvornår markedet også får kroneniveauet? | **To målinger, begge skal være grønne.** Ikke en dato, ikke en fornemmelse |

### 3.1 Beslutning 1, konkret

Den spillerdrevne komponent må omfordele **relativt**: rangorden, samt hvad hver egenskab er værd i forhold til de andre (nationalitet, evner, alder, type). Den samlede sum af rytterværdi forbliver forankret i simuleringen af præmiepotentiale.

Blandingen 75/25 og vejen mod 100 % står uændret. Det er kun **hvad** de 100 % bestemmer, der er skarpt afgrænset i fase 1.

### 3.2 Beslutning 3, konkret

Begge mål beregnes automatisk hver søndag og vises i admin. Blandingen rykker først et trin når begge er grønne. Ejeren kan altid sige nej, men systemet foreslår aldrig et skridt på et dårligt grundlag.

| Gate | Måler | Status 14/8 |
|---|---|---|
| **Likviditet** | kontanter / samlet rytterværdi | 35,8 %, tærskel ikke fastsat (§6) |
| **Præcision** | markedsmodellens MAE mod simuleringsmodellens | 38.176 mod 28.968, altså rød |

Gate 2 er selvkorrigerende: jo flere handler der findes, jo bedre bliver den markedsdrevne model, og jo mere retfærdigt bliver det at give den mere vægt. Gate 1 er et håndtag ejeren kan dreje bevidst ved at hæve præmiepenge, sponsorer og budgetter. Det er samtidig vejen til at nå fuldt dynamisk: økonomien skal vokse, ikke værdierne falde.

## 4. Målinger fra oplåsnings-workflowet

_Indsættes når workflow `unblock-values-and-promises` er færdig: frisk MAE-sammenligning, typevalget (`primary_type` mod `valuation_type`) med populationsdeltaer, og konflikt-analysen af #3449 mod main._

## 5. Lønnen

#3393 skifter lønnens **grundlag** fra `current_production_value` til markedsværdi:

```
løn = 15.000 × (markedsværdi / 100.000) ^ 0,55     (gulv 250, intet loft)
```

Konkav fordi truppernes markedsværdi spænder ~400 gange mens den garanterede indtægt kun spænder ~1,25 gange.

**Problemet den løser, målt 5/8** (181 hold, 3.152 ejede ryttere): du betaler mest for den rytter der er mindst værd. En 34-årig koster 14,25 % af sin værdi, et ungt talent 0,70 %.

**Konsekvens af beslutning 1:** fordi simuleringen bliver ved med at bestemme kroneniveauet, flytter søndags-sweepet strukturen men ikke niveauet. Lønformlens input skrider derfor ikke under den. Den skal kalibreres mod den nye fordeling, men ikke mod et nyt niveau hver uge. Det var netop den usikkerhed der holdt #3393 i draft.

## 6. Åbne punkter

| # | Punkt | Hvorfor det skal afgøres |
|---|---|---|
| 1 | **Likviditets-tærsklen** i gate 1 | 36 % i dag. Hvad er grænsen hvor markedet må sætte niveauet? Skal måles, ikke gættes |
| 2 | **Loft på lønnen** | Formlen har gulv 250 og intet loft. Ejeren har selv nævnt *"stupidly high salaries"* som noget han måske hotfixer. Et loft der er designet nu er ikke en hotfix senere |
| 3 | **Typevalget** | Prissætter sweepet på live `primary_type` eller frosne `valuation_type`? De afviger på 4.027 af 6.455 ryttere. Måles i workflowet |
| 4 | **Søndags-kvitteringen** | Ændrer værdien sig hver søndag, skal spilleren kunne se hvorfor. Samme princip som trænings-kvitteringen i #3709 |
| 5 | **Hvad "strukturen" præcist omfatter** | Hvilke egenskaber må markedet omvægte, og hvilke er låst? |

## 7. Doktrin denne model måles imod

- **Styrke straffes ALDRIG.** Et valg der systematisk skærer værdien af stærke ryttere er afvist, uanset hvor pænt det ser ud i et gennemsnit.
- **Simulér-før-ship.** Ethvert trin i blandingen får dry-run mod hele populationen med absolutte deltaer før apply.
- **Ejeren ser live-tilstand før store destruktive prod-indgreb.**
- **Spilleren skal kunne stole på det han ser.** En ugentlig ændring uden forklaring er det modsatte.

## 8. Kilder

Ejerens spillerbesked 11/8 (Discord 1524049112322932826) · #3449 PR-body (blokeringer og MAE) · #3393 PR-body (lønformel og aldersfordeling) · `backend/lib/riderValuationFitV4.js` · `backend/lib/riderValuation.js:117` (frossen type) · prod-målinger 14/8, read-only.
