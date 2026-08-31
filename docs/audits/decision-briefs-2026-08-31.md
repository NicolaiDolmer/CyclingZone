# Beslutningsark 2026-08-31 - alle needs-decision i klar tekst

> Genereret af fuld-backlog-auditten 31/8. Hvert ark: hvad sagen er, de to valg, anbefaling. Ejeren praesenteres for dem ET ad gangen i sessioner - dette er referencedokumentet.


## #1441 - Epic: langsigtet sammenhængende økonomi — anti-inflation, gold sinks, rigtige sp

Sæson-2 sponsor-basen er sat fast til 2,5 mio. kr. som et akut plaster i juni, og nu hvor lønproblemet er løst et andet sted (E2/#1438), er de 2,5 mio. ren inflation: et godt hold går fra break-even i sæson 1 til +1,9-2,3 mio./sæson i sæson 2. Fire spillere har selvstændigt klaget på Discord (6-7/8) over at lønsum og sponsorindtægt føles ude af balance, med konkrete tal (fx 264-300k i kassen). Der findes ingen langsigtet plan for hvor pengene skal komme fra, og hvor de skal forsvinde hen igen (gold sinks).

- **A:** Kør en samlet design-session nu, hvor I lægger principper for pengekilder, pengedræn og en inflationsmålestok, før der bygges mere.
- **B:** Fortsæt med punkt-løsninger (som den midlertidige de-inflation i #1439) og udskyd det store redesign til senere.
- **Anbefaling:** A - spillerne mærker allerede ubalancen i praksis, og endnu et plaster oven på det forrige gør kun oprydningen dyrere senere; tag den store snak nu mens det stadig er en designbeslutning og ikke en krise.

## #1595 - [forever] WS2-backend — PCM-sletning: fjern resultat-pipeline, behold stat_* som

PCM-import (den gamle metode til at indtaste løbsresultater manuelt fra et andet spil) skal fjernes fra koden. Sagen er at man let kan komme til at slette for meget: de samme 14 database-kolonner (stat_ned, stat_bro, stat_fl, stat_ftr osv.) bruges STADIG til at beregne 5 af rytternes evner (fx cobblestone, positionering) - sletning ville nulstille de evner for alle ryttere i spillet. Beslutningen (Option B: slet kun selve import-koden, behold datakolonnerne) blev allerede truffet 23/7 under ejerens mandat om at Claude selv tager tekniske valg - men koden er stadig urørt.

- **A:** Option B (allerede valgt): fjern kun de 5 pcm*.js-filer og import-endpointet, behold stat_*-kolonnerne som stille datakilde til rytterevner.
- **B:** Option A: slet også stat_*-kolonnerne, hvilket nulstiller 5 evner for alle ryttere og kræver en reset.
- **Anbefaling:** Ingen ny beslutning nødvendig - Option B er allerede besluttet 23/7. Det eneste der mangler er at udføre oprydningen (fjerne de urørte filer); "needs-decision"-labelen kan fjernes, issuet bør blot omlægges til et almindeligt todo for selve PR'en.

## #1815 - Design-session: Discord-webhook per etape i etapeløb (i dag kun final-etape)

I dag sender spillet kun ét Discord-opslag om resultater ved sidste etape af et etapeløb - mellemetaper med fulde resultater bliver aldrig postet. Det store designvalg var: skal alle spillere se ét fælles feed, eller kun opslag fra deres egen pulje (der er 15 puljer, så et fælles feed er larm for de fleste)? Ejeren besluttede allerede 23/7: kun egen pulje - men det kræver at kunne koble en spillers Discord-konto til dennes hold, hvilket først bliver muligt når Discord-login (#2161) er bygget.

- **A:** Vent med at bygge etape-webhooks til Discord-login (#2161) er på plads, så per-pulje-synlighed kan håndhæves korrekt fra start.
- **B:** Byg en midlertidig løsning (fx globalt feed eller manuel kanal-opsætning) i mellemtiden, selvom ejeren allerede har afvist et globalt feed som for larmende.
- **Anbefaling:** A - selve designvalget er truffet, det er kun rækkefølgen der mangler. Ingen ny ejer-beslutning behøves; issuet bør mærkes som blokeret af #2161 i stedet for needs-decision.

## #1922 - [feature] Træningsfokus-rework: meningsfulde trade-offs (cykelnørd møder casual)

Det nuværende træningssystem er næsten kosmetisk: uanset hvilket fokus man vælger, stiger næsten alle rytterens evner alligevel (kun 3 procentpoints forskel mellem fokus og ikke-fokus). Ejeren har efterspurgt et rigtigt system med reelle valg, der rummer både cykelnørden og den afslappede spiller. Et fuldt design-svar på alle de åbne spørgsmål (trade-offs, ressource-knaphed, dybde) blev leveret 11/7 i en dedikeret spec.

- **A:** Godkend design-specen fra 11/7 som den nye retning og send den videre til implementering.
- **B:** Bed om en ny designrunde, hvis noget i specen (fx "ingen straf-atrofi i v1") ikke er det du havde i tankerne.
- **Anbefaling:** A - specen svarer allerede punkt for punkt på de spørgsmål issuet selv rejste; needs-decision er reelt indfriet af det leverede design, næste skridt er en implementerings-session, ikke mere afklaring.

## #2259 - [chore] Supabase DB-hygiejne: ryd ~20 backup_*-tabeller + covering-index på unin

Databasen har samlet 59 gamle backup-tabeller fra tidligere prod-oprydninger (117.494 rækker i alt), som ikke bruges til noget aktivt men fylder skemaet og larmer i Supabase-advisoren. Den ældste er 63 dage gammel; 18 af tabellerne mangler dato i navnet, så scriptet tør ikke gætte om de er trygge at slette. Der er også en liste af foreign keys uden index, som kan give langsomme joins/sletninger, men det er lavere prioritet.

- **A:** Godkend at droppe de daterede backup-tabeller der er ældre end fx 30 dage (efter et sidste blik på at de ikke skal bruges til rollback), og lad de 18 udaterede vente til de er identificeret enkeltvis.
- **B:** Behold alle 59 tabeller uændret, indtil hver eneste er gennemgået individuelt.
- **Anbefaling:** A - en 2 måneder gammel sikkerhedskopi der aldrig er brugt til rollback er tryg at slette, og 117k rækker ubrugt data er ren teknisk gæld; brug samme audit-script (#4438) til at markere de 18 udaterede til separat gennemgang.

## #2405 - [afklaring] Taktik tillader flere ryttere i samme rolle (fx breakaway hunter) — 

En spiller spurgte på Discord om det er meningen man kan sætte flere ryttere til samme løbs-rolle (fx flere "breakaway hunter" samtidig). Verifikation viser at koden modsiger sig selv: ved selve holdudtagelsen er det spærret af en database-regel (max én kaptajn/spurtkaptajn/hunter pr. hold), men i selve etape-taktikken (hvor man vælger roller lige før løbet) er der ingen tilsvarende spærring - så spillere KAN reelt sætte flere ryttere i samme rolle på etape-niveau.

- **A:** Gør etape-taktikken konsekvent med holdudtagelsen: håndhæv max én rytter pr. rolle også der.
- **B:** Lad det stå som det er - måske er fleksibilitet på etape-niveau (flere hunters i samme løb) faktisk et bevidst taktisk valg, ikke en fejl.
- **Anbefaling:** A - to lag af samme system der opfører sig modsat af hinanden er forvirrende for spillerne og ligner en glippet spærring snarere end et bevidst design; gør adfærden ens begge steder medmindre der er en klar spilmæssig grund til forskellen.

## #2511 - [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet u

Issuet advarede om at main-branchen kunne vokse forbi bundle-størrelses-loftet ubemærket, fordi hver enkelt pull request kun blev målt isoleret. Det er allerede rettet: siden PR #3689 (merged 13/8) kører budget-tjekket også automatisk hver gang der pushes til main, ikke kun på pull requests. Der resterer to selvstændige punkter fra issuet: at splitte sjældent brugte sprog-tekster ud af hovedfilen (strukturelt performance-arbejde) og en ældre beslutning om at gøre CI-tjek som perf-gaten obligatoriske i branch protection.

- **A:** Luk dette issue som løst (hovedproblemet - ubevogtet main - er rettet) og opret de to resterende punkter (i18n-split og obligatoriske CI-checks) som separate, friske issues.
- **B:** Behold issuet åbent som samlebeholder for alle tre punkter.
- **Anbefaling:** A - selve klagen i issuet (main kan drifte ubevogtet) er faktuelt afkræftet af koden; at holde issuet åbent for to ubeslægtede restopgaver gør det svært at spore hvad der reelt mangler.

## #2582 - [feature] Race-motor: analysér tidsgrænse (broom wagon/cutoff) fra virkeligheden

Ejeren har selv bedt om en realistisk tidsgrænse-mekanik i race-motoren (svarende til cykelsportens "broom wagon"/time cut i virkeligheden), så ryttere der er for langt bagud kan blive sendt hjem fra et løb. Der er endnu ikke taget stilling til, om det skal give en decideret udgåelse (DNF) og om det skal påvirke rytterens stats, moral eller kontrakt.

- **A:** Byg mekanikken nu efter reelle UCI-tidsgrænseregler (typisk en procentdel af vinderens tid), inkl. DNF og effekt på stats/moral/kontrakt.
- **B:** Vent til en dedikeret session hvor scope (DNF ja/nej, konsekvenser) skitseres først, da det er et helt nyt race-motor-feature uden afklaret rækkevidde.
- **Anbefaling:** B — dette bør ikke bygges ad hoc; det er en ny kernemekanik i race-motoren, og de to åbne scope-spørgsmål (DNF? stats-effekt?) skal svares på FØR kodning, ikke undervejs.

## #2622 - [needs-decision] Auto-entry-generator fylder hele sæsonen proaktivt (8.841 entri

Spillet auto-udfylder i dag trupper til ALLE ikke-startede løb i hele sæsonen (8.841 auto-udfyldte pladser), også løb 3 uger ude. Flere spillere har sagt det føles påtvunget at deres trup er "planlagt" for hele sæsonen uden de har bedt om det. Spørgsmålet er om autofill skal begrænses til kun de nærmeste løbsdage.

- **A:** Behold bred autofill for hele sæsonen — spilleren har altid en fuld trup klar, men det føles påtrængende for fjerne løb.
- **B:** Indsnævre til kun de nærmeste løbsdage — mere spiller-kontrol, mindre "hvorfor er min trup udtaget måneder frem".
- **Anbefaling:** Ejeren har allerede (30/7) besluttet at dette skal afklares i en EGEN dedikeret session med flere detaljer, ikke afgøres her — sagen forbliver åben og venter stadig på den session.

## #2650 - [balance/HØJ] Fatigue-mætning i hele populationen: AI-median 100, human-median 9

Ryttere ejet af spillere er markant mere trætte end AI-holdenes ryttere, hvilket flere spillere har klaget over (ingen fremgang, ingen effekt af at rotere truppen). Efter seneste rettelse (dagstype-restitution, live 22/8) er spillernes træthed faldet pænt (median 92→69), MEN gabet til AI-holdene er faktisk VOKSET, ikke mindsket (17→21 points forskel i form). Konklusionen er stadig, at spillet straffer det at spille aktivt.

- **A:** Fortsæt justeringen (yderligere recovery/raceLoad-balancering, evt. lade AI-hold rotere/hvile ligesom spillere) med ny sim-runde før ship.
- **B:** Lad seneste fix (22/8) sætte sig længere og mål igen om nogle uger, før der bruges mere arbejde på det.
- **Anbefaling:** A — gabet blev større efter seneste fix, ikke mindre, så "vent og se" har allerede vist sig utilstrækkeligt; dette er identificeret som årsag til flere aktive brugerklager og bør fortsætte som prioriteret balance-arbejde.

## #2670 - [balance] Udvikl-og-sælg: re-mål ROI mod ægte markedsadfærd + ejer-beslutning om

Der er sat et loft på 250% afkast (ROI) for strategien "udvikl unge ryttere og sælg dem", baseret på en PROJICERET beregning (232%) fra dengang det nye system gik live 18/7. Ejeren ønskede selv at få målt den faktiske, realiserede ROI når der er nok rigtige salg at måle på, og derefter tage stilling til om loftet skal bekræftes eller dæmpes.

- **A:** Kør re-målingen nu på faktiske gennemførte udvikl-og-sælg-forløb (der er gået 6 uger siden cutover, målsætningen var ~2 uger) og tag beslutningen om loftet ud fra ægte tal.
- **B:** Vent yderligere, da der stadig kan være for få reelle forløb til en pålidelig måling.
- **Anbefaling:** A — timingen ejeren selv satte (~2 uger efter cutover) er for længst passeret; det er sandsynligvis tid til at køre målingen og lukke den åbne beslutning med data i stedet for at lade den stå ubestemt.

## #2675 - [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — 

To dele: (1) en teknisk verifikation af at auktionssystemet for udløbne akademi-tilbud kørte korrekt natten mellem 19. og 20. juli — ren bekræftelse, over en måned gammel. (2) en beslutning om 16 ryttere, der 18/7 blev sat til "udløbet" uden auktion pga. en driftshændelse, så 14 spillere gik glip af en (betinget) kompensationschance.

- **A:** Accepter tabet uden handling — rytterne er stadig frit tilgængelige på markedet, kompensationen var alligevel kun betinget af et salg, og påvirkningen pr. spiller er lille og engangs.
- **B:** Ret det manuelt ved at sætte de 16 ryttere på stemplede 24-timers auktioner, så de 14 berørte spillere får deres kompensationschance — kræver en ny manuel prod-mutation i et system der lige havde en hændelse.
- **Anbefaling:** Ejeren har allerede (30/7) besluttet at sagen skal forklares i en dedikeret session, før A eller B vælges — sagen forbliver åben og venter på den session. Når den session kommer: A er den lavest-risiko løsning (lille, engangs, ingen ny prod-mutation).

## #2688 - AI-audit 19/7: Fable-optimering — workflow/judge-panels/effort-routing/ultra-rev

Fire forskellige måder at bruge AI (Claude/Fable) mere effektivt til udviklingsarbejdet — fx at fordele "tænke-indsats" efter opgavens sværhedsgrad, eller lade flere uafhængige AI-forslag konkurrere om de sværeste balance-beslutninger. Issuet stammer fra en AI-audit 19/7 (over 6 uger gammel) og foreslår selv en rækkefølge.

- **A:** Følg den foreslåede rækkefølge: start med effort-routing (gratis, ingen risiko), pilot judge-panels på én afgrænset balance-beslutning, resten senere.
- **B:** Spring over — AI-arbejdsgangs-optimering er ikke kritisk for spillet lige nu, og issuet er 6 uger gammelt og kan være overhalet af senere ændringer i AI-opsætningen.
- **Anbefaling:** Tjek først om effort-routing allerede er indført i mellemtiden (issuet er fra 19/7) — hvis ja, luk med henvisning til at det er implementeret; hvis nej, A er stadig lav-risiko og kan tages med det samme.

## #2689 - AI-opsætnings-audit 19/7: prioriteringsoversigt (10 issues, ~7-11k tok/session a

Dette er en samle-oversigt fra en AI-opsætnings-audit 19/7 med en prioriteret to-do-liste over 10 relaterede issues (fx oprydning i dobbelt-plugins, memory-hygiejne, forældede scheduled tasks). Det er ikke selv en beslutning, men et overblik ejeren prioriterede samme dag. Der er nu gået 6 uger.

- **A:** Behold den åben som tracking-issue indtil alle 10 underliggende issues er lukket.
- **B:** Luk paraply-issuet nu, da de "vigtige, tag i dag"-punkter formentlig allerede er udført for 6 uger siden, og lad de resterende issues stå for sig selv.
- **Anbefaling:** B, men først verificér status på #2679/#2681/#2682/#2680 (de fire mærket "tag i dag") — er de lukket, er paraply-issuet moden til at lukkes med en kommentar der linker videre til de resterende punkter.
- **Kan formentlig lukkes** (afgjort/overhalet - se anbefaling)

## #2798 - [design/balance] Markedsværdien afslører skjult potentiale — v4-værdien er en in

Fordi en ung rytters offentligt synlige markedsværdi beregnes direkte ud fra hans SKJULTE potentiale, kan spillere i praksis "aflæse" et talents loft ved bare at kigge på prisen — uden at skulle scoute eller gætte. Det underminerer bevidst det usikkerheds-system ("fog"), spillet er bygget til at have omkring unge talenter. En spiller har selv bemærket det på Discord ("nu kan man jo bare kigge værdien"), og en måling 30/8 (i går) bekræfter problemet stadig består efter to tidligere justeringsforsøg.

- **A:** Byg støj/båndbredde ind i den offentlige markedsværdi for unge, u-scoutede ryttere, så prisen ikke længere er en 1:1-aflæsning af det sande potentiale.
- **B:** Accepter at markedsværdien reelt afslører potentialet, og drop i stedet det oprindelige fog-koncept omkring unge talenter.
- **Anbefaling:** A — fog omkring unge talenter er et bevidst, ejer-værdsat designvalg (talent-jagt skal være en vurdering, ikke et opslag); løsningen skal gøre selve prisvisningen mindre afslørende, ikke opgive idéen om skjult potentiale.

## #2799 - [balance/HØJ] Markedsværdier eksploderede i halen efter v4-cutoveren — 350k-rytt

V4-omlægningen af markedsværdier ramte i juli en rytter der var handlet for 350.000 CZ$ men blev vist til 22 millioner - og gaten der skulle fange den slags måler kun medianen, ikke halen af meget dyre ryttere. Genmåling 30/8 viser at halen er skrumpet en tredjedel siden juli, og den ene trup der lå urimeligt langt foran resten findes ikke længere - men selve gaten er stadig uændret og ville ikke fange et tilsvarende chok næste gang.

- **A:** Luk sagen som den foreligger nu - markedet har rettet sig selv, og der er ikke akut brug for et indgreb.
- **B:** Byg gaten om så den også tjekker halen (p99/max), ikke kun medianen, så et fremtidigt værdiskifte ikke kan glide igennem samme hul.
- **Anbefaling:** B, men lavt hastende - det konkrete chok fra juli er ovre af sig selv, men fejlen i gaten (måler kun median) er stadig der og vil ramme igen ved næste store værdiændring.
- **Kan formentlig lukkes** (afgjort/overhalet - se anbefaling)

## #2813 - [monetization] CZ Pro kan købes uden handelsbetingelser, opsigelsessti eller opl

Cycling Zone sælger et rigtigt abonnement (CZ Pro, 49 kr/md eller 265 kr/6 mdr) uden handelsbetingelser, uden oplysning om 14-dages fortrydelsesret, og uden en opsigelsesknap i produktet - kunden sendes direkte fra prisknap til betaling. Checkout er sat på pause i dag, men mindst én spiller (@shai2059) har allerede spurgt direkte om Pro er aktivt, så der er et reelt købsønske der venter.

- **A:** Hold checkout'en pause indtil handelsbetingelser, fortrydelsesret og en opsigelsesknap er bygget - spillere der vil betale må vente lidt endnu.
- **B:** Åbn nu (slå pausen fra) og eftermontér juraen hurtigst muligt - fanger betalingsvillige spillere med det samme, men sælger reelt et abonnement uden lovpligtig fortrydelsesoplysning imens.
- **Anbefaling:** A - EU's 14-dages fortrydelsesret er et lovkrav, ikke en nice-to-have, og risikoen ved at sælge uden det vejer tungere end at miste nogle dages salg til en spiller der allerede har vist interesse.

## #2818 - [bug] Endagsløb med rutedata lover point der aldrig uddeles — 266 løb viser "AT 

Rute-grafen på løbssider lover point ('AT STAKE') ved bjerge og spurter selv på endagsløb, men motoren beregner kun den slags point for etapeløb - så løftet indfries aldrig. Det rammer 266 af 455 løb med rutedata (58,5%). Ejeren har allerede svaret direkte på Discord 21/8: 'Der kan ikke være pointspurter og bjergpoint i endagsløb - det skal fjernes derfra.'

- **A:** Fjern løftet fra endagsløb (skjul AT STAKE-mærkerne på bjerge/spurter når løbet ikke er etapeløb) - retningen ejeren allerede har peget på.
- **B:** Byg passageberegning så endagsløb faktisk uddeler de lovede point - en større motorændring, som ejeren ikke har bedt om.
- **Anbefaling:** A - beslutningen er allerede truffet 21/8 ('det skal fjernes derfra'); dette er reelt ikke længere en åben beslutning, kun en ombygning der mangler at blive udført.
- **Kan formentlig lukkes** (afgjort/overhalet - se anbefaling)

## #2824 - [fable] Synlighed udefra: login-vaeg, sprogstier og SEO er ét problem (efter 27/

Hele Cycling Zone ligger bag login i dag - selv patch notes, regler og hjælp - så Google kan kun indeksere forsiden, og 73% af nye brugere (98 af 134 på 30 dage) kommer aldrig tilbage efter første besøg uden at kunne se noget. Tre relaterede issues (login-væggen, sprogflimmer på forsiden, manglende SEO-fundament) hænger sammen og krævede én samlet arkitekturbeslutning i stedet for tre halve fixes.

- **A:** Gennemfør den hybrid-arkitektur ejeren og Claude allerede besluttede 21/8: nyt offentligt marketing-site i Next.js på domænets rod, spil-appen forbliver uændret på egne ruter, EN på roden + DA under /da/.
- **B:** Vent og gør intet - login-væggen og den blokerede SEO fortsætter, 73%-frafaldet uændret.
- **Anbefaling:** A - arkitektur, sprogstruktur og scope er allerede låst 21/8; dette er ikke længere en åben beslutning, kun implementering der venter.
- **Kan formentlig lukkes** (afgjort/overhalet - se anbefaling)

## #2856 - [balance/data] #2694-opfølgning: historisk holdklassement-reparation (<3-finishe

Et hold (Wander Riders) vandt holdklassementet i Tour de la Loire med kun 1 gennemførende rytter og fik 53 point foran 15+ hold med 6 finishers. Fremadrettet er fejlen rettet (motoren kræver nu mindst 3 finishers), men historiske løb med samme fejl står stadig med forkerte resultater og muligvis forkert udbetalt præmiesum - en rettelse er en destruktiv omgørelse af allerede tildelte point/penge, derfor ejer-gated, og kræver en konkret dry-run-liste før noget køres (den blev annonceret 26/7 men aldrig lavet).

- **A:** Genberegn fuldt ud: revertér og genberegn team-point og prize_money for alle ramte historiske løb, efter en dry-run-liste er fremvist.
- **B:** Ret kun standings fremadrettet - lad allerede udbetalte point/penge stå urørt, for ikke at rode i noget spillerne allerede har set eller brugt.
- **Anbefaling:** A - fejlagtigt tildelte point/penge undergraver tilliden til rangeringen hvis de ikke rettes, og det matcher allerede handover-notens egen anbefaling; men et nyt dry-run mod post-cutover-data skal laves og vises til ejeren først, da det gamle aldrig blev lavet.

## #2885 - [feature] Sælg rytter til AI efter N mislykkede auktioner — udvej for hold der i

I dag kan en uønsket rytter kun sælges hvis en anden menneskelig spiller byder - med kun 41 aktive spillere om ugen sker det ofte ikke, og de samme ryttere genudbydes 6-8 gange på to døgn uden salg. En spiller foreslog at kunne sælge til AI'en efter et vist antal mislykkede auktioner, til en lav pris så det ikke bliver en genvej til gratis likviditet.

- **A:** Byg AI-opkøb: fast lav pris (andel af current_production_value, ikke market_value), kun mellem sæsoner, kræver reelt eksponerede auktioner - ikke bare klik.
- **B:** Byg det ikke nu - markedstyndheden er reel, men der er tungere sager i køen (fx compliance-hullet #2813) der bør gå foran.
- **Anbefaling:** A, men lavt prioriteret lige nu - problemet er bekræftet flere gange (også for gode 16-årige på youth-auktioner), men kræver en økonomi-simulering før ship og bør ikke skubbes foran akutte compliance- og balanceissues.

## #2887 - [feature/balance] Sportsdirektør: gør senior-træningsstatten meningsfuld (påvirk

Spillere har to klager over sportsdirektører: ingen ved om træning efter 26 år faktisk bremser en rytters aldersnedgang (og hvis ikke, betaler man løn for en stat der intet gør), og udvalget af sportsdirektører man kan ansætte er så lille at det føles som at skulle hyre nogen man ikke vil have. En senere henvendelse tilføjer et ønske om at direktørens niveau automatisk følger ens faciliteters niveau.

- **A:** Verificér først i motoren om senior-træning rent faktisk påvirker aldersnedgang - kun hvis svaret er nej, er der en balancebeslutning (giv statten effekt, eller fjern/forklar den ærligt); udvid samtidig kandidatpuljen så ansættelse bliver et reelt valg.
- **B:** Lad det stå - lavere prioritet end det der reelt ødelægger spiloplevelsen lige nu.
- **Anbefaling:** A for verifikationsdelen - den er billig og bør gøres uanset - men vent med at udvide kandidatpuljen til der er kapacitet, det er en UX-frustration, ikke en akut fejl.

## #2944 - [balance/design] Styrt er binære (crashed = intet resultat) og opleves for hyppi

Styrt i spillet er alt-eller-intet: rammes en rytter, mister han hele resultatet i stedet for bare tid, og en spiller mistede sin GC-føring i Division 3 på præcis det. En anden spiller fik sin kaptajn styrtet i 3 af 7 løb i sæson 2's første uge, inklusiv et styrt der kostede en etapesejr og gav 6 dages skade oveni - det opleves som urimeligt frem for spændende.

- **A:** Byg graduerede udfald (tidstab/skade i stedet for altid DNF) - kræver en sim-harness mod ægte population og et mål for hvor tæt spillets styrt-rate skal ligge på virkelighedens ca. 1-2% pr. etape, før det ændres i produktion.
- **B:** Behold det binære system, bare tun frekvensen ned mod det virkelige DNF-niveau - simplere, men løser ikke klagen om at ét styrt kan afgøre en hel sæson.
- **Anbefaling:** A - klagen handler lige så meget om at styrt føles unfair (alt-eller-intet) som om at de sker for tit; en ren frekvens-justering løser kun den ene halvdel af problemet.

## #2991 - season_grand_tour_rider kan ingen menneskemanager opnå: Grand Tours er Division-

Achievementet "Grand Tour-hold" kan slet ikke opnås af nogen menneskemanager lige nu. Grand Tours (de helt lange etapeløb) køres kun i Division 1, og Division 1's 24 hold er 100% AI - alle 156 menneskehold sidder i Division 3 og 4. Vejen op er mindst 2-3 sæsoner (D3 → D2 → D1), så achievementet er reelt uopnåeligt i overskuelig fremtid, men står synligt for alle 156 spillere som noget de kan gå efter.

- **A:** Lad det stå som et flersæsoners prestige-mål (nul arbejde) - achievementet betyder "du nåede toppen", ligesom "5 sæsoner"-achievementet allerede gør.
- **B:** Slæk kravet til f.eks. "10+ etaper" eller "din divisions længste etapeløb", så det bliver en reel udfordring i alle divisioner - koster kun at navnet "Grand Tour" bliver upræcist.
- **Anbefaling:** B - et achievement 156 spillere ser men 0 kan røre ved i årevis er dårlig spiloplevelse; at åbne D2 for Grand Tours (mulighed C) kræver ny simulering af hele kalenderen og er ikke det værd for et enkelt achievement.

## #3049 - [feature] Rolle-/taktikvalg pr. rytter i endagsløb (klassikere) — som i etapeløb

I etapeløb kan man selv vælge roller (kaptajn/hjælperytter/fri rytter) og indsats pr. etape. I endagsløb (klassikere) bestemmer motoren det automatisk, og den kan finde på at "ofre" en spiller uden at spørge. En spiller har konkret klaget over dette efter at bjergklassikere kom i division 2-3, hvor det nu koster mere at motoren vælger forkert. Koden er allerede motor-generisk (samme system bruges begge steder), så det er kun en fladegate der skal fjernes - ikke ny funktionalitet.

- **A:** Giv endagsløb hele taktikpanelet (kaptajn + fri rolle + indsats) - samme oplevelse som etapeløb.
- **B:** Giv kun "fri rolle"-delen, uden kaptajnvalg.
- **Anbefaling:** A (hele panelet) - motoren understøtter det allerede fuldt ud, og et beskåret panel bliver bare endnu en særregel at forklare spillerne.

## #3050 - [feature] Venskabsløb / custom turneringer på tværs af divisioner (spiller-opret

En spiller foreslår venskabsløb hvor managere fra forskellige divisioner (som aldrig mødes pga. liga-opdelingen) kan dyste mod hinanden for sjov, uden at det påvirker den rigtige sæson. Det giver spillerne en grund til at logge ind mellem rigtige løbsdage, og er samtidig gratis belastningstest af race-motoren med rigtige mennesker i stedet for kun AI. Der er to mulige udgaver: en simpel version med eksisterende trupper, eller en fuld "custom turnering" med eget budget og rytterkøb (a la Football Manager).

- **A:** Simpelt venskabsløb med eksisterende trupper - genbruger hele race-motoren, kræver ingen ny økonomi.
- **B:** Fuld custom turnering med budget-draft i en lukket simulering - mere feature, men et selvstændigt projekt med ny økonomi-logik.
- **Anbefaling:** A - den er langt billigere at bygge og tester det samme kerneønske ("se hvem der reelt er bedst"); B kan altid bygges ovenpå senere hvis A slår an.

## #3121 - [opfølgning #3013] Mål matview-lockens effekt i prod og beslut om Vej 2/3 er nød

En tidligere fix (PR #3058) delte en tung database-opdatering op i fire mindre bidder, så den ikke låser databasen så længe ad gangen. Før fixet ramte den værste opdatering 7.808 ms mod en grænse på 8.000 ms - altså tæt på at fejle helt. Der mangler stadig en frisk måling af om fixet er nok, eller om der skal bygges en dyrere løsning (ny teknologi, mistet fejl-overvågning). Nyeste data (23/8): efter sæson 3-væksten (+55% flere rækker) fejlede 1 ud af 4 opdateringer alligevel med præcis den ventede timeout-fejl.

- **A:** Nuværende fix (Vej 1) er godt nok - mål effekten igen efter det planlagte sæsonfilter (mandag) og luk sporet hvis tallene holder.
- **B:** Byg en af de dyrere løsninger (Vej 2: ny teknologi til rigtig baggrunds-opdatering, eller Vej 3: separat databaseforbindelse) - koster ny driftsflade og i Vej 2's tilfælde mistet fejl-overvågning.
- **Anbefaling:** A for nu - den planlagte sæsonfilter-ændring mandag adresserer direkte den vækst der fik det til at fejle 23/8; mål igen bagefter før I investerer i en dyrere løsning.

## #3140 - [feature] Off-season: 1 dags buffer mellem sæsonslut og næste sæsonstart

Sæsonen slutter søndag aften og næste starter mandag - så spillerne har reelt kun mandag morgen til at planlægge hele den nye sæson (taktik, kontrakter, sponsorer). Flere spillere har klaget over dette, og internt i teamet er der allerede uenighed om løsningen: du foreslog 24/8 at rykke sæsonstart til torsdag/fredag for bedre planlægningstid, mens en medarbejder mente ventetiden ville føles værre end gevinsten.

- **A:** Indfør en kort bufferdag (evt. flyt sæsonstart til fredag) hvor næste sæsons kalender er synlig og planneren virker, men ingen løb køres.
- **B:** Behold nuværende rytme (sæsonstart mandag) for at undgå "død tid" mellem sæsoner.
- **Anbefaling:** A, men kun 1 dag - løser det akutte planlægningspres uden at skabe lang ventetid; det er den mindste ændring der faktisk retter problemet spillerne rapporterer.

## #3147 - [feature] Sponsor race-day-udbetalinger løbende i stedet for klumpsum ved sæsons

Spillere troede sponsorpenge for afholdte løb først blev udbetalt ved sæsonslut, fordi de ikke kunne SE pengene komme ind undervejs. Det er nu rettet (4/8): Finance-siden viser løbende sponsorindtægt opdelt i grupper, og der kommer notifikationer ved hver udbetaling. Tilbage står kun spørgsmålet om den GARANTEREDE del af sponsoraftalen (som stadig udbetales samlet ved sæsonstart) også skal spredes ud løbende - en ren balance/cashflow-beslutning.

- **A:** Behold garanteret sponsorbeløb som engangsudbetaling ved sæsonstart - synligheden er nu løst, så det oprindelige problem (klager) er allerede væk.
- **B:** Gør også den garanterede del løbende - mere konsistent, men ændrer cashflow-kurven for alle hold og kræver ny balance-vurdering.
- **Anbefaling:** A - kan lukkes. Selve klagen ("jeg kan ikke se pengene") er løst; at ændre selve udbetalingsmekanikken nu er en unødvendig risiko for balancen uden noget aktuelt spillerpres.

## #3152 - [design] Bestyrelses-tilfredshed/omdømme opleves som humør-dræber op til sæsonsl

En spiller er frustreret over at bestyrelsens omdømme-mål trækker humøret og en sæsonslut-bonus ned, uden at spilleren kan gøre noget ved det undervejs - dels fordi omdømme er usynligt i UI'et (42 ud af 67 hold har mål de ikke kan handle på), dels fordi selve optællingen er inkonsistent. Sagen er allerede taget hånd om: den er foldet ind i det større "Mandatet"-rework (epic #3514), hvor du selv har godkendt specifikationen 7/8.

- **A:** Ingen ny beslutning nødvendigt - epic #3514 løser det som en del af hele bestyrelses-mandat-reworket.
- **B:** Lav en hurtig delvis-fix nu (fx gør omdømme bonus-neutral midlertidigt) mens I venter på #3514.
- **Anbefaling:** A, kan lukkes som separat beslutning - du har allerede godkendt løsningen via #3514 7/8; issuet holdes kun åbent som pointer indtil den leverance lander, der er ikke noget nyt at tage stilling til her.

## #3200 - [feature] Ejer-direktiv 3/8: spiller-til-spiller-beskeder i spillet (design-samt

Du gav selv direktivet 3/8 om at bygge spiller-til-spiller-beskeder i spillet, og satte 25/8 en hård deadline: det skal virke "senest i sæson 3" (som løber 28/8-27/9). I dag foregår al spillerkommunikation på Discord, som kun ca. 25% af holdene er koblet til - resten er isoleret. Der mangler stadig en designbeslutning om omfang: skal det være simpel 1:1-besked, eller også puljetråde, kobling til handelstilbud og moderation fra dag ét?

- **A:** Byg minimal 1:1-besked-funktion nu for sikkert at nå deadline, og skub gruppetråde/handel-kobling/moderation til en senere version.
- **B:** Byg det fulde scope (1:1 + puljetråde + handelskobling + moderation) i én omgang før deadline.
- **Anbefaling:** A - deadline er under en måned væk, og et for stort scope er den mest sandsynlige måde at IKKE nå fristen du selv har sat; få den enkle version i produktion, byg resten ovenpå i sæson 4.

## #3328 - [balance] Løbsklasse og etapeantal er afkoblet: 32 af 36 D2-etapeløb er ProSerie

I Division 2 er 32 ud af 36 etapeløb ProSeries — den laveste løbsklasse — og de er næsten lige så lange som de bedre betalende WorldTour C-løb (5,6 mod 6,5 etaper i snit, ét ProSeries-løb har 8 etaper). Der findes ingen WorldTour A/B-etapeløb i D2 overhovedet. Spillerne bruger altså flest dage på netop de løb der giver mindst i præmie og point — et omvendt incitament, ikke bare en nuance.

- **A:** Kobl klasse → etapeantal → belønning som fast regel i kalender-generatoren (ProSeries kort/basis-præmie, WorldTour længere/højere præmie) og revidér klassefordelingen pr. division tilsvarende.
- **B:** Lad strukturen stå som den er og accepter at klasse ikke afspejler løbslængde.
- **Anbefaling:** A — men mål præmie/point pr. rytterdag pr. klasse før/efter i stedet for at gætte tallene; retningen (kobl længde til klasse) er tydeligt rigtig ud fra de målte tal.

## #3345 - [BLOCKER for #3325] Ryttertypen driver markedsværdien — omklassificering revalue

Da ryttertyper blev omklassificeret (#3325), var frygten at markedsværdien på alle ryttere ville flytte sig uden at en eneste evne ændrede sig — en stille revaluering af hele økonomien (transferpriser, gældsloft, m.m.). Ny måling 30/8 viser at frysningen af rytterens gamle type til værdiberegning virker (3.414 af 7.487 aktive ryttere er omklassificeret, men ingen har fået ny værdi), og at en type-dæmpning indført 23/8 har skåret forskellen mellem billigste og dyreste type fra 9,1x til 1,6x.

- **A:** Luk issuet som leveret — blockeren for #3325 er afviklet — og lad restopgaven (re-fit værdimodellen mod den nye klassifikation, fjern den midlertidige fallback i koden) ligge som accept-kriterie i #3353.
- **B:** Behold issuet åbent som hjemsted for rest-oprydningen indtil #3353 er færdig.
- **Anbefaling:** A (kan lukkes). Tallene viser blockeren er væk; at holde et åbent blocker-issue for en allerede merget og verificeret fix gør backloggen sværere at læse — restarbejdet hører hjemme i #3353, ikke her.
- **Kan formentlig lukkes** (afgjort/overhalet - se anbefaling)

## #3350 - [produkt] Spillerne gætter på reglerne — fire testere byggede fire private model

Fire erfarne testere brugte samme dag på at gætte sig frem til spillets skjulte regler (træthed, off-days, restitution) og byggede private regneark, fordi spillet ikke forklarer sig selv. Opfølgning 17/8 viser at tre af de fire delproblemer allerede er løst af andre features (efter-etape why-rapport, info-ikoner før løb, kommende event-log); det eneste der reelt mangler er én samlet side der forklarer mekanikkerne i klart sprog.

- **A:** Fold restopgaven (en 'sådan virker det'-side) ind i den allerede planlagte transparens-session, som ligger lige efter den kommende træningsreform — så siden skrives mod de nye regler i stedet for at skulle omskrives bagefter.
- **B:** Skriv en delvis regelbog nu (kun de kapitler der ikke rammes af træningsreformen: terræn, off-days, udbrud, roller) og lad træningskapitlet vente.
- **Anbefaling:** A — en halv regelbog skaber nye spørgsmål i stedet for at løse dem, og transparens-sessionen har allerede mandat og de rette folk til opgaven.

## #3360 - [balance/HØJ] Pengemængden firdobles over 5 sæsoner (4,24x mod mål 1,3x) — gaten

Pengemængden i spillet vokser 4,24x over 5 sæsoner mod et mål på 1,3x. Det er nu bekræftet med et rigtigt regnskab, ikke bare et scorecard: i sæson 2 blev der skabt 94,18 mio. og destrueret 54,84 mio. — et overskud på 39,34 mio. fordelt på 199 hold. Den største enkeltfejl er lønberegningen (5,6-60x for lav i forhold til det oprindelige gæt), ikke præmierne, og halvdelen af alt der forsvinder går til auktionskøb hos banken.

- **A:** Følg den foreslåede rækkefølge: ret lønberegningen (#3393) først, rekalibrér derefter upkeep og præmier mod de nu kendte, korrekte tal.
- **B:** Angrib i stedet det største dræn direkte med et fladt nedslag i rytterværdier ved auktion, som tidligere foreslået.
- **Anbefaling:** A — B er allerede afprøvet på tallene og gør problemet værre, fordi det skrumper det største dræn i økonomien; rækkefølgen løn-fix før upkeep-rekalibrering er den eneste der retter roden i stedet for symptomet.

## #3413 - [balance] Udbrudsforsøg er gratis (ingen fatigue, ingen placeringsrisiko) — 2 sp

Et udbrudsforsøg koster i dag intet — ingen ekstra træthed, ingen risiko for egen placering — så der findes ingen situation hvor det er forkert at prøve. To spillere har selv (ironisk) bemærket det i Discord som en gratis bonus. Det er ikke en bug, men et design-signal: en kernetaktik i motoren mangler en afvejning.

- **A:** Giv udbrudsforsøg en reel pris, fx lidt ekstra fatigue eller reduceret slutchance ved et mislykket forsøg.
- **B:** Behold 'gratis bonus' som et bevidst designvalg og lad det stå.
- **Anbefaling:** A, men først sammen med #2416 (udbrud v2) og kun efter en dry-run mod en ægte spillerpopulation — dette rører race-motorens balance direkte og skal ikke ships på et gæt.

## #3425 - [nav/mobil] Planlægning i mobilbundbaren — beslutning A/B på Clarity-tal (restpu

Mobilbundbaren har 5 punkter, men Planlægning — hvor spillere sætter hold og taktik — er ikke et af dem, selvom det er appens næstmest besøgte mobilflade (3.615 sessions/30 dage), foran både Ryttere og Indbakke som ER i baren. 'Mit Hold' er til gengæld barens mindst brugte punkt (1.486 sessions).

- **A:** Udskift 'Mit Hold' med 'Planlægning' i baren — Mit Hold forbliver ét tryk væk i menuen.
- **B:** Tilføj Planlægning som 6. punkt uden at fjerne noget, men det presser touch-målene ned til ~62px på en 375px-skærm, under den aftalte 44px-regel.
- **Anbefaling:** A — det er den oprindelige anbefaling fra 31/7, understøttet af Clarity-tallene, og B bryder en allerede vedtaget touch-target-regel.

## #3460 - [bug/balance] effort er ikke koblet til kaptajnens støtte — 'Spar kræfter' er gr

Under et løb kan man vælge 'Arbejd', 'Normal' eller 'Spar kræfter' for en hjælperytter, men koden læser aldrig dette valg når kaptajnens støtte beregnes. Resultatet: 'Spar kræfter' giver kaptajnen præcis samme støtte som 'Arbejd', bare med mindre træthed og halveret placeringsstraf for hjælperytteren selv — så der er reelt aldrig en grund til at vælge 'Arbejd'. Ejeren har selv bekræftet det er en fejl (6/8), og en spiller beskrev 27/8 uopfordret præcis den optimale-men-utilsigtede strategi issuet forudså.

- **A:** Ret koden så kaptajnens støtteberegning rent faktisk læser rytterens effort-valg, som specen (§8) altid har foreskrevet (halvt bidrag ved 'spar kræfter', fuldt ved 'arbejd').
- **B:** Fjern koblingen helt og drop 'Arbejd'/'Spar kræfter' som et falsk valg i UI'en.
- **Anbefaling:** A — det er en bekræftet bug mod projektets egen spec, ikke et designspørgsmål; B smider en tiltænkt taktisk mekanik væk i stedet for at rette den.

## #3471 - [feature] Kalender-spor med identitet (GT-spor / WT-spor / klassiker-spor) — spi

En spiller foreslår at give kalenderens eksisterende parallelle 'baner' (faste tidsslots pr. division) en identitet — ét spor for Grand Tours/klassikere, ét for WorldTour-etapeløb, ét blandet — i stedet for at et løbs bane bare er et tilfældigt biprodukt af pakningen. Det ville gøre det nuværende overlap i kalenderen (flere løb samtidig) forståeligt som 'tre parallelle historier' og åbne for ægte holdtaktik (fx A-holdet i GT-sporet, B-holdet til klassikerne).

- **A:** Design og byg spor-identiteten oven på den eksisterende bane-struktur.
- **B:** Lad banerne forblive rene tidsslots uden fortælling, som i dag.
- **Anbefaling:** A på sigt, men først efter en designrunde om rytterbindingen — et GT-spor binder ryttere i op til 21 dage, hvilket rammer smalle hold hårdt, og det skal designes igennem før noget bygges.

## #3564 - [design] Progressionskæden samlet: potentiale 1-99, lofter pr. ryttertype, træni

Progressionskæden (potentiale, lofter, startniveau, vækstkurve) er skåret ned til to reelt åbne spørgsmål efter din afklaring 19/8 om træningsscore (den er nu afgjort: den ER rytterens synlige udviklingsfart, ikke et nyt begreb). Tilbage: (1) skal scouting vise et eksakt potentiale-tal eller kun et interval, hvilket rører #1138's scouting-mekanik og en hård backend-regel om at rå potentiale aldrig forlader serveren; (2) betyder "8 potentialer pr. ryttertype" otte uafhængige lofter, eller ét samlet potentiale fordelt efter type?

- **A:** Eksakt tal + otte uafhængige lofter — mest gennemsigtigt for spilleren, men bryder reglen om at rå potentiale ikke må vises og kræver mere UI.
- **B:** Range/interval + ét fordelt potentiale — bevarer scouting-usikkerheden og databeskyttelsen, men er en større omskrivning af nuværende visning.
- **Anbefaling:** B — bevar range-visning og fordelt potentiale, fordi det respekterer den eksisterende backend-regel og scouting-spændingen (#1138) uden en ny undtagelse. Kræver stadig dit eksplicitte ja, da det er et designvalg, ikke en bug.

## #3577 - [investigation] #3561-efterspil: spillere tog lån og solgte ryttere for at byde 

En spiller (@knud_r_flink) tog lån og solgte/fyrede ryttere for at kunne byde på defekte akademi-ryttere fra #3561; refusionen (gennemført kl. 12:42, meddelt sent — ca. 12 timers tavshed) dækkede kun selve buddet, ikke lånerenter eller tabet ved tvangssalg. Sagen blev fulgt op 10/8: du tilbød selv at tilbageføre lånet og spurgte spilleren om salget af hans to ryttere også skulle rulles tilbage.

- **A:** Afslut som løst for denne spiller — du har allerede tilbudt at reversere lånet, og der er ikke evidens for at andre har klaget over samme følgeskade.
- **B:** Gør et generelt datatjek (finance_transactions + transfer-log 8/8 nat → 9/8) for at finde ALLE hold der optog lån eller solgte i vinduet, ikke kun den ene der klagede — han peger selv på at modbydere kan have gjort det samme uden at være på Discord.
- **Anbefaling:** A for den konkrete sag — den er allerede afsluttet i tråden samme aften. B er kun værd at bruge tid på hvis du vil sætte en generel præcedens for "kompensation findes i data, ikke kun blandt dem der klager", hvilket hænger sammen med #3647's kompensations-regel.
- **Kan formentlig lukkes** (afgjort/overhalet - se anbefaling)

## #3595 - [balance] Sponsormål kan ignoreres uden konsekvens — pengene udbetales med det s

Et sponsormål udbetaler pengene med det samme, uanset om målet reelt bliver opfyldt — du bekræftede det selv i tråden ("pt kommer pengene med det samme"). To spillere har allerede regnet ud i realtid at det derfor er gratis at ignorere målet, så det er reelt en udbetaling med flavour-tekst, ikke en beslutning der koster noget.

- **A:** Tilføj en konsekvens ved manglende opfyldelse — reduceret fornyelse, lavere rate næste sæson eller clawback — så målet igen kræver en prioritering.
- **B:** Omdøb/re-design målet så det ikke lover en konsekvens det ikke har.
- **Anbefaling:** A — en reel konsekvens genopretter formålet med mekanikken og matcher bedre spillernes egen forventning. Bør dog først verificeres i kode om der overhovedet findes en opfyldelses-kontrol ved sæsonslut, før valget låses endeligt.

## #3614 - [balance] 142 frie ungdomsryttere fra gamle akademi-kuld er over ungdomsbåndet —

142 gratis tilgængelige ungdomsryttere fra gamle akademi-kuld har evner langt over hvad unge ryttere må have — værste er 19 år med evne 54 og 2,1 mio. i værdi, mod at en frisk kandidat topper på 12. Der er to tidligere rettemetoder: en mild der kun sænker fremtidigt loft, og en fuld der regenererer nuværende stats (allerede brugt på 14 lignende tilfælde 10/8). Et dry-run 18/8 fandt intet reparerbart lige nu, fordi resten sidder fast i aktive auktioner — planen om at genkøre det ~22/8 er passeret uden opfølgning.

- **A:** Mild metode (#3064) — sænk kun potentiale/fremtidigt loft, lad nuværende evner stå urørt indtil de udløber naturligt.
- **B:** Fuld nedjustering, samme metode som brugt på de 14 aktive tilbud 10/8 — regenerér stats med nuværende kalibrering, med varsel til evt. ejere først.
- **Anbefaling:** B, for konsistens med hvordan samme fejlklasse allerede blev rettet 10/8 — #3064's præmis om at nuværende evner var okay holder ikke længere ifølge issuet selv. Praktisk skridt: genkør dry-run'et nu, da 22/8-datoen er passeret.

## #3616 - [balance] Ungdomsbåndet er for lavt i bunden og fladt i toppen — 16-17-årige und

Ungdomsryttere fødes svagere end den aftale du selv låste i #2064 §2a (16-17-årige rammer bedste evne 4 mod aftalens 6), og alle 21-årige fødes med præcis samme tal (evne 12, intet spænd), så man ikke kan se forskel på et stort og lille talent ved graduering. Begge dele er kendte og ikke farlige — de blev først synlige da 762 nye kandidater 10/8 gav nok data til at se mønsteret tydeligt.

- **A:** Hæv kun medianen i bunden (16-19 år) til at ramme §2a ved at justere base-værdien — værktøjet findes allerede (checkYouthBand2064.mjs).
- **B:** Løs også det flade loft i toppen nu (21-årige alle på 12) — kræver ændring i statCeilBoosted og hænger sammen med det bredere loft-arbejde i #3664.
- **Anbefaling:** A alene lige nu — isoleret, målbar justering med værktøj klar. B bør vente og kobles til #3664 (rating-fundamentet), da begge handler om at gøre potentiale/loft synligt differentieret; at løse det to gange er spild.

## #3633 - [chore] Slet #3570-backuptabellerne naar rollback-vinduet lukkes

To backup-tabeller fra #3570-reparationen (11/8) ligger stadig i prod som et frosset øjebliksbillede af hele rytterbestanden inkl. værdier — 8.752 rækker hver. Et opfølgende tjek 30/8 bekræfter: rollback-vinduet er teknisk lukket (dit eget kriterium, S3-cutoveren, skete 23/8), og ingen aktiv kodesti bruger tabellerne længere. Det eneste tilbageværende er din go til selve sletningen.

- **A:** Slet nu — dit eget kriterium er opfyldt, og verifikationen 30/8 fandt intet der stadig afhænger af tabellerne.
- **B:** Vent yderligere som ekstra sikkerhedsmargin, selvom lukke-kriteriet allerede er opfyldt.
- **Anbefaling:** A — kriteriet du selv satte er passeret og uafhængigt bekræftet. At lade dem ligge længere øger kun risikoen for utilsigtet læsning af en fuld værdi-snapshot uden at give reel ekstra sikkerhed.
- **Kan formentlig lukkes** (afgjort/overhalet - se anbefaling)

## #3647 - [design] Skriv kompensations-reglen ned: hvornår holdes en spiller skadesløs?

Du har kompenseret spillere flere gange i august (akademi-kuldet 10/8, fire managere med fuld refusion, BPTrain der stadig mangler 40.000 CZ$) uden en nedskrevet regel for hvornår det sker. Det gør det uforudsigeligt for spillerne og svært at svare konsistent på "hvorfor fik han og ikke jeg?". Din kerneregel — kompensér når spilleren tog en beslutning, betalte for den, og grundlaget bagefter ændrede sig — mangler stadig klare kanter (hvad tæller som betalt, grænsen mod almindelig balance-ændring, passiv skade, bagatelgrænse).

- **A:** Skriv reglen ned som en intern retningslinje kun til dig selv og fremtidige AI-sessioner.
- **B:** Skriv reglen ned og vis den offentligt til spillerne (hjælp/regler).
- **Anbefaling:** A først — formulér reglen og test den bagud på august-sagerne, som issuet selv foreslår. Overvej offentliggørelse senere når reglen har vist sig holdbar; en utestet offentlig regel risikerer at du skal forsvare kanttilfælde du ikke har gennemtænkt endnu.

## #3664 - [design] Rating-fundamentet v3: én skala, vægtet snit af rollens evner, evne-reg

Rating vises i dag i to forskellige skalaer på samme rytterprofil (fx 88-95 på Scouting mod ~60-70 i Udvikling-fanen for samme loft). En ny Discord-melding 26/8 viser konsekvensen konkret: en rytter der er bedre på ALLE evner end en anden kan alligevel få 7 point lavere rating, fordi hans hovedtype vægter evnerne anderledes. Designet (vægtet snit af rollens evner, ét tal, én betydning) blev låst med dig 13/8, men det blokerende åbne punkt er at de 8 rolle-opskrifter giver meget forskellige spænd på samme median-rytter (6,7 for bjergrytter mod 14,5 for baroudeur), kun fordi rollerne består af forskellige evner.

- **A:** Normalisér opskrifternes spænd så de bliver sammenlignelige på tværs af roller — bryder dog princippet fra 13/8 om "ingen normalisering, ingen kurve".
- **B:** Behold princippet (rå vægtet snit) og ret i stedet selve vægt-opskrifterne pr. rolle, så "bedre i alt = højere rating" altid holder, uden en global kurve.
- **Anbefaling:** B — normalisering ville underminere hele pointen med redesignet og genskabe det gamle problem i ny form. At rette vægtene pr. rolle er en snævrere, mere verificerbar rettelse. Dette er dog stadig et blokerende designvalg spec §6 selv flagger — bør afklares konkret med dig, ikke antages.

## #3668 - [balance] Evnerne er ikke paa samme skala indbyrdes — taktik median 38, bjerg me

De 15 evner en rytter har (taktik, sprint, bjerg osv.) vises alle på samme 1-99-skala i UI'et, men de er det ikke reelt. 10 fysiske evner (fx bjerg, sprint) er kørt gennem en matematisk 'kontrast-forstærkning', mens 5 evner (taktik, aggression, positionering, nedkørsel, brosten) ikke er det. Konsekvensen: median-rytteren har taktik 38 men bjerg 5 — ikke fordi han er meget bedre til taktik, men fordi de to tal måles helt forskelligt. Det smitter direkte af på rating-tal (samme rytter kan få 6,7 eller 14,5 alene afhængig af hvilke evner rollen bruger).

- **A:** Kør de 5 tekniske/mentale evner gennem samme kontrast-forstærkning som de 10 fysiske, så alle 15 evner deler skala.
- **B:** Byg en anden, separat normalisering til de 5 evner, der matcher fordelingen uden at genbruge den eksisterende forstærkningsmetode.
- **Anbefaling:** A — genbrug den løsning der allerede findes og er velafprøvet i koden, i stedet for at designe en ny normalisering fra bunden. Rækkefølgen med #3512 (dette issue først) er allerede ejer-besluttet 13/8; den udestående beslutning er kun selve behandlingsmetoden.

## #3719 - [balance] Kalenderen har intet præmiepulje-budget pr. division — variations-besl

Kalenderen bestemmer hvor mange løbsdage hver division får (140/112/84/56), men ingen konstant styrer hvor mange PENGE en division uddeler i præmier — det er et tilfældigt biprodukt af hvor mange endagsløb vs. etapeløb der vælges. Det betyd, at en beslutning om at justere 'variation' (#3327) utilsigtet flyttede division 2's præmiepulje +39% og division 3's -13% mellem sæson 2 og 3, fordi et endagsløb giver 1,7x så mange point pr. løbsdag som et etapeløb.

- **A:** Sæt et eksplicit præmiepulje-mål pr. tier nu, plus en automatisk fejlmelding hvis den genererede kalender afviger over 5%.
- **B:** Vent med at bygge håndhævelsen til efter cutover, og træf først valget mellem multiplikator vs. klasse-whitelist i en kalibreringssession med friske sæson-3-tal.
- **Anbefaling:** B — det er allerede ejer-besluttet 19/8. Løsningen kræver et A/B-valg (multiplikator vs. klasse-whitelist) som er bedre truffet med rigtige S3-tal end på forhånd. kan_lukkes-vurdering: ikke luk, sagen er aktivt planlagt, ikke afgjort.

## #3720 - [balance/HØJ] #1441 A6-kalibreringen antog en præmie der er 3,7-6,6x for lav — u

Da 'upkeep' (drift-omkostning) pr. division blev sat i juni (#1441), regnede man med at et hold i division 1 kun fik 160.000 kr i præmie over en sæson. Målt på rigtige tal er det 586.000-588.000 kr — 3,7 gange højere. Samme fejl gælder division 2 og 3 (3-7 gange for lavt). Resultatet: ingen division er tæt på det økonomiske mål, holdene tjener 18-26 gange mere end tilsigtet, og det bliver akut fordi 24 nye menneskehold rykker op i division 1 ved sæsonskiftet og får adgang til hele den for store pulje.

- **A:** Ret upkeep-tallene nu, inden de 24 nye D1-hold rykker op ved sæsonskiftet.
- **B:** Vent til kalibreringssessionen efter cutover, og ret upkeep sammen med præmie-beslutningen (#3719) mod ægte S3-indtægtsdata.
- **Anbefaling:** B — allerede ejer-besluttet 19/8, koblet direkte til #3719's tidsplan. Risikoen ved at vente er kendt og accepteret af ejeren; en isoleret hasteændring uden opdaterede tal ville formentlig ramme forkert igen.

## #3813 - [investigation] Rytterens sekundaere type matcher ikke altid hans naesthoejeste 

Spillere prøvede at bruge en rytters type (fx 'klatrer') til at gætte hans skjulte potentiale, men det passede ikke — en rytter kunne have højere potentiale-tal i en evne der IKKE var hans type. Kode-analyse 30/8 viser at de underliggende lofter faktisk ER korrekt koblet til typen, men det spilleren SER (spejder-båndene) er beregnet på en anden måde der ikke garanterer samme rækkefølge — hver evne-bånd har sin egen tilfældige spejder-usikkerhed, så to nære bånd kan bytte plads uden det er en fejl.

- **A:** Copy-fix: forklar i UI/Hjælp at båndene er uafhængige spejder-estimater og at rækkefølgen mellem to nære typer ikke kan bruges til at læse potentiale. Ingen kodeændring.
- **B:** Motor-fix: lav én fælles tilfældig 'spejder-usikkerhed' pr. rytter (i stedet for én pr. evnetype), så støjen flytter alle bånd samme vej og rækkefølgen mellem typer bliver pålidelig. Rører al scouting-visning.
- **Anbefaling:** A — hurtigt, ingen risiko for balance-drift, og løser det spillerne faktisk beder om (at kunne stole på det de ser). B er en større motor-ændring der bør vente til der er stærkere grund til at ændre selve scouting-mekanikken.

## #3967 - [feature] Fog of war: vis potentiale som ord/interval i stedet for praecist tal 

Flere spillere ønsker at rytterens potentiale vises som et ord (fx 'enormt / lovende / fornuftigt') i stedet for et præcist tal, så man ikke kan regne sig frem til hvem der bliver bedst i spillet. Ejeren er principielt enig og vil gerne udvide 'fog of war' generelt, men har ikke besluttet om det kun gælder potentiale eller alle stats — og spillerne er selv uenige om hvor langt det skal gå (én mener det er 'ikke online-spils-venligt' at skjule for meget).

- **A:** Byg det afgrænset til potentiale nu (ord + range på hover), som spillerne konkret bad om.
- **B:** Vent med at bygge noget, til den bredere linje for fog-of-war på ALLE stats er afklaret, så potentiale-løsningen passer ind i en samlet strategi.
- **Anbefaling:** A — ejeren har allerede tilkendegivet retningen positivt for potentiale specifikt, og en afgrænset ændring her låser ikke den bredere diskussion om alle stats, som kan tages separat når den er mere moden.

## #3982 - [feature] Etapestriben fase 2: resultat-piller (top 5 + eget hold) efter koersel

Spillere har foreslået at etape-kortet på dashboardet får resultat-info: efter et løb top-5 + eget holds placeringer, og før løbet en 'optakt' med forventede favoritter/GC-stilling. Ejeren er positiv, men optakt-delen kræver en 'forventede favoritter'-model der ikke findes som spillervendt koncept endnu.

- **A:** Byg resultat-piller (efter-kørsel-delen) nu — den kræver ingen ny model, kun eksisterende resultatdata.
- **B:** Vent med hele feature og byg det samlet, når favorit-modellen til optakt-delen er designet.
- **Anbefaling:** A — lever den halvdel der er klar til at bygge med det samme, i stedet for at lade en ufærdig model blokere en færdig, efterspurgt del. Optakt-delen kræver stadig en selvstændig design-beslutning fra ejeren før den kan bygges.

## #3984 - [feature] Samlet indstillings-omraade (manager/almindelige/hold) + nationalitet 

Ejeren har eksplicit bedt om ét samlet indstillings-område med tre sektioner: managerprofil, almindelige indstillinger (sprog, privatliv, notifikationer — i dag spredt rundt om i spillet), og holdindstillinger. Første konkrete feature i det er at manager og hold hver kan vælge nationalitet, som bestyrelsen på sigt husker og tager hensyn til. Fire eksisterende issues (#1108, #1239, #3104, #934) hænger sammen med dette og bør foldes ind.

- **A:** Byg ét nyt, samlet 'Indstillinger'-område (T1-skabelon) med de tre sektioner, og flyt nationalitet + eksisterende spredte indstillinger ind i det fra start.
- **B:** Tilføj kun nationalitet som et enkelt nyt felt på de eksisterende profil-/hold-sider nu, og udskyd den samlede IA-omlægning til senere.
- **Anbefaling:** A — det er præcis det ejeren bad om ('et samlet område'), og at lappe nationalitet ind isoleret nu betyder dobbeltarbejde når den samlede struktur alligevel skal bygges bagefter. Kræver stadig en design-session med konkrete forslag før byg, som ejeren selv bad om.

## #4033 - [economy] Akademi-upkeep kan undgaas ved oprykning lige foer saesonslut (spiller

En spiller opdagede at man kan spare akademi-driftsudgiften (op til ~40.000 kr) ved at rykke ryttere op fra akademiet til seniorholdet lige før sæsonen slutter — fordi upkeep kun opkræves i ét snapshot ved sæsonstart, ikke løbende. Verificeret i koden 30/8: hullet er reelt, og der findes allerede en løsning i spillet til præcis samme fejltype for almindelig løn (en dagsbaseret opkrævning, indført i #2840/#3256), som bare aldrig blev udvidet til akademi-drift.

- **A:** Pro-rata: akademi-upkeep beregnes efter antal dage rytteren faktisk sad i akademiet — samme mønster som allerede bruges til almindelig løn. Kræver en ny tabel/kolonne til historik.
- **B:** Flyt snapshot-tidspunktet til sæsonslut i stedet for sæsonstart (enklere, men straffer den der rykker op midt i sæsonen) — eller lås oprykning tæt på sæsonslut (indfører en ny regel spilleren skal lære).
- **Anbefaling:** A — spejler den løsning ejeren allerede har godkendt for løn, så økonomien bliver konsistent, og fjerner incitamentet helt uden at straffe normal oprykning eller indføre en ny regel spillerne skal huske.

## #4074 - [billing] EN /pro viser kroner, men Alunta opkraever DKK for alle - euro-regel +

Den engelske /pro-side viser priser i kroner (fx "49 kr/mo"), men betalingsudbyderen Alunta opkræver reelt alle brugere i DKK uanset sprog. Ejerens egen regel (21/8) siger at engelsk spillerrettet tekst om rigtige penge skal vise euro, ikke kroner - og det viste beløb på Terms-siden er juridisk bindende, så det er ikke kun kosmetik. Lige nu er der kun 1 aktiv betalende kunde, så det er billigst at rette nu, før checkout åbnes for flere (blokerer #4005/#2813).

- **A:** Opkræv alle - også danskere - i euro: ét beløb, ingen landedetektion, dansk side viser "€6,49 (ca. 48 kr)".
- **B:** Behold DKK-opkrævning for alle og ret kun den engelske tekst til at vise DKK i stedet for euro.
- **Anbefaling:** A - ejeren har allerede godkendt prispunkterne €6,49/md + €34,99/6md (21/8), og "vis euro, træk DKK" er det juridisk problematiske scenarie TermsPage-teksten ville skabe. Kan ikke lukkes: Alunta-EUR-planer, plan-peg i checkout og migrering af den ene eksisterende abonnent mangler stadig at blive udført.

## #4099 - [ux] Fysiologi-siden opleves ligegyldig - behold, fold ind eller fjern (smukketh

En aktiv tester foreslog 21/8 at fjerne fysiologi-siden helt, fordi den "virker ligegyldigt" - ingen andre i tråden forsvarede den. Ingen har målt om spillere rent faktisk bruger siden, eller om tallene på den nogensinde ændrer et valg (udtagelse, træning, køb) - uden det er de bare pynt.

- **A:** Mål først (Clarity: sidevisninger/tid/andel aktive der åbner den) og hvilken beslutning tallene skal bære, beslut derefter behold/fold ind/fjern.
- **B:** Spring målingen over og fold de vigtigste tal ind på rytterprofilen med det samme, fjern den selvstændige side.
- **Anbefaling:** A - at fjerne en hel flade er svært at fortryde på brugeroplevelsen, og et opslag i Clarity koster stort set intet. Kan ikke lukkes: målingen er slet ikke lavet endnu.

## #4103 - Ejer-direktiv 21/8: kalender-audit S3 - typefordeling, brosten, enkeltstarter, p

Ejeren bad 21/8 om en fuld opgørelse af sæson 3-kalenderen pr. division (løbstyper, brosten, enkeltstarter, point vs. præmiepenge) og om at få at vide om kalenderen overholder sine egne regler. Issuet blev fejlagtigt markeret færdigt uden at rapporten var leveret - og en genmåling 25/8 (efter kalenderen blev genereret forfra under #4218) viser at et af de kendte regelsæt reelt er brudt i alle fire divisioner: klatre-etape-målet (12%) rammes kun med 5,6% i D2, mens D4 ligger på 16,1%. Stage-mixet fra PR #4140 overlevede altså ikke regenereringen.

- **A:** Ret kalenderen nu - genkør/patch S3-programmet så det matcher de aftalte mål (ITT 10%, brosten 5%, high_mountain 12%, ±2pp), og lever rapporten bagefter.
- **B:** Lever rapporten først som en status over hele billedet, og tag beslutning om en midtsæson-patch (eller vent til S4) som et selvstændigt, ejer-godkendt skridt.
- **Anbefaling:** B - S3 er allerede live og spillere har planlagt sæsonen ud fra den; at omkalibrere banetyper midt i sæsonen er et større indgreb der kræver at ejeren ser konsekvenserne live først, ikke noget der køres autonomt. Kan ikke lukkes: hverken rapporten eller regel-bruddet er afklaret.

## #4129 - Sæsonskifte-guarden kører på et gæt: season_transition_planned_at bliver aldrig 

Guarden der skal forhindre auktioner i at løbe ind i et sæsonskifte, kører på et gæt (kl. 18:00 dagen før), fordi ingen kode nogensinde sætter den rigtige nøgle (season_transition_planned_at). Ved seneste cutover 23/8 blev nøglen kun sat manuelt af ejeren via SQL og ryddet igen bagefter - den blev aldrig en fast del af drejebogen. Denne gang ramte gættet den sikre side (blokerede lidt for meget), men det var held: næste sæsonskifte (S3 slutter 27/9) rammer samme situation igen medmindre nogen husker det manuelt.

- **A:** Gør det til et fast, tjekket trin i cutover-drejebogen: sæt nøglen manuelt før transition, ryd den bagefter - ingen kodeændring, kun proces-disciplin.
- **B:** Automatisér: lad systemet selv sætte nøglen ud fra det faktisk planlagte cutover-tidspunkt, så det ikke afhænger af at nogen husker et manuelt trin.
- **Anbefaling:** A som det billige første skridt inden S4 - det kræver ingen kode og retter risikoen nu. B er værd at bygge som opfølgning, fordi det manuelle trin allerede blev glemt én gang (aldrig skrevet ind i NIGHT_WAVE_RUNBOOK.md efter 23/8). Kan ikke lukkes: nøglen sættes stadig ikke af noget automatisk, og drejebogen mangler stadig trinnet.

## #4147 - [bug/HOEJ] Loebs-afslutning er ikke atomar - genstart efterlader halve loeb i da

Bliver backend-processen dræbt midt i at afslutte et løb (fx ved en deploy), kan løbet ende i en umulig tilstand. Det skete reelt 23/8: Gran Premio de Llanera stod med resultater og beregnede præmier i databasen, men status var stadig "scheduled" - løbet reddede sig selv til "completed" bagefter, men præmieudbetalingen forblev tom og blev ikke fanget af det automatiske sweep, fordi det kun kigger på løb der allerede er "completed".

- **A:** Vej A - atomar transaktion: hele afslutningen (resultater, status, stages_completed, præmier) sker som én udelelig operation, alt eller intet.
- **B:** Vej B - genoptagelig tilstandsmaskine: afslutningen husker hvilket trin den nåede til, og kan fortsætte derfra efter en genstart.
- **Anbefaling:** A - simplere at bygge og ræsonnere om, og løser problemet fuldstændigt for det almindelige tilfælde (en kort afbrydelse). Byg under alle omstændigheder en reconciler der finder og reparerer/alarmerer på umulige tilstande - det er den der ville have fanget division 9 med det samme. Kan ikke lukkes: intet af det er implementeret endnu.

## #4149 - [infra] Adskil race-motoren fra web-API'et i to Railway-services

Race-motoren (løbsafvikling, cron) og web-API'et kører i samme proces på Railway, så enhver backend-deploy - også et rent frontend- eller docs-fix - kan rive et kørende løb midt over. 23/8 skete det 5 gange på 35 minutter midt i et løbsheat, og to af de gange var helt legitime backend-ændringer der alligevel ødelagde et løb (jf. #4147). Forslaget er at splitte motor og API i to Railway-services, så de kan deploye uafhængigt af hinanden.

- **A:** Split nu i to Railway-services - strukturel isolation, men koster en ekstra Railway-regning, mere at vedligeholde og risiko for at de to services kører forskellige versioner af delt kode.
- **B:** Vent - løs først #4147 (atomar afslutning) og #4148, og mål om en genstart derefter reelt er billig (sekunder, ingen datatab). Split kun hvis det stadig gør ondt.
- **Anbefaling:** B - det er allerede issuets egen anbefaling, og splitning er dyrere og mere kompleks end nødvendigt hvis grundproblemet (#4147) bliver løst først. Kan ikke lukkes: venter eksplicit på at #4147 og #4148 er kørt og genmålt.

## #4174 - [balance/HOEJ] Kalenderen kraever op til 29 ryttere - kun 21 % af holdene kan st

Kalenderen kræver op til 29 forskellige ryttere på den værste enkeltdag i en division, men kun 21% af alle 212 hold har en trup stor nok til at stille fuldt hold - værst i Division 4, hvor kun 2 af 46 hold kan. Fem spillere klagede uafhængigt af hinanden 24/8 over at være tvunget til at stille underbemandede hold. En delbeslutning er allerede truffet (25/8: inaktive hold behandles som alle andre, ingen særregel), men selve grundproblemet - at kalenderens krav ikke er kalibreret mod truppestørrelserne i D3/D4 - mangler stadig en beslutning om hvilken af de tre knapper der skal justeres.

- **A:** Sænk selve kravet: skru ned på TIER_OVERLAP_CAP/SELECTION_SIZE i D3/D4, så kalenderen matcher de faktisk mindre trupper der.
- **B:** Løs bindingsproblemet i stedet (#4173): bind en rytter kun på de dage vedkommende faktisk kører, ikke på hele løbets spænd - så samme antal ryttere frigøres hurtigere uden at skære i løbsudbuddet.
- **Anbefaling:** B som primær rettelse, fordi bindingen-på-spænd allerede er identificeret som den reelle årsag til overkravet - løses det, falder behovet uden at gå på kompromis med løbsprogrammet. A kan suppleres i D4 hvis B alene ikke er nok. Kan ikke lukkes: selve trup-vs-krav-problemet er ikke afgjort, kun sidespørgsmålet om inaktive hold.

## #4189 - [collab/beslutning] Maa collaborators trigge @claude paa ejerens kvote?

Når hjælpere får skriveadgang til repoet, kan de skrive "@claude" i et issue eller en PR og starte en Claude Code-kørsel der trækker på ejerens eget Claude-abonnement - gratis for dem, en udgift for ejeren, uden loft. Det er ikke et sikkerhedshul (Claude kan kun foreslå en PR som ejeren selv skal godkende), men et rent kvote/omkostningsspørgsmål, og bør afklares før den første hjælper faktisk inviteres.

- **A:** Lås det til kun ejeren (actor-guard: én linje i claude.yml, samme mønster som allerede brugt i auto-merge.yml) - hjælpere bruger i stedet deres egen Claude-konto lokalt.
- **B:** Lad det stå åbent for alle collaborators og aftal forbrug mundtligt - fleksibelt, men uden noget loft på hvor meget kvote der kan brændes uden varsel.
- **Anbefaling:** A, som også er issuets egen anbefaling - ændringen er én linje, kan altid rulles tilbage, og hjælperne mister intet da de alligevel har egen Claude-adgang lokalt. Kan ikke lukkes: selve linjeændringen i claude.yml er ikke lavet, kun en analyse-kommentar fra en automatisk Claude-kørsel er tilføjet.

## #4195 - [balance] Vaerdimodellen er saa stejl i toppen at ET overall-point = +20M - 40M-

Den dyreste rytters pris springer med 20-30M kr., bare fordi vedkommende tilfældigt lander ét overall-point højere end resten af feltet - i et målt eksempel fra 32,1M til 52,9M. Over 42 testede sæsoner ramte den dyreste rytter over 40M kr. i 44% af tilfældene, selvom selve rytter-kvaliteten i toppen (overall 68-73) er stabil sæson for sæson. Det er ikke generatoren der er ustabil, men hvor stejlt værdimodellen stiger for de allerbedste ryttere.

- **A:** Gør værdikurven mindre stejl i toppen (kalibrér formlen), så prisen på feltets bedste rytter bliver mere forudsigelig fra sæson til sæson.
- **B:** Behold kurven som den er og accepter at superstjerner kan koste 50M+, men hæv til gengæld superstjerne-grænsen (i dag 8M), som ellers rammes 6-7 gange over.
- **Anbefaling:** A - en pris der kan svinge 20M+ ud fra ren RNG er dårlig spilbalance, uanset om 50M-superstjerner i sig selv er ønsket eller ej.

## #4201 - [design] Assistenten boer vaere opt-in eller sen-udfyldning i stedet for proakti

Fem spillere klagede samme dag over at assistenten selv udtager hele truppen på forhånd, i stedet for kun at hjælpe med det spilleren ikke selv nåede - én skrev at han overvejer at afmelde løb for at slippe for at 'kæmpe' med assistenten. Sagen er allerede afgjort: princippet er skrevet ind som låst regel (PLANNING_CENTER_RULES.md §4 - assistenten fylder først sent, aldrig proaktivt på forhånd).

- **A:** Luk issuet nu - selve designbeslutningen er taget og nedskrevet; det resterende arbejde (symmetriske knapper, board-linje, hjælpetekst) er allerede sit eget separate spor.
- **B:** Hold issuet åbent indtil det resterende kode-arbejde er leveret, så det ikke bliver glemt.
- **Anbefaling:** A - spørgsmålet i issuet (hvordan assistenten skal opføre sig) er afgjort; resten er almindeligt udviklingsarbejde der ikke kræver et beslutnings-issue.
- **Kan formentlig lukkes** (afgjort/overhalet - se anbefaling)

## #4203 - Ejer-direktiv 24/8: Monumenterne skal ud af GT-vinduerne - 4 af 5 ligger inde i 

Et forsøg på at flytte de fem 'Monument'-klassikere ud af Grand Tour-perioderne blev rullet tilbage samme aften, fordi det løste ét problem (Monument inde i GT) ved at skabe et andet (Monumentet delte pludselig løbsdag med andre løb - brud på en anden ejer-låst regel). Grundproblemet er at de tre Grand Tours optager 70% af sæsonens løbsdage uden mellemrum, så der reelt ikke er plads nogen steder. Som biprodukt af tilbagerulningen står fire mindre løb nu markant underbemandede (16-33 ryttere mod normalt 100+).

- **A:** Ryd op i biskaden nu (nulstil assistent-udtagelserne på de fire tynde løbsdage og lad systemet genfordele), men vent med selve Monument-flytningen til Grand Tour-komprimeringen er løst i kalender-SSOT'en (#4176).
- **B:** Lad alt stå som det er, inklusive de tynde felter, til hele kalenderstrukturen er løst under #4176.
- **Anbefaling:** A - de tynde felter er et synligt problem for spillerne lige nu og kan rettes uden at røre ved den store, endnu uafklarede kalenderstruktur.

## #4206 - [balance/HOEJ] 965 ryttere (15 %) har identiske stats i alle 14 felter - over ha

965 ryttere (15% af hele bestanden) har præcis samme tal i alle 14 stats-felter - de er hverken bjerg-, spurt- eller noget-som-helst-specialister. Tælles svage profiler med (top og bund under 3 points forskel), gælder det over halvdelen af alle ryttere, værst i Division 4 men også 15% i Division 1. Det rammer udtagelse, kalenderens terrænkrav og prismodellen samtidig - i det viste eksempel er en helt flad rytter endda dyrere end en med en ægte profil.

- **A:** Prioritér at finde generatoren bag de flade ryttere nu og ret den - kandidater er allerede peget ud, og at Division 1 også er ramt tyder på mere end bevidst billige fyld-ryttere.
- **B:** Lad det ligge - hvis fladheden er tilsigtet for billige statist-ryttere, er der intet at rette.
- **Anbefaling:** A - at en flad rytter koster mere end en ægte specialist, og at det også rammer den bedste division, peger på en fejl og ikke et bevidst design.

## #4209 - GT-hviledage skal binde rytteren - anden halvdel af #4203 (blokeret af #4191)

Issuet skulle binde en Grand Tour-rytter til løbet på hviledage, så han ikke samtidig kan køre et andet løb. En måling mod produktion viste dog at der reelt ingen hviledage findes i sæson 3 - alle tre Grand Tours afvikler 17-18 etaper på kun 5-6 dage, så det 'hul' der skulle bindes bare er nogle timer samme dag, ikke en fridag. Præmissen for issuet holder derfor ikke før det er besluttet hvor komprimeret en Grand Tour overhovedet må være (samme rod som #4203/#4176).

- **A:** Lad issuet ligge i bero, blokeret af Grand Tour-komprimeringsspørgsmålet under #4176, og genoptag det først når det er afgjort.
- **B:** Luk issuet permanent, fordi 'hviledags-binding' ikke giver mening i den nuværende komprimerede kalenderform.
- **Anbefaling:** A, som allerede er den valgte vej - lad det ligge blokeret i stedet for at lukke det, for reglen bliver relevant igen så snart Grand Tour-formatet får rigtige hviledage.

## #4235 - [beslutning 15/9] Forummets rolle over for Discord - maaleplan + baseline efter 

Forummet bruges faktisk mere end normalt for et lille community (17% af aktive spillere skriver et opslag/svar, mod normale 1-9% i sammenlignelige communities), men det er usynligt - ingen ulæst-markør, ingen notifikation. Der er allerede besat en plan: byg en simpel forbedring (L1: notifikationer/læse-tracking) nu, og aflæs først den 15/9 om målte tal (skribenter, læsere, svartider) viser at forummet kan bære sig selv, eller om det er indhold og ikke synlighed der mangler.

- **A:** Vent til 15/9 som planlagt, og træf først da beslutning ud fra de fire målte tærskler.
- **B:** Spring L1-målingen over og byg allerede nu videre på forum-indhold (L2: auto-tråde, sub-forums, patch notes som tråd osv.).
- **Anbefaling:** A - hele pointen med at sætte baseline og tærskler op 25/8 var at undgå at gætte; at springe direkte til L2 nu ville underminere den øvelse en uge før den er klar.

## #4240 - Afklar em-dash-reglens scope: memory siger universelt, CI haandhaever kun player

Min egen huskeregel siger at em-dash er forbudt overalt - kode, docs, commit-beskeder, chat - men det script der faktisk håndhæver reglen i CI dækker kun spillerrettet tekst (locale-filer, patch notes, meta-tags). Målt på repoet bryder 681 backend-filer og selve regelfilen AGENTS.md (44 gange) den 'universelle' udgave, så den reelt aldrig er overholdt nogen steder undtagen player-copy.

- **A:** Ret huskereglen til kun at gælde spillerrettet tekst, så den matcher det CI faktisk håndhæver - ingen kodeændring nødvendig.
- **B:** Udvid CI-guarden til også at dække kode, docs og commit-beskeder, hvilket først kræver en oprydning i over 750 filer.
- **Anbefaling:** A - reglen opstod oprindeligt som et spillerrettet tone-problem, og der er ingen spillerværdi i at forbyde em-dash i kodekommentarer ingen spiller nogensinde ser.

## #4241 - [ops] Collab-gaten skal kun ramme andre end ejeren - bypass via ruleset

Ejeren vil ikke selv rammes af review-kravet når han koder, men i praksis kan reglen slet ikke opfyldes normalt: CODEOWNERS peger kun på ejeren selv, og GitHub tillader ikke selvgodkendelse - derfor er de seneste 5 merges, helt almindelige og ikke kun ejerens, alle gået igennem som 'admin-omgåelse'. Forslaget er at skifte til et GitHub-ruleset med en bypass-liste, så ejeren fortsat kan merge uden ekstra klik, mens andre bidragydere (som inviteres ind via #4188) stadig skal godkendes.

- **A:** Gennemfør ruleset-migreringen (bygges ved siden af den nuværende beskyttelse, verificeres, ryd derefter op) - fjerner friktionen for ejeren uden at åbne main for andre.
- **B:** Behold status quo og fortsæt med admin-merge-klikket, som reelt ikke blokerer noget lige nu.
- **Anbefaling:** A, men uden hastværk - gaten blokerer hverken spillere eller builds, så det kan tages roligt, dog helst før flere collaborators kommer til under #4188.

## #4246 - [design] Rolle og ordre siger det samme: hunter vs try_break skal afgoeres FOER 

Spillet har to steder der begge udtrykker samme spiller-beslutning: 'rollen' (hunter/sprint_captain/free_role, sat ved holdudtagelsen) og 'ordren' (try_break/leadout_for, sat på taktik-kortet for hver etape). De kan sige hinanden imod på samme rytter til samme etape, og der er ikke besluttet hvilken der vinder hvis de gør. Det haster fordi ordre-systemet (TeamOrder) om lidt fryses ind i en ny motor-kontrakt (engine v4) som taktik-fladen allerede bygges imod - rettes modsigelsen bagefter, skal en frossen kontrakt laves om.

- **A:** Rollen er den varige sandhed - ordren på taktik-kortet er kun en midlertidig afvigelse for én etape.
- **B:** Ordren er den rigtige mekanisme - rollen bliver kun et udgangspunkt/default, som spilleren kan overstyre pr. etape via ordren.
- **Anbefaling:** B. Taktik-kortet arbejder allerede pr. etape, og hvis ordren ikke kan overstyre rollen bliver taktik-fladen dekorativ. Selve rolle-ordene (hunter, sprint_captain osv.) rører vi ikke - de står 69.962 gange i prod og er ikke det der skal give sig.

## #4264 - [feature] Skjul andre holds rytter-evner - scouting afsloerer gradvist et interv

En spiller (inspireret af Hattrick) foreslår at man ikke længere kan se andre holds rytter-evner præcist - kun et interval der bliver snævrere jo mere man scouter (fx 65-75 uden scouting, 73 efter tre gange). Det er en stor ændring af hvordan man vurderer modstandere og auktioner, ikke en UI-detalje - og den støder direkte ind i et allerede kendt hul (#2798): markedsværdien kan i dag regnes baglæns til den præcise evne, så intervallet er værdiløst hvis ikke det løses samtidig.

- **A:** Byg det nu - design fog-of-war for modstander-evner og løs værdi-lækagen (#2798) i samme ombæring.
- **B:** Sæt den på is - notér ideen, men byg den ikke før #2798 (markedsværdi som sidekanal) er løst, ellers bygger vi en tåge med et hul i.
- **Anbefaling:** B. Den er mærket lav prioritet, og at bygge tågen før value-lækagen er lukket giver en falsk tryghed for spillerne. Tag #2798 først, genoptag så denne.

## #4288 - [guard] GT-baandet kraever 21 etaper - S3's tre Grand Tours koerer 17-18 og er d

Der findes en kvalitets-vagt der tjekker om et Grand Tour-løb er realistisk (km, antal stigninger osv.) - men den kører kun hvis løbet har mindst 21 etaper. Sæson 3's tre største løb kører nu kun 17-18 etaper (en bevidst kalender-beslutning), så vagten springer dem stille over og melder 'kunne ikke vurderes'. Resultatet: spillets tre vigtigste løb har lige nu ingen kvalitets-kontrol overhovedet.

- **A:** Skalér båndet med etapeantal (km og stigninger regnet pr. etape i stedet for i alt), så vagten virker uanset sæsonlængde og aldrig bliver forældet igen af en kalenderændring.
- **B:** Sænk simpelthen grænsen til 17 etaper og genkalibrér de tre tal til S3's længde - hurtig fix, men skal justeres manuelt igen næste gang sæsonlængden ændres.
- **Anbefaling:** A. Grænsen blev forældet af én kalenderændring allerede - et fast etapeantal vil ske igen. Et pr-etape-bånd er immunt over for fremtidige sæsonlængder, og det er mere arbejde nu men slipper for at skulle huske at rette det hver gang.

## #4318 - [design] To flader siger 'Race day' om to forskellige tal - kalender-ordinal mod

To skærmbilleder i appen viser en tekst der hedder 'Race day {tal}' - men de to tal er ikke det samme. Sæson-oversigten viser hvilken kalenderdag i sæsonen man er nået til (typisk under 30), mens holdudtagelses-fanen viser løbsdags-nummeret, som i sæson 3 løber op til 75-103. En spiller der klikker mellem de to faner ser samme ord med to helt forskellige tal og har ingen måde at vide hvilket der er hvad.

- **A:** Giv de to tal forskellige ord, så 'Race day' kun betyder det ene og det andet får sit eget navn.
- **B:** Vis begge tal på begge flader (kalenderdag + løbsdag), som spillets egen designregel (PLANNING_CENTER_RULES §3) allerede kræver: 'en flade der kun viser den ene lyver om den anden'.
- **Anbefaling:** B. Der findes allerede en skreven regel om at begge akser skal vises - det er ikke et nyt designvalg, bare en efterlevelse af noget der allerede er besluttet.

## #4356 - [ejer-beslutning] De 34 etaper der koerte med to kaptajner: re-simulering eller 

En bug betød at 35 etape-hold-tilfælde (34 allerede afviklet) kørte med to kaptajner på samme etape, hvor motoren ved en fejl gav leder-beskyttelsen og hold-boosten til den forkerte af de to ryttere. Spørgsmålet er om de 34 gennemførte etaper skal køres om (hvilket flytter placeringer, point og præmiepenge for 12 hold og deres modstandere), eller om resultaterne bare skal stå som de er.

- **A:** Kør de 34 etaper om, så resultaterne matcher den taktik spillerne faktisk lagde.
- **B:** Lad resultaterne stå - fejlen var lille (den flyttede kun boosten mellem to ryttere på samme hold, ikke mellem hold), sæson 2 er slut, og en omkørsel rammer også hold der ikke gjorde noget forkert.
- **Anbefaling:** B. En omkørsel er en destruktiv prod-operation der kræver at du selv har set tilstanden live og godkendt netop det skridt - og gevinsten er lille i forhold til risikoen for utilsigtede sideeffekter i en allerede afsluttet sæson.

## #4404 - [ci] auto-merge-labelen er doed: required code-owner-review kan aldrig opfyldes 

auto-merge-labelen på GitHub virker ikke længere - alle grønne checks passerer, men selve merge-skridtet fejler fordi branch-reglerne kræver en code-owner-godkendelse, og du er både forfatter og eneste code-owner på alle PR'er. GitHub tillader ikke at man godkender sin egen PR, så kravet kan aldrig opfyldes. Eneste vej til main lige nu er en admin-bypass der springer ALLE gates over, ikke kun review-kravet.

- **A:** Fjern review-kravet helt (required_approving_review_count: 0) og lad de andre automatiske gates (tests, frontend-smoke) være den reelle beskyttelse.
- **B:** Behold review-kravet, men giv kun auto-merge-workflowets eget token en undtagelse i branch-reglerne, så mennesker stadig skal godkende hinandens PR'er hvis der nogensinde kommer flere bidragydere.
- **Anbefaling:** A. Du er solo-udvikler - review-kravet beskytter i praksis ikke mod noget, siden der ikke er nogen anden der kan godkende. At fjerne det er simplest og fjerner ikke reel beskyttelse i dag; kommer der samarbejdspartnere senere, kan kravet genindføres med en workflow-undtagelse.

## #4454 - [security] Vurdér edge-proxy (Cloudflare) foran Railway — rate limiting pr. IP d

Spørgsmålet er om der skal sættes en ekstra beskyttelseslag (fx Cloudflare) foran Railway-backenden. Den nuværende rate-limit (600 kald/min pr. IP-adresse) stopper et løbsk klient-loop eller tilfældig probing, men stopper ikke en angriber der bevidst skifter IP-adresse. Der er dog ingen tegn på at nogen faktisk har angrebet spillet - trafikken har toppet ved 30 sidevisninger/min over 14 dage, med 7 samtidige besøgende.

- **A:** Sæt en edge-proxy op nu, selvom det koster opsætningstid, et ekstra led der kan gå ned, og kræver at rate-limit-koden justeres (ellers deler alle spillere én bucket).
- **B:** Vent - der er ingen evidens for angreb og trafikken er lav. Sæt en konkret trigger (fx et bestemt antal samtidige spillere, eller det første observerede misbrugsforsøg) og luk issuet med den begrundelse indtil triggeren rammes.
- **Anbefaling:** B. Issuet er selv skrevet som en vurdering hvor 'nej, ikke endnu' er et legitimt svar - og data understøtter præcis det. At sætte et konkret tal nu betyder du kan lukke sagen uden at det bliver en gemt risiko.

## #4479 - [guard/HOEJ] ECONOMY_RULES lover en loensats-paritetstest der ikke findes - fron

Spillets lønformel er skrevet ned to gange - én gang i backend, én gang i frontend - og begge steders kode-kommentarer siger at det er okay fordi en test (`salaryRateParity.test.js`) fanger det hvis de to tal driver fra hinanden. Den test findes ikke og har aldrig eksisteret. Lige nu er de to tal enige (0.35 begge steder), men det er held, ikke en vagt - og en fix-PR (#4483) er allerede oprettet men ikke merget.

- **A:** Merge PR #4483 som den er (bygger den lovede parity-test) og håndter det alvorligere fund - at spillets 'Regler'-side viser en forkert lønsats/grundlag på grund af en anden, ikke-relateret drift i RULES_NUMBERS - i et separat issue.
- **B:** Udvid #4483 til også at rette RULES_NUMBERS-visningsfejlen før merge, siden det er det fund der reelt påvirker hvad spillerne ser lige nu.
- **Anbefaling:** A. Hold PR'en fokuseret på det den blev lovet (parity-vagten) - RULES_NUMBERS-drift er et separat spillervendt visningsfund og bør have sit eget issue, ikke blandes ind i en guard-PR der allerede ligger klar.

## #4482 - [bug/board] Lag 6-bonustilbud udloeber aldrig - 37 aktive tilbud paa afsluttede 

Bestyrelsens "lag 6"-bonustilbud (penge-tilbud til hold, op til 200.000 CZ$ stykket) skal automatisk udløbe når en sæson slutter - men den funktion der skulle gøre det, bliver aldrig kaldt i praksis. Resultatet: 37 tilbud står stadig aktive på sæson 1 og 2, som begge er afsluttet for længst, så et hold kan i teorien indløse et to sæsoner gammelt tilbud i dag. Det er ikke en bevidst regel, det er en fejl der er blevet opdaget - spørgsmålet er hvad der skal ske med de 37 tilbud der allerede findes.

- **A:** Ryd helt op: udløb også de 37 eksisterende tilbud - men det fjerner en mulighed fra 37 hold uden varsel, så det kræver spillerkommunikation FØR kørslen.
- **B:** Amnesti: luk hullet fremover (nye sæsonskifter udløber tilbud korrekt), men lad de 37 eksisterende stå urørt - ingen mister noget, hullet lukkes alligevel.
- **Anbefaling:** B (amnesti). Ingen straffes for en fejl I selv har lavet, og det er den eneste løsning der ikke kræver en varslings-runde til spillerne først - kan gennemføres med det samme.