# Cycling Zones svageste områder, 14. oktober 2026

**Anbefaling:** resultatarkiv, økonomi, Hjælp, ryttersammenligning og stab. Arkivet er den stærkeste første kandidat: næsten ingen målte besøg, en konkret spillerklage og et design, der henter store resultatmængder for at vise ganske lidt. Stab er den tydeligste halvfærdige oplevelse. Forslagene nedenfor er beslutningsgrundlag, ikke godkendt til build eller en ændring af MASTERPLAN.

## Hvad undersøgelsen faktisk kan sige

**MÅLT EVIDENS:** Git/kode på NICOLAIPC, hoved-checkout `C:/Dev/CyclingZone`, udgangspunkt `0ce0959e8`. Supabase-projekt `ghwvkxzhsbbltzfnuhhz`, udelukkende SELECT efter opslag i `database/schema-snapshot.json`. Browserkontrol af offentlig Hjælp på 390×844 og 1280×900. Ingen kodeændringer eller manuelle deploys.

Brugsvinduet er **14/9 kl. 00 til 14/10 kl. 00 dansk tid**. Efter ejerens login er Clarity læst i browseren, med self-referral udelukket og produktions-URL'er valgt. [Clarity-bilaget](2026-10-14-svageste-omraader-clarity.md) har sessioner, scroll, aktiv tid og friktionssignaler for ti URL-udvalg samt PC-/mobil-heatmaps. Dashboardets URL-filter måler hele besøgssessionen; heatmaps placerer klik på siden. **Ingen evidens for præcis aktiv sidetid eller quickback-rate pr. side.** Clarity tæller en stikprøve, ikke hele spillerbasen, jf. `ANALYTICS_STACK.md`. MCP er fortsat utilgængelig; browseradgangen virker.

PostHog-projekt 259474 har 18.657 sidevisninger i vinduet, men den første er **6/10 kl. 21.01 dansk tid**. URL-tabellen dækker altså cirka en uge, ikke 30 komplette dage. Det modsiger den historiske beskrivelse af et tomt projekt i `ANALYTICS_STACK.md`; dokumentet er ikke ændret her. Besøgende er PostHogs målte personer, ikke alle spillere. UUID-ruter er samlet før distinct-optælling; arkivets navneruter er samlet særskilt. Den afledte SQL tæller også interne besøg, mens web-tabellen brugte projektets testfilter. Begge er stikprøver. Alle returnerede gennemsnitstider var nul; eventlisten indeholdt ingen `$pageleave`. Tid og bounce bruges derfor ikke som friktionsbevis. Se [PostHogs måleforudsætninger](https://posthog.com/docs/health-checks/pageleave-events).

Supabase supplerer med 83 forskellige eventbrugere i de 30 dage. `last_seen` viser 112 konti set siden 14/9 ved opslaget; det er en aktuel seneste-login-markør, ikke historisk URL-brug. Transaktionelle handlinger blandt menneskehold uden testmarkering: scoutingmissioner 178/38 spillere, målrettet scouting 1.829/43, bevarede ønskeliste-tilføjelser 575/32, sponsoroprettelser 294/236 og staff-oprettelser 449/32. Handlinger kan komme fra flere flader; sponsoroprettelse er ikke bevis for et manuelt sidebesøg. Ingen af tallene er sidernes konverteringsrate.

**FORTOLKNING:** Lav brug kan skyldes sjælden anvendelse, sæsonfase eller dårlig adgang. Det beviser ikke dårlig kvalitet. Rangeringen kombinerer trafik med kvalitetsfund og er fortsat foreløbig uden fuld login-QA. Clarity underbygger økonomiens friktionsundersøgelse og arkivets lave registrerede brug, men beviser ingen ny rodårsag. De beskyttede løbsflader, S5-kalenderen og ejerens andre spor er ikke kandidater.

## Inventar og rangering

[Inventarbilaget](2026-10-14-svageste-omraader-inventar.csv) har 54 rute-definitioner, 16 redirects, 80 identificerede faner, 26 Hjælp-emner samt komponenter, 29 modal/dialogkilder, mailtyper og 48 forekommende notifikationstyper. Admin er fravalgt; `/ui` er preview/kit. Pr. kilde: linjer, rå Git-dato, kandidat til meningsfuld ændring og indikatorer for sidehoved, container, guld, hairlines, tal, stroke-ikoner og emoji. Rene lint/oversættelsesændringer er sorteret fra alderskandidaterne. Indholdsrettelser tæller; fælles linkændringer vises særskilt. Automatisk dateringsklassifikation uden for top 10 er en kandidat, ikke en fuld semantisk gennemgang. Dynamiske tilstande og samtidige guld-knapper kræver visuel kontrol; et komponentmatch er aldrig et visuelt bestået. Historiske commit-titler er udeladt; dato og SHA bevarer sporbarheden uden at gentage spilleridentiteter.

**Score = B + F + K + A + D, højere er værre, maks. 20.** Dette er auditvurdering, ikke et ejer-godkendt kvalitetsmål eller TASTEs officielle screenshot-score.

- **B, brug:** ≤5 besøgende: 4; 6–10: 3; 11–25: 2; 26–40: 1; flere: 0. Manglende måling er ukendt, aldrig nul.
- **F, friktion:** 0 ingen fund; 1 mindre besvær; 2 tydelig omvej; 3 den primære opgave er væsentligt vanskeligere; 4 gentagne målte afvisninger. Kodevurdering og historiske fejl er mærket som sådanne.
- **K, stemme:** 0 ingen evidens; 1 ønske; 2 én konkret problemtype; 3 flere problemtyper; 4 gentagelser fra mindst tre uafhængige spillere. Dublet-issues og svar i samme diskussion tælles ikke som nye spillere.
- **A, alder:** under 14 dage: 0; 14–29: 1; 30–59: 2; 60–89: 3; ≥90: 4. Seneste relevant kilde-/indholdsændring, ikke seneste lint-commit.
- **D:** 0–4 konkrete kvalitetsafvigelser fra skabelonerne, TASTE eller TONE, afkortet ved 4. F/K/D er begrundede vurderinger, ikke instrumentmålinger. Ved lighed afgør D, derefter K.

| # | Flade | B/F/K/A/D = score | Besøgende / visninger | Evidens og kilde | Sidst meningsfuldt opdateret |
|---|---|---|---|---|---|
| 1 | Resultatarkiv | 4/3/3/1/2 = **13** | 2 / 3 | 289 linjer; alle udgavers resultater hentes før klientberegning. Søgning og ventetid kritiseret i [#6514](https://github.com/NicolaiDolmer/CyclingZone/issues/6514). `RaceHistoryPage.jsx:35–109`. | 17/9; fælles link 26/9 |
| 2 | Økonomi | 2/3/3/1/3 = **12** | 24 / 203 | 1.121 linjer; egen 768 px container/sidehoved, guld-saldo, dobbelt sponsorindgang. Feedback 28; [#4025](https://github.com/NicolaiDolmer/CyclingZone/issues/4025), [#5887](https://github.com/NicolaiDolmer/CyclingZone/issues/5887), [#6474](https://github.com/NicolaiDolmer/CyclingZone/issues/6474). | 27/9 |
| 3 | Hjælp | 2/2/3/0/4 = **11** | 20 / 25 | 1.067 linjer; 26 mobile emner, søgning lander på sektion frem for svaret. Observerede afsnit på 1.113 og 2.299 tegn. [#6242](https://github.com/NicolaiDolmer/CyclingZone/issues/6242), [#6516](https://github.com/NicolaiDolmer/CyclingZone/issues/6516). | side 4/10; indhold 13/10 |
| 4 | Sammenligning | 4/3/0/1/3 = **11** | 4 / 17 | 317 linjer; 200 px labels + mindst 120 px pr. rytter. To ryttere kræver mindst 440 px før gaps. Tom tilstand uden handling; guld-tint på potentialerække. `RiderComparePage.jsx:220–269`. Ingen ny spillerklage fundet. | 26/9 |
| 5 | Stab/profiler | 3/2/1/0/4 = **10** | 7 / 60 | 161 linjer + profilkomponenter. Generisk Effekt-fane og Historik-pladsholder; tre mobilstats i stedet for T3s to kolonner; ingen handling i mangler/fejl-tilstand. `staff.json:20–22`, `StaffProfileHero.jsx:53`. Forum 20. | struktur 3/8; relevant release-copy 7/10 |
| 6 | Scouting | 2/2/3/0/3 = **10** | 24 / 317 | 541 linjer; eget 38 px display-sidehoved, fem stablede sektioner, passive tomtilstande. [#5064](https://github.com/NicolaiDolmer/CyclingZone/issues/5064), [#5625](https://github.com/NicolaiDolmer/CyclingZone/issues/5625), [#6138](https://github.com/NicolaiDolmer/CyclingZone/issues/6138). | 13/10 |
| 7 | Ønskeliste | 3/4/1/1/1 = **10** | 10 / 127 | 554 linjer. 29 duplicate-key-afvisninger hos 3 eventbrugere, 21–29/9, ved profilens tilføjelse; dagens kode bruger stadig insert uden pending-gate. D-047 og synlig mobilsøgning er allerede leveret. [#5621](https://github.com/NicolaiDolmer/CyclingZone/issues/5621). | side 22/9; badge 26/9 |
| 8 | Sponsorer | 2/2/3/0/1 = **8** | 15 / 37 | 940 linjer; tilbudstabel har minimumsbredder på 186/158/86/196 px plus handling. Mobilrisiko, ikke målt overflow. Forum 15/19; [#5916](https://github.com/NicolaiDolmer/CyclingZone/issues/5916). Omdømmeforklaring er allerede tilføjet. | 6/10 |
| 9 | CZ Pro | 3/1/0/0/2 = **6** | 6 / 9 | 271 linjer. `pro.json` siger “Bliv Founder” og “Støt spillets udvikling”, imod dagens produkt-/tonekontrakt. Ingen evidens for aktuel checkout-fejl eller opdigtet knaphed. | side 6/9; indhold 6/10 |
| 10 | Indstillinger | 3/1/0/0/1 = **5** | 7 / 21 | 1.279 linjer; fem faner, særskilt `max-w-xl`, omfattende Discord-formular. Kanonisk PageHeader og feedback er til stede. Ingen konkret ny spillerklage fundet. | 14/10 |

**Kvalitetskontrol:** Alle ti er læst i nuværende kode. Hjælp er også set i browseren; `/finance` sendte auditbrowseren til login. Ingen nye testkonti, auth-omgåelse eller mock-data. Derfor er mobiloverflow, mørk tilstand og loading/error/empty hos de øvrige **ikke visuelt verificeret**. Arkivets latenstid er rapporteret, ikke genmålt. Ønskelistefejlens årsag er ikke reproduceret i browseren.

Råt “ingen aktivitet”-tal bruges ikke: årsmøde, sæsonarkiv, ungdomsresultater og juridiske sider er sjældne af natur. Den manglende trafikevidens for faner/modaler/mailåbninger står i bilaget. Mail-loggen viser afsendelser, ikke læsning.

**Clarity, MÅLT EVIDENS:** sessioner med besøg på top ti, i tabelrækkefølge: **1, 224, 23, 8, 21, 146, 57, 50, 8, 45**. Økonomiens egne heatmaps viser 44 dead clicks på PC/247 visninger og 9 taps på mobil/222; bund-scroll 86,23 %/31,53 %. Stab viser nul sideplacerede dead clicks trods 76,19 % i hele besøgssessioner. B/F-scorerne ændres ikke ved at forveksle session og side. Arkivets ene session kan ikke bevise langsomhed.

## Fem løft, ejeren kan tage stilling til

### 1. Løbsbibliotek: historik og kommende løb (L)

**Spillerproblem:** Jeg kan ikke sikkert finde løbet eller hurtigt genopleve, hvem der vandt. Et spil om karrierer mister sin hukommelse, når arkivet er besværligt. Det er dårligt produktarbejde, også når den aktuelle løbsside er god.

**Verdensklasse:** [OOTPs History Reports](https://manuals.ootpdevelopments.com/index.php/help/help_import_06_game.html?man=ootp12&page=history_reports) har et indeks og forbundne spiller-, hold-, liga- og rekordvisninger. Lån den sammenhæng, ikke det gamle visuelle design.

- Én søgeindgang til løb, udgaver og relevante rekordholdere; ingen krav om præcis stavning af et langt løbsnavn.
- Første visning: udgaver, vindere og sæsoner. Detaljer indlæses, når de åbnes; hele resultatmængden skal ikke være adgangsbillet.
- Vis holdets og rytternes spor gennem historien med links og dokumenterede resultater, aldrig opdigtet fortælling.
- **Ejerens tilføjelse 14/10:** samme bibliotek skal give overblik over kommende løb. To indgange, Kommende og Historik, med søgning og filtre for sæson, division, løbstype og terræn. En kommende udgave viser offentliggjort dato, klasse, distance/etapetal og kendte ruteprofiler; løbets tidligere udgaver ligger ved siden af. På 390 px skal løbsnavn, dato og type kunne læses uden vandret scroll. Ukendt kalender eller pulje markeres ærligt; ingen konstruerede datoer eller gentagelsesregler.
- **Fjern:** guldgraderede dekorationssøjler, gentagne top-10-visninger og klientens samlede resultathentning som startkrav.

**A/B:** A: sammenhængende bibliotek. B: kun reparation af sejrliste. **Ejeren valgte A 14/10, med kommende løb.** Det godkender retningen, ikke build. **MÅLT EVIDENS:** `PlanningHubPage.jsx` monterer allerede kalender og sæsonvisning; `ResultaterPage.jsx` monterer arkivtabel og WorldCatalog. #3900 har et eksisterende godkendt kalenderdesign, #5841 ejer næste-sæson-visning, og #1010 er lukket med dokumenteret levering af kommende profiler. **FORTOLKNING:** problemet er et sammenhængende, let fundet bibliotek, ikke bevist fravær af alle fremtidsflader. **Ingen evidens** for det nye biblioteks brug eller mobiloplevelse; score 13 gælder historikdelen. SSOT: `SOCIAL_RULES.md`, `RACE_ENGINE_RULES.md`, `CALENDAR_RULES.md`, `PLANNING_CENTER_RULES.md`. Genbrug **#6514**, afstem med **#3900/#1106**; ingen S5-/løbssideændringer. Testplan: søgning på navnevarianter, korrekt sæson/division, historik kontra kommende status, manglende kalender og profiler samt 390 px/desktop.

### 2. Økonomi: et beslutningsværktøj, man kan stole på (M)

**Spillerproblem:** Jeg skal samle saldo, reserverede penge, lån, sponsor og sæsonskifte i hovedet. En korrekt saldo hjælper ikke, hvis historikken opleves som både køb og salg af samme rytter. Det sidste er en målt klage, endnu ikke en ny reproduktion af fejlen.

**Verdensklasse:** [OOTPs finansmodel](https://manuals.ootpdevelopments.com/index.php/the_trading_deadline?man=ootp18&page=the_team_financial_model) adskiller indtægter, løn, øvrige udgifter og rådighed. Cycling Zone skal gøre næste beslutning lige så aflæselig.

- Start med disponibelt nu, kendte kommende betalinger og næste kritiske dato, med datakilde og usikkerhed markeret.
- Én afstemningskvittering: startsaldo, faktiske bevægelser, reservationer og slutsaldo. En transaktion åbner sin forklaring.
- Saml sponsoradgang med `/sponsors`; behold økonomiens bogføring, fjern parallel aftaleadministration.
- **Fjern:** egen 768 px komposition, guld som saldofarve og lange manualforklaringer fra overblikket. Bevar tallene.

**A/B:** A: disponibelt og kommende forpligtelser først. B: transaktionshistorik som startvisning. **Anbefaling A**. SSOT: `ECONOMY_RULES.md`, `SPONSOR_RULES.md`. Genbrug **#4025**; historikfejlen bliver hos #5887/#6474, ikke et tredje bug-issue.

### 3. Hjælp: et præcist svar, ikke en bogjagt (M)

**Spillerproblem:** Jeg søger en forklaring og får en hel sektion. På mobilen skal jeg også lede sidelæns mellem gamle og nye emnenavne. “Alt du skal vide” er en tom forsikring, når aktuelle omdømme- og træningsspørgsmål stadig er ubesvarede.

**Verdensklasse:** [Notions Hjælp](https://www.notion.com/help) lader søgning og konkrete problemer bære indgangen. FM26 bruger også FMPedia som indgang til en bestemt funktion, se [Responsibilities-eksemplet](https://www.footballmanager.com/the-dugout/delegating-success-football-manager-26). Forslaget er redaktionel søgning, ingen genereret chatrådgiver.

- Søgeresultat = det konkrete spørgsmål, et kort svar og et direkte link til den relevante handling/artikel.
- Erstat emnebåndet med spillets nuværende områder. Fold dybden ud inde i artiklen; behold eksisterende flag-gates.
- Del længere forklaringer i spørgsmål og eksempler. Skriv omdømme og træningskombinationer fra deres faktiske SSOT/kode, ikke fra gamle issues.
- **Fjern:** forældede navigationstitler, generiske løfter, kodejargon og døde indholdsgrene efter semantisk kontrol.

**A/B:** A: svar og kontekstlinks først. B: emnemanual først. **Anbefaling A**. SSOT: `TONE_OF_VOICE.md` og områdets regler, især `TRAINING_RULES.md`/`ECONOMY_RULES.md`. Genbrug **#961**; #6242/#6516 ejer fortsat deres faglige svar. Værdi- og lønteksten er kontrolleret mod dagens separate modelvalg; den gamle påstand om forkert startbudget genbruges ikke.

### 4. Sammenligning: hjælp mig med at vælge (M)

**Spillerproblem:** Jeg får mange evner, men mangler et samlet svar på, hvad et alternativ gør for holdet og budgettet. Mobilen får et desktopgitter, der er bredere end skærmen. Den tidligere clipping-rettelse #1603 findes som overflow-wrapper; den er ikke overset eller erklæret ugjort.

**Verdensklasse:** FM24s officielle [rekrutteringsarbejde](https://www.footballmanager.com/features/more-gameplay-deep-dives) knytter sammenligning til konkrete kandidater. Cycling Zone skal vise forskellen på to reelle valg med synlige data.

- To ryttere som standard, rolle/brugssituation og en kort forskelstabel med rating, løn, pris og kendt scoutingusikkerhed.
- På 390 px: én label og begge værdier i samme læsbare række; vælg et tredje alternativ særskilt.
- En kendt disponibel saldo kan give budgetkontekst; ingen opdigtet vindersandsynlighed eller skjult potentiale.
- **Fjern:** 200 px labelkolonnen, tomtilstand uden vej videre og guld-tint som betydningsløs fremhævelse.

**A/B:** A: valg mellem to kandidater med budgetkontekst. B: generisk trepersoners evnematrix. **Anbefaling A**. SSOT: `TRANSFER_MARKET_RULES.md`, `ECONOMY_RULES.md`, `YOUTH_RULES.md` for alders-/scoutinggrænser. Genbrug **#26**, som stadig er i icebox.

### 5. Stab: dokumenteret arbejde frem for lovede faner (M)

**Spillerproblem:** Jeg betaler for personale, men profilen fortæller generisk om effekt og viser historik, som endnu ikke findes for rollen. Jeg skal kunne se, hvad denne medarbejder faktisk bidrager med.

**Verdensklasse:** [FM26s Responsibilities](https://www.footballmanager.com/the-dugout/delegating-success-football-manager-26) kobler opgaver til relevante medarbejdere. Lån forbindelsen mellem ansvar og leverance; indfør ikke flere roller for at fylde siden.

- Profilens første visning viser eksisterende ansvar, aktivt arbejde, kapacitet og seneste dokumenterede leverance.
- Vis hvilke egne ryttere en træner passer til, og hvad en scout kan undersøge, baseret på nuværende motor og datagrænser.
- Sammenlign en kandidat med den ansatte uden opsigelse. Det eksisterende kandidatflow viser allerede kandidater; #3658 er rettet.
- **Fjern:** “kommer snart”-historik som indhold, generisk Effekt-fane, Foto-løfte uden aktivt portræt og mangler/fejl-tilstand uden navigation eller retry.

**A/B:** A: personalet som et operationelt hold med dokumenterede leverancer. B: et dybere profilkatalog. **Anbefaling A**. SSOT: `TRAINING_RULES.md`, `YOUTH_RULES.md`, `ASSISTANT_RULES.md` og facility/staff-kontrakten i #1149/#930. Genbrug **#930**, som stadig er i icebox. Ingen nye bonusser eller automatisering er godkendt.

## Spillerstemme, verificering og næste beslutning

De 60 komplette dage, 15/8 til 14/10 kl. 00, indeholder **20 feedbackindsendelser, 6 NPS-svar (kun ét med tekst), 36 ikke-slettede forumopslag og 235 ikke-slettede svar på ikke-slettede opslag**. NPS-teksten roser managerfølelsen og udviklingstempoet; den dokumenterer ingen dårlig flade. Fairplay fylder 13 indsendelser fra 3 rapportører, ikke 13 forskellige utilfredse spillere. De øvrige klynger er økonomiens forståelighed, træningens kontrol/forklaringer, ungdom/overgange og mobilens tæthed. Der er også udtrykkelig opbakning til enkel stab og enkle sponsorer. Mere kompleksitet er derfor ikke automatisk et løft.

Ingen `.sweep-daily-*` findes lokalt. De to juli-sweeps er uden for perioden og er fravalgt. GitHub-issues fra perioden er undersøgt via emnesøgninger og konkrete issue-/kommentarlæsninger, inklusive relayede Discord-fund. Det er ikke en komplet optælling af alle Discord-beskeder. `gh` findes ikke på sessionens PATH; den tilsluttede GitHub-connector udførte separate titel- og titel/body-dubletsøgninger. Relaterede issues er læst før kommentarer. Alle spillere er anonymiseret; rå forum-/feedbacktekst er ikke gemt i repoet.

**Ingen evidens for AI-ophav eller generelt opdigtede tal.** “AI-præg” betegner her min vurdering af generisk copy og uafsluttede produktløfter. Konkrete tonebrud findes på Pro; ingen ny “vi”-fejl eller prosa-em-dash er bevist på top fem. Jeg kalder ikke hele spillet dårligt på baggrund af en regex.

Før build: ejerens problem/løsnings-go, desktop/mobil-mockup og testplan. Før release: login-QA på 390 px/desktop, lys/mørk og tom/loading/fejl. Arkivets DB/ydelsesdesign kræver lokal PG17-baseline efter regel 36; finansafstemning testes mod faktiske ledgers. Dokumentkontrol: ordgrænse, kildestier, CSV-struktur, ingen spilleridentiteter/prosa-em-dash. Ingen tunge tests for docs-audit. Tokenhygiejne fejler på uændret AGENTS.md; ingen styringsfiler er redigeret. PR-preflight er undtaget for ren docs på main, jf. push-hooken. Ingen patch notes: ingen spilleradfærd eller spillertekst ændret.

**Beslutning 14/10:** ejeren valgte arkiv A og tilføjede kommende løb. Næste ejer-gate er en konkret mobil-/desktop-skitse af bibliotekets indgang, afstemt med #3900s kalenderdesign, før build. Clarity er nu undersøgt; friktionsrangeringen kræver stadig login-QA og reproduktion. #930/#26 forbliver parkerede, indtil ejeren udtrykkeligt løfter dem.
