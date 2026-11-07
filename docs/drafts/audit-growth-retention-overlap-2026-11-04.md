# Overlap mellem løbsoplevelse, onboarding og varig fastholdelse

Dato: 4. november 2026. Refs #7495.

Status: læsende audit og designgrundlag. Ingen nye issues, labels, lukninger, kodeændringer eller releasehandlinger. Ejer ønsker permanente funktioner med værdi for både nye og nuværende spillere. De første, særskilt førstegangsrettede wireframes er ikke valgt.

## Konklusion

En ny onboardingpakke eller endnu en replay-visning vil overlappe eksisterende arbejde. Den relevante rest er at gøre holdets valg og det dokumenterede løbsforløb forståelige i den allerede eksisterende løbsoplevelse. Taktikpakken #7266 har allerede ejerkravet om, at ordrer både skal kunne mærkes og forstås i rapporten.

Onboarding skal hjælpe spilleren med at lære dette varige forløb. Den skal ikke være et isoleret spil eller et separat engangsprodukt. Erfarne spillere skal kunne springe introduktionen over og fortsat få nytte af den samme funktion.

## De nærmeste eksisterende spor

| Issue | Observeret status | Leveret grundlag og resterende rolle |
|---|---|---|
| [#7266](https://github.com/NicolaiDolmer/CyclingZone/issues/7266) | Åbent | Taktikpakken er integreret; senere kommentarer fastholder behovet for mærkbar ordrevirkning og en forståelig rapport. Nærmeste produktmæssige ramme for en permanent plan/forløb-opsamling. |
| [#6570](https://github.com/NicolaiDolmer/CyclingZone/issues/6570) | Lukket | Replay, øjeblikke, mellemtider, finale og referat er leveret. PR #6643 er merget; PR #7454 fjernede den gamle etapeside. Ingen ny parallel replay-flade bør opfindes. |
| [#6469](https://github.com/NicolaiDolmer/CyclingZone/issues/6469) | Lukket ved seneste snapshot | PR #7275 har leveret forklaringer på konkrete udbrudsudfald og udvalgte ordreeffekter. Dette er ikke et universelt bevis for, at alle taktiske konsekvenser kan forklares. #7381/#7329 er særskilte opfølgningsspor. |
| [#6350](https://github.com/NicolaiDolmer/CyclingZone/issues/6350) | Åbent | Tidspunkt, rækkefølge og præcision i hændelsesloggen har fortsat konkrete rester, selv om PR #6632 er merget. Mere præcise forklaringer kræver et pålideligt grundlag. |
| [#7643](https://github.com/NicolaiDolmer/CyclingZone/issues/7643) | Åbent | Ejerens eksisterende samlede sandhedsvagt for resultat, løbsfilm, referat og etapeplan. Nye guards for samme klasse hører her, ikke i et nyt issue. |
| [#7635](https://github.com/NicolaiDolmer/CyclingZone/issues/7635) | Åbent | Konkret fejl i fortolkningen af en feltopdeling. Ejerens løsning og tilknytning til #7643 findes allerede. Må ikke forveksles med et nyt produktønske. |
| [#1140](https://github.com/NicolaiDolmer/CyclingZone/issues/1140) | Åbent, delvist leveret | Ejerretningen er egen udtagelse og et taktisk valg til et rigtigt, kommende løb, ærlig ventetid og tilbage til resultat/næste valg. Ingen fiktiv introduktionskonkurrence eller tvungen lineær tour. FirstRaceCard er leveret via #6534; kontakten blev læst som tændt i denne session. |
| [#5104](https://github.com/NicolaiDolmer/CyclingZone/issues/5104) | Åbent | Målingen fra signup til første reelt udtagelige løb, herunder sæsonpause/tom kalender. Eksisterende forudsætning for at udforme en ærlig første oplevelse. |
| [#1369](https://github.com/NicolaiDolmer/CyclingZone/issues/1369) | Åbent | Ejer for den løbende måle- og eksperimentrytme. Aktivitet og tilbagevenden skal måles på sammenlignelige populationer; nye og etablerede spillere holdes adskilt. |
| [#4964](https://github.com/NicolaiDolmer/CyclingZone/issues/4964), [#6291](https://github.com/NicolaiDolmer/CyclingZone/issues/6291) | Åbne | Historisk kohorteundersøgelse og måledefinitioner. Gamle titeltal er ikke aktuelle facts; flere historiske fald var påvirket af instrumentering og samtykke. Nye målinger er private. |
| [#6919](https://github.com/NicolaiDolmer/CyclingZone/issues/6919) | Åbent | Bredere vækstretning med første oplevelse, deling, notifikationer og assistent. Byg videre gennem de eksisterende delspor; en assistent med nye løbende udgifter er ikke godkendt her. |
| [#3513](https://github.com/NicolaiDolmer/CyclingZone/issues/3513) | Åbent, delvist leveret | Sportsforsidens faste rygrad med siden-sidst og næste handling samt tilpasning. En ny dashboardflade skal afstemmes med denne kontrakt og DASHBOARD_RULES. |
| [#3395](https://github.com/NicolaiDolmer/CyclingZone/issues/3395) | Åben epic | Samler løbsoplevelse, fortælling og levering. En første bølge er leveret, men epicens rester kræver afstemning. Et bredt samlingspunkt, ikke erstatning for de konkrete taktik- og korrekthedsissues. |

## Permanent tilknytning og fremgang

- [#2490](https://github.com/NicolaiDolmer/CyclingZone/issues/2490): rytterkrøniken. Eventfundament og karrieremilepæle findes delvist; sammenhængende biografi og forbindelser på tværs af klubber/sæsoner er ikke dermed leveret.
- [#5180](https://github.com/NicolaiDolmer/CyclingZone/issues/5180): fremadrettede ryttermål/achievements. Eksisterende karriereførste-gange og palmarès skal genbruges, ikke opfindes igen.
- [#5061](https://github.com/NicolaiDolmer/CyclingZone/issues/5061) og [#935](https://github.com/NicolaiDolmer/CyclingZone/issues/935): hold-/managerfølgning og relationer. Beskeder og profiler er delvist leveret; en vedvarende følg-relation er et særskilt restbehov.
- [#1154](https://github.com/NicolaiDolmer/CyclingZone/issues/1154): rytterpersonlighed og klubrelation. Planlagt, men ikke et færdigt loyalitetssystem; ingen ny loyalitetsbonus er godkendt her.
- [#1136](https://github.com/NicolaiDolmer/CyclingZone/issues/1136): progression og livscyklus. Udvikling er en eksisterende permanent motor, selv om epicen stadig har åbne dele.
- [#4592](https://github.com/NicolaiDolmer/CyclingZone/issues/4592): parkering og tilbagekomst. Tilbagekomst er delvist leveret; kommunikationsrester skal afstemmes med samtykke og faktisk afsendelse.

Disse spor illustrerer samme princip: spilleren skal kunne se konsekvenser, følge fremskridt, have noget at forberede og bevare en relation til hold, ryttere og andre managers. Onboarding lærer spilleren at bruge disse funktioner; de skal fortsætte med at være meningsfulde efter introduktionen.

## Hvad koden faktisk viser

`RaceStoryCard.tsx` og `raceStoryModel.ts` indeholder replay, udvalgte hændelser, mellemtider og et referat med løbets vinder og egen bedste rytter. `RaceTeamTab.jsx` kan vise holdet efter løbet med etaperoller og overrides. Det dokumenterer byggesten, ikke en komplet opsamling af hver egen rytters plan og faktiske forløb.

`RACE_ENGINE_RULES.md` kræver, at fortællingen afledes af den gemte log. Ordreudsagn kræver egne ryttere og den faktisk kørte indsats. En planlagt ordre er ikke alene bevis på, at den blev udført, og et udfald beviser ikke en årsag eller et hypotetisk bedre resultat.

Før et konkret UI-design godkendes til byg, skal det afklares, hvilke historiske etapeordrer der faktisk kan læses i efterløbsvisningen, og hvilke observerede hændelser der har sikker provenance. Ukendte oplysninger skal forblive ukendte.

## Anbefalet forankring

- Produktbehov og konkret rest: #7266, koordineret med det leverede forklaringslag #6469 og dets eksisterende opfølgninger.
- Korrekthed og hændelsestidslinje: #6350 og #7643.
- Introduktion til det fælles forløb: #1140 og tidsmålingen #5104.
- Måling af nytte og tilbagevenden: #1369, med historisk kontekst fra #4964/#6291.
- Eventuelle ændringer af dashboardets overordnede struktur: #3513.

Ingen ny dublet er oprettet. Denne afstemning er ikke et build-go, en ny prioritering af MASTERPLAN eller en merge-anbefaling.

## Verifikation og begrænsninger

Der er hentet et snapshot af 29 relevante issues med kommentarer. De centrale leverancehenvisninger blev kontrolleret mod 12 faktisk mergede PR'er: #6534, #7454, #6643, #7275, #6632, #3252, #2497, #3323, #5025, #7011, #2505 og #1702. #1583 blev særskilt kontrolleret som et lukket issue, ikke en PR. Søgefund og udvalgte runtimekilder er krydstjekket; denne audit er ikke en ny browser-/produktionsverifikation af alle historiske acceptkriterier. Status kan ændre sig, mens PC1 arbejder.

Skill-retro: fuld housekeeping-lukning og labelændringer er fravalgt, fordi ejerens aktuelle mandat er læsning/design. Et særskilt audit-only-afsnit i housekeeping-skillen ville gøre denne afgrænsning tydeligere. Ingen skill er ændret.