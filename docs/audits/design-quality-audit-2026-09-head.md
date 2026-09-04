# Design-kvalitetsaudit 2026-09: alle sider mod TASTE.md

**Dato:** 2026-09-02 · **Issue:** [#4624](https://github.com/NicolaiDolmer/CyclingZone/issues/4624) (slice 2 af [#4622](https://github.com/NicolaiDolmer/CyclingZone/issues/4622)) · **Målestok:** [`docs/design/TASTE.md`](../design/TASTE.md) (ejer-godkendt 2/9) + [`PAGE_TEMPLATES.md`](../design/PAGE_TEMPLATES.md) · **Forrige audit:** [23/7 (komposition, 52 sider)](design-composition-audit-2026-07-23.md).

**Metode.** 53 unikke ruter (63 sidefiler minus param-varianter og legacy-filer der ikke er routet) fotograferet i lys 1280×900, mørk 1280×900 og mobil 375×812 med e2e-mocks (sonnet-worker, script `frontend/tests/e2e/4624-quality-audit.shots.mjs`, screenshots i `docs/screenshots/quality-audit-2026-09/`). Mekaniske slop-indikatorer pr. side i [`quality-audit-2026-09-metrics.md`](quality-audit-2026-09-metrics.md). De 17 mest besøgte sider er dømt af Fable, resten af to sonnet-dommere, alle mod §4-tjeklisten (17 ja/nej, q2/q7/q8/q13 dobbelt). Score er normaliseret til /21 uden "ikke relevant"-spørgsmål (`*` = tyndt grundlag, under 8 vægtede spørgsmål). Trafik fra Microsoft Clarity, 30 dage til 2/9. Samlet af `scripts/audit/4624-compile-quality-audit.mjs`. Read-only: ingen kildekode ændret.

## TL;DR

Ensartetheden fra juli holder: 0 rå hex, 0 gradienter, 0 tekst-glyffer, og 9 sider er verdensklasse-kandidater (alle sider med lidt indhold: Sammenlign, Hjælp, Patch notes, forum-tråden, legal-siderne). **Men de syv mest besøgte sider (Indbakke, Dashboard, Mit hold, Træning, Auktioner, Planlægning, Ryttere: 15.250 sessioner på 30 dage) scorer 11-18 og har alle det samme problem: chrome står foran data, og kontrol-idiomer opfindes pr. side.** Løbssiden, appens smukkeste flade, har 1.754 px før holdudtagelsen fordi etapeprofilen tegnes to gange i fuld størrelse.

Fire mønstre dækker 27 af de 45 dømte sider og er kit-fund (slice 3), ikke side-fund:

| Mønster | Sider (hovedfund) | Løses hvor |
|---|---|---|
| **Chrome før data** (filterpaneler åbne, stat-kort, intro-prosa, løsrevne knaprækker) | Ryttere, Auktioner, Transfers, løbssiden, /admin/data + orphan-rows på Mit hold og Træning + prosa på Økonomi, Regler, /admin/system | Én `FilterBar`-primitiv (søg + 3 selects + "Flere filtre" lukket), `PageHeader` action-slot håndhævet, T2-tabellens fold. Fork 1 (FM-tæt) indføres side for side efter ejer-go på den ægte side |
| **Tom tilstand beskrivende** (titel siger hvad der mangler, ingen knap) | Indbakke, Scouting, Klub, Løbscenter, /admin/forum + Transfers, Dashboard (delvist) | `EmptyState` kræver `action`-prop; copy-runde på ~15 tekster (fork 4) |
| **Mobil taber kolonner** | Ryttere, Mit hold, /teams/:id, /managers/:teamId, /auctions/history, /admin/feedback | `DataTable` pinned navn + vandret scroll som default (fork 6). Træningssiden HAR mønstret allerede; gør det til standarden |
| **Guld uden for de fire tilladte steder** (guld i rækker, guld-tal, keyline på almindelige kort, guld-tint som "aktiv") | Akademi, Auktioner, Økonomi, Profil, /pro, /seasons, løbssiden | `Button` i `DataTable`-rækker kan ikke være primary; `Card` uden keyline-prop uden for T3; stat-tal aldrig `--accent-t` |

Dertil tre mekaniske sweeps der ikke behøver design-dom: **76 unicode-pile** (14 alene på Dashboard, plus `← Forrige / Næste →` og `↔ Sæt til salg`), **80 off-token radier** (26 på /admin/data), og **1.010 tekst-elementer i 10-12 px uden token** (70 på Akademi, 75 på Ryttere, 70 på /teams/:id). De tre er CI-vagt-kandidater (slice 4, #4626) med baseline-ratchet.

## De ti sider der skal have en runde først

Rangeret efter (manglende point × trafik). Alle ti er spillerflader.

1. **Dashboard** (3.978 sessioner, 13/21): 12 stablede kort, 14 tekst-pile, Title Case + ampersand i overskrifter, venstre-accent-bjælke, fire tomme kort. Det første en ny spiller ser; 73 % kommer aldrig igen. ELEVATION #4 fra 25/7 er ikke leveret.
2. **Mit hold** (1.866, 13): faner som kantede knapper, løsrevet Overblik/Evner-række, tabel klippet ved 1280 px, mobil viser to talkolonner og tankestreg som værdi.
3. **Auktioner** (1.410, 11): 556 px chrome, tre guld-tintede "aktive" knapper, guld i rækker (`Byd`, `+ Autobud`).
4. **Løbssiden** (1.170, 9): profilen tegnes to gange i fuld størrelse, to guld-knapper, 22 elementer under 10 px, prosa under tabellen. Selve profil-SVG'en er P2 i renkultur; den skal bare tegnes én gang.
5. **Indbakke** (4.012, 18): beskrivende tom tilstand uden handling som kasse i kasse. Appens mest besøgte side.
6. **Ryttere** (1.170, 11): uændret siden 25/7: 500 px chrome, orphan-række, klippet tabel, mobil uden tal.
7. **Træning** (1.417, 15): orphan checkbox-række, prosa, disabled guld-tintet knap med parentes-copy. #4613 (overblik + faner) dækker retningen; denne audit bekræfter behovet.
8. **Planlægning** (1.395, 16): tre egne kontrol-idiomer (navy toggle, uppercase guld-chips, tom tidslinje-bjælke), 29 mikro-tekster uden token.
9. **Transfers** (670, 11): to sorterings-mekanismer, intro-prosa, beskrivende tom tilstand.
10. **Akademi** (668, 11): seks guld-knapper på ét view, danger-outline i rækker, eyebrow-idiom over kortene (så #4635's kanoniske kort skiller sig ud).

## Fund der ikke er design, men skal ses

- **Em-dash på forsiden:** fem sektions-eyebrows på `/` starter med en em-dash (`[em-dash] SÅDAN SPILLER DU`). `tone-check-em-dash.mjs` fanger ikke hardkodet copy uden for locales. Rettes som copy + vagt udvides.
- **`/staff/:id` viser `ROLES.UNDEFINED` og `undefined`** under mocks (manglende staff-seed). Skal verificeres mod et ægte staff-id før det tælles som prod-fund; er det ægte, er det severity 3.
- **`/reset-password` viser en spinner i kortet** i alle tre varianter (formentlig manglende token i e2e-URL'en). Verificér mod et ægte link.
- **`/scouting` i gated tilstand** er et stiplet EmptyState uden sidehoved og uden handling, og 469 sessioner på 30 dage rammer den. Selv hvis siden er låst for de fleste, skal den have sidehoved + "hvornår" + én handling.
- **Watchlist bruger et ⭐-emoji i tom-tilstands-copy'en** ("Klik på ⭐ ved siden af…"). Eneste emoji-fund i spillerflader (de øvrige 6 er admin).

## Ikke dømt (mock-begrænsninger, ikke fund)

- `/standings` sad i skeleton-state og `/board` i PageLoader under mocks; 25/7-billedet viser Stillinger som referenceside, og Bestyrelsen dømmes når Boardroom (S-M2b, beta) flippes.
- `/admin/economy`, `/admin/season`, `/seasons/:seasonId/finance/:teamId` rammer ErrorBoundary under mocks (`.single()` mod tabeller uden seed). Ikke et prod-fund før det er set med ægte admin-login.
- `/admin/fairplay`, `/admin/growth`, `/admin/value-transition` redirecter til dashboardet fordi TEST_USER ikke er admin i mocks; udeladt af tabellen.
- **Screenshot-artefakt:** i fullPage-billederne på mobil står den faste bund-navigation midt på siden (Playwright tegner `position: fixed` én gang ved viewport-positionen). Dommer A's "bund-nav overlapper indhold på 7 sider" er dette artefakt, ikke en fejl, og er fjernet fra fund-listen. Verificeret på Dashboard-mobil.
- ErrorBoundaryens "Genindlæs siden" er `variant="primary"`. Det er den eneste knap på en crash-side og dermed inden for "én guld pr. view"; PAGE_TEMPLATES' "retry aldrig guld" gælder `ErrorState` inde i kort. Spec-uklarhed, ikke fund.

## Input til de næste slices

- **Slice 3 (kit, #4625):** de fire kit-fund i TL;DR-tabellen, i den rækkefølge. Plus: `Tabs`-primitiv der ikke kan tegnes som knapper (Mit hold), `Section` uden mulighed for venstre-bjælke (Dashboard, tre admin-sider), `Sparkline`-primitiv (fork 5) så `/seasons`' guld-kurve og Dashboards guld-progress-bars får ét monokromt sprog.
- **Slice 4 (CI, #4626):** unicode-pile (76, baseline-ratchet), off-token radius (80), `text-[Npx]`/computed 10-12 px uden token (1.010, ratchet), em-dash i hardkodet JSX-copy, emoji i JSX. Metrics-scriptet i `frontend/tests/e2e/4624-quality-audit.shots.mjs` er en brugbar kerne for en nightly måling.
- **Slice 6 (#4628):** #4109 Planlægning anti-slop er dækket af Planlægnings-fundet ovenfor.
- **Copy-runde (fork 4):** de ~15 tomme tilstande + Dashboards Title Case-overskrifter i én tone-session med ejeren.

## Tabellen (alle 50 dømte/ikke-dømte sider)

