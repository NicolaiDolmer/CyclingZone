# Simulations-drift: ni målinger, ét mønster

> Syntese fra Discord-sweep 4/8 + natbølge 4.-5. august. Alle tal er målt read-only mod prod eller mod repoets kode — ingen skøn. Kilde-issues i hver sektion.

## Påstanden

De ni fund nedenfor blev fundet uafhængigt af hinanden, i ni forskellige spor. De er ikke ni problemer. **De er ét problem målt ni steder: spillets simulationslag har drevet væk fra designhensigten, og systemerne forstærker hinandens drift.**

Fællesnævneren er ikke dårlig kode. Det er at **driften ikke blev målt** — flere af målingerne nedenfor eksisterede som gates der meldte grønt, eller som issues hvis tal var måneder gamle og faktor 10-1000 forkerte.

Konkret: en puncheur kan ikke eksistere, har ingen etaper at skinne på, kalenderen belønner ikke specialisering, og menneskeholdene kører trættere end feltet. Fire uafhængige mekanismer der alle skubber spillet mod "bred rytter vinder", som er præcis den klage spillerne rejste 4/8.

## Målingerne

### 1. Ryttertyperne er kollapset — 2 af 8 typer findes reelt
[#3325](https://github.com/NicolaiDolmer/CyclingZone/issues/3325). Målt på 8.301 ryttere:

| | ≤21 år | ≥26 år |
|---|---|---|
| climber + tt | **94,0 %** | **89,8 %** |
| puncheur | 0,1 % | 0,1 % |
| baroudeur | 0,5 % | 0,3 % |
| gc | 0,0 % | 0,1 % (4 ryttere i hele spillet) |

Rod-årsag: klassifikatoren bruger nuværende evner, og kontrast-vægtene lader `climber` slå `puncheur` når de deler tre af fire positive evner.

### 2. Terrænet har ikke plads til de manglende typer
[#3349](https://github.com/NicolaiDolmer/CyclingZone/issues/3349). Tier 2 mod 407 rigtige WorldTour-etaper:

| Terræn | Virkeligheden | Cycling Zone tier 2 |
|---|---|---|
| Kuperet | **37,6 %** | 27,7 % |
| Flad | 21,5 % | **30,4 %** |

Kuperet terræn er hvor eksplosive ryttere afgør løb. Der er hverken ryttere af den type (fund 1) eller etaper til dem (fund 2).

### 3. Etaperækkefølgen er hårdsorteret
[#3326](https://github.com/NicolaiDolmer/CyclingZone/issues/3326). 189 etapeløb i sæson 2: **0 % åbner i bjergene, 84 % slutter der, 0 % slutter fladt eller på enkeltstart.** Virkeligheden (41 løb): kuperet finale 37,5 %, bjerg 28,1 %, flad 18,8 %, enkeltstart 15,6 %. Ingen grand tour i tre sæsoner sluttede på en bjergetape; spillet gør det næsten altid.

Konsekvens: hvert etapeløb fortæller samme historie, og den taktiske beslutning er afgjort på forhånd — gem alt til sidste etape.

### 4. Løbsklasse og længde er afkoblet
[#3328](https://github.com/NicolaiDolmer/CyclingZone/issues/3328). 32 af 36 D2-etapeløb er ProSeries med op til 8 etaper (snit 5,6), mod 4 WorldTour-C-løb med snit 6,5. **Det længste løb på kalenderen giver det laveste afkast.** Specialisering betaler sig ikke, fordi klassen ikke betyder noget.

### 5. Kalenderen mangler discipliner
[#3327](https://github.com/NicolaiDolmer/CyclingZone/issues/3327). D2 har 33 % endagsløb mod D3's 76 %, og **4 brosten-etaper i hele tier 2** (2 pr. pulje pr. sæson). En brostensrytter i D2 har reelt ingen løb. Af 36 etapeløb mangler kun 2 en bjergetape.

### 6. Menneskeholdene kører trættere end feltet
[#2650](https://github.com/NicolaiDolmer/CyclingZone/issues/2650). Målt 5/8:

| | Median træthed | ≥70 træthed |
|---|---|---|
| Menneskehold (3.103 ryttere) | **85** | 58,5 % |
| AI-hold (3.737 ryttere) | **54** | **0** |

`aiRecoverySweep` kører altid `intensity: "rest"` (−14), mens menneskeholdenes assistent uden aktiv plan falder tilbage til `normal` (+9). 23 point i forskel pr. dag.

### 7. Kvalitetsgaten kan ikke stoles på
[#3009](https://github.com/NicolaiDolmer/CyclingZone/issues/3009): balance-scorecards exiter grønt trods FAIL. [#3347](https://github.com/NicolaiDolmer/CyclingZone/issues/3347): tier 3's realisme-gate fejler ~11 % af genereringerne på ren tilfældighed (målt over 3.000 syntetiske sæsoner). To gates der ikke betyder det de ser ud til at betyde.

### 8. Pengemængden firdobles — og gaten skjulte det
[#3360](https://github.com/NicolaiDolmer/CyclingZone/issues/3360). Målt 5/8 efter at exit-code-gaten blev rettet (PR #3248, 3/8):

| | Mål | Faktisk |
|---|---|---|
| Pengemængde over 5 sæsoner | ≤1,3× | **4,24×** |
| Holdbalance @S5 | ≤1,3× start | **3,55-3,63×** |
| Net-tilførsel pr. division | ±30.000 | **~319.000** (≈10×) |

Gaten `exit`ede grønt trods FAIL fra før launch til 3/8. `docs/audits/2026-06-21-economy-fase2-calibration.md` erklærer fresh-gaten grøn ("D1 +3,6k, alle ✅"); genkørt i dag giver D1 net 318.712 — **~90 gange drift**. Den fil er stale.

### 9. En display-label styrer økonomien
[#3345](https://github.com/NicolaiDolmer/CyclingZone/issues/3345). `primary_type` er input til `predictBaseValue` to steder. At rette fund 1 ville flytte spillets samlede markedsværdi **−24,5 %** og ændre trupværdien ≥10 % for 239 af 367 hold. Typen er samtidig input til potentiale-lofterne, som selv er input til typen — en cirkularitet.

## Hvorfor de hænger sammen

Spillernes klage 4/8 var: *"lige nu kan det ikke rigtigt betale sig at have bjergryttere kontra en rigtig god sprinter/all round rytter"* (@friisisch). Fire af fundene producerer præcis den oplevelse, uafhængigt af hinanden:

- **1** gør at der ikke findes specialist-labels at købe efter
- **2** gør at der ikke er terræn hvor en specialist slår en bred rytter
- **4** gør at den lange, hårde uge betaler mindre end to korte
- **5** gør at hele discipliner ikke har løb

En spiller der optimerer rationelt i det system ender med brede ryttere. Det er ikke en balance-fejl i motoren — motoren gør hvad den bliver bedt om. Det er at **kalenderen og populationen ikke stiller de spørgsmål specialisering er svaret på.**

Fund **6** forstærker det: et bredt hold tåler den ekstra træthed bedre end et hold bygget om én stjerne. Og fund **7** forklarer hvorfor det kunne løbe så langt uden at blive fanget — vagterne meldte grønt.

## Hvad det betyder for rækkefølgen

Den vigtigste konsekvens er at **fundene ikke bør løses enkeltvis i vilkårlig rækkefølge.** Tre observationer:

**A. Gaten først — og den er allerede lukket.** Fund 7's exit-code-fejl blev rettet 3/8 (PR #3248). Det er præcis derfor fund 8 kunne måles overhovedet. Læringen står: et instrument der lyver gør al måling værdiløs, og her kostede det hele beta-perioden.

**A2. Fund 8 er sandsynligvis det mest alvorlige.** En økonomi der firdobles over fem sæsoner udhuler enhver økonomisk beslutning i spillet — gæld bliver ligegyldig, transferpriser løber, og tidlige spilleres forspring bliver strukturelt. Det gør også fund 9 mindre presserende: hvis pengemængden alligevel skal rekalibreres, er en −24,5 % revaluering af markedsværdier ikke længere en isoleret risiko men en del af samme regnestykke.

**B. Kalender-kæden hænger sammen og har en deadline.** Fund 2, 3, 4 og 5 rører alle etape- og kalender-genereringen, og S3-kalenderen skal bygges før **23/8**. De er kalibreret mod hinanden og bør landes som én kæde i rækkefølgen #3327/#3328 → #3326 → #3349. Bygges S3 før de er inde, cementeres skævheden i endnu en sæson.

**C. Ryttertyperne er blokeret af økonomien, ikke af sig selv.** Fund 1 er den største enkeltstående kvalitetsgevinst, men fund 8 gør den til et økonomi-projekt. Ejer-beslutningen 4/8 (frys værdien på den gamle type, udgiv typerne nu) bryder den afhængighed — det er derfor den beslutning er mere værd end den ser ud.

**D. Fatigue-asymmetrien bør rettes før balance-tal aflæses.** Enhver dominans- eller win-rate-måling sammenligner i dag hold der ikke spiller under samme betingelser.

## Forbehold

- **Fund 2's sammenligning** er tier 2 mod WorldTour. Lavere divisioner kan legitimt have simplere terræn; det er ikke afgjort.
- **Datasættet bag fund 3** er 41 WorldTour-løb hentet med WebFetch + en lille model, ikke en rå HTML-parse. Kun usædvanlige rækker er dobbeltverificeret. Retningen er entydig, procenterne er omtrentlige.
- **Fund 6's konsekvens** er ikke målt. At AI restituerer mere er verificeret; hvor meget det flytter resultaterne er det ikke.
- **Hold-koncentrationen** ([#2557](https://github.com/NicolaiDolmer/CyclingZone/issues/2557)) er med i billedet, men D3-puljerne har kun 4 løb med resultater. "D3-D er i stykker" er ikke understøttet endnu.
- Denne syntese er en **læsning** af otte målinger, ikke en måling i sig selv. Målingerne står ved magt uafhængigt af om læsningen holder.

---

_Natbølge 2026-08-04/05. Rådata: [`docs/research/2026-08-04-stage-race-structure/`](../research/2026-08-04-stage-race-structure/). Alle SQL-forespørgsler read-only; ingen prod-data ændret._
