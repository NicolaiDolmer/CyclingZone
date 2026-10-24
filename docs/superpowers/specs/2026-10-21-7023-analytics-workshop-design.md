# Analyseværksted: truppens udvikling

Issue: [#7023](https://github.com/NicolaiDolmer/CyclingZone/issues/7023). Samtale/design 21/10/2026. Status: plan til ejerreview, **ikke godkendt til build**. Ingen release eller produktionsændring.

## Problem og ejerens intention

Ejeren savner ét overblik over, hvem i truppen der udvikler sig mest, og hvilke evner fremgangen ligger i. Værkstedet skal gøre det let at afprøve én nyttig analyse ad gangen, først privat hos ejeren, senere hos beta og derefter eventuelt alle spillere. Analysefunktioner kan på sigt blive Pro-funktioner; adgang og betaling er separate beslutninger.

Excel er inspiration for hurtig sortering og læsbare datakolonner. Power BI er inspiration for senere at undersøge samme data med forskellige visninger. Ingen rapportbygger, formler, pivottabeller, diagrammotor eller dashboard-editor i første version.

## Beslutningslog fra hele brainstormen

1. Ejeren valgte **A: analyseværksted**, frem for et samlet managerdashboard. Én selvstændig analyse ad gangen; den enkelte analyse skal være enkel og brugbar.
2. Kandidater drøftet: truppens udvikling, løbsbelastning, resultater efter løbstype, økonomiske bevægelser og ligasammenligning. Kun truppens udvikling er valgt nu. Øvrige er ideer, ikke byggekø.
3. Ejeren valgte **B: sum af evneændringer + ændring i hver evne**. Summen er ligeværdige evnepoint; ikke rating, effekt på løbsstyrke eller en årsagsforklaring om træningen.
4. Ejeren valgte **A: indeværende sæson**. Ingen vilkårlig periodevælger i v1.
5. Ejeren ønskede visuelle spørgsmål med muligheder og anbefaling. Brug ét beslutningskort ad gangen ved resterende spilleroplevelsesvalg.
6. Desktop/mobilskitsen blev vurderet positivt: tæt tabel, sum først, sortering på kolonneoverskrifter, navn + tre datakolonner på mobil, udskiftelige kolonner og Fuld tabel. Mockups bruger seks eksempel-evner, opdigtede navne og tal; de er ikke data- eller byggebevis.
7. Ejeren bad derefter om historikundersøgelse og konkret plan med TanStack, kun ejer først, plus online pc1-overdragelse. Dette autoriserer dokumentation og undersøgelse, ikke implementering eller aktivering.

## SSOT og eksisterende runtime

- `docs/PROGRESSION_RULES.md`, afsnit Datoens afsluttende historik: dokumenterede snapshots, baseline og sæsongrænser bevares; ukendt må ikke blive nul.
- `docs/CALENDAR_RULES.md` §0: dato og løbsdag er forskellige akser. Sæsonnummer vælger sæsonen; dato alene er utilstrækkelig.
- `docs/design/PAGE_TEMPLATES.md` T2 og `docs/design/TASTE.md` P1/P5/P10/P11: datatæthed, numerik, mobil D-047, ærligt datagrundlag. Nye produktionskomponenter genbruger primitive styles; mockups erstatter ikke komponenterne.
- `backend/lib/riderDevelopmentReceipt.js`: kalenderhistorik og løbsdags-historik skal ses sammen; kalenderhistorik kan indeholde datoens første tick frem for sidste. Den eksisterende datereducer mister grænsepunkter, hvis den genbruges ukritisk; behold startpunkt separat.
- `backend/lib/proRiderHistory.js`: kildeprioritet, deterministisk sortering og live-punkt. Ingen direkte genbrug af en sæson-slut-reducer som startpunkt.
- `frontend/src/lib/developmentReport.js`: `seasonAbilityGains` bruger første til seneste observerede snapshot og kun positive forskelle. Den kan ikke uden ændret kontrakt give en komplet, ærlig sæsonsum med manglende felter eller fald.
- `frontend/src/components/TeamDevelopmentTab.jsx`: eksisterende holdfane er rating/prognose/loft, ikke denne sæsons evnematrix. Den må ikke erstattes utilsigtet.
- `backend/lib/ownerGate.js` og `requireOwner` i `backend/routes/api.js`: brug eksisterende fail-closed ejer-allowlist. En adminrolle alene er ikke ejer-adgang.

## V1: foreslået konkret udformning

- Selvstændig, lazy-loaded `/analytics` i manager-appen, én analyse direkte på siden; ingen tom katalogforside med én valgmulighed.
- Ejer-only link i navigationen ud fra eksisterende owner-check. API og direkte URL skal også afvise andre. Ejeridentitet og allowlist forbliver server-side.
- Aktuelt eget holds nuværende, ikke-pensionerede ryttere. Trup-felt følger de eksisterende regler; hvis ejeren ønsker senior-only frem for alle egne ryttere, registreres det som særskilt designvalg før byg.
- Kolonner fra den autoritative evneliste og eksisterende labels; ingen håndskrevet kopi. `aggression` findes stadig i registry/runtime, mens NOW omtaler den som udfaset: konsumenten skal afstemmes med godkendt evnekontrakt før byg, ikke bare kopiere alle JSON-nøgler.
- Sum først, derefter evner. Standard: sum faldende; ukendt sidst i begge retninger, stabilt tie-break på navn/id. Synlige kolonnevalg ændrer aldrig hvilke evner summen omfatter.
- Mobil genbruger D-047: navn + tre tal, fast rækkefølge på valgchips, Fuld tabel. Ingen default vandret scroll eller ny mobilstandard.
- Initialt kun deltaer, ingen grafer, eksport, gemte visninger eller potentialeoplysninger. Eksisterende rytterlink er den naturlige vej videre.

## Datakontrakt og ærlighed

Baseline er en dokumenteret `season_transition`-vektor for valgt sæson, ikke første tilfældige træningsgevinst. Den kan ligge dagen før `seasons.start_date`; filtrér med sæsonnummer og kilde, ikke `snapshot_date >= start_date`.

Sammenlign med aktuelle tilladte evner fra `rider_derived_abilities`; vis observationstid fra serveren og baseline-proveniens. Brug historikken som kontrol og forklaring. Snapshots skrives best effort og alene ved visse ændringer, så fravær af en tick-række er hverken nul fremgang eller dokumentation for manglende afregning.

Hver celle er et endeligt numerisk delta eller `null` med årsag. Negative ændringer bevares; beregningen må ikke klippe til positive værdier. Manglende/null/ikke-numerisk start eller slut bliver aldrig tallet nul. Kun allowlistede, allerede synlige evner må forlade backend; aldrig rå abilities-objekter, `hidden_potential`, caps eller progress.

Summen er **kun fuld**, når alle aftalte evner har begge endepunkter. Returnér `knownAbilityCount` og `expectedAbilityCount`; ufuldstændighed må ikke skjules ved at summere færre felter. Observationer af nye/handlede ryttere beskriver hele sæsonen, hvor baseline findes, ikke nødvendigvis fremgang under nuværende manager; en anden afgrænsning kræver eget valg.

## Konkret manglende produktbeslutning før build

Undersøgelsen viste huller i nogle nyere evners sæsonstart og i ungdomstruppernes startpunkter. Det er uforeneligt med at love en komplet sum for alle fra første dag.

Forelæg ét visuelt kort: **A (anbefalet til afprøvning):** vis de dokumenterede celler og en tydeligt mærket delsum med evnedækning; rangér ikke forskellige evnesæt som sammenlignelige. **B:** vis kun fuld sum og ellers ukendt, mens enkeltcellerne stadig kan ses. Valget er ikke taget i samtalen. Indtil det er taget, er API'ets `totalDelta` konservativt null ved ufuldstændighed; ingen delsum må præsenteres som den tidligere valgte fulde sum.

At ændre registrering/backfille startpunkter er en ny opgave med eget mandat; rekonstruér ikke ukendte værdier for at få grøn dækning.

## Teknik og udvidelse

TanStack Table er hovedløsningen for sortering og kolonnestate i dette værksted. Genbrug `DataTable` som renderer med en lokal, typet adapter fra TanStack-rækker og kolonner til de eksisterende props. Ingen generel DataTable-refaktor eller migration af andre sider i v1. Biblioteket installeres i egen dependency-worktree med `-OwnNodeModules`, aldrig gennem en junction. Ingen ny query-cache, router eller virtualisering uden konkret behov.

Én batch-API henter eget holds startpunkter og aktuelle evner. Ingen browserkald pr. rytter. Beregningsmodulet er rent og separat fra transport og React, så senere graf/eksport kan genbruge resultatet. V1 behøver ingen ny tabel, migration eller skrivevej.

Senere beta/alle følger eksisterende serverevaluerede stadieflags og særskilt ejer-go. `off|beta|on` har ikke et owner-stadie; opfind ikke et. Pro-beslutningen er fortsat åben.

## Testplan og go

Før første kode-PR: afklar ovenstående kort og evneliste, registrér ordret Design-go på issue; mål query-plan/latens på isoleret lokal PG17-fixture efter regel 36. Docs-PR'en ændrer ikke DB/runtime og kræver ikke en implementeringsbaseline.

Unit-tests dækker manglende baseline, nye evner, nul/negative ændringer, sæsongrænse med startpunkt før startdato, kildeprioritet, determinisme, sum uafhængig af synlige kolonner og eksplicit injiceret observationstid. API-tests dækker anonym/almindelig/beta/admin-ikke-ejer afvist, ejer tilladt, forfalsket team-id afvist, ingen hemmelige felter og paginerede batchlæsninger over 1.000 rækker.

Ejerpreview viser ægte data privat på desktop 1440 og mobil 390/375/320, sortering, kolonnebytte, Fuld tabel samt loading/error/ukendt. Staging: kun ejer, sammenlign udvalgte rytteres start/slut med kildedata og eksisterende profil. Før beta kommer en ny tester-runde og et selvstændigt adgangs-go. Hastighed måles og rapporteres; der er ikke godkendt et millisekundmål endnu.

Ingen patch notes for denne docs-leverance. Implementeringens spillertekst/patch notes forfattes af ejer/Claude; FEATURE_REGISTRY og områdets SSOT opdateres med den nye kernefeature i samme implementerings-PR.

## Referencer og overdragelse

- [Historikundersøgelse](../../audits/2026-10-21-7023-analytics-history.md)
- [Implementeringsplan](../plans/2026-10-21-7023-analytics-workshop.md)
- [Alle tre visuelle referencer](../../design/analytics-workshop-7023/README.md)
- [Pc1-startprompt](../../sessions/2026-10-21-7023-analytics-pc1.md)
