# Postmortem · 2026-09-01 · `vite preview` som Playwright webServer stallede tilfældigt sent i CI-smoke

## Hvad skete der?
På `feat/2960-react19-rr8` fejlede 1-2 tilfældige tests i 4 CI-koersler i traek, altid
~20-25 min inde i den 25-minutters fulde Playwright-suite paa windows-latest, altid en
FORSKELLIG spec. Traceanalyse af CI-run 33498888228 viste mobile-webkit navigerede til
`/login` og haengte fast paa app-spinneren: `load` fyrede aldrig, og netvaerkstracen
viste `assets/webVitalsIntegration-*.js` med status -1 (afsluttede aldrig), mens 31/32
andre requests var 200. Lokalt: 607/607 groent paa 8 kerner paa 23 min.

## Root cause
Ikke endeligt bekraeftet ved direkte lokal reproduktion (se "Forsoegt reproduktion"
nedenfor) — men staerk indicie-kaede peger paa `vite preview` som Playwright's
`webServer` under vedvarende belastning paa en CPU-svag (2-kernet) Windows-runner:
`vite preview` er en tungere, langsommere statisk-fil-server end noedvendigt (se
maaling nedenfor), hvilket giver mindre margin foer en enkelt request staller naar
CPU'en samtidig deles med Playwright's browserprocesser i 20+ minutter. Moenstret
(altid samme fase i koerslen, altid forskellig spec, aldrig lokalt paa kraftig
hardware) er konsistent med et ressource-/timing-baseret staell i selve
preview-server-stacken, ikke i applikationskoden. Chunk-graf-diff mod `main` udelukkede
den oprindelige hypotese om ny modulepreload af analytics-chunks: `webVitalsIntegration`
og `clarityIntegration` er `lazy()` paa BEGGE grene og indgaar i INGEN af de to grenes
modulepreload-lister (16 vs. 14 links, ingen af dem analytics).

`vite preview` + Playwright webServer under belastning er i oevrigt et kendt
community-moenster: vitejs/vite#12883 (flaky tests), microsoft/playwright#21227
(webServer-config med vite dev-server); den dokumenterede workaround i flere issues er
at skifte til en dedikeret static-file-server.

## Forsoegt reproduktion
Skrev et bombardement-script (`stress-preview.mjs`, se PR) der fyrer 50-samtidige
asset-requests i bolger mod en koerende server i 6 min. Resultat paa 8-kernet lokal
hardware:
- `vite preview`: ~74.000 requests / 285s, 0 slow (>5s), 0 never-completed.
- `sirv` (samme dist, samme port-moenster): ~305.000 requests / 246s, 0 slow, 0
  never-completed — **~4x saa mange requests i samme tidsrum**.

Ingen af de to staellede lokalt inden for 6 min — CI-bugget er sandsynligvis
CPU-kontentions-afhaengigt (25 min, delt med browserprocesser, 2 kerner) og ikke
reproducerbart paa en ledig 8-kernet maskine alene med HTTP-last. Men gennemsnits-
throughput-forskellen (4x) bekraefter at `vite preview` er markant tungere pr.
request end en minimal static-server, hvilket reducerer margen under CI-belastning.

## Fix
`frontend/playwright.config.js`: webServer-kommandoen skiftet fra
`vite preview -- --host ... --strictPort` til `sirv dist --single --host ... --quiet`
(nyt npm-script `preview:e2e` i `frontend/package.json`, ny devDependency `sirv-cli`).
`--single` giver samme SPA-fallback til `index.html` som `vite preview` allerede gav
(bekraeftet: `dist/` har kun ÉT `index.html` — landing-siden; `main.jsx`'s
`hydratingLanding`-gate haandterer allerede "forkert" landing-markup paa app-ruter,
se #418/#422 — ingen aendring i adfaerd). Kaldes via `npm run` (ikke `npx`) for at
bevare det samme "ÉT draebeligt barn i process-traeet"-moenster som allerede virker i
dag (#1342) — verificeret med `Get-CimInstance Win32_Process`, at `npm run preview:e2e`
har PRAECIS samme to-proces-form (npm-cli.js -> node_modules/.bin-script) som det
eksisterende, velfungerende `npm run preview` (vite).

## Bivirkning fanget under verifikation
`sirv` implementerer ingen middleware-hook (som vites `configurePreviewServer`),
saa `worktreeIdPlugin` i `vite.config.js` (der servede `WORKTREE_ID_PATH` dynamisk)
stoppede med at virke for e2e. False-green-guarden i `tests/e2e/global-setup.js`
tolkede derfor sirv SELV som "en ukendt/stale server uden worktree-id" og fejlede
haardt ved foerste lokale koersel — fanget FOER push. Fix: nyt script
`scripts/write-worktree-id.mjs` skriver `WORKTREE_ID_PATH` som en almindelig
statisk fil i `dist/` (indhold: `formatWorktreeId(FRONTEND_ROOT)`, samme format som
vite-pluginet brugte), koert fra `preview:e2e`-scriptet FOER sirv starter. Filen
ligger i det gitignorede `dist/`, saa den paavirker ikke "clean working tree"-tjekket
i CI.

## Forhindret-fremover
Faerre bevaegelige dele i CI's kritiske sti: `sirv` er et minimalt, enkelt-formaals
static-file-bibliotek uden vites egen dev/preview-serverstack (transform-pipeline,
HMR-hooks osv.), saa hele klassen af "vite preview under load"-bugs er fjernet fra
webServer'en. Lokalt bruges samme kommando (`npm run build && npm run preview:e2e`),
saa CI og lokal miljø ikke driver fra hinanden igen (jf. #3429's laering om at
CI/lokal-divergens selv er en fejlkilde).

## Læring
Naar en flaky-fejl kun viser sig paa CI's svage hardware og aldrig lokalt, er en
lokal stress-test ikke altid nok til at REPRODUCERE den — men den kan stadig give
maalbar evidens (her: 4x throughput-forskel) der understoetter en infrastruktur-fix
uden at kraeve et 100% bekraeftet root-cause-bevis. Naar den mistaenkte komponent er
udskiftelig med en smallere, bedre afproevet erstatning der leverer identisk
kontrakt (samme SPA-fallback, samme port-semantik, samme proces-traeform), er
udskiftning en legitim fix selvom den praecise fejlmekanisme i den gamle komponent
forbliver ubevist.
