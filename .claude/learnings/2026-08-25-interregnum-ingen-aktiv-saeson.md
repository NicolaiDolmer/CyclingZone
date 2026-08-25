# Interregnum: koden antog at der ALTID findes en aktiv sæson

**Dato:** 25/8 2026 · **Issues:** #4223 (alderen), #4225 (ranglisten), #4226 (mocken) · **PR:** #4224, #4227

## Symptom

Ejeren 25/8 kl. 08:00: *"Alderen bliver lige nu ikke vist korrekt på rytterne."*

Målt på fladen: hver eneste rytter viste `—` i alders-kolonnen. U23/U25-badget var
væk. Pensionsrisiko-advarslen på bud var tavs, så en manager der bød på en
38-årig ikke fik nogen advarsel. Rangliste-siden lå i sin fejltilstand.

## Rodårsag

Ikke en formel-fejl. **Der fandtes ingen sæson med `status='active'`.**

| number | status | |
|---|---|---|
| 1 | completed | |
| 2 | completed | sluttede 23/8 |
| 3 | upcoming | starter 28/8 |

Mindst 12 kaldesteder i frontenden spurgte på `.eq("status","active")`. To
adfærd, afhængigt af om de brugte `.maybeSingle()` eller `.single()`:

- `.maybeSingle()` → `null` → `riderAge.js`'s bevidste "null frem for at gætte"-
  kontrakt (#3071) slog igennem → `—` overalt
- `.single()` → PGRST116 på nul rækker → `throw` → siden nede

Kontrakten fra #3071 er rigtig. **Kilden var forkert.**

## Hvorfor det ikke blev opdaget

Tre lag svigtede samtidig.

**1. Hullet findes kun i et tidsvindue.** Mellem to sæsoner. S1→S2-skiftet varede
under et døgn; her var det fem dage, fordi sæsonstarten blev udskudt fra 25/8 til
28/8. Fejlen har sandsynligvis eksisteret siden S1→S2 og aldrig været synlig længe
nok til at nogen meldte den.

**2. Vores egen e2e-suite var blind.** `restObject("seasons")` i
`mockHandlers.js` returnerer `ACTIVE_SEASON` uanset hvilket filter forespørgslen
bærer. Den gamle `useRiderRankings` kaster mod prod, men kører fint mod mocken.
**561 e2e-tests var grønne mens rangliste-siden lå nede for spillerne.** Filen
advarer selv mod præcis denne fejlklasse i sin `riders`-handler (#3667) — samme
blindhed, en anden tabel. Registreret som #4226.

**3. Ingen invariant dækkede tilstanden.** Vi har fire kalender-invarianter der
kører mod prod hver nat (#4169). Ingen af dem stiller spørgsmålet *"er der en
sæson spillerne kan referere til lige nu?"*

## Lærdomme

**En "null frem for at gætte"-kontrakt flytter fejlen, den fjerner den ikke.**
#3071 gjorde det rigtige ved at nægte at gætte alderen uden et sæson-år. Men
resultatet var at en forkert KILDE blev til et tomt felt frem for en fejl, og et
tomt felt bliver ikke rapporteret som en bug. Kontrakten gjorde fejlen tavs.
Havde helperen kastet, var det opdaget ved S1→S2.

**"Den aktive sæson" er ikke en invariant.** Koden behandlede den som noget der
altid findes. Mellem to sæsoner findes den ikke, og det er en normal, planlagt
tilstand — ikke en fejl. Ethvert nyt kaldested skal svare på: hvad viser denne
flade når ingen sæson er aktiv?

**Samme rodårsag, to forskellige rigtige svar.** Alderen peger FREMAD (den
kommende sæson, fordi rytterne allerede er progresseret ind i den). Ranglisten
peger BAGUD (sidste afsluttede, fordi den kommende har nul resultater). At
genbruge ét fald-tilbage overalt havde gjort ranglisten tom. Derfor to funktioner
i `seasonReference.js` med bevidst modsat præference, ikke én.

**Jeg var selv ved at genindføre #3071.** `RiderRankingsPage` udledte alderen af
ranglistens sæson. Da jeg flyttede ranglisten til S2, ville den samme rytter vise
29 dér og 30 på Mit Hold. Fanget under gennemgangen, ikke af en test. En delt
kilde skal LÆSES fra den delte kilde, også når en lokal variabel tilfældigvis
har det rigtige tal.

**Mocken må ikke være mere tilgivende end prod.** Et filter mocken ignorerer er
et filter ingen test kan bevise. Det er ikke bekvemmelighed, det er falsk grønt.

## Hvad der forhindrer gentagelse

- `frontend/src/lib/seasonReference.js` — ét sted der afgør referencesæsonen,
  i to varianter (fremad til alder, bagud til resultater)
- Forward-guard i `seasonReference.test.js`: fejler hvis
  `.eq("status","active")` falder tilbage ind i `useActiveSeasonYear`
- Tests der koder den FAKTISKE prod-tilstand 25/8, ikke en opfundet fixture
- #4226 åbent på mock-blindheden

## Endnu ikke dækket

De øvrige `.eq("status","active")`-kaldesteder er ikke gennemgået:
`StandingsPage.jsx:144` og `DashboardPage.jsx:239` bruger `.single()` og sluger
fejlen tavst; `TeamStatsTab`, `TeamResultsTab`, `TeamTransferHistoryTab`,
`useTrainingHistory` og `clarityIntegration` bruger `.maybeSingle()`. Backend har
samme mønster i `academyIntake.js:77`, `academyGraduationSweep.js:20` og
`adminSimulateRace.js:115`. Hver enkelt skal besvare spørgsmålet ovenfor.
