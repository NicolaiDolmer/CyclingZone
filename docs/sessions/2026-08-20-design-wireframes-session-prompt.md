# Session-prompt: Design-session med wireframes (spillerdrevet)

> Skrevet 20/8 i planlægningssessionen (ejer-bestilt). Formål: designe de vigtigste
> spillervendte løft SAMMEN med ejeren via wireframes, forankret i frisk spiller-
> feedback. Hard rules 25-28 (design-gate, visuelt bevis, beslutningskort,
> testplan) gælder - denne session ER design-gaten for emnerne.

Læs docs/NOW.md først. Markér dig som aktiv session.

## Blok 1: Discord-feedback sidste 24 timer (START HER)

1. Læs de seneste Discord-beskeder via discord-MCP'en (#dansk-snak, #feedback,
   #beta-test m.fl.) fra de sidste 24 timer + dagens sweep-fil i scripts/discord/
   hvis den findes. Ejeren paster DM'er hvis relevante.
2. VIGTIG kontekst: trin 7-tester-runden kører (staging-link postet 20/8) - der
   ligger formentlig frisk feedback på rytter-opdateringen. Den feedback hører
   primært til trin 7-merge-beslutningen (se "Parallelle spor" nedenfor), men kan
   også afsløre wireframe-emner.
3. Udled: hvilke funktioner/ændringer har spillerne SELV foreslået som egner sig
   til wireframes? Præsentér 3-6 fund med citat + dit bud på om de er
   wireframe-værdige, og lad ejeren vælge hvilke der kommer med i puljen.

## Blok 2: Emne-puljen (ejer-valgt 20/8)

Denne session tager 3-4 emner i dybden (2-3 wireframe-varianter PR. EMNE, så der
er reelle valg). Resten venter til næste design-session. Prioriteret pulje:

1. **#3350 Forklaringer i flowet** - spillet forklarer ikke sine egne
   beslutninger; 4 testere byggede private regneark samme dag. Wireframes:
   "hvad afgjorde det her" efter en etape, ved formfald, ved træningsudbytte
   (dagens måling: 67 % af hårde pas viser +0 - forklaringshullet er målt).
2. **#3924 Trænings-følelsen** - synlig fremskridts-bar + dagens kvittering
   (design-retning godkendt 18/8; #3988-fundet 20/8 gør fremskridts-baren til
   kernen). Koordinér med W7-hjælpetekst-bølgen efter trin 7.
3. **#3513 Dashboard-sportsforside** - dashboardet som levende sportsavis
   (opsluger #2442/#2583/#2445). Størst frihedsgrad, kræver flest varianter.
4. **#3900 + #3915 Race-fladerne** - sæson-overblik + dagens etaper. Designs
   LÅST i KS3 18/8 - her valideres de som wireframes med spillerne FØR byg;
   afvigelser fra de låste designs kræver eksplicit ejer-ord.
5. **#3982 Etapestriben fase 2** - resultat-piller efter kørsel, optakt før
   (ejeren har bedt om visuelle eksempler).
6. **#3967 Fog of war på potentiale** - ord/interval i stedet for præcist tal
   ("ja på sigt", ejer 20/8) - wireframe validerer retningen med spillerne.
7. **/pro-sidens indhold** - hvad Pro skal indeholde på sigt (dybde/komfort),
   så siden får en roadmap. OBS: Pro er badge-only ved launch (ejer 20/8);
   wireframes må ikke love pay-to-win.

## Blok 3: Arbejdsform pr. emne

1. Kort problem-ramme (målte tal hvis de findes) i chatten.
2. 2-3 wireframe-varianter som show_widget-mockups - mobil OG desktop hvor
   layoutet afviger. Følg PAGE_TEMPLATES.md (T1/T2/T3), anti-AI-slop-smagen,
   én gold primary pr. view, stroke-ikoner.
3. Beslutningskort pr. emne (kontekst I kortet, A/B/C + anbefaling).
4. Ejer-valg noteres i emnets GitHub-issue som "Design-go 20/8: variant X"
   (hard rule 25 - PR'er refererer denne godkendelse).

## Blok 4: Spiller-validering (ejer-beslutning 20/8)

For hvert godkendt emne: eksportér den valgte wireframe som billede + skriv et
kort Discord-opslag PÅ ENGELSK ("Is this the kind of feature you want?" +
reaktions-afstemning). EJEREN poster selv, når han melder klar - post ALDRIG
selv (hard rule). Saml opslagene i én fil til copy-paste.

## Parallelle spor denne dag (rør dem ikke uden ejer-ord, men kend dem)

- **Trin 7-merge**: venter på tester-feedback-runden; merge-kæden står i
  docs/sessions/2026-08-19-udrulning-stor-opdatering-session-prompt.md.
- **Kalender #3546**: skal LANDE inden 23/8 (wipe+regenerering m. ejer-live-go,
  bufferdag 24/8 skal med). Tjek status i NOW.md.
- **/pro-åbning**: PR #3998 merged/på vej; venter på ejerens moms-tjek i Alunta
  + support@cyclingzone.org, derefter CHECKOUT_PAUSED-flip + ét testkøb.
- **Generalprøve lørdag + cutover søndag AFTEN 19:30-22:30** (S2-finalen kører
  til 19:00): docs/2026-08-23-cutover-drejebog.md, revision 20/8.

## Regler der bed i dag

Én beslutning ad gangen, kontekst IND i kortet. Spillervendte tal skal være
MÅLT, ikke citeret fra issues. Dispatch-forfilter før enhver spawn (to
"allerede bygget"-fund i dag: #2946 og #2826). Patch note-versioner koordineres
ved merge (7.148-kollisionen ramte tre PR'er i dag). DA med æøå, spillertekster
EN først. Ingen em-tankestreger nogen steder.
