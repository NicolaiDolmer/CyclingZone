# Design-komposition-audit — alle 52 sider mod designsystemet

**Dato:** 2026-07-23 · **Issue:** [#2849](https://github.com/NicolaiDolmer/CyclingZone/issues/2849) · **Metode:** 5 parallelle analyse-agenter (4×13 sider + app-shell), read-only. Designsystem-kontrakt: Claude Design-projektet "Cycling Zone Design System" (porteret fra repoet 2026-06-20) + `frontend/src/components/ui/*` + tokens i `index.css`/`tailwind.config.js`.

## TL;DR

Uensartetheden sidder IKKE i tokens/farver (0 rå hex-farver i 52 sider — farve-disciplinen er reelt verdensklasse). Den sidder i **side-komposition**: der findes ingen delte side-skabeloner, så hver side har selv opfundet sit sidehoved, sin container-bredde, sin card-padding og sine tomme-/fejltilstande. Samtidig lever **to design-generationer** side om side: den gamle app-stil (`h1 text-xl font-bold`) og den nye editorial-stil (#672: Bebas `font-display` + border-b-headerbånd), uden en besluttet kanon.

**Nøgletal:**

| Måling | Resultat |
|---|---|
| Sidehoved-systemer i omløb | **9 varianter** (majoritet: `text-xl font-bold` + subtitle, ~20 sider) |
| Container-bredder i omløb | **10+** (`max-w-xl` … `max-w-7xl`, `max-w-[1100px]`, `max-w-full`, ingen, fane-betinget) |
| Sider der håndkopierer `Card`-klasserne i stedet for at importere `Card` | **~15**, med **mindst 5 forskellige paddings** for samme visuelle recipe |
| `ui/Table`-primitiven brugt af | **~5 af 52** sider (KitchenSink demonstrerer den som kanon; resten håndruller `<table>`) |
| `ErrorState` brugt af | **1 af 52** (AcademyPage). Resten: håndrullede fejl-divs eller **tavs degradering uden fejl-UI** |
| `ProgressMeter` brugt af | **1 af 52** (FinancePage). Genopfundet fra bunden 6+ steder (Board ×5, Dashboard) |
| Delt tab-primitiv (`ui/Tabs`) | ~8 sider; mindst 6 sider håndruller egne tab-knapper uden ARIA |
| Radius-værdier ud over kanon (5/8/12px + pill) | `rounded` (4px), `rounded-[2px]`, `rounded-[3px]`, `rounded-md`, `rounded-lg` (dusinvis; TransfersPage: hele siden, RiderStatsPage: 28×), `rounded-full` |
| Samme rå skygge copy-pastet ordret | `shadow-[10px_0_16px_-16px_rgba(0,0,0,0.5)]` i **≥8 filer** (sticky navnekolonne) |
| Arbitrære micro-tekststørrelser | `text-[8px]`→`text-[13px]` overalt — de facto-konvention uden token |
| Emoji/unicode som UI-chrome (anti-slop-brud) | AdminSprintMetrics + AdminWaitlist (❌ ⬇ ↻ ⓘ), SeasonPlanner (✦), Board (✓!~○▲▼), RiderStats (✓/✕ i stedet for ikoner) |

## Hovedfund

### F1 — Der findes ingen side-skabeloner (rod-årsagen)
Grep bekræftet: **0** forekomster af `PageHeader`, `PageTitle`, `Section`, `PageContainer` eller `ContentWrapper` i hele `frontend/src`. Sidehoved-skelettet (`flex justify-between` → `h1 text-xl font-bold text-cz-1` + `p text-cz-3 text-sm`) er implementeret **~50 gange i hånden**. Alt andet i denne rapport er symptomer på dette hul.

### F2 — To design-generationer uden besluttet kanon
- **Gen 1 (app-standard):** `h1 text-xl font-bold text-cz-1` + subtitle — Dashboard, Board, Finance, Standings, Riders, m.fl. (~20 sider).
- **Gen 2 (editorial, #672-retningen):** `font-display text-[38px] leading-none` + `border-b-[1.5px] border-cz-1 pb-[10px]` headerbånd — KlubPage, SeasonPlannerPage, ScoutingCentralPage; beslægtede varianter på AcademyPage (`text-[38px]` uden border) og CalendarPage (`text-[2.75rem]` + eyebrow). **Fem sider, tre størrelses-fortolkninger.**
- **KitchenSinks "kanoniske" titel** (eyebrow + `font-display text-5xl`) bruges af **nul** rigtige sider.

De nyeste sider er editorial; de ældste er Gen 1. Uden en beslutning bliver kløften større for hver ny side.

### F3 — Container-anarki, styret to steder på én gang
`Layout.jsx:41-45` har en central `WIDE_CONTENT_ROUTES`-allowlist (max-w-full vs `max-w-6xl`), men siderne sætter derudover deres egen max-width (10+ varianter), nogle betinget af aktiv fane (TeamProfile, Transfers), og TeamProfile/Transfers har **redundante indre `max-w-4xl`** der kan drifte fra den ydre. TrainingPage og AcademyPage har slet ingen. Admin-siderne lægger som de eneste egen `p-4 sm:p-6` oven i Layouts gutter. Reelt behov: **3-4 skabelon-bredder**.

### F4 — `Card`-recipen håndkopieres med drivende padding
`bg-cz-card border border-cz-border rounded-cz` er skrevet i hånden på ~15 sider med paddings `p-4`, `p-5`, `px-5 py-4`, `px-4 py-3`, `py-[15px] px-[17px]`. ScoutingCentral har sin egen lokale `SectionCard`, ActivityPage sin egen lokale `EmptyState` (navnekollision med ui-komponenten).

### F5 — Fejltilstande er reelt udesignede
`ErrorState` findes i ui/ og demonstreres i KitchenSink, men bruges af 1/52 sider. Fundne mønstre: ≥5 forskellige håndrullede fejl-bannere (GlobalRank, Standings, Board, Auctions, Finance, RiderRankings, Transfers, Login…) og — værre — **tavs degradering** (Dashboard, Riders, RaceDetail, AuctionHistory: fetch-fejl → tom liste uden besked). `EmptyState` bruges konsekvent på ~40 % af siderne; resten håndruller centrerede ikon+tekst-blokke.

### F6 — Tabeller: 1 primitiv, ~20 håndrullede implementeringer
`ui/Table` bruges af ~5 sider. RidersPage og RiderRankingsPage er næsten identiske tabeller der løser sticky-kolonne, kolonne-skjulning og mobil-sortering **hver for sig**. Den delte sticky-skygge er copy-pastet råt i ≥8 filer. NOW.md's #1602-notat bekræfter: 40 filer med overflow-mønsteret, ingen delt responsiv tabel-løsning. RaceDetailPage og HallOfFamePage har tabeller **uden** overflow-wrapper (reel mobil-overflow-risiko).

### F7 — Radius-drift som største enkelt-synder i volumen
Kanon er `rounded-cz` (5px)/`rounded-cz-pill`. I omløb: 4px, 2px, 3px, 6px, 8px + `rounded-full`. Værst: TransfersPage (næsten alle knapper `rounded-lg`), RiderStatsPage (28× `rounded-lg`). Flere sider blander 2-3 radii internt (Standings, Team, TeamProfile, Watchlist).

### F8 — Micro-typografi uden token
`text-[9px]`/`text-[10px]`/`text-[11px]`… bruges så konsekvent til badges/labels at det er en de facto-konvention — men hver side vælger sin egen værdi (8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13). Kandidat: 1-2 rigtige tokens (`text-2xs` e.l.) + dokumenteret brug.

### F9 — Anti-slop-brud: emoji/unicode-chrome
AdminSprintMetrics + AdminWaitlist bruger **ingen** ui-komponenter og har ❌/⬇/↻/ⓘ som knap-indhold; SeasonPlanner har `✦`; Board bruger tekst-glyffer (✓!~○▲▼) i farvede cirkler; RiderStats bruger "✓"/"✕" hvor `CheckIcon`/`XIcon` findes. Brand-reglen er entydig: stroke-ikonsættet erstattede alle emoji.

### F10 — To status-token-familier
`bg-cz-{status}-bg` (Login, Profile) vs. legacy-alias `bg-cz-{status}-bg0/N` (Notifications, RiderCompare) for samme visuelle resultat. Alias'et er dokumenteret bagudkompatibilitet — brugen bør konvergeres.

## Positiv-listen (det der allerede ER verdensklasse)

- **0 rå hex-farver** i 52 sider — alt går gennem tokens.
- `PageLoader` bruges konsekvent (~90 % af data-sider) inkl. CLS-reservation.
- Admin-header-mønsteret (breadcrumb + h1 + subtitle) er 100 % identisk på 4 sider — bevis på at et delt mønster efterleves, når det findes.
- FinancePage, RacesPage, ResultaterPage, StaffOverviewPage og ProfilePage er tæt på fuldt on-system og kan bruges som referencesider.
- LandingPage/FounderSupporter er bevidst editorial (låst brand-retning) og skal IKKE tvinges ind i app-skabelonerne.

## Per-side-matrix

Header: **A** = `text-xl font-bold`+subtitle · **A−** = A uden subtitle · **E** = editorial/font-display · **Adm** = admin-breadcrumb · **iC** = titel inde i card · **Del** = delegeret til hero-komponent · **Auth** = centreret auth · **Mkt** = marketing-hero · **÷** = intet h1.
States L/E/F = loading/empty/fejl: ✓ = delt primitiv, h = håndrullet, ÷ = mangler.

| Side | Header | Container | Card | Tabel | L/E/F | Værste afvigelse |
|---|---|---|---|---|---|---|
| Academy | E (38px) | ingen (`space-y-6`) | ✓ Card | ✓ ui/Table | ✓/✓/✓ | eneste side m. ErrorState; badge `rounded` 4px |
| Activity | A | 4xl | håndrullet | liste | ✓/h/÷ | lokal dublet-`EmptyState` |
| AdminAttribution | Adm | 7xl+pad | ✓ Card | ✓ ui/Table | ÷/h/h | rå select/button |
| AdminRetention | Adm | 5xl+pad | ✓ Card | ✓ ui/Table | ÷/h/h | rå select/button |
| AdminSprintMetrics | Adm | 7xl+pad | håndrullet | rå, **uden overflow-wrap** | h/h/h | **0 ui-komponenter, emoji-chrome** |
| AdminWaitlist | Adm | 7xl+pad | håndrullet | rå + egen sort-header | h/h/h | **0 ui-komponenter, emoji-chrome** |
| AuctionHistory | A− | 4xl | ✓ Card | rå + delvis SortableTh | ✓/✓/÷ | blandet th-adoption |
| Auctions | A− | full | ✓ Card (tiles) | rå + sticky | ✓/÷/h | rå skygge ×2; malformet klasse `bg-cz-accent/10/40` |
| Board | A | 4xl | håndrullet ×10 | rå ×1 | ✓/h/h | 5× håndrullet progress-bar; unicode-glyffer |
| Calendar | E (2.75rem+eyebrow) | **[1100px]** / 4xl pr. gren | ingen | CSS-grid | ✓/✓/÷ | `rounded-[2px]`/`[3px]`; grid uden overflow-wrap |
| Dashboard | A | 6xl | ✓ Card-grid | lister | ✓/h/÷ | egen MiniBar; tavs fejl-degradering |
| Finance | A | 3xl | ✓ Card | rå ×1 | ✓/h/h | — (referenceside; eneste m. ProgressMeter + Tabs) |
| FounderSupporter | Mkt | pr. sektion | egen | ingen | –/–/– | bevidst editorial (ok) |
| GlobalRank | A | 5xl | ✓ Card | rå | ✓/✓/h | inline style-shadows; `rounded-lg` |
| HallOfFame | A | 4xl | håndrullet | rå ×3 **uden overflow-wrap** | ✓/h/÷ | ingen mobil-strategi |
| Help | A | 4xl | håndrullet | rå | ÷/÷/÷ | rå søge-input; `w-40`-sidenav uden mobil-fald |
| KitchenSink | E (5xl+eyebrow) | 5xl `<main>` | — | ui/Table (demo) | – | **kanon som ingen følger** |
| Klub | E (38px+border) | 3xl+pad | ingen | kort | ✓/✓/÷ | mest off-token typografi (arbitrære px overalt) |
| Landing | Mkt | pr. sektion | egen (skarpe hjørner) | ingen | –/–/– | bevidst editorial (låst retning, ok) |
| Login | Auth | max-w-sm centreret | ✓ Card | — | ✓/–/h | — (ren) |
| ManagerProfile | iC | 3xl | ✓ Card | ✓ ui/Table | ✓/✓/÷ | h1 inde i card |
| Notifications | A | 3xl | bare divs | kort-liste | ✓/✓/÷ | to filter-idiomer på samme side; `-bg0`-familie |
| PatchNotes | A | 2xl | håndrullet | accordion | h/h/h | hardcodet EN-titel, ternary-i18n, alt håndrullet |
| PrivacyPolicy ×2 | E (4xl) | dokument-card | egen `Section` | prosa | –/–/– | 3. h2-stil |
| ProUpgrade | E (4xl) | xl+pad | håndrullet | grid | ÷/–/h | ingen loading-gate på købs-side |
| Profile | A | xl | ✓ Card ×5 | formularer | ✓/–/h | — (referenceside) |
| RaceDetail | A+badge | 4xl | håndrullet | rå **uden overflow-wrap** | ✓/h/÷ | 2 overskrifts-opskrifter på samme side |
| RaceHistory | A | 4xl | håndrullet | lister | ✓/h/÷ | — |
| RacePoints | A | 4xl | ✓ Card | rå | ✓/h/÷ | `rounded-lg`+`rounded-full` mix |
| Races | A | 5xl | ✓ Card | ✓ ui/Table (2 faner) | ✓/✓/÷ | — (referenceside) |
| ResetPassword | Auth | max-w-sm centreret | ✓ Card | — | h/–/h | — (ok for auth) |
| Resultater | A | 4xl | blandet | lister | ✓/✓/÷ | reneste radius-side |
| RiderCompare | A | 4xl | håndrullet | CSS-grid | **÷**/✓/÷ | ingen loading-UI |
| RiderRankings | A | full | håndrullet | rå + sticky | ✓/h/h | 7× `rounded-lg`; rå skygge; dublet af RidersPage |
| RiderStats | Del | 5xl | delvis | delegeret | ✓/h/÷ | **28× `rounded-lg`**; "✓"/"✕" som tekst |
| Riders | A | full | ✓ Card | rå + sticky | ✓/h/÷ | rå skygge; bedste mobil-tabel (19 forks) |
| Roadmap | A | 2xl | håndrullet | lister | ÷/÷/÷ | `rounded-md` (unik 3. radius) |
| Rules | A | 4xl | håndrullet | rå | –/–/– | 4. h2-stil; `w-40`-nav uden mobil-fald |
| ScoutingCentral | E (38px+border) | 3xl+pad | egen `SectionCard` | kort | ✓/✓/÷ | eget editorial-subbrand; flest arbitrære px |
| SeasonEnd | A | 4xl | håndrullet | rå | ✓/h/÷ | inline token-styles; `text-[8px]` |
| SeasonFinanceReport | ÷ (delegeret) | 5xl+pad | delegeret | delegeret | – | tynd shell (ok) |
| SeasonPlanner | E (38px+border) | 6xl/3xl pr. state | håndrullet | delegeret | ✓/✓/÷ | `✦`-emoji; egen mikro-typeskala |
| StaffOverview | A | full+[1600px]-cap | ✓ Card | rå + sticky | ✓/✓/÷ | — (næsten referenceside) |
| StaffProfile | Del | 5xl+pad | ingen | delegeret | ✓/✓/✓ | intet h1 i selve siden |
| Standings | A | 4xl (fejl-gren: full) | ✓ Card | rå + sticky | ✓/✓/h | retry-knap `rounded-lg` vs. resten `rounded-cz` |
| Strategy | E (2xl) | 4xl+`px-3` | ingen | delegeret | h/✓/h | rå Spinner uden CLS-reservation |
| Team | A− (statlinje) | full | håndrullet | rå + sticky, **alle 15 kolonner altid** | ✓/h/÷ | rå skygge; `shadow-lg`-toast; ingen kolonne-skjulning |
| TeamProfile | iC | fane-betinget | håndrullet ×3 | rå + sticky | ✓/h/÷ | redundante indre max-w; tabs `rounded-lg` |
| Training | A− (action-række) | **ingen** | accordion-`<details>` | rå ×2 + sticky | h/h/÷ | ingen container; ingen loading-gate |
| Transfers | A | fane-betinget | håndrullet 4+ | kort + rå tabel | ✓/✓/h | **hele sidens knapper `rounded-lg`**; rå skygge |
| Watchlist | A | full+[1600px]-cap | håndrullet | rå + sticky | ✓/h/÷ | toast vs. banner-inkonsistens; `rounded-lg` CTA |

## Anbefalede kanoniske skabeloner (input til Claude Design)

Fire side-skabeloner dækker 49 af 52 sider (Landing/FounderSupporter/KitchenSink er bevidst uden for):

1. **Standard content page** — `max-w-4xl`; sidehoved (titel + subtitle + valgfri actions-cluster); sektioner som `Card` med én kanonisk header-recipe og én padding.
2. **Wide data page** — `max-w-full` + evt. `[1600px]`-cap på filterbar; delt responsiv tabel (sticky navnekolonne som utility, kolonne-skjulnings-prop, mobil-sortering); erstatter Riders/RiderRankings/Team/Watchlist/Transfers-market/StaffOverview-duplikaterne.
3. **Profil-/detaljeside** — hero-bånd (delegeret titel), fane-navigation via `ui/Tabs`, `max-w-5xl`; dækker RiderStats/StaffProfile/TeamProfile/ManagerProfile/RaceDetail.
4. **Auth/standalone** — centreret `max-w-sm`-card (Login/ResetPassword er allerede konsistente).

**Beslutning der SKAL træffes af ejer først: Gen 1 vs. Gen 2-sidehoved** (app-standard `text-xl font-bold` eller editorial Bebas + border-bånd) — det afgør udseendet af skabelon 1-3. Editorial-retningen er nyest og mest på brand; app-standarden er mest udbredt.

**Nye/opstrammede primitiver:** `PageHeader`, `Section`/`SectionHeader`, `DataTable` (responsiv, sticky), fejl-konvention (ErrorState + retry som standard for alle data-fetches), `text-2xs`-token, sticky-skygge-utility, konvergeret status-bg-familie.

## Migrationsbølger (efter skabelon-godkendelse i Claude Design)

1. **Bølge 0 — primitiver:** PageHeader/Section/DataTable + tokens + utilities (ingen visuel ændring endnu).
2. **Bølge 1 — mest sete spillerflader:** Dashboard, Standings, Team, Auctions, Races/RaceDetail (+ #2445-pladsudnyttelse tages samtidig pr. side).
3. **Bølge 2 — wide-table-konsolidering:** Riders/RiderRankings/Watchlist/Transfers/StaffOverview på delt DataTable (løser samtidig #1602-overflow-mønstrene).
4. **Bølge 3 — resten + off-system-sider:** Training (container!), PatchNotes (i18n!), Help/Rules (mobil-fald), ProUpgrade, admin-siderne (SprintMetrics/Waitlist re-basere på ui-komponenter, emoji → ikoner).

Hver bølge = separate PR'er med Playwright på alle 3 projekter + screenshots til ejer undervejs.

## Genbrug til andre spor

- **#2443 (menu/IA):** matrixens side-inventar + type-kolonne er leverance 1 i det issue.
- **#2445 (whitespace/1440p+):** container-beslutningen i skabelon 1-2 ER svaret på "ud til kant"-ønsket — tages sammen med bølge 1.
- **#1602 (mobil):** DataTable-konsolideringen i bølge 2 erstatter 2×duplikeret mobil-tabel-logik og de manglende overflow-wrappers (RaceDetail, HallOfFame, AdminSprintMetrics, Calendar).
