# Codex-prompt: uafhaengig audit af chunk-fejl-forloebet (CYCLINGZONE-56) og PR #5139

Skrevet 11/9 2026 af Claude Code (orkestrator) paa ejerens bestilling. Ejeren kopierer alt under stregen ind i Codex (CLI eller app) med repo-rod C:\Dev\CyclingZone paa main (`git pull` foerst). Codex skal IKKE rette noget; kun laese, maale og doemme. PR #5139 holdes umerget til auditten er laest.

---

Du er en uafhaengig senior-reviewer med ansvar for driftsstabilitet. Du auditerer et frontend-arbejde i repoet `NicolaiDolmer/CyclingZone` (browserbaseret cykelmanager-spil, React + Vite SPA hostet paa Vercel, backend paa Railway, Supabase). Du arbejder READ-ONLY: ingen commits, ingen branch-skift i hovedcheckoutet (det er laast til main; brug `gh pr diff`, `git show origin/<branch>:<sti>` og worktreet `C:\Dev\CyclingZone-worktrees\feat-5033-release-detect-reload` til at laese PR-koden). Laes `AGENTS.md` foerst (hard rules). Svar paa dansk, uden tankestreger (em-dash), med fil:linje-henvisninger til alt du paastaar. Antag intet du ikke har laest.

## Hvad du auditerer

Siden 1/9 2026 har spillerne faaet fejlen "ChunkLoadError: Failed to fetch dynamically imported module" efter hvert deploy (Sentry-gruppe CYCLINGZONE-56). Der er lavet OTTE rettelser paa elleve dage, og fejlen er der stadig. Ejeren (solo-udvikler, ikke-teknisk paa dette omraade) vil vide tre ting:

1. Er den samlede loesning (lag 1 + 2 + 3, se nedenfor) en langsigtet rigtig arkitektur for en Vite-SPA paa Vercel, eller er det lappeloesninger oven paa hinanden?
2. Vil PR #5139 (lag 3) give spillerne NYE fejl (reload-loops, tab af indtastning, reload midt i et loeb, privat browsing, Safari/iOS, gamle faner), og er der evidens for at den fjerner de gamle?
3. Hvorfor tog det otte PR'er, og hvad skal der til for at forloebet ikke gentager sig?

## Maalinger (Sentry CYCLINGZONE-56, "is:unresolved", maalt 11/9)

| Vindue | Events | Ramte spillere |
|---|---|---|
| 7 dage (4/9 til 11/9) | 869 | 48 |
| 24 timer (10/9 til 11/9) | 105 | 27 |
| Seneste time (11/9 kl. 10:30 til 11:30, 5 deploys i timen) | 7 | 6 |

Spillet har ca. 246 menneskehold og ca. 90 aktive pr. 7 dage, saa ca. halvdelen af de aktive spillere har ramt fejlen inden for en uge. Deploys sker mange gange om dagen (Dependabot, docs, backend), ikke kun ved frontend-aendringer.

## Tidslinje (alle PR'er er merget til main medmindre andet staar)

| Dato | PR | Hvad | Resultat |
|---|---|---|---|
| 1/9 | #4546 | Manglende asset giver 404 i stedet for HTML cachet immutable (#4545) | Gjorde fejlen synlig i Sentry (#4595 oprettet 2/9: 29 events/15 spillere paa 14 t) |
| 4/9 | #4745 | Vercel Skew Protection: asset-URL'er baerer deployment-id (#2423) | REVERTET samme dag |
| 4/9 | #4758 | Skew Protection via `__vdpl`-cookie | Sort side for spillere med gammel cookie; hotfix 057622162 slaar det fra. Postmortem: `.claude/learnings/2026-09-04-vercel-vdpl-cookie-pinner-assets-men-ikke-dokumentet.md` |
| 4/9 | #4760 | Selvhelbredende boot-vagt mod cachede 404-chunks (`frontend/public/chunk-selfheal.js`) | Lever stadig |
| 7/9 | #4970 | Lag 1a: release-sha ud af hashede assets, determinisme-vagt, advisory chunk-gate | Fejlen fortsatte (866 til 985 events/7d) |
| 8/9 | #5021 | Lag 1b: `sentryVitePlugin` `release.inject: false`, vagten udvidet | Rod-aarsag nr. 2 for hash-rotation |
| 8/9 | #5028 | Lag 2: `lazyWithRetry` paa de tre sidste bare `lazy()`-kald + vagt (#5014) | |
| 10/9 | #5097 | Vite kaster den aegte preload-fejl i stedet for en syntetisk (egen `preventDefault`) | Postmortem `.claude/learnings/2026-09-10-chunk-preventdefault.md` |
| 11/9 | #5139 (AABEN) | Lag 3: opdag ny release ved navigation/fokus/interval og genindlaes roligt (#5033) | Det du skal doemme |

Aeldre postmortems om samme fejlklasse: `.claude/learnings/2026-06-01-stale-chunk-lazy-recovery.md`, `2026-07-03-chunk-reload-hijacks-navigation-teardown-abort.md`, `2026-08-10-chunk-recovery-reload-hijacks-navigation.md`, `2026-09-04-cachet-404-paa-hashed-chunk-goer-sort-side-permanent.md`, `2026-09-11-5033-chunk-release-detect.md`.

Ejer-beslutning der binder: Vercels indbyggede Skew Protection er fravalgt efter #4745/#4758 (issue #2423, "Vercel-konfig roeres ikke"). Du maa gerne anfaegte den beslutning med evidens, men skriv det som en anbefaling, ikke som en forudsaetning.

## Det du skal laese (i denne raekkefoelge)

1. Issues: `gh issue view 4595 --comments`, `gh issue view 5033 --comments`, `gh issue view 2423`, `gh issue view 5014`.
2. Koden paa main: `frontend/src/lib/lazyWithRetry.js`, `frontend/src/lib/chunkErrors.js`, `frontend/public/chunk-selfheal.js`, `frontend/src/lib/release.js`, `frontend/vite.config.js`, `frontend/vercel.json`, `frontend/index.html` og `frontend/app.html` (meta `cz-release`), `frontend/vercel.rewrites.test.js`, `.github/workflows/deploy-verify.yml` (chunk-fejl-rate-trinnet, budget 25 pr. 24 t).
3. PR #5139: `gh pr diff 5139`, `gh pr view 5139 --comments` (reviewer-fund + to rettelsesrunder), filerne `frontend/src/lib/releaseWatch.js`, `frontend/src/hooks/useReleaseWatch.js`, `frontend/src/lib/releaseWatch.test.js`, `frontend/tests/e2e/5033-release-detect-reload.spec.js`, aendringerne i `vite.config.js` (version.json-plugin) og `vercel.json` (cache-header paa /version.json).
4. Postmortems naevnt ovenfor.

## Spoergsmaal du SKAL besvare (med evidens, ikke mening)

A. Arkitektur
- Er kombinationen "stabile hashes + retry ved fejl + versionsdetektion med blidt reload" den rigtige langsigtede model for denne app, sammenlignet med (i) Vercel Skew Protection brugt korrekt for en SPA uden framework-adapter, (ii) at beholde gamle assets tilgaengelige efter deploy (fx `outputFileNames` med release-mappe og ikke-slettede assets, eller en CDN der ikke 404'er gamle chunks), (iii) service worker med precache, (iv) at bygge appen saa route-chunks ikke roterer naar de ikke aendrer sig (hvad #4970/#5021 forsoegte; verificér om det faktisk holder i dag ved at sammenligne asset-navne mellem to nylige prod-deploys uden frontend-aendringer, fx via `git log` + Vercel-deployment-URL'er eller `dist/`-builds af to commits lokalt).
- Hvorfor er der STADIG 105 events paa 24 timer efter lag 1 + 2? Find den mekaniske forklaring (gamle faner der aldrig blev genindlaest? roterende hashes alligevel? cachede HTML-dokumenter? preload-links i HTML'en der peger paa gamle chunks?). Maal, gaet ikke.

B. Risiko i #5139 (lag 3)
- Reload-loop: gennemgaa `claimReloadSlot`, `canHardReload`, `hardReload` og throttle. Kan to faner, privat browsing, blokeret storage, en CDN-node der stadig serverer gammel HTML, eller `pageshow` fra bfcache give mere end eet reload? Skriv de konkrete scenarier du har efterproevet.
- Tab af brugerinput: `isSafeToReload` tjekker fokuseret input/textarea/select/contenteditable. Hvad med en spiller midt i holdudtagelse (drag/drop, ikke et fokuseret felt), en auktion med aabent bud, eller taktik-boardet? Kan et reload smide ugemt tilstand vaek? Find de sider i `frontend/src/pages` hvor ugemt tilstand lever i React-state uden persistens, og vurder hver.
- Reload midt i et loeb: loebssiden opdaterer live (etaper hver time). Hvad sker der med en fane der staar aabent paa et loeb, naar et deploy lander?
- Baggrund/fokus: `visibilitychange`, `focus`, `blur`, `pageshow` og et 5-minutters interval. Er der dobbelt-tjek, og er throttlen delt mellem dem? Hvad sker der paa iOS Safari (bfcache, `pageshow.persisted`)?
- Vercel-routing: /version.json som statisk fil mod SPA-rewriten. Bevis (curl mod et preview) at den svarer JSON og ikke HTML, og at `max-age=0, must-revalidate` respekteres af Vercels CDN (tjek `age`/`x-vercel-cache` headers).
- Telemetri: `app_version_reload` er samtykke- og login-gated. Er det saa muligt overhovedet at maale effekten? Foreslaa en maaling der ikke afhaenger af samtykke (fx tael reloads server-side eller i Sentry breadcrumbs).
- Tests: 39 unit-tests + 2 e2e med mockede versioner. Hvilke af dine risiko-scenarier ovenfor er IKKE daekket af en test? Lav en liste.

C. Proces
- Otte PR'er paa elleve dage, to revertede/hotfixede samme dag. Laes postmortems og PR-bodies og skriv hvad der gik galt i fremgangsmaaden: manglende rod-aarsags-analyse foer fix, manglende maaling foer/efter, preview-tests der ikke matcher prod, vagter der ikke fangede det (fx determinisme-vagten der var groen fordi CI manglede SENTRY_AUTH_TOKEN). Vaer konkret og haard; ejeren vil have det stoppet.
- Hvilke tre ting skal vaere paa plads FOER naeste chunk-relaterede PR merges? (fx: en maaling af asset-rotation pr. deploy i CI, en obligatorisk to-deploy-test paa preview med script, et "events pr. deploy"-dashboard i Sentry.)

## Leverance

Skriv en markdown-rapport i `docs/audits/2026-09-11-codex-audit-chunk-fejl.md` (kun den fil; ingen andre aendringer) med:
1. Dom i tre linjer: (a) merge #5139 / ret foerst / afvis, (b) er den samlede arkitektur holdbar ja/nej, (c) den ene vigtigste aarsag til at fejlen stadig findes.
2. Fund sorteret efter alvor: BLOKERENDE, HOEJ, MELLEM, LAV. Hvert fund: fil:linje, scenarie i klar tekst ("en spiller der ..."), hvad der sker, hvordan det bevises, forslag til rettelse. Ingen fund uden evidens.
3. Manglende tests og manglende maalinger som to lister.
4. Anbefalet langsigtet plan i prioriteret raekkefoelge (1, 2, 3 ...) med benefit / cost / alternativ pr. punkt, inkl. din holdning til Vercel Skew Protection med henvisning til postmortemen fra 4/9.
5. Proces-afsnittet (C) som en kort, aerlig liste.
6. En tabel over hvad du faktisk har verificeret (kommandoer + resultat) og hvad du ikke kunne verificere.

Kvalitetskrav: alt med fil:linje; ingen "boer overvejes" uden et konkret forslag; ingen omskrivning af PR-bodies som din egen analyse; hvis PR-bodyen paastaar noget du ikke kan genfinde i koden, saa skriv det som et fund. Rapporten laeses af en ikke-teknisk ejer: forklar hvert teknisk ord foerste gang det bruges, i en parentes.
