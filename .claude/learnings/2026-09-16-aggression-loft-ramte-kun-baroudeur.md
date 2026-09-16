# Et loft-tal i et go-kort skal sige HVEM det rammer

**Dato:** 2026-09-16 · **Issues:** #5288, #5280, #5268 · **PR:** #5297

## Hvad skete der

Go-kortet på #5280 (ejer-go 15/9 kl. 19:4x) indeholdt linjen *"lofter tactics 70→55 / aggression 93→70"*. Ejeren sagde merge. Inden for et døgn meldte fire spillere i Discord at deres forventede loft var faldet — baroudeurs hårdest (−7 til −8), gc/sprinter ca. −2, puncheur nul.

Ejerens første forklaring i #dansk-snak var at faldet skyldtes at de to nye evner stod som "-". Den holdt ikke: NULL-evner springes over i **både tæller og nævner** i `ratingForRole()`, og migrationen var ren additiv DDL der flyttede nul point.

Den rigtige årsag var `aggression: 70`:

- `aggression` har caps-vægt i præcis **én** opskrift: `baroudeur`, vægt 3 — hans **signaturevne**.
- `aggression` er ikke i `CRAFT_ABILITIES`, så alle andre typer falder til `andenRolle` (55) eller `svaghed` (45), begge allerede under 70.

Loftet var altså en **no-op for hver eneste rytter i spillet undtagen baroudeurs**, og dets eneste målbare virkning var at skære én arketypes signatur 23 point ned til håndværks-niveau. Regnestykket: aggression vejer 4 af 11 i baroudeurens display-opskrift, så −23 × 4/11 = −8,4 ratingpoint. Observeret: −7 til −8.

## Rod-årsag

Go-kortet beskrev ændringen som **fra-til på et tal**, ikke som **hvem tallet rammer**. Kommentaren i koden argumenterede endda eksplicit for 70 ("en baroudeur må stadig have aggression som sin bedste evne, men ikke op i 93 mens resten af feltet ligger på 9") — men ingen krydsede tallet med `CAPS_SHAPING_WEIGHTS` for at se at baroudeuren var den eneste der overhovedet blev berørt, og at det var hans signatur.

Et loft på tværs af alle typer kan ikke skelne mellem "ejer evnen" og "bruger evnen". Det er strukturelt det forkerte værktøj når en af de berørte evner er nogens signatur. Det rigtige værktøj er et **gulv** pr. (type, evne), som `GC_PUNCH_FLOOR` (#4634/#4098).

## Hvad der blev gjort

`aggression` ud af `MENTAL_ABILITY_TAG_CEILING` (ejer-beslutning 16/9, variant A). `tactics: 55` og `teamwork`/`leadership: 70` står uændret.

## Forward-guard

Ny test i `riderProgression.test.js` måler hvad loft-tabellen **koster** hver arketype i ratingpoint, budget 3. Bevist virksom: sættes `aggression: 70` tilbage, fejler den med `baroudeur mister 10 ratingpoint`.

**Den første guard jeg skrev var forkert** og er værd at huske: jeg målte på **rolleklassen** ("loftet må ikke skære en `signatur`"). Den fejlede straks på teamwork/leadership, fordi `abilityRoleClass` er **binær på fortegn** — enhver positiv vægt, også vægt 1, giver `signatur` (tag 93). Det ejer-godkendte loft på 70 skærer derfor også teamwork (climber, rouleur) og leadership (gc, sprinter) ned fra 93; det koster bare 1,4-1,8 ratingpoint fordi de vejer 1.

Lektien i lektien: **klassen siger ikke hvor meget en evne betyder for en type — vægten gør.** En guard der måler på klasse-navnet kan ikke skelne det accepterede snit fra regressionen. Guarden skal måle den størrelse spilleren faktisk ser.

## Overførbare regler

1. **Et go-kort med et balance-tal skal svare på "hvem rammer det".** Ikke kun fra-til. Kryds tallet med vægttabellen og skriv hvilke arketyper der berøres, og med hvilken vægt.
2. **Et loft kan ikke skelne ejerskab fra brug.** Skal en evne begrænses for dem der *bruger* den, men ikke for den type der *er* den, så er det et gulv-problem, ikke et loft-problem.
3. **Mål guards på den størrelse spilleren ser**, ikke på et internt klassenavn.
4. **Spilleres arketype-opdelte observationer er et diagnoseværktøj.** thelambas "baroudeurs −7, gc −2, sprinter −2, puncheur 0" pegede direkte på vægttabellen og var mere præcis end den første hypotese fra koden.

## Tidslinje

- 15/9 19:4x — #5280 merget med `aggression: 93→70`
- 15/9 20:15 — thelamba melder faldet, opdelt pr. arketype
- 16/9 05:57 — valverde4ever + friisisch bekræfter; ejeren gætter på de tomme evner
- 16/9 ~06:00 — Discord-sweep finder tråden, verificerer i koden, opretter #5288
- 16/9 ~07:00 — ejer vælger variant A; PR #5297 bygget, testet og pushet
