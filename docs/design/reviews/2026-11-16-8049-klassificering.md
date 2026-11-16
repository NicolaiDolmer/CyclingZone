# #8049 · Område på gamle patch notes (klassificering 16/11)

> Ejerens valg 16/11 (#8049, punkt 5): område på alle noter fra november; ældre noter får området, hvor det
> kan udledes af det, der allerede findes; resten klassificeres ud fra titel og tekst; kun hvad der ikke kan
> placeres sikkert, havner i "Andet" i arkivet. **Ingen notetekst er ændret.** Området er data i
> `frontend/src/lib/patchNotesAreaData.js` (nøgle `version#index`) og `TOPIC_AREA` i
> `frontend/src/lib/patchNotesArea.js`; nye noter skriver `area` direkte i `patchNotes.js` (PATCH_NOTES_RULES §2b).

## Kilder

| Kilde | Antal | Hvordan |
|---|---:|---|
| November | 155 | Alle spillervendte noter fra 1/11, sat én for én (`Races` delt i Løb og løbsfilm, Løbsmotor og Taktik) |
| Udledt af `topic` | 1275 | Notens eget emne-felt via tabellen nedenfor |
| Udledt af roadmap / known issues | 2 | `refs` peger på et issue, der står som roadmap-punkt eller known issue med ét entydigt område |
| Model (titel + tekst) | 854 | Klassificeret ud fra titel og tekst, se tabellen nederst |
| Andet | 49 | Kan ikke placeres sikkert (interne noter, meddelelser, admin, test). Kun i arkivet |
| **I alt** | **2335** | Alle spillervendte noter |

Model-klassificeringen er lavet af den byggende agent (Opus), ikke Haiku: lanen har ingen måde at starte
en under-agent på. Kun titel og tekst er brugt, og tvivl er lagt i "Andet".

## Fordeling pr. område

| Område | Antal |
|---|---:|
| Taktik | 72 |
| Løb og løbsfilm | 402 |
| Løbsmotor | 14 |
| Træning | 137 |
| Udvikling | 146 |
| Marked | 399 |
| Akademi og ungdom | 78 |
| Bestyrelse | 132 |
| Økonomi | 155 |
| Brugerflade | 668 |
| Mobil | 32 |
| Hjælp | 51 |
| Andet | 49 |

## `topic` → område

| Område | Emner (antal noter) |
|---|---|
| Taktik | Assistant (1), Planning (20), Race selection (7), Race tactics (3), Season planner (4), Squad selection (4), Team selection (7) |
| Løb og løbsfilm | Calendar (12), Race calendar (6), Race results (4), Races (236), Racing (8), Rankings (12), Results (5), Standings (7) |
| Løbsmotor | Race engine (3) |
| Træning | Daily Training (3), Training (106) |
| Udvikling | Ratings (1), Rider development (4), Rider values (6), Riders (79) |
| Marked | Auctions (50), Contracts (3), Market (6), Rider database (3), Scouting (33), Transfer market (4), Transfers (36), Watchlist (2) |
| Akademi og ungdom | Academy (69), Youth teams (4) |
| Bestyrelse | Board (63), Boardroom (1), The board (11) |
| Økonomi | Economy (37), Finance (30), Finances (5), Sponsors (7), Staff (6) |
| Brugerflade | Accessibility (4), Account (3), Achievements (5), Auth (3), Dashboard (58), Design (9), Feedback (7), Forum (17), Getting started (4), Inbox (9), Interface (59), Notifications (24), Onboarding (8), Profile (4), Roadmap (6), Season (29), Seasons (5), Sign-up (3), Squad (14), Squads (3), Team (26), Team page (4), Teams (4), UI (16), UI and notifications (6) |
| Mobil | App (3), Mobile (6), Mobile polish (5) |
| Hjælp | Help (23) |

## Noter sat én for én (november, udledt, model, andet)

| Version | Dato | Titel | Område | Kilde |
|---|---|---|---|---|
| 7.453#0 | 2026-11-16 | Bestyrelsens midtsæson-besked kommer én gang | Bestyrelse | november |
| 7.453#1 | 2026-11-16 | Tydeligere etapeprofil på telefonen | Løb og løbsfilm | november |
| 7.453#2 | 2026-11-16 | Tydeligere købskort ved auto-pris | Marked | november |
| 7.452#0 | 2026-11-16 | Træningsrapporten viser, hvad løbene gav | Træning | november |
| 7.451#0 | 2026-11-16 | Træn nu virker med det samme for alle | Træning | november |
| 7.450#0 | 2026-11-15 | Auto-pris er åben for alle | Marked | november |
| 7.449#0 | 2026-11-15 | Salgssummen kommer, når rytteren skifter | Marked | november |
| 7.448#0 | 2026-11-15 | Indbakke-linjen åbner seneste etape | Brugerflade | november |
| 7.448#1 | 2026-11-15 | Monument-bonusmålet står ikke længere på 0 | Bestyrelse | november |
| 7.447#0 | 2026-11-14 | Gule prikker følger din konto | Brugerflade | november |
| 7.446#0 | 2026-11-14 | Ranglisterne opdateres hurtigere efter en etape | Løb og løbsfilm | november |
| 7.445#0 | 2026-11-14 | Dagens etaper vises hurtigere | Brugerflade | november |
| 7.445#1 | 2026-11-14 | Løbsfilmen nævner den rigtige gruppe | Løb og løbsfilm | november |
| 7.444#0 | 2026-11-13 | Holdplaner | Taktik | november |
| 7.443#0 | 2026-11-13 | Nye rytteres form | Træning | november |
| 7.442#0 | 2026-11-13 | Inaktive hold | Bestyrelse | november |
| 7.441#0 | 2026-11-13 | Hjælp: roller og potentiale | Hjælp | november |
| 7.441#1 | 2026-11-13 | Dagens etaper: manglende samlet stilling | Brugerflade | november |
| 7.440#0 | 2026-11-13 | Loftet er væk | Udvikling | november |
| 7.440#1 | 2026-11-13 | Intet akademihold længere | Akademi og ungdom | november |
| 7.440#2 | 2026-11-13 | Angreb på sidste stigning vises, hvor de sker | Løb og løbsfilm | november |
| 7.440#3 | 2026-11-13 | En lettere graf | Økonomi | november |
| 7.439#0 | 2026-11-12 | Dashboard og auktioner loader roligere | Brugerflade | november |
| 7.438#0 | 2026-11-12 | Holdplaner (beta) | Taktik | november |
| 7.437#0 | 2026-11-12 | Bestyrelsens mål om sponsorvækst kan nu nås | Bestyrelse | november |
| 7.436#0 | 2026-11-12 | Offline-siden prøver det rigtige login-tjek | Brugerflade | november |
| 7.436#1 | 2026-11-12 | En rigtig fejlbesked, når databasen er nede | Brugerflade | november |
| 7.436#2 | 2026-11-12 | En ny forside | Brugerflade | november |
| 7.436#3 | 2026-11-12 | Bestyrelsens mandater følger sæsonen | Bestyrelse | november |
| 7.436#4 | 2026-11-12 | Rene kontraktvarsler | Marked | november |
| 7.435#0 | 2026-11-12 | Budt beløb er nu låst for alle hold | Marked | november |
| 7.435#1 | 2026-11-12 | Assistenten sætter ikke længere et hold, der ikke kan starte | Taktik | november |
| 7.435#2 | 2026-11-12 | TWK og LDR vises på Transferlisten | Marked | november |
| 7.435#3 | 2026-11-12 | Træn nu-kvitteringen modsiger ikke sig selv (beta) | Træning | november |
| 7.435#4 | 2026-11-12 | Filteret hedder Mangler plan i dag | Træning | november |
| 7.434#0 | 2026-11-12 | Sælg helt ned til en tom trup | Marked | november |
| 7.434#1 | 2026-11-12 | Auto-pris til akademiryttere (beta) | Marked | november |
| 7.433#0 | 2026-11-11 | Auto-pris: bud på din pris starter en auktion (beta) | Marked | november |
| 7.432#0 | 2026-11-11 | Roligere indlæsning | Brugerflade | november |
| 7.430#0 | 2026-11-11 | Direkte til dit dashboard | Brugerflade | november |
| 7.429#0 | 2026-11-11 | Rytterkortet er nu for alle | Brugerflade | november |
| 7.429#1 | 2026-11-11 | Et angreb tæller ikke længere som at feltet er sat | Løb og løbsfilm | november |
| 7.428#0 | 2026-11-10 | Delt kaptajn og luksushjælper på Taktik-fanen | Taktik | november |
| 7.427#0 | 2026-11-10 | Træn nu viser ikke længere en falsk fejl | Træning | november |
| 7.426#0 | 2026-11-10 | Træn nu virker med det samme (beta) | Træning | november |
| 7.425#0 | 2026-11-09 | En mere overskuelig rytterside | Brugerflade | november |
| 7.425#1 | 2026-11-09 | Talentmærker er nu for alle | Udvikling | november |
| 7.425#2 | 2026-11-09 | Mestertrøjer er nu for alle | Brugerflade | november |
| 7.425#3 | 2026-11-09 | Hvorfor? er nu for alle | Løb og løbsfilm | november |
| 7.425#4 | 2026-11-09 | Mestertrøjer | Brugerflade | november |
| 7.425#5 | 2026-11-09 | Talentmærker | Udvikling | november |
| 7.425#6 | 2026-11-09 | Mere ryddelige rytternavne | Brugerflade | november |
| 7.424#0 | 2026-11-09 | En tydeligere træningsrapport | Træning | november |
| 7.423#0 | 2026-11-09 | Større knapper i Taktik på telefonen | Mobil | november |
| 7.423#1 | 2026-11-09 | Rytternavne åbner profilen i I dag på telefonen | Mobil | november |
| 7.422#0 | 2026-11-08 | Dine rytteres dag i ord | Løb og løbsfilm | november |
| 7.421#0 | 2026-11-08 | Løbsfilmen viser de rigtige huller ved målet | Løb og løbsfilm | november |
| 7.420#0 | 2026-11-08 | Større knapper på telefonen | Mobil | november |
| 7.419#0 | 2026-11-08 | Roadmappet viser sæsonnumre | Brugerflade | november |
| 7.417#0 | 2026-11-07 | Rytterkort og højreklik-menu | Brugerflade | november |
| 7.416#0 | 2026-11-07 | Et sent oprettet hold får stadig sin træningsdag | Træning | november |
| 7.416#1 | 2026-11-07 | En solgt rytter, der venter på at skifte, kan ikke fyres eller sælges igen | Marked | november |
| 7.416#2 | 2026-11-07 | Auktioner slutter ikke på lukketidspunktet | Marked | november |
| 7.416#3 | 2026-11-07 | Kalenderen siger Mangler, når ryttere mangler | Løb og løbsfilm | november |
| 7.416#4 | 2026-11-07 | Én Vis-vælger i kalenderen | Løb og løbsfilm | november |
| 7.416#5 | 2026-11-07 | Enkeltstart har sin egen terrænvægt | Løbsmotor | november |
| 7.416#6 | 2026-11-07 | Hjælp rettet efter et eftersyn | Hjælp | november |
| 7.415#0 | 2026-11-07 | En besked, når et punkt du stemte på, er leveret | Brugerflade | november |
| 7.414#0 | 2026-11-07 | Dit felt i etapeløbet holder til mål | Løbsmotor | november |
| 7.413#0 | 2026-11-06 | Svar Ved ikke på roadmappen | Brugerflade | november |
| 7.412#0 | 2026-11-06 | Angrebs-ordrer læses rigtigt | Taktik | november |
| 7.412#1 | 2026-11-06 | Dit stemmetal bliver stående | Brugerflade | november |
| 7.411#0 | 2026-11-06 | Jagten afgøres af de hold, der jager | Løbsmotor | november |
| 7.410#0 | 2026-11-06 | Løbsfilmen hopper ikke længere | Løb og løbsfilm | november |
| 7.410#1 | 2026-11-06 | Løbssiden åbner på den seneste etape | Løb og løbsfilm | november |
| 7.410#2 | 2026-11-06 | Større knapper i mobilens top | Mobil | november |
| 7.409#0 | 2026-11-06 | Overlad jagten til andre holder nu altid | Taktik | november |
| 7.408#0 | 2026-11-06 | Enkeltstart har ikke længere en ekstra terning | Løbsmotor | november |
| 7.407#0 | 2026-11-06 | Se hvem din rytter angreb med | Løb og løbsfilm | november |
| 7.407#1 | 2026-11-06 | Hvile-planer følger ikke med ind i en ny sæson | Træning | november |
| 7.406#0 | 2026-11-06 | Hvorfor? ved dine ryttere | Løb og løbsfilm | november |
| 7.406#1 | 2026-11-06 | Hvor dine ryttere tabte tid | Løb og løbsfilm | november |
| 7.406#2 | 2026-11-06 | Mislykkede forsøg i løbsfilmen | Løb og løbsfilm | november |
| 7.406#3 | 2026-11-06 | Assistenten vælger efter tallet på skærmen | Taktik | november |
| 7.406#4 | 2026-11-06 | Ryttere ude af et etapeløb træner igen | Træning | november |
| 7.406#5 | 2026-11-06 | Den rigtige rute alle steder | Løb og løbsfilm | november |
| 7.406#6 | 2026-11-06 | Feltet er det rigtige felt | Løb og løbsfilm | november |
| 7.406#7 | 2026-11-06 | Ingen hop på målstregen | Løb og løbsfilm | november |
| 7.406#8 | 2026-11-06 | Ingen styrt-linje uden et styrt | Løb og løbsfilm | november |
| 7.406#9 | 2026-11-06 | Tærskel hedder det rigtige | Træning | november |
| 7.406#10 | 2026-11-06 | Dag-visningen siger ikke i dag om i går | Træning | november |
| 7.406#11 | 2026-11-06 | Hjælp lover ikke for meget | Hjælp | november |
| 7.405#0 | 2026-11-05 | Stem-fanen siger, hvad tallene betyder | Brugerflade | november |
| 7.404#0 | 2026-11-05 | Løbsfilmen viser, hvor rytterne reelt blev sat | Løb og løbsfilm | november |
| 7.403#0 | 2026-11-05 | Etapeplanens opsummering viser kun det, der kan bevises | Løb og løbsfilm | november |
| 7.401#0 | 2026-11-05 | Roadmappen viser, hvornår ting kommer | Brugerflade | november |
| 7.401#1 | 2026-11-05 | Leverede punkter linker til deres patch note | Brugerflade | november |
| 7.401#2 | 2026-11-05 | Kendte fejl viser, hvor langt en rettelse er | Brugerflade | november |
| 7.401#3 | 2026-11-05 | Søg i hele roadmappen | Brugerflade | november |
| 7.401#4 | 2026-11-05 | Kopiér til etape gør ikke længere ingenting | Taktik | november |
| 7.401#5 | 2026-11-05 | Etapeplanen nævner kun nedkørsel, når vejen falder | Taktik | november |
| 7.401#6 | 2026-11-05 | En scoutbesked lover aldrig for mange ryttere | Marked | november |
| 7.401#7 | 2026-11-05 | Rytterranglisten fejler ikke længere | Brugerflade | november |
| 7.401#8 | 2026-11-05 | Færre kortvarige fejlbeskeder | Brugerflade | november |
| 7.400#0 | 2026-11-05 | Ryttere stiger ikke længere af uden en grund | Løbsmotor | november |
| 7.400#1 | 2026-11-05 | Ryttere, der steg af, viser den sande årsag | Løb og løbsfilm | november |
| 7.399#0 | 2026-11-04 | Et angreb vises ikke længere som tabt tid | Løb og løbsfilm | november |
| 7.399#1 | 2026-11-04 | Udgåede ryttere forlader løbsfilmen | Løb og løbsfilm | november |
| 7.399#2 | 2026-11-04 | Dronningeetaper holder sig tættere | Løbsmotor | november |
| 7.399#3 | 2026-11-04 | Kontraktvarsler når alle hold | Marked | november |
| 7.398#0 | 2026-11-04 | Træning på en dag med løb tæller som et helt døgn | Træning | november |
| 7.398#1 | 2026-11-04 | Udtagelsens fylde i kalenderen | Løb og løbsfilm | november |
| 7.398#2 | 2026-11-04 | Udbrudsmarkørerne forklaret rigtigt | Hjælp | november |
| 7.397#0 | 2026-11-03 | Ingen halve hold på løbsdagen | Taktik | november |
| 7.397#1 | 2026-11-03 | Auktion sætter transferlisten på pause | Marked | november |
| 7.397#2 | 2026-11-03 | Bedre startryttere til nye hold | Udvikling | november |
| 7.396#0 | 2026-11-03 | Løbsbiblioteket for alle | Løb og løbsfilm | november |
| 7.395#0 | 2026-11-03 | Klar betyder nok ryttere | Løb og løbsfilm | november |
| 7.395#1 | 2026-11-03 | Kalendertabel og løbshistorik sorterer på alle kolonner | Løb og løbsfilm | november |
| 7.395#2 | 2026-11-03 | Ét tal i prognosen, når der ikke er et spænd | Udvikling | november |
| 7.395#3 | 2026-11-03 | Kommende løb viser din divisions løb | Brugerflade | november |
| 7.395#4 | 2026-11-03 | Rigtige auktionstider på forsiden | Marked | november |
| 7.395#5 | 2026-11-03 | Ingen forkert "intet mandat" | Bestyrelse | november |
| 7.395#6 | 2026-11-03 | Stillingen før start | Løb og løbsfilm | november |
| 7.395#7 | 2026-11-03 | Endagsløb læses rigtigt | Løb og løbsfilm | november |
| 7.395#8 | 2026-11-03 | Kun dine løb i dagsplanen | Taktik | november |
| 7.395#9 | 2026-11-03 | Træningsprogrammer passer til ryttertyperne | Træning | november |
| 7.395#10 | 2026-11-03 | Læg på viser vælgeren | Træning | november |
| 7.395#11 | 2026-11-03 | Første fremgang vises på kvitteringen | Træning | november |
| 7.395#12 | 2026-11-03 | Tællere og datoer i patch notes | Brugerflade | november |
| 7.395#13 | 2026-11-03 | Ikke flere -0 CZ$ | Akademi og ungdom | november |
| 7.394#0 | 2026-11-02 | Frigivne ryttere forbliver frie | Akademi og ungdom | november |
| 7.394#1 | 2026-11-02 | Sæt dag nævner kun dine løb | Træning | november |
| 7.394#2 | 2026-11-02 | Påmindelser om udtagelse rydder sig selv | Brugerflade | november |
| 7.394#3 | 2026-11-02 | Klarere tekster til nye hold | Brugerflade | november |
| 7.394#4 | 2026-11-02 | Ingen udløbet plan før den første | Bestyrelse | november |
| 7.394#5 | 2026-11-02 | Ingen 'Stillede ikke op' før holdet fandtes | Taktik | november |
| 7.393#0 | 2026-11-02 | Dit første løb viser det rigtige løb | Brugerflade | november |
| 7.393#1 | 2026-11-02 | Scoutbeskeden tæller de rigtige ryttere | Marked | november |
| 7.393#2 | 2026-11-02 | Log ind, ikke Log ud | Brugerflade | november |
| 7.392#0 | 2026-11-02 | Løbsdage udvikler rytterne mere | Træning | november |
| 7.392#1 | 2026-11-02 | Auto-fyld dækker hele løb først | Taktik | november |
| 7.392#2 | 2026-11-02 | Ét rutematch-tal overalt | Taktik | november |
| 7.392#3 | 2026-11-02 | En ny finale: den stigende spurt | Løbsmotor | november |
| 7.392#4 | 2026-11-02 | Farlige udbrud holdes på snor | Løbsmotor | november |
| 7.392#5 | 2026-11-02 | Små rettelser | Taktik | november |
| 7.391#0 | 2026-11-01 | Assistenten sætter ikke længere selv et angreb | Taktik | november |
| 7.391#1 | 2026-11-01 | Enkeltstart viser kun ordrer der giver mening | Taktik | november |
| 7.391#2 | 2026-11-01 | Delt kaptajn og luksushjælper i sæsonplanen | Taktik | november |
| 7.391#3 | 2026-11-01 | Taktik-kladder overlever en delvis gemning | Taktik | november |
| 7.391#4 | 2026-11-01 | Løbsfilmen kalder feltet det rigtige | Løb og løbsfilm | november |
| 7.391#5 | 2026-11-01 | Your riders viser ryttere der udgik | Løb og løbsfilm | november |
| 7.391#6 | 2026-11-01 | Holdudtagelsen ændrer sig ikke i et kørende etapeløb | Taktik | november |
| 7.391#7 | 2026-11-01 | Besked når løbene er sat på pause | Brugerflade | november |
| 7.391#8 | 2026-11-01 | De nye træningstyper bliver synlige | Træning | november |
| 7.380#4 | 2026-10-25 | Den medicinske afdeling er åben | Træning | udledt |
| 7.374#10 | 2026-10-23 | CZ Pro: sæsonhistorik og gemte filtre | Brugerflade | model |
| 7.374#17 | 2026-10-23 | En kandidat på facilitetens niveau | Økonomi | model |
| 7.363#3 | 2026-10-16 | Ny Klub-side | Akademi og ungdom | udledt |
| 7.363#12 | 2026-10-16 | Online betyder de seneste 30 minutter | Brugerflade | model |
| 7.361#3 | 2026-10-15 | Kortet Dit første løb for nye hold | Brugerflade | model |
| 7.333#0 | 2026-10-02 | Ny regel: AI-værktøjer og automatisering | Andet | andet |
| 7.286#3 | 2026-09-17 | Klarere beskeder når serveren ikke kan nås | Brugerflade | model |
| 7.276#7 | 2026-09-15 | Løbsresultater i Discord går kun til din egen gruppekanal | Brugerflade | model |
| 7.276#8 | 2026-09-15 | De offentlige sider bor nu på cyclingzone.org | Brugerflade | model |
| 7.276#9 | 2026-09-15 | Mails kommer på dit eget sprog | Brugerflade | model |
| 7.270#2 | 2026-09-11 | Det offentlige site fik et lille visuelt løft | Brugerflade | model |
| 7.267#0 | 2026-09-08 | Cookie-banneret nævner nu PostHog | Brugerflade | model |
| 7.265#0 | 2026-09-08 | Et spørgeskema om hvad jeg skal bygge næste gang | Andet | andet |
| 7.264#4 | 2026-09-08 | Beskeder mellem managere | Brugerflade | model |
| 7.261#0 | 2026-09-07 | Åbne faner forbliver stabile ved opdateringer i baggrunden | Brugerflade | model |
| 7.252#0 | 2026-09-04 | Pro viser og opkræver nu i euro uden for Danmark | Brugerflade | model |
| 7.240#0 | 2026-09-03 | Ryttere og Transfers er ryddet op | Marked | model |
| 7.240#1 | 2026-09-03 | Mit hold, holdsider og managerprofiler er ryddet op | Brugerflade | model |
| 7.240#4 | 2026-09-03 | CZ Pro v1.1: Founder-mærke, sæsonhistorik, gemte filtre | Brugerflade | model |
| 7.239#2 | 2026-09-03 | Dage i trøje tæller nu kun dine egne trøjedage | Løb og løbsfilm | model |
| 7.239#3 | 2026-09-03 | Kontraktforlængelse forklarer det nye lønkrav | Marked | model |
| 7.237#0 | 2026-09-02 | Pro lander med det samme du har betalt | Brugerflade | model |
| 7.236#0 | 2026-09-02 | Pro falder ikke længere væk ved fornyelse | Brugerflade | model |
| 7.235#5 | 2026-09-02 | Fair play-tjek dækker nu også direkte handler | Marked | model |
| 7.235#6 | 2026-09-02 | Cookie-banneret nævner nu Vercel Web Analytics | Brugerflade | model |
| 7.230#0 | 2026-09-02 | Pro er åbent for køb | Brugerflade | model |
| 7.227#0 | 2026-09-01 | 'Cycling Zone er opdateret'-skærmen sætter sig ikke længere fast | Brugerflade | model |
| 7.226#0 | 2026-09-01 | Landingssiden loader hurtigere på mobil-Safari | Brugerflade | model |
| 7.223#6 | 2026-08-31 | En død Discord-forbindelse siger nu til | Brugerflade | model |
| 7.215#0 | 2026-08-28 | Privatlivspolitikken er opdateret | Brugerflade | model |
| 7.187#0 | 2026-08-24 | Nye hold lander ikke længere i en pulje der allerede er fuld | Brugerflade | model |
| 7.159#0 | 2026-08-20 | Live-opdateringer virker igen på auktioner, notifikationer og aktivitetsfeedet | Brugerflade | model |
| 7.151#0 | 2026-08-20 | Pro har nu en indgang | Brugerflade | model |
| 7.144#0 | 2026-08-18 | Driftsbanner | Brugerflade | model |
| 7.137#6 | 2026-08-17 | Knapper forklarer sig selv | Brugerflade | model |
| 7.135#4 | 2026-08-17 | En prik viser ulæste patch notes | Brugerflade | model |
| 7.123#3 | 2026-08-14 | Knapper kunne blive stående og snurre når forbindelsen røg | Brugerflade | model |
| 7.109#1 | 2026-08-10 | Discord-beskeder forsvinder ikke længere når Discord har et hik | Brugerflade | model |
| 7.106#0 | 2026-08-07 | Potentiale-stjerner farvekoder ikke længere efter alder | Udvikling | model |
| 7.105#0 | 2026-08-07 | Sæson 3-kalenderen genbygget: ægte sæsonrytme, hviledage i Grand Tours og en mere fair løb | Løb og løbsfilm | model |
| 7.95#11 | 2026-08-05 | Sproget hopper ikke længere tilbage når du skifter det | Brugerflade | model |
| 7.90#3 | 2026-08-04 | Hjælp, regler, patch notes og roadmap kræver ikke længere login | Brugerflade | model |
| 7.89#2 | 2026-08-04 | Fyret personale sniger sig ikke længere tilbage på kandidatlisten | Økonomi | model |
| 7.86#0 | 2026-08-03 | Privatlivspolitikken beskriver nu vores fair play-logning | Brugerflade | model |
| 7.83#0 | 2026-08-03 | Indstillingerne siger ikke længere "Discord tilsluttet" når botten reelt ikke kan nå dig | Brugerflade | model |
| 7.76#0 | 2026-07-30 | Handelsbetingelser, købs-samtykke og selvbetjent opsigelse for CZ Pro | Brugerflade | model |
| 7.64#0 | 2026-07-26 | Sæsonplanlæggeren viser ikke længere din gamle divisions kalender | Taktik | model |
| 7.63#6 | 2026-07-25 | Et facilitetskøb eller en planfornyelse der fejler siger nu til | Økonomi | model |
| 7.39#0 | 2026-07-21 | Sæsonplanlæggeren er nu live for alle | Taktik | model |
| 7.33#0 | 2026-07-20 | De første 50 abonnenter bliver permanente Founders | Brugerflade | model |
| 7.30#4 | 2026-07-19 | Etapeløbs-resultater linker nu til den rigtige etapeside | Løb og løbsfilm | model |
| 7.24#0 | 2026-07-18 | Skadede ryttere kan nu altid fjernes fra en trup, og omfordeling er nemmere | Taktik | model |
| 7.22#0 | 2026-07-17 | Ryddede trupper forbliver ryddet, og "Genopbyg alt" overskriver ikke længere dig | Taktik | model |
| 7.19#0 | 2026-07-18 | Se andre holds staff og faciliteter | Økonomi | model |
| 7.11#0 | 2026-07-17 | Global Rank: én rangliste for alle managere | Løb og løbsfilm | model |
| 7.11#1 | 2026-07-17 | Sæson 2 bliver synlig til planlægning | Taktik | model |
| 7.10#0 | 2026-07-17 | Bestyrelses-beskeder når nu frem på Discord | Bestyrelse | model |
| 7.06#0 | 2026-07-16 | Scouting-netværket er nu åbent | Marked | model |
| 7.05#0 | 2026-07-16 | Discord-feeds taler nu engelsk | Brugerflade | model |
| 7.04#0 | 2026-07-16 | Manager-online-status følger nu dit sprog | Brugerflade | model |
| 7.02#10 | 2026-07-16 | Handlinger fortæller dig, når noget går galt | Brugerflade | model |
| 6.94#0 | 2026-07-11 | Hall of Fame gør plads til den kommende verdenshistorik | Brugerflade | model |
| 6.93#0 | 2026-07-11 | Byg din klub: faciliteter og staff | Økonomi | model |
| 6.70#0 | 2026-07-10 | Færre fejlskærme forårsaget af browser-auto-oversættelse | Brugerflade | model |
| 6.60#0 | 2026-07-04 | Din indbakke og økonomi-side bliver nu på dit sprog | Brugerflade | model |
| 6.59#0 | 2026-07-04 | Gem af holdudtagelser til flere løb fejler ikke længere i stilhed | Taktik | model |
| 6.52#0 | 2026-07-03 | Vælg hvilke Discord-DM'er du får | Brugerflade | model |
| 6.50#0 | 2026-07-03 | At forlade en side midt i en indlæsning udløser ikke længere et uønsket reload | Brugerflade | model |
| 6.50#11 | 2026-07-03 | Flere fejlbeskeder vises nu på dit sprog | Brugerflade | model |
| 6.50#12 | 2026-07-03 | Landingssiden loader lidt hurtigere | Brugerflade | model |
| 6.49#0 | 2026-07-03 | Manager-profiler viser sæsonhistorik igen | Brugerflade | model |
| 6.40#8 | 2026-06-30 | Rettet et crash når browseren auto-oversætter spillet | Brugerflade | model |
| 6.40#9 | 2026-06-30 | Delte links til ryttere og løb rammer ikke længere en blank login-væg | Brugerflade | model |
| 6.40#10 | 2026-06-30 | Division 4 er nu åben | Brugerflade | model |
| 6.18#2 | 2026-06-26 | Trup-tælleren viser nu senior-ryttere mod cap'en, med akademi opført separat | Brugerflade | model |
| 6.11#9 | 2026-06-25 | Tilbagevendende besøgende genkendes nu på tværs af sessioner | Brugerflade | model |
| 6.03#0 | 2026-06-23 | Sider crasher ikke længere hvis dit login udløber under indlæsning | Brugerflade | model |
| 6.01#0 | 2026-06-23 | Op- og nedrykning er nu live | Løb og løbsfilm | model |
| 5.85#0 | 2026-06-21 | Hold, Head-to-Head og Sæson-preview er nu én Liga & rangliste-hub | Løb og løbsfilm | model |
| 5.82#0 | 2026-06-21 | Ny Regler-side: tallene ét sted | Hjælp | model |
| 5.78#0 | 2026-06-21 | Hjælp forklarer nu hvordan løb vindes, og hvad hver evne gør | Hjælp | model |
| 5.76#0 | 2026-06-20 | Patch notes-siden er gentænkt | Brugerflade | model |
| 5.72#0 | 2026-06-20 | Saldoen i headeren opdateres live | Økonomi | model |
| 5.67#6 | 2026-06-20 | Færre falsk-klikbare elementer | Brugerflade | model |
| 5.66#1 | 2026-06-19 | Transfermarkedet vises nu i rækker | Marked | model |
| 5.66#2 | 2026-06-19 | Skadet-badge på alle hold | Brugerflade | model |
| 5.66#4 | 2026-06-19 | Renere navneredigering på din profil | Brugerflade | model |
| 5.65#0 | 2026-06-19 | Nyt evne-system overalt | Udvikling | model |
| 5.65#1 | 2026-06-19 | Akademi-oprykninger i transferhistorikken | Akademi og ungdom | model |
| 5.63#1 | 2026-06-19 | Slut med daglig login-streak | Brugerflade | model |
| 5.62#0 | 2026-06-19 | Søgning matcher nu fulde navne | Marked | model |
| 5.62#2 | 2026-06-19 | Mere flydende rytteroversigt | Marked | model |
| 5.62#4 | 2026-06-19 | Klik ind i løb fra holdresultater | Løb og løbsfilm | model |
| 5.61#0 | 2026-06-19 | Daglig træning virker igen | Træning | model |
| 5.61#5 | 2026-06-19 | Træn flere ryttere ad gangen | Træning | model |
| 5.61#6 | 2026-06-19 | Renere nulstilling ved sæson-relancering | Brugerflade | model |
| 5.60#0 | 2026-06-18 | Sæson 1 relanceret på nyt fundament | Brugerflade | model |
| 5.54#1 | 2026-06-17 | Gæld loftes nu efter division | Økonomi | model |
| 5.44#0 | 2026-06-16 | Offentlige sider lettere at finde | Brugerflade | model |
| 5.42#0 | 2026-06-16 | Færre crashes efter opdateringer | Brugerflade | model |
| 5.40#0 | 2026-06-15 | Ny landing page for besøgende | Brugerflade | model |
| 5.38#0 | 2026-06-15 | Find vores Discord i sidebjælken | Brugerflade | model |
| 5.34#0 | 2026-06-14 | Tydelige fejl ved login-netværksfejl | Brugerflade | model |
| 5.34#1 | 2026-06-14 | Prøv-igen-knap når Finans og Auktioner fejler | Brugerflade | model |
| 5.34#2 | 2026-06-14 | Ønskeliste-stjerne advarer ved gem-fejl | Brugerflade | model |
| 5.34#3 | 2026-06-14 | Historik viser fejl i stedet for tomhed | Brugerflade | model |
| 5.31#0 | 2026-06-13 | Ryttere har nu rigtige kontrakter | Marked | model |
| 5.29#0 | 2026-06-12 | Finans og Deadline Day på dit sprog | Brugerflade | model |
| 5.28#0 | 2026-06-12 | Sider genindlæses pænt efter opdatering | Brugerflade | model |
| 5.27#0 | 2026-06-12 | Form og træthed påvirker løbsscoren | Løbsmotor | model |
| 5.27#1 | 2026-06-12 | Hårde løb dræner din trup | Løbsmotor | model |
| 5.27#2 | 2026-06-12 | Skadede ryttere sidder løb over | Løbsmotor | model |
| 5.26#0 | 2026-06-12 | Ny Daglig træning-side til alle | Træning | model |
| 5.26#1 | 2026-06-12 | Træn i dag for +25% boost | Træning | model |
| 5.26#2 | 2026-06-12 | Form og træthed på hver profil | Træning | model |
| 5.26#3 | 2026-06-12 | Daglig rapport viser træningsfremskridt | Træning | model |
| 5.25#0 | 2026-06-12 | Ny Resultater-fane og sorterbar nation | Brugerflade | model |
| 5.25#1 | 2026-06-12 | Se ventende handler i databasen | Marked | model |
| 5.25#2 | 2026-06-12 | Start Flash-auktioner fra Mit Hold | Marked | model |
| 5.25#3 | 2026-06-12 | Transferliste-genvej og klarere auktioner | Marked | model |
| 5.25#4 | 2026-06-12 | Klarere konkurs-, præmie- og lånetal | Økonomi | model |
| 5.25#5 | 2026-06-12 | Første resultat-achievement tildeles nu korrekt | Brugerflade | model |
| 5.25#6 | 2026-06-12 | Flere sider følger nu dit sprogvalg | Brugerflade | model |
| 5.25#7 | 2026-06-12 | Sorterbar løn og hurtige løbslinks | Økonomi | model |
| 5.24#0 | 2026-06-11 | Analytics tilføjet, styret af dit cookie-samtykke | Brugerflade | model |
| 5.23#0 | 2026-06-11 | Vi er flyttet til cyclingzone.org | Brugerflade | model |
| 5.20#0 | 2026-06-10 | Snydesikker scouting og tydeligt potentiale | Marked | model |
| 5.20#1 | 2026-06-10 | Filtrér og sortér rytterranglisten | Marked | model |
| 5.20#11 | 2026-06-10 | Hurtigere navigation og mere plads på mobil | Mobil | model |
| 5.20#12 | 2026-06-10 | Waitlist-formular fuldt oversat | Brugerflade | model |
| 5.20#13 | 2026-06-10 | Founder-priser vises i euro | Brugerflade | model |
| 5.19#0 | 2026-06-10 | Lige bud overhaler ikke længere føreren | Marked | model |
| 5.17#0 | 2026-06-10 | Stjernegrænse hævet til 8 mio. CZ$ | Udvikling | model |
| 5.15#0 | 2026-06-10 | Hjælp forklarer nu træningsfokus | Hjælp | model |
| 5.14#0 | 2026-06-10 | Cookie-banner følger dit sprog | Brugerflade | model |
| 5.12#0 | 2026-06-10 | Profil-bud tjekker din reelle saldo | Marked | model |
| 5.11#0 | 2026-06-10 | Stjerne-achievements kan nu låses op | Brugerflade | model |
| 5.10#0 | 2026-06-10 | Løbsscoring hedder nu bare point | Løb og løbsfilm | model |
| 5.09#0 | 2026-06-10 | Hjælpetekster bruger ny værdiformel | Hjælp | model |
| 5.07#0 | 2026-06-09 | Login-tagline matcher nu wordmarket | Brugerflade | model |
| 5.06#0 | 2026-06-09 | Nyt Cycling Zone-logo er live | Brugerflade | model |
| 5.05#0 | 2026-06-09 | Renere evnetal i rytterdatabasen | Marked | model |
| 5.04#0 | 2026-06-09 | Sæson 2 starter, vælg dit Klub-DNA | Bestyrelse | model |
| 5.03#0 | 2026-06-08 | Sæt et træningsfokus for ryttere | Træning | model |
| 4.99#0 | 2026-06-07 | Skarpere og mere realistiske ryttertyper | Udvikling | model |
| 4.98#0 | 2026-06-07 | Resultater og sæson nu på engelsk | Brugerflade | model |
| 4.97#0 | 2026-06-07 | Løbssider nu på engelsk | Brugerflade | model |
| 4.96#0 | 2026-06-07 | Forhandl ned-knap virker tydeligt nu | Bestyrelse | model |
| 4.95#0 | 2026-06-07 | 16 skarpere rytterevner (beta) | Udvikling | model |
| 4.94#0 | 2026-06-06 | Ryttertyper viser hver rytters styrker | Udvikling | model |
| 4.93#0 | 2026-06-06 | Forhåndsvis rytterens nye værdi | Udvikling | model |
| 4.89#2 | 2026-06-05 | Offline-prik er nu synlig på profiler | Brugerflade | model |
| 4.83#0 | 2026-06-05 | Intet trup-minimum mere, sælg frit | Marked | model |
| 4.76#0 | 2026-06-04 | Guld-prikker viser hvor du er | Brugerflade | model |
| 4.75#0 | 2026-06-04 | Nye brand-skrifttyper og forfinet farvepalet | Brugerflade | model |
| 4.74#0 | 2026-06-04 | Delte links viser det rigtige logo | Brugerflade | model |
| 4.72#0 | 2026-06-04 | Tydeligere auktions- og filter-beskeder | Marked | model |
| 4.71#0 | 2026-06-04 | Store tabeller bruger nu hele bredden | Brugerflade | model |
| 4.70#0 | 2026-06-04 | Nyt monogram i browser-fanen | Brugerflade | model |
| 4.69#0 | 2026-06-04 | Effekttal på rytterprofiler (beta) | Udvikling | model |
| 4.67#0 | 2026-06-04 | Privatlivspolitik angiver den dataansvarlige | Brugerflade | model |
| 4.60#0 | 2026-06-03 | Ranglisten viser nu præmiepenge | Økonomi | model |
| 4.60#1 | 2026-06-03 | Rytterværdier opdateres med nye point | Udvikling | model |
| 4.58#2 | 2026-06-03 | Daglig sats for hver trøje vises | Økonomi | model |
| 4.57#0 | 2026-06-03 | Holdkort-tal læselige i lyst tema | Brugerflade | model |
| 4.51#0 | 2026-06-02 | Sprog-menuen bliver ikke skåret af | Brugerflade | model |
| 4.50#0 | 2026-06-02 | Testkonti optager ikke divisions-pladser | Brugerflade | model |
| 4.49#0 | 2026-06-02 | Nye hold starter i toppen | Brugerflade | model |
| 4.48#0 | 2026-06-02 | Nulstil-knap altid synlig med antal | Brugerflade | model |
| 4.47#0 | 2026-06-02 | Købsoption tæller ikke truppen dobbelt | Marked | model |
| 4.46#0 | 2026-06-02 | Kommende løb kun fra nuværende sæson | Brugerflade | model |
| 4.46#1 | 2026-06-02 | Bestyrelsesplaner låses sent på sæsonen | Bestyrelse | model |
| 4.44#0 | 2026-06-01 | Rytterværdier opdateres ved præmieudbetaling | Udvikling | model |
| 4.42#0 | 2026-06-01 | Aftal lejehandler mens vinduet er lukket | Marked | model |
| 4.41#0 | 2026-06-01 | Forhandl tilbud mens vinduet er lukket | Marked | model |
| 4.41#2 | 2026-06-01 | Vælg Klub-DNA før din bestyrelse | Bestyrelse | model |
| 4.41#3 | 2026-06-01 | Klub-DNA-valg kan ikke låse dig ude | Bestyrelse | model |
| 4.37#0 | 2026-05-31 | Sæsonhistorik tæller sejre korrekt | Løb og løbsfilm | model |
| 4.37#1 | 2026-05-31 | Etapeløb viser alle etaper | Løb og løbsfilm | model |
| 4.36#0 | 2026-05-31 | Tydeligere rækkefølge på første bestyrelsesmøde | Bestyrelse | model |
| 4.35#0 | 2026-05-31 | Knapper genopretter når forbindelsen ryger | Brugerflade | model |
| 4.34#0 | 2026-05-31 | Opret hold-knappen hænger ikke længere | Brugerflade | model |
| 4.33#0 | 2026-05-31 | Head-to-Head viser optjente løb-point | Løb og løbsfilm | model |
| 4.32#0 | 2026-05-31 | Læsbare status-labels i egen kolonne | Brugerflade | model |
| 4.31#0 | 2026-05-31 | Én farveskala for evner overalt | Udvikling | model |
| 4.30#0 | 2026-05-31 | Handl mens vinduet er lukket | Marked | model |
| 4.29#0 | 2026-05-31 | Trupgrænse på 30 i alle divisioner | Marked | model |
| 4.28#0 | 2026-05-31 | Garanteret 50%-salg fjernet | Marked | model |
| 4.27#0 | 2026-05-31 | Rangliste-farver tilpasser sig dit tema | Løb og løbsfilm | model |
| 4.26#0 | 2026-05-31 | Kalender sorteret efter dato | Løb og løbsfilm | model |
| 4.25#0 | 2026-05-31 | Nyt filter for fri agenter | Marked | model |
| 4.24#0 | 2026-05-31 | Status-mærker er nu kompakte ikoner | Brugerflade | model |
| 4.23#0 | 2026-05-31 | Rytternavn bliver fastlåst ved scroll | Brugerflade | model |
| 4.22#0 | 2026-05-30 | Prøv bestyrelsen med frossen økonomi | Bestyrelse | model |
| 4.21#0 | 2026-05-30 | Holdnavne klikbare flere steder | Brugerflade | model |
| 4.20#0 | 2026-05-30 | Sæson-fremgang tæller kørte løbsdage | Løb og løbsfilm | model |
| 4.19#0 | 2026-05-30 | Nation får sin egen kolonne | Brugerflade | model |
| 4.18#0 | 2026-05-30 | Rytterhistorik grupperet pr. spil-sæson | Løb og løbsfilm | model |
| 4.17#0 | 2026-05-30 | Rytterens løbsresultater er tilbage | Løb og løbsfilm | model |
| 4.16#0 | 2026-05-30 | Rangliste og dashboard opdaterer live | Løb og løbsfilm | model |
| 4.14#0 | 2026-05-30 | Hall of Fame helt på engelsk | Brugerflade | model |
| 4.13#0 | 2026-05-29 | Flere sider nu helt på engelsk | Brugerflade | model |
| 4.09#0 | 2026-05-27 | Crash-skærm forklarer nu hvad der skete | Brugerflade | model |
| 4.08#0 | 2026-05-27 | Achievements låser op igen for alle hold | Brugerflade | model |
| 4.07#0 | 2026-05-27 | Klub-DNA-tekst følger nu dit sprog | Bestyrelse | model |
| 4.06#0 | 2026-05-27 | Landenavne følger nu dit sprog | Brugerflade | model |
| 4.05#0 | 2026-05-27 | Rytter-værdier gendannet efter sync-fejl | Udvikling | model |
| 4.04#0 | 2026-05-26 | Rytterværdi vises pænt på mobil | Mobil | model |
| 4.03#0 | 2026-05-26 | Mobilmenu skifter nu sprog korrekt | Mobil | model |
| 4.02#0 | 2026-05-26 | Finans- og indbakkebeskeder nu oversat | Brugerflade | model |
| 4.01#0 | 2026-05-26 | Tal og datoer følger dit sprog | Brugerflade | model |
| 4.00#0 | 2026-05-25 | Finanser-siden taler nu engelsk og dansk | Brugerflade | model |
| 3.98#0 | 2026-05-25 | Rytterværdier følger nu dit sprog | Brugerflade | model |
| 3.97#0 | 2026-05-25 | Aktiv auktion-mærket vises korrekt igen | Marked | model |
| 3.96#0 | 2026-05-25 | Hold-siden taler nu engelsk og dansk | Brugerflade | model |
| 3.95#0 | 2026-05-25 | Rytterprofil, indbakke og database oversat | Brugerflade | model |
| 3.92#0 | 2026-05-22 | Races-siden loader meget hurtigere | Løb og løbsfilm | model |
| 3.89#0 | 2026-05-22 | Discord-besked ved overbud virker igen | Brugerflade | model |
| 3.88#0 | 2026-05-22 | Fantom-CZ$ og lånegæld fjernet | Økonomi | model |
| 3.85#0 | 2026-05-21 | Deadline Day skjuler frosne hold | Marked | model |
| 3.84#0 | 2026-05-21 | Final Whistle tæller pulje-køb med | Marked | model |
| 3.83#0 | 2026-05-21 | Frosne hold slipper for tvangskøb og bøder | Marked | model |
| 3.81#0 | 2026-05-21 | Ingen op- eller nedrykning i sæson 1-2 | Løb og løbsfilm | model |
| 3.78#0 | 2026-05-21 | Løn trækkes nu ved sæson-start | Økonomi | model |
| 3.78#1 | 2026-05-21 | Se finansprognose op til 5 sæsoner frem | Økonomi | model |
| 3.77#0 | 2026-05-21 | Mere sikkert skift fra sæson 0 til 1 | Brugerflade | model |
| 3.69#0 | 2026-05-20 | 45 ryttere stod fast på UCI-minimum (5 point) fordi d… | Udvikling | model |
| 3.69#1 | 2026-05-20 | Største rettelser (uci_points før → efter) | Udvikling | model |
| 3.69#2 | 2026-05-20 | Manager-økonomi-effekt | Udvikling | model |
| 3.69#3 | 2026-05-20 | Forward-fix | Udvikling | model |
| 3.67#0 | 2026-05-20 | Hvert kommende løb i kalenderen viser nu en live-bere… | Løb og løbsfilm | model |
| 3.67#1 | 2026-05-20 | Sæson-snapshot-siden tilføjer samme label per løb og… | Løb og løbsfilm | model |
| 3.67#2 | 2026-05-20 | Ren display-feature | Løb og løbsfilm | model |
| 3.66#1 | 2026-05-20 | Bug-fix | Løb og løbsfilm | model |
| 3.66#2 | 2026-05-20 | Nye sheet-input-kolonner | Løb og løbsfilm | model |
| 3.66#3 | 2026-05-20 | Sæson 1 forventet total præmiepulje | Løb og løbsfilm | model |
| 3.65#0 | 2026-05-20 | Admin kan nu mærke hvert løb med hvilken udgave/årgan… | Løb og løbsfilm | model |
| 3.65#1 | 2026-05-20 | Felterne 'Startdato' og 'Præmiepulje' er fjernet fra… | Løb og løbsfilm | model |
| 3.65#2 | 2026-05-20 | Sæson 0 (open beta) er nu permanent låst til 0 løb vi… | Løb og løbsfilm | model |
| 3.64#0 | 2026-05-19 | Landing page /founder-supporter | Brugerflade | model |
| 3.64#1 | 2026-05-19 | Indsendte waitlist-værdier er uændrede i databasen | Brugerflade | model |
| 3.61#0 | 2026-05-19 | Transfervinduet lukker nu automatisk når lukketiden r… | Marked | model |
| 3.61#1 | 2026-05-19 | Sæson 0 → 1 er en speciel overgang | Brugerflade | model |
| 3.61#2 | 2026-05-19 | Nyt 'Klar til deadline?'-panel på admin-siden viser live | Andet | andet |
| 3.61#3 | 2026-05-19 | Løbskalender-generator udvidet med race-type-filter (… | Løb og løbsfilm | model |
| 3.61#4 | 2026-05-19 | Fire nye hjælpe-artikler | Hjælp | model |
| 3.59#0 | 2026-05-19 | CyclingZone har været gratis siden starten | Andet | andet |
| 3.59#1 | 2026-05-19 | Løftet | Andet | andet |
| 3.59#2 | 2026-05-19 | Hvis premium kommer senere | Andet | andet |
| 3.59#3 | 2026-05-19 | I de næste uger beder jeg om feedback via Discord | Andet | andet |
| 3.59#4 | 2026-05-19 | Join samtalen i Discord | Andet | andet |
| 3.55#0 | 2026-05-18 | Fix · robots.txt manglede (returnerede SPA-fallback i… | Brugerflade | model |
| 3.55#1 | 2026-05-18 | Fix · Canonical link var statisk `https | Brugerflade | model |
| 3.55#2 | 2026-05-18 | Fix · Hero-badges (Open beta / Fair freemium / GDPR-c… | Brugerflade | model |
| 3.55#3 | 2026-05-18 | Fix · Privatlivspolitik-link i samtykke-checkbox + an… | Brugerflade | model |
| 3.55#4 | 2026-05-18 | Verifikation · Desktop Lighthouse | Andet | andet |
| 3.54#0 | 2026-05-17 | Dashboard rå i18n-keys (#470) | Brugerflade | model |
| 3.54#1 | 2026-05-17 | Dashboard rå i18n-keys (#470) | Brugerflade | model |
| 3.54#3 | 2026-05-17 | Dashboard rå i18n-keys (#470) | Brugerflade | model |
| 3.50#0 | 2026-05-16 | Signup · Bootstrap fejler ikke længere stille på lang… | Brugerflade | model |
| 3.50#1 | 2026-05-16 | Mobil auktioner · Live bud-feed for dine egne auktion… | Marked | model |
| 3.50#2 | 2026-05-16 | Rytter-data · 'João Luis Almeida' (pcm_id 18428 | Udvikling | model |
| 3.50#3 | 2026-05-16 | Auth · 'Privatlivspolitik / Privacy policy'-footer på… | Brugerflade | model |
| 3.50#4 | 2026-05-16 | Backend · `getTeamMarketState` returnerer nu et `futu… | Andet | andet |
| 3.45#0 | 2026-05-16 | Founder Supporter landing page (#361) | Brugerflade | model |
| 3.45#1 | 2026-05-16 | Founder Supporter landing page (#361) | Brugerflade | model |
| 3.45#2 | 2026-05-16 | Founder Supporter landing page (#361) | Brugerflade | model |
| 3.45#3 | 2026-05-16 | Founder Supporter landing page (#361) | Brugerflade | model |
| 3.45#4 | 2026-05-16 | Founder Supporter landing page (#361) | Brugerflade | model |
| 3.45#5 | 2026-05-16 | Founder Supporter landing page (#361) | Brugerflade | model |
| 3.45#6 | 2026-05-16 | Founder Supporter landing page (#361) | Brugerflade | model |
| 3.44#0 | 2026-05-16 | Founder Supporter waitlist-form (#362) | Brugerflade | model |
| 3.44#1 | 2026-05-16 | Founder Supporter waitlist-form (#362) | Brugerflade | model |
| 3.44#2 | 2026-05-16 | Founder Supporter waitlist-form (#362) | Brugerflade | model |
| 3.44#5 | 2026-05-16 | Founder Supporter waitlist-form (#362) | Brugerflade | model |
| 3.42#0 | 2026-05-16 | Privatliv · Vercel Web Analytics aktiveres nu kun hvi… | Brugerflade | model |
| 3.42#1 | 2026-05-16 | Bugfix · Tidligere kørte analytics-scriptet ubetinget… | Brugerflade | model |
| 3.41#0 | 2026-05-15 | GDPR + Founder Supporter-waitlist (#360) | Brugerflade | model |
| 3.41#1 | 2026-05-15 | GDPR + Founder Supporter-waitlist (#360) | Brugerflade | model |
| 3.41#2 | 2026-05-15 | GDPR + Founder Supporter-waitlist (#360) | Brugerflade | model |
| 3.41#3 | 2026-05-15 | GDPR + Founder Supporter-waitlist (#360) | Brugerflade | model |
| 3.40#0 | 2026-05-15 | Transferhistorik på holdbasis (#25) | Marked | model |
| 3.40#1 | 2026-05-15 | Transferhistorik på holdbasis (#25) | Marked | model |
| 3.40#2 | 2026-05-15 | Transferhistorik på holdbasis (#25) | Marked | model |
| 3.39#0 | 2026-05-15 | Bugfix · Sæsonhistorik på Bestyrelse-siden kunne i sj… | Bestyrelse | model |
| 3.38#0 | 2026-05-15 | Feature · Flere `Du er blevet overbudt!`-notifikation… | Brugerflade | model |
| 3.38#1 | 2026-05-15 | Feature · Klik på aggregat-boblen folder historikken… | Brugerflade | model |
| 3.38#2 | 2026-05-15 | Feature · Når auktionen afsluttes (`auction_won`/`auc… | Brugerflade | model |
| 3.37#0 | 2026-05-15 | Manager-navn synligt på holdsiden (#255) | Brugerflade | model |
| 3.36#0 | 2026-05-15 | UX · Filtrene på /ryttere nulstilles ikke længere når… | Marked | model |
| 3.35#0 | 2026-05-15 | Hall of Fame (#223) | Brugerflade | model |
| 3.34#0 | 2026-05-15 | UX · Indstillinger ligger nu nederst i sidebaren samm… | Brugerflade | model |
| 3.29#0 | 2026-05-13 | UCI-sync opdaterer hele rytterdatabasen | Udvikling | model |
| 3.27#0 | 2026-05-13 | Infra · Login | Andet | andet |
| 3.24#0 | 2026-05-12 | Manager · Værktøjet til at sammenligne op til 3 rytte… | Marked | model |
| 3.23#0 | 2026-05-12 | Klikbare holdnavne overalt (#316) | Brugerflade | model |
| 3.21#0 | 2026-05-11 | Password-reset og uventede logouts (#35) | Brugerflade | model |
| 3.21#1 | 2026-05-11 | Password-reset og uventede logouts (#35) | Brugerflade | model |
| 3.21#2 | 2026-05-11 | Password-reset og uventede logouts (#35) | Brugerflade | model |
| 3.18#0 | 2026-05-11 | Alle besøgende · Første gang du åbner spillet | Brugerflade | model |
| 3.18#1 | 2026-05-11 | Manager · Microsoft Clarity-analytics indlæses kun hv… | Brugerflade | model |
| 3.18#2 | 2026-05-11 | Manager · Ny side `/privatlivspolitik` med fuld discl… | Brugerflade | model |
| 3.18#3 | 2026-05-11 | Backend · `users.consent_preferences` JSONB-kolonne g… | Andet | andet |
| 3.18#4 | 2026-05-11 | Hver eksisterende manager ser banneret én gang ved næ… | Brugerflade | model |
| 3.15#0 | 2026-05-11 | Nye hold får korrekt startøkonomi | Økonomi | model |
| 3.15#1 | 2026-05-11 | Nye hold får korrekt startøkonomi | Økonomi | model |
| 3.15#2 | 2026-05-11 | Nye hold får korrekt startøkonomi | Økonomi | model |
| 3.12#0 | 2026-05-11 | Manager · Sponsor er nu sportsligt fra sæson 2 | Økonomi | model |
| 3.12#1 | 2026-05-11 | Manager · Finanser-prognosen viser nu sponsor-breakdown | Økonomi | model |
| 3.12#2 | 2026-05-11 | Backend · Ny delt `sponsorEngine` bruges af sæsonstart | Økonomi | model |
| 3.09#0 | 2026-05-10 | Manager · Du kan nu kun have ÉN aktiv 'til salg'-list… | Marked | model |
| 3.09#1 | 2026-05-10 | Manager · Hvis du prøver at oprette en ny listing på… | Marked | model |
| 3.08#0 | 2026-05-10 | Manager · 'Købt' og 'Solgt'-fanerne under Auktioner →… | Marked | model |
| 3.08#1 | 2026-05-10 | Manager · Stats-tællerne (Købt/Solgt/Brugt/Tjent) er… | Marked | model |
| 3.08#2 | 2026-05-10 | Manager · Når du selv vinder en auktion på din egen r… | Marked | model |
| 3.08#3 | 2026-05-10 | Backend · `AuctionHistoryPage.jsx` filtrerer nu på se… | Marked | model |
| 3.07#0 | 2026-05-10 | Manager · '🗑️ Fjern fra transferlisten'-knappen virk… | Marked | model |
| 3.07#1 | 2026-05-10 | Backend · Endpointet skrev `status='closed'` til `tra… | Marked | model |
| 3.06#0 | 2026-05-10 | Banken hedder nu AI (#14) | Marked | model |
| 3.06#1 | 2026-05-10 | Banken hedder nu AI (#14) | Marked | model |
| 3.06#2 | 2026-05-10 | Banken hedder nu AI (#14) | Marked | model |
| 3.06#3 | 2026-05-10 | Banken hedder nu AI (#14) | Marked | model |
| 3.05#0 | 2026-05-10 | Manager · Du kan nu fjerne en rytter fra transferlist… | Marked | model |
| 3.05#1 | 2026-05-10 | Manager · Aktive tilbud på rytteren forbliver i deres… | Marked | model |
| 3.05#2 | 2026-05-10 | Manager · Virker både i åbent og lukket transfervindue | Marked | model |
| 3.04#0 | 2026-05-10 | Manager · Bud der lander efter auktionens sluttidspun… | Marked | model |
| 3.04#1 | 2026-05-10 | Manager · Konkret eksempel fra Axel Zingle's auktion… | Marked | model |
| 3.03#0 | 2026-05-10 | Manager · En auktion bliver nu KUN forlænget hvis bud… | Marked | model |
| 3.03#1 | 2026-05-10 | Manager · Eksempel | Marked | model |
| 3.03#2 | 2026-05-10 | Manager · Hvis nogen byder OVER dit autobud-loft og o… | Marked | model |
| 3.03#3 | 2026-05-10 | Backend · Ny `applyLeaderShiftExtension`-helper i `au… | Marked | model |
| 3.02#0 | 2026-05-10 | Manager · Forsidens 'Ryttere'-tæller og squad-warning… | Brugerflade | model |
| 3.02#1 | 2026-05-10 | Manager · Header viser breakdown når der er bevægelse… | Brugerflade | model |
| 3.02#2 | 2026-05-10 | Refactor · Ny pure-funktion `computeDashboardSquadSta… | Brugerflade | model |
| 3.01#0 | 2026-05-10 | Byd direkte fra rytter-profilen (#254) | Marked | model |
| 3.01#1 | 2026-05-10 | Byd direkte fra rytter-profilen (#254) | Marked | model |
| 3.01#2 | 2026-05-10 | Byd direkte fra rytter-profilen (#254) | Marked | model |
| 3.01#3 | 2026-05-10 | Byd direkte fra rytter-profilen (#254) | Marked | model |
| 3.00#0 | 2026-05-10 | Manager · Du må nu gå +2 over division-cap MIDT i et… | Marked | model |
| 3.00#1 | 2026-05-10 | Manager · Samme regel gælder også på transfertilbud | Marked | model |
| 3.00#2 | 2026-05-10 | Retroaktivt fix · Roman Ermakov og Harrison Wood blev… | Marked | model |
| 3.00#3 | 2026-05-10 | Backend · Ny `softCapBuffer`-option på `getIncomingSq… | Marked | model |
| 2.97#0 | 2026-05-09 | Sæson-finansrapport (07h) | Økonomi | model |
| 2.97#2 | 2026-05-09 | Sæson-finansrapport (07h) | Økonomi | model |
| 2.96#0 | 2026-05-09 | Manager · Ny prognose-sektion på Finanser-siden viser… | Økonomi | model |
| 2.96#1 | 2026-05-09 | Manager · Lille forecast-widget på Dashboard under sq… | Økonomi | model |
| 2.96#2 | 2026-05-09 | Manager · Kontekstuelle warnings rapporterer specifik… | Økonomi | model |
| 2.96#3 | 2026-05-09 | Backend · Ny pure-function `computeFinanceForecast` i… | Økonomi | model |
| 2.96#4 | 2026-05-09 | Hjælp · Ny FAQ 'Hvordan beregnes prognosen for næste… | Hjælp | model |
| 2.89#0 | 2026-05-09 | Lås rytter under afventende overførsel | Marked | model |
| 2.89#1 | 2026-05-09 | Lås rytter under afventende overførsel | Marked | model |
| 2.89#2 | 2026-05-09 | Lås rytter under afventende overførsel | Marked | model |
| 2.87#0 | 2026-05-09 | Forlængelse over døgnskifte | Marked | model |
| 2.87#1 | 2026-05-09 | Forlængelse over døgnskifte | Marked | model |
| 2.86#0 | 2026-05-09 | Ønskeliste-filter | Marked | model |
| 2.86#1 | 2026-05-09 | Ønskeliste-filter | Marked | model |
| 2.85#0 | 2026-05-09 | Kontraktintegritet | Marked | model |
| 2.85#1 | 2026-05-09 | Kontraktintegritet | Marked | model |
| 2.85#2 | 2026-05-09 | Kontraktintegritet | Marked | model |
| 2.84#0 | 2026-05-09 | Byttehandel & Lejeaftale | Marked | model |
| 2.84#1 | 2026-05-09 | Byttehandel & Lejeaftale | Marked | model |
| 2.84#2 | 2026-05-09 | Byttehandel & Lejeaftale | Marked | model |
| 2.82#0 | 2026-05-09 | 360px touch-targets | Mobil | model |
| 2.82#1 | 2026-05-09 | 360px touch-targets | Mobil | model |
| 2.82#2 | 2026-05-09 | 360px touch-targets | Mobil | model |
| 2.82#3 | 2026-05-09 | 360px touch-targets | Mobil | model |
| 2.81#0 | 2026-05-08 | Stort overblik-overhaul | Marked | model |
| 2.81#1 | 2026-05-08 | Stort overblik-overhaul | Marked | model |
| 2.81#2 | 2026-05-08 | Stort overblik-overhaul | Marked | model |
| 2.81#3 | 2026-05-08 | Stort overblik-overhaul | Marked | model |
| 2.81#4 | 2026-05-08 | Stort overblik-overhaul | Marked | model |
| 2.81#5 | 2026-05-08 | Stort overblik-overhaul | Marked | model |
| 2.81#6 | 2026-05-08 | Stort overblik-overhaul | Marked | model |
| 2.79#0 | 2026-05-08 | Auktioner · BYD-kolonnen på desktop har nu solid bagg… | Marked | model |
| 2.79#1 | 2026-05-08 | Autobud · '+ Autobud loft' er gjort tydeligere | Marked | model |
| 2.78#0 | 2026-05-08 | Mobile auktioner · Bedre tap-targets og scroll-håndte… | Mobil | model |
| 2.76#0 | 2026-05-08 | Auktioner · Live bud-feed på desktop | Marked | model |
| 2.76#1 | 2026-05-08 | Auktioner · Pris-cellen pulser kort i guld når curren… | Marked | model |
| 2.76#2 | 2026-05-08 | Auktioner · Du får nu en toast i hjørnet "Du er overb… | Marked | model |
| 2.76#3 | 2026-05-08 | Auktioner · Aggregat-ticker i header viser "X nye bud… | Marked | model |
| 2.75#0 | 2026-05-08 | Rytterprofil · Ny "Bud-historik"-fane viser live bud-… | Marked | model |
| 2.74#0 | 2026-05-08 | Autobud · Hvis dit autobud-loft afvises (fx ved forsø… | Marked | model |
| 2.74#1 | 2026-05-08 | Autobud · Når du byder manuelt over dit eget autobud-… | Marked | model |
| 2.73#0 | 2026-05-08 | Auktioner · Aldrig flere annullerede auktioner pga. | Marked | model |
| 2.73#1 | 2026-05-08 | Auktionssiden · Balance-tile viser nu "X tilgængelig"… | Marked | model |
| 2.73#2 | 2026-05-08 | Finansside · Balance-tile viser "X tilgængelig" og "Y… | Økonomi | model |
| 2.72#0 | 2026-05-08 | Auktioner · Race-beskyttelse | Marked | model |
| 2.71#0 | 2026-05-08 | Autobud · Du kan nu sætte autobud max-loft uden at ha… | Marked | model |
| 2.70#0 | 2026-05-07 | Indbakke · Ulæste-tælleren i headeren opdateres nu st… | Brugerflade | model |
| 2.69#0 | 2026-05-07 | Auktioner · Historik er nu en tydelig fane øverst på… | Marked | model |
| 2.68#0 | 2026-05-08 | Autobud · Resolveren følger nu altid med op når en mo… | Marked | model |
| 2.68#1 | 2026-05-08 | Pre-fix | Marked | model |
| 2.67#0 | 2026-05-07 | Autobud · Discord DM sendes nu også når et autobud ov… | Marked | model |
| 2.67#1 | 2026-05-07 | Autobud · Sælger får nu også besked når et autobud bl… | Marked | model |
| 2.67#2 | 2026-05-07 | Autobud · DM'en markerer eksplicit at det er et autob… | Marked | model |
| 2.66#0 | 2026-05-07 | Auktioner · Min-bud er nu blot **1 CZ$ over** det akt… | Marked | model |
| 2.66#1 | 2026-05-07 | Autobud · Resolveren bruger samme +1-step | Marked | model |
| 2.66#2 | 2026-05-07 | 10%-reglen blev oprindeligt indført for at undgå "+1"… | Marked | model |
| 2.65#0 | 2026-05-07 | Mit hold · Klik på rytter-rækker åbner nu rytter-deta… | Brugerflade | model |
| 2.65#1 | 2026-05-07 | Transfers · Klik på rytternavn i tilbud | Marked | model |
| 2.65#2 | 2026-05-07 | Højreklik på rytter-rækker viser nu "Åbn link i ny fa… | Brugerflade | model |
| 2.64#0 | 2026-05-07 | Auktioner · Autobud med max-loft (proxy-bidding) | Marked | model |
| 2.64#1 | 2026-05-07 | Autobud stopper automatisk når loftet er nået eller d… | Marked | model |
| 2.64#2 | 2026-05-07 | Opdatér eller fjern dit max-loft når som helst mens a… | Marked | model |
| 2.63#0 | 2026-05-07 | Deadline Day · Tickeren viser nu kun events fra det a… | Marked | model |
| 2.63#1 | 2026-05-07 | Deadline Day · Events i tickeren vises nu i kronologi… | Marked | model |
| 2.62#0 | 2026-05-07 | Bestyrelsesside + Dashboard | Bestyrelse | model |
| 2.62#1 | 2026-05-07 | Hjælp | Hjælp | model |
| 2.61#0 | 2026-05-07 | Auktioner · Fejlbesked ved for lavt bud er nu på dans… | Marked | model |
| 2.61#1 | 2026-05-07 | Auktioner · Fejlbesked ved utilstrækkelig disponibel… | Marked | model |
| 2.61#2 | 2026-05-07 | Auktioner · Tabelvisning viser nu 'Min. | Marked | model |
| 2.60#0 | 2026-05-07 | Tidszone-fix | Marked | model |
| 2.60#1 | 2026-05-07 | Auktioner · Countdown viser nu det absolutte sluttids… | Marked | model |
| 2.59#0 | 2026-05-07 | Mobil quick-nav | Mobil | model |
| 2.59#1 | 2026-05-07 | Menuen skifter automatisk position når DeadlineDayTic… | Mobil | model |
| 2.59#2 | 2026-05-07 | Aktiv destination fremhæves med accent-farven (guld)… | Mobil | model |
| 2.59#3 | 2026-05-07 | Auktion-bud | Marked | model |
| 2.58#0 | 2026-05-07 | Tilføjet synligt × i øverste højre hjørne så modalen… | Brugerflade | model |
| 2.58#1 | 2026-05-07 | ESC-tast lukker nu modalen. | Brugerflade | model |
| 2.58#2 | 2026-05-07 | Klik uden for modalen lukker den. | Brugerflade | model |
| 2.58#3 | 2026-05-07 | Modalen scroller på små skærme (vinduet kan ikke læng… | Brugerflade | model |
| 2.58#4 | 2026-05-07 | Knappen 'Kom i gang' omdøbt til 'Forstået' for at mat… | Brugerflade | model |
| 2.58#5 | 2026-05-07 | RiderStatsPage viste tidligere alder ud fra eksakt fø… | Brugerflade | model |
| 2.58#6 | 2026-05-07 | Visningen er nu rettet ind så alder altid beregnes so… | Brugerflade | model |
| 2.58#7 | 2026-05-07 | Filter på 'Alder ≤ 25' returnerer fortsat ryttere fød… | Brugerflade | model |
| 2.57#0 | 2026-05-07 | Ny stats-bar øverst på /auctions | Marked | model |
| 2.57#1 | 2026-05-07 | Projektion viser hvor mange ryttere man ville have hv… | Marked | model |
| 2.57#2 | 2026-05-07 | Aktive bud-felt viser summen af de bud man aktuelt er… | Marked | model |
| 2.56#0 | 2026-05-07 | Bugfix ([TeamProfilePage.jsx](frontend/src/pages/Team… | Brugerflade | model |
| 2.56#1 | 2026-05-07 | I stedet vises nu en korrekt online-prik + 'Online nu… | Brugerflade | model |
| 2.56#2 | 2026-05-07 | Refaktor | Brugerflade | model |
| 2.55#0 | 2026-05-07 | Bugfix ([auctionRules.js](backend/lib/auctionRules.js) | Marked | model |
| 2.55#1 | 2026-05-07 | Konsekvens | Marked | model |
| 2.55#2 | 2026-05-07 | Backend ([auctionRules.js](backend/lib/auctionRules.js)) | Marked | model |
| 2.55#3 | 2026-05-07 | Frontend | Marked | model |
| 2.55#4 | 2026-05-07 | Test | Marked | model |
| 2.53#0 | 2026-05-07 | Ny sektion 'Præmier' tilføjet i Hjælp & Regler med pr… | Hjælp | model |
| 2.53#1 | 2026-05-07 | Disclaimer tilføjet i hjælpesektionen | Hjælp | model |
| 2.53#2 | 2026-05-07 | Lille hjælp-ikon (?) tilføjet øverst på Point & præmi… | Hjælp | model |
| 2.51#2 | 2026-05-07 | Renter sporbare per lån | Økonomi | model |
| 2.51#3 | 2026-05-07 | Light konkurs-mekanik (lag 1) | Økonomi | model |
| 2.51#4 | 2026-05-07 | Test-disciplin | Andet | andet |
| 2.50#2 | 2026-05-07 | Fail-fast i [loanEngine.js](backend/lib/loanEngine.js) | Økonomi | model |
| 2.50#3 | 2026-05-07 | Stragglers fixet | Økonomi | model |
| 2.50#4 | 2026-05-07 | Doc-drift ryddet op | Andet | andet |
| 2.49#0 | 2026-05-06 | Bugfix ([economyEngine.js](backend/lib/economyEngine.js) | Økonomi | model |
| 2.49#2 | 2026-05-06 | Manuel kompensering | Økonomi | model |
| 2.48#0 | 2026-05-06 | Bugfix ([loanEngine.js](backend/lib/loanEngine.js)) | Økonomi | model |
| 2.48#1 | 2026-05-06 | Fix | Økonomi | model |
| 2.48#2 | 2026-05-06 | Eksisterende prod-data (en manager 54 CZ$ over loft)… | Økonomi | model |
| 2.47#0 | 2026-05-06 | Min aktivitet ([ActivityPage.jsx](frontend/src/pages/… | Brugerflade | model |
| 2.47#1 | 2026-05-06 | Head-to-Head ([HeadToHeadPage.jsx](frontend/src/pages… | Brugerflade | model |
| 2.47#2 | 2026-05-06 | Bugfix · Head-to-Head viste evig spinner hvis bare ét… | Brugerflade | model |
| 2.47#3 | 2026-05-06 | Bugfix · Stille fejl-skjul i Min aktivitet | Brugerflade | model |
| 2.46#2 | 2026-05-06 | Cleanup | Marked | model |
| 2.45#0 | 2026-05-05 | Indbakke-notifikationen 'Ønskeliste-rytter til auktio… | Marked | model |
| 2.45#1 | 2026-05-05 | Gamle allerede-sendte ønskeliste-auktionsnotifikation… | Marked | model |
| 2.44#0 | 2026-05-05 | Venstremenuen samlet i fire mentale rum | Brugerflade | model |
| 2.44#1 | 2026-05-05 | Venstremenuen samlet i fire mentale rum | Brugerflade | model |
| 2.44#2 | 2026-05-05 | Venstremenuen samlet i fire mentale rum | Brugerflade | model |
| 2.32#0 | 2026-05-04 | Ønskeliste-stjernen sad i sidste kolonne på rytterove… | Marked | model |
| 2.32#1 | 2026-05-04 | Stjernen sidder nu i sin egen kolonne lige til højre… | Marked | model |
| 2.32#2 | 2026-05-04 | Ny delt komponent [WatchlistStar.jsx](frontend/src/co… | Marked | model |
| 2.31#0 | 2026-05-04 | Ønskelisten viste hele din watchlist i én lang liste… | Marked | model |
| 2.31#1 | 2026-05-04 | Client-side paginering | Marked | model |
| 2.31#2 | 2026-05-04 | Ryttersiden på mobil er skiftet fra kort-layout til s… | Mobil | model |
| 2.30#0 | 2026-05-04 | Indbakken havde tabs for personlige notifikationer ("… | Brugerflade | model |
| 2.30#1 | 2026-05-04 | Nyt tab "Skal handles" (mellem Mine og Ligaen) viser… | Brugerflade | model |
| 2.30#2 | 2026-05-04 | Hvert item viser rytter | Brugerflade | model |
| 2.30#3 | 2026-05-04 | Auctions er IKKE inkluderet i "Skal handles". | Brugerflade | model |
| 2.29#0 | 2026-05-04 | Hidtil har der ikke været en konsekvens for at gå i s… | Marked | model |
| 2.29#1 | 2026-05-04 | Når et transfervindue lukker | Marked | model |
| 2.29#2 | 2026-05-04 | Bøde + point-fradrag pr. | Marked | model |
| 2.29#3 | 2026-05-04 | Rangliste-UI viser nu fradraget eksplicit | Marked | model |
| 2.29#4 | 2026-05-04 | Ny `riders.acquired_at`-kolonne sporer hvornår en ryt… | Marked | model |
| 2.28#0 | 2026-05-04 | Test-knappen i Discord webhooks-sektionen viste tidli… | Andet | andet |
| 2.28#1 | 2026-05-04 | Resultatet vises nu inline pr. | Andet | andet |
| 2.28#2 | 2026-05-04 | Backend `sendTestEmbed` returnerer nu `{ ok | Andet | andet |
| 2.28#3 | 2026-05-04 | Smoke-værktøjet er hermed launch-klar (S-06 P0 lukket) | Andet | andet |
| 2.27#0 | 2026-05-04 | Mandags-cron'en (uci_scraper.py) downgradede 14 rytte… | Udvikling | model |
| 2.27#1 | 2026-05-04 | Match-logikken er omskrevet til **token-set-baseret** | Udvikling | model |
| 2.27#2 | 2026-05-04 | Normalisering håndterer nu **æ/ø/å eksplicit** (æ→ae | Udvikling | model |
| 2.27#3 | 2026-05-04 | **Safety-gate** tilføjet | Udvikling | model |
| 2.26#0 | 2026-05-04 | Live-drift har manglet et undo-værktøj | Andet | andet |
| 2.26#1 | 2026-05-04 | Ny `Aktive auktioner`-sektion i Admin-panelet lister… | Andet | andet |
| 2.26#2 | 2026-05-04 | Backend | Andet | andet |
| 2.26#3 | 2026-05-04 | Notifikationer | Andet | andet |
| 2.25#0 | 2026-05-04 | Indtil nu havde to forskellige kode-paths hver sin lø… | Økonomi | model |
| 2.25#1 | 2026-05-04 | Fix | Økonomi | model |
| 2.24.1#0 | 2026-05-04 | Frontend lint stod på 0 errors / 41 warnings i flere… | Andet | andet |
| 2.24.1#1 | 2026-05-04 | Ryddet alle 24 unused-vars warnings | Andet | andet |
| 2.24.1#2 | 2026-05-04 | Baseline er nu 0 errors / 17 warnings. | Andet | andet |
| 2.24#0 | 2026-05-04 | Sheets-import havde indtil nu ingen synlig matchrapport | Andet | andet |
| 2.24#1 | 2026-05-04 | Ny flow | Andet | andet |
| 2.24#2 | 2026-05-04 | `Bekræft import`-knap (grøn) kører den rigtige import | Andet | andet |
| 2.23.1#0 | 2026-05-04 | Da Sæson 1 stadig er igangværende uden afsluttede løb | Løb og løbsfilm | model |
| 2.23.1#1 | 2026-05-04 | Fix | Løb og løbsfilm | model |
| 2.23#0 | 2026-05-04 | Ny deelbar URL `/seasons/ | Løb og løbsfilm | model |
| 2.23#1 | 2026-05-04 | Nyt | Løb og løbsfilm | model |
| 2.23#2 | 2026-05-04 | Nyt | Løb og løbsfilm | model |
| 2.23#3 | 2026-05-04 | Sidebar | Løb og løbsfilm | model |
| 2.23#4 | 2026-05-04 | Bibliotek-tab | Løb og løbsfilm | model |
| 2.23#5 | 2026-05-04 | Dropdown-skift opdaterer URL så snapshottet kan deles… | Løb og løbsfilm | model |
| 2.22#0 | 2026-05-04 | Tre overlappende race-sider (`/races` | Løb og løbsfilm | model |
| 2.22#1 | 2026-05-04 | Nyt | Løb og løbsfilm | model |
| 2.22#2 | 2026-05-04 | Nyt | Løb og løbsfilm | model |
| 2.22#3 | 2026-05-04 | IA | Løb og løbsfilm | model |
| 2.22#4 | 2026-05-04 | Backend | Løb og løbsfilm | model |
| 2.21#0 | 2026-05-04 | Alert-cards på Notifikationer | Brugerflade | model |
| 2.21#1 | 2026-05-04 | Fix | Brugerflade | model |
| 2.21#2 | 2026-05-04 | Verificeret runtime via Claude Preview | Brugerflade | model |
| 2.21#3 | 2026-05-04 | Visuel impact | Brugerflade | model |
| 2.20#0 | 2026-05-04 | Banneret øverst i siden under Deadline Day havde en b… | Marked | model |
| 2.20#1 | 2026-05-04 | Fix | Marked | model |
| 2.20#2 | 2026-05-04 | Verificeret runtime via Claude Preview | Marked | model |
| 2.19#0 | 2026-05-04 | Marked | Brugerflade | model |
| 2.19#1 | 2026-05-04 | Dashboard | Brugerflade | model |
| 2.19#2 | 2026-05-04 | Eksisterende managers der har dismisset progress-kort… | Brugerflade | model |
| 2.18#0 | 2026-05-03 | Tidligere | Brugerflade | model |
| 2.18#1 | 2026-05-03 | Nu | Brugerflade | model |
| 2.18#2 | 2026-05-03 | 22 callsites opdateret. | Brugerflade | model |
| 2.18#3 | 2026-05-03 | Land-filter dropdown viser nu kun landenavn (uden emo… | Brugerflade | model |
| 2.17#0 | 2026-05-03 | Økonomi-explainer på /finance sagde fejlagtigt at spo… | Økonomi | model |
| 2.17#1 | 2026-05-03 | Hint-kort og tour-tekster opdateret så managers får e… | Økonomi | model |
| 2.16#0 | 2026-05-03 | Finanser | Økonomi | model |
| 2.16#1 | 2026-05-03 | 'Vis mig rundt'-knap starter en kort tour med 3 peg-p… | Økonomi | model |
| 2.16#2 | 2026-05-03 | Hint kan skjules permanent med × eller 'Spring over'. | Økonomi | model |
| 2.15#0 | 2026-05-03 | Bestyrelse | Bestyrelse | model |
| 2.15#1 | 2026-05-03 | Tilfredshed → sponsor-modifier-tabellen vises i empty… | Bestyrelse | model |
| 2.15#2 | 2026-05-03 | CTA 'Forhandl din første plan med bestyrelsen' åbner… | Bestyrelse | model |
| 2.15#3 | 2026-05-03 | Kom-i-gang-kortets 'Vis mig hvordan' fungerer nu også… | Bestyrelse | model |
| 2.14#0 | 2026-05-04 | Database-opsætningen har manglet kolonnen som markere… | Marked | model |
| 2.13#0 | 2026-05-03 | Marked | Marked | model |
| 2.13#1 | 2026-05-03 | Auktioner | Marked | model |
| 2.13#2 | 2026-05-03 | Kom-i-gang-kortet på Dashboard har nu en 'Vis mig hvo… | Marked | model |
| 2.13#3 | 2026-05-03 | Touren peger på filtrene | Marked | model |
| 2.12#0 | 2026-05-03 | Nyt fremskridt-kort på Dashboard viser fire trin du h… | Brugerflade | model |
| 2.12#1 | 2026-05-03 | Næste trin fremhæves med et direkte CTA-link så du ik… | Brugerflade | model |
| 2.12#2 | 2026-05-03 | Kortet kan skjules permanent med ×. | Brugerflade | model |
| 2.12#3 | 2026-05-03 | Eksisterende managers ser kun de trin der ikke allere… | Brugerflade | model |
| 2.11#0 | 2026-05-03 | ESLint react-regelsæt løftet fra .js-only til .{js | Andet | andet |
| 2.11#1 | 2026-05-03 | Layout | Andet | andet |
| 2.11#2 | 2026-05-03 | ConfettiModal | Andet | andet |
| 2.11#3 | 2026-05-03 | BoardPage | Andet | andet |
| 2.11#4 | 2026-05-03 | 22 sider | Andet | andet |
| 2.11#5 | 2026-05-03 | JSX-tekst med citationstegn escapet til &quot | Andet | andet |
| 2.11#6 | 2026-05-03 | 8 tomme catch-blokke fået kort begrundelse i stedet f… | Andet | andet |
| 2.10#0 | 2026-05-03 | Lint-guard udvidet så hardcoded dark-only tekst- og k… | Andet | andet |
| 2.10#1 | 2026-05-03 | Sidste tilbageværende dark-only opacity-class (TEST-l… | Andet | andet |
| 2.09#0 | 2026-05-03 | Panic Board ligger nu i venstremenuen under Marked →… | Marked | model |
| 2.09#1 | 2026-05-03 | Siden er gjort læsbar i lyst tema. | Marked | model |
| 2.08#0 | 2026-05-03 | Potentiale-stjerner og rytter-statistik viser nu korr… | Udvikling | model |
| 2.07#0 | 2026-05-03 | Privat info bliver privat. | Brugerflade | model |
| 2.07#1 | 2026-05-03 | Den offentlige kanal viser fortsat broadcasts (nye au… | Brugerflade | model |
| 2.06#0 | 2026-05-03 | Dark mode S2. | Brugerflade | model |
| 2.06#1 | 2026-05-03 | Komponenter opdateret | Brugerflade | model |
| 2.05#0 | 2026-05-03 | Discord DM. | Brugerflade | model |
| 2.05#1 | 2026-05-03 | Tilføj dit Discord bruger-ID under Profil → Discord I… | Brugerflade | model |
| 2.05#2 | 2026-05-03 | Opt-out | Brugerflade | model |
| 2.05#3 | 2026-05-03 | Dashboard-nudge til managers uden Discord-ID (kan dis… | Brugerflade | model |
| 2.04#0 | 2026-05-02 | Dark mode. | Brugerflade | model |
| 2.04#1 | 2026-05-02 | Tre valgmuligheder | Brugerflade | model |
| 2.04#2 | 2026-05-02 | Sidebaren forbliver mørk i begge temaer for visuel ko… | Brugerflade | model |
| 2.03#0 | 2026-05-02 | Planlagte advarsler. | Marked | model |
| 2.03#1 | 2026-05-02 | Final Whistle-rapport. | Marked | model |
| 2.02#0 | 2026-05-02 | Flash Auktion (30 min). | Marked | model |
| 2.02#1 | 2026-05-02 | Hastebudsignal. | Marked | model |
| 2.01#0 | 2026-05-02 | Live Ticker. | Marked | model |
| 2.01#1 | 2026-05-02 | Panic Board (/deadline-day). | Marked | model |
| 2.01#2 | 2026-05-02 | Automatisk opdatering hvert 10. | Marked | model |
| 2.00#0 | 2026-05-02 | Deadline Day-banner. | Marked | model |
| 2.00#1 | 2026-05-02 | Admin | Andet | andet |
| 1.96#0 | 2026-05-02 | Ny tidsregel | Marked | model |
| 1.96#1 | 2026-05-02 | Eksempel | Marked | model |
| 1.96#2 | 2026-05-02 | Forlængelsesregel | Marked | model |
| 1.96#3 | 2026-05-02 | Admin | Andet | andet |
| 1.95#0 | 2026-05-02 | Fix | Løb og løbsfilm | model |
| 1.95#1 | 2026-05-02 | Alle fremtidige løbsresultater beregnes med den korre… | Løb og løbsfilm | model |
| 1.94#0 | 2026-05-02 | Ny side | Løb og løbsfilm | model |
| 1.94#1 | 2026-05-02 | Præmieformlen fremhævet med konkrete eksempler | Løb og løbsfilm | model |
| 1.94#2 | 2026-05-02 | Tilgængelig via Resultater → Pointtabel | Løb og løbsfilm | model |
| 1.93#0 | 2026-05-02 | Masseopdatering | Økonomi | model |
| 1.93#1 | 2026-05-02 | Alle påvirkede rytteres løn er synkroniseret automatisk | Økonomi | model |
| 1.92#0 | 2026-05-01 | Synkroniseret rytterværdier med Google Sheet (autorit… | Udvikling | model |
| 1.92#1 | 2026-05-01 | Rettet forældede værdier sat fra gammel CSV | Udvikling | model |
| 1.92#2 | 2026-05-01 | Forbedret import-algoritme | Udvikling | model |
| 1.91#0 | 2026-05-01 | Rettet rytterværdier for 17 ryttere med sammensatte e… | Udvikling | model |
| 1.91#1 | 2026-05-01 | Forbedret import-algoritme | Udvikling | model |
| 1.88#0 | 2026-05-01 | Nyt Sæsonstatus-banner på dashboardet. | Brugerflade | model |
| 1.87#0 | 2026-05-01 | Tabeloverskriften (navn | Marked | model |
| 1.86#0 | 2026-05-01 | Byd-kolonnen er nu fastlåst i højre side af tabellen. | Marked | model |
| 1.86#1 | 2026-05-01 | Fjernet 'Min. | Marked | model |
| 1.86#2 | 2026-05-01 | Tættere rækker giver overblik over flere auktioner på… | Marked | model |
| 1.86#3 | 2026-05-01 | Sælger- og Alder-kolonner skjules på mindre skærme og… | Marked | model |
| 1.85#0 | 2026-05-01 | Rettet | Marked | model |
| 1.84#0 | 2026-05-01 | Rettet | Udvikling | model |
| 1.84#1 | 2026-05-01 | Rettet | Udvikling | model |
| 1.83#0 | 2026-05-01 | Nyt | Udvikling | model |
| 1.83#1 | 2026-05-01 | Ryttere over 30 år vises med sølvstjerner i stedet fo… | Udvikling | model |
| 1.83#2 | 2026-05-01 | Sortering på Potentiale tilgængelig via kolonneoversk… | Udvikling | model |
| 1.83#3 | 2026-05-01 | Nyt filter | Udvikling | model |
| 1.83#4 | 2026-05-01 | Potentiale synkroniseres automatisk fra PCM-data (dyn… | Udvikling | model |
| 1.82#0 | 2026-04-30 | Ny land-filter dropdown på alle rytter-oversigter. | Marked | model |
| 1.82#1 | 2026-04-30 | Fjernet 'Sortér efter' dropdown. | Marked | model |
| 1.81#0 | 2026-04-30 | Alle 8.699 ryttere har nu korrekt nationalitetsflag b… | Brugerflade | model |
| 1.81#1 | 2026-04-30 | 138 lande repræsenteret fra PCM's fulde region-databa… | Brugerflade | model |
| 1.80#0 | 2026-04-30 | Rettet | Brugerflade | model |
| 1.79#0 | 2026-04-30 | Rettet | Brugerflade | model |
| 1.79#1 | 2026-04-30 | Rettet | Brugerflade | model |
| 1.79#2 | 2026-04-30 | Rettet | Brugerflade | model |
| 1.78#0 | 2026-04-30 | Ny tvungen navn-wizard | Brugerflade | model |
| 1.78#1 | 2026-04-30 | Ny velkomstmodal for nye managers | Brugerflade | model |
| 1.78#2 | 2026-04-30 | Velkomstmodalen vises automatisk første gang (nul ryt… | Brugerflade | model |
| 1.77#0 | 2026-04-30 | Rytterværdi viser nu dynamisk markedsværdi | Udvikling | model |
| 1.77#1 | 2026-04-30 | Auktionsbudsfeltet udfyldes nu med laveste gyldige bud | Marked | model |
| 1.77#2 | 2026-04-30 | Auktionslisten viser nu sælger tydeligt som AI eller… | Marked | model |
| 1.77#3 | 2026-04-30 | Sendte og modtagne tilbud kan arkiveres | Marked | model |
| 1.77#4 | 2026-04-30 | Dashboardets Transfers & Tilbud viser nu konkrete tilbud | Marked | model |
| 1.76#0 | 2026-04-30 | Finanssiden viser nu præmiepenge tydeligt | Økonomi | model |
| 1.76#1 | 2026-04-30 | Præmiepenge-transaktioner viser nu løbsnavn (f.eks. | Økonomi | model |
| 1.76#2 | 2026-04-30 | Divisionsbonus (type | Økonomi | model |
| 1.76#3 | 2026-04-30 | Lønsats sænket fra 15% til 10% af rytterens effektive… | Økonomi | model |
| 1.76#4 | 2026-04-30 | Gældslofter hævet markant | Økonomi | model |
| 1.76#5 | 2026-04-30 | Startsponsoren for nye hold hævet fra 240K til 260K C… | Økonomi | model |
| 1.75#0 | 2026-04-30 | Præmiepenge fra løb er nu adskilt fra sæsonpoint | Økonomi | model |
| 1.75#1 | 2026-04-30 | Divisionsbonus ved sæsonafslutning | Økonomi | model |
| 1.75#2 | 2026-04-30 | Præmiepenge knyttes nu til løbets klasse og UCI-point… | Økonomi | model |
| 1.74#0 | 2026-04-30 | /profil-siden viser nu korrekt Profil & Indstillinger. | Brugerflade | model |
| 1.73#0 | 2026-04-29 | Nødlån oprettet ved sæsonafslutning bliver nu knyttet… | Økonomi | model |
| 1.73#1 | 2026-04-29 | Der er tilføjet en service-visible sæsonafslutnings-v… | Økonomi | model |
| 1.72#0 | 2026-04-29 | Auktionsafslutningen har nu en ekstra sikring for akt… | Marked | model |
| 1.72#1 | 2026-04-29 | Auktioner | Marked | model |
| 1.71#0 | 2026-04-29 | Når du starter en auktion på en AI- | Marked | model |
| 1.71#1 | 2026-04-29 | Auktionslisten viser nu den rigtige førende manager f… | Marked | model |
| 1.67#0 | 2026-04-29 | Opryknings- og nedrykningszoner på holdranglisten føl… | Løb og løbsfilm | model |
| 1.65#0 | 2026-04-28 | Rytterprofilen viser nu Start auktion for bank- og AI… | Marked | model |
| 1.65#1 | 2026-04-28 | Direkte transfertilbud skjules nu for bank- og AI-ryt… | Marked | model |
| 1.65#2 | 2026-04-28 | Roadmap og feature-status er ryddet op | Brugerflade | model |
| 1.65#3 | 2026-04-28 | Min Profil er tilbage som indstillingsside | Brugerflade | model |
| 1.65#4 | 2026-04-28 | Egen managerprofil har nu en direkte genvej til redig… | Brugerflade | model |
| 1.63#2 | 2026-04-28 | Løn | Økonomi | model |
| 1.62#0 | 2026-04-28 | UCI-sync er hardenet til top 3000 med pagination-safety | Udvikling | model |
| 1.62#1 | 2026-04-28 | UCI-værdier og rytterlønninger opdateres nu i samme k… | Udvikling | model |
| 1.62#2 | 2026-04-28 | Den ugentlige UCI-workflow kører nu salary recalculat… | Udvikling | model |
| 1.62#3 | 2026-04-28 | Rytterlønninger genberegnes med den eksisterende økon… | Økonomi | model |
| 1.62#5 | 2026-04-28 | Der er tilføjet et manuelt backend-script til kontrol… | Andet | andet |
| 1.61#0 | 2026-04-28 | Ny 'Udvikling'-tab på rytterprofilen med graf for UCI… | Udvikling | model |
| 1.61#1 | 2026-04-28 | Stats-udvikling kan nu vises som graf for hver af ryt… | Udvikling | model |
| 1.61#2 | 2026-04-28 | Fanen viser også de seneste historiske datapunkter fr… | Udvikling | model |
| 1.61#3 | 2026-04-28 | Hjælp og FAQ er opdateret med forklaring af udvikling… | Hjælp | model |
| 1.59#0 | 2026-04-28 | Google Sheets-import af løbsresultater bruger nu samm… | Løb og løbsfilm | model |
| 1.59#1 | 2026-04-28 | Præmiepenge | Løb og løbsfilm | model |
| 1.59#2 | 2026-04-28 | Parkerede transferaftaler og byttehandler kan ikke læ… | Marked | model |
| 1.59#3 | 2026-04-28 | Parkerede direkte transfers holder transferlisten i f… | Marked | model |
| 1.59#4 | 2026-04-28 | Bankryttere kan ikke længere modtage direkte transfer… | Marked | model |
| 1.59#5 | 2026-04-28 | Auktionsbud skal nu være mindst 10% over nuværende pris | Marked | model |
| 1.59#6 | 2026-04-28 | Aktive auktionsføringer reserverer nu både disponibel… | Marked | model |
| 1.59#7 | 2026-04-28 | Min Profil redirecter nu altid til den indloggede man… | Brugerflade | model |
| 1.59#8 | 2026-04-28 | Sidebarens aktive markering matcher nu hele rutesegme… | Brugerflade | model |
| 1.58#0 | 2026-04-26 | UCI-point synkroniseres nu automatisk hver mandag fra… | Udvikling | model |
| 1.58#1 | 2026-04-26 | Historisk log af UCI-points og rytterstats gemmes ved… | Udvikling | model |
| 1.55#0 | 2026-04-26 | Tydelig oprykningsindikator på alle ranglister | Løb og løbsfilm | model |
| 1.55#1 | 2026-04-26 | Zone-separator linje (grøn gradient) adskiller tydeli… | Løb og løbsfilm | model |
| 1.55#2 | 2026-04-26 | Zone-separator linje (rød gradient) adskiller nedrykn… | Løb og løbsfilm | model |
| 1.55#3 | 2026-04-26 | Badges '↑ Op' og '↓ Ned' har nu tydeligere styling me… | Løb og løbsfilm | model |
| 1.55#4 | 2026-04-26 | Gælder både aktiv sæsonrangliste og afsluttede sæsonr… | Løb og løbsfilm | model |
| 1.54#0 | 2026-04-26 | Ny 'Historik'-tab på rytterprofilen. | Marked | model |
| 1.54#1 | 2026-04-26 | AI-salg vises med type-badge og vinderpris | Marked | model |
| 1.54#2 | 2026-04-26 | Direkte transferhandler vises med køber | Marked | model |
| 1.54#3 | 2026-04-26 | Byttehandler vises med begge hold og eventuel kontant… | Marked | model |
| 1.54#4 | 2026-04-26 | Låneaftaler vises med lejer | Marked | model |
| 1.53#0 | 2026-04-26 | Parkering af direkte transferaftaler og byttehandler | Marked | model |
| 1.53#1 | 2026-04-26 | Handlen parkeres med status 'Aftalt. | Marked | model |
| 1.53#2 | 2026-04-26 | Samme model som auktioner | Marked | model |
| 1.53#3 | 2026-04-26 | Når en handel parkeres | Marked | model |
| 1.53#4 | 2026-04-26 | Begge parter kan stadig annullere en parkeret handel… | Marked | model |
| 1.53#5 | 2026-04-26 | Forhandling (tilbud | Marked | model |
| 1.52#0 | 2026-04-26 | Google Sheets-import af løbsresultater. | Løb og løbsfilm | model |
| 1.52#1 | 2026-04-26 | Understøtter alle 8 benævnelse-typer | Løb og løbsfilm | model |
| 1.52#2 | 2026-04-26 | Automatisk etape-detektion (rank-nulstilling = ny eta… | Løb og løbsfilm | model |
| 1.52#3 | 2026-04-26 | Re-import er idempotent. | Løb og løbsfilm | model |
| 1.51#0 | 2026-04-26 | Evne-filtre (slidere) virker nu korrekt. | Marked | model |
| 1.51#1 | 2026-04-26 | Webhook-routing rettet. | Andet | andet |
| 1.50#0 | 2026-04-26 | FM-style indbakke. | Brugerflade | model |
| 1.50#1 | 2026-04-26 | 'Mine'-fanen har kategorifiltre | Brugerflade | model |
| 1.50#2 | 2026-04-26 | 'Ligaen'-fanen viser globale spilhændelser med filtre | Brugerflade | model |
| 1.50#3 | 2026-04-26 | Aktivitetsfeed-siden er nu en del af Indbakke. | Brugerflade | model |
| 1.49#0 | 2026-04-26 | Online-status er nu live. | Brugerflade | model |
| 1.49#1 | 2026-04-26 | Sidst set vises på managerprofiler (fx '12 min siden'… | Brugerflade | model |
| 1.49#2 | 2026-04-26 | Login-streak tæller daglig aktivitet og vises på mana… | Brugerflade | model |
| 1.49#3 | 2026-04-26 | Online-tæller i sidebaren viser antal aktive managere… | Brugerflade | model |
| 1.49#4 | 2026-04-26 | Ulæste-badge på 'Indbakke' i navigationssidebaren. | Brugerflade | model |
| 1.49#5 | 2026-04-26 | Mobilvisning | Mobil | model |
| 1.47#0 | 2026-04-25 | Sort-dropdown viser nu 'Værdi' i stedet for 'UCI Point'. | Marked | model |
| 1.47#1 | 2026-04-25 | Ny 'Løn'-kolonne i rytterlisten. | Marked | model |
| 1.47#2 | 2026-04-25 | Nyt lønfilter. | Marked | model |
| 1.47#3 | 2026-04-25 | Hold B viser nu automatisk holdforslag ved fokus i sø… | Marked | model |
| 1.46#0 | 2026-04-25 | Startkapital for nye hold er sænket fra 2.000.000 til… | Økonomi | model |
| 1.46#1 | 2026-04-25 | Standard sponsor-indkomst er sænket fra 400.000 til 2… | Økonomi | model |
| 1.46#2 | 2026-04-25 | Alle eksisterende hold er opdateret til de nye værdier | Økonomi | model |
| 1.46#3 | 2026-04-25 | Garanteret salg er nu låst til egne ryttere. | Marked | model |
| 1.46#4 | 2026-04-25 | Bestyrelses-outlook og category-scores på Dashboard v… | Bestyrelse | model |
| 1.45#0 | 2026-04-25 | Rettet | Marked | model |
| 1.44#0 | 2026-04-25 | Rytterværdi er nu dynamisk | Udvikling | model |
| 1.44#1 | 2026-04-25 | Lønnen er ændret fra 10% til 15% af rytterens effekti… | Økonomi | model |
| 1.44#2 | 2026-04-25 | Alle eksisterende rytterlønninger er genberegnet med… | Økonomi | model |
| 1.44#3 | 2026-04-25 | Minimum-regel | Udvikling | model |
| 1.44#4 | 2026-04-25 | Præmiebonus opdateres ved sæsonslut for alle ryttere. | Udvikling | model |
| 1.44#5 | 2026-04-25 | Køb via auktion eller transfer sætter straks ny løn b… | Økonomi | model |
| 1.43#0 | 2026-04-25 | Alle beløb og værdier er skaleret ×4000. | Økonomi | model |
| 1.43#1 | 2026-04-25 | Rytterens markedsværdi er nu UCI-point × 4000 CZ$ (f.… | Udvikling | model |
| 1.43#2 | 2026-04-25 | Holdenes startkapital er 2.000.000 CZ$ og standard sp… | Økonomi | model |
| 1.41#0 | 2026-04-25 | Hvert bestyrelsesmål viser nu om det er et obligatori… | Bestyrelse | model |
| 1.41#1 | 2026-04-25 | Mål der er bagud vises med advarselsstatus (I fare /… | Bestyrelse | model |
| 1.41#2 | 2026-04-25 | Aktuelle fremskridt vises direkte på hvert mål | Bestyrelse | model |
| 1.41#3 | 2026-04-25 | Bestyrelsens karakter (sportsambition | Bestyrelse | model |
| 1.41#4 | 2026-04-25 | Ny advarselsbanner hvis tilfredshed falder under 25%. | Bestyrelse | model |
| 1.41#5 | 2026-04-25 | Forhandlingswizarden viser nu tydeligt hvilke mål der… | Bestyrelse | model |
| 1.40#0 | 2026-04-24 | Board-siden viser nu tre parallelle bestyrelsesplaner… | Bestyrelse | model |
| 1.40#1 | 2026-04-24 | Wizard-flowet åbner nu for én specifik plantype | Bestyrelse | model |
| 1.40#2 | 2026-04-24 | Første gang du åbner Board-siden oprettes alle tre pl… | Bestyrelse | model |
| 1.39#0 | 2026-04-24 | Nationalitetsflag vises nu på Hold | Brugerflade | model |
| 1.38#0 | 2026-04-24 | Gennemførte transfers og byttehandler sendes nu autom… | Brugerflade | model |
| 1.37#0 | 2026-04-24 | Løbsarkiv er nu tilgængeligt under Resultater. | Løb og løbsfilm | model |
| 1.37#1 | 2026-04-24 | Hvert løb har sin egen historikside med alle tidliger… | Løb og løbsfilm | model |
| 1.37#2 | 2026-04-24 | Bedste ryttere vises akkumuleret på tværs af alle udg… | Løb og løbsfilm | model |
| 1.37#3 | 2026-04-24 | Akkumuleret point-graf viser de bedste rytteres samle… | Løb og løbsfilm | model |
| 1.37#4 | 2026-04-24 | Løbsarkiv er tilføjet som hub-link på Resultater-over… | Løb og løbsfilm | model |
| 1.36#0 | 2026-04-24 | Resultater-hub tilføjet som samlet indgang til result… | Løb og løbsfilm | model |
| 1.36#1 | 2026-04-24 | Rytterrangliste er nu tilgængelig under Resultater. | Løb og løbsfilm | model |
| 1.36#2 | 2026-04-24 | Rytterranglisten inkluderer både manager-ejede og AI-… | Løb og løbsfilm | model |
| 1.35#0 | 2026-04-24 | 'UCI Point' er omdøbt til 'Værdi' i hele UI. | Udvikling | model |
| 1.35#1 | 2026-04-24 | Auktionsformularen håndhæver nu minimum Værdi som sta… | Marked | model |
| 1.35#2 | 2026-04-24 | 'Garanteret salg' er nu tydeligt markeret som undtage… | Marked | model |
| 1.35#3 | 2026-04-24 | Rytterliste og rytterside viser nu en '⚡ Auktion'-bad… | Marked | model |
| 1.35#4 | 2026-04-24 | Transferlisten viser nu hvornår en rytter blev sat ti… | Marked | model |
| 1.35#5 | 2026-04-24 | Ryttertype vises nu som et tydeliggjort badge på rytt… | Udvikling | model |
| 1.35#6 | 2026-04-24 | Nationalitetsflag vises nu på rytterlisten og rytters… | Brugerflade | model |
| 1.35#7 | 2026-04-24 | Du får nu notifikation i indbakken når en rytter på d… | Marked | model |
| 1.34#0 | 2026-04-24 | Min Aktivitet er ombygget til seks faner | Brugerflade | model |
| 1.34#1 | 2026-04-24 | Siden åbner nu på 'Kræver handling' som default. | Brugerflade | model |
| 1.34#2 | 2026-04-24 | Auktioner der slutter inden for 1 time vises i 'Kræve… | Brugerflade | model |
| 1.34#3 | 2026-04-24 | Lån (lejeaftaler) har fået sin egen fane med adskille… | Brugerflade | model |
| 1.34#4 | 2026-04-24 | Ønskeliste-fanen viser dine gemte ryttere kompakt med… | Brugerflade | model |
| 1.34#5 | 2026-04-24 | Historik-fanen samler afsluttede auktioner | Brugerflade | model |
| 1.34#6 | 2026-04-24 | Klik på rytternavn i alle rækker åbner rytterens stat… | Brugerflade | model |
| 1.33#0 | 2026-04-23 | UI er konverteret fra mørkt tema til lyst tema. | Brugerflade | model |
| 1.33#1 | 2026-04-23 | Navigationen har nu tydelig hierarki | Brugerflade | model |
| 1.33#2 | 2026-04-23 | Sidebar-ikoner er fjernet fra menupunkter for et rene… | Brugerflade | model |
| 1.33#3 | 2026-04-23 | Aktiv menupunkt vises med gyldent highlight og afrund… | Brugerflade | model |
| 1.33#4 | 2026-04-23 | Status-farver (grøn/rød/orange/blå) er justeret for g… | Brugerflade | model |
| 1.33#5 | 2026-04-23 | Spinner og loading-states er opdateret til lyst tema | Brugerflade | model |
| 1.33#6 | 2026-04-23 | CSS custom properties introduceret som fundament for… | Brugerflade | model |
| 1.32#0 | 2026-04-23 | Notifikationer er omdøbt til Indbakke. | Brugerflade | model |
| 1.32#1 | 2026-04-23 | Klik på en besked i Indbakken fører nu direkte til de… | Brugerflade | model |
| 1.32#2 | 2026-04-23 | Holdoversigten viser nu en grøn online-indikator ved… | Brugerflade | model |
| 1.31#0 | 2026-04-23 | Navigationen er omstruktureret med fire tydelige grupper | Brugerflade | model |
| 1.31#1 | 2026-04-23 | Ranglisten | Brugerflade | model |
| 1.31#2 | 2026-04-23 | Min Aktivitet og Ønskeliste (tidligere Talentspejder)… | Brugerflade | model |
| 1.31#3 | 2026-04-23 | Løbskalender og Sæson Preview er flyttet under Liga | Brugerflade | model |
| 1.31#4 | 2026-04-23 | Notifikationer og Min Managerprofil er rykket op unde… | Brugerflade | model |
| 1.31#5 | 2026-04-23 | Klik på Cycling Zone-logoet fører nu direkte til Dash… | Brugerflade | model |
| 1.31#6 | 2026-04-23 | Min Profil er foldet ind i managerprofilen. | Brugerflade | model |
| 1.30#0 | 2026-04-23 | Hemmelige achievements afslører ikke længere navn ell… | Brugerflade | model |
| 1.30#1 | 2026-04-23 | Discord-webhooks sendes nu korrekt ved nye auktioner | Brugerflade | model |
| 1.29#0 | 2026-04-23 | Standings gemmer nu også divisionens interne placerin… | Løb og løbsfilm | model |
| 1.29#1 | 2026-04-23 | Admin har nu en direkte '↻ Standings'-rebuild på sæsoner | Andet | andet |
| 1.28#0 | 2026-04-23 | Board-siden forklarer nu tydeligere hvorfor bestyrels… | Bestyrelse | model |
| 1.28#1 | 2026-04-23 | Seneste board request viser nu konkrete fokus- og mål… | Bestyrelse | model |
| 1.28#2 | 2026-04-23 | National kerne vises nu med landenavn og flag på Boar… | Bestyrelse | model |
| 1.27#0 | 2026-04-23 | Bestyrelsen bruger nu national kerne og stjerneprofil… | Bestyrelse | model |
| 1.27#1 | 2026-04-23 | Store profiler giver nu lidt ekstra sponsor/prestige… | Bestyrelse | model |
| 1.27#2 | 2026-04-23 | Direkte board-skift mellem ungdomsspor og stjernespor… | Bestyrelse | model |
| 1.27#3 | 2026-04-23 | Backend og database stopper nu dobbelt board-requests… | Bestyrelse | model |
| 1.26#0 | 2026-04-22 | Board-siden viser nu også national kerne og stjernepr… | Bestyrelse | model |
| 1.26#1 | 2026-04-22 | Balancerede hold med en tydelig national kerne kan nu… | Bestyrelse | model |
| 1.26#2 | 2026-04-22 | Board-status og season-end-evaluering bruger nu samme… | Bestyrelse | model |
| 1.25#0 | 2026-04-22 | Nye bestyrelsesplaner skalerer nu efter division | Bestyrelse | model |
| 1.25#1 | 2026-04-22 | Board-siden viser nu bestyrelsens læsning af holdet m… | Bestyrelse | model |
| 1.25#2 | 2026-04-22 | Board requests bruger nu også holdprofilen | Bestyrelse | model |
| 1.24#0 | 2026-04-22 | Login-flowet har nu fået et rigtigt 'Glemt password?'… | Brugerflade | model |
| 1.24#1 | 2026-04-22 | Recovery-mails lander nu på en dedikeret `/reset-pass… | Brugerflade | model |
| 1.24#2 | 2026-04-22 | Hjælp & Regler og FAQ forklarer nu også | Hjælp | model |
| 1.23#0 | 2026-04-22 | Board-siden har nu fået board requests | Bestyrelse | model |
| 1.23#1 | 2026-04-22 | Bestyrelsen kan nu svare med godkendelse | Bestyrelse | model |
| 1.23#2 | 2026-04-22 | Board-status returnerer nu også request-status og req… | Bestyrelse | model |
| 1.22#0 | 2026-04-22 | Achievements syncer nu mod live historik i stedet for… | Brugerflade | model |
| 1.22#1 | 2026-04-22 | Achievement-checket kører nu efter login-streak-opdat… | Brugerflade | model |
| 1.21#0 | 2026-04-22 | Admin-import af løbsresultater kører nu gennem samme… | Andet | andet |
| 1.21#1 | 2026-04-22 | Admin-sæsonstart og -afslutning bruger nu kun ét kano… | Andet | andet |
| 1.20#0 | 2026-04-22 | Udløbne AI- | Marked | model |
| 1.20#1 | 2026-04-22 | Auktionshistorikken kan nu sikkert rydde `seller_team… | Marked | model |
| 1.19#0 | 2026-04-22 | AI- og andre non-user-ejede auktioner krediterer nu d… | Marked | model |
| 1.19#1 | 2026-04-22 | Stale auktioner annulleres nu sikkert | Marked | model |
| 1.18#0 | 2026-04-22 | Backend-notifikationer deduplikerer nu nylige identis… | Brugerflade | model |
| 1.18#1 | 2026-04-22 | Board- | Brugerflade | model |
| 1.17#0 | 2026-04-22 | Signup og Min Profil gemmer nu holdnavn og managernav… | Brugerflade | model |
| 1.17#1 | 2026-04-22 | Managers med en tidligere halv-oprettet konto kan nu… | Brugerflade | model |
| 1.17#2 | 2026-04-22 | Hold-bootstrap sikrer nu også | Brugerflade | model |
| 1.16#0 | 2026-04-22 | Admin-import af løbsresultater og admin-godkendelse a… | Andet | andet |
| 1.16#1 | 2026-04-22 | Godkendelse af pending resultater markerer nu submiss… | Andet | andet |
| 1.16#2 | 2026-04-22 | Race-præmier bogføres nu konsekvent som gyldige `priz… | Økonomi | model |
| 1.15#0 | 2026-04-22 | Bestyrelsen bruger nu en mere gradvis og vægtet evalu… | Bestyrelse | model |
| 1.15#1 | 2026-04-22 | Dashboardets bestyrelseskort læser nu via den samme `… | Bestyrelse | model |
| 1.15#2 | 2026-04-22 | Board-siden viser nu bestyrelsens aktuelle outlook og… | Bestyrelse | model |
| 1.15#3 | 2026-04-22 | Dashboardet bruger nu korrekt `budget_modifier` i ste… | Bestyrelse | model |
| 1.15#4 | 2026-04-22 | Season-end board-evaluering tæller nu også U25-rytter… | Bestyrelse | model |
| 1.14#0 | 2026-04-22 | Bestyrelsens mål og forhandlede kompromiser genereres… | Bestyrelse | model |
| 1.14#1 | 2026-04-22 | Forny kontrakt går nu gennem en rigtig API-route i st… | Marked | model |
| 1.14#2 | 2026-04-22 | Board-flowet er nu dækket af en direkte backend-regre… | Bestyrelse | model |
| 1.14#3 | 2026-04-22 | Board-wizarden kan ikke længere sende vilkårlige mål… | Bestyrelse | model |
| 1.13#0 | 2026-04-21 | Lejegebyr på rider-loans trækkes nu igen for hver dæk… | Marked | model |
| 1.13#1 | 2026-04-21 | Sæsonstart bogfører nu fortsatte lejeaftaler i financ… | Marked | model |
| 1.13#2 | 2026-04-21 | Hjælp & Regler præciserer nu | Hjælp | model |
| 1.12#0 | 2026-04-21 | Squad-limit tæller nu også aktive lejeaftaler med i d… | Marked | model |
| 1.12#1 | 2026-04-21 | Lejeforslag | Marked | model |
| 1.12#2 | 2026-04-21 | Dashboardets holdstørrelse-advarsel tæller nu både in… | Brugerflade | model |
| 1.12#3 | 2026-04-21 | Hjælp & Regler præciserer nu | Hjælp | model |
| 1.11#0 | 2026-04-21 | Dashboardets divisionsstilling og Hold-siden viser nu… | Løb og løbsfilm | model |
| 1.11#1 | 2026-04-21 | Ranglistekort og holdoversigt falder nu tilbage til 0… | Løb og løbsfilm | model |
| 1.10#0 | 2026-04-21 | Auktions-cron kan igen starte korrekt på Railway | Marked | model |
| 1.10#1 | 2026-04-21 | Expired auction-finalisering er nu dækket af en direk… | Marked | model |
| 1.9#0 | 2026-04-21 | Transfers og byttehandler bruger nu samme backend-gua… | Marked | model |
| 1.9#1 | 2026-04-21 | Gennemførte handler rydder nu relaterede listings | Marked | model |
| 1.9#2 | 2026-04-21 | Hjælp & Regler præciserer nu | Hjælp | model |
| 1.8#0 | 2026-04-21 | AI- og frirytter-auktioner betaler ikke længere salgs… | Marked | model |
| 1.8#1 | 2026-04-21 | Auktionsfinalisering bruger nu samme backend-logik i… | Marked | model |
| 1.8#2 | 2026-04-21 | Hjælp & Regler præciserer nu | Hjælp | model |
| 1.7#0 | 2026-04-21 | Finance-siden kan igen oprette manager-lån uden at ko… | Økonomi | model |
| 1.7#1 | 2026-04-21 | Finance-lån og rider-lån kører nu på adskilte API-routes | Økonomi | model |
| 1.6#0 | 2026-04-21 | Admin-sæsonflowet er stabiliseret | Andet | andet |
| 1.6#1 | 2026-04-21 | Godkendte løbsresultater gemmes nu med korrekt holdti… | Løb og løbsfilm | model |
| 1.6#2 | 2026-04-21 | Sæsonstillingen recalculeres nu fra gemte løbsresulta… | Løb og løbsfilm | model |
| 1.6#3 | 2026-04-21 | Sæsonafslutning stopper nu | Løb og løbsfilm | model |
| 1.6#4 | 2026-04-21 | Hjælp & Regler er præciseret omkring hvornår sæsonsti… | Hjælp | model |
| 1.6#5 | 2026-04-21 | FAQ er opdateret med svar om result-godkendelse og sæ… | Hjælp | model |
| 1.5#0 | 2026-04-18 | Manager-profil. | Brugerflade | model |
| 1.5#1 | 2026-04-18 | Online status. | Brugerflade | model |
| 1.5#2 | 2026-04-18 | Managers online. | Brugerflade | model |
| 1.5#3 | 2026-04-18 | Login-streak. | Brugerflade | model |
| 1.5#4 | 2026-04-18 | Achievements · 45 achievements fordelt på auktioner | Brugerflade | model |
| 1.5#5 | 2026-04-18 | Hemmelige achievements. | Brugerflade | model |
| 1.5#6 | 2026-04-18 | Watchlist-tæller. | Marked | model |
| 1.5#7 | 2026-04-18 | Transferrygter fix. | Marked | model |
| 1.5#8 | 2026-04-18 | Hjælp & Regler. | Hjælp | model |
| 1.5#9 | 2026-04-18 | FAQ opdateret med 6 nye spørgsmål | Hjælp | model |
| 1.5#10 | 2026-04-18 | Patch Notes opdateret med denne version | Brugerflade | model |
| 1.4#0 | 2026-04-17 | Aktivitetsfeed. | Brugerflade | model |
| 1.4#1 | 2026-04-17 | Transferrygter. | Marked | model |
| 1.4#2 | 2026-04-17 | Deadline Day. | Marked | model |
| 1.4#3 | 2026-04-17 | Onboarding guide · 3-trins velkomstguide til nye spil… | Brugerflade | model |
| 1.4#4 | 2026-04-17 | Fejringsanimation. | Brugerflade | model |
| 1.4#5 | 2026-04-17 | Mobil forbedringer. | Mobil | model |
| 1.4#6 | 2026-04-17 | Hjælp & Regler. | Hjælp | model |
| 1.4#7 | 2026-04-17 | FAQ opdateret med 4 nye spørgsmål | Hjælp | model |
| 1.4#8 | 2026-04-17 | Auktioner logger automatisk til aktivitetsfeed ved st… | Brugerflade | model |
| 1.4#9 | 2026-04-17 | Transfers logger automatisk til aktivitetsfeed ved ge… | Brugerflade | model |
| 1.3#0 | 2026-04-17 | Transfersystem v2. | Marked | model |
| 1.3#1 | 2026-04-17 | Send tilbud på enhver rytter fra rytterens side. | Marked | model |
| 1.3#2 | 2026-04-17 | Modtagne tilbud. | Marked | model |
| 1.3#3 | 2026-04-17 | Sendte tilbud. | Marked | model |
| 1.3#4 | 2026-04-17 | Ubegrænset forhandlingsrunder frem og tilbage. | Marked | model |
| 1.3#5 | 2026-04-17 | Tilbud er private. | Marked | model |
| 1.3#6 | 2026-04-17 | Besked-felt på alle tilbud og modbud | Marked | model |
| 1.3#7 | 2026-04-17 | Rytter skifter hold ved næste vindueåbning | Marked | model |
| 1.3#8 | 2026-04-17 | Hjælp & Regler opdateret med transfersystem v2 | Hjælp | model |
| 1.3#9 | 2026-04-17 | Transfers-siden omstruktureret med faner | Marked | model |
| 1.3#10 | 2026-04-17 | Konfetti-animation ved accepteret transfer | Marked | model |
| 1.2#0 | 2026-04-17 | Løbskalender. | Løb og løbsfilm | model |
| 1.2#1 | 2026-04-17 | Resultatindberetning. | Løb og løbsfilm | model |
| 1.2#2 | 2026-04-17 | Admin godkendelse. | Andet | andet |
| 1.2#3 | 2026-04-17 | Sæsonresultater. | Løb og løbsfilm | model |
| 1.2#4 | 2026-04-17 | Pointudviklingsgraf. | Løb og løbsfilm | model |
| 1.2#5 | 2026-04-17 | Delt RiderFilters komponent. | Marked | model |
| 1.2#6 | 2026-04-17 | Filtrer på navn | Marked | model |
| 1.2#7 | 2026-04-17 | Sortering på alle stats med retningspil | Marked | model |
| 1.2#8 | 2026-04-17 | Aktive filter-chips der kan fjernes enkeltvis | Marked | model |
| 1.2#9 | 2026-04-17 | Dashboard. | Brugerflade | model |
| 1.2#10 | 2026-04-17 | Rangliste. | Løb og løbsfilm | model |
| 1.2#11 | 2026-04-17 | Transfers. | Marked | model |
| 1.2#12 | 2026-04-17 | Bestyrelse. | Bestyrelse | model |
| 1.2#13 | 2026-04-17 | Alle sideoverskrifter ensrettet til samme størrelse | Brugerflade | model |
| 1.1#0 | 2026-04-17 | Fold-ud navigation. | Brugerflade | model |
| 1.1#1 | 2026-04-17 | Auto-åbner aktiv gruppe ved navigation | Brugerflade | model |
| 1.1#2 | 2026-04-17 | Balance og division vist direkte i sidebaren | Brugerflade | model |
| 1.1#3 | 2026-04-17 | Hall of Fame. | Brugerflade | model |
| 1.1#4 | 2026-04-17 | Sæson Preview. | Løb og løbsfilm | model |
| 1.1#5 | 2026-04-17 | Head-to-Head. | Brugerflade | model |
| 1.1#6 | 2026-04-17 | Rytter sæsonhistorik. | Udvikling | model |
| 1.1#7 | 2026-04-17 | Manager XP system. | Brugerflade | model |
| 1.1#8 | 2026-04-17 | Patch Notes side | Brugerflade | model |
| 1.1#9 | 2026-04-17 | Dashboard viser nu løb korrekt uanset status | Brugerflade | model |
| 1.1#10 | 2026-04-17 | Alle sideoverskrifter ensrettet | Brugerflade | model |
| 1.0#0 | 2026-04-17 | Hjælp & Regler. | Hjælp | model |
| 1.0#1 | 2026-04-17 | Talentspejder / Ønskeliste. | Marked | model |
| 1.0#2 | 2026-04-17 | Min Aktivitet. | Brugerflade | model |
| 1.0#3 | 2026-04-17 | Discord integration. | Brugerflade | model |
| 1.0#4 | 2026-04-17 | Manuel override i admin. | Andet | andet |
| 1.0#5 | 2026-04-17 | Min Profil. | Brugerflade | model |
| 1.0#6 | 2026-04-17 | Auktionskort opdateres øjeblikkeligt efter bud | Marked | model |
| 1.0#7 | 2026-04-17 | 'Andre managers' fane på auktionssiden | Marked | model |
| 1.0#8 | 2026-04-17 | Holdstørrelsesgræ nser per division med advarsel | Marked | model |
| 1.0#9 | 2026-04-17 | Balance skjult for andre managers | Brugerflade | model |
| 1.0#10 | 2026-04-17 | Sæsonstart lukker transfervindue og genberegner lønni… | Marked | model |
