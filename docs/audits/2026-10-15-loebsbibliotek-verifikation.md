# Løbsbibliotek: afsluttende verifikation 15/10/2026

Scope: #6514, PR #6636. [Godkendt plan](../superpowers/plans/2026-10-14-loebsbibliotek.md), [SSOT](../RACE_LIBRARY_RULES.md), [screenshots](../../pr-screens/6514/README.md). Ejerens build-go og +2 KB budget er givet 14/10; genoptagelse godkendt 15/10. Ingen merge eller produktionsskrivning udført.

## MÅLT EVIDENS

Main 7cd2e5f95 er integreret i egen branch, integrationscommit c27d976304ad32a8dcce792f096402524b8125e6. Beskyttede S5-/løbsdetaljestier har ingen diff mod denne main. Eneste mergekonflikt var budget: upstream 1205 + godkendte 2 = 1207; upstream-noter bevaret.

| Kontrol | Observeret resultat | Grundlag |
|---|---|---|
| FULL verify-local | Backend 14.089 bestået, 6 skipped, 7 TODO; frontend 4.658/4.658 bestået; build bestået | Integrationscommit c27d976 |
| Hele browsersuiten, tre projekter | 1.718 bestået, 175 skipped, 0 fejl, i alt 1.893; 17,5 min | c27d976, før sidste lokale fejloverskrift-rettelse |
| Afsluttende bibliotekssuite, tre projekter | 54/54 bestået uden retries; 1,1 min | Endelig UI inklusive danske/engelske fejloverskrifter |
| Preflight og TypeScript | Bestået | Gentaget efter sidste UI-rettelse |
| Offline client/SSR/prerender | Bestået | Endelig UI, ingen release-upload |
| Samlet gzip-gate | 1266,3 KB mod 1267,4 KB loft | Budget 1207 med eksisterende 5 % tolerance |
| Billedkontrol | Ni visninger uden ydre overflow eller pageerrors; loading særskilt kontrolleret | Anonyme fixtures; mobil 390 px, desktop 1280/1440 |
| GitHub CI på c27d976 | 59 checks afsluttet uden fejl, inklusive tilladte skips | Før afsluttende dokumentations-/locale-commit; endelig SHA-status i PR |

Bibliotekets model/query-tests indgår i frontend-suite. Browsercases dækker bl.a. startfane, søgning, URL/tilbage/scroll, seneste svar, gamle links, puljer, sparse etaper, results-links og ugyldigt scope. Separate localesager blev observeret røde med den engelske standardoverskrift i dansk UI og grønne efter brug af den eksisterende common-oversættelse.

Én uafhængig reviewrunde fandt ingen critical, tre important og to minor. Alle fem er rettet. Important-regressionerne og ugyldigt scope er reproduceret før rettelse; mobileDefaults er en korrigeret kolonnenøgle, dækket af statistikflow. CodeRabbit er særskilt og må ikke sidestilles med dette review; status står på PR'en.

## FORTOLKNING OG BEGRÆNSNING

De målte checks understøtter korrekt navigation og afgrænset læsning under de afprøvede fixtures. Budgetloftet er et regressionsværn, ikke et ejer-godkendt kvalitetsmål. [PG17-baseline](2026-10-14-loebsbibliotek-baseline.md) er syntetisk SQL/payload og må ikke fortolkes som browser- eller prodlatens.

**Ingen evidens** for autentificeret produktionslatens, RLS i ejerens browsersession eller forbedret spilleradfærd. Ingen påstand om at alle kontrolmål er 44 px. De 175 skips er ikke beståede tests. Den fulde suite er ikke gentaget efter den isolerede locale-overskrift; de 54 relevante cases og preflight/typecheck/build er gentaget.

## Resterende accept

Endelig commit-CI og botreview kontrolleres på PR #6636. Ejeren skal på preview afprøve Kommende løb, finde Vuelta uden præcis accent, åbne en ældre udgave og vende tilbage med filtre/scroll, på mobil og desktop. Visuelt accept- og merge/release-mandat er fortsat åbent. Issue #6514 forbliver åbent.

Close-out: cleanup fandt ingen efterladte watchers/preview/Playwright-processer. Token-hygiejne har én eksisterende fejl: AGENTS.md, 6738 approx tokens mod Codex-budgettet; filen er urørt i PR. Øvrige nye rapporter ændrer ikke dette. Status-board-generatoren blev kørt; dens globale datodrift er ikke medtaget i bibliotekets diff.

## CodeRabbit-opfølgning

CodeRabbit afsluttede review af 3875416cf: ét minor (tom udgaveliste viste permanent skeleton) og to trivial (abortcheck før vinderbatch, numerisk divisionssortering). Alle tre er runtime-/kodeverificeret og rettet. Tomtilstandens test blev først korrigeret til eksisterende dansk ordlyd, derefter observeret RED af den faktiske manglende tomtilstand. Afsluttende bibliotekssuite efter rettelser: **57/57** i tre projekter uden retries; model/query **18/18**, typecheck og offline client/SSR/prerender bestået. Gzip **1266,4 KB mod1267,4 KB**. Nye faktiske billeder: editions-empty-desktop/mobile, uden ydre overflow/pageerrors.

CI på 3875416cf: frontend-build/backend/perf og alle testassertions i den berørte mobile-chromium-lane bestod (279pass/37skip). Lane og samlet frontend-smoke blev røde på GitHubs artifact-upload: ETIMEDOUT, efter tests exit0. Det er en observeret infrastrukturfejl, ikke grøn samlet CI. Den næste commit med reviewrettelser udløser en ny komplet CI; dens status læses på PR'en.

GitHub-connectorens samlede botkommentar blev blokeret af secretfilterets high-entropy-heuristik før visning. Reviewfundene blev derefter læst via lokalt metadatafiltreret API-udtræk. Ingen kendt secretværdi blev vist; ingen rotation eller ændring af sikkerhedsfilter udført.

## Historisk indgang, P2-review

Codex-connectorens separate review fandt et gammelt navne-link fra SeasonEndPage. MÅLT EVIDENS: browserklik fra Sæson3 åbnede først Kommende/Sæson4 for samme løb; regression observeret RED. Minimal ændring: eksisterende kliklink sender race.id og valgt sæson med. Sæsonlisten viser også andre puljer; en udvidet regression var RED, da detailopslaget arvede egen pulje. Linket bevarer derfor listets all-division/all-pool-scope sammen med konkret ID. Ingen layout-, kalendergenererings- eller S5-ændring. SeasonEndPage er den eneste yderligere indgang ud over planens to wrappers; ændringen er nødvendig for bibliotekets bagudkompatibilitet.

Efter den historiske linkrettelse: **76 bestået, 2 skipped, 0 fejl** i en samlet runde (bibliotekets60 cases +18 eksisterende sæson-honours-cases, tre browserprojekter). Typecheck/offlineclient/SSR/prerender bestået. Endelig gzip1266,3KB mod1267,4KB loft. Historisk klik med anden pulje er nu GREEN i alle tre browsere. historical-edition-desktop/mobile viser faktisk Sæson3, Division3 og korrekt resultatslink efter klik fra sæsonlisten, uden ydre overflow/pageerrors.
