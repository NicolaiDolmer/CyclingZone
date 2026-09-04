# docs/design: designsystemet i Claude Design og handoffs

> Oprettet 2/9 2026 fordi ejeren spurgte "ved du ikke at vi har et designsystem i Claude Design?" og svaret var nej: intet i repoet nævnte det. Delt kontekst skal ligge i GitHub (hard rule i `AGENTS.md`), så her er det.

## Claude Design-projektet (findes, bruges)

| Felt | Værdi | Kilde |
|---|---|---|
| Projekt | **Cycling Zone design system** i claude.ai/design (design-system-projekt) | `design_handoff_page_templates/src-reference/Manager Page Templates.html:10-19` |
| Id (fra bundle-stier) | `cycling-zone-design-system-a332ec00-12d3-4aa5-9064-2fd004541e5d` | samme fil; `design_handoff_rider_profile/ProfileScreen.dc.html:15-19` |
| Global namespace i handoff-kilder | `window.CyclingZoneDesignSystem_a332ec` | `src-reference/tpl-shared.jsx:2` |
| Indhold (kendt fra handoff-kilderne) | tokens: `colors.css`, `typography.css`, `spacing.css`, `base.css` · komponenter brugt i templates: Button, Icon, StatusBadge, CategoryTag, Avatar, ProgressMeter, Select, Input, Checkbox, Tabs/TabList/Tab, Skeleton, EmptyState, ErrorState | `tpl-frames.jsx:2`, `tpl-mobile-states.jsx:2` |
| Hvad det er portet fra | `frontend/src/index.css`, `tailwind.config.js`, `frontend/src/components/ui/*` (håndportet i Claude Design, ikke synket via `/design-sync`) | `design_handoff_page_templates/README.md:4` |
| Sidst kendte opdatering | juli 2026 (rytterprofil-handoff, live 2/7; page templates besluttet 23/7, committet 25/7) | git-log på handoff-mapperne |
| Brugt til | rytterprofilen (#2000, `design_handoff_rider_profile/`), page templates (#2849, `design_handoff_page_templates/`), race-planning V3 (`race-planning-proposal/Main.dc.html`, tokens genbrugt) | mapperne |

**Verificeret 2/9 via DesignSync (efter `/design-login`):** projekt-id `a332ec00-12d3-4aa5-9064-2fd004541e5d`, type `PROJECT_TYPE_DESIGN_SYSTEM`, ejer Nicolai, sidst opdateret **20/8 2026**. Indhold: 4 token-filer, 10 komponent-filer der eksporterer 39 komponenter (Button, Card, Icon m. 47 ikoner, StatusBadge/CategoryTag/Chip, Avatar, ProgressMeter/Spinner/Skeleton/Divider/Link, Table/Tr/Th/Td/JerseyDot, Modal/Toast/Tooltip/Menu/EmptyState/ErrorState, Field/Input/Textarea/Select/Checkbox/Radio/Toggle, Tabs/PillTabs), 20 specimen-kort (brand, farver, spacing, type, komponenter), 2 UI-kits (manager-app: dashboard/standings/auctions · marketing-site), fonte og brand-marks, readme med brand-, indholds- og visuel guide, CLAUDE.md på dansk. **Strukturen er rigtig.** Det er et ægte designsystem-projekt, og `/design-sync` kan skrive til det.

**Drift mod koden (målt 2/9, projektet er frosset omkring 23/7 på disse punkter):**

| # | I projektet | I koden (kilde) | Konsekvens |
|---|---|---|---|
| 1 | `--text-2xs: 10px`, ingen `3xs` | `text-2xs` = 11 px, `text-3xs` = 10 px (`tailwind.config.js:31-32`, kanon 25/7) | Alle meta-labels tegnes 1 px for små; zone-piller og stat-labels har intet trin |
| 2 | `--success-bg: #dcfce7` (solid), samme for danger/warning/info | `rgba(21,119,47,0.08)` (8 % alpha, `index.css:168-171`, "one status surface" 25/7) | Zone-tints og status-flader afviger i farve |
| 3 | `--cz-chart-4: 251 191 36` | `245 158 11` (`index.css:16`, #2033 farveblindheds-fix) | Diagrammer |
| 4 | readme: "12px for data tables", `--radius-lg 12px` | ÉN radius 5 px overalt (`rounded-cz`, konvergeret 24/7) | Tabel-wraps tegnes forkert |
| 5 | `Table` uden `dense`/`compact`/`tight`, uden sticky første kolonne, uden zone-tints | `DataTable.jsx` har alle tre gutter-trin, `dense`, sticky, zone-recipe (#2906, 25/7) | T2-sider kan ikke tegnes tro |
| 6 | `--content-max 1152px` | T1 896 · T3 1024 · T2 1600 (`PAGE_TEMPLATES.md`, 23/7) | Container-bredder |
| 7 | Mangler: `PageHeader`, `Section`, `CollapsibleSection` (#3914), `SortableTh`, `PageLoader`, `AmountInput`, `BlockedNote`; domæne: `ScoutablePotentiale`/potentiale-bånd (#3683), rating-farveplade (15/8) | findes i `components/ui/` og `components/rider/` | Sidehoved-opskriften og fold-disciplinen findes ikke som komponent |
| 8 | `templates: []` i manifestet | T1/T2/T3 findes kun som handoff-HTML | Skabelonerne er ikke startpunkter i projektet |
| 9 | readme: "38-day season", "three divisions", "draft real-world riders"; `--div-1..3` | 4-divisions-pyramide 1/2/4/8, fiktive ryttere siden 20/6, ~30 dages sæson | Design-agenten tegner mod et forældet produkt |
| 10 | UI-kits dækker dashboard/standings/auctions | Akademi, træning (tre faner 20/8), Planning Center, rytterprofil findes ikke som kit-skærme | Nye briefs skal selv beskrive de sider |

Tokens for farver, sidebar, accent, `me`-markør, motion, z-index og fonte **matcher koden** og skal ikke røres.

**Sync-plan (til `/design-sync`, ejer kører kommandoen):** (a) tokens: typografi-trin 2xs/3xs, status-bg som alpha, chart-4, radius-konvergens, content-max pr. skabelon; (b) komponenter: `DataTable` erstatter `Table`, plus `PageHeader`, `Section`, `CollapsibleSection`, `SortableTh`; (c) domæne-kort: potentiale-bånd og rating-plade; (d) T1/T2/T3 som templates/startpunkter fra `design_handoff_page_templates/`; (e) readme-produktfakta rettes. Inkrementelt, én komponent ad gangen, aldrig wholesale replace.

## Regler

1. **`/design-sync` skal pege på DETTE projekt**, aldrig oprette et nyt. Verificér med `get_project` at typen er design-system før push. Synk er inkrementel, én komponent ad gangen.
2. **Nye designbriefs vedhæfter projektet** i stedet for at gentage tokens i prompten (briefen for ungdom: `youth-tiers/CLAUDE_DESIGN_BRIEF.md`).
3. **Ændrer koden en token, et typografi-trin eller en komponent-anatomi**, noteres det her under "Sidst kendte opdatering" når projektet er synket. Et designsystem der ikke følger koden er en parallel plan.
4. `PAGE_TEMPLATES.md` er stadig den normative tekst; projektet er pixel-referencen.

## Mapperne

| Mappe | Hvad | Status |
|---|---|---|
| `design_handoff_page_templates/` | T1/T2/T3 + states, artboards + `PAGE_TEMPLATES.md` | bindende, ejer-godkendt 23/7 |
| `design_handoff_rider_profile/` | rytterprofilen (T3-referencen) | live 2/7 (#2000) |
| `race-planning-proposal/` | V1/V2/V3 sæsonmatrix (`.dc.html` + `canvas.json`) | IA ejer-låst 21/8 (#1146) |
| `board-mandate-mockups/` | boardroom + årsmøde + medlem (`.dc.html`) | retning ejer-godkendt 1/9 (#3514) |
| `3721-traeningssidens-struktur/` | træningssidens tre faner | live 20/8 |
| `youth-tiers/` | akademi/junior/U23: brief, wireframes (runde 1-2), hi-fi (artboards 3a-3k) + `HANDOFF.md` med ejer-beslutninger | **hi-fi + handoff leveret 2/9 (#4617)**; regler indarbejdet i `YOUTH_RULES.md` §2.6; slice 0 = artboard 3b |
| `TASTE.md` | hvad verdensklasse er: 11 principper m. screenshots, genre-referencer, forbudsliste, dommer-tjekliste, otte ejer-valg (§6) | **bindende, ejer-godkendt 2/9** (#4623); slice 2 = #4624 |
| `klub/`, `mockups/`, `rider-page/`, `screenshots/`, `ELEVATION_2849.md` | ældre referencer | bevares (slet aldrig design-planer) |
