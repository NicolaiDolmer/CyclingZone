# Værdimodellens refit: scorecard og gate-afgørelse

Dato: 17. august 2026. Alt måleri er read-only mod prod (`ghwvkxzhsbbltzfnuhhz`) plus en uafhængig gentagelse på staging-branchen `staging-3746-trin7` (`bircbxynabqnypdpoovd`). Ingen rytterværdi er flyttet, hverken i prod eller på staging.

Baggrund: [#3750](https://github.com/NicolaiDolmer/CyclingZone/issues/3750) (modellen trænes på en konstant), [#3449](https://github.com/NicolaiDolmer/CyclingZone/pull/3449) (sweepen, draft), [audit 14/8](2026-08-14-oplaas-vaerdier-og-loefter.md) del 1, [beslutning 3, 15/8](2026-08-15-oekonomi-beslutninger-1-3.md).

---

## Svaret

**Gaten er RØD. Den refittede markedsmodel måler dårligere end den model der kører i dag, på alle tre mål. Markedsvægt-komponenten bør ikke flippes 23/8.**

Men målingen fandt noget bedre end den ledte efter, og det er den vigtigste linje i dokumentet: **markedet siger at v4's rangorden er rigtig og kun dens niveau er forkert.** Den kørende v4 ganget med én konstant på 0,42 slår både v4 selv og den nye markedsmodel på alle robuste mål. Se "Hvad der faktisk virkede" nedenfor.

---

## 1. #3750-fixet: hvad der blev filtreret fra, og hvor meget der er tilbage

Fit-scriptet er skrevet om ([`backend/scripts/fitMarketValueModelV2.js`](../../backend/scripts/fitMarketValueModelV2.js)). Filteret er implementeret som en ren, testet funktion (`buildQualifiedSales`, 20 unit-tests), så kriterierne kan verificeres uden database.

**Kvalificeret evidens** (ejer-vedtaget definition, beslutning 3):

1. auktioner med mindst **to forskellige budgivere** OG en slutpris der **steg over startprisen**, eller
2. **forhandlede handler** (accepterede `transfer_offers`) mellem to menneskehold,
3. undtagen handler over **3x** rytterens ankerværdi,
4. undtagen handler i **par der har handlet 3+ gange** i vinduet.

Bemærk punkt 1: kravet er forskellige **budgivere**, ikke antal **bud**. v1 talte rå bud og fik derfor 331 hvor der reelt er 327 konkurrenceprissatte auktioner. To bud fra samme hold er ikke konkurrence.

| Trin | Handler |
|---|---:|
| Rå handler (completed auctions m. køber + accepterede transfer_offers) | **1.288** |
| − auktioner med under 2 forskellige budgivere | −881 |
| − auktioner hvor prisen ikke steg over startprisen | −0 |
| − transfers der ikke er menneske-til-menneske | −2 |
| − handler over 3x ankerværdi | −5 |
| − handler i par med 3+ handler (1 par) | −9 |
| **= kvalificeret evidens** | **391** |

Heraf **325 konkurrenceprissatte auktioner** og **66 forhandlede handler**. Alle 391 har brugbare evner, alder og type - ingen yderligere frafald.

De 881 frasorterede er kernen i #3750: 869 af 1.208 afsluttede auktioner med køber (**71,9 %**) lukkede på **nøjagtig** startprisen, som er `YOUTH_AUCTION_START_RATE` (0,25) gange modellens eget output. Det var 55 % af auktionsvægten i v1's fit. Modellen lærte en konstant og aflæste den som en pris.

**Værd at bemærke:** at prisfilteret fjernede 0 ekstra handler er ikke et tegn på at det er overflødigt. Hver eneste auktion med to eller flere budgivere fik også prisen budt op. Konkurrence og prisstigning falder sammen i de nuværende data; de to kriterier er stadig begge nødvendige, fordi det kan ændre sig.

### Hvor evidensen ligger, og hvor den ikke gør

Typefordelingen i de 391 er skæv, fordi bankens ungdomsauktioner dominerer: climber 218, tt 97, sprinter 29, rouleur 15, baroudeur 14, puncheur 11, brostensrytter 5, **gc 2**. Type-offsettene for gc og brostensrytter er reelt gæt. Det er ikke rettet - det er rapporteret, jf. #3750's egen linje om at et lille n *er* svaret.

---

## 2. Evidensvægt pr. rytter (beslutning 3)

v1.1 blandede med `w = global_weight × min(1, n/K)` - en hård mætning. v2 bruger beslutning 3's formel:

```
Z_rider = n / (n + K),  K = 12
w_rider = market_value_global_weight × Z_rider
```

`n` er antallet af kvalificerede handler med samme type inden for ±5 O-point og ±3 år. Målt over de 6.348 spillerejede+AI-ryttere (frossen `valuation_type`):

| | P10 | median | P90 | andel med Z = 0 |
|---|---:|---:|---:|---:|
| `n` (sammenlignelige handler) | 1 | 5 | 35 | - |
| `Z` | 0,077 | 0,294 | 0,745 | **9,4 %** |

Median Z pr. aldersbånd: <23 = 0,745 · 23-25 = 0,429 · 26-28 = 0,333 · 29-31 = 0,200 · **32+ = 0,077**.

Det er systemet der opfører sig som det skal: de unge, der handles konstant, følger markedet; de gamle, der aldrig handles, står stille. Beslutning 3 forudsagde at "værdierne rykker sig næsten ikke i starten" med 68 handler. Med 391 kvalificerede handler rykker de sig betydeligt mere end forudsagt - se afsnit 4.

---

## 3. Scorecardet

Samme metode som auditten 14/8: tidsbaseret holdout (seneste 20 % af de kvalificerede handler, n = 78, 8/8-17/8), og **median-absolut-fejl rapporteret ved siden af MAE**, fordi auditten viste at få store handler ellers bestemmer rangordenen. `MAE(ln)` er tilføjet: det er den skala modellen faktisk er fittet på, og den er upåvirket af prisernes størrelsesorden.

Holdout-priserne spænder fra 1.505 til 465.000 CZ$ med median 10.000. Gennemsnitlig MAPE er derfor ubrugelig (den lander på tusindvis af procent, fordi enkelte handler er på få hundrede CZ$). Median-APE er den aflæselige.

**Type-kolonne: frossen `valuation_type`** (den kolonne `riderValuation.js:117` faktisk læser). v4-referencen er altid regnet på `valuation_type ?? primary_type`, uanset hvad markedsmodellen fittes på - ellers ville vi sammenligne med en v4 der ikke kører nogen steder.

| Model | MAE (CZ$) | Median-AE | Median-APE | MAE(ln) |
|---|---:|---:|---:|---:|
| **Markedsmodel v2** (refit) | 29.831 | 8.814 | 74,1 % | 1,018 |
| markedsmodel v2 uden smearing | 30.629 | 6.345 | 66,0 % | 0,963 |
| **v4 (LIVE, den kørende)** | **20.572** | **7.792** | 67,2 % | **0,801** |
| anker ("den værdi han var listet til") | 20.376 | 7.569 | 63,3 % | 0,802 |
| **v4 × 0,422** | 22.841 | **5.830** | 62,3 % | **0,759** |
| anker × 0,328 | 26.135 | 6.325 | **53,1 %** | 0,834 |

**Gate: RØD (0 af 3).** Markedsmodellen taber til den kørende v4 på MAE, på median-AE og på MAE(ln). Kørt med live `primary_type` i stedet er svaret det samme: RØD (0 af 3).

### Tre ting jeg rettede undervejs, som ændrede tallene

- **Log-retransformation (Duan smearing).** En ln-lineær model prædikterer medianen, ikke middelværdien, og undervurderer derfor systematisk prisen i kroner. v1/v1.1 havde ikke korrektionen. Den er en del af forklaringen på at den markedsdrevne model konsekvent prissatte lavere end v4. Faktoren her er 1,53. Bemærk at den forbedrer MAE og forværrer median-AE - den flytter hele fordelingen op, hvilket hjælper på de store handler og skader på de små. Begge tal står i tabellen.
- **Alders-definitionen.** v1 fittede på kontinuert kalenderalder og blev evalueret på heltals-sæsonalder. v2 fitter på sæsonalder ved at mappe hvert salg til den sæson der var aktiv da handlen skete. Fit og runtime deler nu skala. Det var punkt 5 på auditten 14/8's liste over blokerende præmis-fejl.
- **Popularity-konfounden.** Varianten med popularity måler **bedre** (MAE 25.943 mod 29.831), men koefficienten er **negativ**: mere populær giver lavere pris. Det er nøjagtig samme uløste konfound som i v1.1. v1.1's udvælgelsesregel så kun på MAE og valgte derfor den model. v2's regel kræver også at fortegnet er det variablen påstår, og fravælger den. **Det er et bevidst valg af en dårligere måling frem for et led der ikke betyder noget.** Havde jeg beholdt popularity, ville gaten stå GUL (1 af 3) i stedet for RØD - og den ville stå der på et led ingen kan forsvare.

---

## 4. Hvad sweepen ville gøre (tørkørsel)

Kørt read-only mod prod med det refittede artefakt, `global_weight = 1`, loft ±25 %, 6.348 ryttere. Uafhængigt gentaget som ren SQL mod staging-klonen - to implementeringer, to databaser, samme svar (staging: 6.336 ryttere, median +24,99 %, P10 −7,41 %, samlet −8,08 %).

| Uge | Ændret | P10 | Median | P90 | Tabt 25 %+ | Samlet trupværdi |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 5.720 | −7,3 % | **+25,0 %** | +25,0 % | 165 | 286,7M → 263,5M (**−8,1 %**) |
| 2 | 5.720 | −11,3 % | +49,7 % | +56,3 % | 430 | → 249,7M (−12,9 %) |
| 3 | 5.720 | −14,3 % | +68,4 % | +95,3 % | 488 | → 242,4M (−15,4 %) |
| 4 | 5.720 | −15,2 % | +81,9 % | +144,2 % | 511 | → 239,1M (−16,6 %) |

Læs de to kolonner sammen: **medianrytteren stiger 25 % om ugen, og den samlede trupværdi falder 8 %.** Det er ikke en modsigelse, det er en omfordeling. De billige mange rammer det øvre loft hver uge, mens de dyre få falder - og de dyre bærer værdien.

De største bevægelser efter fire uger er udelukkende fald, og de rammer de dyreste unge talenter: en 17-årig tt fra 3,07M til 0,97M, en 17-årig climber fra 2,28M til 0,72M.

Fordelt på division efter fire uger (median): D1 +61,8 %, **D2 +0,6 %**, D3 +60,2 %, D4 +74,4 %. D2 er den eneste division der står stille i medianen, med P10 på −57,9 %.

**Det er præcis grund 3 fra auditten 14/8 igen.** Et uniformt loft der bider hver uge på de bedste ryttere er et handicap, ikke en struktur, og doktrinen siger at styrke aldrig straffes. Det nye filter og den nye evidensvægt ændrer ikke det mønster - de gør det tydeligere, fordi flere ryttere nu har evidens nok til at bevæge sig.

---

## 5. Hvad der faktisk virkede

Den mest præcise model på de kvalificerede handler er **den model vi allerede har, ganget med en konstant.**

`v4 × 0,422` slår markedsmodellen på alle tre robuste mål og slår den rå v4 på median-AE (5.830 mod 7.792), median-APE (62,3 % mod 67,2 %) og MAE(ln) (0,759 mod 0,801). Skalafaktoren er medianen af pris/v4-værdi over de 313 træningshandler.

Fortolkningen: markedet er **enigt med v4 om hvilke ryttere der er mest værd**, og **uenigt om niveauet med en faktor på cirka 2,4.** Det svarer til hvad de rå tal viser - konkurrenceprissatte bank-auktioner clearer på median 0,33 × værdi, spillerudbudte auktioner på 0,26 ×, forhandlede handler på 0,78 ×.

Det peger på en langt mindre indgribende rettelse end et modelskifte: én niveaukorrektion, én gang, som ejeren har set og godkendt, i stedet for en ugentlig kværn. Det er ikke besluttet her, og det er ikke bygget her.

**Vær opmærksom på cirkulariteten før nogen handler på tallet.** Ankeret (`riders.market_value`, som er v4's eget output) scorer 20.376 - næsten identisk med v4's 20.572, fordi det er det samme tal. Auditten 14/8 påviste at 65 % af handlerne dengang lukkede på ankeret. Efter #3750-filteret er de handler væk, men bankens auktioner starter stadig på 0,25 × ankeret, så prisen er stadig delvist en funktion af den værdi modellen selv satte. **En skalafaktor fittet på de handler vil derfor delvist måle sin egen udgangsværdi.** De 66 forhandlede handler er det eneste helt uafhængige signal vi har, og de er for få til at bære en niveaukorrektion alene.

---

## 6. Åbne spørgsmål, som ejeren skal svare på

1. **Kanalniveauet.** En diagnostisk kanal-dummy siger at auktionskanalen clearer **35,9 % lavere** end den forhandlede for samme rytter. Modellens niveau er dermed et vægtet gennemsnit af to markeder, ikke ét markedsniveau. Skal en rytters værdi afspejle hvad han ville hente i en forhandlet handel, eller på auktion? Det er et designvalg, ikke et fit-valg, og scriptet træffer det ikke.
2. **Type-kolonnen.** Stadig ikke besluttet (divergensen er 73,8 % pr. i dag, 4.685 af 6.348). Begge kolonner er målt, begge giver RØD gate. Beslutningen haster mindre nu, netop fordi den ikke redder modellen.
3. **Loftet på ±25 %.** Tallet er ikke bekræftet. Tørkørslen viser at det binder for stort set hele populationen hver uge, i begge retninger.
4. **Om markedsvægt-komponenten overhovedet skal med 23/8.** Min anbefaling er nej på den model der findes i dag.

---

## 7. Hvad der ikke er gjort

- **Intet er promoveret.** Artefaktet ligger i `backend/lib/marketValueModelV2.json` og læses ikke af nogen kørende kode. Sweep-koden ligger stadig kun på #3449's branch.
- **Migrationen er inert på tre måder** (`database/2026-08-17-3750-market-value-config.sql`): flaget seedes `off`, `market_value_global_weight` seedes **0** (så selv et fejlagtigt flip ikke flytter noget), og der findes ingen læser af nøglerne på main. Verificeret idempotent på staging: en gentagen kørsel med ændrede værdier ændrede intet.
- **Der er ikke rørt ved prod.** Det eneste der er skrevet nogen steder er de tre config-rækker på staging, som en verifikation af migrationen.
- **Skalafaktor-sporet er målt, ikke bygget.** Det er en anbefaling, ikke en leverance.

## 8. Hvad der kunne gøre denne konklusion forkert

- **n = 391, og holdout er 78 handler over ni dage.** Rangordenen mellem to modeller på 78 observationer er ikke robust. Forskellene er dog store nok (v4's MAE(ln) er 21 % lavere) til at de ikke er en tilfældighed alene.
- **Anker-cirkulariteten er reduceret, ikke fjernet.** Se afsnit 5.
- **v4 evalueres med evnerne fra salgsdagen**, ikke med den værdi rytteren faktisk var listet til. Det er den samme forudsætning auditten 14/8 kørte under.
- **Type-offsettene for gc (n = 2) og brostensrytter (n = 5) er reelt gæt.** En anden fordeling af handler kunne flytte markedsmodellens tal mærkbart.
- **Skalafaktoren 0,422 er en median over træningssættet**, ikke en fittet parameter med usikkerhedsbånd. Den skal måles ordentligt før nogen bruger den.
