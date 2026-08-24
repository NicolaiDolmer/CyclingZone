# Svarudkast: løbsdage, etaper pr. dag og træning (#4162, #4164)

Til #dansk-snak. Begge tråde er på dansk, så udkastet er på dansk. **Du poster selv.**

Verificeret mod koden 24/8 (`dailyTrainingEngine.js`, `dailyTraining.js`, `raceFatigue.js`, `raceRunner.js`) og mod prod: `daily_training_enabled` og `race_day_engine_enabled` er begge **on**.

---

## Til egomadsen (#4164) — træner man af at køre løb?

> Til dit spørgsmål om træning og løb — her er hvordan det faktisk virker:
>
> En løbsdag **erstatter** dagens træningspas, den lægger sig ikke oven i. Så en rytter får aldrig begge dele.
>
> Løbet er lidt mere værd end det pas det erstattede, omkring 15 % mere. Til gengæld går det hele i de evner etapen krævede: en bjergetape bygger klatring, udholdenhed og robusthed, en flad etape bygger fladt, spurt og acceleration. Du styrer altså ikke hvad han træner den dag — etapen gør.
>
> Og til det du egentlig spurgte om: **det gør ingen forskel om han kører 1 etape eller 6 på samme dag.** Udviklingen gøres op én gang i døgnet. Træthed gør den ikke — hver etape lægger sin egen belastning på, mens restitutionen kun kommer én gang i døgnet. Seks etaper på én dag gør altså rytteren markant mere træt uden at gøre ham bedre end én etape ville.
>
> Så princippet er: det er nok at han kører hver dag. Volumen på dagen køber dig ikke udvikling, kun træthed.
>
> Én ting mere, som er værd at kende: løbet træder i stedet for det du havde planlagt. Står rytterens plan på Hvile den dag han kører, får han ingen udvikling ud af løbet. Giv de ryttere du stiller op et rigtigt pas.
>
> Det står nu i Hjælp under Daglig træning.

---

## Til valverde4ever (#4162) — 8 etaper på 4 dage?

> Du har fat i noget rigtigt, men det er mærkatet der er skævt, ikke løbet.
>
> 1. division kører op til fem etaper om dagen — det er med vilje, så et etapeløb ikke låser dine ryttere i halvanden uge. Et løb på otte etaper er derfor tit færdigt på tre-fire datoer.
>
> Hver etape har stadig sin **egen løbsdag**, og det er løbsdagen der binder rytteren. De otte etaper fylder altså otte løbsdage, også når de køres over fire datoer. Da du skrev, viste kalenderen "løbsdag 0-3", fordi løbsdags-aksen var blevet fladet ud af en reparation — den er rettet nu, så La Course au Soleil læses som det den er.
>
> Den korte regel: én rytter kan køre ét løb pr. **løbsdag**, aldrig pr. dato. Derfor kan en holdkammerat frit stille op i et andet løb samme dato.
>
> Forklaringen ligger nu i Hjælp under Løbsudtagelse.

---

## Åben designbeslutning (ikke til Discord)

Rest-fælden ovenfor er reel: `abilityMult` returnerer 0 når dagens intensitet er `rest` (`dailyTraining.js:85`), og `applyRaceDevelopmentTick` bygger sit budget på præcis dét pas (`dailyTraining.js:275-283`). En rytter på en hviledag i ugerytmen, der kører løb, får altså nul udvikling ud af løbet.

Det kan læses som designet ("løbet erstatter det pas du havde planlagt — du havde planlagt ingenting"), men det rammer hårdest under den komprimerede kalender hvor der er løb næsten hver dag, og det er usynligt for spilleren. Værd at tage stilling til som sin egen sag.
