# Sprogtest fr + es, Sonnet-sporet (#6586)

> Refs #6586, #4110, #4733. Rapport fra Sonnet-sporet. Ejer-valg A 13/10: ingen API-nøgle og intet kald af `scripts/i18n-translate-delta.mjs`. Sonnet (Claude Sonnet 5.5) har oversat selv, direkte i Claude Code-sessionen. Locale-filerne for fr/es er IKKE committet (de ligger i scratch uden for repoet). Intet er åbnet for spillere.

## Kort konklusion

- Mængden er næsten alt i `help`: 96 % af tegnene og ordene i de tre namespaces ligger i `help.json` (184.303 af 191.464 tegn, 32.669 af 33.943 ord, men kun 991 af 1.316 strenge).
- Alle tre namespaces blev oversat til begge sprog med alle nøgler bevaret (1.316 nøgler pr. sprog, 0 manglende, 0 ekstra), og de CI-gates der kan køres mod fr/es er grønne (ICU-klammer, em-dash, døde produktudtryk, nøgle-paritet for de tre namespaces).
- API-pris for ét helt sprog (alle 50 namespaces) er et skøn: Sonnet ca. 25 kr standard / ca. 13 kr via Batch, Haiku ca. 1,3 kr. To sprog på Sonnet standard er ca. 50 kr, altså ved ejer-grænsen på 50 kr.
- Første udkast havde fejl en gate ikke fanger: 3 hele sektioner blev oversprunget i `help` (fanget af min egen nøgle-sammenligning), 2 "vous"-slip i et tu-sprog, og inkonsekvent term for wishlist/watchlist. En manuel, ikke-gated oversættelse kræver altså altid nøgle-paritet og et term-pas.
- Layout: fransk (+10-25 % tegn) knækker ikke auktions- eller hjælpesiden. Små afvigelser nævnt nedenfor.

Ingen evidens fra dette spor om Haiku-kvalitet (Haiku er et separat spor). Alt om Haiku nedenfor er pris, ikke kvalitet.

## 1. Vægt pr. namespace

Kilde: `frontend/public/locales/en/{common,auctions,help}.json`. Ord = whitespace-adskilte tokens i strengværdier. Tegn = summen af strengværdiernes længde (uden JSON-syntaks). Fil = bytes på disk.

| Namespace | Strenge | EN tegn | EN ord | EN fil (B) | FR tegn | FR ord | FR fil (B) | ES tegn | ES ord | ES fil (B) |
|---|---|---|---|---|---|---|---|---|---|---|
| common | 104 | 1.326 | 236 | 4.001 | 1.748 | 302 | 4.341 | 1.737 | 299 | 4.313 |
| auctions | 221 | 5.835 | 1.038 | 11.616 | 7.412 | 1.193 | 13.154 | 6.960 | 1.190 | 12.558 |
| help | 991 | 184.303 | 32.669 | 217.949 | 224.952 | 38.543 | 263.004 | 217.197 | 37.545 | 252.827 |
| I alt | 1.316 | 191.464 | 33.943 | 233.566 | 234.112 | 40.038 | 280.499 | 225.894 | 39.034 | 269.698 |

Udvidelse i forhold til engelsk (tegn): fransk +22 %, spansk +18 %. Ord: fransk +18 %, spansk +15 %. Korte UI-strenge (common) vokser mest: fransk +32 %, spansk +31 %.

Hele det engelske locale-katalog (alle 50 filer) er 795 KB, ca. 87.700 ord, 10.221 strenge. De tre testede namespaces er 29 % af bytes og 39 % af ordene, så alle tal for "et helt sprog" nedenfor skalerer med ca. 3,4.

## 2. Tid

Ikke instrumenteret. Skøn ud fra filernes skrivetidspunkter og commit-tidspunkter i sessionen (22:18 til ca. 22:43, 13/10):

- common + auctions, begge sprog: ca. 2 minutter.
- help, begge sprog (læsning af kilden i bidder + skrivning af 7 delfiler pr. sprog): ca. 20 minutter.
- Efterfølgende rettelser (oversprungne sektioner, term-pas, validering): ca. 5 minutter oveni.
- Samlet ca. 25 minutter vægtid for 2 sprog x 3 namespaces, interaktivt i én session (ca. 12 minutter pr. sprog for 233 KB engelsk).

Det er ikke et tal for API-tid. Via API'et er tiden domineret af output-token-hastigheden: ca. 78.000 output-tokens pr. sprog er i størrelsesordenen få minutter pr. sprog, uden at jeg har målt det.

## 3. Pris via API (skøn, ikke målt)

Priser fra claude-api-skillens modeltabel (cachet 2026-10-06), pr. 1 mio. tokens: Sonnet 5.5 $2 ind / $10 ud; Haiku 5.5 $0,10 ind / $0,50 ud (op til 100K tokens pr. prompt, derefter dyrere). Batch API er 50 % billigere.

Antagelser (alle skøn, +/- 20 %):

- 1 token pr. ca. 4 engelske tegn i JSON, og ca. 3,5 tegn i fransk/spansk. Ingen tokentælling er kørt (ingen API-nøgle, ejer-valg A).
- Input: 233.566 B engelsk = ca. 58.000 tokens + ca. 45.000 tokens prompt/glossar-overhead fordelt på ca. 30 bidder (så ingen enkelt prompt kommer over 100K).
- Output: fransk ca. 78.000 tokens, spansk ca. 75.000 tokens (filbytes fra tabellen).
- 10 % ekstra til genkørsel af bidder der fejler en gate.
- 1 USD = 6,9 kr.

| | Input-tokens | Output-tokens | Sonnet 5.5 standard | Sonnet 5.5 Batch | Haiku 5.5 standard |
|---|---|---|---|---|---|
| Fransk, de 3 namespaces | ca. 103.000 | ca. 78.000 | ca. $1,1 = 7,6 kr | ca. 3,8 kr | ca. $0,05 = 0,4 kr |
| Spansk, de 3 namespaces | ca. 103.000 | ca. 75.000 | ca. $1,1 = 7,4 kr | ca. 3,7 kr | ca. $0,05 = 0,4 kr |
| Ét helt sprog (x 3,4, alle 50 namespaces) | ca. 350.000 | ca. 265.000 | ca. 25 kr | ca. 13 kr | ca. 1,3 kr |

Forhold Sonnet : Haiku er 20 : 1 på både ind- og udpris.

Engangsprisen for testen (kun de 3 namespaces, begge sprog, Sonnet standard) er ca. 15 kr, langt under grænsen på 50 kr. To hele sprog på Sonnet standard er ca. 50 kr, så ejer-grænsen skal ses igen hvis det bliver aktuelt.

## 4. CI-gates mod fr/es (scratch-kopi)

Filerne blev kopieret til en scratch-kopi af repoet (`scripts/`, `frontend/`, `marketing/`, `docs/`) og gaterne kørt dér. Intet i worktreets `frontend/public/locales` er rørt.

| Gate | Resultat for fr + es |
|---|---|
| `i18n-check-icu-braces` | Grøn |
| `tone-check-em-dash` | Grøn (0 em-dash i fr/es) |
| `tone-check-terms` | Grøn (ingen døde produktudtryk) |
| `i18n-check-keys` | Ingen fejl for common, auctions, help i fr/es. Fejlene den rapporterer er alle de 47 andre namespaces der ikke er oversat i testen |
| `i18n-check-leaks` | Kan ikke bruges: den sammenligner kun `en` og `da` (`EN_DIR`/`DA_DIR`) og scanner backend-kode, så fr/es indgår ikke. Ikke kørt til ende (kræver `backend/routes`) |
| Min egen strukturtest (nøgler, arrays, `{pladsholdere}`, HTML-tags, klammer) | 0 manglende, 0 ekstra, 0 afvigende tags, 0 klammefejl. De 4 "pladsholder"-afvigelser pr. sprog i auctions er plural-tekster (`{count, plural, one {...}}`) hvor ordene inde i klammerne er oversat med vilje |

Hvad en gate IKKE fandt, men som jeg selv fandt:

1. Tre hele sektioner (`mandate`, `auctions`, `transfers`) i `help` var oversprunget i første udkast. Kun nøgle-sammenligning mod engelsk fangede det. Ingen eksisterende gate sammenligner endnu et nyt sprog mod `en` på tværs af alle namespaces, før sproget er registreret.
2. To "vous"-slip i et sprog der ellers er tu (fransk), og ét "vosotros" i spansk, som ellers bruger tú. Fundet med grep.
3. Wishlist og watchlist er to strenge i engelsk (`auctions: "Wishlist only"` og `common: "Watchlist"`). Jeg oversatte dem ulige i fransk ("Favoris uniquement" / "Liste de suivi"). Se glossar-afsnittet.

## 5. Kvalitetsstikprøve, 20 strenge pr. sprog

Udtrukket med fast frø blandt strenge på 12 til 260 tegn (alle tre namespaces). Vurdering mod `docs/TONE_OF_VOICE.md` og `docs/i18n/GLOSSARY.md`. Bemærk at jeg bedømmer min egen oversættelse, så den bør læses af en indfødt (se "Hvad testen ikke dækker").

| # | Nøgle | EN | FR | ES | Vurdering |
|---|---|---|---|---|---|
| 1 | common:controls.compareRemove | Remove from comparison | Retirer de la comparaison | Quitar de la comparación | God |
| 2 | common:controls.watchlistAdd | Add to watchlist | Ajouter à la liste de suivi | Añadir a la lista de seguimiento | God |
| 3 | help:prizes.formula.title | The prize formula | La formule des gains | La fórmula de los premios | God |
| 4 | help:riders.typeOverview.rows[4][1] | Short, steep efforts and hilly finales. | Efforts courts et raides et finales vallonnées. | Esfuerzos cortos y empinados y finales ondulados. | God |
| 5 | help:faq.seasonFinanceReport.q | What does the season finance report show, and where do I find it? | Que montre le rapport financier de la saison, et où le trouver ? | ¿Qué muestra el informe financiero de la temporada y dónde lo encuentro? | God |
| 6 | auctions:bidGate.bothFullU23 | No room on your U23 team ({max}/{max}) or senior squad (30/30). Sell a rider to bid. | Plus de place dans ton équipe U23 ({max}/{max}) ni dans ton effectif senior (30/30). Vends un coureur pour enchérir. | No queda sitio en tu equipo sub-23 ({max}/{max}) ni en tu plantilla sénior (30/30). Vende un ciclista para poder pujar. | God, pladsholdere intakte |
| 7 | help:season.divisionBonus.rows[0][0] | Where you finished | Ta place | Dónde acabaste | FR kortere end kilden og mister "hvor du endte"; ES tættere |
| 8 | help:prizes.examples.rows[3][0] | Stage win (Grand Tour) | Victoire d'étape (Grand Tour) | Victoria de etapa (Grand Tour) | God |
| 9 | help:riders.abilitiesExplained.rows[6][2] | Sprints, hilly attacks | Sprints, attaques en terrain vallonné | Sprints, ataques en terreno ondulado | God |
| 10 | help:raceSelection.seasonOverview.title | Season view on the planning board | Vue de la saison sur le tableau de planification | Vista de temporada en el tablero de planificación | God |
| 11 | common:table.moreRight | More columns to the right | Plus de colonnes à droite | Más columnas a la derecha | God |
| 12 | help:youthSquads.whatAreTheseSquads.title | What are U23 team and Junior team? | Que sont l'équipe U23 et l'équipe juniors ? | ¿Qué son el equipo sub-23 y el equipo júnior? | God. Kilden bruger "U23" i begge sprog, jeg valgte sub-23 på spansk |
| 13 | help:faq.raceJerseysFaq.q | How do the green jersey and mountains jersey work? | Comment fonctionnent le maillot vert et le maillot à pois ? | ¿Cómo funcionan el maillot verde y el maillot de la montaña? | God, men FR "à pois" er idiomatisk, ES følger kilden |
| 14 | auctions:filter.searchPlaceholder | Search riders | Rechercher des coureurs | Buscar ciclistas | God |
| 15 | help:activityfeed.whatShown.rows[1][1] | Team won an auction (shows rider and price) | Une équipe a remporté une enchère (affiche le coureur et le prix) | Un equipo ha ganado una subasta (muestra al ciclista y el precio) | God |
| 16 | help:season.seasonFlow.steps[2] | Races are run by the Cycling Zone race engine, which simulates each stage and writes the results automatically. | Les courses sont simulées par le moteur de course de Cycling Zone, qui simule chaque étape et écrit automatiquement les résultats. | Las carreras las ejecuta el motor de carreras de Cycling Zone, que simula cada etapa y escribe los resultados automáticamente. | FR gentager "simulées/simule" (stilistisk). ES fin |
| 17 | help:discord.howToGetDms.steps[4] | Click 'Send test DM' to verify it works. | Clique sur « Envoyer un MP de test » pour vérifier que cela fonctionne. | Haz clic en «Enviar MD de prueba» para comprobar que funciona. | God. "MP"/"MD" er gængse betegnelser, men skal bekræftes mod Discords egne fr/es-UI |
| 18 | help:faq.howToWinRace.q | How do I win a race, and what decides the result? | Comment gagner une course, et qu'est-ce qui décide du résultat ? | ¿Cómo gano una carrera y qué decide el resultado? | God |
| 19 | help:discord.whenDmsSent.rows[5][0] | A new auction is created (all managers) | Une nouvelle enchère est créée (tous les managers) | Se crea una subasta nueva (todos los mánagers) | God. "mánager" følger RAE-stavning |
| 20 | help:faq.multiYearPlanLock.q | Why can't I pivot my 5-year plan before it's halfway done? | Pourquoi ne puis-je pas réorienter mon plan quinquennal avant la moitié de sa durée ? | ¿Por qué no puedo reorientar mi plan a 5 años antes de que lleve la mitad? | God. "pivot" er oversat til "réorienter/reorientar" |

18 af 20 uden bemærkninger, 2 med stilistiske bemærkninger (7, 16). Ingen fejl i betydning blandt de 20.

Tone mod `TONE_OF_VOICE.md`:

- Jeg-stemmen bevares ("Je liste", "Solo yo", "Je suis le seul à lancer ..."). Ingen "nous/vi"-form. Fiktive bestyrelsesmedlemmer er ikke rørt.
- Tiltale: du-formen bevares som tu (fr) og tú (es), i tråd med den uformelle danske/engelske stemme. Det er et valg der bør godkendes af en indfødt, især for fransk hvor "vous" er den sikre standard i mange spil.
- Ingen emoji-pynt, ingen em-dash, ingen opfundet tekst. Interne identifikatorer (`race_results`, `italian_classics`, `/seasons`) er bevaret ordret.

Mod `docs/i18n/GLOSSARY.md`: glossaret har kun en dansk kolonne, så der findes intet fr/es-facit at holde oversættelsen op imod. Jeg har valgt:

| EN | FR | ES |
|---|---|---|
| Squad | effectif | plantilla |
| Board | Direction | Directiva |
| Auction / Bid | enchère / enchérir | subasta / pujar |
| Rider | coureur | ciclista |
| Manager | manager | mánager |
| Watchlist | liste de suivi | lista de seguimiento |
| Wishlist | Favoris (inkonsekvent) | favoritos (inkonsekvent) |
| Clubhouse | Siège du club | Sede del club |
| Season / Division | saison / division | temporada / división |
| Patch Notes, Deadline Day, Hero & Agony, CZ$, Cycling Zone | uændret | uændret |

Et fr/es-glossar skal findes før et rigtigt sprog åbnes, ellers driver termerne på tværs af filer.

## 6. Layout (fransk, ?lng=fr)

Sådan er det gjort: en midlertidig scratch-kopi af frontend (ingen ændring i worktreets `frontend/`), med fr/es tilføjet i kopiens `languages.js`, bygget med `vite build` og kørt mod e2e-netværksmocks (`tests/e2e/fixtures.js`, samme fixtures som øvrige `*.shots.mjs`). Serveren blev startet og lukket i samme proces. Intet er deployet, og sproget er ikke valgbart i LanguageSwitcher i repoet.

Billeder (desktop 1280 og mobil 390): `pr-screens/6586/sonnet-fr-samlet.png` (alle fire samlet), plus `sonnet-fr-auctions-desktop.png`, `sonnet-fr-auctions-mobile.png`, `sonnet-fr-help-desktop.png`, `sonnet-fr-help-mobile.png`.

Fund:

- Auktionssiden og hjælpesiden bryder ikke layoutet. Faner, tabelhoveder, knapper og hjælpens sektionsliste står rent på desktop. Hjælpens sidebar-liste har plads til de franske sektionsnavne ("Classement mondial", "Entraînement quotidien" bryder til to linjer).
- Sidebar-footeren: "Se déconnecter" bryder til to linjer på desktop.
- Mobil, bundnavigation: "Tableau de bord" fylder hele sin celle og "Boîte de réception" bryder til to linjer. Lige på kanten af at blive klippet.
- Mobil, auktionskort: den franske tekst "Aucune enchère pour le mo..." afkortes i en lille mærkat. Samme afkortning er også mulig på engelsk, men fransk er længere.
- Tal i hjælpeteksten ("500,000 CZ$" i "Premiers pas") formateres stadig med engelsk tusindtalsseparator, fordi værdien indsættes af appen og ikke af oversættelsen. Det er en app-ting, ikke en oversættelsesfejl.
- Kun common, auctions og help er oversat. Resten af appen (fx login, dashboard) falder tilbage til engelsk i skærmbillederne, og siden viser derfor en blanding. Det er forventet i testen.

## 7. Anbefaling

Konkret, men baseret på kun ét model-spor (Sonnet) og uden Haiku-sammenligning:

1. Model pr. namespace-type (foreløbigt, til bekræftelse mod Haiku-sporets resultat):
   - Tung hjælpetekst og FAQ (lange afsnit, mange nuancer, jeg-stemme): Sonnet. Her er der mest at tabe på en stiv eller fejloversat sætning, og pris er ikke en begrænsning (ca. 8 kr pr. sprog for `help` alene).
   - Korte UI-strenge (common, auctions-lignende): Haiku kan være nok og koster en tyvendedel. Ingen evidens endnu fra dette spor. Afgøres af Haiku-sporets stikprøve.
2. Estimeret pris for et helt sprog: ca. 25 kr Sonnet standard, ca. 13 kr Batch, ca. 1,3 kr Haiku (skøn, se afsnit 3). Estimeret tid via API: få minutter pr. sprog i selve oversættelsen, ikke målt. Reel tid er domineret af gennemlæsning af en indfødt.
3. Det der faktisk koster tid og penge er ikke oversættelsen, men kvalitetssikring: en indfødt gennemlæsning af ca. 88.000 engelske ord (40.000 i de tre namespaces), et fr/es-glossar, og en gate der kræver nøgle-paritet mod `en` for et nyt sprog før det registreres. Uden den gate kan hele sektioner forsvinde uden at CI ser det (det skete i første udkast her).
4. Hvis fransk bliver næste sprog: beslut tu eller vous før første oversættelse, og skriv termvalgene i `GLOSSARY.md` først.

Reglen fra #4110 om sprogkaptajn og efterspørgsel står uændret. Denne rapport åbner ingen sprog.

## 8. Hvad testen ikke dækker

- Ingen indfødt har læst teksten. Stikprøven er min egen bedømmelse af min egen oversættelse.
- Ingen Haiku-oversættelse i dette spor, så ingen model-sammenligning.
- Tid og pris er skøn. Tokens er ikke talt med `count_tokens`, intet API-kald er lavet, og scriptet `i18n-translate-delta.mjs` er ikke kørt (ejer-valg A). Scriptets egne guardrails (bidder, glossar-prompt, gate-genkørsel) er derfor ikke målt, og et API-flow kan opføre sig anderledes end en interaktiv session.
- De 47 andre namespaces (backendMessages, board, races osv.) er ikke oversat og ikke målt, kun skaleret med bytes.
- `i18n-check-leaks` og backend-gates dækker ikke fr/es. `i18n-check-keys` kører kun på de tre namespaces.
- Layout er kun set på auktions- og hjælpesiden med mock-data, ikke på alle sider, ikke med lange rigtige holdnavne, og ikke i Safari/Android.
- fr/es er ikke registreret i det rigtige `languages.js`, og `users_language_check` er ikke rørt.
