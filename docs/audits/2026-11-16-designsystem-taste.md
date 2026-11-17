# Designsystemet mod TASTE: gennemgang 16/11

**Dato:** 16/11 2026 · **Issues:** #8069 (samleopgave), #8070, #8076, epic #4622 · **Målestok:** [`docs/design/TASTE.md`](../design/TASTE.md) + [`PAGE_TEMPLATES.md`](../design/PAGE_TEMPLATES.md), inklusive reglerne fra 12/11 · **Forrige gennemgang:** [2/9 (#4624)](design-quality-audit-2026-09-head.md)

## Metode og grænser

- **Kode, ikke skærmbilleder.** Gennemgangen læser `frontend/src` (994 filer). `scripts/audit/8069-taste-scan.mjs` tæller kandidater pr. regel og følger importerne fra hver sides fil, uden om de delte `components/ui`- og `layout`-filer. Kandidaterne er derefter efterset linje for linje. Kun efterset fund står i rapporten. Scannerens tal for ikoner og tabular figures var for det meste falske positiver (pile i kommentarer, SVG-koordinater) og bruges ikke direkte.
- **Ikoner og emoji** er talt med de eksisterende CI-baselines (`scripts/anti-slop-baseline.json`, `scripts/ui-slop-baseline.json`), som allerede tæller pr. fil.
- **Trafik:** PostHog, sidevisninger de seneste 30 dage til 16/11, testkonti fraregnet. Dynamiske ruter (`/riders/:id`, `/races/:id`) er ikke lagt sammen. Den mest viste enkelte rytterprofil har 93 visninger, det mest viste løb 315, så det samlede tal er ukendt (ingen evidens; antagelse: begge ligger i top 10).
- **Ikke set i browser.** "Én guld pr. view" er talt statisk. Hvor to guld-knapper ligger i hver sin gren, faner eller modal, er det ikke talt som brud. Mørk tilstand er ikke dømt.

## Overblik

| Regel | Status i koden | Største kilder |
|---|---|---|
| Én gold primary pr. view | **13 håndrullede guld-knapper** (`bg-cz-accent text-cz-on-accent` på en `<button>`) i spillerflader. Dem kan hverken `TableRowContext`-vagten eller tællingen se | Transfers 4, Bestyrelsen 4, rytterprofilen 3 (+2 i budpanelet), CompareSelection, BoardEmptyState, OnboardingTour |
| Hairlines, ingen skygger | Skygger uden for overlays: 28 i baselinen, mest i modaler, der burde bruge `shadow-overlay`. **Én venstre-accent-bjælke** i en spillerflade | `RiderDevelopmentTab.jsx:326` (`border-l-2 border-l-cz-accent`), `StatsToggle.jsx:49` (`shadow-xl` på en dropdown) |
| 5 px radius | **57 × `rounded` (4 px)**, 24 × `rounded-sm` (2 px), 23 × `rounded-[Npx]` i spillerflader. `lint-ui-slop` fanger kun `md`/`lg`/`xl`, ikke den rene `rounded` | `RiderTypeBadge.jsx` (vises på næsten alle tabeller), TeamPage 6, RiderStatsPage 6, DashboardPage 4 |
| Tabular figures | Kittet er sundt (`DataTable`, `HeroStats`, `font-data`). Risikoen ligger i **27 håndrullede `<table>`** i spillerflader mod 33 `DataTable`-kald | Lånevilkår på Økonomi (`FinancePage.jsx:941-942`, procenter i DM Sans uden tabular) |
| Stroke-ikoner | Kode: få rester (unicode-pile i `BoardPage` 3, `TeamPalmaresTab` 2, `ContextBand` 2, `StaffSwitcherBar` 2; tekst-glyffer som evne-ikoner i `abilityRegistry.js`). **Copy: emoji i spillervendte tekster** | `rider.json` 18, `transfers.json` 14, `backendMessages.json` 6, `board.json` 2, `watchlist.json` 1 (⭐ i tom tilstand) |
| Ingen egne sidehoveder/containere | **5 sider** med eget sidehoved eller egen bredde. **3 sider** med en boks mellem hovedet og indholdet (regel 3 fra 12/11) | Se tabellen nedenfor |

Bebas (P4) brydes på rytterprofilen: 5 faner bruger `font-display` som kort-titel (`text-[17px]`, uppercase) i stedet for kortets 15/600.

## Sider efter trafik

| # | Side | Visninger (30 d) | Fund (efterset) | Alvor |
|---|---|---|---|---|
| 1 | Dashboard `/dashboard` | 12.038 | Container `max-w-5xl` (1024 px), men siden er hverken T3 eller T1 (896) (`DashboardPage.jsx:342, 531`). 4 × `rounded` 4 px. `RacePausedBanner` står i indholdet ved pause (betinget; regel 3 skal afgøre, om en driftsbesked er et banner) | Mellem |
| 2 | Indbakke `/notifications` | 11.277 | T1 og `PageHeader` er i orden. `swapPrimary` bruger `↔` i copy, og notifications.json har 1 emoji. Ellers rent | Lav |
| 3 | Mit hold `/team` | 5.410 | 6 × `rounded` 4 px i siden, 2 i `RiderTypeBadge`. ContractsTab er en håndrullet tabel | Lav-mellem |
| 4 | Planlægning `/planning` | 2.714 | **`SelectionDeadlineReminder` er en boks mellem `PageHeader` og fanerne** (`PlanningHubPage.jsx:140`), stik imod regel 3. `SeasonPlannerPage` har egen container `max-w-6xl` (3 ×). `ContextBand` har 2 unicode-pile. `SeasonView` bruger `rounded-sm` | **Høj** |
| 5 | Træning `/training` | 2.379 | `rounded` 4 px i `RaceSourceTable`, `TrainingTodayTable`, `TrainingTeamTableB` (håndrullede tabeller) | Lav |
| 6 | Auktioner `/auctions` | 2.332 | **`AuctionsFirstBidHint` står mellem hovedet og `FilterBar`** (`AuctionsPage.jsx:1591`). Selve tabellen er håndrullet, så D-047 og tabular skal holdes i hånden | Mellem |
| 7 | Trupper `/squads/u23` + `/junior` | 2.298 | Arver `RiderTypeBadge`-radius. Ellers på skabelon | Lav |
| 8 | Patch notes | 2.160 | Rent | - |
| 9 | Ryttere `/riders` | 1.606 | `CompareSelection` har en håndrullet guld-knap og en skygge. `StatsToggle` har `shadow-xl` | Mellem |
| 10 | Stillinger `/standings` | 1.381 | Den valgte sammenlign-knap er **fyldt guld** (`StandingsPage.jsx:563`). P3 kræver guld-tekst på 10 % guld som aktiv tilstand. Legendens firkanter bruger `rounded-sm` | Mellem |
| 11 | Forum | 1.190 | 3 `primary` i siden. Ikke efterset, om de kan stå samtidigt | Lav |
| 12 | Akademi | 1.096 | På skabelon. 2 `primary`, ikke efterset, om de kan stå samtidigt | Lav |
| 13 | Økonomi `/finance` | 971 | **Eget sidehoved** (`<h1>`, `FinancePage.jsx:549`) og **egen bredde** `max-w-3xl` (768 px, `:545`) i stedet for `PageHeader` og T1 896. `FinanceFirstVisitHint` står under hovedet. Lånevilkårs-tabellen er håndrullet og uden tabular | **Høj** |
| 14 | Transfers | 918 | **4 håndrullede guld-knapper** i tilbudskortene (`TransfersPage.jsx:385, 557, 725, 771`) plus 3 `Button primary`. 14 emoji i toasts og mærker ("✅ Offer sent!", "🚨 Below minimum", "🎉") | **Høj** |
| 15 | Scouting | 917 | **Eget `<h1>` og Bebas-korttitler** (`text-[21px]`, `ScoutingCentralPage.jsx:50, 59`), ingen `PageHeader` | Mellem |
| 16 | Klub | 536 | **Eget Bebas-sidehoved** 38 px (`KlubPage.jsx:63, 128`), ingen `PageHeader` | Mellem |
| 17 | Bestyrelsen | 475 | **4 håndrullede guld-knapper** (`BoardPage.jsx:1958, 2057, 2071, 2146`), guld-fyldt trin i guiden (`:3012`), 3 unicode-pile i siden og 15 i board.json, emoji "🔒 Tightened" og "✍" | Mellem |
| - | Rytterprofil `/riders/:id` | ukendt (sum) | 3 + 2 håndrullede guld-knapper i salgs-, bytte-, tilbuds- og budpanelerne (`RiderStatsPage.jsx:203, 279, 570, 705, 926`). **Bebas som korttitel i 5 faner** (Palmarès 6, Træning 6, Fysiologi 4, Scouting 4, Udvikling 3). **Venstre-accent-bjælke** (`RiderDevelopmentTab.jsx:326`). 18 emoji i rider.json ("⚡ Active auction", "👁", "🔒", "❌"). Bredden er 896/1024 px, men fanerne har tabeller (regel 1: T3 bred) | **Høj** |
| - | Løbsside `/races/:id` | ukendt (sum) | Den nuværende side er T3 1024 px. v6 (1600 px, bag slukket kontakt) har sine egne fund på #7778 (15/11). Ingen nye fund her. Bemærk: med v6 tændt står guld-knappen i heroen (`V6RaceHeroCard.tsx:48`) og i etapefanen (`StageTabV2.tsx:239`). Tæl dem på skærmbilledet, før v6 tændes | Følg #7778 |

## Kit-fund (rammer 3 eller flere sider, rettes ét sted)

1. **`RiderTypeBadge`, `TeamCell`, `statColor`**: `rounded` 4 px i stedet for `rounded-cz`. Én rettelse løfter alle rytter-tabeller.
2. **Håndrullet guld**: 13 steder. Vagten mangler: `check-anti-slop.mjs` bør få kategorien `goldbtn` med ratchet-baseline, så nye ikke kommer til.
3. **Ren `rounded`** fanges ikke af `lint-ui-slop.mjs`. Udvid reglen med baseline.
4. **Bannere og første-besøgs-tip over indholdet** (Planlægning, Auktioner, Økonomi) er det samme mønster. Fristen skal over i `PageHeader`'s handlingsrække, tip i rundvisningen.
5. **Emoji i locale-copy** er talt i baselinen, men aldrig ryddet. Toasts har deres egen ikonplads (`toastStyles`), så emojien er dobbelt.

## De 10 vigtigste rettelser i anbefalet rækkefølge

Rækkefølgen er trafik × hvor tydeligt bruddet er × hvor mange sider én rettelse rammer. Kit før sider. Hver rettelse er sit eget issue og sin egen PR med ét annoteret før/efter-billede (NOW-reglen). Ingen af dem er bygget her.

| # | Rettelse | Sider | Hvorfor nu | Kanal |
|---|---|---|---|---|
| 1 | Fristboksen på Planlægning flyttes ind i `PageHeader`'s handlingsrække som én linje ("Frist om 12 t") | Planlægning (2.714) | Klart brud på ejer-reglen fra 12/11; samme mønster bliver kopieret til den nye planlægningsside (#7535) | Claude Code |
| 2 | Håndrullede guld-knapper til `Button`/`buttonClass({ variant: "primary" })` + ny CI-kategori `goldbtn` med ratchet | Rytterprofil, Transfers, Bestyrelsen, Ryttere | Gør "én guld pr. view" målbar overhovedet; ingen visuel ændring, kun primitiv | Claude Code |
| 3 | `rounded` → `rounded-cz` i `RiderTypeBadge`, `TeamCell`, `statColor` + lint for ren `rounded` | Mit hold, Trupper, Ryttere, Auktioner, Træning, Planlægning | Ét kit-sted, rammer 6 af de 10 mest besøgte sider | Claude Code |
| 4 | Dashboard: vælg bredde efter regel 2 (anbefaling: T1 896, siden er kort, ikke tabeller) + 4 × `rounded` | Dashboard (12.038) | Mest besøgte side; breddevalget er ejerens (#8073, én side ad gangen) | Ejer-valg → Claude Code |
| 5 | Rytterprofilen: Bebas-korttitler i 5 faner → kortets 15/600-titel; venstre-bjælken væk | Rytterprofil | P4 og §3-forbud, alle profiler | Claude Code |
| 6 | Emoji ud af spillervendt copy (rider, transfers, backendMessages, board, watchlist ⭐ → stroke-ikon), EN først | Rytterprofil, Transfers, Indbakke, Bestyrelsen | Baselinen findes; dette er oprydningen | Claude Code (copy-review: ejer) |
| 7 | Økonomi: `PageHeader` + T1 896 + lånevilkår i `DataTable` + tip i rundvisningen | Økonomi | Tre brud på én side | Claude Code |
| 8 | Klub og Scouting: eget Bebas-sidehoved → `PageHeader` | Klub, Scouting | P4 + "ingen egne sidehoveder" | Claude Code |
| 9 | Stillingers sammenlign-knap og Bestyrelsens guide: fyldt guld → P3's aktiv-tilstand; `StatsToggle`/`CompareSelection` → `shadow-overlay` | Stillinger, Bestyrelsen, Ryttere | Guld uden for de fire tilladte steder | Claude Code |
| 10 | Første-besøgs-tip ud af toppen på Auktioner (og Økonomi i #7): over i rundvisningen | Auktioner | Regel 3 fra 12/11 | Claude Code |

Herefter: T3 bred (1600 px) for rytter- og holdprofilen (regel 1, fanerne har tabeller) og flytning af de håndrullede tabeller til `DataTable` i trafikorden. Begge er side-for-side-arbejde under #8073 med ejer-billede pr. side.

## Hvad gennemgangen ikke dækker

- Chrome-højden i px (spørgsmål 2) og fold-disciplinen kræver skærmbilleder. Det er #8073/#8074's billedvagt.
- Mørk tilstand, mobil-geometri (D-047) og 44 px-trykflader er ikke målt her.
- Copy-reglen "Gemt" (regel 5): "bekræftet" i locales bruges kun om to parters bekræftelse af en handel og om e-mail-bekræftelse, ikke om at gemme. Ingen fund, men ingen fuld copy-gennemgang.
