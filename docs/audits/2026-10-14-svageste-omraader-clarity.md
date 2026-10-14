# Clarity-bilag til audit 14/10

## Målemetode og begrænsninger

**MÅLT EVIDENS:** Projekt Cycling Zone (`wl7p0hy9w0`) er læst i Claritys indloggede browser-dashboard og heatmaps efter ejerens login. Ingen Clarity-MCP er tilgængelig i Codex. Periode: 14/9 2026 kl. 00.00 til og med 13/10 kl. 23.59.59.999, dansk tid. UI-parametre: `start=1789336800000`, `end=1791928799999`. `entry_referrer=self` er udelukket; Claritys botudelukkelse beholdt. SSOT: `docs/ANALYTICS_STACK.md` og `docs/clarity/README.md`.

[Dashboard med periode og self-referral-filter](https://clarity.microsoft.com/projects/view/wl7p0hy9w0/dashboard?VariablesExcludes=entry_referrer%3Aself&date=Custom&end=1791928799999&start=1789336800000).

Alle URL-udvalg er begrænset til `https://cyclingzone.org/`. Ti auditkandidater er målt; dette er ikke en komplet Clarity-måling af alle ruter, faner og modaler. UUID-ruter er samlet på præfiks, aldrig udgivet enkeltvis. Pro bruger `^https://cyclingzone[.]org/pro([/?#]|$)`, så `/profile` ikke tælles med. Indstillinger bruger tilsvarende afgrænsning af `/profile`. De øvrige udvalg bruger sidens URL-præfiks og inkluderer dens query-parametre. `/race-archive/` omfatter udgavesiderne, ikke arkivfanen på `/resultater`.

Dashboardets **Visited URL** udvælger sessioner, som har besøgt URL'en. Aktiv tid, gennemsnitlig scroll, dead clicks, rage clicks og quickbacks gælder hele den udvalgte session. De må ikke kaldes hændelser eller tidsforbrug på selve siden. Heatmaps nedenfor tæller derimod klik på URL-udvalget og enhedstypen. Heatmaps er baseret på historiske, tilfældigt udvalgte screenshots; de er ikke bevis for dagens layout. Footerens kliktotal kan overstige den viste elementlistes sum, fordi screenshots/DOM-varianter varierer. Tæl ikke liste og total sammen.

**Ingen evidens** for præcis aktiv tid eller quickback-rate på hver enkelt side. Attention-mappet for økonomi viste tid fordelt på sideområder, men det er ikke omregnet til en samlet aktiv sidetid. Ingen session replay er gennemgået. Ingen spilleridentiteter, rå optagelser eller personlige URL'er er gemt. Tablet er ikke undersøgt. Manglende heatmap-grundlag er ukendt, ikke nul brug. Nul klik er kun registreret, når UI viste “No clicks found”.

## Dashboard: sessioner med besøg på den valgte flade

Tallene nedenfor er målinger af en samtykkende stikprøve, ikke antal aktive spillere. Claritys historiske oppustning er dokumenteret i analytics-SSOT; Postgres ejer de absolutte spillertal.

| URL-udvalg | Sessioner | Gns. scroll i session | Aktiv sessionstid, min. | Sessioner med dead clicks | Med rage clicks | Med quickbacks |
|---|---:|---:|---:|---:|---:|---:|
| `/race-archive/` | 1 | 99,44 % | 5,4 | 1 (100 %) | 0 | 1 (100 %) |
| `/finance` | 224 | 92,65 % | 6,5 | 104 (46,43 %) | 0 | 221 (98,66 %) |
| `/help` | 23 | 93,67 % | 11,3 | 15 (65,22 %) | 0 | 23 (100 %) |
| `/compare` | 8 | 89,55 % | 7,8 | 6 (75 %) | 0 | 8 (100 %) |
| `/staff/` | 21 | 95,27 % | 12,4 | 16 (76,19 %) | 0 | 21 (100 %) |
| `/scouting` | 146 | 94,62 % | 7,2 | 58 (39,73 %) | 0 | 138 (94,52 %) |
| `/watchlist` | 57 | 94,56 % | 11,5 | 30 (52,63 %) | 0 | 57 (100 %) |
| `/sponsors` | 50 | 94,22 % | 11,0 | 30 (60 %) | 1 (2 %) | 50 (100 %) |
| `/pro` med rutegrænse | 8 | 94,49 % | 7,6 | 7 (87,50 %) | 0 | 8 (100 %) |
| `/profile` med rutegrænse | 45 | 93,60 % | 10,2 | 22 (48,89 %) | 0 | 36 (80 %) |

Samlet produktionsudvalg: 2.726 sessioner efter filtre, 75 bot-sessioner udelukket, 92,41 % gennemsnitlig scroll, 2,5 min. aktiv sessionstid. Dead clicks i 673 sessioner (24,69 %), rage clicks i 4 (0,15 %), quickbacks i 2.040 (74,83 %). Disse er projektmålinger, ikke et nyt mål for spillets kvalitet.

## Heatmaps: hændelser på selve fladen

“Bund” er andelen i Claritys 100 %-scroll-række. Den er ikke en gennemførelsesrate eller et krav om at scrolle til bunden. Små stikprøver må ikke udlægges som gode/dårlige konverteringsrater. PC og mobil vises hver for sig; heatmap-visninger tæller ikke unikke personer.

| URL-udvalg | Enhed | Heatmap-visninger | Bund | Dead clicks/taps | Rage clicks/taps |
|---|---|---:|---:|---:|---:|
| `/race-archive/` | PC | 1 | 100 % | 3 | 0 |
| `/race-archive/` | Mobil | Ingen evidens | Ingen evidens | 0 fundet, intet grundlag | 0 fundet, intet grundlag |
| `/finance` | PC | 247 | 86,23 % | 44 | 0 |
| `/finance` | Mobil | 222 | 31,53 % | 9 | 0 |
| `/help` | PC | 12 | 91,67 % | 3 | 0 i URL-kohorten |
| `/help` | Mobil | 16 | 68,75 % | 0 | 0 |
| `/compare` | PC | 35 | 45,71 % | 2 | 0 |
| `/compare` | Mobil | 11 | 45,45 % | 1 | 0 |
| `/staff/` | PC | 59 | 89,83 % | 0 | 0 |
| `/staff/` | Mobil | 20 | 85 % | 0 | 0 |
| `/scouting` | PC | 259 | 88,42 % | 29 | 0 |
| `/scouting` | Mobil | 200 | 85 % | 4 | 0 |
| `/watchlist` | PC | 107 | 99,07 % | 8 | 0 |
| `/watchlist` | Mobil | 62 | 87,10 % | 0 | Ingen evidens |
| `/sponsors` | PC | 71 | 97,18 % | 4 | 0 |
| `/sponsors` | Mobil | 59 | 42,37 % | 12 | 0 |
| `/pro` med rutegrænse | PC | 7 | 100 % | 0 | 0 |
| `/pro` med rutegrænse | Mobil | 1 | 100 % | 0 | 0 |
| `/profile` | PC | 55 | 94,55 % | 4 | 0 |
| `/profile` | Mobil | 9 | 66,67 % | 0 | 0 |

[Økonomiens PC-heatmap, dead clicks](https://clarity.microsoft.com/projects/view/wl7p0hy9w0/heatmaps?URL=2%3B0%3Bhttps%3A%2F%2Fcyclingzone.org%2Ffinance&VariablesExcludes=entry_referrer%3Aself&date=Custom&end=1791928799999&heatmapDeviceType=2&heatmapType=3&start=1789336800000). De øvrige målinger kan reproduceres med tabellens URL-udvalg og PC/Mobile-fanen, med samme periode og self-referral-filter.

**MÅLT EVIDENS:** Økonomiens PC-elementliste viste 14 dead clicks på indholdscontaineren, 9 på MAIN-containeren og 3 ved låneformularens type-/beløbsområde. Det er brede elementmål; ingen bestemt låneknap er bevist defekt. De to containerklynger må ikke lægges sammen som forskellige frustrerede spillere.

**FORTOLKNING:** Økonomi har det største antal sideplacerede dead clicks blandt disse ti kandidater og en tydelig forskel i scroll på mobil. Scouting og sponsorer har også sideplacerede signaler. Stabens høje sessionsrate fortæller ikke, at stabprofilen fejler: dens egne heatmaps viste ingen dead clicks. Arkivets ene session kan bekræfte lav registreret brug, men kan ikke dokumentere langsomhed eller en generel fejlfrekvens. Pro har få sidebesøg og nul sideplacerede dead clicks; den høje kohorterate kommer fra sessionerne som helhed.

Auditens scorer ændres ikke alene ud fra disse tal: B bruger fortsat PostHogs besøgendestikprøve; F er en begrundet vurdering med særskilt kildeangivelse. Clarity underbygger økonomiens friktionsundersøgelse og arkivets lave registrerede brug. Den beviser ikke nye rodårsager. Ejerens valg af løbsbibliotek A med kommende udgaver består. Ingen kode eller beskyttede S5-/løbsflader er ændret.
