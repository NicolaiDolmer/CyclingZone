# Løbsbibliotek — handoff 14/10/2026

Status ved pausen14/10: **in_progress, session afsluttet på ejerens anmodning**. Genoptaget15/10 efter ejer-go; se den seneste verifikation nederst.

## Delt state

- Issue [#6514](https://github.com/NicolaiDolmer/CyclingZone/issues/6514), build-draft [#6636](https://github.com/NicolaiDolmer/CyclingZone/pull/6636), plan-draft #6634.
- Branch codex/6514-loebsbibliotek. Worktree C:/Users/ndmh3/.codex/worktrees/6514-loebsbibliotek/CyclingZone. Hoved-checkoutet er ikke ændret.
- Design/build-go: ejeren 14/10, kommende startfane; issuecomment6175783481. Plan: ../superpowers/plans/2026-10-14-loebsbibliotek.md. SSOT: ../RACE_LIBRARY_RULES.md.
- Første læselag: cd7fb9682; oversigt/detail: a86c41e2a. Afsluttende snapshot indeholder nedenstående reviewrettelser.
- Ejer 14/10 godkendte **+2 KB gzip-budget**, derefter session-stop for natten. Branch1192→1194. Hvis nyere main har højere budget, bevar main og læg de godkendte2KB oveni, inklusive upstream-noter.

## Målt evidens

- Lokal PG17-baseline er syntetisk SQL, ../audits/2026-10-14-loebsbibliotek-baseline.md. Ingen evidens for autentificeret prodlatens, RLS-effekt i browser eller forbedret spilleradfærd.
- 18 model/query-tests bestået. FULL verify-local på a86c41e2a: backend14031pass/5skip/7TODO; frontend4626pass; Vite-build grøn. Typecheck og komplet preflight grøn.
- 24 tidlige bibliotek-e2e i alle tre projekter grønne (inkl. URL/scroll/sene svar). Suite udvidet til15cases; endelig HEAD kræver verificering.
- Fuld1881-case e2e blev startet med4workers, derefter stoppet ved ejerens session-stop; **ingen påstand om fuld grøn suite**. Et boardroom-fund blev flaky/retry-grønt; undersøg slutrapport/CI før klassificering. Første forsøg manglede VITE_E2E-build-hook; corrected run havde hooken.
- CI a86c41e2a perf-gate:1267.6KB mod1265.3KB loft. Lokal tilsvarende overskridelse2.7KB. Efter bounded chunk-gruppe og slutrettelse:1253.3KB mod ejer-godkendt1253.7KB lokalt loft; entry56.30KB uændret. Budgetforøgelsen er ejer-godkendt, men frisk-main CI skal genverificeres.
- Screens i pr-screens/6514 er **anonyme syntetiske** browser-renderinger, ikke prod. Før/efter er en tidligere verificeret rendering; final-head billeder skal genfotograferes.

## Frisk review og rettelser

Én read-only gpt-6-astra-review på base5ac04e1d0→a86c41e2a. Ingen critical; tre important: manglende resultatslink, tvetydig pulje ved alle divisioner, opdigtede etapevalg ved sparse profiler/ukendt antal. Alle tre browser-regressioner observeret RED. Implementeret: eksisterende results-link, division+pool-labels/hero, faktiske sorteret unikke etape-numre. Slutrunde:42 bibliotekscases bestod i tre projekter. De tre puljecases ramte først en forkert summary-locator; efter rettet locator reproduceredes den faktisk manglende selector-label (Pulje1 uden division), som blev rettet. Alle tre genkontrollerede puljecases bestod. Resultater/sparse-etaper har observeret RED→GREEN. Der er dermed45 beståede cases fordelt på hovedrunde og tre genkontrollerede cases, **ikke én ubrudt45/45-kørsel**.

Deferred minors: statistik mobileDefaults nævner den fjernede wins-kolonne (helperfallback vælger gyldige kolonner); retry på ugyldigt detailscope bevarer URL'en (tilbage-link kan reparere scope). Minors er ikke rettet i final-pass.

Rulings: eksakt gemt navn+type giver kandidater fordi katalog-ID skifter; ID+sæson/pulje giver udgaven. Tre leverancer er commits i én draft for at holde to drafts inkl. planen. Ingen autentificeret prod-reproduktion tilgængelig; PG17 erstatter ikke den evidens. Read-onlyreview fravalgte prodlatens/RLS/spilleradfærd og ejer-release, som derfor stadig er gates.

## Næste handlinger

1. Læs CLAUDE/AGENTS/NOW samt denne handoff; genbrug ejer-go. Fetch origin; kontroller frisk-main mergeability/budget/versioner uden at røre Claudes spor.
2. Afslut reviewrettelsernes RED→GREEN: hele race-library.spec.ts i tre projekter og18unit/query. Tjek auth/loading/legacy, Resultater/Seneste/Point og mobil320/390, mørk/lys.
3. Preflight/typecheck/FULL og hele e2e på final-head; undersøg CI/CodeRabbit og gzip-gate. Nye fund klassificeres med bevis; intet skjult budgetløft.
4. Opdatér final screenshots/README/PR-body med eksakte SHA/resultater; ejer-preview. Merge/release afventer særskilt mandat. Luk ikke #6514 før releaseaccept.

## Testmiljø (kun syntetisk)

Own worktree har isolerede root/frontend/backend node_modules, ingen junction. Heavy commands via scripts/verify-lock.ps1 -Max2. verify-local kræver SUPABASE_URL=https://cycling-zone-e2e.supabase.co og SUPABASE_SERVICE_KEY med testharnessens syntetiske dummy-værdi. Browser-build: VITE_SUPABASE_URL=samme; VITE_SUPABASE_ANON_KEY=e2e-anon-key; VITE_API_URL=https://api.cycling-zone-e2e.test; **VITE_E2E=1**. Fjern childshell SENTRY_AUTH_TOKEN; kør aldrig release-upload.
Vite client build direkte; SSR build src/entry-server.jsx --outDir dist-ssr; scripts/prerender.mjs. Playwright CI=1 genbruger statisk output (app.html kræves); PLAYWRIGHT_BROWSERS_PATH peger på worktree .superpowers/sdd/2026-10-14-loebsbibliotek/browsers. Den scratchmappe er cache, ikke SSOT; browsers kan geninstalleres med playwright install chromium webkit.

## Bindende afgrænsning

Ingen edits i RaceDetailPage, components/race/*, race-centre, App.jsx, S5-kalender eller #6367/#6362/#6369/#6570; ingen fortsættelse af #5833/#6601. RaceHistoryPage er tilladt bibliotek-wrapper. Ingen prodskrivninger/migration/flag/deploy/Discord/mail. NOW/MASTERPLAN urørte.

## Afsluttende snapshotkontrol

18unit/query bestået igen, typecheck grøn, komplet preflight grøn, branchdiff-check grøn og beskyttede stier uden diff. Lokal bundle-gate bestået. Fuld e2e stoppet og egen runner/server afsluttet. Frisk reviewer er færdig; ingen aktiv agent skal fortsætte i nat. Endelig commit/SHA og remoteverifikation står på #6514/#6636.

## Genoptaget15/10

Main7cd2e5f95 integreret i bibliotekets egen branch. Eneste konflikt: budget, løst ved main1205 + godkendte2KB=1207. Ingen ændring af beskyttede stier i diff mod main. Begge små reviewpunkter er korrigeret: gyldige statistik-kolonnenøgler og konkret genfinding fra ugyldigt scope (observeret RED før rettelse).

Målt: FULL backend14089pass/6skip/7TODO, frontend4658/4658. Preflight/typecheck grønne. Gzip1266.4KB mod1267.4KB loft. Alle tal er lokale syntetiske checks; ingen prodlatens-/adfærdspåstand. Hele browsersuiten på opdateret kode kører; endelig GREEN og CI registreres efter afslutning. Arkitekturens bibliotek-redirect er afstemt med App.jsx.

## Afsluttende verifikation 15/10

Status: bygget og lokalt verificeret; ejer-preview/merge/release åbent. [Samlet bevis](../audits/2026-10-15-loebsbibliotek-verifikation.md) erstatter tidligere afventende verifikationsstatus ovenfor.
- Hele e2e: 1718 bestået, 175 skipped, 0 fejl. FULL: backend14089pass/6skip/7TODO, frontend4658/4658.
- Sidste locale-overskrift rettet med observeret RED; afsluttende bibliotekssuite54/54, preflight/typecheck/offlinebuild grønne. Gzip1266,3KB mod1267,4KB loft.
- Alle fem oprindelige reviewfund rettet. Mobil/desktop/lys/mørk og tom/fejl/loading-billeder fornyet. Beskyttede stier, NOW og MASTERPLAN urørte.
- Næste handling: kontroller afsluttende SHA-CI/botreview på #6636; ejer afprøver preview. Ingen evidens for autentificeret prodlatens/RLS eller spilleradfærd. Luk ikke #6514 før accept.

CodeRabbit-opfølgning15/10: ét minor +to trivial rettet (udgavernes tomtilstand, abortcheck, numerisk sortering). Ny lokalrunde57/57 +18/18, type/build grønne, gzip1266,4KB. CI3875416cf havde kun artifact-upload ETIMEDOUT efter beståede lane-tests; næste reviewcommit skal have ny CI. To ekstra tom-udgavebilleder gemt.
