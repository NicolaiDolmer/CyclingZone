# Backlog-prioritering 2026-08-31 - fuld klassifikation

> Fuld-backlog-audit 31/8: 54-agent workflow (K-verify+refute, dubletter, klassifikation med penge/infrastruktur-linse, beslutningsark, ejer-koe, marketing-inventar). Eksekverede handlinger (34 closes, 7 done-flips, 2 todo-flips): #627-kommentaren 31/8. Beslutningsark: [decision-briefs-2026-08-31.md](decision-briefs-2026-08-31.md). V 1-5 = hvor meget issuet flytter for indtjening-nu eller langsigtet produkt/infrastruktur.


## S3-vinduet: fejl der rammer spillere NU (121)

| # | V | Pri | Titel | Note |
|---|---|-----|-------|------|
| #2557 | 5 | high | [balance/HØJ] LIVE drift i race v3: hold-dominans (share4+) RØD 3 dage | Live favorit-dominans stiger dagligt (51%) i aktiv sæson - ejer-go til kalibrering haster. |
| #3461 | 5 | high | [bug/balance] Restitutionens timing: 'Træn i dag' om morgenen brænder  | Restitution kun ét dagligt tick - ryttere står på 100 træthed hver morgen, rammer alle spillere nu. |
| #3961 | 5 | high | [incident] Staging-backend mod branch-klon postede 60 re-simulerede re | Staging postede 60 re-simulerede resultater til prod-Discord - dublet-risiko, live-guard mangler |
| #4174 | 5 | high | [balance/HOEJ] Kalenderen kraever op til 29 ryttere - kun 21 % af hold | Kalenderen kræver op til 29 ryttere, kun 21% af hold kan stille fuldt hold - værst D4 (2/46). |
| #4192 | 5 | high | [design] Traening: single source of truth - saml alt, stil spoergsmaal | 1.520 ryttere på Hvile+løb i S3 får nul træningsudvikling lige nu - akut live bug, ikke kun designsession |
| #4206 | 5 | high | [balance/HOEJ] 965 ryttere (15 %) har identiske stats i alle 14 felter | 965 ryttere (15%) har identiske stats i alle 14 felter - ingen specialitet, rammer live rosters nu |
| #4213 | 5 | high | [bug/HOEJ] 461 akademi-/ungdomstilbud peger paa ryttere der allerede e | 461 akademitilbud peger på AI-ejede ryttere - spillere kan stjæle dem direkte via RPC-hul, live |
| #4294 | 5 | high | [bug] Formplanen ude af sync med S3-start: ryttere laast i "no peak" + | Formplan i S3-start viser laaste 'no peak' + falske afsluttede peaks - rammer alle spillere nu. |
| #4376 | 5 | high | [bug/economy] BEKRAEFTET: guaranteed_base rebases ikke ved oprykning — | BEKRAEFTET: 21/24 D1-hold koerer paa forkert gammel sponsor-base efter oprykning - direkte oekonomisk skade nu. |
| #4418 | 5 | high | [bug/HOEJ] 5 ryttere forsvundet ud af 3 igangvaerende etapeloeb - skad | 5 ryttere forsvundet fra 3 igangvaerende etapeloeb uden Sentry-alarm - usynlig fejlklasse midt i live saeson. |
| #4423 | 5 | high | [bug] Akademikontrakt skrevet midt i et igangvaerende etapeloeb fjerne | Akademikontrakt midt i etapeloeb fjerner rytteren uden varsel - 3 ryttere ramt i to igangvaerende loeb nu. |
| #452 | 4 | high | [feature] Tilmeld-knap til kommende sæson når manager ikke kan stille  | Tilmeld-knap ved sæsonskifte forhindrer at managers uden hold ryger ud af ligaen. Relevant til sæson-3-transition. |
| #543 | 4 | high | Feature: season_transition_paused admin-håndsving | Admin-håndsving til at pausere auto-transition — manuel SQL var eneste redning under incident 21/5. Sæson 3 slutter 27/9. |
| #1602 | 4 | high | [Epic] Mobil-optimering: luk de resterende huller (ikke en omskrivning | Mobil-huller (klip på 360px, touch-targets <44px) rammer spillere nu midt i sæson 3. |
| #1819 | 4 | high | Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup | Opfølgning efter præmie÷20: bekræft live-økonomi (etape-afslutning, break-even) er korrekt i sæson 3. |
| #2022 | 4 | high | [bug] Nyt holds bestyrelse dannes ufuldstændigt: ukalibrerede mål + in | Bug: nyt holds bestyrelse fejlkalibreret (uopnåelige mål) + ingen DNA-valg - rammer nye managers nu |
| #2164 | 4 | high | Aktivér nedrykning Division 3 → Division 4 (ingen nedrykning fra div 4 | Aktivér nedrykning Div3→Div4 - skal virke korrekt til sæson 3-overgangen 27/9 |
| #2457 | 4 | high | [balance] AI-holdenes rytter-kvalitet skal matche deres division (div  | AI-hold urealistisk stærke i Div 4 lige nu - ødelægger live sæsonoplevelsen. |
| #2650 | 4 | high | [balance/HØJ] Fatigue-mætning i hele populationen: AI-median 100, huma | Fatigue-mætning rammer S3-spillere nu (63% trænes med straf) - recovery kan ikke følge kalenderen. |
| #2789 | 4 | high | [balance] Sub-3 gap-model: 6 rute-huller fundet i adversarisk verifika | 6 gap-model-huller mod ægte rutedata - rammer live S3-etaper, oprindeligt flagget spiller-effekt. |
| #3145 | 4 | high | [investigation] Solo-enkeltstart: "ryttere ofres"/resultater opgives — | Ryttere 'ofres' i solo-enkeltstart - sandsynlig rolle-logik-bug i motoren, rammer nu. |
| #3353 | 4 | high | Re-fit riderValuationModelV4 mod den nye (caps-baserede) ryttertype-kl | Live markedsværdier hviler på midlertidig frysning; refit nødvendigt for korrekthed nu. |
| #3426 | 4 | high | [balance] Nedkørsel vejer for tungt: 30-50 sek tabt på korte nedkørsle | Nedkørsel vejer for tungt i motoren - fordrejer løbsresultater i indeværende sæson nu. |
| #3442 | 4 | high | [investigation/balance] Lønkrav ved forlængelse hoppede 3-4x efter ryt | Lønkrav ved forlængelse hoppede 3-4x uden evneændring - rammer spillernes økonomiplanlægning nu. |
| #3460 | 4 | high | [bug/balance] effort er ikke koblet til kaptajnens støtte — 'Spar kræf | 'Arbejd' er reelt en ren nedside vs. 'Spar kræfter' - ejer bekræftede selv fejlen, rammer alle nu. |
| #3624 | 4 | high | [investigation] Ejer-direktiv 10/8: løb starter ofte senere end det ti | Løb starter senere end vist tid - spillere oplever det nu, mål gabet før fix. |
| #3640 | 4 | high | [bug/comms] 'Over-22-rettelsen' 11/8 re-typede ogsaa 77 % af spillerne | Spillerspørgsmål om urimeligt typeskift ubesvaret i forum siden 11/8 - svar nu. |
| #3643 | 4 | high | [ux] Træningssiden på mobil: rework til langt højere standard (ejer-ma | Træningsside på mobil ubrugelig ('elendig') - ejer-mandat, rammer spillere nu. |
| #3803 | 4 | high | [ops] Post-merge #3798: backfill ability_caps + baseline-refit + issue | Post-merge #3798 udrulning: ability-cap-backfill rammer live rytterdata nu. |
| #3818 | 4 | high | [fair-play] Ugescan 17/8: 3 ensrettede handler mellem samme to hold, i | 3 ensrettede handler mellem 2 hold, 71x overbetaling - detektoren flaggede intet, live fair-play-hul |
| #3900 | 4 | high | Ejer-direktiv 17/8: voldsomt nemmere overblik over den kommende saeson | Ejer-direktiv: voldsomt bedre overblik over kommende loeb+ruter - hjaelper spillere planlaegge S3 nu |
| #3924 | 4 | high | [ux] Traenings-foelelsen: dagens kvittering + fremskridts-oejeblikke ( | Traenings-foelelse (dagens kvittering+milepaele) ejer-godkendt design - verificer om trin7-blokering stadig staar |
| #3957 | 4 | high | [bug] Assistentens auto-udtagelse matcher ikke loebsprofilen (bjergryt | Assistentens auto-udtagelse matcher ikke loebsprofil (bjergryttere til flad klassiker) - rammer travle spillere |
| #3966 | 4 | high | [investigation] Traeningsudbyttet opleves markant langsommere + broste | Traeningsudbytte foeles markant langsommere + brosten evt laast til let - live-rapport, kan vaere bug |
| #4001 | 4 | high | [bug] Akademi-salg prissaettes paa #3972's symbolske intake-vaerdi i o | Akademi-salg prissat paa symbolsk vaerdi op til 6 dage - deadline 23/8 er passeret, tjek status akut |
| #4033 | 4 | high | [economy] Akademi-upkeep kan undgaas ved oprykning lige foer saesonslu | Akademi-upkeep kan undgaas ved oprykning lige foer saesonslut - live exploit, ~40k besparelse |
| #4098 | 4 | high | [bug] Unge ryttere markeres 'done' ca. 65 point under eget maks-loft:  | Unge ryttere 'done' ~65 point under loft, 124/362 hold ramt - 4. rapport af samme modsigelse. |
| #4103 | 4 | high | Ejer-direktiv 21/8: kalender-audit S3 - typefordeling, brosten, enkelt | Kalender-audit S3: typefordeling, brosten, enkeltstarter, point vs. præmie pr. division - ejer-direktiv. |
| #4147 | 4 | high | [bug/HOEJ] Loebs-afslutning er ikke atomar - genstart efterlader halve | Løbs-afslutning ikke atomar - genstart midt i løb efterlader halve løb i DB, ramte S2-finalen. |
| #4148 | 4 | high | [perf] Loebsafvikling bruger 148.681 requests/time - profilér og batch | Løbsafvikling: 148k requests/time, 90-110s pr. afslutning - divisioner startede 45 min for sent. |
| #4160 | 4 | high | [perf] LCP 17s paa /dashboard, 14,7s paa /training - hovedindhold male | LCP 17s på /dashboard, 14,7s på /training - alle 10 sider 'dårlig', landingssiden værst efter login. |
| #4209 | 4 | high | GT-hviledage skal binde rytteren - anden halvdel af #4203 (blokeret af | GT-hviledage binder ikke rytteren, han tages til fyldløb i stedet - blokeret af #4191 |
| #4265 | 4 | high | Ejer-direktiv 25/8: bestyrelse og sponsorer skal adskilles i UI i saes | Ejer-direktiv: bestyrelse og sponsorer skal adskilles i UI i S3 - direkte spillerflade, kør nu |
| #4377 | 4 | high | [bug] Bestyrelsesmaal-taellere ignorerer historik: troejer staar 0/2 o | Bestyrelsesmaal-taellere (troejer, sponsor-indkomst, sejre) ignorerer historik - flere spillere rammer 0/N fejlagtigt. |
| #4419 | 4 | high | [economy] Vaerdier opdateres soendag kl. 06 i eget job - ikke kl. 22,  | Vaerdi-opdatering koerer stadig ved manuel traening siden 25/7 - modstrider ejer-beslutning 6/8, mulig udnyttelse. |
| #4449 | 4 | high | [economy] Taend markedsblendet soendag 6/9 med 15 % vaegt (ejer-go 30/ | Ejer-go 30/8: taend markedsblend soen 6/9 m. 15% vaegt - runtime laeser v1, skal opgraderes til v2-artefakt foer deadline. |
| #4484 | 4 | high | [bug] Graduerings-sweepet fejler hver aften: rytter med grad-raekke i  | Gradueringssweep fejlet 23x i traek natten 31/8; rytter laast fast pga. maybeSingle uden saeson-scope. |
| #4485 | 4 | high | [bug] Ungdomsklassementet inkluderer 26-aarige - raceRunner bruger wal | 4 spillere rapporterer 26-aarige i ungdomsklassement - raceRunner bruger forkert referenceaar fra seasons.start_date. |
| #4495 | 4 | high | [bug] Usolgt graduate-auktion efterlader rytteren fanget i akademiet - | 8 akademiryttere 22-23 aar sidder fast - graduate-auktion uden bud saetter aldrig is_academy=false. Rodaarsag til #4484. |
| #4499 | 4 | high | [monitoring] 50 JS-fejl paa Firefox/iOS i Clarity, 0 i Sentry: fronten | 50 JS-fejl paa Firefox/iOS usete i Sentry (0 fanget), rammer training/planning/races - kerne-flader blinde for fejl. |
| #1011 | 3 | med | Attribut-farver: darkmode-læsbarhed + toggle mellem farve-versioner | Flere spillere rapporterer dårlig dark-mode-læsbarhed på attribut-farver - rammer nuværende brugere. |
| #1818 | 3 | med | Økonomi-gates ignorerer 0c hale-ryttere: gen-kør #1441/#1606 med fuld  | Økonomi-gates modellerer kun 8-rytters kerne, ikke fulde 12-trup — kan undervurdere lønbyrde i kørende sæson. |
| #1925 | 3 | high | Follow-ups efter holdudtagelses-overhaul (#1924): help.json, trigger-v | Verificér DB-trigger for ghost race-entries er applied i prod + help.json-gap - kan ramme spillere nu |
| #1928 | 3 | med | [feature] Gør det tydeligt HVILKE ryttere der er holdets stjerne-/prof | Flere spillere forvirrede: kan ikke se HVEM deres stjerne-/profilryttere er - UX-gab ramt live |
| #2227 | 3 | med | [ux] /board høj dead-click-tæthed (480, 29/6-6/7) — element ser klikba | /board høj dead-click-tæthed (480/uge, Clarity) - friktions-bug, tjek om stadig aktuelt |
| #2230 | 3 | med | [ux/perf] Layout-shift (CLS) på core-sider — mål via Speed Insights +  | Layout-shift (CLS) på core-sider - mål ordentligt via Speed Insights (Clarity-data outlier-forurenet) |
| #2261 | 3 | med | [bug] "High profile"-markering rammer middelmådige ryttere (3½-4★) — p | High profile-flag rammer forkert, Star Signing-ambition useriøs. Live board-bug. |
| #2405 | 3 | med | [afklaring] Taktik tillader flere ryttere i samme rolle (fx breakaway  | Mulig taktik-regression live nu - afklar om multi-rolle-tildeling er tilsigtet. |
| #2818 | 3 | med | [bug] Endagsløb med rutedata lover point der aldrig uddeles — 266 løb  | 266 endagsløb viser evigt 'AT STAKE' — passage-motoren kører kun for etapeløb, løfte indfries aldrig. |
| #3153 | 3 | med | [fair-play] Community-flagget transfer 29/7: rytter til nyoprettet hol | Community-flagget transfer 29/7 mangler stadig svar; manuel review efter #3131-rammer. |
| #3329 | 3 | med | [bug] Division 1 har 6 løbsdage helt uden overlap — den eneste pulje i | D1 mangler design-tilsigtet overlap (6 af 28 dage); bobby2106 bekræfter det er utilsigtet. |
| #3410 | 3 | med | [bug] Rytter fremstod låst i holdudtagelsen uden kendt overlap-årsag ( | Ubesvaret spillertråd om rytter der virkede låst uden gyldig grund - mulig UI-bug. |
| #3455 | 3 | med | [ux] Vis rytterens træthed i taktik-/rollevalget, ikke kun på daglig t | Træthed mangler i taktikvalg - spillere skal skifte side for at tage kvalificeret valg, nu. |
| #3494 | 3 | med | [bug] Bestyrelsens 5-års-plan: sponsor-vækstmålet viser 0/8 — hverken  | Bestyrelsens sponsormål viser uforståeligt 0/8 - forvirrer spillere nu, del af Mandatet-epic. |
| #3543 | 3 | med | [investigation/balance] Udbruds-udvælgelsen er uigennemskuelig: 10+ fo | Udbrudsvalg opleves uigennemskueligt - forvirrer aktive spillere nu, evt. bare UI/forklaring-fix. |
| #3574 | 3 | med | [bug] Bestyrelsens bonus-tilbud: ekstra-målet er auto-opfyldt i samme  | Bestyrelses-bonus-ekstramål opfyldes automatisk uden handling - forvirrer spillere i aktiv sæson. |
| #3939 | 3 | med | [investigation] 148 (loeb,hold)-enheder under 6 entries trods fejlfri  | 148 loeb/hold under 6 entries trods fejlfri sweep - assignment-hul rammer live rostre nu |
| #3950 | 3 | med | [feature] Resultat-botten poster etape-resultater i divisionskanalerne | Resultat-bot skal poste top 5-10 i divisionskanaler - ejer-go 18/8, loefter live community-oplevelse |
| #3955 | 3 | med | [ux] Planning: loebs-info er for tynd - etapeprofiler inline + Availab | Planning-flade for tynd info: etapeprofiler inline + Available Riders hoejere op - core daglig loop |
| #3981 | 3 | high | [investigation] Forskydning mellem loebsresultat og digest-mail - spil | Forskydning loebsresultat vs digest-mail set 2 dage i traek - undergraver spillernes tillid til data nu |
| #3982 | 3 | med | [feature] Etapestriben fase 2: resultat-piller (top 5 + eget hold) eft | Etapestribe fase 2: resultat-piller + optakt - loefter allerede roste dashboard-flade i S3 |
| #4006 | 3 | med | [investigation] Done-markering vs Overview-mismatch + gammel form-rapp | Done-markering matcher ikke Overview i traening - to spillerrapporter, kraever runtime-verifikation |
| #4039 | 3 | high | [ux] Trin 7 fast-follow: daempet loft-visning forbi peak + scout-verdi | Dæmpet loft-visning + scout-verdikt på skrift - ejer-design godkendt 20/8, klar til byg. |
| #4105 | 3 | high | Ejer-direktiv 21/8: Terre di Toscana skal vaere et grusvejsloeb, ikke  | Terre di Toscana skal være grusløb ikke brosten - ejer-direktiv, kræver evt. ny grus-arketype. |
| #4119 | 3 | high | [bug] Solgt rytter forsvinder fra truppen mens han stadig koerer loebe | Solgt rytter forsvinder fra trup-visning mens han stadig kører løbet færdigt - præsentationsfejl. |
| #4128 | 3 | med | [investigation] Evne står stille under sit loft, og spilleren aflæser  | Evne står stille under loft, spiller læser aktuel værdi som loftet - display-forvirring, ikke datafejl. |
| #4150 | 3 | high | [infra] Watch paths + nedlukningsvindue: docs-commits redeployer backe | Watch paths mangler - docs-commits redeployer backend og river motoren ned midt i løb (3 af 5 var docs). |
| #4153 | 3 | high | [economy] season_payroll traekker ny-saeson-loen for ryttere der pensi | season_payroll trak S3-løn for 28 ryttere der pensioneredes i samme transition - 103.700 CZ$ i S2→S3. |
| #4211 | 3 | med | [bot] Invariant-audit: 1 kalender-brud, 0 constraint-form-brud, 2 øvri | Daglig audit finder dublet-marketlisting + 128 ryttere uden forankret anlæg lige nu i prod |
| #4259 | 3 | med | [ux] Planlaegning: intet ikon viser at en rytter allerede er udtaget t | Intet ikon viser at rytter allerede kører løb den dag - svært at planlægge nu hvor løb tæller som træning |
| #4263 | 3 | med | [ux] Rytterens vaerdi falder 240k paa to maaneder mens evnerne stiger  | Rytterværdi faldt 240k på 2 mdr uden UI-forklaring - spillere gætter og mister tillid til værdimodellen nu |
| #4271 | 3 | high | Ejer-direktiv 25/8: formpeaks skal vaere mere forstaaelige | Formpeaks skal være forståelige - ejer-direktiv, rammer spillere i den løbende sæson lige nu |
| #4282 | 3 | med | [guard] debt_within_ceiling: 2 hold over gældsloft - reelt brud eller  | 2 hold over gældsloft målt i prod - afklar om reelt brud eller forældet loft, påvirker live økonomi |
| #4341 | 3 | med | [ux] Peak-markoer mangler i holdudtagelsen - man kan kun se hvem der p | Peak-markoer mangler i holdudtagelsen - spillere kan ikke se hvem der peaker naar truppen vaelges. |
| #4342 | 3 | med | [feature] Vis paa traeningssiden om rytteren er udtaget til et loeb -  | Traeningssiden mangler loebs-/hviledage-kontekst - spillere gaetter paa hvem der skal belastes. |
| #4346 | 3 | med | [fair-play] Spilleren har ingen rigtig indgang til at anmelde en hande | Ingen reel anmeld-handel-indgang; ejer lovede knap paa enkelt handel - fair play-tillid i live saeson. |
| #4357 | 3 | med | [bug] loadEntrantsForRace har ingen ORDER BY - buildTeamContext's sids | loadEntrantsForRace mangler ORDER BY - goer re-simulering af live etaper raekkefoelge-afhaengig, billig fix. |
| #4374 | 3 | med | [bug] Rangliste: 'Squad strength' virker ikke (knud_r_flink 28/8) | 'Squad strength' paa ranglisten virker ikke - rapport for tyndt til rod-aarsag, kraever repro foerst. |
| #4382 | 3 | med | [docs/help] Bestyrelsens 3- og 5-aarsplan er udokumenteret: udsaettels | Bestyrelsens 3-/5-aarsplan er udokumenteret - flere erfarne spillere gaetter forgaeves i lang traad nu. |
| #4386 | 3 | med | [bug/ux] Kalender-cellen viser kun 4 etaper - D1 har i gennemsnit 5,0  | Kalendercelle viser kun 4 etaper - D1 har 5,0/dag i snit, saa 'normalen' er skjult bag +N more. |
| #4417 | 3 | med | [investigation] Markedsvaerdi staar uaendret i 14 dage selvom rytteren | Markedsvaerdi staar stille i 14 dage trods rytterudvikling - uafklaret mekanik, spilleren har spurgt foer. |
| #4489 | 3 | med | [investigation] Favorit/outsider-markeringen matcher ikke ratings - 11 | 4 spillere: favorit/outsider matcher ikke ratings, 11/13 loeb vundet af 'outsider'. Kraever undersoegelse foer fix. |
| #4500 | 3 | med | [ux/team] Dead-click-taethed paa /team er tilbage over #3188-niveau (0 | /team dead-click-taethed over #3188-niveau igen (0,78/session paa PC); regression, tidl. fix daekkede ikke rette elementer. |
| #1033 | 2 | low | UI/UX-beslutning: skal world/auktion/standings-headers sortere eller a | Dead-click-forvirring på sorterbart-udseende headers i live sider - lav-indsats UX-fix. |
| #1833 | 2 | low | [ux] In-game forklaring af rytter-evner + fysiologiske power-intervall | Manglende tooltip på power-intervaller forvirrer spillere nu (Discord-feedback). |
| #1979 | 2 | med | [ux] Omdøb/fjern forvirrende 'udbrud' (breakaway) etapeprofil-navn | Omdøb forvirrende 'udbrud'-etapeprofil-label - simpel tekstfix, ejer allerede enig |
| #2030 | 2 | low | [feature/ux] Race-kalender (trup-planlægning): auto-skift til næste ra | Race-kalender skifter ikke auto til næste racedag - ejer allerede positiv, lav risiko UX-fix |
| #2720 | 2 | med | [scouting] Rapport viser modstridende signaler: "Verdensklasse-emne" + | Scouting-rapport viser modstridende signaler + afskåret label - forvirrer spillere nu. |
| #2783 | 2 | med | [bug] grand_tour-arketypen kan give 2 eller 10 høj-bjergsetaper → GT'e | Grand tour HC-total udenfor realisme-bånd i 9,7% - rammer S3-ruters generering nu. |
| #2810 | 2 | med | [ux] Etapeprofil: kommende etape faar den lille graf, koert etape den  | Etapegraf: kommende etape (planlægning) får lille graf, kørt etape får stor — omvendt af behovet. |
| #3372 | 2 | med | [bug] Ungdoms-scoutrapport faldt drastisk, og TT står fast på 90% trod | Uafklaret om ungdoms-scoutfald er scout-tier-forklaring eller reel bug; kræver undersøgelse. |
| #3427 | 2 | med | [bug/mobil] Træthed kan stadig ikke SES i portræt på daglig træning —  | Træthed usynlig i portræt på mobil trænings-side; tidligere fix ramte kun sortering. |
| #3575 | 2 | med | [ux] Genforhandling af bestyrelsesplan: teksten lover en "reset", men  | Genforhandling lover 'reset' men board-requests forbliver låst - copy/info kommer for sent. |
| #3948 | 2 | med | [ux] Board-maalet 'Mindst 1 etapesejr' er tvetydigt: samlede sejre i e | Board-maal 'etapesejr' taeller ikke samlede endagssejre - tvetydig tekst forvirrer spillere nu |
| #4025 | 2 | med | [design] Oekonomisiderne: alt for meget tekst paa fladen - flyt manual | Oekonomisider har for meget tekst paa fladen - ejer vil have hurtigt overblik, manualer til Hjaelp |
| #4059 | 2 | med | [investigation] "0 skarpe dage" paa en del ryttere - forventet eller f | '0 skarpe dage' ubesvaret - afklar bug vs. forventet adfærd, forklar tælleren i UI. |
| #4097 | 2 | med | [ux] Vis potentiale-baandets midtpunkt saa sorteringen kan aflaeses (t | Vis potentiale-båndets midtpunkt - samme forvirring som #3787, spiller har selv regnet nøglen ud. |
| #4125 | 2 | med | [ux] Divisions-upkeep for andre divisioner kan ikke ses — oprykning ka | Divisions-upkeep for andre divisioner kan ikke ses - oprykning kan ikke prissættes af spilleren. |
| #4164 | 2 | med | [docs] Ubesvaret mekanik-spoergsmaal: giver 6 etaper paa én dag mere t | Ubesvaret spørgsmål: giver flere etaper/dag mere træning? Help.json mangler svar efter #4162. |
| #4262 | 2 | low | [feature] Auktioner: lad spilleren skjule de auktioner han er overbudt | Lad spiller skjule overbudte auktioner med X-knap - lille UX-oprydning, selv angivet lav prioritet |
| #4297 | 2 | low | [bug] Gennemfoert handel staar dobbelt i transfer-historikken paa rytt | Kosmetisk dobbelt-raekke i transfer-historik paa rytterprofil, ingen oekonomisk fejl. |
| #4387 | 2 | low | [ux] Kontrakt-udloebsbeskeden kan ikke lukkes og staar fremme hele sae | Kontrakt-udloebsbesked kan ikke lukkes hele saesonen - ejer har sagt ja i traaden, ren UI-fix. |
| #4414 | 2 | med | [bug] High Roller-achievement kraever bud > 2.000.000.000 CZ$ - copy l | High Roller-achievement kraever 2 mia. CZ$, copy lover 500k - triviel taerskel-fejl siden 25/7, let win. |
| #4415 | 2 | low | [ux] Forum paa mobil: citer/rapporter staar OVER indlaegsteksten og go | Forum paa mobil: citer/rapporter staar over indlaegsteksten - laesbarheds-polish. |
| #4487 | 2 | med | [ux] Etapetypen kan ikke ses paa mobil ved holdudtagelse + sprint/roll | Etapetype usynlig paa mobil ved holdudtagelse (kun hover); sprint/rolling deler billede, bjerg/hoejbjerg deler tekst. |
| #4490 | 2 | med | [ux] Etape-narrativet vises ogsaa i den samlede stilling, hvor det lae | Etape-narrativ vises fejlagtigt ogsaa i samlet stilling (GC), laeses som paastand om hele loebet. 2 spillere enige. |
| #4498 | 2 | med | [ux] 64 rage clicks paa 5 sessioner paa en enkelt rytterprofil (Clarit | 64 rage clicks paa 5 sessioner paa én rytterprofil (Stijn Bakker); 75 dead clicks samme side, ingen Sentry-fejl. |
| #4501 | 2 | med | [ux] /notifications er naesthoejeste rage-click-flade (16 af 17 paa de | /notifications naesthoejeste rage-click-flade (16/17 paa desktop), 658 sessioner/uge - hoej gennemstroemning rammes. |
| #2838 | 1 | low | routes: regionOf() giver spanske/generiske stigningsnavne til nederlan | regionOf() giver spanske stigningsnavne til nl/be-løb (Limburgse Klassieker); kosmetisk flavor-bug i kørende sæson. |
| #3174 | 1 | low | [board] Kompensation for #3095-rest: S2-ankeret (season_start_satisfac | Kun bestyrelses-tilfredshed for 6 hold, ingen penge/resultater; ejer-go 31/7 foreligger. |
| #4073 | 1 | low | [ux] Akademi-salg/afvis tæt på sæsonskiftet: stille skip uden feedback | Akademi-salg/afvis nær sæsonskifte giver stille skip uden feedback - rammer kun ~1 dag/sæson. |

## Penge og vaekst (49)

| # | V | Pri | Titel | Note |
|---|---|-----|-------|------|
| #1173 | 5 | high | Vækst/viralitets-loop: referral (del spillet med en ven) | Referral-viral-loop er størstre vækst-håndtag ifølge roadmap-spec, byg i fase 1. |
| #1369 | 5 | high | [Meta] Langsigtet CRO-loop — activation, retention, bounce og konverte | Langsigtet CRO/retention-loop — matcher kendt retention-håndtag (#2853). |
| #1569 | 5 | high | Ny-spiller onboarding-audit (2026-06-20) — prioriteret handlingsplan | Onboarding-audit med P0'er (CTA, signup-seam) der skræmmer nye spillere væk — direkte konvertering. |
| #2760 | 5 | high | [growth] Reaktiverings-e-mails (win-back) til dormante brugere + GDPR- | Win-back-mails til ~100 dormante brugere + GDPR-consent-audit FØRST - ejer-direktiv, høj ROI. |
| #2806 | 5 | high | [monetization] /pro er ikke linket fra appen, og isPro() gater ingen f | /pro er ikke linket nogen steder + isPro() gater intet. Sælger et usynligt mærkat til 49kr/md. |
| #2813 | 5 | high | [monetization] CZ Pro kan købes uden handelsbetingelser, opsigelsessti | CZ Pro sælges uden handelsbetingelser/fortrydelsesret/opsigelsessti — juridisk risiko ved aktivt abonnement. |
| #2824 | 5 | high | [fable] Synlighed udefra: login-vaeg, sprogstier og SEO er ét problem  | Hele appen bag login inkl. patch-notes/rules; Google kan kun indeksere forsiden. SEO-håndtag #4067 blokeret. |
| #3200 | 5 | high | [feature] Ejer-direktiv 3/8: spiller-til-spiller-beskeder i spillet (d | Ejer-direktiv: spiller-til-spiller-beskeder - kendt retention-driver, kun 25% på Discord. |
| #4005 | 5 | high | [billing] /pro foer aabning: 49 kr inkl. moms eksplicit + pro-rata-for | /pro: pris eksplicit inkl. moms + pro-rata-forklaring + copy-fejl - direkte foer monetarisering aabner |
| #4067 | 5 | high | [SEO] Offentligt Next.js-site (hybrid-split): marketing-lag, EN+/da/,  | SEO fase 1: offentligt Next.js marketing-site, EN+/da/ - kendt vækst-håndtag, kun forsiden indekseret nu. |
| #4074 | 5 | high | [billing] EN /pro viser kroner, men Alunta opkraever DKK for alle - eu | EN /pro viser DKK men Alunta trækker DKK for alle - blokerer checkout-flip, juridisk risiko på Terms. |
| #428 | 4 | high | [community] Fast ugentlig kommunikations-rytme (Man/Ons/Soen) - LOEBEN | Fast ugentlig kommunikations-rytme, ejer-mandat 22/8. Billigste retention-håndtag ifølge issuet selv. |
| #1140 | 4 | high | Strømlin ny-spiller-onboarding til ét sammenhængende flow (konsolidér  | Samlet onboarding-flow er direkte funnel/retention-løft før TdF-trafik rammer landing. |
| #1301 | 4 | high | SEO-fundament: cyclingzone.org skal kunne findes og rangere (epic) | SEO-fundament epic — kendt håndtag for synlighed/vækst (#4067). |
| #2161 | 4 | high | feat(auth): Log ind / opret bruger / connect med Discord (OAuth via Su | Discord OAuth login/signup - kun 25/96 har koblet Discord manuelt, OAuth låser role-sync+DM op for alle |
| #2441 | 4 | high | [discord] Nye medlemmer ser ikke kanalerne — skal selv finde dem manue | Nye Discord-medlemmer finder ikke #general - direkte tab af community-aktivering. |
| #2759 | 4 | high | [growth] Start Facebook-annoncer + organisk TikTok-markedsføring (ejer | Facebook-annoncer + TikTok - ejer-direktiv, direkte vækst-håndtag, kræver tekst/budget-godkendelse. |
| #2816 | 4 | high | [monetization] Checkout spærrer ikke for at købe CZ Pro to gange — abo | Checkout spærrer ikke dobbeltkøb af Pro; abo nr. 2 overskriver nr. 1 i DB — usynlig dobbeltbetaling. |
| #3451 | 4 | high | [feature] Ejer-direktiv 6/8: forum-søgning + markering af ulæste indlæ | Forum-søgning+ulæst-markering = retention-mekanik ejeren selv fremhæver. Ejer-direktiv 6/8. |
| #3796 | 4 | high | [growth] UTM-disciplin paa egne kanaler + 'Hvor hoerte du om os?' ved  | UTM-disciplin + 'hvor hørte du om os' - lukker 53% direct-mørke i attribution. |
| #4110 | 4 | high | Ejer-direktiv 21/8: sprogudvidelse - hvilke lande og sprog er relevant | Sprogudvidelse: hvilke lande/sprog + pris - ejer-direktiv, beslutningsgrundlag for vækst. |
| #4322 | 4 | med | [growth] AI-assistenter som maalt akkvisitionskanal: ChatGPT er allere | ChatGPT er allerede top-5 signup-kilde men umaalt som egen kanal - vigtig AI-attribution til vaekst. |
| #4370 | 4 | high | [bug] React #421 paa alle prerenderede ruter: Suspense-boundary opdate | React #421 hydration-fejl paa alle prerenderede landingssider - risiko for SEO/indeksering (#4067). |
| #415 | 3 | med | Discord community: world-class opsætning (epic/tracker) | Discord community-epic — allerede delvist live (fase 1+2). Retentions-kanal. |
| #425 | 3 | med | Discord: Auto-tildel Top-50 Manager-rolle (cron + Supabase-query) | Auto-tildel Top-50-rolle ugentligt — social proof driver retention. Kræver #verify-bot live først. |
| #427 | 3 | med | Discord: Annoncér Discord-link i CyclingZone UI + waitlist-mail | Annoncér Discord-link i UI+mails — direkte konverteringskanal for eksisterende spillere. |
| #479 | 3 | med | Mobile Performance optim for /founder-supporter waitlist (follow-up #3 | Mobile Lighthouse 78 (mål 90+) på waitlist — første touchpoint for nye brugere, mobile er 60-70% cold traffic. |
| #961 | 3 | med | Kontekstuel hjaelp: omraade-specifikt FAQ-link overalt (banner -> ikon | Kontekstuel FAQ-hjælp løfter onboarding/retention, konkret afgrænset scope. |
| #1299 | 3 | med | Dynamiske OG share-billeder via @vercel/og (etaperesultat-kort) — før  | Viral OG-share-billeder (@vercel/og) — 20/6-deadline passeret, tjek status/relevans før prioritering. |
| #1896 | 3 | med | Træning: synliggør hvad det koster ikke at træne selv (assistent-defau | 49% træner aldrig - synliggør tabt bonus, direkte engagement/retention-løft i løbende sæson |
| #2236 | 3 | med | Organic community outreach — Reddit + Discord posting | Organic community outreach Reddit+Discord - løbende vækst-tracker, ingen paid ads |
| #2761 | 3 | med | [onboarding] In-app indbakke-besked med Discord-invite til alle manage | Discord-invite i onboarding-indbakke - retention/community, ejer-direktiv. |
| #2820 | 3 | med | [monetization] /founder-supporter siger "betaling er ikke live" mens / | /founder-supporter siger betaling ikke er live, /pro tager imod betaling — modsigende copy + død venteliste. |
| #2884 | 3 | med | [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sen | Discord-ønske: længere auktioner + anti-snipe. 1-times-vindue gør ryttere usælgelige, risiko for churn. |
| #3104 | 3 | med | [Menu-audit] Rækkefølge efter faktisk brug + to ruter uden indgang — e | Ejer-godkendt nav-omstrukturering ud fra Clarity-brug; løfter discoverability/retention. |
| #3517 | 3 | med | [feature] Forum v1.1: ejer-direktiver 6-7/8 — citér-svar m. notifikati | Forum v1.1: citér-svar, emoji/links, DA/EN-split, signatur - ejer-direktiver, retention-feature. |
| #3733 | 3 | med | [ux] Soendags-kvittering paa vaerdien: spilleren skal kunne se HVORFOR | Søndags-kvittering på værdiændring - øger spillertryghed/retention, ren UI. |
| #3797 | 3 | med | [growth] GSC-data + konverterings-funnel per kanal i growth-dashboarde | GSC-data + konverteringsfunnel i growth-dashboard - kanal-beslutninger på tal. |
| #4111 | 3 | high | Ejer-direktiv 21/8: loefte-audit - har vi leveret paa alt vi har lovet | Løfte-audit: har vi leveret på 3-4 ugers løfter til spillerne - retention/tillid, ejer-direktiv. |
| #419 | 2 | med | Discord: Inviter Carl-bot + Dyno + konfigurér auto-mod | Invitér Carl-bot+Dyno, auto-mod/roller. Hurtig owner-handling, community-infra. |
| #426 | 2 | low | Discord: /mit-hold slash-command (embed spillerens hold) | /mit-hold slash-command som second-screen. Nice-to-have engagement, ikke kritisk. |
| #430 | 2 | low | Discord: Rekrutter 2 community-moderatorer | Rekrutter 2 moderatorer, gated bag ≥50 aktive medlemmer — sandsynligvis ikke nået endnu. |
| #431 | 2 | low | Discord: Planlæg første AMA (community Q&A) | Planlæg første AMA. Owner-drevet, god værdi men ikke tidskritisk. |
| #1182 | 2 | med | Verificér + slet ubrugte Railway Postgres + Redis (pleasing-spontaneit | Ubrugt Railway Postgres+Redis fakturerer uden funktion - hurtig omkostnings-besparelse. |
| #1888 | 2 | low | [feature] Auto-push patch notes til Discord når patch notes opdateres  | Auto-post patch notes til Discord - retention/community, overlapper evt. #2153 ny-server-migration |
| #2041 | 2 | med | investigation(analytics): Returning users stadig ~0 efter #1797 identi | Returning users stadig ~0 efter #1797-fix - verificér identify() i prod, retention-måling |
| #2153 | 2 | med | Ny Discord-server: division-routed resultat-kanaler + webhook-migratio | Ny Discord-server med division-routede kanaler - community/retention-infrastruktur |
| #2762 | 2 | med | [ux/help] FAQ: kategori-inddeling + navigation + oprydning af forældet | FAQ-kategorisering + oprydning - reducerer support-byrde, ejer-ønsket. |
| #3457 | 2 | med | [growth] Ejer-direktiv 6/8: hold /roadmap løbende opdateret — nye emne | Ejer-direktiv: hold /roadmap opdateret løbende (nye emner, fjern leverede/droppede). |

## Langsigtet infrastruktur og kvalitet (138)

| # | V | Pri | Titel | Note |
|---|---|-----|-------|------|
| #4159 | 5 | high | [guard] game_day-aksen maa aldrig kunne skrives skaevt igen: DB-trigge | game_day-aksen skal DB-trigger-sikres mod dobbeltbookinger - ramte 1.855 ryttere i S3, 2. gang (#1823). |
| #1464 | 4 | high | Forward-guard: test der fanger nye finance/enum-typer uden constraint- | Forward-guard mod P0-klasse (enum-insert uden constraint-migration) — forebygger nedbrud som #1463. |
| #2460 | 4 | high | [ops] Fjern setup-forhindringer én gang for alle + løbende proaktiv op | Ejer vil have setup-blokeringer fjernet permanent - samler #2409/#2228/#2423. |
| #2671 | 4 | high | [security] Forward-guard: RLS-policy-kaldte funktioner skal have EXECU | RLS/EXECUTE-forward-guard - har bidt 2x (42501-fejl), sikkerhedsklasse bør lukkes. |
| #2893 | 4 | high | [ops] Daglig sundhedsrapport paa projekt-ejet job_heartbeat — positiv  | Daglig sundhedsrapport på job_heartbeat — retter rodårsagen bag 9 dages cron-blindhed og dormant email/pro-features. |
| #2964 | 4 | med | [infra] Fuldt PR-preview: backend-preview pr. branch + DB-strategi — e | Fuldt PR-preview m. backend + DB-strategi — gentaget ejer-frustration, ejeren kan ikke klik-teste backend-ændringer før merge. |
| #3033 | 4 | high | perf(backend): verificér JWT lokalt i stedet for /auth/v1/user-kald pr | Verificér JWT lokalt i stedet for /auth/v1/user pr. request — var hovedlast i RAM-incident 26/7, forebygger gentagelse. |
| #3131 | 4 | high | [Epic] Financial Fair Play & Anti-Cheat — bevis, forebyggelse, detekti | Epic for anti-cheat; 3 hændelser på 2 mdr, alt fundet manuelt - forward-guards mangler. |
| #3799 | 4 | high | [ops] Balance-baselinen er 131 afvigelser skaev paa uroert main - gate | Balance-baseline 131 afvigelser skæv på main - gate kan ikke måle PR-effekt. |
| #4010 | 4 | high | Supabase-hærdning: realtime-MalformedJWT, sponsor-sweep, offset-pagine | Supabase-haerdning: JWT-fejl, sponsor-sweep, offset-paginering - 5-10x oppustet load paa kun 232 brugere |
| #4123 | 4 | high | [infra] Kalender-invarianter som CI-gate + gylden kalender-diff (forud | Kalender-invarianter som CI-gate + gylden diff - forhindrer stille kalenderfejl, forudsætning klar (#4121). |
| #4149 | 4 | high | [infra] Adskil race-motoren fra web-API'et i to Railway-services | Adskil race-motor fra web-API i to Railway-services - 5 deploys midt i heat ødelagde et løb (#4147). |
| #4176 | 4 | high | Ejer-direktiv 24/8: samle ALLE kalender-regler i én SSOT + gate dem, s | Ejer-direktiv: saml alle kalender-regler i én SSOT + gate dem - regler spredt over 6+ filer. |
| #4226 | 4 | high | [test] Preview-mocken kan ikke reproducere 'ingen aktiv saeson' - fals | Preview-mock kan ikke simulere 'ingen aktiv sæson' - falsk grønt i hele e2e-suiten dækker over rigtige prod-fejl |
| #4266 | 4 | high | Ejer-direktiv 25/8: SSOT-dokument for alle 10 kernefunktioner inden 1/ | SSOT for alle 10 kernefunktioner + hard rules for oprettelse/læsning; deadline 1/9 er lige om hjørnet |
| #4361 | 4 | high | [ops] CodeRabbit auto-reviewer doed siden 14/8 (10-stjerners-taerskel) | CodeRabbit doed siden 14/8 (10-stjerne-taerskel) - 292 PR'er merget helt urevideret, manuel trigger virker. |
| #323 | 3 | med | [epic] Verdensklasse AI/Ops setup mod 5.000-10.000 brugere | Epic-tracker for AI/Ops-skalering mod 5-10K brugere. Child-issues allerede fordelt. |
| #324 | 3 | med | [ops] Fase 0: gør AI/release baseline reel og verificerbar | Fase 0: retter reel driftMonitor-bug (squad-division-keys forkerte, violations fanges aldrig). |
| #413 | 3 | med | feat(i18n): Fase 4 — PatchNotes refactor + Privacy merge + Supabase em | i18n Fase 4: PatchNotes+Privacy+Supabase-emails. Understøtter EN-first vækststrategi, afhænger af Fase 3. |
| #519 | 3 | med | [refactor] Split backend/routes/api.js i domain routers uden adfærdsæn | Split api.js (6.100 linjer) i domain routers, adfærdsbevarende. Reducerer regressionsrisiko. |
| #520 | 3 | med | [refactor] Split AdminPage/RacesPage og fastlæg frontend vs backend da | Split AdminPage/RacesPage + afklar frontend/backend write-ownership. Sikkerhedsrelevant (RLS-model). |
| #605 | 3 | med | P0: AI World-Class v2 — token-friendly agent setup | P0 token-friendly agent setup, mål <15K tok Claude cold-start. Overordnet plan, flere delopgaver. |
| #691 | 3 | med | [ops] Full SUPABASE_SERVICE_KEY rotation — generate new key + sync all | Fuld service-key-rotation (sikkerhed). Kræver manuelt Supabase-dashboard-trin fra ejer først. |
| #708 | 3 | med | Supabase Data API explicit grants for new public tables | Supabase Data API grants for nye public-tabeller — håndhæves for eksisterende tabeller 30/10-2026. |
| #748 | 3 | med | Discord-token: rotation + lag D env-injection + lag B restart-verifika | Sikkerheds-followup; token-rotation kræver ejer-handling i Discord-portal før lag B kan verificeres. |
| #1199 | 3 | med | Natlig harness-vagt: kør gates mod prod-data på cron + rapportér drift | Nightly drift-vagt mod prod-data pr. cron; nyttig men ikke presserende nu. |
| #1270 | 3 | med | Session-hardening hooks: pre-push område-tests (D1) + dep-sync-vagt (D | CI-hooks-hardening (pre-push test, dep-sync, kollisionsvarsel) — reducerer tidsspild. |
| #1373 | 3 | med | [perf] Frontend: delt query-cache + risk-baseret optimistic/pending UI | Delt query-cache + optimistic/pending UI — performance-fundament post-launch. |
| #1374 | 3 | med | [perf] Targeted Realtime-invalidering: erstat broad loadAll-refetches  | Targeted Realtime-invalidering (auktion først) — erstatter broad loadAll-refetches. |
| #1528 | 3 | med | [AI-ops] A1: Autonomt selv-forbedrende burndown-loop (natbølge gjort s | Selvkørende natbølge-burndown-loop, ejer forbliver merge-gate — stort ai-ops-løft. |
| #2095 | 3 | med | [db] Fase 3: Supabase connection pooling (Supavisor) før horisontal sk | Supavisor connection pooling før skalering mod 250+/1000+ brugere - langsigtet infra, ikke akut ved 232 |
| #2101 | 3 | med | Opfølgning #2098: ability_progress-scoping + grant-audit forward-guard | ability_progress kolonne-scoping + grant-audit forward-guard, sikkerheds-opfølgning på #2098 |
| #2270 | 3 | med | [ci] Natlig game-day smoke-sim: fuld pipeline-test (kalender->startlis | Nyttig CI-nattest for pipeline-fejl, men ikke akut for aktiv sæson. |
| #2409 | 3 | med | [ops/DX] Permanent headless Railway-MCP-adgang (token i Infisical, ing | Headless Railway-adgang løfter agent-verifikationsevne løbende. |
| #2415 | 3 | med | Gap-realisme-scorecard: målbånd for tids-gab (etape-margener + slut-GC | Gap-realisme-scorecard er ren måling/harness, ingen live-ændring. |
| #2423 | 3 | med | [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, ske | CSP-håndhævelse + Vercel-hardening er sikkerhed/infra, ikke sæsonkritisk. |
| #2511 | 3 | med | [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forb | Bundle-drift på main ubevogtet - perf-gate hul, ikke sæsonkritisk. |
| #2635 | 3 | med | [hardening] Harness-skema-drift ud over pending_team_id: loan_agreemen | Harness-skema-drift giver falsk tryghed i tests - tech debt værd at lukke. |
| #2758 | 3 | med | [ops/rutine] Faste rutiner: Discord-triage → GitHub-issues (dagligt) + | Ejer-ønsket fast rutine Discord-triage+done-audit - matcher denne housekeeping-skill selv. |
| #2901 | 3 | med | [security] REVOKE anon/authenticated-grants paa 47 RLS-laaste tabeller | REVOKE anon/authenticated på 47 RLS-låste tabeller uden policies. Ingen aktiv lækage i dag, men skriveret som eneste spærring. |
| #2923 | 3 | med | Marked-/auktionsfrys som app_config-flag (bruges ved hvert skifte og v | Marked-/auktionsfrys som app_config-flag — bruges ved hvert sæsonskifte og incidents, relevant før 27/9. |
| #3069 | 3 | high | [bot] Feature-liveness audit fandt 6 drift-finding(s) | Feature-liveness-bot fandt 6 migration-drift-fund 30/8 (applied migrations mangler i repo) — meget fersk, forward-guard-hul. |
| #3112 | 3 | med | [ops] Parallel session slettede ucommitteret arbejde i delt checkout — | Proces-guard for delt checkout mangler stadig; kan ramme igen ved parallelle sessioner. |
| #3139 | 3 | med | [fair-play/H] Sanktionstrappe, sagsskabelon og spiller-vendte fair pla | Sanktionstrappe + player-facing regler; to sager håndteret ad hoc uden fælles skabelon. |
| #3233 | 3 | med | [fair-play] Sanktioner skal arkivere frem for hård-slette — cascade-sl | Cascade-sletning ødelagde beviser i #2776-sagen; arkivering før sletning mangler stadig. |
| #3422 | 3 | med | [design] 618 unicode-pile bruges som ikoner — anti-slop-guarden fanger | 618 unicode-pile omgår anti-slop-guarden og vokser (+59/12 dage); guard-hul, ikke fanget. |
| #3430 | 3 | med | [infra/preview] preview-mock kan ikke nå logget-ind-sider — ingen Supa | Preview-mock kan ikke teste logget-ind sider; underminerer 'test-før-live'-kravet. |
| #3436 | 3 | med | [ops] Balance-interne tal må ikke lande i offentlige issues — repoet e | Interne balance-tal lækkede i offentligt issue 5/8; ingen regel/sted forhindrer gentagelse. |
| #3453 | 3 | med | [bug] Ejer-direktiv 6/8: /admin/growth er ikke opdateret til dagsdato  | /admin/growth viser ikke dagsdato - ejer-direktiv, skal opdateres automatisk. |
| #3486 | 3 | med | [ops] VERCEL_TOKEN i Infisical + Vercel CLI — gør forbrug/alarmer læsb | VERCEL_TOKEN i Infisical låser op for forbrug/alarm-synlighed - 2 issues stået stille 6+ uger. |
| #3501 | 3 | med | Økonomi: end-to-end audit + forbedringsforslag (kør EFTER 9/8-merge af | Økonomi end-to-end-audit - ventetid (efter 9/8-merge) er overstået, kan køres nu. |
| #3511 | 3 | med | [perf] /api/board/status: ~20+ ukachede queries pr. dashboard-load (ko | /api/board/status: 20+ ukachede queries pr. load - koordinér med board-rework-sessionen. |
| #3515 | 3 | med | [refactor] Board-modul kode-arkæologi + konsolidering (Mandatet fase 0 | Board-modul kode-arkæologi/konsolidering - ejer-krav 15/7, forudsætning for Mandatet fase 1-2. |
| #3556 | 3 | med | [ci/quality] Merge queue paa main + flake-karantaene som data (verdens | Merge queue på main + flake-karantæne som data - ejer-godkendt CI-kvalitetsløft 8/8. |
| #3625 | 3 | med | [ops] Ejer-direktiv 10/8: fast rutine der efterkontrollerer patch note | Fast rutine for patch notes+roadmap-sync - ops-automatisering, ikke akut. |
| #3748 | 3 | med | [ops] Rytterudviklings-scorecardet er ikke en gate - modellen kan driv | Rytterudviklings-scorecard er ikke CI-gate - balance-model kan drive usporet. |
| #3977 | 3 | med | [ops] Revurdér PITR (minut-gendannelse) når spillet får omsætning | PITR revurderes naar spillet tjener penge - trigger ikke naaet, hold oeje paa /pro-lancering |
| #4015 | 3 | med | [perf] Request-budget pr. spiller som grundlag for compute-sizing | Request-budget pr. spiller til compute-sizing - afhaenger af #4010, undgaar praematur opgradering |
| #4016 | 3 | med | [ops] Maskinlæsbart session-claim + worktree-tvang for agenter | Maskinlaesbart session-claim + worktree-tvang - forebygger gentaget delt-checkout-fejlklasse (5 bid) |
| #4129 | 3 | high | Sæsonskifte-guarden kører på et gæt: season_transition_planned_at bliv | season_transition_planned_at sættes aldrig, guard kører på gæt - ramte 1,5t for tidligt ved cutover. |
| #4188 | 3 | med | [collab] Delt dev-miljoe + invitér hjaelpere som collaborators | Delt dev-Supabase + collaborator-onboarding; forudsætning for at hjælpere kan bidrage |
| #4196 | 3 | med | [guard] balance:check taeller 98 afvigelser paa main men er advisory - | balance:check er reelt rød (98 afvigelser) men kun advisory i CI - baseline rådner ubemærket |
| #4197 | 3 | med | [guard] race:gate:routes er permanent roed - longDayEnduranceLift-baan | race:gate:routes fejler på 28% af seeds fordi et bånd står præcis på middelværdien - CI-guard upålidelig |
| #4214 | 3 | med | [ops] Infisical machine identity, saa prod-scripts kan koeres uden int | Infisical machine identity så prod-scripts kan køre uden interaktivt browser-login |
| #4215 | 3 | med | [guard] Kalender-scorecardet skal koere automatisk i CI + saesonskifte | Kalender-scorecard skal køre automatisk i CI + sæsonskifte-preflight, kun manuelt i dag |
| #4216 | 3 | med | [ops] Saesonskifte som EET gated flow i stedet for seks loese scripts | Sæsonskifte er 6 løse manuelle scripts uden samlet rækkefølge - én gated flow mangler |
| #4221 | 3 | med | [process] Hard rule: SSOT-dokumenter SKAL laeses og citeres - et ubesl | Hard rule: SSOT skal læses og citeres - proces-regel efter gentagne rapporterings-fejl 25/8 |
| #4254 | 3 | med | [ssot] Tolv regler uden for kalenderen er aendret uden at SSOT fulgte  | 12 regler ændret uden SSOT-opdatering; hard rule 30-gæld voksede sig til en reel fejl-rapportering |
| #4267 | 3 | high | Ejer-direktiv 25/8: masterplan end-to-end + GitHub-cleanup + hard rule | Masterplan end-to-end + GitHub-cleanup + dublet-tjek-regel; denne housekeeping-kørsel udfører del af det |
| #4269 | 3 | high | Ejer-direktiv 25/8: fast daglig rutine der tjekker Supabase for proble | Daglig automatisk Supabase-sundhedstjek ønsket af ejeren - ops-automatisering, ligner #4211-botten |
| #4288 | 3 | med | [guard] GT-baandet kraever 21 etaper - S3's tre Grand Tours koerer 17- | GT-realismebånd kræver 21 etaper, S3's GT'er kører 17-18 og er derfor umålte - båndet er forældet, ikke kalenderen |
| #4327 | 3 | med | [refactor] Typet Supabase-klient i backend (vejen til at pensionere sc | Typet Supabase-klient i backend fanger skema-fejl i editoren, kan paa sigt afloese schema-column-guard. |
| #4352 | 3 | med | [ops/LAV] Frontendens API-kald fejler tavst - en fejl der rammer hver  | 242 tavse frontend-API-fejl-steder, kun 1 tjekker 401 - en fejl der rammer hver gang ser usynlig ud. |
| #4367 | 3 | med | [db] Forward-guard: riders.team_id maa ikke aendres uden matchende rid | Forward-guard mangler mod team_id-aendring uden ejerskabsevent - samme fejlklasse som #4213 kan genopstaa. |
| #4463 | 3 | high | [guard/HOEJ] calendar-invariant-audit gik groen uden at maale noget -  | tee maskerer parser-fejl - calendar-invariant-audit rapporterer groent uden at maale noget; niveau 3 er blindet. |
| #4496 | 3 | med | [ops] CI-vagt: .maybeSingle() uden fuldt UNIQUE-scope (prototype faerd | CI-vagt-prototype mod .maybeSingle() uden fuldt UNIQUE-scope er klar (4/4 traef, 0 falske positiver) - samme fejlklasse som #4484/ |
| #78 | 2 | low | [Automation] Scheduled memory-konsolidering (ugentlig) | Ugentlig scheduled memory-konsolidering — nice-to-have automation, ingen spiller-effekt. |
| #306 | 2 | low | [obs] Instrumenter resterende ~10 events fra #137 scope | Resterende ~10 analytics-events fra #137-scope. Observability-gap, ingen spiller-effekt. |
| #355 | 2 | low | AI Ops: Disconnect 7 ubrugte MCP-connectors (~2.5K tok) | Disconnect 7 ubrugte MCP-connectors, ~10 min, sparer ~2K tok/cold-start. Needs-user-action. |
| #414 | 2 | low | chore(i18n): Fase 5 — lint-guard + docs + retro | i18n Fase 5: lint-guard+docs+retro, polish efter Fase 4. |
| #621 | 2 | low | [ops] Sentry hardening backlog — efter #348 baseline | Sentry hardening-backlog (menu, ikke alt-på-én-gang). Discord-alert ved prod-errors er billig quick win. |
| #658 | 2 | low | chore(ops): Schedule check-agent-token-hygiene.ps1 as local cron (Wind | Scheduled token-hygiejne-check via Windows Task Scheduler — automatiserer eksisterende manuelt script. |
| #720 | 2 | med | [security] Verificér disk-kryptering på PC3 (DolmerPC) før produktions | Verificér diskkryptering på DolmerPC (prod-adgang via Infisical/deploy-tokens). Hurtig sikkerhedscheck. |
| #722 | 2 | low | [DX] Discord-MCP setup fuldt non-interaktivt på frisk PC (autonom Rail | Discord-MCP-setup fejler stille på frisk PC ved railway link. DX-friktion, ikke spiller-vendt. |
| #723 | 2 | low | [DX] bootstrap-pc.ps1: installer gitleaks via Scoop (robust pre-commit | Installer gitleaks via Scoop i bootstrap — lukker fallback-bug #717 ved roden. |
| #724 | 2 | low | [DX] Ét verify-setup.ps1 med samlet grøn/gul/rød-verdikt (MCP + secret | Samlet verify-setup.ps1 med ét grøn/gul/rød-verdikt for PC-klarhed. DX-konsolidering. |
| #904 | 2 | med | [chore] Migrér preview/dev til Supabase publishable key (luk legacy ba | Luk legacy-Supabase-key-band-aid i preview/dev, sikkerhedsgæld siden juni - verificér status først. |
| #908 | 2 | low | R2 v1.1: akse-1 ratio-editor for master-ankre (pointtrøje = X% af etap | Admin-værktøj (ratio-editor) til præmiemodel, ikke spiller-vendt, additivt uden migration. |
| #1294 | 2 | low | Race-motor test-værktøjer: seed-variation i preview (flere udfald) + p | Test-tooling til race-preview (seed-variation + kørte løb), understøtter fremtidig kalibrering. |
| #1341 | 2 | low | [AI-ops] AI Council → Claude-only: Manus udfases + ny kanal/model/reds | AI-kanal/model-matrix-omskrivning — delvist dækket allerede via AI_CHANNEL_ROUTING.md. |
| #1375 | 2 | low | [perf] Performance-arkitektur — eksekverings-tracker (spec 2026-06-13) | Paraply-eksekveringstracker for performance-arbejdet, ingen selvstændig handling. |
| #1450 | 2 | low | [ops] Vercel Secret Sync via Infisical App Connections (single source  | Infisical→Vercel secret-sync — kræver præcis first-time key-mapping for at undgå at vælte prod. |
| #1857 | 2 | low | [enhancement] Race-sim reproducerbarhed: snapshot rytter-betingelser ( | Snapshot af rytter-betingelser til bit-identisk re-simulering af afviklede løb. |
| #2480 | 2 | low | Motor-ops: ML-assisteret kalibreringsforslag fra live drift (systemet  | ML-kalibreringsforslag er fremtidig ops-tooling, ikke akut. |
| #2669 | 2 | low | [chore/balance] Migrér 7 offline-harnesses fra v3- til v4-værdimodelle | 7 offline-harnesses regner stadig i v3-skala - tech-debt, ingen direkte spillerpåvirkning. |
| #2684 | 2 | med | AI-audit 19/7: drift-vagt-hærdning (prefix-match + snapshot-staleness- | Drift-vagt prefix-match + harness-re-måling, afhænger af #2679-status. |
| #2685 | 2 | med | AI-audit 19/7: ny skill /close-out — kodificér 6-trins session-afslutn | /close-out-skill findes ikke i dag i skill-listen - stadig relevant hvis done-flip glemmes. |
| #2686 | 2 | low | AI-audit 19/7: skills-bølge 2 — /patch-notes, /balance-sim, /night-wav | Skills-bølge 2 (/patch-notes,/balance-sim,/night-wave) findes ikke i dag - lav prioritet. |
| #2687 | 2 | med | AI-audit 19/7: PostToolUse-hook — eslint på frontend-edits (forebygger | PostToolUse eslint-hook på frontend-edits forebygger #2044-klassen. |
| #2738 | 2 | med | Boot-kørte ops-alarmer mangler persisteret dedup (samme spam-risiko so | 3 boot-kørte ops-alarmer mangler persisteret dedup som #2730 fik - spam-risiko ved restart. |
| #2749 | 2 | low | [Investigation] S1 prize-overbetaling: 40,7M udbetalt vs 35,98M payabl | S1 prize-overbetaling 4,7M - historisk data-drift, blokerer ikke, undersøg roligt. |
| #2751 | 2 | med | Season-standings: NULL league_division_id (test/frosne konti) eksklude | NULL league_division_id kan give tavs fejl ved næste season-end - fix før 27/9. |
| #2823 | 2 | low | [fable] Fleet-playbook: hvordan vi bruger Claude til at bygge verdensk | Fable-opgave: playbook for AI-fleet-arbejde ud fra 117-agent-audit 23/7. |
| #2960 | 2 | low | React 19 + React Router 8 — lukker den sidste allowlistede advisory (G | React 19 + React Router 8 lukker sidste allowlistede advisory (RSC-CSRF); appen er ren SPA, lav reel risiko. |
| #2990 | 2 | med | refactor(teams): migrer de 10 resterende menneske-hold-queries til hum | 10 resterende queries bruger ikke humanTeamFilter — samme spørgsmål giver 3 forskellige svar (156/159/161 hold). |
| #2997 | 2 | med | Spis de 170 droppede Supabase-errors ned (baseline fra #2897-guarden) | 170 droppede Supabase-errors (baseline-ratchet) — rodårsag bag 3 tidligere bugs (#2861,#2898,#2877). |
| #3024 | 2 | med | [security/docs] Vite-dev-serveren serverer import.meta.env i hvert mod | Vite dev-server eksponerer import.meta.env (anon-key) i hvert modul — ny secret-leak-vektor, bør dokumenteres. |
| #3121 | 2 | low | [opfølgning #3013] Mål matview-lockens effekt i prod og beslut om Vej  | Kun måling+beslutning tilbage; Vej 1 er allerede live og verificeret uden fejl. |
| #3204 | 2 | low | [bot] Perf & SEO inbox (rå) | Automatisk bundle/SEO-scan; kun 1 gul advarsel (JS 105% af budget), SEO er grøn. |
| #3421 | 2 | low | [quality/guard] Mikro-typografi-reglen fra #2849 har ingen guard — dri | Mikro-typografi-guard mangler stadig; kun 1 tilbagefald indtil videre, let at rette. |
| #3424 | 2 | low | [design] Elevation-restlisten fra #2849: dashboard-idiomer, sparkline- | Meta-indeks for elevation-restliste; de fleste punkter er allerede sporet andetsteds. |
| #3438 | 2 | med | [fair-play/G-opfølgning] Efter #3138: ugescan, whitelist-seeding, tærs | Driftsrester efter #3138: ugescan-nedlæggelse, whitelist-seeding, tærskel-review udestår. |
| #3487 | 2 | low | [infra/SEO] Bot-flade: mål AI-crawler-andel (ai_bots log-mode) + luk s | Mål bot-andel af trafik + luk soft-404-hul før robots.txt-beslutning. Post-launch, lav akut effekt. |
| #3596 | 2 | med | [db-health] Disk-IO/performance tærskel-brud | Automatisk db-health: slow query + høj temp-forbrug pr. kald - ops-hygiejne. |
| #3633 | 2 | med | [chore] Slet #3570-backuptabellerne naar rollback-vinduet lukkes | Slet #3570-backup-tabeller når rollback-vindue lukker - data-sikkerhedshygiejne. |
| #3711 | 2 | med | [ops] cross-pc-sync har ingen oprydning: 2,8 GB og 9.777 transcript-fi | OneDrive-transcripts vokser 700MB/md uden oprydning - 2,8GB, ops-gæld. |
| #3777 | 2 | med | [proposals-drift] Forslag er anvendt i prod uden at være forfremmet | Anvendte SQL-forslag ikke forfremmet fra proposals/-mappen - SSOT-hygiejne. |
| #3938 | 2 | low | [refactor] race_entries: raceRunner-autofyld + distribution-regenerate | race_entries: flere skrivere burde bruge samme RPC - refactor, ingen doedvande i dag saa ikke akut |
| #4241 | 2 | med | [ops] Collab-gaten skal kun ramme andre end ejeren - bypass via rulese | Collab-gate rammer reelt ikke ejeren (enforce_admins=false); ruleset fjerner kun eget klik-friktion |
| #4292 | 2 | low | [ci] Playwright Smoke fejler 1 af 560 - men en NY test hver gang. Fire | CI-flake, ikke kode-regression - fire forskellige tests fejler paa fire koersler, miljoestoej. |
| #4364 | 2 | low | [ops] NOW.md og MASTERPLAN.md ligger paa deres token-lofter - hver ny  | NOW.md/MASTERPLAN.md paa token-loft - hver ny note kraever oprydning foerst, rammer to gange paa to dage. |
| #4424 | 2 | low | [ci/flake] season-start-guide 'dismissing the guide hides it' timeoute | Flaky mobile-webkit test i season-start-guide - bekraeftet flake ved isoleret gen-koersel, ikke regression. |
| #4433 | 2 | low | [hardening] deriveForRiderIds kan saenke en optraenet rytters evner hv | deriveForRiderIds kan nulstille traenet rytter hvis gate svigter - defensiv hardening, ingen kendt trigger. |
| #4448 | 2 | low | [refactor] Konvertér de 7 parameter-drevne exhaustive-deps-disables ti | 7 param-drevne deps-disables mangler useCallback-sikkerhed; kun dok i dag, ingen runtime-advarsel ved drift. |
| #4452 | 2 | low | [security] Rate-limiterne bruger in-memory store — kræver delt store f | In-memory rate-limit-store skalerer ikke ved >1 Railway-instans; ingen prod-problem nu, kun forudsaetning for skalering. |
| #4453 | 2 | med | [ops] Backendens Railway-logstrøm har ingen vagt — 25 strukturerede si | Ingen vagt paa backend Railway-logstroem; 25 strukturerede [tag]-signaler (fatal, auth, rate-limit) gaar uset. |
| #4465 | 2 | high | [guard] calendar_monument_exclusive_game_day haandhaever en regel ejer | Guard haandhaever monument-regel ejeren ophaevede 26/8 (#4236); CI roed 3 doegn af en regel der ikke findes laengere. |
| #4479 | 2 | med | [guard/HOEJ] ECONOMY_RULES lover en loensats-paritetstest der ikke fin | ECONOMY_RULES lover salaryRateParity.test.js der ikke findes; loensats kan drifte frit mellem frontend/backend. |
| #4493 | 2 | med | [dx/security] sanitize-secrets: STORT_VARIABELNAVN=<hex> giver falsk p | sanitize-secrets falsk positiv paa STORT_NAVN=hex (fx commit-SHA); blokerer tool-output uden reelt secret. |
| #739 | 1 | low | Adopt a stable Node version strategy for Windows development | Node-version-strategi til dev-maskine - ren tooling-hygiejne, ingen spillerpåvirkning. |
| #1466 | 1 | low | Repeatable rehearsal-provisioning harness (skema-spejl + seed + nøgler | Rehearsal-provisioning-harness — eksplicit lav prioritet i issuet selv. |
| #2259 | 1 | low | [chore] Supabase DB-hygiejne: ryd ~20 backup_*-tabeller + covering-ind | DB-hygiejne: ~20 backup_*-tabeller + unindexed FKs, INFO-niveau housekeeping, ejer-go krævet før drop |
| #2857 | 1 | low | [hardening] CYCLINGZONE-37: NOTIFY pgrst i sunday-intake-drip-migratio | Sentry-hardening: manglende NOTIFY pgrst i migration-fil + valgfri PGRST205-retry. Benign, allerede self-healed. |
| #3010 | 1 | low | [feature] Prologer mangler eget distance-bånd — WT_DISTANCE_BANDS.itt  | Prolog-distancebånd mangler; markerer designet 6km-prolog som outlier, men gater ikke i dag (kun advisory). |
| #3839 | 1 | low | [ops] Staging-miljøet staging-3746-trin7: levetid + oprydningsliste (k | Staging-miljoe koster ~2kr/doegn - oprydningsliste klar, lukkes naar trin7 er afgjort |
| #4115 | 1 | low | [cleanup] a_floor_shift er et dødt config-felt — læses ikke af nogen k | a_floor_shift er et dødt config-felt, læses aldrig - fjern for at undgå fremtidig stille-forkert fejl. |
| #4240 | 1 | low | Afklar em-dash-reglens scope: memory siger universelt, CI haandhaever  | Modstrid: memory siger em-dash forbudt overalt, CI håndhæver kun player-copy - afklar scope |
| #4505 | 1 | low | [ci] Konsolidér de ti ikke-required statiske guards i eet job (udskilt | Konsolidér 10 ikke-required CI-guard-jobs i ét job; sparer ~2-2,5 min runner-tid, ikke feedback-tid. |

## Store produktloeft (verdensklasse) (87)

| # | V | Pri | Titel | Note |
|---|---|-----|-------|------|
| #2000 | 5 | high | EPIC: Verdensklasse rework af rytter-siden (nye 1-99-evner, P/M/T, rat | EPIC: verdensklasse rytterside-rework (1-99-evner, rating, hover) - flagskibs-produktløft |
| #2492 | 5 | high | [epic] Tre-tier klubstruktur: Senior/U23/Junior med egne kalendere (ad | Tre-tier klub-epic er ejer-låst 16/7, fundamentalt for langsigtet roadmap. |
| #2768 | 5 | high | [Epic] Verdensklasse løbsmotor — virkelighedstro ruter, dybe konkurren | Epic verdensklasse løbsmotor (ruter/konkurrencer/præsentation) - kerne-søjle jf. doktrin. |
| #3395 | 5 | high | [Epic] Verdensklasse-planen 2026-08: løbsdagen som teater + levende pr | Verdensklasse-epic, ejer-godkendt; bølge 1 leveret, videre bølger driver produktløft. |
| #3709 | 5 | high | [design] Rytterudvikling og traening: taget og raten skilles ad — 13 e | Rytterudvikling/træning redesign - 13 ejer-beslutninger, trin 1 allerede merget. |
| #3855 | 5 | high | [design] Race engine v4: intra-etape-motoren — etapen beregnes underve | Race engine v4: etape beregnes undervejs - fundament for fremtidige planer, ejer-retning 17/8 |
| #1997 | 4 | med | Verdensklasse historik/palmares (rytter + hold) — design + build | Verdensklasse historik/palmares rytter+hold - stort editorial løft, kræver design-slice først |
| #3087 | 4 | med | [planner etape 3] Mål-løb-modellen: markér de løb du vil vinde, assist | Planner etape 3: mål-løb-model (top-down planlægning). Ejer-godkendt 27/7, stort produktløft. |
| #3350 | 4 | high | [produkt] Spillerne gætter på reglerne — fire testere byggede fire pri | Spillere gætter/bygger private modeller på reglerne; stort UX/transparens-løft af reglerne. |
| #3513 | 4 | high | [epic] Dashboard-rework: Sportsforsiden — fast rygrad + spillerens wid | Dashboard-rework 'Sportsforsiden' - stor ejer-godkendt epic, sportsforside + widget-board. |
| #3659 | 4 | high | Ejer-direktiv 13/8: goer udvikling, traening og lofter forstaaeligt i  | Gør udvikling/træning forståeligt i UI - ejer vil have UX-forslag først. |
| #3660 | 4 | high | Ejer-direktiv 13/8: UX-gennemgang af hele siden — kan spilleren stole  | UX-gennemgang: kan spilleren stole på UI'et - ejer-direktiv, stort scope. |
| #3664 | 4 | high | [design] Rating-fundamentet v3: én skala, vægtet snit af rollens evner | Rating vises i to skalaer samtidig - v3-design klar, stort tvær-system-arbejde. |
| #4109 | 4 | high | Ejer-direktiv 21/8: Planlaegning-fladen - for mange faner og klik, ant | Planlægning-fladen: for mange faner/klik, anti-AI-slop-gennemsyn - ejer-direktiv, design før kode. |
| #4122 | 4 | high | [design] Forfattede loeb: de loeb der baerer identitet skal kunne skri | Forfattede løb: monumenter/grand tours skal skrives ned, ikke udledes af generator-konstanter. |
| #4246 | 4 | high | [design] Rolle og ordre siger det samme: hunter vs try_break skal afgo | hunter/try_break-modsigelse skal afgøres FØR TeamOrder fryses i race engine v4 - tidskritisk |
| #26 | 3 | low | [feature] Transfer war-room (shortlist + sammenligning + budget-foreca | Transfer war-room: shortlist+sammenligning+forecast. Stort scope, allerede priority:low. |
| #62 | 3 | low | [Epic] Today / Manager Inbox — hvad skete, hvad ændrede sig, hvad kræv | Epic/visionsdokument for Today/Inbox — konvergenspunkt, ikke selv en implementerbar opgave. |
| #91 | 3 | med | [Feature] Race Day Live-ticker | Race Day Live-ticker, ~2 sessioner. Løfter kerneoplevelse men er feature, ikke fejl. |
| #938 | 3 | med | Global søgefunktion — søg på tværs af ryttere, hold, løb og managers | Global søgning løfter usability for nye brugere, afgrænset scope, kræver backend-valg. |
| #954 | 3 | med | [Epic] Transparens-hub: Changelog / Patch notes / Roadmap (+ voting &  | Transparens-hub (changelog/patch notes/roadmap+voting) - stor UX-omlægning, høj label-prioritet. |
| #1106 | 3 | med | Multi-sæson visning: rangliste/historik/kalender på tværs af sæsoner ( | Multi-sæson-visning skal stå klar før flere sæsoner ophober sig - infra-løft. |
| #1147 | 3 | med | [Epic] Living World feed — results, transfers, breakthroughs, rivalrie | Living World-feed løfter engagement/retention via offentlig historiestrøm om andre hold. |
| #1310 | 3 | med | Markeds-pakke fast-follow: system-bølger, AI-bud, uopfordrede bud, for | Markeds-pakke (system-bølger, AI-bud) — sæson-1-deadline for forlængelses-UI passeret, tjek status. |
| #2009 | 3 | med | Slice 5: Hover mini-profil (FM-stil, genbrugskomponent) | Slice 5 af EPIC #2000: FM-agtig hover mini-profil, genbrugskomponent på tværs af sider |
| #2064 | 3 | med | Design ongoing new-rider influx mechanic | Design løbende ny-rytter-influx-mekanik - ejer-ønsket, kræver brainstorm/design først |
| #2178 | 3 | med | [feature] Upload af holdlogo + rework af holdsiden (ala rytterside-rew | Holdlogo-upload + holdside-rework (evt. Pro-gated) - afklar gratis vs. Pro først |
| #2476 | 3 | low | Race-motor: sidevind + vifter (echelons) — feltet splittes forklarligt | Sidevind/echelons er 2027-vision engine-dybde, ikke akut. |
| #2477 | 3 | low | Race-motor/verden: verdensrangliste der fodrer motoren — kvalifikation | Verdensrangliste/kvalifikation er 2027-vision designspike. |
| #2478 | 3 | low | Race-motor: adaptive AI-holdtaktik — autopick-hold reagerer forklarlig | Adaptiv AI-holdtaktik er 2027-vision, ikke akut. |
| #2487 | 3 | med | Gennembruds-vinduer & stagnations-diagnoser (addendum Fase 2) | Gennembrudsvinduer bygger på ejer-låst addendum - progressionsløft. |
| #2488 | 3 | med | Projekt-ryttere: flersæsons udviklingsplaner, maks 3 slots (addendum F | Projekt-ryttere er progression-feature fra ejer-låst addendum. |
| #2489 | 3 | med | Sæsonkortet: Lag 2-periodiseringsflade med træningsblokke (addendum Fa | Sæsonkort layer 2 er stor planlægningsflade, kobler til #2354. |
| #2794 | 3 | med | [ux/IA] Løbssiden er informationsoverload: opdel ruteprofil / holdudta | Løbsside informationsoverload - kræver design/faner, større IA-omlægning. |
| #2822 | 3 | med | [fable] Verdensklasse-benchmark: hvor staar Cycling Zone mod de bedste | Fable-opgave: verdensklasse-benchmark mod Hattrick/PCM/FM. Målbillede mangler helt. |
| #2906 | 3 | med | [design] Mit Hold-løft: alle 15 evner synlige samtidig, rating-kolonne | Ejer-krav 25/7: Mit Hold skal vise alle 15 evner samtidig + rating-kolonne + lavere rækker. |
| #3049 | 3 | med | [feature] Rolle-/taktikvalg pr. rytter i endagsløb (klassikere) — som  | Rolle/taktikvalg pr. rytter i endagsløb (som etapeløb) — relevant nu hvor bjergklassikere kører i D2/D3. |
| #3444 | 3 | med | [design] Division 1 som karakter-peloton — det fremragende endgame (ej | Ejer-mandat om D1 som endgame; tidligt design-brief-stadie, ikke akut. |
| #3463 | 3 | med | [feature] Race-motoren kan ikke simulere holdtidskørsel (TTT) — ni ryt | Race-motoren kan ikke simulere TTT - S3 kører interim TTT 0% indtil dette lukkes. |
| #3644 | 3 | med | [ux] Træningssiden på desktop: AI-slop-review + kvalitetspas (ejer-man | Træningsside desktop AI-slop-kvalitetspas - fungerer allerede, ikke akut. |
| #3763 | 3 | med | [ux] Managers skal kunne se form stige og falde af traening - dataene  | Vis form-kurve over tid til managers - data findes allerede, frontend-only. |
| #3854 | 3 | med | [feature] Staff-parallel rest efter #3851: aegte per-scout kapacitet + | Staff-parallel: aegte per-scout-kapacitet + kandidat-flow mangler efter #3851 - stoerre feature-rest |
| #3984 | 3 | med | [feature] Samlet indstillings-omraade (manager/almindelige/hold) + nat | Samlet indstillings-omraade + nationalitet manager/hold - stor IA-feature, ejer-direktiv 19/8 |
| #4070 | 3 | low | [ux] Dashboard-redesign: fuldt customizable, auto-sorteret efter brug, | Dashboard-redesign (customizable, kompakt) - ejer vil vente til efter cutover-ugen, design først. |
| #4076 | 3 | med | [feature] Staaende ordrer: kvittering + 'goer det til en regel' - een  | Stående ordrer P3: kvittering+regel-flow - ejer-låst design 21/8, del af planning-center fase 2. |
| #4264 | 3 | low | [feature] Skjul andre holds rytter-evner - scouting afsloerer gradvist | Hattrick-inspireret skjult evne-interval for andre holds ryttere - stor ny mekanik, needs-decision |
| #4358 | 3 | med | [matrix] Eet-kliks-flyt i celle-popoveren naar loebsvalget er laast af | Eet-kliks-flyt i laast celle-popover - polish paa saesonmatrix (#1146), kraever ejer-visuel godkendelse. |
| #27 | 2 | low | [feature] Custom gemte scoutingfiltre | Gemte scoutingfiltre. Afhænger af #8 (filter-reset) løses først. |
| #94 | 2 | low | [Feature] Manager cross-season statistik | Cross-season stats — eget trigger siger 'bedst efter 3 afsluttede sæsoner'. For tidligt endnu. |
| #481 | 2 | low | Brand identity overhaul — logo + design manual (once-and-for-all) | Brand-overhaul 'once-and-for-all', multi-session. TdF-deadline (subset #671) er for længst passeret. |
| #930 | 2 | low | [Epic] Staff & manager-rolle som direktør (ansatte, sportsdirektører,  | Vision-epic (staff/direktør), post-launch, uafgrænset scope - ikke klar til nedbrydning. |
| #934 | 2 | low | [Epic] Landshold & internationale mesterskaber (VM, EM, U23-VM, junior | Landshold/mesterskaber - post-launch vision-epic, afhænger af #844 + ungdomssystem. |
| #935 | 2 | low | [Epic] Sociale features (venne-/follow-funktion + billeder på rytterne | Sociale features (follow+billeder) - post-launch; billeder kræver asset-pipeline afklaret først. |
| #956 | 2 | low | [Epic] Deadline-hub: liv aaret rundt (optakt / dag / efter + algoritmi | Deadline-hub post-launch, afhænger af rytter-besøgsdata (#957) som endnu ikke findes. |
| #957 | 2 | low | [Epic] Rytter-popularitet: mest besoegte ryttere (24t/7d + trend) | Trending-ryttere post-launch, fundament for algoritmiske rygter i #956. |
| #986 | 2 | low | Økonomiside: rework af struktur (faner, forecast, lån, sæson-historik) | Discord-feedback om økonomisideomlægning, lav prioritet, ren UX-strukturændring. |
| #1108 | 2 | low | Managerprofil: nationalitet (manageren vælger selv) | Manager-nationalitet, kosmetisk identitetsfeature, afhænger af #844. |
| #1110 | 2 | low | Bestyrelsen går op i ryttertyper (mål baseret på rolle-sammensætning) | Bestyrelsesmål på ryttertyper - indholds-udvidelse, afhænger af ryttertype-arketype-arbejde. |
| #1148 | 2 | low | [Epic] World history & Club Museum — records, legends, rivalries and s | Verdenshistorie/klubmuseum, post-launch depth, afhænger af multi-sæson-navigation (#1106). |
| #1884 | 2 | low | Race-hub taktik: fold jæger-dropdown ind i HunterExplainer + RoleCards | UI-polish race-detalje: fold jæger-dropdown ind i HunterExplainer, lav risiko men ikke hastende |
| #1900 | 2 | low | [ux] Cross-division standings-overblik: alle divisioner i én visning + | Cross-division standings-overblik + filter, resterende halvdel af #1835 (S6 allerede shippet) |
| #2223 | 2 | med | Rework af indbakke-UI: handling vs. information, gruppering pr. type | Indbakke-UI rework (handling vs info) - efterårs-horisont, kræver design-mockup før byg |
| #2398 | 2 | low | [feature] Vis træner-stats + sign-on/release-gebyr for coaches | Coach-stats+sign-on/release-gebyr er QoL, ikke sæson-kritisk. |
| #2399 | 2 | low | [feature] Rytter-søgning: filtrér på ejer-type (kun mennesker) + divis | Scouting-filter (menneske/division) er QoL-feature, ikke haster. |
| #2479 | 2 | low | Research-spike: W'/Critical Power-fysiologimodel i dry-run-harnesset ( | Ren research-spike i harness, ship intet - lav risiko, ikke akut. |
| #2490 | 2 | med | Rytter-krøniken: karrierebiografi + event-fundament (addendum Fase 2-4 | Rytter-krønike er narrativ-fundament, ikke sæsonkritisk. |
| #2491 | 2 | low | Graduation Day: tier-overgangs-ritualet (addendum Fase 4) | Graduation Day er ceremoni-feature, sent i addendum-kæden. |
| #2493 | 2 | low | Årgangs-cyklussen: navngivne generationer + årgangs-leaderboard (adden | Årgangs-leaderboard er addendum-feature, ikke akut. |
| #2494 | 2 | low | Informations-derbyet: scout-vindue før ungdomsauktion (addendum Fase 5 | Scout-vindue før ungdomsauktion er addendum-feature. |
| #2495 | 2 | low | Akademi-filosofi: valgbar skole der farver kuldene (addendum Fase 5) | Akademi-filosofi er identitetsfeature, sent i addendum. |
| #2885 | 2 | med | [feature] Sælg rytter til AI efter N mislykkede auktioner — udvej for  | Sælg rytter til AI efter N mislykkede auktioner — udvej ved 41 WAU hvor køber ofte ikke findes. |
| #3050 | 2 | low | [feature] Venskabsløb / custom turneringer på tværs af divisioner (spi | Venskabsløb/custom turneringer på tværs af divisioner — spiller-oprettede sim-løb, stort scope. |
| #3529 | 2 | low | [feature] Race log pr. rytter: én flade der viser hvilke løb hver rytt | Race log pr. rytter - QoL-overblik, spillerønske, ikke blokerende for nuværende sæson. |
| #3667 | 2 | med | [docs] Hjælp/FAQ + patch notes efter rating-omlægningen (Fase 3) | Hjælp/patch notes til rating-omlægning Fase 3 - afvent skala-PR (#3664). |
| #3964 | 2 | low | [feature] Byt akademi- og seniorrytter i en handling naar truppen er f | Byt akademi/senior-rytter i én handling - QoL-feature, aabne designspoergsmaal om regler |
| #3970 | 2 | low | Kontraktforlaengelse i dage + korte intro-kontrakter for akademirytter | Kontraktforlaengelse i dage + korte akademi-intro-kontrakter - kraever design-session, lav prioritet |
| #4071 | 2 | low | [ux] Manager-indstillinger: samlet omraade (generelt vs. hold) + lande | Manager-indstillinger samlet - ejer vil vente til efter cutover-ugen, design først. |
| #4143 | 2 | low | [ux] Kalender- og planlægningsglyffer skal bruge mini-A eller bogstavk | Kalender/planlægnings-glyffer mangler #4137-ensretning (mini-A/bogstavkode) - to flader tilbage. |
| #4381 | 2 | low | [ux] 'My Team' og 'Akademi' viser samme data forskelligt — rating mang | 'My Team' og 'Akademi' viser samme data forskelligt - konsistens-polish, ingen hastende fejl. |
| #4492 | 2 | low | [feature] Forum: flere kategorier (Q&A, Off-topic) + arkiv for gamle t | Spillerforslag: flere forum-kategorier (Q&A, Off-topic) + arkiv. Skal koordineres med planlagt DA/EN-split (#3517). |
| #1679 | 1 | low | [feature] Se andre holds træning på deres ryttere | Lav-prioriteret feature: se andre holds trænings-valg. |
| #1837 | 1 | low | [feature] Autobud/proxy-bud fra rytterprofil når man starter en auktio | Lav-prioriteret feature: autobud fra rytterprofil ved auktions-start. |
| #1977 | 1 | low | [feature] Tillad en valgfri kommentar/note på en rytter sat til salg ( | Valgfri sælger-kommentar ved rytter-salg, small-touch markedsfeature, ikke hastende |
| #2723 | 1 | low | [ux] Renown ("anseelse") er kun synligt i bestyrelseslokalet — spiller | Renown kun synligt i bestyrelseslokalet - lille UX-hul, lav impact. |
| #3051 | 1 | low | [feature] "For sjov"-achievements uden score + rekrutterings-rangliste | 'For sjov'-achievements uden score + rekrutterings-rangliste — billig kategori-del, referral-del kræver nyt spor. |
| #3374 | 1 | low | [feature] 'Undlad udtagelse'-flag pr. rytter — beskyt ryttere der skal | Nice-to-have 'undlad udtagelse'-flag; lav prioritet, ingen akut smerte. |
| #3726 | 1 | low | [ux] Loefte 3/8: 'Completed'-omraadet paa resultatsiden bygges om og d | Uindfriet løfte om Completed-omlægning - lav værdi, ingen spiller har fulgt op. |

## Kraever ejer-beslutning (52)

| # | V | Pri | Titel | Note |
|---|---|-----|-------|------|
| #2853 | 5 | high | Flip e-mail-retention-loopet live (tekst-godkendelse + 2 Railway-keys  | Email-retention-loop (hovedhåndtag mod 73% aldrig-igen) klar men blokeret på 3 ejer-skridt: tekstgodkendelse + 2 Railway-keys. |
| #4321 | 5 | high | [growth] PostHog (EU) som analytics-lag: kanal-attribution, funnels, r | PostHog analytics ejer-besluttet 27/8 (attribution/funnels/MCP) - blokeret paa ejer-signup/API-noegler. |
| #1276 | 4 | high | Beslutning foer 20/6: PCM-dump-xlsx med rigtige rytternavne ligger syn | A/B-beslutning: rigtige rytternavne (3.parts-IP) ligger synligt i public repo — juridisk risiko. |
| #2798 | 4 | high | [design/balance] Markedsværdien afslører skjult potentiale — v4-værdie | Markedsværdi lækker skjult potentiale, undergraver scouting-fog (#1138) - ejer skal vælge fix-retning. |
| #3458 | 4 | high | [design] Ryttertype-fundamentet v2: arketype-generation + skala-aerlig | Ryttertype-fundament v2 - stor spec afventer ejer-godkendelse før byg kan starte. |
| #3459 | 4 | high | [design] Loebsdags-modellen: loebet ER dagens arbejde - fatigue+traeni | Løbsdags-modellen - stor spec afventer ejer-godkendelse før byg kan starte. |
| #3577 | 4 | high | [investigation] #3561-efterspil: spillere tog lån og solgte ryttere fo | #3561-følgeskader (lån/salg) udækket + 12t tavshed - kræver ejer-kald om kompensation. |
| #3614 | 4 | high | [balance] 142 frie ungdomsryttere fra gamle akademi-kuld er over ungdo | 142 frie ungdomsryttere over ungdomsbånd (op til 2,1 mio.) - markedsforvridning nu, kræver ejer-kald. |
| #4270 | 4 | high | Ejer-direktiv 25/8: saeson 4-loebskalenderen skal laves inden 28.-30/8 | S4-kalender skulle bygges 28-30/8 (deadline allerede passeret); afhænger af åbne bånd-beslutninger (#4220,#4103,#4174) |
| #4404 | 4 | high | [ci] auto-merge-labelen er doed: required code-owner-review kan aldrig | auto-merge doed: code-owner-review-krav kan aldrig opfyldes paa ejerens egne PR'er - kraever policy-beslutning. |
| #4482 | 4 | high | [bug/board] Lag 6-bonustilbud udloeber aldrig - 37 aktive tilbud paa a | Lag 6-bonus udloeber aldrig - 37 aktive tilbud paa afsluttede saesoner. Fix fjerner vaerdi fra hold - ejer-beslutning. |
| #1407 | 3 | med | SEO measurement layer: GSC + GA4 + Ahrefs + Morningscore korrekt opsat | SEO-måleopsætning (GA4/GSC-indstillinger) kræver ejer i dashboards. |
| #1461 | 3 | med | security(email): DMARC enforcement — p=none → quarantine → reject | DMARC p=none→quarantine blokeret på ejer-test af signup-mail i indbakke. |
| #1784 | 3 | med | Vercel Pro: sæt spend management / budget-loft op (forsikring før mark | Vercel spend-management kræver dashboard-login — billig forsikring mod regnings-overraskelse. |
| #2622 | 3 | med | [needs-decision] Auto-entry-generator fylder hele sæsonen proaktivt (8 | Auto-udtag-horisont (bred vs. snæver) kræver ejer-beslutning. |
| #2645 | 3 | med | [bug/balance] Peak/loft-beskeder inkonsistente: 'approaching ceiling'  | Del A muligvis fixbar nu, men Del B peak-alderskurve er eksplicit ejer-beslutning - afklar først. |
| #2670 | 3 | med | [balance] Udvikl-og-sælg: re-mål ROI mod ægte markedsadfærd + ejer-bes | Re-mål udvikl-og-sælg-ROI mod ægte data + ejer skal bekræfte/dæmpe 250%-loftet. |
| #3147 | 3 | med | [feature] Sponsor race-day-udbetalinger løbende i stedet for klumpsum  | Ejer skal beslutte progressiv vs. klumpsum-udbetaling; verificér først faktisk kadence. |
| #3425 | 3 | med | [nav/mobil] Planlægning i mobilbundbaren — beslutning A/B på Clarity-t | A/B-beslutning om planlægning i mobilbundbar mangler stadig trods klart Clarity-datagrundlag. |
| #3471 | 3 | med | [feature] Kalender-spor med identitet (GT-spor / WT-spor / klassiker-s | Kalender-spor med identitet (GT/WT/klassiker) - spillerforslag, needs-decision fra ejer. |
| #3595 | 3 | med | [balance] Sponsormål kan ignoreres uden konsekvens — pengene udbetales | Sponsormål udbetales uanset opfyldelse - ejer bekræftede hul, kræver designbeslutning. |
| #3789 | 3 | med | [ops] Daglig Sentry-triage kan ikke laese Sentry headless — Infisical- | Sentry-triage headless kan ikke logge ind - Infisical-session kræver ejer-handling. |
| #4100 | 3 | med | [feature] Portraetbilleder til ryttere - community-oenske (smukkethoms | Portrætbilleder til ryttere - community-ønske, kræver ejer-valg af billedkilde (5000+ fiktive ryttere). |
| #4117 | 3 | high | [community] 13 klar-til-post traade + postplan aug/sep (ejer poster se | 13 klar-til-post community-tråde + postplan aug/sep - ejeren poster selv, AI sender aldrig for ham. |
| #4177 | 3 | med | [bug/ux] Patch noten lover 12 timer paa frie ryttere, men auktioner ud | Patch note lover forkert 12t-auktion + 'fri agent' udefineret; ejerens eget spørgsmål 08:37 er ubesvaret |
| #4201 | 3 | med | [design] Assistenten boer vaere opt-in eller sen-udfyldning i stedet f | 5 spillere vil vende assistenten om til fill-gaps i stedet for auto-fill-alt; kræver retningsvalg fra ejer |
| #4268 | 3 | med | Ejer-direktiv 25/8: roller i spillet - Admin, Moderator, Beta tester | Admin/Moderator/Beta tester-roller ønsket, men rettigheder pr. rolle er ikke specificeret af ejeren endnu |
| #4318 | 3 | med | [design] To flader siger 'Race day' om to forskellige tal - kalender-o | 'Race day' betyder to forskellige tal paa to faner (kalenderdag vs game_day) - kraever navnebeslutning. |
| #4328 | 3 | med | [refactor] finance_transactions.type: CHECK-constraint → Postgres-enum | CHECK-constraint -> Postgres-enum paa finance_transactions.type - destruktiv live-migration, ejer-gated. |
| #4355 | 3 | med | [balance] Juni-fyldkuldet (24/6) har samme taktik/hidden_potential-lae | 34 ryttere fra juni-kuldet har samme evne-laek som #4311 - klemning af 2 maaneder brugte ryttere kraever ejer-go. |
| #4356 | 3 | med | [ejer-beslutning] De 34 etaper der koerte med to kaptajner: re-simuler | 34 afviklede etaper fik fejlagtig dobbelt-kaptajn-beskyttelse - ejer skal beslutte re-simulering eller staa. |
| #4497 | 3 | high | [fair-play] Ugescan 31/8: Scuola di Cadenza <-> Koben Racing, 154.885  | Ugescan: 154.885 CZ$ flyttet til samme hold i 3 handler + hurtigt undervaerdi-videresalg. Kraever ejer-vurdering (fair play). |
| #941 | 2 | low | Regnskabsprogram — vælg + opsæt | Ikke-kode grundlæggerbeslutning (regnskabsprogram), timing mod CVR + Alunta. |
| #1283 | 2 | low | ToV-session: definér founder-stemmen (ejer-ledet) — struktur fra AI, p | Founder-stemme-session — prosa skal komme fra Nicolai selv, ikke AI. |
| #1595 | 2 | low | [forever] WS2-backend — PCM-sletning: fjern resultat-pipeline, behold  | PCM-sletning kræver ejer-beslutning — spec modsiger kode om hvad der kan slettes. |
| #1875 | 2 | low | Sæt Vercel preview-env (VITE_PREVIEW_MOCK + sentinel) — aktivér self-s | Kræver Vercel dashboard-adgang til preview-env-vars — ejer udskød tidligere pga. secrets-uro. |
| #2388 | 2 | low | race:gate:roles rød siden 16/6: itt-bånd 59 % vs ≥60 (seed 2026) — eje | Interim-bånd-beslutning: accepter 59% eller ret roles-gate. Ejer skal vælge. |
| #2680 | 2 | med | AI-audit 19/7: Cowork-connector-toggles i dev-kanal (Ahrefs/Clarity/Ca | Cowork-connector-toggles kræver ejer-klik i UI, kan ikke scriptes. |
| #2688 | 2 | low | AI-audit 19/7: Fable-optimering — workflow/judge-panels/effort-routing | Fable-optimering (judge-panels/effort-routing) - ejer skal vælge håndtag. |
| #2856 | 2 | med | [balance/data] #2694-opfølgning: historisk holdklassement-reparation ( | Historisk holdklassement-reparation (<3-finisher-hold) — destruktiv prod-mutation, eksplicit ejer-gated. |
| #3152 | 2 | med | [design] Bestyrelses-tilfredshed/omdømme opleves som humør-dræber op t | Ejer-beslutning om board-mål skal neddrosles indtil renown er synligt og konsistent. |
| #3553 | 2 | med | [ops] "Add to CyclingZone Roadmap"-action fejler på ALT: Bad credentia | Roadmap-boardets GitHub Action fejler på udløbet PAT - kræver ejer-handling (ny token). |
| #3647 | 2 | med | [design] Skriv kompensations-reglen ned: hvornår holdes en spiller ska | Skriv kompensations-regel ned - kræver ejerens principafgørelse på grænser. |
| #3952 | 2 | low | [design/ux] Radius-konvergering: ~350 steder med 4/6/8px-hjoerner mod  | ~350 steder med forkert border-radius vs 5px-kontrakt - foer/efter-screenshots mangler til ejer-go |
| #4099 | 2 | low | [ux] Fysiologi-siden opleves ligegyldig - behold, fold ind eller fjern | Fysiologi-siden virker ligegyldig - mål faktisk brug først, ejer afgør behold/fold/fjern. |
| #4189 | 2 | low | [collab/beslutning] Maa collaborators trigge @claude paa ejerens kvote | Må collaborators bruge ejerens Claude-kvote via @claude? Ren beslutning, intet kode-arbejde endnu |
| #4235 | 2 | low | [beslutning 15/9] Forummets rolle over for Discord - maaleplan + basel | Forum vs Discord-beslutning venter bevidst til 15/9 på faktiske tal; intet at handle på nu |
| #4454 | 2 | low | [security] Vurdér edge-proxy (Cloudflare) foran Railway — rate limitin | Vurdering af Cloudflare edge-proxy mod IP-rotation - lav trafik (peak 30/min), kan legitimt lukkes som nej. |
| #886 | 1 | low | [ops/ejer] Udvid Sentry-tokenet: laaser BAADE auto-resolve (#886) og d | Kræver trade-off-beslutning om bredere Sentry write-scope før implementering. |
| #3092 | 1 | low | Afinstallér ubrugt Manus Connector GitHub App (permission-request 27/7 | Afinstallér ubrugt Manus Connector GitHub App — kræver manuel handling i GitHub UI, ikke mistænkeligt. |
| #3109 | 1 | low | 4 AI-hold fik deres trup erstattet af heal-sweep-fejlen (26/7) — hvad  | Kun AI-hold ramt, ingen spillere; ejer skal beslutte oprydning/regenerering af de 4 trupper. |
| #3795 | 1 | low | [ops] To worktrees baerer ucommitted maalevaerktoej fra 14/8 - commit  | To worktrees med ucommitted måleværktøj - ejeren afgør commit eller kassér. |

## Grundregler/balance - efter 27/9 (99)

| # | V | Pri | Titel | Note |
|---|---|-----|-------|------|
| #931 | 5 | high | [Epic] Træningssystem — nøglerytterplaner først, individuel dybde sene | Kerne-progression (permanent udvikling) er grundregel-balance - byg efter S3 per doktrin. |
| #932 | 5 | high | [Epic] Ungdomsakademi — intake, udvikling, promotion og ungdomsauktion | Ungdomsudvikling påvirker talentmodel - balancefølsom, vent til efter 27/9. |
| #1021 | 5 | med | [BUILD] Race engine V1 — simulator + stage-profiler (sæson 3-overgang) | Race-engine-simulator er stor balancepåvirkende ombygning - hold den uden for live S3. |
| #1136 | 5 | high | [Epic] Progression & livscyklus — rytterudvikling, træning, ungdom (sa | Progression-epic er launch-kritisk retention-motor men grundregel-balance - første post-S3-prioritet. |
| #1441 | 5 | high | Epic: langsigtet sammenhængende økonomi — anti-inflation, gold sinks,  | Stor økonomi-overhaling (anti-inflation, gold sinks) — grundregel-ændring, udskudt til efter 27/9. |
| #3360 | 5 | high | [balance/HØJ] Pengemængden firdobles over 5 sæsoner (4,24x mod mål 1,3 | Pengemængde 4,24x mod mål 1,3x - alvorligt, men er en grundregel/balance-ændring, venter. |
| #3564 | 5 | med | [design] Progressionskæden samlet: potentiale 1-99, lofter pr. ryttert | Hele progressionskæden (potentiale/lofter/træning/kurve) samlet ét sæt - grundregel, vent til efter 27/9. |
| #844 | 4 | med | Lande-system: countries-tabel + 3-akset nationsstyrke (fødselsrate, ta | Landesystem påvirker fødselsrate/talent - balancefølsom grundregel, vent til efter 27/9. |
| #1099 | 4 | med | [Epic] Omdømme/Renown-system — optjent popularity (resultater, sejre,  | Optjent omdømme ændrer rytter-popularity-mekanik - balance, post-launch label, vent til efter S3. |
| #1712 | 4 | low | Fuld 140-etaper/5-per-dag sæson-rekalibrering (post-launch) | Fuld 140-etaper/5-per-dag sæson-rekalibrering — eksplicit 'må ikke startes' før post-launch er stabil. |
| #2354 | 4 | med | Race v3 S5: form-peaks — planlagt topform pr. rytter | Form-peaks er engine-balance-ændring m. SQL-migration - afvent sæsonslut. |
| #2770 | 4 | med | [build] Sub-2: Dybe konkurrencer — passage-ordener (KOM/point) + bonus | Sub-2: KOM/point-passage + bonussekunder - matematisk tung scoring-ændring, udskyd til efter S3. |
| #2840 | 4 | high | Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart  | Løn er engangstræk ved sæsonstart — sent købte ryttere spiller gratis resten af sæsonen. Grundregelændring, vent til efter 27/9. |
| #3720 | 4 | med | [balance/HØJ] #1441 A6-kalibreringen antog en præmie der er 3,7-6,6x f | Upkeep-kurve bygget på præmietal 3,7-6,6x for lavt - stor balance-fejl, afvent S3. |
| #3729 | 4 | med | [balance/HOEJ] Markedet er forbudt at prissaette over modellen - 23 ko | Marked forbudt at prissætte over model - kun 23 konkurrencehandler nogensinde. |
| #3732 | 4 | med | [balance/HOEJ] Vaerdimodellen er pengepolitik, ikke en prisseddel - 53 | Værdimodel er pengepolitik (53% af pengedræn) - bredere godkendelse end UI-fix. |
| #3750 | 4 | med | [balance/HOEJ] Vaerdimodellen traenes paa en konstant: 739 bank-salg t | Værdimodel trænet på egen konstant (76% af bank-salg) - stor model-fejl, afvent S3. |
| #3806 | 4 | med | Ejer-direktiv 15/8: maks +1 i samme evne pr. doegn - og udviklingsrate | Ejer-direktiv: dagligt +1-loft pr. evne + langsommere rate - core progressionsregel, vent til efter 27/9 |
| #4181 | 4 | med | [balance/HOEJ] TT-rytteren er ikke bedst til enkeltstart, og rouleuren | TT ikke bedst til ITT, rouleur uden terræn nogen steder - grundregel-balance, afvent til efter 27/9 |
| #4385 | 4 | med | [economy] Ejer-direktiv 29/8: upkeep skal blive en loebende rejse-/per | Ejer-direktiv 29/8: upkeep -> loebende rejseudgift pr. loebsdag - grundregel-aendring, planlaeg nu, skift efter S3. |
| #450 | 3 | low | [feature] Minimumspris på egne ryttere — passive floor mod spam-bud (V | Minimumspris på egne ryttere er en markedsmekanik-ændring — balance-følsom, skal simuleres først. |
| #1109 | 3 | low | Manager-evner (FM-stil): forhandling, scouting, økonomi m.m. | Manager-evner påvirker gameplay-balance (forhandling/scouting), uafklaret scope - efter S3. |
| #1112 | 3 | low | Manager-omdømme (del af renown-motor) | Manager-omdømme fodrer lånekapacitet i økonomi - balancepåvirkende, del af fælles renown-motor. |
| #1146 | 3 | low | [Design] Shared race calendar — selection, overlap, fatigue, qualifica | Race-kalender-design (fatigue/qualification) er balancemekanik, needs-contract, post-launch. |
| #1151 | 3 | low | [Epic] Human-driven transfer market & AI liquidity | Transfermarked/AI-likviditet ændrer markedsbalance - needs-contract, post-launch. |
| #1154 | 3 | low | [Epic] Rider personality & club relationship — roles, ambition, loyalt | Rytterpersonlighed/loyalitet påvirker kontrakt-/transferbalance - post-launch mekanik. |
| #1239 | 3 | med | [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalit | Stort DNA/holdfokus-redesign, grundregel-tungt design-arbejde, afklares efter sæson. |
| #1293 | 3 | med | Race-motor: population-berigelse + endelige gate-bånd (cobbles/hilly/i | Race-motor cobbles/hilly/itt-gate mod fulde mål kræver population-indhold, ikke motor-tuning — balance-følsom. |
| #1379 | 3 | med | Genbesøg evnesystemet + watt-intervaller (5/10/15-min power-kurve) | Evnesystem/watt-intervaller-kalibrering — balance-følsom mod fiktiv population. |
| #1922 | 3 | med | [feature] Træningsfokus-rework: meningsfulde trade-offs (cykelnørd mød | Trænings-fokus grundregel-rework (nær-placeholder trade-offs) - balance-ændring, vent til efter 27/9 |
| #2176 | 3 | med | [feature/design] Transferliste → auto-auktion (1t) når nogen byder udb | Transferliste→auto-auktion, afskaf direkte handler - grundregel-ændring af markedet, vent til efter 27/9 |
| #2337 | 3 | med | Træning: løbs-bevidst periodisering (auto-let før løb, rest efter) | Balance-ændring (træningsperiodisering), kræver dry-run - afvent efter 27/9. |
| #2416 | 3 | med | Udbrud v2: jagt-interesse-model — udbruddets skæbne afgøres af feltets | Udbrud v2 (jagt-interesse-model) er stor engine-omskrivning - afvent. |
| #2417 | 3 | med | τ-kompression exit-strategi + maxSeason-genmåling post-S4 (kalibrering | τ-kalibreringsgæld + maxSeason-genmåling er balance-arbejde - afvent. |
| #2525 | 3 | med | [balance] Massespurt: bunch-tærsklen er for smal i praksis — feltet sp | Bunch-tærskel er balance-konstant-justering, kræver sim-gate - afvent. |
| #2582 | 3 | low | [feature] Race-motor: analysér tidsgrænse (broom wagon/cutoff) fra vir | Tidsgrænse/broom wagon er ny core-regel - designafklaring, ikke sæsonhastende. |
| #2667 | 3 | med | Værdimodel v4 slice 4: selvkørende re-fit mod ægte driftdata + anchors | Selvkørende re-fit af værdimodel mod driftdata - langsigtet balance-infra, afvent S3-slut. |
| #2698 | 3 | med | [balance] Progressiv evne-udviklingskurve: 1→10 hurtigt, 95→100 meget  | Logaritmisk evne-udviklingskurve er grundregel-ændring - ejer-ønsket, men udskyd til efter 27/9. |
| #2747 | 3 | med | Regen/newgen: erstat pensionerede ryttere så feltet ikke krymper monot | Regen/newgen mod krympende felt - strukturel balance-ændring, udskyd til efter 27/9. |
| #2748 | 3 | med | Pensionering: forvarsel + squad-minimum-check ved masse-retirement | Pensionsvarsel + squad-minimum-check - balance/UX-ændring, udskyd til efter S3. |
| #2757 | 3 | med | [balance] Pointtrøje: sprintpoint på bakke-/bjergetaper vægter for høj | Pointtrøje-vægtning bjerg vs. flad er scoring-balance - udskyd justering til efter S3. |
| #2799 | 3 | med | [balance/HØJ] Markedsværdier eksploderede i halen efter v4-cutoveren — | Markedsværdi-hale eksploderede v4-cutover 18/7; balance-følsomt, kræver sim FØR ændring. Værdien kan allerede være anderledes nu. |
| #2944 | 3 | med | [balance/design] Styrt er binære (crashed = intet resultat) og opleves | Styrt opleves binære og for hyppige — balance-følsomt, kræver sim-harness mod ægte population først. |
| #3096 | 3 | med | [design/balance] Sæsonskiftet nulstiller træthed men bærer form uændre | Sæsonskifte nulstiller træthed men ikke form — bevidst udeladt beslutning (#2910), balance-følsomt. |
| #3328 | 3 | med | [balance] Løbsklasse og etapeantal er afkoblet: 32 af 36 D2-etapeløb e | Løbsklasse/etapeantal-mismatch er en balanceændring til kalendergenerering - venter. |
| #3337 | 3 | med | [investigation] Betaler specialisering sig? Bjergryttere vs. brede all | Balancespørgsmål (klatrer vs. allrounder) kræver simulering før noget ændres - venter. |
| #3349 | 3 | med | [balance] Spillets terræn-mix er skævt mod fladt: kuperet 27,7% mod vi | Terræn-kalibrering mod virkeligheden er en balanceændring til etape-generering - venter. |
| #3466 | 3 | med | [balance/design] Aldersnedgang skal ske dagligt i stedet for som 28-da | Aldersnedgang skal spredes dagligt ift. 28-dages-klippe - grundregelændring, vent til efter 27/9. |
| #3503 | 3 | med | [balance] Loft-mekanikken udvander arketype-identitet ved hoej potenti | Loft-mekanik udvander arketype ved højt potentiale - del af #3564-kæden, vent til efter 27/9. |
| #3542 | 3 | med | [balance] Division 2 opleves som økonomisk straf: spiller vurderer 4x  | D2 opleves som økonomisk straf vs. D3 - kalender/præmiestruktur, grundregel, vent til efter 27/9. |
| #3592 | 3 | med | [balance] Fire typepar er matematisk uadskillelige — positive vaegte e | 4 ryttertype-par matematisk uadskillelige (delmængde-vægte) - hænger sammen med #3458/#3564. |
| #3616 | 3 | med | [balance] Ungdomsbåndet er for lavt i bunden og fladt i toppen — 16-17 | Ungdomsbånd afviger fra §2a-aftale (for lavt+fladt); balance-ændring, vent til efter S3. |
| #3629 | 3 | med | [balance] Talent-kloeften: akademiet snit 3,61 stjerner, det frie mark | Akademi (3,61) vs frit marked (2,20) talent-kløft - balance, afvent S3-slut. |
| #3631 | 3 | med | [balance] Sekundaer ryttertype er skaev — sprinter 33,7 % i bestanden, | Sekundær ryttertype skæv fordeling (sprinter 33,7%) - balance, afvent S3-slut. |
| #3719 | 3 | med | [balance] Kalenderen har intet præmiepulje-budget pr. division — varia | Kalender har intet præmiepulje-budget pr. division - balance, afvent S3-slut. |
| #3743 | 3 | med | [balance] Assistentens traeningsvalg skal afhaenge af traenerens evner | Træningsassistent bør afhænge af trænerevner - balance, afvent S3-slut. |
| #3755 | 3 | med | [balance] Maal auktions-konkurrencen 28 dage efter #2884 - gaten for b | 28-dages måling af auktionskonkurrence efter #2884 - kør ca. 12/9, gater #3756. |
| #3837 | 3 | med | [trin7] Overgangs-session: mål oplevet ændring + personligt før/efter- | Trin7-overgangssession (progressionsmotor) - stor grundregelaendring, koerer mens trin7 er parkeret |
| #3965 | 3 | med | [balance] Punch-evnen opleves vaegtloes paa punch-etaper - foerste man | Punch-evne opleves vaegtloes paa punch-etaper - balance-paastand fra 2 spillere, maal foerst |
| #3967 | 3 | med | [feature] Fog of war: vis potentiale som ord/interval i stedet for pra | Fog of war: potentiale som ord/interval - core transparens-aendring, flere spillere oensker det |
| #3987 | 3 | med | [balance] Sponsorens basisbeloeb og race-day-betaling boer skalere med | Sponsor-beloeb boer skalere med ranking/division - balance-oenske, vent til efter S3 |
| #4145 | 3 | med | [balance] Kontraktforlaengelse er gratis: gebyr skal goere det til et  | Kontraktforlængelse er reelt gratis (løn = 2% af markedsværdi) - balance-fix, venter til efter 27/9. |
| #4146 | 3 | med | [balance] Trup-loftet er 30 for alle divisioner mens et loeb udtager 6 | Trup-loft 30 for alle divisioner er ikke et reelt loft - balance-spørgsmål, venter til efter 27/9. |
| #4195 | 3 | med | [balance] Vaerdimodellen er saa stejl i toppen at ET overall-point = + | Værdimodel for stejl i toppen, 40M-loft brydt på 44% af seeds; balance-tuning, afvent sæsonslut |
| #4220 | 3 | med | [calendar/realisme] Enkeltstarter skal ligne virkelighedens cykelsport | Enkeltstart-realisme kræver research+SSOT; grundregel-ændring, men S4-kalender-deadline presser på |
| #4278 | 3 | med | [balance] D4 er den mest bjergrige division - samlet opad 41,9 % mod b | D4 er mest bjergrig division (41,9% vs bånd 25-32%) - balance-tuning, afvent sæsonslut |
| #17 | 2 | low | [design] Lån — skal renter starte med det samme + skal gebyr betales k | Design-spørgsmål om lånerenter/gebyr, skal koordineres med økonomi-baseline (slice 07). Ikke akut. |
| #103 | 2 | low | [investigate] Multi-year mål — tidlig opfyldelse og genforhandling | Grundregel-spørgsmål om flerårsmål/genforhandling, afventer spillerforslag. Skal låses før sæson 2's mål. |
| #939 | 2 | low | Vejr + vind på etaper som race-faktor (sub-scope af race-engine #675/# | Vejr på etaper er sub-scope af race-engine - byg ikke isoleret, vent på #675-design. |
| #1113 | 2 | low | Fans som spil-mekanik (popularity → effekt på økonomi/moral) | Fans som økonomisk mekanik påvirker balance (sponsor/moral) - vent til efter S3. |
| #1141 | 2 | low | Instrumentér board-brug → datagrundlag for at forenkle bestyrelses-sys | Instrumentering af board-brug skal times med progression-epic (#1136), som er post-S3. |
| #1177 | 2 | low | Holddynamik-dybde: vejkaptajner + mentor + erfaring | Holddynamik-dybde (vejkaptajner/mentor) bygger på #1154, post-launch balance-lag. |
| #1208 | 2 | low | Kalibrér boardIdentity star-score væk fra frossen uci_points (sidste f | Kalibrering af star-score væk fra frossen uci_points — balance-følsom, vent til efter 27/9. |
| #1237 | 2 | low | [feature] Board-økonomi: vurdér saldo vs gæld, ikke kun antal lån | Økonomi-vurdering (saldo vs gæld) balance-følsom, hører under simulér-før-ship-sporet. |
| #1981 | 2 | low | [Investigation] Catch-up for nye/tilbagevendende klubber: billigere ud | Catch-up for nye klubber - evidens-gated investigation, ingen data endnu, ikke akut |
| #2217 | 2 | low | Staff-kontrakter + genforhandling (med Slice B) (#1441) | Staff-kontrakter + genforhandling - blocked, del af økonomi-epic, koblet til Slice B rytterkontrakter |
| #2218 | 2 | low | Pension→staff: retired ryttere bliver trænere/spejdere (#1441) | Pension→staff-pipeline - blocked, senere slice i økonomi-epic, afhænger af rytter-pensionssystem |
| #2222 | 2 | low | Merchandise-funktion: hold sælger merch til fans (indtægt skalet af fa | Merchandise-indtægtsmekanik - eksplicit 2027-horisont i MASTERPLAN, bevidst ikke i kø endnu |
| #2887 | 2 | low | [feature/balance] Sportsdirektør: gør senior-træningsstatten meningsfu | Er senior-træningsstat på sportsdirektør en død stat? Balance-afklaring før evt. ændring. |
| #3413 | 2 | low | [balance] Udbrudsforsøg er gratis (ingen fatigue, ingen placeringsrisi | Ikke en bug, ingen bad om ændring direkte - design-signal om manglende trade-off i udbrud. |
| #3467 | 2 | low | [feature] 1 doegns offseason-buffer ved saesonskifte (spillerforslag t | 1 dags offseason-buffer ved sæsonskifte - designvalg til S4-kalendergenerering. |
| #3468 | 2 | low | [investigation] Udvikler frie agenter/AI-ryttere sig uden hold? (friis | Udvikler frie agenter/AI-ryttere uden hold? Koblet til løbsdags-modellen (#3459), afventer den. |
| #3547 | 2 | low | [balance] S3-kalender: samlet spillerfeedback ud over GT'erne — broste | S3-kalender-feedback fra megathread - kalenderen kører allerede, relevant for S4-generering. |
| #3656 | 2 | low | [economy] Loennormalisering: hotfix mod absurd lave OG absurd hoeje lo | Lønnormalisering kun betinget udmeldt ('I might') - balance, intet lovet endnu. |
| #3668 | 2 | med | [balance] Evnerne er ikke paa samme skala indbyrdes — taktik median 38 | Evner ikke på samme skala (taktik 38 vs bjerg 5) - balance needs-decision. |
| #3705 | 2 | low | [balance] Traeningsfokus rammer faste evne-bundter: progression spilde | Træningsfokus spilder progression på maxede evner - balance, muligvis overhalet af #3709. |
| #3745 | 2 | low | [balance] Trin 6: ingen vokser af tid alene - AI-hold, frie agenter og | AI-hold/frie agenter udvikler sig ikke - trin 6 i #3709, gated balance-beslutning. |
| #3756 | 2 | low | [balance] Gebyr paa hoeje auktions-startpriser (ejer-beslutning 15/8)  | Gebyr på høje startpriser - eksplicit gated af #3755-målingen, ikke før S3-slut. |
| #3804 | 2 | low | [balance] Bi-typen former ikke rytterens krop endnu - blokeret af at r | Bi-type former ikke rytterkrop endnu - blokeret af race:gate golden-fixture, balance. |
| #3813 | 2 | low | [investigation] Rytterens sekundaere type matcher ikke altid hans naes | Sekundaer type matcher ikke loft-range - forvirrer spillere, men er undersoegelse ikke akut fix |
| #3853 | 2 | low | [balance] Scout-missioner 2->1 dag: maal spend-loft og fund-rate mod h | Scout-mission 2->1 dag fordoblede teoretisk spend-loft - balance-efterregulering, ikke akut |
| #3856 | 2 | low | [feature] Løbsfilm-backfill: tidslinjer for de 1.929 historiske etaper | Loebsfilm-backfill for 1.929 historiske etaper - afventer ejer-go efter S3-bevis, ikke akut |
| #3864 | 2 | low | [S4] Belgisk åbning: kurateret klassiker-uge + brosten-sektorer med re | Belgisk aabningsuge + brosten-vaegt 15-20% - eksplicit S4-kandidat, bevidst holdt ude af 23/8-pakken |
| #3917 | 2 | low | [investigation] Sprint-etaper: kaptajner taber 20-40 sek, felt-sammenh | Sprint-etaper: kaptajner taber 20-40 sek - uverificeret balance-paastand, maal foerst |
| #4032 | 2 | low | [balance] Pensions-sandsynlighed boer vaegte resultater + tidligere st | Pensions-sandsynlighed boer vaegte resultater - ejer siger eksplicit S4+, ikke nu |
| #4101 | 2 | low | [investigation] Ingen frie agenter paa 35+ gik paa pension - kun rytte | Ingen 35+ frie agenter går på pension - billig SQL-verifikation, evt. balance-fix venter til post-S3. |
| #4380 | 2 | low | [docs/balance] Boer U25/U23 vaere inklusiv alderen, som i virkelighede | U23/U25-inklusion er en grundregel-afklaring - vent til efter S3, kun kode-opslag/docs kan ske nu. |
| #4488 | 2 | low | [balance] Konverteringsmatrix for rytter-typer: sprint og klatring ska | Spillerforslag: konverteringsmatrix for rytter-sekundaertyper (sprint/klatring maa ikke krydse). Balance - vent til efter 27/9. |
| #2991 | 1 | low | season_grand_tour_rider kan ingen menneskemanager opnå: Grand Tours er | season_grand_tour_rider-achievement kan ingen menneske opnå — D1 er 100% AI. Struktur-/balancebeslutning. |

## Formentlig allerede loest - verify-koe (21)

| # | V | Pri | Titel | Note |
|---|---|-----|-------|------|
| #3154 | 3 | med | [ops] Ejer-direktiv 26/7: backlog ned til ~200 åbne issues på 7-14 dag | Ejer-direktiv om 200 issues (deadline 9/8 er passeret) - denne housekeeping er leveringen. |
| #3448 | 3 | med | [economy] Markedsdrevne værdier: 50/50-blend søndag 9/8, ugentlig kade | 23/8-planen (100% markedsmodel) er passeret dags dato - verificér om faktisk kørt/live. |
| #3767 | 3 | med | [observability] Sentry er tavs: eneste alarmregel rammer kun high-prio | Sentry-alarm for snæver (kun high-priority) - label claude:done, verificér fix er live. |
| #4000 | 3 | med | [balance] Typen skal fylde mindre i vaerdiformlen: regularisér offset- | Allerede maerket claude:done - verificer at vaerdiformel-regulariseringen faktisk er lukket/flippet |
| #4203 | 3 | med | Ejer-direktiv 24/8: Monumenterne skal ud af GT-vinduerne - 4 af 5 ligg | PR #4208 har allerede flyttet Monumenter ud af GT-vinduerne iflg. #4209 - verificér og luk |
| #671 | 2 | low | Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) | TdF-deadline 15/6 er for længst passeret (i dag 31/8) — verificér om brand-minimum allerede er leveret. |
| #2076 | 2 | med | [ops/ejer] Uptime-monitor på /health + cyclingzone.org + Sentry→Discor | Uptime-monitor + Sentry→Discord-alert, ejer-opgave fra juli før TdF - tjek om ejer allerede udførte |
| #2675 | 2 | low | [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kred | Verify+backfill-beslutning dateret 19-20/7, sandsynligvis afsluttet - tjek issue-status. |
| #2679 | 2 | low | AI-audit 19/7: disable-bølge — 5 dødvægt/dublet-plugins (~6-7k tok/ses | Plugin-disable-bølge markeret 'tag i dag' 19/7 - verificér om udført. |
| #2681 | 2 | low | AI-audit 19/7: memory-hygiejne — MEMORY.md 2 tok fra fail-gate + memor | Memory-hygiejne fra 19/7 - nuværende MEMORY.md ser trimmet ud, verificér om løst. |
| #2682 | 2 | low | AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token | NOW.md/CLAUDE.md-token-budget allerede dokumenteret i nuværende CLAUDE.md - verificér gate. |
| #3450 | 2 | low | [investigation/balance] Potentialer rykkede sig bredere end tilsigtet  | Gammel investigation fra 6/8, sandsynligvis afløst af #3564-progressionskæden - verificér. |
| #3514 | 2 | low | [Epic] Bestyrelses-rework 'Mandatet' — én tillid, ét årsmøde, vision s | Allerede tagget claude:done (Mandatet-epic) - verificér lukket status/checklist reelt fuldført. |
| #3550 | 2 | low | [balance] Akademi-intake ubetaleligt: signing fee på 760k-1M for 2-stj | Allerede tagget claude:done (akademi signing fee) - verificér løsning er live og lukket. |
| #4037 | 2 | low | [bug] Terraen-DNA mangler paa etaper for igangvaerende loeb (spiller-r | Terræn-DNA mgl. på igangværende etaper - tjek om PR #4012 (badge-fix) allerede dækker det. |
| #4218 | 2 | low | [calendar] S3 udskudt til fredag 28/8 - slut soendag 27/9, loeb hver d | S3 28/8-27/9 m. løb hver dag - iflg. issue allerede besluttet og startet, verificér og luk |
| #4333 | 2 | low | [db] 59 backup_-tabeller i public-skemaet forurener genererede typer | Allerede leveret: commit bb2c20879 'hold backup-tabeller ude af genererede typer + forward-guard (#4333)' matcher praecis. |
| #1290 | 1 | low | [AI-ops] Codex udfases — ryd op i roller, labels, docs og lokal cache | Codex-udfasning er sandsynligvis allerede gennemført (memory bekræfter Claude-only siden 12/6) — verificér labels/docs. |
| #2683 | 1 | low | AI-audit 19/7: oprydning — 7 udløbne scheduled tasks + stale reference | Oprydning af 7 udløbne scheduled tasks fra 19/7 - triviel, sandsynligvis udført. |
| #2689 | 1 | low | AI-opsætnings-audit 19/7: prioriteringsoversigt (10 issues, ~7-11k tok | Parent-issue for 19/7-audit, sub-issues afgør status - luk når alle 10 er afklaret. |
| #2795 | 1 | low | [ux] Egne ryttere/hold skal farvemarkeres i resultat- og deltagerliste | Label allerede claude:done i chunk - verificér og luk hvis PR er merged. |

## Won't-do-kandidater (1)

| # | V | Pri | Titel | Note |
|---|---|-----|-------|------|
| #4116 | 2 | low | [ux] Ugerytmen taler stadig det gamle sprog: intensitet pr. ugedag, og | Ugerytme taler gammelt sprog (intensitet pr. dag), kun 42/2847 ryttere bruger den - overvej fjern/forenkl. |