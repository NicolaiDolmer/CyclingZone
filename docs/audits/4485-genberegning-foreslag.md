# #4485 — Genberegningsforslag: ungdomsklassement sæson 3

> Status: FORSLAG, ikke kørt. Ejer-beslutning 31/8: "valg B — kodefix nu, genberegning senere efter ejer-review". Dette dokument er det review-grundlag. Al måling herunder er SELECT-only mod prod (`ghwvkxzhsbbltzfnuhhz`), 31/8-2026. Ingen skrivning er foretaget.

## Baggrund

Kodefejlen (denne PR) er beskrevet i #4485: `loadSeasonReferenceYear` i `backend/lib/raceRunner.js` og `referenceYear` i `backend/lib/seasonAcademyIntake.js` udledte referenceåret af `seasons.start_date` (wall-clock-tidspunktet for sæsonskiftet) i stedet for SSOT-formlen i `backend/lib/riderSeasonAge.js` (`LAUNCH_REFERENCE_YEAR + (sæsonnummer − 1)`). Da alle sæsoner hidtil er skiftet inden for kalenderåret 2026, stod `seasonRefYear` fast på 2026 uanset sæsonnummer — sæson 3's rigtige referenceår er 2028.

Konsekvensen ramte kun **ungdomsklassementet i sæson 3-løb**, fordi det er den eneste live forbruger af `loadSeasonReferenceYear`. Rytterprofilens alder (som bruger SSOT'en direkte) har hele tiden vist det rigtige tal — det var netop uoverensstemmelsen mellem de to, spillerne rapporterede i Discord.

## De 3 berørte løb

Alle tre er `stage_race`, status `completed`, sæson 3 (`seasons.number = 3`, referenceår 2028):

| Løb | race_id | Klasse |
|---|---|---|
| Tour of South Australia | `8e9feb96-3ade-483e-94ca-18cdafcb95db` | OtherWorldTourA |
| Vuelta a los Pirineos (1) | `34955148-8ac3-498d-b7f1-f90ab5f598e7` | OtherWorldTourC |
| Vuelta a los Pirineos (2) | `8ed6454d-7f45-4d93-aa7a-d822b09824cb` | OtherWorldTourC |

(Der findes en fjerde `Tour of South Australia`-instans i sæson 2, `8cb3f330-…`, og en i sæson 1 — begge URØRTE, fordi referenceåret for sæson 1/2 tilfældigvis matcher 2026 for sæson 1 og først driver +1 år fra sæson 2. Sæson 2-instansen ER teoretisk også ramt, men reglen `deriveIsU25FromBirthdate` bruger `>` ikke `≥`, og en 1-års drift i sæson 2 rammer kun den smalle 24,x-årige båndbredde — målt: 0 forkerte rækker i sæson 2-instansen. Ikke medtaget i "de 3 løb", jf. issuets egen afgrænsning.)

## Målt omfang

### Slutklassementet (`result_type = 'young'`) — det der udløser præmier

**64 forkerte rækker** på tværs af de 3 løb (rytterens sæson-3-alder ≥ 25, men stod som U25):

| Løb | Forkerte rækker | Heraf med udbetalt præmie |
|---|---|---|
| Tour of South Australia | 19 | 1 (rank 2) |
| Vuelta a los Pirineos (34955148) | 45 (2 løb slået sammen) | 2 (rank 1 + rank 3) |
| Vuelta a los Pirineos (8ed6454d) | — | 1 (rank 1) |
| **I alt** | **64** | **4 rækker, 19.200 CZ$** |

Kun rang 1-3 udløser præmie i ungdomsklassementet (fast beløbstabel pr. `race_class`, uafhængig af hvem der besætter pladsen — bekræftet ved opslag). De øvrige 60 forkerte rækker var ikke-udbetalende placeringer (rang 4-91), men er stadig forkert *klassificerede* (stod synligt i klassementet som U25).

De 4 udbetalende rækker matcher **præcis** de 4 ryttere spillerne navngav i Discord-tråden (Kaito Yoshida, Hugo Moreau, Bram Coppens, Cooper Bennett var i Tour of South Australia — kun Kaito Yoshida (rang 2) fik udbetalt præmie, de tre andre stod rang 4/8/10 og fik 0 kr., men var stadig synligt forkert placeret):

| Løb | Rang | Rytter | Hold | Født | Sæson-3-alder | Præmie (før) |
|---|---|---|---|---|---|---|
| Tour of South Australia | 2 | Kaito Yoshida | Guaracha Guerreros | 2002-03-14 | 26 | 4.950 CZ$ |
| Vuelta a los Pirineos (34955148) | 1 | Gonzalo Herrera | A-PEX VELO | 2002-04-04 | 26 | 6.000 CZ$ |
| Vuelta a los Pirineos (34955148) | 3 | Nathan Maillot | Reynolds Team | 2002-09-22 | 26 | 2.250 CZ$ |
| Vuelta a los Pirineos (8ed6454d) | 1 | Daan Visser | Suconia STNS Cycling Team | 2003-12-10 | 25 | 6.000 CZ$ |
| **Sum** | | | | | | **19.200 CZ$** |

Alle 4 hold er **menneskestyrede** (`teams.is_ai = false`), ikke AI-hold.

De resterende 60 forkerte rækker (rang 4-91, alle 0 kr. i præmie) er listet i sin fulde form i forespørgslen der producerede denne tabel (raceRunner.js's `deriveIsU25FromBirthdate`, referenceår 2028) — udelades her for læsbarhed, men skal indgå i den faktiske genberegning (de skal have `is_u25`/klassement-medlemsskab rettet, uanset om der er penge involveret).

### Yderligere fund — daglige ungdomstrøjer (`result_type = 'young_day'`)

Samme fejl ramte også de **mellem-etape** dag-klassementer (den viste "ungdomstrøje" efter hver etape). Dette lå **udenfor** det tal ejeren allerede havde (19.200 CZ$) og er et selvstændigt fund fra denne audit:

| Løb | Forkerte young_day-rækker | Udbetalt præmie |
|---|---|---|
| Tour of South Australia | 95 | 2.250 CZ$ |
| Vuelta a los Pirineos (begge) | 229 | 2.625 CZ$ |
| **I alt** | **324** | **4.875 CZ$** |

**Samlet økonomisk eksponering hvis begge klassementer rettes: 19.200 + 4.875 = 24.075 CZ$.** Ejerens tal (19.200) dækker kun slutklassementet — dag-trøjerne kræver en separat beslutning om de skal med i samme oprydning (anbefaling: ja, samme rodårsag, samme script, se nedenfor).

### Points earned (klassementspoint, ikke direkte CZ$)

64 slutklassement-rækker bar tilsammen 256 fejlagtigt tildelte `points_earned` (66 TSA + 190 Vuelta). Disse point fodrer efter alt at dømme `season_standings.total_points` for de involverede hold — **ikke undersøgt i dybden i denne audit** (SELECT-only, tidsbegrænset), men bør tjekkes som en del af selve genberegningen, fordi det kan påvirke divisionsplacering/præmier på sæson-niveau, ikke kun løbs-niveau.

## Før/efter for de 4 udbetalende rækker — hvem er retmæssigt ramt

Fordi præmietabellen (rang 1/2/3) er en FAST tabel pr. `race_class` (ikke data-afhængig), er den samlede præmiepulje for top-3 i hvert løb konstant. At fjerne de forkerte ryttere fra top-3 flytter automatisk retmæssige U25-ryttere OP i rækkefølgen. Målt "hvem ville stå der i stedet":

**Tour of South Australia** (rang1=7.950 / rang2=4.950 / rang3=3.000 CZ$):
| Ny rang | Rytter | Hold | Alder | Fik før | Skylder efter |
|---|---|---|---|---|---|
| 1 | Rubén Lozano | Équipe Lorraine Acier | 24 | 7.950 (allerede rang 1 — uændret) | 0 |
| 2 | Pieter Claes | NewE Pro Cycling | 23 | 3.000 (var rang 3) | +1.950 |
| 3 | Jakub Adamczyk | LEGO-Vestas Cycling Team | 20 | 0 (var rang 6) | +3.000 |

**Vuelta a los Pirineos, 34955148** (rang1=6.000 / rang2=3.750 / rang3=2.250 CZ$):
| Ny rang | Rytter | Hold | Alder | Fik før | Skylder efter |
|---|---|---|---|---|---|
| 1 | Ryan Whitfield | Borregaard Racing | 24 | 3.750 (var rang 2) | +2.250 |
| 2 | Corentin Aubert | Metro-L3 | 24 | 0 (var rang 4) | +3.750 |
| 3 | Hyun Ahn | A-PEX VELO | 24 | 0 (var rang 5) | +2.250 |

**Vuelta a los Pirineos, 8ed6454d** (rang1=6.000 / rang2=3.750 / rang3=2.250 CZ$):
| Ny rang | Rytter | Hold | Alder | Fik før | Skylder efter |
|---|---|---|---|---|---|
| 1 | Florian Wolf | Chris Machines | 20 | 3.750 (var rang 2) | +2.250 |
| 2 | Stefano Bruno | Suconia STNS Cycling Team | 24 | 2.250 (var rang 3) | +1.500 |
| 3 | Kenta Ogawa | Team Riskær | 23 | 0 (var rang 4) | +2.250 |

Alle 8 modtager-hold er menneskestyrede. Bemærk at "Suconia STNS Cycling Team" både er holdet der fik den FORKERTE udbetaling (Daan Visser, rang 1) OG holdet der er berettiget til en EKSTRA udbetaling (Stefano Bruno, ny rang 2) i samme løb — to forskellige ryttere på samme hold.

**Sum "skylder efter" pr. løb er identisk med "fejludbetalt" pr. løb** (4.950 / 8.250 / 6.000 = 19.200 CZ$ i alt), fordi præmiepuljen for top-3 er fast — pengene flytter internt i klassementet, de forsvinder ikke. Det er ikke en tilfældighed men en konsekvens af den faste rang-baserede tabel.

## Anbefalet metode til selve genberegningen (KUN forslag)

1. **Skriv ét idempotent engangsscript** (`backend/scripts/dev/recompute4485YoungClassement.mjs`, efter mønster fra `backend/scripts/repair2251Tier4GrandTours.js` m.fl.) der for hver af de 3 (eller inkl. de 2 daglige varianter, 5) berørte løb:
   - Genbruger den EKSISTERENDE GC-rækkefølge (rører ALDRIG `finish_time`/rang i `gc`-rækkerne — det er den fastlåste sportslige facitliste).
   - Filtrerer GC-feltet til reelt U25 via `ageForSeason(birthdate, 3)` fra `riderSeasonAge.js` (samme SSOT som kodefixet i denne PR).
   - Genopbygger `young`/`young_day`-rækkerne 1..M med SAMME rang/tie-break-logik som `raceResultsEngine.js` bruger i dag (skal spejles nøjagtigt — ikke gættes på ny — for at undgå en SJETTE kopi af klassement-logikken).
   - Genberegner `prize_money`/`points_earned` pr. den eksisterende `buildRacePointsLookup`-tabel (samme kilde motoren selv bruger).
   - Kører **dry-run som standard** og printer en fuld diff (rytter, gammel rang/præmie → ny rang/præmie) mod nuværende `race_results`-rækker, uden at skrive.
2. Ejeren gennemgår dry-run-diffen (denne fil er et forhåndsudkast til den diff, målt manuelt via SELECT).
3. Kun EFTER eksplicit "kør"-godkendelse: scriptet opdaterer `race_results`-rækkerne (idempotent — kan køres igen uden dobbelt-effekt) og udbetaler differencen (se næste afsnit) via den normale prize-udbetalingssti, ikke en direkte `UPDATE balance`.

Ingen kørsel i denne PR — kodefixet (raceRunner.js + seasonAcademyIntake.js) forhindrer NYE forkerte rækker fra dags dato; de historiske rækker ovenfor står urørte indtil ejer-go.

## Håndtering af de 19.200 CZ$ (+ evt. 4.875 CZ$ for young_day) — to forslag

**A — Ingen tilbagetrækning, kun efterbetaling af de retmæssige (anbefalet)**
Fjern de 64 forkerte ryttere fra klassementet og betal de retmæssige top-3-ryttere differencen (tabellen ovenfor). De 4 hold der allerede har modtaget en forkert præmie beholder den. Nettoomkostning for spillet: 19.200 CZ$ (24.075 CZ$ med young_day) som en engangsudgift, ingen spiller mærker en negativ transaktion.
- 👍 Ingen spiller straffes for en motorfejl der ikke var deres skyld; ingen forklaringskrævende negativ saldo-post; billigst i supportbyrde.
- 👎 Lille, engangs økonomisk lækage (beløbet er allerede brugt af de 4 hold — men er trivielt i forhold til holdenes nuværende saldi, som ligger fra 14.360 til 1.058.929 CZ$).

**B — Fuld reversering: træk fra de 4 forkerte, betal de retmæssige**
Samme klassement-rettelse, men de 4 hold der fik forkert præmie får den trukket tilbage (evt. til negativ saldo, ingen har mindre end 14.360 CZ$ stående så det dækker beløbet i alle 4 tilfælde). Nettoomkostning for spillet: 0 CZ$.
- 👍 Økonomisk retvisende, ingen lækage.
- 👎 4 aktive spillere får en uventet, uforklaret debitering for noget spillet selv gjorde forkert — kræver kommunikation, føles som straf for et resultat de ærligt opnåede inden for de daværende (fejlbehæftede) regler.

**Anbefaling: A.** Beløbet er lille i forhold til holdenes saldi og spillets samlede økonomi, og en retroaktiv straf af 4 tilfældigt udvalgte spillere for en motorfejl skaber mere støj (support, tillid) end de sparede 19.200 CZ$ er værd. young_day (4.875 CZ$ ekstra) bør efter samme logik tages med i samme oprydning, samme script, samme A/B-valg — ingen grund til at behandle dem forskelligt fra slutklassementet.

## Ikke undersøgt (out of scope for denne SELECT-only audit)

- Om de 256 (+65 young_day) fejlagtige `points_earned` har påvirket `season_standings.total_points` og dermed divisionsplacering/sæson-præmier for de involverede hold. Bør tjekkes FØR scriptet fra afsnit "Anbefalet metode" køres, fordi det kan udvide hvem der skal kompenseres.
- Sæson 2-instansen af Tour of South Australia (målt 0 forkerte rækker, men ikke fuldt revideret for `young_day`).
