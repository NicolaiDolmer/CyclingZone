# Roadmap-hub: plan, afstemning, kendte fejl og færdigt på én side

**Status:** retning ejer-godkendt 4/10 (tre kort: plan/stem-opdeling, "det rammer også mig", samlet design) · spec til ejer-læsning · byg i bølge derefter
**Issues:** [#5387](https://github.com/NicolaiDolmer/CyclingZone/issues/5387) (roadmap = roadbooken, faner, "vis kun det jeg ikke har stemt på") · [#5388](https://github.com/NicolaiDolmer/CyclingZone/issues/5388) (roadmap-svar i /admin/growth) · [#5845](https://github.com/NicolaiDolmer/CyclingZone/issues/5845) (indholdsopdatering) · [#3941](https://github.com/NicolaiDolmer/CyclingZone/issues/3941) (kendte problemer, lukket: flyttes hertil)
**Billede (godkendt retning):** `pr-screens/roadmap-4-10/roadmap-foer-efter.png` (kilde: `roadmap-foer-efter.html` samme sted)
**Afløser:** mockuppen `docs/design/mockups/5387-roadmap-tabs/` (variant A/B fra 26/9). Den forbliver som historik.

## 1. Hvorfor

Ejerens ønske 4/10: et fast, synligt roadmap hvor planlagte opgaver står i cirka forventet rækkefølge og flytter til "done", når de er færdige. Afstemningen skal være faneopdelt og nemmere, med et filter for det man ikke har stemt på. Det færdige skal ud af afstemningen, nye idéer ind. Ejeren skal kunne se analyser af punkterne bagved. Kendte fejl skal flettes ind, så spillerne kan se hvad der arbejdes på, og ejeren kan give løbende opdateringer.

Målt i prod 4/10:

- `/roadmap` er én side på 7.037 px (ca. 8 skærme) med 42 aktive punkter grupperet efter motor. Plan og idéer er blandet, og alt har to skalaer (84 klik for at svare på alt).
- 1.121 stemmer fra 42 managers (276 hold har en manager). 8 af 41 har svaret på alle aktive punkter, 31 har svaret på under 20. De 28 punkter fra 24/9 har 9-12 stemmer, de ældre 34-40.
- "Known issues" er en fane under Hjælp, der læser `ops_notices` (driftsbanneret). Tabellen har 1 række i alt, fra 20/8. Den reelle liste findes kun som ejerens forum-udkast fra 30/9.
- Styringsscoren findes i viewet `roadmap_item_scores`, men ingen admin-flade viser den.

## 2. Beslutninger (ejer 4/10)

1. **Plan og afstemning skilles ad.** Det besluttede står på en Plan-fane. Idéer, der overvejes, står på en Vote-fane.
2. **Det planlagte har én skala** ("Important to you?", 1-6), så ejeren får spillernes prioritering og selv lægger den endelige rækkefølge. Det, der er i gang, stemmes der ikke på.
3. **Idéer beholder begge skalaer** ("Good idea?" og "Important to you?", 1-6) præcis som i dag. Styringsscoren regnes som i dag: (Ø vigtighed · 0,6 + Ø god idé · 0,4) · √(antal stemmer). Ingen stemmer slettes eller nulstilles.
4. **Kendte fejl får en fane** med tre trin, daterede ejer-opdateringer og knappen "Affects me too".
5. **Analysen bor bagved** som ny fane under `/admin/growth`.
6. **Færdig-reglen: del punktet.** Er kun en del af et punkt leveret, flytter det leverede til Done med en titel, der siger præcis hvad der er live, og resten bliver et nyt punkt på planen. Stemmerne kopieres, så de står på begge punkter (billede: `pr-screens/roadmap-4-10/faerdig-regel.png`).

Uændrede, tidligere beslutninger: spillere ser kun deres egen stemme (11/6) · ingen datoer på planen, kun rækkefølge · EN først, DA under · ejeren godkender al spillertekst før den vises.

## 3. Spillersiden (`/roadmap`)

Skabelon T1 (max-w-4xl), det kanoniske sidehoved, `Tabs`-primitiven. Ruten forbliver offentlig. Fanen ligger i URL'en (`?tab=plan|vote|issues|done`, standard `plan`), så der kan linkes direkte til en fane.

**Sidehoved:** titel "Roadmap" og én linje undertekst. I handlingsklyngen til højre: afkrydsningen "Only what I have not rated" og tælleren "Rated 27 of 42". Afkrydsningen gælder Plan og Vote, er slået til som standard for en indlogget spiller, og valget huskes i `localStorage`. Tælleren dækker planlagte punkter plus idéer.

**Fane-tal:** Plan og Vote viser hvor mange punkter spilleren mangler at svare på. Known issues viser antal åbne fejl. Done har intet tal.

### 3.1 Plan

To kort:

- **In progress:** rækker med titel og en meta-linje (område, evt. "in beta"). Ingen skala.
- **Planned:** nummererede rækker i ejerens rækkefølge. Titel, område, og én skala til højre (under titlen på telefon). Stemmen gemmes ved tryk. Punkter med `horizon = later` ligger bag en fold ("Later · 9 more").

Motorernes "Today"-prosa fra den nuværende side udgår. Done-fanen viser, hvad der findes.

### 3.2 Vote

Ét kort med `Segmented` pr. område (All, Races, Training, Youth, Market, Club; kun områder med punkter vises, hvert med antal). Hver række har titel, område og de to skalaer. Stemmen gemmes, når begge skalaer er valgt (som i dag). Nederst en stille handling, der fører til forummet for egne idéer.

### 3.3 Known issues

Kortet "Being worked on" med `Segmented` pr. område. Hver række: `StatusBadge` (Investigating = advarsel, Fix in progress = info), titel, meta-linje (område · "updated" + dato) og knappen "Affects me too" (secondary sm). Efter tryk viser knappen "Reported", og et nyt tryk fortryder. Spilleren ser kun sit eget tryk.

Opdateringer står som en dateret liste under titlen, nyeste først. Den nyeste vises altid, ældre ligger bag en fold pr. fejl.

Under listen en fold: "Fixed in the last 14 days". Rettede fejl står desuden i Done.

Hjælp-sidens "Known issues"-fane fjernes. `/help?section=knownIssues` viderestiller til `/roadmap?tab=issues`, og driftsbannerets link peger samme sted. `ops_notices` og selve banneret er uændrede (akut drift). Listen over tidligere driftsbeskeder udgår (1 række i alt siden 18/8).

### 3.4 Done

Én liste, nyeste først: dato, titel og et mærke (Feature eller Fix). Kilder: `roadmap_items` med `status = shipped` og `known_issues` med `status = fixed`. Viser de 30 nyeste, resten bag "Show more".

### 3.5 Tilstande

- **Udlogget:** alt kan læses. Skalaer og "Affects me too" vises ikke. Én linje med login-link står over listen.
- **Loading:** `Skeleton` i kortene, kort-chrome står. Antallet af skeleton-rækker er fast (den statiske `engines.*.next`-fallback i locale-filerne fjernes).
- **Tom fane / alt besvaret:** `EmptyState` efter TASTE P6 (handling + én knap). Eksempel på Vote med filter slået til og intet tilbage: titel om at slå filteret fra, knap der gør det.
- **Fejl ved gem:** uændret mønster (`aria-live`, tekst i fare-farve, valget står).
- **Telefon (375 px):** fanerne scroller vandret, skalaknapper er mindst 34 px, skalaen står under titlen. Ingen vandret sidescroll.

## 4. Admin (`/admin/growth?tab=roadmap`)

Ny fane "Roadmap" i `AdminGrowthPage` (T2, dansk tekst som resten af admin). Admin-kontrollerne på selve `/roadmap` (markér bygget, opret-formular) flytter hertil, så den offentlige side ikke bærer admin-kode.

- **Nøgletal:** har stemt (af hold med manager) · aktive 14 dage · stemmer i alt · har svaret på alt.
- **Planen, som spillerne vil have den:** planlagte punkter sorteret efter Ø vigtighed. Kolonner: punkt, vigtighed, stemmer, ejerens rækkefølge. Mærket "Deler spillerne" når spredningen på vigtighed er høj (standardafvigelse ≥ 1,75). Handlinger: flyt op/ned, skift status (idé, planlagt, i gang, færdig, arkiveret), Next/Later, ret titel (EN + DA).
- **Idéer:** sorteret efter styringsscore. Kolonner: god idé, vigtighed, score, stemmer. Handling: "Til planen" (status `active` → `planned`; stemmerne følger med).
- **Kendte fejl:** sorteret efter antal "rammer også mig". Kolonner: fejl, trin, ramt, åben i dage. Handlinger: ny opdatering (EN + DA), skift trin, ret titel.
- **Opret:** nyt punkt eller ny fejl (EN + DA, område, synlig ja/nej).
- **Del punkt:** på et punkt vælges "Del", og resten får sin egen titel (EN + DA), status og Next/Later. Det nye punkt oprettes skjult med en kopi af alle stemmer fra det oprindelige, så teksten kan godkendes, før det vises. Det oprindelige punkt får bagefter sin nye, præcise titel og flyttes til Done.

Rækker med `approved = false` / `published = false` vises kun her, så tekst kan godkendes før den er synlig.

## 5. Data

Alt er additivt. Ingen rækker slettes, ingen stemmer ændres.

### 5.1 `roadmap_items`

- `status`-CHECK udvides til `active, planned, in_progress, shipped, archived`. `active` beholder sin betydning (idé åben for afstemning), så den nuværende klient virker uændret mellem migration og frontend-deploy.
- Ny kolonne `horizon TEXT NOT NULL DEFAULT 'next' CHECK (horizon IN ('next','later'))`. Bruges kun for `planned`.
- Ny kolonne `issue_ref INTEGER NULL` (GitHub-issue). Bruges af færdig-rutinen (§7). Repoet er offentligt, så nummeret er ikke en hemmelighed.
- Læse-policies (anon + authenticated): godkendte rækker med status `active, planned, in_progress, shipped`.

### 5.2 `roadmap_votes`

- `idea_score` bliver nullable (planlagte punkter har kun vigtighed). CHECK 1-6 står.
- Insert/update-policies: punktet skal være godkendt og have status `active` eller `planned`. Stemmer på punkter i gang eller færdige er låst og bevaret.
- Flyttes en idé til planen, beholder eksisterende rækker begge tal. Nye stemmer på et planlagt punkt skriver kun `importance_score` og rører ikke en eksisterende `idea_score`.

### 5.3 `roadmap_item_scores` (view)

Formlen er uændret. Viewet får tilføjet `sort_order`, `horizon`, `title_da`, `importance_votes` og `sd_importance`. Fortsat `security_invoker`, så kun admin ser de samlede tal.

### 5.4 Kendte fejl (nye tabeller)

- `known_issues`: `id`, `area` (`races, training, youth, market, club, other`), `status` (`investigating, fixing, fixed`), `title_en`, `title_da`, `published` (default false), `sort_order`, `issue_ref`, `created_at`, `updated_at`, `fixed_at`.
- `known_issue_updates`: `id`, `issue_id` (FK, cascade), `body_en`, `body_da`, `created_at`.
- `known_issue_reports`: `issue_id`, `user_id`, `created_at`, primærnøgle (`issue_id`, `user_id`).
- RLS: publicerede fejl og deres opdateringer kan læses af anon og authenticated. Skrivning kun `is_admin()`. Reports: spilleren læser, opretter og sletter kun sine egne, og kun på publicerede fejl der ikke er rettet. Admin læser alle.
- View `known_issue_scores` (`security_invoker`): antal reports pr. fejl og dage åben.

### 5.5 Del punkt

RPC `roadmap_split_item(source, title_en, title_da, status, horizon, issue_ref)` bag `is_admin()`: opretter et nyt punkt (samme område, `approved = false`) og kopierer alle stemmerækker fra kildepunktet til det nye. En spillers stemme kan ændres på hvert punkt for sig bagefter. Kildepunktet røres ikke.

### 5.6 Nøgletal

View eller RPC bag `is_admin()`, der giver de fire nøgletal i §4 i ét kald, så admin-fanen ikke henter alle stemmerækker til klienten.

## 6. Kode

Nye frontend-filer er `.ts`/`.tsx`. `RoadmapPage.jsx` (431 linjer i dag) bliver en tynd skal:

- `pages/RoadmapPage.jsx`: sidehoved, faner, hentning, filter-tilstand.
- `components/roadmap/PlanTab.tsx`, `VoteTab.tsx`, `KnownIssuesTab.tsx`, `DoneTab.tsx`, `ScoreScale.tsx`.
- `lib/roadmapModel.ts`: ren logik (opdeling pr. status, "mangler svar"-tælling, filter, Done-fletning). `lib/roadmapVoting.js` udvides med payload for én skala.
- `lib/roadmapUnread.ts`: menu-prikken tager også nyeste `known_issues.created_at` med.
- `components/admin/growth/GrowthRoadmapTab.tsx` + opret/ret-formular (den nuværende `RoadmapAdminCreateForm.jsx` flyttes og udvides).
- `HelpPage.jsx`: fanen fjernes, viderestilling tilføjes. `RaceControlBanner.jsx`: nyt link.
- Locale: `roadmap.json` (en + da) får de nye nøgler, `help.json` (en + da) retter henvisningen. Tekst følger `docs/TONE_OF_VOICE.md` (jeg/I, ingen em-dash). Teksterne i mockuppen er udkast, ejeren godkender de endelige.
- `database/schema-snapshot.json` og `frontend/src/types/database.types.ts` opdateres.

## 7. Færdig-rutinen

`scripts/roadmap-flip.mjs --issue N` finder roadmap-punkter og kendte fejl med `issue_ref = N` og viser, hvad der ville blive flyttet (dry-run). Med `--apply` sættes `shipped`/`fixed` og tidsstemplet.

Rutinen: når en PR lukker et issue, kører close-out scriptet i dry-run. Et fund skrives i PR'ens go-kort ("flytter roadmap-punktet X til Done"), så ejerens "merge" dækker flyttet. Flyttet sker først, når funktionen er live for alle, ikke i beta. Beskrives i `docs/GITHUB_WORKFLOW.md` under close-protokollen.

## 8. Indhold (særskilt, ejer-godkendt)

Indholdet er ikke en del af byggeriet og godkendes for sig i `docs/drafts/2026-10-04-roadmap-indhold.md`:

1. De tre punkter, der skulle være flyttet 27-28/9 (træning pr. løbsdag, U23/junior-trupper, rytterværdier), verificeres mod prod og flyttes til færdig.
2. Hvert af de 42 aktive punkter får et forslag: i gang, planlagt (Next/Later), idé eller færdig, med bevis.
3. Nye idéer til afstemning fra spørgeskemaet 10/9, forummet og backloggen.
4. Kendte fejl fra forum-udkastet 30/9, genverificeret mod live-tilstand, med trin og første opdatering.
5. Planens rækkefølge afstemmes med planlægningssessionen til 1/1-2027 (#6148), så roadmap og `MASTERPLAN.md` ikke vedligeholdes hver for sig.

Trin 1 kan køres med det samme. Trin 2-4 skrives til prod, når migrationen er applied (statusserne `planned` og `in_progress` findes først dér).

## 9. Rækkefølge og udrulning

1. **Migration** (egen PR, merges først): §5. Idempotent, additiv, post-verify efter auto-migrate. Den nuværende side virker uændret bagefter.
2. **Spillersiden** og **admin-fanen** bygges parallelt mod den applied migration. Hver UI-PR får ét annoteret før/efter-billede og ejer-go på preview før merge.
3. **Færdig-rutinen** (script + docs).
4. **Indhold** skrives til prod efter ejerens godkendelse af §8.
5. Patch note (EN først) og `help.json` følger spillersidens PR. Ejeren poster selv i Discord.

Intet feature-flag: siden er offentlig læsning, migrationen er additiv, og den gamle side kan genskabes med en revert.

## 10. Test

- `node --test`: `roadmapModel.ts` (opdeling, tælling, filter, Done-fletning), `roadmapVoting` (payload for én og to skalaer), `roadmapUnread`.
- RLS-integration (`backend/lib/testdb`): anon læser kun publicerede/godkendte rækker · spiller kan stemme på `active` og `planned`, ikke på `in_progress`/`shipped` · spiller ser kun egne stemmer og egne reports · kun admin skriver punkter, fejl og opdateringer · `audit-rls-coverage` dækker de tre nye tabeller.
- Playwright: fane-skift og dyb-link, filteret, stem på idé (to skalaer) og på planlagt (én skala), "Affects me too" til/fra, udlogget visning, viderestillingen fra Hjælp. Snapshots i alle tre projekter.
- TIER FULL før push (i18n og delte libs er rørt): `scripts/verify-local.ps1`, lint, build, hele `npm run test:e2e`.

## 11. Ikke med

- Spillere kan ikke selv oprette idéer på siden (forummet er vejen).
- Spillere ser ikke samlede resultater eller andres stemmer.
- Ingen datoer eller sæsonnavne på planen.
- Ingen automatisk synk fra GitHub-issues til roadmappet ud over færdig-rutinen i §7.
- `ops_notices` og driftsbanneret ændres ikke.
