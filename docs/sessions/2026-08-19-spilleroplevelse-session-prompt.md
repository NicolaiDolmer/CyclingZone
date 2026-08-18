# Session-prompt: Spilleroplevelses-design (loebsdagen + udviklings-tilliden)

> Skrevet 18/8 som close-out af feedback/workflow-sessionen. Kopieres ind som foerste besked i en ny Claude Code-session.
> NB: Loen-design-sessionen (#3393+#2840, prompt i 2026-08-19-loen-design-session-prompt.md) er stadig booket og maa ikke fortraenges - denne session koeres SEPARAT.

---

Laes docs/NOW.md og docs/discord/2026-08-18-svarudkast-uge33.md foerst. Dagens maal: designe EN sammenhaengende spilleroplevelse omkring de to ting der beviseligt betyder mest for spillerne lige nu, og overgaa deres forventninger. Grundlaget er feedback-analysen 18/8 (Discord 7 dage + forum + in-app): stoerste smerte var udviklings-tilliden ("Is Development dead now?", 22 svar, 2 churn-signaler), og stoerste maalte engagement er resultat-oejeblikket kl. 16-18 efter loebene kl. 15 (980 sessioner kl. 18, ugens hoejeste), med traening som stoerste daglige handling (6.968 fokus-saet paa 14 dage).

## Blok 1: Loebsdags-/resultatoplevelsen (design + byg lag 1)

Spidsbelastningen 16-18 er spillets vigtigste oejeblik, og i dag er det bare "tjek selv resultatlisten". Design hele kaeden saa den foeles som en fodboldrunde:

1. "Resultatet er landet"-notifikation med deep link til etapens resultat (deep-linket blev fixet 18/8 via #3912/#3929, saa fundamentet virker). Opret issue + byg.
2. Race Centre som landingsside for tidsrummet: dagens hoejdepunkter samlet (vindere, egne placeringer, trojeskift, naeste dags etaper). #3858 er live, #3927 (dagens etaper paa dashboard) og #3936 (movement signals) er netop merget - byg videre paa dem, opfind ikke nyt.
3. Etape-resultater i Discord-divisionskanalerne (#3950, ejer-go 18/8) - kompakt format, genbrug webhook-infrastrukturen.
4. Afspiller v2 (#3859/PR #3863 draft) er naeste niveau - vurder om den skal med i denne uge eller efter cutover.

Vis mockups (show_widget) FOER du bygger UI, og foelg PAGE_TEMPLATES-kontrakten slavisk (5px radius, hairlines, en gold pr. view, stroke-ikoner).

## Blok 2: Udviklings-tillid, opfoelgning

1. Verificer trin 7-udrulningens tilstand (#3798/#3803 - planlagt onsdag): hvad mangler foer den kan gaa ud?
2. Efter udrulning: maal om forum-traaden vender. Forbered "State of Development"-opfoelgning nr. 2 med FAKTA fra prognose-fladen.
3. Scouting 2.0-design (aftalt 18/8, "efter traeningstingene"): kortere missioner (1-2 dage), scout-kvalitet paavirker akademi-prospekter, scouten kan finde nye ryttere. Targeting + navngivne fund shippede 17/8 (#3846) - byg ovenpaa, og lad trin 7's "scouting = usikkerheds-reduktion" vaere baerende ide. Design foerst, ejeren vaelger.

## Blok 3: Restpunkter fra 18/8 (korte)

- #3952 radius-konvergering: lav foer/efter-screenshots af 3-4 steder til ejer-go (IKKE koere boelgen endnu).
- #3949/#3941 Race Control: verificer at ops_notices-migrationen er applied og banneret virker i prod; vis ejeren hvordan han skriver en notice.
- Svarudkast-pakken: tjek hvilke af de 21 svar ejeren har sendt; A6-loeftet ("goal text is getting clearer") peger paa #3948 - byg den.
- #3942/#3943 (akademi-loen-preview + stille fjernelse fra loeb): reproducer og fix, spillerne venter paa svar i #bugs.
- #3944/#3945 (mobil-auktionssortering + training-sortering): smaa, kan med i en boelge.

## Regler

Een beslutning ad gangen til ejeren, med anbefaling. Vis alt visuelt foer merge (UI kraever ejer-go). Patch notes + help.json ved alt spillervendt. Ingen em-dash i spillervendt copy. Verificer tal foer de bruges i beskeder. Loop-guard: 2 CI-fails samme symptom -> stop og spoerg.
