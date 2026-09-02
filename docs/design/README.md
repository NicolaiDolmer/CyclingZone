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

**Ikke verificeret 2/9:** projektets faktiske filliste og om det har fået de ændringer der er landet i koden siden juli (bl.a. `text-2xs`/`text-3xs`-kanon 25/7, rating som farveplade 15/8, `PotentialBand` #3683, `DataTable dense`, `CollapsibleSection` #3914, træningssidens tre faner 20/8). At læse projektet kræver `/design-login` i en interaktiv `claude`-terminal på denne maskine; derefter kan `DesignSync list_files` diffe mod `frontend/src/components/ui/` (36 komponenter i koden mod ~15 kendt brugt i handoffs).

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
| `youth-tiers/` | akademi/junior/U23-wireframes + brief | brief klar 2/9, wireframes afventer (#4617) |
| `klub/`, `mockups/`, `rider-page/`, `screenshots/`, `ELEVATION_2849.md` | ældre referencer | bevares (slet aldrig design-planer) |
