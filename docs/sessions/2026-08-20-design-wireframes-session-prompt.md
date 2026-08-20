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
2. **SÆRLIGT fokus (ejer-krav): økonomi, løn og forecast-/finance-siderne.**
   Løn-omlægningen + upkeep-linjen gik live 20/8 formiddag - find reaktionerne,
   og de problemer der stadig meldes. Ejeren vil have GODE LØSNINGER fundet i
   DENNE session, inkl. wireframes af finance-/forecast-fladerne til spillerne.
3. VIGTIG kontekst: trin 7-tester-runden kører (staging-link postet 20/8) - der
   ligger formentlig frisk feedback på rytter-opdateringen. Den feedback hører
   primært til trin 7-merge-beslutningen (se "Parallelle spor" nedenfor), men kan
   også afsløre wireframe-emner.
4. Udled: hvilke funktioner/ændringer har spillerne SELV foreslået som egner sig
   til wireframes? Præsentér 3-6 fund med citat + dit bud på om de er
   wireframe-værdige, og lad ejeren vælge hvilke der kommer med i puljen.

## Blok 1b: friisisch-sagerne (DM-samtale læst 20/8, issues oprettet)

Fra ejerens DM-samtale med friisisch (den mest aktive tester, betalende founder,
inviteret til spillergruppen 11/8). Tre issues er oprettet 20/8:

- **#4004 auktions-transparens** (needs-decision): han bød 556k på en rytter der
  faldt til 288k under/omkring auktionen - evne-/værdiændringer under aktive
  auktioner er usynlige for bydere. OPLAGT wireframe-emne i denne session
  (ændrings-markering på budkortet + evt. notifikation). Ejer-beslutning:
  kompensationspolitik eller kun transparens fremadrettet.
- **#4005 /pro-billing før åbning** (HIGH): 49 kr skal eksplicit være inkl. moms,
  pro-rata-første-træk skal FORKLARES i checkout (hans første træk var 13 kr og
  lignede en fejl), "i nærheden af"-copyen rettes. Hænger sammen med ejerens
  moms-tjek + CHECKOUT_PAUSED-flippet.
- **#4006 verify-first** (investigation): Done-vs-Overview-mismatch (14/8+20/8)
  + gammel form-rapport (28/7) - runtime-verificér før fix. Plus trin 7-feedback:
  22-årig m. ceiling 91 projiceres kun til 65; vurder om rate-kompensationen
  (længere fra loft = hurtigere) er stærk nok i tallene.

Positivt (ingen handling, men godt at kende): season planner, %-stats på
træning og aldersfald fremhæves som det bedste; trin 7-retningen ("potentiale =
fart, ingen skjulte vægge") er PRÆCIS hvad han selv ønskede sig.

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

## Blok 5: Eksekvering (sessionen designer IKKE kun - den leverer også)

Ejer-krav 20/8: sessionen skal også få EKSEKVERET på de vigtige opgaver, ikke
kun designe. Kør disse med workers parallelt med design-arbejdet, i denne orden:

1. **Trin 7-merge-kæden** når ejeren melder tester-runden god: følg
   udrulnings-prompten (merge → migration → backfill-dry-run m. ejer-stop →
   refit → indbakke → Discord-udkast). DAGENS VIGTIGSTE eksekvering.
2. **/pro-åbningen** efter ejerens moms-tjek + support-postkasse: fix #4005's
   tre punkter (pris-copy, pro-rata-forklaring, "i nærheden af"), flip
   CHECKOUT_PAUSED (backend/lib/billingCheckout.js + ProUpgradePage.jsx), ét
   verificerende testkøb, genåbnings-patch-note (udkast ligger i #3104-workerens
   rapport i planlægningssessionen).
3. **W7 hjælpetekst-bølgen** LIGE efter trin 7-merge (#3714 #3623 #3456 #3412 +
   trænings-svarene fra 20/8 ind i help.json EN+DA).
4. **Generalprøve-forberedelse til lørdag**: verificér at alle scripts i
   drejebogens kæde kan køre mod staging (staging-guard #3961 respekteres!).
5. Småfix ved luft: #3985 (etapetype-regression) · #3997 (spejder-tidspunkt i
   UI) · #3994-mønstret er lukket.

## Blok 6: Patch notes + masterplan-disciplin (ejer-krav 20/8)

- **Patch notes-sync til sidst i sessionen**: verificér at hjemmesidens patch
  notes dækker ALT spillervendt der er shippet 19-20/8 (løn-omlægning 7.148,
  upkeep 7.149, risiko-copy 7.150, /pro-indgang 7.151, kalender/bufferdag -
  har kalenderen en note? Skriv den hvis ikke), og skriv et Discord-patch-
  notes-opslag (EN) som ejeren poster, så web + Discord er i sync.
- **Masterplanen opdateres LØBENDE** ved hver leverance i sessionen, ikke kun
  ved close-out (budget ≤1.500 tok; slet færdigt).
- **k=100 er EJER-GODKENDT 20/8** (#4000): forbered implementerings-PR ud fra
  PR #4003's harness; flippes sammen med #3449-niveaukorrektionen.

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
