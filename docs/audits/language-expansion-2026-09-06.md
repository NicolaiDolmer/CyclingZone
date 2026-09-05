# Beslutningsgrundlag: sprogudvidelse (#4110)

> Ejer-direktiv 21/8 2026 (Discord #feedback-from-dolmer). Dette er IKKE en oversættelse — det er data til at beslutte hvilke lande, hvornår, og hvordan. Alle tal nedenfor er målt 5/9 2026 med kilde angivet; ingen opfundne tal. Refs #4110, #4733, #4734.

## Kort svar

- **Frankrig ser IKKE ud til at være næste sprog på trafik-data, selvom det har flest besøg.** Belgien konverterer markant bedre. Se afsnit A.
- **Prisen pr. sprog er allerede løst ned til "næsten gratis" pr. #4733** — delta-oversætteren + CI-gates er bygget og merged. Der er ét kendt hul tilbage (#4734, backend-tekst) der skal lukkes FØR sprog 3.
- **Ingen af de ni kandidatlande har nok trafik endnu til at retfærdiggøre et sprog i dag.** Det tredje sprog er en fremtidig beslutning, ikke en akut en.

---

## A) Landekandidater: cykelinteresse × målt trafik

### Målt trafik (Microsoft Clarity, ikke-bot sessions, 5/9 2026)

Site-total sidste 30 dage: **5.725 sessions**. Ingen adgang til Vercel Web Analytics (ikke aktiveret på projektet — forsøgt, fik "Web Analytics not found"). Ingen adgang til Google Search Console (Ahrefs-forbindelsen kræver godkendelse i denne session).

| Land | Sessions (90 dage) | Bounce rate | Note |
|---|---:|---:|---|
| Frankrig | 9.409 | 98,7 % | Højeste volumen, men næsten ingen bliver på siden. |
| Holland | 2.154 | 98,1 % | Samme mønster som Frankrig — volumen uden engagement. |
| **Belgien** | 1.393 | **57,3 %** | Markant lavere bounce end alle andre lande — reelt engagement, ikke kun landing-og-forlad. |
| Spanien | 1.046 | 96,4 % | Lav engagement. |
| Italien | 930 | 99,9 % | Stort set alle forlader efter én side. |
| Tyskland | 918 | 94,8 % | Lav engagement. |
| Slovenien | 20 | 100 % | For lille stikprøve til at konkludere noget. |
| Polen | 15 | 86,7 % | For lille stikprøve til at konkludere noget. |
| Colombia | 0 | — | Ingen målte besøg overhovedet i de sidste 90 dage. |

**Vigtigste fund:** bounce rate over 94 % for Frankrig, Holland, Spanien, Italien og Tyskland betyder at næsten alle besøgende fra de lande forlader siden med det samme — det ligner enten (a) tilfældig/søgemaskine-trafik uden reel interesse, eller (b) besøgende der rammer en engelsk side de ikke forstår og går igen. Vi kan ikke skelne de to forklaringer fra Clarity-data alene, men Belgiens 57 % bounce (halvt så høj som resten) er et konkret signal om reelt engagement — sandsynligvis flamsk-/fransktalende belgiere der allerede er komfortable med engelsk UI, eller en mindre, mere målrettet trafikkilde.

Til reference (samme 30-dages periode, alle lande): Danmark dominerer klart (4.485 sessions), Belgien er nummer 2 (662), derefter Frankrig (111), UK (87), USA (82).

### Signup-data pr. land: ikke muligt at måle i dag

- `users`-tabellen har **ingen land-kolonne**. Kun `browser_language` (tilføjet #4737, 3/9) og `language` (brugerens UI-valg).
- Læst direkte i prod (read-only, 5/9): `browser_language` har **0 udfyldte rækker** ud af 259 brugere — kolonnen er tilføjet for 2 dage siden, og enten er der ikke kommet nye signups siden trigger-opdateringen slog igennem, eller frontend-ændringen (der sender `navigator.language` ved signup) endnu ikke har fanget en signup. 25 nye brugere er oprettet de sidste 14 dage, men ingen af dem har en udfyldt `browser_language` — dette bør undersøges (kan være en fejl i triggeren, eller bare for tidligt).
- `users.language` (UI-sprog, IKKE et pålideligt land-signal, kun 2 valgmuligheder findes): 189 `en` / 70 `da` ud af 259. Fortæller ikke noget om nationalitet — langt de fleste besøgende er fra Danmark ifølge Clarity, så det viser bare at mange danske brugere lader UI stå på engelsk (default) uden at skifte.
- **Konklusion:** "gennemførte signups pr. land vs. besøg" (spørgsmål 3 i opgaven) kan IKKE besvares i dag. Datakilden findes i skemaet men er tom. Dette bør genbesøges om 2-4 uger når `browser_language` har akkumuleret data — eller endnu bedre, når IP-baseret landefelt findes (findes ikke i dag; `founder_supporter_waitlist.country` er et andet, ældre skema fra en tidligere kampagne, ikke koblet til `users`).

### Cykelinteresse (kvalitativt, med kilder)

| Land | Cykelinteresse | Kilde |
|---|---|---|
| Frankrig, Holland, Spanien, Italien | Ca. 1 ud af 4 sportsfans følger cykelløb som Tour de France/Giro/Vuelta — markant højere end fx USA (8 %). | [Statista](https://www.statista.com/chart/27675/cycling-fans-worldwide/) |
| Belgien | Cykling-kerneland, hjemsted for klassikere som Ronde van Vlaanderen; steg 10 % i cykel-deltagelse i 2025 (BeCyclist-planen). | [Sportsfoundation](https://sportsfoundation.org/where-cycling-is-most-popular/), [Travelandtourworld](https://www.travelandtourworld.com/news/article/z6cwt9sg50ym/) |
| Slovenien | Pt. verdens mest dominerende cykelnation relativt til befolkningstal (2 mio. indbyggere) — Pogačar + Roglič har løftet landet til 3. plads på UCI's nationsranking. | [Cyclinguptodate](https://cyclinguptodate.com/cycling/analysis-how-did-slovenia-become-cyclings-number-1-nation), [Slovenia.info](https://www.slovenia.info/en/press-centre/press-releases/34061-tadej-pogacar-s-historic-victory-further-cements-slovenia-s-status-as-a-global-cycling-powerhouse-reception-in-paris-honours-slovenian-and-french-cyclists) |
| Colombia | Cykling er en de facto nationalsport, drevet af bjergrigt terræn og Egan Bernals Tour-sejr 2019; stort antal professionelle ryttere relativt til landets størrelse. | [Colombiaone](https://colombiaone.com/2026/02/21/colombia-cycling/), [La Salida](https://lasalida.cc/blogs/la-salida-blog/why-are-colombians-good-at-cycling) |
| Tyskland, Polen | Ikke specifikt undersøgt i denne runde — begge har cykel-tradition (Tyskland: Rund um Köln m.fl.; Polen: Tour de Pologne) men ligger ikke øverst i de generelle kilder ovenfor. |

**Krydset:** Belgien er det eneste land der scorer højt på BÅDE cykelinteresse OG målt engagement (lav bounce). Frankrig/Holland/Spanien/Italien har høj cykelinteresse men trafikken der kommer ind i dag konverterer ikke til reelt besøg. Slovenien og Colombia har meget stærk kvalitativ cykelinteresse men praktisk talt ingen målt trafik — for tidligt at prioritere sprog dér, men værd at holde øje med hvis en enkelt influencer/spiller derfra finder spillet.

---

## B) Teknisk pris pr. sprog

### Nøgler og ord i dag (EN-bundtet, målt 5/9 2026, 47 namespace-filer)

**Total: 8.330 nøgler / 71.199 ord.**

De 3 tungeste namespaces (sjældent sete, jf. opgaven):

| Namespace | Nøgler | Ord | Andel af alle ord |
|---|---:|---:|---:|
| `help.json` | 863 | 26.011 | 36,5 % |
| `rules.json` | 105 | 1.260 | 1,8 % |
| `privacy.json` | 70 | 1.081 | 1,5 % |
| **Sum (sjældent sete)** | **1.038** | **28.352** | **39,8 %** |

Resten (spil-kritisk UI — dashboard, auktioner, races, board, finance, osv.): **7.292 nøgler / 42.847 ord.**

**Vigtigste fund:** `help.json` alene er over en tredjedel af ALT tekstindhold i spillet, men er per definition sjældent læst (hjælpetekst opsøges aktivt). Det betyder den reelle "daglige" oversættelsesbyrde pr. nyt sprog er tættere på 43.000 ord end 71.000 — men CI-gaten (`i18n-check-keys.mjs`) kræver symmetri på ALLE namespaces, så hele `help.json` skal stadig oversættes for at et sprog kan gå live. Det er ikke noget man kan udskyde teknisk, kun prioritere i review-rækkefølge (maskinoversæt help.json først, lad sprogkaptajnen bruge sin tid på spil-kritiske 43.000 ord).

Til reference: #4733-issuet (skrevet 3/9) nævnte 8.875 nøgler/~82.000 ord — det aktuelle tal (8.330/71.199) er lavere, sandsynligvis pga. oprydning i samme PR-spor (81 hardcodede strenge blev gennemgået, ingen flyttet — se PR #4737). Forskellen er ikke undersøgt yderligere her; brug de aktuelle 8.330/71.199 som facit.

### Hvad #4733 allerede løser (status: LUKKET, done)

- **Delta-oversætter** (`scripts/i18n-translate-delta.mjs`): oversætter kun nye/ændrede EN-nøgler, aldrig hele bundtet igen. Kører via Claude API (Sonnet), injicerer et fagordsglossar (`docs/i18n/GLOSSARY.md` — fx "Squad"→"Hold", "CZ$" uoversat) så cykel-/spiljargon ikke ender som bogstavelig maskinoversættelse.
- **ICU-sikkerhed**: placeholders (`{count}`, `{name}`) og plural-grene valideres bit for bit før en oversat streng skrives; fejler valideringen, skrives den ikke.
- **CI er nu hård gate, ikke advisory**: `i18n-check-keys.mjs` kører som required check. En PR der tilføjer en EN-nøgle uden tilsvarende oversættelse fejler build med en besked der peger på `npm run i18n:translate`.
- **Ét sted at konfigurere et sprog**: `frontend/src/i18n/languages.js` (før: 4 forskellige steder i koden hardcodede `['en','da']`).
- **Layout-stress-test**: `en-XA`-pseudo-locale (kunstigt +30 % længere streng-simulation) kører gennem Playwright på tunge sider, så et sprog med længere ord (fx tysk) ikke knækker layoutet efter det går live.
- **Kaptajn-model**: en sprogkaptajn ejer ét sprog (gratis Pro + badge — samme model som Hattrick bruger for community-oversættelse), retter maskinoversatte nøgler til `reviewed`-status; ændres EN-kilden senere, falder nøglen automatisk tilbage til `machine` og skal genoversættes.

**Reel vedligeholdelsespris pr. FREMTIDIG feature-PR efter #4733:** én kommando (`npm run i18n:translate`), automatisk kørt, ingen manuel oversætter-tur pr. sprog — CI blokerer blot til den er kørt.

### Hvad der IKKE er dækket endnu (#4734, ÅBEN, blokerer sprog 3)

Tre steder i backend sender **færdig tekst** direkte til spillere, uden om hele i18n-pipelinen ovenfor:

| Kilde | Fil | Sprog i dag | Omfang (målt) |
|---|---|---|---:|
| In-app notifikationer | `backend/lib/notificationService.js` | Hardcodet engelsk | 20 title/message-forekomster |
| Discord-DM'er til spillere | `backend/lib/discordNotifier.js` | Hardcodet engelsk | 14 title/description/content-forekomster |
| Klub-DNA (bestyrelses-flavor-tekst) | `backend/lib/boardClubDna.js` | Hardcodet dansk | 23 label/description-forekomster |

Konsekvens hvis dette IKKE fikses før sprog 3: en fransk spiller ser oversat UI, men får notifikationer og Discord-beskeder på engelsk og klub-DNA-tekst på dansk — falsk fuld dækning, dårlig oplevelse på præcis de touchpoints der føles personlige (du vandt en auktion, din klub har en historie). Issuet har en konkret løsning skitseret (nøgle + parametre i stedet for færdig tekst) og er estimeret som ét afgrænset stykke arbejde, ikke en ny pipeline.

**Vedligeholdelsesbyrde fremadrettet, når #4734 er lukket:** hver ny notifikations-/Discord-tekst skal tilføjes som nøgle (samme mønster som UI-tekst i dag), fanget af samme CI-gate. Ingen ny kategori af arbejde, bare én regel mere at huske ved kodegennemgang (og et lint-script der fanger det, hvis den glemmes — foreslået i #4734).

---

## C) Kvalitetsspørgsmålet: maskin vs. community vs. professionel

| Model | Startomkostning | Løbende omkostning | Kvalitetsrisiko | Passer til Cycling Zone? |
|---|---|---|---|---|
| **Ren maskinoversættelse** (ingen review) | Næsten 0 (allerede bygget) | Næsten 0 pr. feature | Fagsprog (watt, w/kg, udbrud, lead-out) rammes ofte forkert af generisk maskinoversættelse — glossaret i #4733 afbøder de mest kritiske termer, men fanger ikke alt, og tonen (jeg-form, ikke corporate — jf. TONE_OF_VOICE.md) er svær at ramme uden et menneske der kender stemmen. | Risikabelt som permanent løsning — kan bruges som DAG 1-baseline, ikke som slutmål. |
| **Community/kaptajn-model** (Hattrick-inspireret, allerede designet i #4733) | 0 kr., men kræver at en engageret spiller melder sig og har tid | Løbende, ulønnet — betalt i gratis Pro + badge i stedet for kontanter | Kvaliteten afhænger 100 % af kaptajnens engagement og sprogkundskab; risiko for at et sprog "visner" hvis kaptajnen forsvinder (ingen SLA på en frivillig) | Billigst og mest i tråd med "solo founder, build-in-public"-stilen. Kræver en proces for hvad der sker når en kaptajn stopper (ikke defineret endnu). |
| **Professionel oversætter** | Reel kr.-udgift pr. sprog (ikke undersøgt her — intet budget-tal foreligger) | Løbende pr. feature-batch, eller et fast honorar-arrangement | Lavest risiko for fagsprog og tone, men kræver et kontinuerligt betalt forhold — ikke gratis at vedligeholde | Kun relevant hvis et sprog viser sig kommercielt vigtigt nok til at retfærdiggøre en fast udgift — ikke i dag med 259 brugere. |

**Anbefalet vej:** maskinoversættelse (#4733-pipelinen) som dag-1-dækning for et nyt sprog, kaptajn-review som kvalitetslag der ruller ind løbende (ikke en blokerende forudsætning for launch — nøgler starter som `machine`, flippes til `reviewed` efterhånden). Professionel oversætter er ikke relevant ved nuværende spillerantal (259 brugere totalt, alle sprog).

**Det ejeren skal beslutte:** om et sprog må gå live UDEN en kaptajn på plads (ren maskinoversættelse, ingen fagsprogs-kvalitetssikring før en frivillig melder sig), eller om en kaptajn er en hård forudsætning for at aktivere et nyt sprog. Dette er ikke besvaret i #4733 eller #4110 endnu.

---

## D) Anbefaling pr. spørgsmål + rækkefølge

**1. Hvilke lande er relevante?**
→ **Belgien før Frankrig**, baseret på data, ikke antagelse: Belgien har lavere volumen men markant bedre engagement (57 % vs. 94-100 % bounce hos de andre). Frankrigs høje besøgstal er ikke det samme som interesse — næsten alle forlader med det samme. Slovenien og Colombia er stærke kvalitative kandidater (højeste cykelinteresse pr. indbygger) men har praktisk talt ingen målt trafik i dag — hold øje med dem, invester ikke i dem endnu.
*Hvad sker der hvis intet vælges:* status quo (EN/DA) er fint — der er ikke noget aktuelt tab ved at vente, for ingen af kandidatlandene har volumen nok til at retfærdiggøre et 3. sprog i dag.

**2. Hvor svært er det teknisk?**
→ **Allerede løst til "næsten gratis"** af #4733 (lukket) — MEN #4734 (åben, backend-tekst-hullet) skal lukkes FØRST, ellers får sprog 3 falsk fuld dækning på notifikationer/Discord/klub-DNA. Dette er den konkrete, afgrænsede blocker, ikke en ny stor investering.
*Hvad sker der hvis intet vælges:* #4734 forbliver åben og ufarlig indtil et 3. sprog rent faktisk aktiveres — ingen hastværk, men den SKAL være lukket før sprog 3 går live, ellers er det en kendt kvalitetsregression dag 1.

**3. Hvornår er det relevant?**
→ **Ikke endnu.** Den trigger ejeren allerede godkendte 3/9 (jf. #4733: ≥5 % af engagerede sessions ELLER ≥10 aktive managers/30 dage fra sprogområdet ELLER 3+ spillerønsker, OG en kaptajn på plads) er stadig den rigtige tærskel — ingen af de 9 kandidatlande er tæt på den i dag ud fra de tal vi kan måle. Det eneste nye i denne rapport er retningen INDEN for rækkefølgen (Belgien/flamsk-fransk før Frankrig alene), samt et hul i selve målingen: signup-pr.-land findes ikke i dag (se afsnit A), så triggeren kan først følges pålideligt når `browser_language`-data har akkumuleret nogle uger, eller et rigtigt land-felt findes.
*Hvad sker der hvis intet vælges:* triggeren fra #4733 forbliver den stående regel, og #4110 kan lukkes som "afklaret, ingen sprog udløst endnu" — ingen ny beslutning kræves før tærsklen rammes.

---

## Kilder og forbehold

- Trafik/engagement: Microsoft Clarity, ikke-bot sessions, målt 5/9 2026 (30- og 90-dages vinduer angivet pr. tabel).
- Vercel Web Analytics: **ingen adgang** — "Web Analytics not found" for projektet (ikke aktiveret).
- Google Search Console / Ahrefs: **ingen adgang** — kræver godkendelse af MCP-forbindelsen (ikke gjort i denne session).
- Signup-pr.-land: **ingen data findes** — `users`-tabellen har ingen land-kolonne, og den nye `browser_language`-kolonne (#4737, 3/9) har 0 udfyldte rækker ud af 259 brugere pr. 5/9 (læst read-only, ingen skriv).
- Cykelinteresse-kilder: se enkeltcitater i afsnit A — ingen opfundne procenttal.
- Nøgle-/ordtal: målt direkte i `frontend/public/locales/en/*.json` (47 filer) 5/9 2026 med et lille tælle-script; afviger fra #4733's tal fra 3/9 (se note i afsnit B).
