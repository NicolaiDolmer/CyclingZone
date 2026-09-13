# Uafhængig audit af chunk-fejl og PR #5139

## Dom i tre linjer

1. **RET FØRST.** #5139 kan slette ugemt input ved et automatisk reload; reproduceret på PR-preview i både Chromium og WebKit. `P:frontend/src/lib/releaseWatch.js:96-103,235-246,332-336`, `M:frontend/src/pages/LoginPage.jsx:97-100`. Bevis E4.
2. **NEJ til den samlede løsning som færdig, langsigtet arkitektur.** Stabile hashes, recovery og versionsdetektion er nyttige dele, men garanterer ikke, at en åben fane kan hente sine filer. Den garanti kræver tilgængelige gamle assets eller gennemført versionsbinding. `M:frontend/src/lib/lazyWithRetry.js:112-137`, `P:frontend/src/hooks/useReleaseWatch.js:90-96`. Bevis E2.
3. **Den vigtigste fortsatte årsag er målt versionsbrud:** frontend-filer skifter stadig navn ved deploys med uændret frontend, og de gamle navne giver 404 på det nye deploy. Lag 1's løfte holder ikke. `M:frontend/vite.config.js:9-13,114-146`, `M:scripts/check-build-determinism.mjs:245-273`. Bevis E2 og E3.

## Afgrænsning og læsenøgle

Audit udført 11. september 2026. Ingen commits, branch-skift, deploys, produktrettelser, GitHub-kommentarer eller ændringer af spillerdata. Denne rapport er eneste leverancefil. Patch notes er ikke nødvendige: auditten ændrer ingen spilleradfærd.

- **M** betyder hovedcheckoutet ved `297de21798ee80dd99c2b7b425e0158a94bd47bc`. **P** betyder PR #5139 ved `6454579b32d71a5150a0c8a313acc16f51c25744`, læst i det angivne worktree. Filhenvisninger har formatet `revision:fil:linje`. [Main-snapshot](https://github.com/NicolaiDolmer/CyclingZone/tree/297de21798ee80dd99c2b7b425e0158a94bd47bc), [PR-snapshot](https://github.com/NicolaiDolmer/CyclingZone/tree/6454579b32d71a5150a0c8a313acc16f51c25744).
- Main bevægede sig under auditten til `e8ba676771182f402d3663b74f9af85eaea994bc`. Git-diff viste ingen ændringer i de kontrollerede recovery-filer, build-konfigurationen eller RaceDetailPage. PR-head var fortsat ovenstående SHA og PR'en åben. De undersøgte spilflader og eksisterende recovery-filer var identiske mellem M og P. Bevis E1.
- En **chunk** er en opdelt JavaScript-fil. Et **hash** er et indholdsfingeraftryk i filnavnet. **Deploy** er udgivelse af et build. **Versionsbrud/skew** betyder, at siden refererer til filer fra en anden udgivelse end den, serveren leverer. **Recovery** er forsøg på at komme videre efter en fejl. **CDN/edge** er Vercels distribuerede servercache. **React-state** er data i den kørende sides hukommelse, som normalt forsvinder ved fuld genindlæsning.
- **Reproduceret** betyder målt af denne audit. **Kodebevist** betyder en konkret kontrolsti i læst kode. **Historisk** betyder et tidligere måleresultat i issues/postmortems, ikke en ny måling. E-numrene henviser til bevisregisteret nederst.
- Områdets dokumentation er læst: `M:docs/DEPLOYMENT.md:28-99`, `M:docs/ANALYTICS_STACK.md:7-30`, `M:docs/PLANNING_CENTER_RULES.md:9-37`, samt de relevante taktik- og markedshenvisninger. Dokumentationens løfter er efterprøvet mod kode; de er ikke behandlet som bevis for runtime.

## Fund, sorteret efter alvor

### BLOKERENDE B1: Automatisk reload beskytter fokus, ikke ugemt arbejde

**Ny risiko i #5139.** En spiller skriver en formular, flytter fokus væk for at læse noget og bliver på siden. Næste interval finder en anden release. `isSafeToReload` accepterer nu øjeblikket, fordi kun det aktive element undersøges. Der undersøges hverken kladder, åbne dialoger, aktive gemmekald eller afspilning. Intervallet kalder samme reload-sti som navigation. `P:frontend/src/lib/releaseWatch.js:96-103,235-246,332-336`.

**Reproduceret:** På det faktiske PR-preview udfyldte jeg loginfeltet med usendt testtekst, fjernede fokus og udløste den installerede femminutters-callback. Kun versionssvaret var simuleret. I både Chromium og WebKit ændrede dokumenttælleren sig fra 1 til 2, guard-nøglen blev `1`, og teksten blev tom. Ingen formular blev sendt. Loginfeltet starter i tom React-state. `M:frontend/src/pages/LoginPage.jsx:97-100,652-656`. Bevis E4.

**Konkrete spilflader:**

| Flade | Hvor ugemt tilstand lever | Konsekvens ved #5139-reload |
|---|---|---|
| Løbets holdudtagelse | `M:frontend/src/components/race/RaceSelectionPanel.jsx:57,131-138,264-267,298-307`; monteret via `M:frontend/src/components/race/RaceTeamTab.jsx:180` og `M:frontend/src/pages/RaceDetailPage.jsx:1040` | Valgte ryttere/roller er lokale indtil Gem. Efter fokus flyttes væk fra checkbox/select, kan reload kassere dem og genhente serverens senest gemte udtagelse. Denne flade bruger checkbox/select, ikke drag/drop. |
| Løbets taktik | `M:frontend/src/components/race/RaceTacticsTab.jsx:249-252,395,399-427,444-471` | Intentioner og rollevalg ligger i kladder indtil Gem. Koden ved allerede, om der er ændringer, men watcher læser ikke `dirty`. Et knapvalg kan derfor forsvinde. Gem består desuden af to sekventielle skrivninger, når ordrevisningen er aktiv; reload må ikke afbryde mellem dem. Ordredelen er flagstyret på `M:frontend/src/pages/RaceDetailPage.jsx:1061`, så jeg påstår ikke, at den er aktiv i prod. |
| Planlægningscenterets drag/drop-board | `M:frontend/src/pages/PlanningHubPage.jsx:149`; `M:frontend/src/components/racehub/RaceHubBoard.jsx:56,143-153,591-603` | Drag/drop ændrer kun kladden. **Her findes allerede en `beforeunload`-advarsel**. Jeg konkluderer derfor ikke ubetinget tavst tab: browseren kan spørge om at forlade siden. Watcher burde slet ikke starte denne uventede dialog. Accepteres reload, mistes kladden. Afvises den, rammer man M1 nedenfor. |
| Åbent bud/autobud | `M:frontend/src/lib/useAuctionBidding.js:57-64,124-134,179-181`; `M:frontend/src/pages/AuctionsPage.jsx:1025-1026,1528-1539`; `M:frontend/src/components/BidConfirmModal.jsx:78-94` | Beløb og bekræftelsesdialog er lokale. Dialogen har knapper, som watcher tillader. Før bekræftelse kan dialog/beløb forsvinde; efter bekræftelse kan spilleren miste svaret på et igangværende kald. Dette beviser **ikke**, at et accepteret serverbud slettes eller bliver dobbelt. |
| Træningsuge | `M:frontend/src/pages/TrainingPage.jsx:432-439,586-597,619-636` | Holdets og enkelte rytteres ugekladder er lokale indtil Gem. Et tidligere ændret select beskytter kun, mens det har fokus. Reload kan kassere ændringerne bagefter. |
| Login/oprettelse | `M:frontend/src/pages/LoginPage.jsx:97-100` | Usendt tekst forsvinder efter blur. Målt direkte i begge browsere, E4. |

**Ret konkret:** Indfør én delt tilladelse til automatisk genindlæsning, hvor sider registrerer ugemte ændringer, igangværende skrivninger, buddialog og afspilning. Interval og fokus må kun opdage opdateringen, mens en sådan blokering er aktiv. Genindlæs ved et dokumenteret sikkert punkt eller spillerens udtrykkelige opdateringsklik. Genbrug de eksisterende `dirty`/`busy`-signaler; gem ikke automatisk spillerens kladde som en del af et deploy. Tilføj browsertests for rækkerne ovenfor. Det er en forudsætning for merge.

### HØJ H1: Lag 1 er stadig brudt på rigtige production-builds

**Eksisterende fejl, ikke introduceret af #5139.** To production-deploys med uændret frontend blev sammenlignet direkte:

| | Deploy A | Deploy B |
|---|---|---|
| Commit | `230d9da47252ff9be55ef03e515ed08dba2e945e` | `7e210d5e58d2729b5e29b7d75804d0c9ec81ed88` |
| Vercel-id | `dpl_Bc8HcTtFfw8Z6QUSNfKge38sZZ7d` | `dpl_G5dTFNYTpx63WdNynKpFhU2KHSeR` |
| Entry | `index-CIoYOQts.js` | `index-ahkgCj3j.js` |
| Auktionsside | `AuctionsPage-Goxz2GED.js` | `AuctionsPage-C_27Jy7j.js` |

Git-diffen mellem A og B ændrede kun `.github/dependabot.yml` og `marketing/`. Begge var READY production-deploys. Af de 195 JavaScript-filnavne fundet i hver entry var 119 fælles og **76 udskiftet**. Tallet gælder referencerne i entry, ikke et komplet manifest over samtlige assets. De øvrige 17 asset-URL'er direkte i `app.html` var ens, inklusive CSS. Bevis E2.

En spiller fra A, der senere åbner Auktioner, anmoder om A's fil. Den gav **200 på A**, men **404 på B og cyclingzone.org**. Fejlsvaret havde stadig `max-age=31536000, immutable`, altså et års annonceret friskhed. Det er en konkret fejlkæde, ikke en slutning fra et Sentry-tal. `M:frontend/vercel.json:60-65`, `M:frontend/src/lib/lazyWithRetry.js:112-137`. Bevis E2.

**Hvorfor CI ikke beviser løftet:** CI (automatiske checks) laver ét markør-build og scanner det; sammenligningen af to builds køres ikke i dette job. Sentry-pluginet aktiveres kun med tre miljøværdier, som markørtrinnet ikke sætter. `inject:false` afværger én kendt injektion, men beviser ikke identiske assets. `M:.github/workflows/ci.yml:101-124`, `M:frontend/vite.config.js:9-13,114-146`, `M:scripts/check-build-determinism.mjs:245-273`.

**Afgrænsning:** Entry-filerne har forskellige Sentry-debug-ID'er. Det beviser ikke, at netop ID-genereringen er årsagen; ID'et kan også være afledt af en anden forskel. Jeg har ikke isoleret den første forskellige byte i produktionsbyggeprocessen eller sammenlignet alle build-miljøværdier. Den konkrete plugin-/bundlerårsag er stadig en hypotese. Det målte brud på løftet om stabile filnavne er derimod sikkert. Bevis E2; historisk samme observation i [#4595, 8/9](https://github.com/NicolaiDolmer/CyclingZone/issues/4595).

**Ret konkret:** Kør samme frontend to gange med produktionslignende build-inputs og Sentry-transformationen aktiv. Sammenlign hele manifestet og filernes bytefingeraftryk. Isolér derefter forskellen med plugin til/fra. Adskil source-map-upload fra transformation, så denne test ikke afhænger af et rigtigt upload-token. Accepter ikke et bestået teksttjek som bevis for determinisme.

### HØJ H2: Boot-vagten starter med en tom liste og overser entry-fejl

**Eksisterende fejl, reproduceret på P; produktkoden er identisk med M.** En spiller får en manglende entry-fil ved første indlæsning. Den tidlige, almindelige scriptfil indsamler straks alle modul-URL'er, men parseren har endnu ikke indsat de efterfølgende modultags. Listen bliver tom og genopbygges aldrig. Fejlhandleren afviser derefter ethvert script/link, som ikke er i den tomme liste. `M:frontend/index.html:42,121`, `M:frontend/public/chunk-selfheal.js:79-94,325-341,345-351,390-392`.

**Reproduceret i begge browsere:** Instrumentering af den eksisterende `querySelectorAll` viste `count:0, ready:"loading"` ved installation; efter boot fandtes 28 modul-/preload-tags på loginruten. I en separat kørsel blev kun entry-requesten lokalt besvaret med 404. Resultat: boot-vagten var installeret, `#root` havde 0 børn, ingen heal-guard blev skrevet, ingen selvhelingsadvarsel eller fallback kom frem. Bevis E5.

**Hvorfor tests er grønne:** Testens falske dokument starter som `readyState:"complete"` og returnerer allerede entry/preload-elementerne ved første opslag. Det gengiver ikke parserens rækkefølge. `M:frontend/src/lib/chunkSelfHeal.test.js:63-65,81-90`.

**Ret konkret:** Lad den tidlige guard få en build-genereret liste over boot-filer, inden den installeres. Alternativt indsamles kun parserens boot-tags kontrolleret under indlæsningen, med adskillelse fra senere route-preloads og håndtering af tidlige fejl. Flyt ikke blot hele installationen til `DOMContentLoaded`, hvor den første fejl allerede kan være passeret. Kræv en browsertest med det faktiske HTML og en tidlig entry-404.

### HØJ H3: Versionskontrol efter route-skift kan ikke erstatte navigationen

**Ny funktionsbegrænsning i #5139.** En spiller klikker på en ikke tidligere indlæst side lige efter deploy. React Router har allerede ændret ruten og kan have startet importen, før hookens `useEffect` starter `/version.json`. Desuden kan et nyligt tjek blokere et nyt i 60 sekunder. `P:frontend/src/hooks/useReleaseWatch.js:90-96`, `P:frontend/src/lib/releaseWatch.js:387-395`; route-renderingen ligger i `P:frontend/src/App.jsx:276`.

Det er ikke kun min fortolkning: koden forklarer selv denne rækkefølge på `P:frontend/src/lib/releaseWatch.js:30-34`, men lover samtidig, at laget »fjerner selve vinduet« på linje 8. Begge udsagn kan ikke være sande. E2 beviser, at et sådant gammelt importmål reelt kan være væk.

**Hvad der er bevist:** Polling kan give et ekstra dokument-load, E4 og de eksisterende tests. **Hvad der ikke er bevist:** At første navigation efter et virkeligt deploy undgår ChunkLoadError. E2E-testen ændrer versionsstrenge, men fjerner ingen gamle chunks. `P:frontend/tests/e2e/5033-release-detect-reload.spec.js:35-53,94-125`.

**Ret konkret:** Bevar gamle filer som primær garanti. Hvis kendt opdatering skal ændre en navigation til et dokument-load, skal beslutningen træffes før routerens commit. Beskriv resterende race mellem versionsopslag og deploy ærligt; endnu et versionsopslag kan ikke give atomisk sammenhæng mellem HTML, version og chunks.

### HØJ H4: »Ny release« omfatter også deploys uden ændret spil

En spiller, der blot læser et løb, kan blive genindlæst efter et docs-/backend-/marketing-deploy. `version.json` bruger Git-commit-id, ikke frontendens indholdsversion. Selv hvis H1 rettes og alle JavaScript-filer bliver identiske, ændres commit-id'et. En synlig fane kan derfor få gentagne reloads på forskellige releases; loop-vagten begrænser kun samme målrelease. `P:frontend/vite.config.js:64,94-100`, `P:frontend/src/lib/releaseWatch.js:59-61,106-128,332-336`. E2 viser to sådanne forskellige commits uden frontend-diff.

**Ret konkret:** Brug et særskilt frontend-indholdsid beregnet af det komplette runtime-manifest, inklusive relevante HTML/public-filer, til opdateringsbeslutningen. Behold Git-SHA til fejlsporing. Registrér samtidig et igangværende race-replay som blokerende for automatisk reload, jf. B1. Automatisk reload på hvert nyt Git-SHA er ikke en »rolig« udgivelsesstrategi for hyppige deploys.

### MELLEM M1: Ét forgæves reload kan fryse hele watcherens videre arbejde

En spiller får stadig HTML A efter forsøg på at opdatere til B. Ved næste navigation finder watcher B igen, skriver `pendingRelease=B`, men guard-nøglen er brugt. Alle senere triggere går nu direkte til samme afviste reloadforsøg. **Ingen flere versionsopslag**, selv når C kommer. `P:frontend/src/lib/releaseWatch.js:122-130,233-261`.

**Reproduceret:** Simulerede to dokumentstarter med samme sessionStorage. Første reload lykkedes som kald. Anden start beholdt A. Efter en times injiceret tid og fire nye navigationer var totalen stadig kun to versionskald, ét reload og seks dokumentprober. Tilstanden var `pendingRelease:'B', reloading:false`. Proberne er ikke under watcherens 60-sekunders throttle. Bevis E6.

Beslægtet: Hvis spilleren afslår boardets eksisterende forlad-advarsel, er `state.reloading=true` allerede sat. `location.assign()` giver ikke besked tilbage om brugerens afslag. Watcherens senere `runCheck` returnerer straks. Den afviste navigation er kodebevist, ikke efterprøvet i boardets fulde browserflow. `M:frontend/src/components/racehub/RaceHubBoard.jsx:148-153`, `P:frontend/src/lib/releaseWatch.js:243-255`.

**Ret konkret:** En allerede brugt målrelease må blokere netop dens reload, ikke fremtidige versionsopslag. Fortsæt throttlet polling efter B, så C kan opdages. Koordinér først med sidens ugemte arbejde, og modelér reload-forsøg/afbrudt navigation eksplicit. Tilføj test af A → B-forsøg → stadig A → C samt afvist forlad-dialog.

### MELLEM M2: Et hængende versionskald har ingen egen deadline

En spiller med en forbindelse, der aldrig afslutter svaret eller body-læsningen, kan miste versionsdetektionen resten af dokumentets levetid. Alle kald får samme `inFlight`-promise (et endnu ikke afsluttet asynkront resultat). Kun `finally` frigiver den; her er hverken timeout eller abort. `P:frontend/src/lib/releaseWatch.js:372-395`.

**Reproduceret som kontrolleret netværksmodel:** Uafsluttet fetch, tiden flyttet en time frem, nyt tjek: stadig kun ét fetch. Dette er ikke en måling af en browsers interne netværkstimeout. Bevis E6.

**Ret konkret:** Tilføj en injicerbar deadline med `AbortController`, der dækker både svar og body. Frigiv `inFlight` ved timeout, behold throttlen, og test at næste vindue kan hente igen.

### MELLEM M3: Det samlede recovery-system har ikke fælles loop-garanti

#5139 er rettet til **fail-closed**: uden fungerende sessionStorage afslås automatisk reload. Det betyder ikke, at privat browsing generelt mangler storage, eller at hele appen nu har samme garanti. `P:frontend/src/hooks/useReleaseWatch.js:15-20`, `P:frontend/src/lib/releaseWatch.js:122-130`.

Den eksisterende globale preload-handler fortsætter derimod, hvis storage mangler eller kaster: den bruger kun et flag, der nulstilles ved nyt dokument. `M:frontend/src/lib/chunkErrors.js:164-188`. **Reproduceret i en ren model:** tre dokumentstarter, samme release og manglende storage, ét preload-error pr. start gav tre reloads. `M:frontend/src/lib/chunkErrors.js:221-223`. Bevis E6.

Der er desuden tre forskellige budgets: boot-guard pr. 60 sekunder, fejlrecovery pr. kilderelease, watcher pr. målrelease. Flere reloads i samme reparationsforløb er derfor mulige, selv med storage. Dette er ikke bevis for et uendeligt loop i den normale storage-sti. `M:frontend/public/chunk-selfheal.js:61-62,99-107`, `M:frontend/src/lib/chunkErrors.js:64-76`, `P:frontend/src/lib/releaseWatch.js:106-128`.

Endelig læser `main.jsx` stadig `window.sessionStorage` direkte før `initSentry`. En browser, hvor selve property-opslaget kaster, når derfor ikke PR-hookens sikre accessor. Kodebevist eksisterende boot-risiko, ikke en ny Safari-regression målt her. `M:frontend/src/main.jsx:61-73`.

**Ret konkret:** Gør den globale fejlhandlers storage-valg fail-closed og genbrug en sikker storage-accessor ved boot. Definér ét samlet begrænset recovery-budget på tværs af lag, med separat manuel udvej. Test kombinationen, ikke kun hver nøgle for sig.

### MELLEM M4: Telemetrien beviser hverken vellykket opdatering eller reddede fejl

En spiller kan have gennemført reload-forsøget uden at være nået til den ønskede release. Alligevel læses og slettes markøren ved næste mount og sendes som `app_version_reload`; den aktuelle release sammenlignes ikke med `pending.to`. `P:frontend/src/hooks/useReleaseWatch.js:54-58`, `P:frontend/src/lib/releaseWatch.js:146-165,245`.

Events mistes ved manglende analytics-samtykke eller login. Markøren er allerede slettet og bliver ikke forsøgt igen. Det er den eksisterende loggers kontrakt, ikke et argument for at omgå samtykket i `player_events`. `M:frontend/src/lib/logEvent.js:31-46,159-174`, `M:docs/ANALYTICS_STACK.md:7-30`.

Påstanden »hvert event er en undgået ChunkLoadError« er forkert: eventet kan komme fra et unødvendigt reload, et forgæves reload, eller efter at en chunk-fejl allerede opstod. `P:.claude/learnings/2026-09-11-5033-chunk-release-detect.md:22`; H3/H4.

**Ret konkret:** Registrér driftsudfaldene `attempted`, `arrived`, `deferred`, `failed`, med fra-, mål- og faktisk indlæst release samt trigger. Brug en særskilt, minimal driftskanal efter repoets Sentry-kontrakt eller anonym servermodtagelse. Ingen formularværdier eller fulde query-strenge. Et Sentry-breadcrumb er kun et teknisk spor på et senere sendt event; det giver alene ingen total over vellykkede reloads. Registrér derfor også et selvstændigt udfald. Afstem samlede fejl pr. faktisk aktiveret production-deploy, klientrelease og browsersession. Et fald i fejl kræver selvstændig før/efter-måling.

### LAV L1: Reviewgrundlaget beskriver ikke længere den endelige adfærd

[PR-beskrivelsen](https://github.com/NicolaiDolmer/CyclingZone/pull/5139) siger »Der er INGEN timer der genindlæser af sig selv«. Den endelige kode gør netop dette for synlige faner. Den beskriver også 23 tests; det aktuelle antal er 39. Postmortem gentager den gamle testoptælling og det ubeviste løfte om stabile hashes. `P:frontend/src/lib/releaseWatch.js:332-336`, `P:.claude/learnings/2026-09-11-5033-chunk-release-detect.md:9,20-22`. E7.

**Ret konkret:** Omskriv PR-body og postmortem omkring den faktiske sluttilstand, inklusive interval, resterende navigationsrace, kendte kladdebegrænsninger og målt bevis. Ejeren må ikke godkende adfærd ud fra en tidligere version af beskrivelsen.

## A. Hvad forklarer de fortsatte fejl?

**Ny måling kl. cirka 12:12 CEST:** Sentry returnerede **106 events og 27 berørte bruger-id'er** i det rullende 24-timersvindue, fortsat uløst. Det ligger tæt på bestillingens 105/27 fra et tidligere tidspunkt. Jeg bruger ikke lifetime-tallet 1.392 som et 24-timersmål. Bevis E3; forespørgslens implementering: `M:scripts/sentry-issues.mjs:39-46,87-95`.

Fire aktuelle eventdetaljer viste alle konkrete 404'er i deres fetch-spor:

| Tid UTC | Klientrelease | Chunk |
|---|---|---|
| 10:12:34 | `7e210d5e…` | `AcademyPage-Bl7-q3se.js` |
| 10:12:06 | `52f1fded…` | `BoardroomRoute-Cah5duM9.js` |
| 10:11:10 | `ba8760de…` | `NotificationsPage-DZgxA9Ct.js` |
| 10:10:11 | `ba8760de…` | `FinancePage-C7vBOdMP.js` |

Den første kommer fra samme nylige build B, der er målt ovenfor. Det er altså ikke kun gamle faner fra før #5021/#5097. Sporet opstår i cache-rensningens fetch og beviser 404 på filen på hændelsestidspunktet; det er ikke en fuld netværksoptagelse af det oprindelige importforsøg. `M:frontend/src/lib/lazyWithRetry.js:82-89,125-137`. Bevis E3.

Mekanismen er: en indlæst side beholder A's modulreferencer; et nyt deploy flytter domænet til B; en endnu ikke hentet A-chunk er væk på B. Retry af samme import gør ikke den manglende fil tilgængelig. Cache-rensning kan overskrive en lokalt cachet fejl, men kan ikke genskabe en fil, der reelt ikke findes på det valgte deploy. `M:frontend/src/lib/lazyWithRetry.js:82-89,112-137`. Vite dokumenterer både denne versionsfejl og browserens begrænsning ved gentaget import. [Vite troubleshooting](https://vite.dev/guide/troubleshooting).

**#5097 reparerede fejloplysningen og recoveryens mål, ikke asset-tilgængeligheden.** Fjernelsen af `preventDefault` lader Vite kaste den oprindelige fejl. Forløbet starter stadig med en fejlet load. Postmortemens overskrift om »rod-årsagen« må derfor ikke læses som bevis for, at den netværksmæssige årsag var væk. `M:.claude/learnings/2026-09-10-chunk-preventdefault.md:37-46,57-62`, `M:frontend/src/lib/chunkErrors.js:221-223`; E2/E3.

**Cachet HTML og preloads:** De to målte `app.html`-svar havde `public, max-age=0, must-revalidate`. Det afkræfter ikke gamle allerede åbne dokumenter, men der er ingen ny måling her, som udpeger langlivet HTTP-cachet HTML som hovedårsag. De 17 uændrede HTML-assets afkræfter også, at alle preload-links nødvendigvis roterer. Det afgørende bevis ligger i entry-/route-referencerne. `M:frontend/src/lib/release.js:26-38`, E2. `frontend/app.html` findes ikke som kildefil; den genereres som `dist/app.html` ved kopiering før prerender. `M:frontend/scripts/prerender.mjs:26,48-50`.

De fire events kan ikke fordele alle 106 hændelser mellem versionsbrud, cacheforgiftning, netværksudfald og andre årsager. Jeg påstår heller ikke, at »halvdelen af aktive spillere« er eftervist: Sentry-brugere og et aktivitetstal fra et andet værktøj er ikke automatisk samme population. Aktivitetens målekilde er fastlagt i `M:docs/ANALYTICS_STACK.md:7-30,34-39`.

## B. Øvrige risikoafklaringer

### To faner, storage, gamle dokumenter og loops

- **Samme målrelease i samme fane:** vedvarende guard blokerer gentagelse, også hvis HTML forbliver gammel. Efterprøvet i E6 og eksisterende e2e. Det hindrer et stramt loop, men giver fastlåsningen i M1. `P:frontend/src/lib/releaseWatch.js:122-130,252-261`.
- **To uafhængige faner:** hver har sit eget sessionStorage-budget; de kan begge reloade én gang til B. Dette er ikke en fælles browserlås og heller ikke i sig selv en fejl. Åbning via en opener kan starte med en kopi af storage; ingen tværfanelås er implementeret. Ikke browsertestet her. `P:frontend/src/hooks/useReleaseWatch.js:15-20`, `P:frontend/src/lib/releaseWatch.js:122-130`; [MDN Web Storage](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API/Using_the_Web_Storage_API).
- **Blokeret storage:** PR-laget afslår korrekt; getItem-/setItem-undtagelser er dækket af beståede tests. Privat browsing er ikke synonymt med blokeret storage. Hele appens afvigelser står i M3. `P:frontend/src/lib/releaseWatch.test.js:279-297`.
- **Mange nye releases:** vagten er per målrelease, så B, C, D kan hver udløse et reload. Der findes ingen samlet tidsgrænse på tværs af genindlæste dokumenter. `P:frontend/src/lib/releaseWatch.js:106-128`; H4.
- **Faner fra før #5139:** har ikke den nye hook, som først installeres fra det nye App-build. De kan ikke opdateres bagud ved alene at udgive `version.json`. `P:frontend/src/App.jsx:16,190`, `P:frontend/src/hooks/useReleaseWatch.js:60-88`.

### Fokus og Safari/iOS

`visibilitychange`, `focus`, `pageshow`, `blur` og interval er alle tilkoblet. Efter mere end fem minutters baggrund nulstiller første returbegivenhed uret, så normal `visibilitychange` efterfulgt af `focus` kun udløser ét tjek. Den del, skjult start og interval-cleanup er unit-testet og bestod. Versionsopslag deler throttle og et igangværende kald. **Dokumentprober ved en allerede pending release gør ikke**, jf. M1. `P:frontend/src/lib/releaseWatch.js:300-349,387-395`, `P:frontend/src/lib/releaseWatch.test.js:407-496`.

**bfcache** er browserens gemte, levende side ved Tilbage/Frem. Koden læser ikke `pageshow.persisted`, og lytter ikke på `pagehide` til sit baggrundsur. Et isoleret `pageshow({persisted:true})` efter en times injiceret tid gav intet tjek, hvis der ikke tidligere var registreret hidden/blur. Den normale tested sti har netop en forudgående `visibilitychange`. Det er en dækningsbegrænsning, ikke bevis for, at iOS altid leverer den isolerede sekvens. `P:frontend/src/lib/releaseWatch.js:316-342`, `P:frontend/src/lib/releaseWatch.test.js:418-427`; E6.

WebKit-testene her er kørt på Windows og er **ikke** en fysisk iPhone-test. Native iOS-bfcache, baggrundsfrysning og memory eviction er ikke verificeret. Et `beforeunload`-værn alene er heller ikke en universel mobilgaranti; MDN beskriver begrænsningerne. [MDN beforeunload](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event). Planlæg en rigtig iOS-returtest, og brug kladdetilstand som reload-værn frem for at afhænge af browserdialogen.

### En fane på et igangværende løb

Watcher har ingen undtagelse for løbsstatus eller afspilning. Intervallet kan genindlæse siden, når der ikke er et fokuseret input. URL'ens `?stage=` og `?tab=` kan bevares; lokalt teamfilter og afspilningsposition kan ikke. Afspilningen starter i lokal state (`elapsed=0`, `scrubKm=0`). `P:frontend/src/lib/releaseWatch.js:96-103,178-185,332-336`, `M:frontend/src/pages/RaceDetailPage.jsx:299,306-340,1581-1582`, `M:frontend/src/components/race/FinalKilometrePlayback.jsx:68`, `M:frontend/src/components/race/TimelineFilmPlayer.jsx:55-56`.

Løbssiden henter data ved mount og har et 30-sekunders ur-tick. Det tick opdaterer `nowMs`, ikke resultaterne. Jeg fandt ikke en resultatsubscription eller periodisk `loadAll` i den læste side og bekræfter derfor ikke præmissen om, at netop denne side løbende streamer resultater. Det ændrer ikke reload-risikoen. `M:frontend/src/pages/RaceDetailPage.jsx:352,524-555,589-593`.

Watcherens reload sender ingen kommando til løbsmotoren. Denne audit viser tab af visnings-/kladdetilstand, ikke at løbets serverresultat nulstilles eller selve afviklingen stopper. `P:frontend/src/lib/releaseWatch.js:178-185,235-246`.

### Vercel-routing og version.json

**Verificeret på det immutable PR-deploy:** `/version.json` gav 200, `application/json; charset=utf-8`, 55 bytes, korrekt PR-SHA og `Cache-Control: public, max-age=0, must-revalidate`. Første svar: `Age:0`, `X-Vercel-Cache:MISS`. Senere svar: `Age:705`, `HIT`; med request-header `Cache-Control:no-cache`: `Age:706`, `HIT`. Filen bliver altså faktisk leveret som JSON, ikke SPA-HTML. `P:frontend/vite.config.js:87-100`, `P:frontend/vercel.json:95-103`; E8.

Det sidste resultat er **ikke bevis for revalidering af CDN-cachen ved hvert request**. Browserens cachepolitik og CDN'ens lagring af et statisk deployment er forskellige observationer. `X-Vercel-Cache` beskriver edge-hittet. [Vercel response headers](https://vercel.com/docs/headers/response-headers), [Vercel CDN cache](https://vercel.com/docs/caching/cdn-cache).

Et fast deployment-id skal fortsat svare med sin egen release. Den nødvendige resterende test er et **bevægeligt alias**, der skifter fra A til B, mens den samme browser bliver åben: skifter version, HTML og asset-opløsning samlet og rettidigt? Jeg har ikke ændret et alias eller lavet nye deploys. Den globale overgang og alle CDN-regioner er derfor ikke verificeret. Statisk headersyntaks eller ét `HIT`/`MISS` må ikke bruges som stedfortræder for testen. `P:frontend/vercel.rewrites.test.js:102-127` tester konfiguration, ikke en faktisk aliasovergang.

## Anbefalet langsigtet plan, i prioriteret rækkefølge

1. **Stop uventede reloads og få recovery til at virke som annonceret.** Ret B1, H2 og M1-M3, og test dem i rigtige browsere. **Gevinst:** beskytter spillerens arbejde og undgår en død nødudgang. **Pris:** fælles reload-koordination samt integration med de nævnte spilflader. **Alternativ:** behold versionsdetektion som en synlig opdateringsbesked med et eksplicit klik, indtil sikkert reload er dækket. Grundlag: B1/H2/M1-M3 og deres filhenvisninger.
2. **Gør build-identitet og måling korrekte.** Luk den målte asset-rotation og brug indholds-id til opdateringsbehov, Git-SHA til sporbarhed. **Gevinst:** færre unødvendige versionsskift og en testbar kontrakt. **Pris:** to realistiske builds og fejlsøgning af den aktive Sentry-/bundlersti. **Alternativ:** uændret build plus længere asset-retention, som reducerer konsekvensen, men ikke spildet. Grundlag: H1/H4, `M:.github/workflows/ci.yml:101-124`.
3. **Bevar gamle assets som den primære driftssikring.** Anbefalingen under ejerens nuværende Vercel-fravalg er et publiceringsflow, hvor gamle hash-URL'er fortsat kan findes på samme origin, eller et særskilt stabilt asset-origin med styret retention. **Gevinst:** en aktiv session kan hente sin oprindelige kode uden tvungen genindlæsning. **Pris:** lagring, manifest og oprydning; alle statiske/dynamiske imports, CSS og public-filer skal have konsekvent adresse. **Alternativ:** korrekt Skew Protection, punkt 4. En release-mappe i `chunkFileNames` alene bevarer ingen filer på det næste Vercel-deploy. Oprydning skal følge målt alder på aktive klientversioner og en aftalt understøttelsesperiode, ikke et vilkårligt antal deploys. E2 og `M:frontend/vercel.json:21-22,60-65`; [Vites anbefaling om at bevare gamle chunks](https://vite.dev/guide/troubleshooting).
4. **Genåbn kun Skew Protection som et selvstændigt, bevisdrevet ejer-valg.** Vercel dokumenterer tilpasset integration for andre frameworks med `dpl`/header/cookie; Vite-SPA'en får ikke automatisk en fuldstændig adapter. **Gevinst:** platformen kan levere den gamle udgivelses filer. **Pris:** korrekt binding af hele modulgrafen, dokumentnavigation, udløb og rollback; Railway-backenden versionsbindes ikke af frontendens Vercel-indstilling. **Alternativ:** asset-retention fra punkt 3. [Vercel Skew Protection](https://vercel.com/docs/skew-protection), `M:docs/DEPLOYMENT.md:7-11,28-39`.

   #4745 beviser, at *delvis URL-omskrivning* gav to modulidentiteter; den beviser ikke, at enhver konsistent binding er umulig. #4758's postmortem måler derimod en konkret forskel på browsernavigation og script-requests. De aktuelle Vercel-docs siger, at `__vdpl` også kan pinne dokumenter. Det er en **uafklaret modstrid mellem dokumentation og lokal måling**, ikke tilladelse til at genaktivere den gamle kode. Send Vercel den præcise A/B-reproduktion med `Sec-Fetch-*`, og kræv browserbevis før et nyt valg. `M:.claude/learnings/2026-09-04-skew-protection-dpl-query-brak-hele-appen.md:4-11,18-22`, `M:.claude/learnings/2026-09-04-vercel-vdpl-cookie-pinner-assets-men-ikke-dokumentet.md:11-20,27-34`.
5. **Vælg ikke service worker alene for at løse dette forløb.** En service worker er kode, der kan opsnappe netværkskald og forhåndsgemme filer lokalt. **Gevinst:** allerede gemte chunks kan overleve et deploy og offlineperioder. **Pris:** egen installation, versionslivscyklus, lagerudsmidning, gammel/ny worker og rollback; den hjælper ikke før første installation. Tvungen aktivering kan selv blande ny worker med gamle sider. **Alternativ:** serverstyret retention, som også hjælper nye og ikke-cachede requests. Brug kun service worker, hvis offlineproduktet begrunder den ekstra kompleksitet. [Service worker lifecycle](https://web.dev/articles/service-worker-lifecycle), [Service workers](https://web.dev/learn/pwa/service-workers); den nuværende bootafhængighed ses på `M:frontend/index.html:42,121` og H2.

Stabile route-chunks er fortsat ønskelige. De er en reduktion af unødvendige ændringer, ikke en garanti om uændrede navne, når en importeret afhængighed faktisk ændres. At bevare gamle filer løser konsekvensen også ved legitime frontendændringer. `M:frontend/src/lib/release.js:3-13`, E2. Versionsdetektion er derefter en opdateringspolitik, ikke en erstatning for asset-tilgængelighed.

## C. Hvorfor forløbet blev så langt

- **Et synligt symptom blev gentagne gange navngivet som hele rodårsagen.** #5097 reparerer tabet af den oprindelige fejl, men importen skal allerede være fejlet, før `preventDefault` kan ændre den. #5139 kalder igen alle tidligere lag færdige. Der mangler én samlet årsagskæde: build → HTML → modulreference → HTTP/cache → recovery → faktisk ankomst. `M:.claude/learnings/2026-09-10-chunk-preventdefault.md:37-53`, `P:.claude/learnings/2026-09-11-5033-chunk-release-detect.md:7-12`.
- **Tests har flere gange bevist tilstedeværelsen af kode frem for dens virkning.** #4745 tjekkede query-strengen, ikke fungerende React. Boot-testen leverer et allerede færdigt dokument og skjuler den tomme boot-liste. #5139 tæller reloads med uændrede assets. `M:.claude/learnings/2026-09-04-skew-protection-dpl-query-brak-hele-appen.md:18-22`, `M:frontend/src/lib/chunkSelfHeal.test.js:81-90`, `P:frontend/tests/e2e/5033-release-detect-reload.spec.js:35-53`.
- **Det testede miljø har ikke matchet produktion.** Først manglede skew-/Sentry-betingelser; den nuværende determinismegate mangler stadig et reelt to-build-bevis for den aktive pluginsti. Mange grønne tests kan ikke kompensere for, at netop den risikable gren er slået fra. `M:frontend/vite.config.js:9-13,114-146`, `M:.github/workflows/ci.yml:101-124`; [PR #5021](https://github.com/NicolaiDolmer/CyclingZone/pull/5021) dokumenterer selv test uden token.
- **Læringen »to udgivelser i en rigtig browser« blev ikke et obligatorisk leverancebevis.** Den står eksplicit efter cookie-havariet, men #5139's test opdaterer kun versionsstrenge. `M:.claude/learnings/2026-09-04-vercel-vdpl-cookie-pinner-assets-men-ikke-dokumentet.md:27-31`, `P:frontend/tests/e2e/5033-release-detect-reload.spec.js:35-53`.
- **Recovery blev udbygget stykkevis, så beskyttelserne er forskellige.** Historikken dokumenterer allerede en guard på én reload-sti og ingen på en anden. Nu har watcher sikker storage, mens den globale preload-handler fortsat er fail-open. `M:.claude/learnings/2026-08-10-chunk-recovery-reload-hijacks-navigation.md:41-49,74-84`, `M:frontend/src/lib/chunkErrors.js:181-188`, `P:frontend/src/lib/releaseWatch.js:122-130`.
- **Målingen er ikke fraværende, men den er utilstrækkelig som udgivelsesdom.** #4595 indeholder før/efter-tal og senere modbeviser. Det er forkert at sige, at ingen målte. Problemet er, at modbeviserne ikke blev omsat til en stopregel, før næste »rodrettelse«. Den automatiske gate bruger et rullende døgn, er advisory over 25 og stopper først over 1.000; et grønt job er dermed ikke bevis for spillersundhed. `M:.github/workflows/deploy-verify.yml:283-341`, [#4595](https://github.com/NicolaiDolmer/CyclingZone/issues/4595).
- **»Kun teststøj« har tidligere skjult ægte brugerfejl.** Juli/august-postmortems viser navigationer kapret af recovery; WebKit var tidligere fjernet fra CI på en forkert forklaring. Den fejlklasse skal undersøges, ikke afskrives på browsernavnet. `M:.claude/learnings/2026-07-03-chunk-reload-hijacks-navigation-teardown-abort.md:14-23`, `M:.claude/learnings/2026-08-10-chunk-recovery-reload-hijacks-navigation.md:96-107`.

### Tre krav før næste chunk-relaterede merge

1. **Et manifestbevis fra produktionslignende builds.** To builds af samme frontend med forskellige release-id'er, aktive transformationer og samme øvrige inputs. Krav: identiske runtime-assets; HTML/release-metadata må variere som aftalt. Gem kommando, miljøets navne/tilstedeværelse uden secrets, manifest og differens i CI-artifact. En bevidst genindført kendt fejl skal gøre testen rød. Erstatter ikke måling af den faktiske Vercel-udgivelse. Grundlag: H1, `M:.github/workflows/ci.yml:101-124`.
2. **En obligatorisk A → B-browserprøve på samme alias.** Hold en A-fane åben, udgiv B, og åbn en endnu ikke hentet route. Gentag med entry-404, stale HTML, ugemt taktik, buddialog, afvist reload, blokeret storage og tilbage/frem. Krav: ingen tabte kladder, ingen reload-loop, ingen kapret navigation og verificeret ankomst til korrekt version. Chromium og WebKit samt fysisk iOS ved livscyklusændringer. Grundlag: B1/H2/H3, `M:.claude/learnings/2026-09-04-vercel-vdpl-cookie-pinner-assets-men-ikke-dokumentet.md:27-31`.
3. **En på forhånd aftalt effektmåling og stopregel.** Tag baseline fra præcise tidsvinduer, tæll faktisk aktiverede production-deploys, og rapportér fejl/deploy plus fejl pr. aktiv klientsession, alder på klientrelease og vellykkede/mislykkede recovery-forløb. Skeln simulation og prod. Hold opfølgning åben mindst det aftalte 24-timersvindue og på tværs af reelle deployovergange. 25/døgn og 1.000/døgn er eksisterende gateværdier, ikke her genbekræftede ejer-godkendte kvalitetsmål. Vælg og dokumentér målet før merge. Grundlag: M4, `M:.github/workflows/deploy-verify.yml:300-341`, `M:docs/ANALYTICS_STACK.md:7-30`.

## Manglende tests

Listen er vurderet mod den læste aktuelle suite, ikke mod PR-bodyens testantal. `P:frontend/src/lib/releaseWatch.test.js:76-598`, `P:frontend/tests/e2e/5033-release-detect-reload.spec.js:94-150`.

- Rigtige assets skifter A → B; første ikke-cachede route efter deploy; versionsopslag forsinkes eller throttles. H3.
- Udfyldt felt mister fokus; lokale udtagelses-/taktik-/træningskladder; åbent bud og igangværende skrivning. B1. Denne audit har tilføjet bevis i hukommelsen, ingen regressionstest er committet.
- Reload mens en racefilm afspilles, med kontrol af position og åben modal. `M:frontend/src/components/race/TimelineFilmPlayer.jsx:55-56`.
- A → forsøg på B → HTML stadig A → derefter C; fortsat polling efter brugt guard. M1.
- Afvist `beforeunload`-dialog og efterfølgende Gem/opdatering. M1.
- Hængende response/body, timeout, genoptaget kontrol; fokus/visibility ændres mens reload-proben afventer. M2 og `P:frontend/src/lib/releaseWatch.js:240-242`.
- Samlet budget med boot-guard, global handler, boundary og watcher; storage-property, getItem og setItem fejler hver for sig. M3.
- To rigtige faner, inklusive opener-kopi, flere successive releases og browser-back/forward efter reload. `P:frontend/src/lib/releaseWatch.js:106-130`.
- Native iOS-retur og `pageshow.persisted` uden det hidden-forløb, unit-testen antager. `P:frontend/src/lib/releaseWatch.test.js:418-427`.
- Faktisk HTML-parserrækkefølge og manglende entry, både hurtig fejl og allerede cachet 404. H2.
- Driftsevent ved faktisk forkert ankomstrelease, manglende login/samtykke og fejlet levering. M4.

## Manglende målinger

- Komplet asset-manifest og byte-diff fra to produktionslignende builds med aktiv Sentry-transformation; H1's 76 referencer er et konkret modbevis, ikke den fulde isolering af byggefejlen.
- `/version.json`, HTML og gamle chunks over et faktisk alias-skift fra A til B med samme browsercache og flere edge-regioner. E8 er et enkelt fast deployment.
- Fordeling af alle døgnets fejl efter gammel klientrelease, HTTP-status, cache-hit, netværksfejl og recovery-udfald. E3 undersøger fire eventdetaljer.
- Faktisk andel tabt spillerarbejde og afbrudte skrivninger. E4 måler en kontrolleret formular, ikke spillerpopulationen.
- Verificeret reload-succes som selvstændig driftsmetrik uden `player_events`-samtykkebias; M4.
- Ensartet før/efter-måling pr. faktisk production-aktivering, med samme definition af aktive klienter. Et antal GitHub-jobs er ikke automatisk antallet af Vercel-aktiveringer. `M:.github/workflows/deploy-verify.yml:295-318`.
- Aftalt kvalitetsmål og understøttet alder for en åben fane. Det bestemmer asset-retention og hvornår manuel opdatering er nødvendig. `M:docs/DEPLOYMENT.md:65-95` beskriver den tidligere pin-politik, ikke et aktuelt målt mål for denne nye løsning.

## Bevisregister: faktisk udførte kontroller

Alle HTTP-prober var mod deployede, statiske Vercel-sider, aldrig en lokal Vite-devserver. Midlertidige browsermodeller ændrede kun den isolerede browsers svar. Eksterne API-/telemetrikald var blokeret i browsertestene. Ingen testtekst blev sendt.

| ID | Kommando/metode | Resultat og grænse |
|---|---|---|
| E1 | `git rev-parse --show-toplevel`, `git status -sb`, `git worktree list`, `gh pr view 5139 --json headRefOid,state`, målrettet `git --no-pager diff M P -- <filer>` og M mod senere HEAD | Repo-root `C:/Dev/CyclingZone`; main havde allerede ændret `.claude/launch.json`. PR-koden var clean og på `6454579b…`; relevante eksisterende produktfiler identiske. Ingen branch blev skiftet. |
| E2 | Vercel `list_deployments`/`get_deployment`; `git --no-pager diff --name-only 230d9da4… 7e210d5e…`; Python-GET af de to deploys' `/app.html`, deres entry-JS og gammel auktionschunk | Production/READY bekræftet. Ingen frontend-diff. 195 entry-referencer i hver, 76 udskiftet. Gammel auktionschunk 200 på A, 404 på B og production-alias; 404 annoncerer et års immutable-cache. Ikke et fuldt asset-manifest. |
| E3 | `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=24h --query=is:unresolved --limit=25 --json`; GET `/api/0/organizations/cycling-zone/issues/144261174/events/?full=true&per_page=20&statsPeriod=24h`; derefter fire event-detail-GETs | 106/27 i 24 timer omkring 12:12 CEST. Eventlisten returnerede 10 hændelser, selv om 20 var anmodet; ingen påstand om fuld pagination. Fire detaljer havde asset-fetch 404. Første forsøg med `--query=CYCLINGZONE-56` returnerede tomt og blev ikke tolket som nul fejl. |
| E4 | Installeret Playwright API, `chromium.launch({headless:true})` og `webkit.launch({headless:true})`, frisk context, PR-preview `/login`; `input.fill('audit@example.invalid')`, `input.blur()`, simuleret `/version.json`, kald af den opsnappede eksisterende 300000-ms intervalcallback | Begge: tekst før udfyldt, tekst efter tom; dokumentloads 1 → 2; målrelease-guard `1`. Ingen fem minutters vægurtid blev afventet. Dette er en kontrolleret versionssimulation på rigtige PR-assets, ikke to faktiske deploys. |
| E5 | Samme browsere; passiv optælling ved boot-vagtens `querySelectorAll`; separat route-interception af `/assets/index-*.js` til 404 på `/dashboard` | Begge: boot-snapshot 0 URL'er under `loading`. Ved entry-404: 0 børn i root, guard installeret, heal-nøgle null og ingen selvhelingslogs/fallback. Parserrækkefølge reproduceret i rigtig browser. |
| E6 | `node --input-type=module -` med imports af PR's `createReleaseWatcher/createReleaseReloader/installReleaseWatchHandlers` og main's `installChunkReloadHandlers`; Map-storage, kontrollerede promises, eksplicit `now` | Interval med BUTTON gav reload. Brugt B-guard efter gammel HTML frøs versionsopslag, men gentog prober. Uden storage afslog PR-laget. Global gammel handler gav 3 reloads på 3 simulerede dokumentstarter. Hængende fetch: 1 kald efter injiceret time. Isoleret persisted-pageshow: 0 checks. Rene modeller, ikke browserbevis for alle platforme. |
| E7 | `node --test C:/Dev/CyclingZone-worktrees/feat-5033-release-detect-reload/frontend/src/lib/releaseWatch.test.js C:/Dev/CyclingZone-worktrees/feat-5033-release-detect-reload/frontend/vercel.rewrites.test.js` | **46 bestået, 0 fejl:** 39 release-tests og 7 routing/header-tests. Ikke fuld frontend-/backend-/e2e-suite. |
| E8 | `curl.exe -sS -D - https://cycling-zone-6v7s99y40-nicolai-dolmers-projects.vercel.app/version.json`; gentaget normalt og med `-H 'Cache-Control: no-cache'` | JSON og korrekt SHA/header. Først Age 0/MISS, senere Age 705/HIT og 706/HIT. Ingen dokumentation af alias-invalidering eller alle edge-regioner. |
| E9 | `gh issue view 4595 --comments`; `gh issue view 5033 --json body,comments`; `gh issue view 2423`; `gh issue view 5014`; `gh pr diff 5139`, PR-body og kommentarer; de historiske PR-bodies og navngivne postmortems | Historik, design og to rettelsesrunder læst. Store samlede terminaludskrifter blev trunkeret; centrale PR-bodies blev derefter læst særskilt, og slutkoden med linjenumre var primært bevis. Ingen ny CodeRabbit-review er bestilt; dette er min uafhængige audit. |
| E10 | Officielle Vite-/Vercel-docs og browserdokumentation, links ved påstandene | Sammenholdt med repo og målinger. Den konkrete Vercel-cookie-modstrid er ikke løst ved at læse dokumentation. |
| E11 | `node --test frontend/src/lib/lazyWithRetry.test.js frontend/src/lib/chunkErrors.test.js frontend/src/lib/chunkSelfHeal.test.js frontend/src/lib/vitePreloadContract.4595.test.js` | **57 bestået, 0 fejl.** De eksisterende recovery-tests er altså grønne samtidig med det reproducerede boot-hul i E5. |
| E12 | Kontrol af alle rapportens kildefiler/linjenumre, `git --no-pager diff --check`, `git status --short`, `pwsh -NoProfile -File scripts/check-agent-token-hygiene.ps1` | Kun rapporten tilføjet af auditten; den allerede ændrede launch.json urørt. Token-hygiejne: 0 fail, 10 warn. Rapporten indeholder ingen em-dash. |

Deploy-URL'er til at gentage E2:

- A: [cycling-zone-85xaykohy](https://cycling-zone-85xaykohy-nicolai-dolmers-projects.vercel.app/app.html).
- B: [cycling-zone-917yxz7cb](https://cycling-zone-917yxz7cb-nicolai-dolmers-projects.vercel.app/app.html).
- PR: [6454579b-preview](https://cycling-zone-6v7s99y40-nicolai-dolmers-projects.vercel.app/login).

Sentry-hændelser undersøgt i E3: `2200afcb9466403f948db12ec1c0ae17`, `3cd4cf35b360447f804d1068dbbe9351`, `c0dc283454eb469b9c6f25764d8c27df`, `b37950d24ff44963ab57f95d0ab928a8`, under [CYCLINGZONE-56](https://cycling-zone.sentry.io/issues/144261174/). Ingen spilleridentiteter er gengivet.

**Ikke verificeret:** faktisk to-deploy-browserovergang på samme alias, fysisk Safari/iOS, aktive spilleres fulde auth-/bud-/taktikflows, fuld test-suite, produktionseffekt af den endnu umergede PR, Vercels komplette build-env eller den første årsag til build-byteforskellen. Ingen af disse er rapporteret grønne. Relevante kodegrænser: `P:frontend/tests/e2e/5033-release-detect-reload.spec.js:35-53`, `M:frontend/vite.config.js:9-13,114-146`.
