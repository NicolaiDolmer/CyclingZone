# Design-kvalitetsaudit 2026-09 · mekaniske maalinger

> Del 1 af [#4624](https://github.com/NicolaiDolmer/CyclingZone/issues/4624) (slice 2 af designsystem-epic'et #4622).
> Read-only: ingen kildekode aendret. Denne fil er GENERERET af
> `node tests/e2e/4624-generate-metrics-md.mjs` ud fra
> `docs/audits/quality-audit-2026-09-metrics.json` — redigér ikke direkte.

## Metode (saa tallene kan reproduceres)

- **Server:** `frontend/scripts/e2e-static-server.mjs` (samme statiske preview-server som Playwright's `webServer`), bygget via `npm run build`.
- **Netvaerk:** `installNetworkMocks` + `login` fra `frontend/tests/e2e/fixtures.js` (samme fixtures som resten af e2e-suiten). Ingen kildekode aendret.
- **Ruter:** `frontend/tests/e2e/4624-audit-routes.mjs` — 53 unikke ruter krydset fra `App.jsx` mod `src/pages/*.jsx`. Se `docs/screenshots/quality-audit-2026-09/manifest.json` for den fulde liste + skabelon-gaet.
- **Screenshots:** Playwright chromium, `deviceScaleFactor: 1`, fullPage. desktop 1280×900, mobil 375×812. Mørk via `localStorage.setItem("cz-theme","dark")` foer navigation.
- **Readiness:** `waitForPageReady` (samme util som resten af e2e-suiten) + route-specifikke gates for `/auctions`, `/patch-notes`, `/planning`; generisk fallback for resten (main synlig + fonts.ready + stabil main-geometri, 250ms ekstra).
- **Maalingerne herunder er taget PAA desktop-light-varianten** (efter samme readiness-gate), undtagen `hasHorizontalOverflow` som er maalt paa mobile-light.
- **chromeBeforeDataPx:** y-afstand fra toppen af `<main>` (eller `<body>` paa sider uden app-shell — se `noMainFallback`) til foerste `table tbody tr` / `[role=row]` / `.cz-table`-raekke; findes ingen tabel, til foerste `section`/kort-element der ligger EFTER `<h1>`'ets bund. `chromeMeasuredOn` viser hvilken gren der blev brugt.
- **unicodeArrows / textGlyphIcons:** optaelling af literale tegn (→ ← ↔ ↑ ↓ › « ») hhv. (✓ ✕ ✦ ▲ ▼ ○ ⓘ) i `<main>`'s tekst-noder, SVG ekskluderet.
- **emojiCount:** `\p{Extended_Pictographic}`-matches i samme tekst, minus tegn allerede talt i de to ovenstaaende saet (undgaar dobbelt-taelling).
- **goldPrimaryButtons:** synlige `button`/`a` hvor computed `background-color` ligger inden for ±3 pr. kanal af rgb(232,197,71) (lys) eller rgb(255,217,102)/#ffd966 (moerk).
- **shadowElements:** synlige elementer i `<main>` (ekskl. `[role=dialog]`/`.modal`/`popover`/`toast`) med computed `box-shadow ≠ none`.
- **gradientElements:** computed `background-image` indeholder `"gradient"`.
- **offTokenRadius:** class-streng matcher `rounded-(2xl|xl|lg|md|\[)`.
- **textBelow10px / textBetween10And12NonToken:** elementer med egen (direkte) tekst hvor computed `font-size` er hhv. < 10px, og 10-12px UDEN `text-2xs`/`text-3xs` i class-strengen.
- **rawHexInClass:** class-streng matcher `#[0-9a-fA-F]{3,8}`.
- **bebasCount/bebasSamples:** elementer med egen tekst hvor computed `font-family` indeholder "Bebas"; op til 3 tekst-eksempler.
- **emptyStatesCount/emptyStatesTitles:** elementer med `border-style: dashed` paa mindst én side (EmptyState-signaturen); titel = foerste `h1-h4/p/strong` i elementet.
- **consoleErrors:** antal `console.error`-kald + uncaught `pageerror` under load (fra goto til readiness-gate faerdig).
- **noMainFallback:** `true` hvis siden ikke har et `<main>`-element (offentlige sider uden for app-shellen) — maalingerne er saa taget paa `<body>` i stedet, hvilket giver stoerre raa-tal (heles siden er "main").

---

## Tabel

| Route | Skabelon | chromeBeforeDataPx (målt på) | pile | glyffer | emoji | guld-knapper | skygger | gradients | off-token radius | <10px | 10-12px u/token | rå hex | Bebas (n) | Empty states | h1 | console-fejl |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/` | marketing | 654px (card/section-efter-h1) | 0 | 0 | 0 | 3 | 0 | 0 | 3 | 0 | 20 | 0 | 14 | 0 | "Et managerspil bygget til det lange løb." | 0 |
| `/academy` | T2 | 698px (table/row) | 0 | 0 | 0 | 6 | 0 | 0 | 0 | 0 | 70 | 0 | 0 | 0 | "Akademi" | 0 |
| `/admin/data` | T2 | 1114px (table/row) | 0 | 0 | 2 | 4 | 1 | 0 | 26 | 0 | 79 | 0 | 0 | 0 | "Admin Panel" | 0 |
| `/admin/economy` | T2 | 344px (card/section-efter-h1) | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 1 | – | 1 |
| `/admin/fairplay` | T2 | 112px (card/section-efter-h1) | 14 | 0 | 0 | 2 | 1 | 0 | 6 | 0 | 48 | 0 | 3 | 4 | "E2E Racing" | 0 |
| `/admin/feedback` | T2 | 245px (table/row) | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 11 | 0 | 0 | 0 | "Admin Panel" | 0 |
| `/admin/forum` | T2 | 201px (card/section-efter-h1) | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 1 | "Admin Panel" | 0 |
| `/admin/growth` | T2 | 112px (card/section-efter-h1) | 14 | 0 | 0 | 2 | 1 | 0 | 6 | 0 | 48 | 0 | 3 | 4 | "E2E Racing" | 0 |
| `/admin/season` | T2 | 344px (card/section-efter-h1) | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 1 | – | 1 |
| `/admin/system` | T1 | 159px (card/section-efter-h1) | 2 | 0 | 3 | 2 | 0 | 0 | 10 | 0 | 11 | 0 | 0 | 1 | "Admin Panel" | 0 |
| `/admin/users` | T2 | 250px (table/row) | 1 | 0 | 0 | 1 | 0 | 0 | 4 | 0 | 14 | 0 | 0 | 0 | "Admin Panel" | 0 |
| `/admin/value-transition` | T2 | 112px (card/section-efter-h1) | 14 | 0 | 0 | 2 | 1 | 0 | 6 | 0 | 48 | 0 | 3 | 4 | "E2E Racing" | 0 |
| `/auctions` | T2 | 556px (table/row) | 0 | 0 | 0 | 6 | 0 | 0 | 0 | 0 | 27 | 0 | 0 | 1 | "Auktioner" | 0 |
| `/auctions/history` | T2 | 278px (table/row) | 0 | 0 | 0 | 2 | 0 | 0 | 5 | 0 | 8 | 0 | 0 | 0 | "Auktioner" | 0 |
| `/board` | T1 | – | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | – | 0 |
| `/compare` | T2 | 168px (card/section-efter-h1) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | "Sammenlign Ryttere" | 0 |
| `/dashboard` | T1 | 112px (card/section-efter-h1) | 14 | 0 | 0 | 2 | 1 | 0 | 6 | 0 | 48 | 0 | 3 | 4 | "E2E Racing" | 0 |
| `/finance` | T1 | 96px (card/section-efter-h1) | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 34 | 0 | 0 | 0 | "Finanser" | 0 |
| `/forum` | T2 | 173px (card/section-efter-h1) | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 23 | 0 | 0 | 0 | "Forum" | 0 |
| `/forum/:postId` | T3 | 143px (card/section-efter-h1) | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 26 | 0 | 0 | 0 | "Which feature should we build next?" | 0 |
| `/founder-supporter` | marketing | 607px (card/section-efter-h1) | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 30 | 0 | 11 | 0 | "Byg dit cykelhold. Kør mod verden. Bak et fair managerspil op." | 0 |
| `/handelsbetingelser` | marketing | 199px (card/section-efter-h1) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | "Handelsbetingelser" | 0 |
| `/help` | T1 | 106px (card/section-efter-h1) | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 29 | 0 | 0 | 0 | "Hjælp" | 0 |
| `/klub` | T2 | 249px (card/section-efter-h1) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | "Klub" | 0 |
| `/login` | auth | 311px (card/section-efter-h1) | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 0 | 7 | 0 | 0 | 0 | – | 0 |
| `/managers/:teamId` | T3 | 356px (card/section-efter-h1) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 15 | 0 | 2 | 0 | "E2E Racing" | 0 |
| `/notifications` | T1 | 165px (card/section-efter-h1) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | "Indbakke" | 0 |
| `/patch-notes` | T1 | 106px (card/section-efter-h1) | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 8 | 0 | 0 | 0 | "Patch notes" | 0 |
| `/planning` | T2 | 146px (card/section-efter-h1) | 1 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 29 | 0 | 0 | 0 | "Planlægning" | 0 |
| `/privacy-policy` | marketing | 199px (card/section-efter-h1) | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 3 | 0 | 1 | 0 | "Privacy policy" | 0 |
| `/privatlivspolitik` | marketing | 199px (card/section-efter-h1) | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 3 | 0 | 1 | 0 | "Privatlivspolitik" | 0 |
| `/pro` | T1 | 106px (card/section-efter-h1) | 0 | 0 | 0 | 2 | 0 | 0 | 1 | 0 | 3 | 0 | 0 | 0 | "Bliv Founder" | 0 |
| `/profile` | T1 | 100px (card/section-efter-h1) | 5 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 22 | 0 | 0 | 0 | "Min Profil" | 0 |
| `/race-archive/:raceSlug` | T3 | 143px (card/section-efter-h1) | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 | 0 | 0 | 0 | "Omloop Preview" | 0 |
| `/race-centre` | T2 | 144px (card/section-efter-h1) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | "Løbscenter" | 0 |
| `/races/:raceId` | T3 | 1754px (table/row) | 1 | 0 | 0 | 5 | 1 | 0 | 2 | 22 | 38 | 0 | 4 | 0 | "Tour de Preview" | 0 |
| `/reset-password` | auth | 415px (card/section-efter-h1) | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 5 | 0 | 0 | 0 | "Nulstil adgangskode" | 0 |
| `/resultater` | T2 | 169px (card/section-efter-h1) | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 26 | 0 | 0 | 1 | "Resultater" | 0 |
| `/riders` | T2 | 500px (table/row) | 3 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 75 | 0 | 0 | 0 | "Rytterdatabase" | 0 |
| `/riders/:id` | T3 | 412px (card/section-efter-h1) | 2 | 0 | 1 | 1 | 0 | 0 | 0 | 12 | 9 | 0 | 6 | 0 | "Ada Pedersen" | 0 |
| `/roadmap` | T1 | 150px (card/section-efter-h1) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 28 | 0 | 0 | 0 | "Roadmap" | 0 |
| `/rules` | T1 | 106px (card/section-efter-h1) | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 10 | 0 | 0 | 0 | "Regler" | 0 |
| `/scouting` | T2 | 28px (card/section-efter-h1) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | – | 0 |
| `/seasons` | T1 | 1089px (table/row) | 0 | 0 | 0 | 0 | 5 | 0 | 0 | 0 | 15 | 0 | 2 | 0 | "Sæson 1" | 0 |
| `/seasons/:seasonId/finance/:teamId` | T1 | 344px (card/section-efter-h1) | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 1 | – | 1 |
| `/staff/:id` | T3 | 434px (card/section-efter-h1) | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 3 | 0 | 1 | 0 | – | 0 |
| `/standings` | T2 | 335px (table/row) | 0 | 0 | 0 | 0 | 7 | 0 | 0 | 0 | 12 | 0 | 0 | 0 | "Ranglister" | 0 |
| `/team` | T2 | 328px (table/row) | 1 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 11 | 0 | 0 | 0 | "E2E Racing" | 0 |
| `/teams/:id` | T3 | 483px (table/row) | 1 | 0 | 0 | 1 | 2 | 0 | 0 | 0 | 70 | 0 | 2 | 0 | "E2E Racing" | 0 |
| `/terms` | marketing | 199px (card/section-efter-h1) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | "Terms of Sale" | 0 |
| `/training` | T2 | 301px (table/row) | 0 | 0 | 0 | 1 | 0 | 0 | 3 | 0 | 8 | 0 | 0 | 0 | "Daglig træning" | 0 |
| `/transfers` | T2 | 106px (card/section-efter-h1) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 15 | 0 | 0 | 1 | "Transfers" | 0 |
| `/watchlist` | T2 | 106px (card/section-efter-h1) | 0 | 0 | 1 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 1 | "Talentspejder" | 0 |

---

## Sum pr. indikator (alle 53 ruter)

- **unicodeArrows**: 76
- **textGlyphIcons**: 0
- **emojiCount**: 7
- **goldPrimaryButtons**: 69
- **shadowElements**: 21
- **gradientElements**: 0
- **offTokenRadius**: 80
- **textBelow10px**: 34
- **textBetween10And12NonToken**: 1010
- **rawHexInClass**: 0
- **bebasCount**: 59
- **emptyStatesCount**: 29
- **consoleErrors**: 3

## Top-10 sider efter chromeBeforeDataPx (mest chrome foer indhold)

1. `/races/:raceId` — 1754px (table/row)
2. `/admin/data` — 1114px (table/row)
3. `/seasons` — 1089px (table/row)
4. `/academy` — 698px (table/row)
5. `/` — 654px (card/section-efter-h1)
6. `/founder-supporter` — 607px (card/section-efter-h1)
7. `/auctions` — 556px (table/row)
8. `/riders` — 500px (table/row)
9. `/teams/:id` — 483px (table/row)
10. `/staff/:id` — 434px (card/section-efter-h1)

## Sider med console-fejl under load

- `/admin/economy`: 1 fejl
- `/admin/season`: 1 fejl
- `/seasons/:seasonId/finance/:teamId`: 1 fejl

## Sider der fejlede helt (screenshot/maaling kunne ikke gennemfoeres)

Ingen.

## Saerlige observationer (manuelt tilfoejet efter gennemsyn af screenshots)

- **`/admin/economy`**: Samme ErrorBoundary-crash som /admin/season, samme mistaenkte aarsag (auction_timing_config .single()). Boer verificeres mod et rigtigt admin-login.
- **`/admin/fairplay`**: TEST_USER er ikke seedet som admin (users.role) i e2e-mocks -> siden gater client-side og redirecter til /dashboard (Navigate). Screenshot viser derfor dashboardet, ikke fairplay-UI'en. Forventet adfaerd for en ikke-admin bruger, ikke en fejl.
- **`/admin/growth`**: Samme som /admin/fairplay: users.role !== "admin" i mocks -> redirect til /dashboard. Screenshot viser dashboardet.
- **`/admin/season`**: Renderer en generisk ErrorBoundary ("Siden kunne ikke vises") under e2e-mocks — sandsynligvis en mock-data-mangel (transfer_windows/auction_timing_config .single()-kald), IKKE et bekraeftet produktions-fund. Boer verificeres mod et rigtigt admin-login foer det tages med som design-fund.
