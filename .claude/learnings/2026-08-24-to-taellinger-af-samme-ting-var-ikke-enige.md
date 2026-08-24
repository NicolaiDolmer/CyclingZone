# To tællinger af samme ting, og de var ikke enige

**Dato:** 2026-08-24 · **Issue:** [#4183](https://github.com/NicolaiDolmer/CyclingZone/issues/4183) · **PR:** [#4199](https://github.com/NicolaiDolmer/CyclingZone/pull/4199)

## Hvad skete der

Tre nye spillere tilmeldte sig i løbet af én dag og blev alle tre placeret i en
pulje der allerede var fuld. Ejer-kravet er absolut: præcis 24 hold pr. pulje
(#2377). Efter den første fejlplacering blev holdet flyttet manuelt — og to
timer senere gentog fejlen sig to gange til.

## Rodårsagen

To steder i koden tæller hold pr. pulje, og de brugte hver sin definition:

| | tæller med |
|---|---|
| `audit-league-size-invariant` (#2377) | alt der ikke er banken og ikke allerede er markeret til fjernelse |
| `pickDivisionForNewTeam` | kun ikke-AI, ikke-test, **ikke-frosne** hold |

Et frosset hold står stadig i puljen, i kalenderen og i løbene. Men fordi
placeringen ikke talte det med, gjorde holdet sin egen plads usynlig. Målt i
prod:

| pulje | invariant | placering | frosne |
|---|---:|---:|---:|
| Division 3 — A | **25** | 24 | 1 |
| Division 3 — B | 24 | 24 | 0 |
| Division 3 — C | **25** | 24 | 1 |
| Division 3 — D | 24 | 24 | 0 |

D3-A og D3-C var de eneste to entry-puljer med et frosset hold. De var derfor
også de eneste to der så ud til at have plads — og de fik begge dagens
tilmeldinger. Det var ikke tilfældigt hvor fejlen ramte; det var determineret.

## Hvorfor det var svært at se

Auditen var rød, og fejlen blev alligevel læst som "én forkert placering, flyt
holdet". Den manuelle flytning fjernede symptomet uden at røre årsagen, så
puljerne så rigtige ud igen — indtil næste tilmelding, som stadig gik samme sted
hen. Tre gentagelser på én dag, fordi reparationen blev målt på "er auditen grøn
nu?" i stedet for "hvorfor valgte koden netop den pulje?".

## Reglen der kom ud af det

**Når to steder i koden besvarer det samme spørgsmål, skal de dele definition —
eller eksplicit forklare hvorfor de ikke gør.** Her var det korrekte svar
faktisk to forskellige spørgsmål, som bare lignede hinanden:

- *"Har puljen en ledig plads?"* → occupancy. Alle der holder en plads tæller,
  uanset tilstand. Samme definition som invarianten.
- *"Hvor mange spillere er der i forvejen?"* → realManagers. Kun til at sprede
  spillere jævnt i overflow-divisionen, hvor AI-fyldet er evict-bart.

Fejlen var at bruge det andet svar til det første spørgsmål. Nu beregnes begge,
med en kommentar ved hver der siger hvilket spørgsmål den besvarer.

**Og: en gentagen "engangsfejl" er ikke en engangsfejl.** Da samme fejl ramte
anden gang samme dag, var det signalet om at gå efter placeringslogikken i
stedet for at flytte endnu et hold. Den regel gælder generelt: to forekomster af
samme symptom = stop med at reparere symptomet.

## Forward-guards

Tre tests i `teamProfileEngine.test.js`, alle verificeret **røde mod koden på
main**:

- frosset hold holder sin plads (fuld entry-pulje ser ikke ledig ud)
- frosset hold gør ikke sin pulje til den mindst-fyldte
- hold markeret til fjernelse **frigiver** derimod sin plads (#2639 bevaret, ikke antaget)

Prod-reparationen kørte via motorens egen `reconcileAiTeamsForPool` i stedet for
håndlavet SQL, så prod endte i den tilstand koden selv ville have produceret.
Den rene SQL-vej ville have sprunget `snapshotRaceResultNamesForTeams` (#1847)
og watchlist-notifikationen (#2524) over.

Beslægtet postmortem fra samme dag:
[`2026-08-24-en-gate-kalibreret-mod-tre-heldige-seeds.md`](2026-08-24-en-gate-kalibreret-mod-tre-heldige-seeds.md)
— også et tal der målte noget andet end det man troede.
