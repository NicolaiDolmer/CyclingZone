# WP5 — editorial per-flade build-spec (det "rigtige design")

> **Etableret:** 2026-06-21
> **Ejer:** Nicolai Dolmer Mikkelsen
> **Issues:** [#1590](https://github.com/NicolaiDolmer/CyclingZone/issues/1590) (WP5) · del af [#1576](https://github.com/NicolaiDolmer/CyclingZone/issues/1576) (AI-slop-program) · [#1577](https://github.com/NicolaiDolmer/CyclingZone/issues/1577)-audit
> **Status:** DRAFT — afventer ejer-review + greenlight. DOCS-ONLY (intet kode rørt).
> **Bygger på:** [`2026-06-14-design-system-foundation-design.md`](2026-06-14-design-system-foundation-design.md) (regelbogen) + [`2026-06-15-ui-foundation-plan4-rollout.md`](../plans/2026-06-15-ui-foundation-plan4-rollout.md) (migrér-per-flade-arbejdsmodellen).
> **Kilde-audit:** [`docs/audits/2026-06-20-ai-slop-findings.json`](../../audits/2026-06-20-ai-slop-findings.json) — 57 fund i kategorierne `generic-lazy-layout` (24), `uniform-card-grid` (14), `centered-everything` (6), `accent-tint-overuse` (13).

---

## 0. Hvad dette dokument ER og IKKE er

WP0–WP6 deler AI-slop-arbejdet i bølger. De **mekaniske** bølger er landet: WP0 (token-lås — `rounded-xl/2xl/3xl` + `backdrop-blur` er allerede no-ops, [#1578](https://github.com/NicolaiDolmer/CyclingZone/issues/1578)), WP1/WP2 (emoji→ikon + farve-/radius-sweeps), WP3 (public-flader: FounderSupporter/Privacy/Confetti, [#1588](https://github.com/NicolaiDolmer/CyclingZone/issues/1588)), WP4 (Board-modaler→Modal-primitiv, [#1589](https://github.com/NicolaiDolmer/CyclingZone/issues/1589)), WP6 (copy-slop, [#1591](https://github.com/NicolaiDolmer/CyclingZone/issues/1591)).

**WP5 er resten — den der kræver design-dømmekraft, ikke find-erstat.** "Tre ens centrerede KPI-kort" har ingen mekanisk fix; nogen skal beslutte *hvilken* metrik der bærer vægten og *hvordan* hierarkiet ser ud. Dette dokument gør hver sådan beslutning konkret og review-bar, så ejeren kan godkende retningen FØR en flade migreres. Hvor der er en ægte design-fork, er den markeret **[EJER-VALG: A vs B]** med benefit/cost — ikke et mandat.

Dette er en **spec**, ikke en plan. Når en flade er greenlit, skrives dens implementerings-slice ind i et Plan-4-lignende dokument og køres som én PR.

---

## 1. Mål + ikke-mål

### Mål — målet-feel (anker: `StandingsPage.jsx`)

Ankeret for "sådan ser en on-brand CZ-flade ud" er **`StandingsPage.jsx`** (konsoliderings-hub'en efter [#1644](https://github.com/NicolaiDolmer/CyclingZone/issues/1644)). Den demonstrerer de editoriale greb WP5 skal sprede:

- **Hairline-tabel inde i `<Card>`** (`StandingsPage.jsx:369` — `<Card className="overflow-hidden">` om tabellen), ikke fritflydende kort-grids.
- **Venstrejusteret struktur**, tabulære tal højre-stillet (`font-mono`/`font-data` + `tabular-nums`, fx `:482-487`).
- **Ægte cykel-data-feel:** zone-bånd via `inset`-box-shadow (promotion/relegation, `:423-426`), leder-chip (`LeaderBadge`, `:466`), online-prik via `bg-cz-success` (`:461-463`), mini-progress-bar pr. række (`:472-474`), MiniSparkline-progression (`:499`).
- **Token-drevet farve:** division-markør holdt inden for guld+navy via `divColor()`/`DIV_VARS` (`:22-26`) — ingen fremmede hues, ingen rå hex-alpha.
- **Hierarki via vægt/luft/position**, ikke via en accent-tint-baggrund på alt.

> **Vigtigt — ankeret er ikke perfekt:** StandingsPage bærer selv to rest-slop-tells WP5 skal undgå at kopiere: linse-switch + compare-knap bruger stadig `bg-cz-accent/10 text-cz-accent-t`-pille-stil (`:342-358`) i stedet for underline-tabs, og `<h1 className="text-xl font-bold">` (`:312`) er DM-Sans-body, ikke Bebas-display. Brug ankerets **tabel + data-feel + token-disciplin** som forbillede, ikke dens tab-pills/h1. Den fuldt rene reference for primitiv-brug er `frontend/src/components/ui/` selv + den allerede-migrerede Finance-flade ([Plan-4 "Finance-fladen"](../plans/2026-06-15-ui-foundation-plan4-rollout.md)).

Regelbogens egen formulering (DEL-A A9): **foretræk** editorial hairline-layouts · stor kondenseret Bebas (`font-display`) · ægte cykel-data (resultat-lister, tidsgab, trøjefarver gul/grøn/prik) · masser af luft · 2-farvet guld `#e8c547` + navy · INGEN glow/gradient.

### Ikke-mål — slop-tells WP5 fjerner (men ikke gold-plater)

- **Tell #6 centreret-alt:** `text-center` på hero + hver sektion-header + KPI-tal. (NB: `EmptyState`-primitivens bevidste center-align er IKKE slop — den er spec'et sådan i `EmptyState.jsx:8`.)
- **Tell #7 ens kort-grids:** `grid grid-cols-N` med N visuelt identiske kort uden vægtning.
- **Tell #8 accent-tint som eneste design:** `bg-cz-accent/10 ... border-cz-accent/30` genbrugt på tabs+badges+chips+bannere+rækker så intet skiller sig ud — guldet udvandes.
- **Tell #12 doven/genopfundet:** hånd-rullede tabeller/spinnere/empty-states/modaler i stedet for de færdige primitiver (`Table`, `Spinner`, `EmptyState`, `ErrorState`, `Modal`, `ProgressMeter`, `Tabs`).

**Ikke-mål (scope-disciplin):** WP5 ændrer IKKE adfærd/data/queries — kun præsentation (samme regel som hele Plan-4: "ingen adfærdsændring, kun UI"). Vi laver ikke nye features under dække af et redesign. Em-dash/copy/emoji-i-tekst hører til WP6/WP1 — rør dem kun hvis de står i en blok der alligevel omskrives.

---

## 2. Prioritering

Front-loadet efter audit-score (antal + severity) × trafik. Bemærk: **SeasonPreview og HeadToHead er droppet** — de blev foldet ind i Standings-hub'en ([#1644](https://github.com/NicolaiDolmer/CyclingZone/issues/1644), merged) og er nu rene redirects (`App.jsx:184-185`: `season-preview → /standings?view=strength`, `head-to-head → /standings?compare=1`). Deres 6 fund er døde og medregnes ikke.

| # | Flade | WP5-fund | Tyngde | Trafik | Effort |
|---|---|---|---|---|---|
| 1 | **HallOfFame** | 2 (+ delte tab/spinner/empty-tells) | M | Høj (offentlig prestige-flade) | M |
| 2 | **Activity** | 2 | M | Høj (in-app daglig) | M |
| 3 | **RiderStats** | 2 | L | Høj (kerne-flade, evne-visning #1529) | L |
| 4 | **PatchNotes** | 1 | M | Mellem (versions-checket changelog) | M |
| 5 | **Board** | 2 | M | Mellem (bestyrelses-wizard) | M |
| 6 | **RaceDetail** | 3 | M | Høj (resultat-flade) | M |
| 7 | **Resultater** | 3 | M | Høj (hub + top-lister) | M |
| 8 | **Academy** | 3 | L | Mellem (scouting) | L |
| 9 | **Auctions** (AuctionHistory) | 2 | M | Høj | M |
| 10 | **RacePoints** | 2 | M | Mellem (trøje-point-flade) | M |
| — | **Dashboard / Help** | 0 editorial-fund | — | Meget høj | (kun emoji, WP1/2 — se §3.11) |

**Lavere-prioritet ("resten sweepes"):** TeamProfile, TeamPage, Teams, ManagerProfile, Profile, Watchlist, Roadmap, RaceHistory, Training, RiderRankings, DeadlineDayBoard, SeasonEnd, Races, SeasonFinanceReportPanel, CompareSelection, RidersPage-tint-cluster, landing-form-tints. Behandles i §3.12 som batch-mønstre frem for fuld per-flade-prosa.

---

## 3. Per flade

Format pr. flade: **(a)** fund (fil:linje + hvad er slop) · **(b)** konkret behandling med citerede primitiver/tokens · **(c)** evt. `[EJER-VALG]` · **(d)** effort (S/M/L) + snapshot-refresh-behov.

> **Tre delte mønstre løses ÉN gang og genbruges på tværs af flader** (ratio: ~9 af de 12 flader bærer mindst ét):
> - **PILL-TAB → UNDERLINE-TAB:** erstat `px-3 py-1.5 rounded-lg ... bg-cz-accent/10 text-cz-accent-t border-cz-accent/30` med `tabClass()`/`tabListClass()` fra `tabsStyles.js` (eller `<Tabs>`). Giver `border-b-2 border-cz-accent text-cz-1` aktiv / `border-transparent text-cz-3` inaktiv + a11y (rolle/pil-nav). Ramt på: HallOfFame, RiderStats, AuctionHistory, RaceDetail, Board, TeamProfile, Activity.
> - **HÅND-SPINNER → `<Spinner>`:** erstat `w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin` med `<Spinner size={24} />`. Ramt på: HallOfFame, RaceDetail, HeadToHead(død), m.fl.
> - **HÅND-EMPTY → `<EmptyState>`:** erstat lokale `text-center py-14` + glyf-ikon-empties med `<EmptyState icon={<SVG/>} title=… description=…>`. Ramt på: Activity, HallOfFame, Watchlist, RiderStats (`◆`-glyf).

### 3.1 HallOfFamePage (`frontend/src/pages/HallOfFamePage.jsx`, 296 l.)

**(a) Fund:**
- Hånd-rullede pill-tabs `:133-138` (`rounded-lg bg-cz-accent/10 ... border-cz-accent/30`) — afviger fra kanonisk underline-tab + mangler tablist-a11y.
- Hånd-spinner `:115`.
- `◉`-glyf som empty-state-"ikon" (`:150-153`, `:249-254`) + ad-hoc centreret tekst i stedet for `EmptyState`-primitiv.
- Rå `<table>` i records/managers-tab (`:157`, `:195-203`) med flad `font-medium text-xs`-header i stedet for `Table`/`Th`/`Td` (`cellClass`: `font-data text-[11px] uppercase tracking-[.1em]`).

**(b) Behandling:**
- Tabs → `tabListClass()`/`tabClass()`. Ét delt fix.
- Spinner → `<Spinner size={24} />`; empties → `<EmptyState icon={<TrophyIcon/>} title=… />`.
- Records- + managers-tabellerne → `Table`/`Tr`/`Th numeric`/`Td numeric` så de arver det editoriale uppercase-data-header-mønster og tabular højre-stilling.
- **Bevar det der allerede er on-brand:** kategori-headeren `:148` har allerede en guld-keyline (`border-l-[3px] border-l-cz-accent`) + SVG-ikon — det er præcis regelbogens `section`-fingeraftryk. Behold.

**(c) [EJER-VALG: A vs B] — top-1-fremhævning i records.** Records-tabellens nr. 1 markeres i dag kun med guld-tekst (`:162-163`).
- **A (anbefalet):** giv nr. 1 en editorial podie-affordance — `PodiumIcon`/guld-`JerseyDot` + større `font-display`-tal — så rekordholderen læser som "vinder", ikke bare øverste række. *Benefit:* ægte cykel-data-feel, matcher StandingsPage's leder-chip. *Cost:* M-arbejde pr. kategori-tabel.
- **B:** lad det blive ved guld-tekst. *Benefit:* nul ekstra arbejde, stadig læsbart. *Cost:* misser prestige-fladens chance for et hero-øjeblik.

**(d)** Effort **M**. Snapshot: `hall-of-fame.png` hvis dækket — refresh alle 3 projekter (tab-stil + tabel-header skifter synligt).

### 3.2 ActivityPage (`frontend/src/pages/ActivityPage.jsx`, 670 l.)

**(a) Fund:**
- Lokal `EmptyState` (`:97-105`) m. `text-4xl`-glyf-ikon + DM-Sans-titel — duplikerer den token-bevidste `ui/EmptyState` (font-data uppercase tracking).
- Lokal `SectionHeader`/`Row` (`:88-95`, `:108`) + rå tab-bar (`:289-307`) uden `role=tablist`/keyboard-nav + rå badge-spans (`:104`/`:555`) i stedet for `StatusBadge`/`Chip`.

**(b) Behandling:**
- Lokal `EmptyState` → delt `ui/EmptyState` m. SVG-ikon-node.
- Tab-bar → `<Tabs>`/`tabListClass`.
- Badge-spans → `StatusBadge`/`Chip` (de mapper tone→token; `LOAN_STATUS`-map `:79-86` bruger allerede semantiske tokens korrekt — flyt mapping ind i `StatusBadge tone=…` frem for rå class-streng).
- **Behold den kompakte `Row`** (`:108-128`) — den er tæt, editorial og bærer beløb som `font-mono`-tal højre-stillet. Kun dens badge-span + indre `RiderLink` strammes; selve række-densiteten er on-brand (matcher StandingsPage-rækken).

**(c)** Ingen ægte fork. Mekanisk-tæt på, men kræver dømmekraft i hvilke badges der er `StatusBadge` (semantisk state: pending/active/rejected) vs. `Chip` (neutral kategori). [antagelse] de fleste er state → `StatusBadge`.

**(d)** Effort **M**. Snapshot: `activity.png` hvis dækket — refresh (empty-state + tab-stil + badge-typografi skifter).

### 3.3 RiderStatsPage (`frontend/src/pages/RiderStatsPage.jsx`, 1963 l.)

**(a) Fund:**
- Pill-tabs `:1585-1592` (`rounded-lg bg-cz-accent/10 ... border-cz-accent/30`).
- **Accent-tint overbrugt på ~10 ikke-relaterede element-typer** (aktiv tab `:1586`, action-knapper `:252/344/432/604`, badges `:684/1490/1806`, pending-chip `:1479`, beta-chip `:1511`, række-highlight `:1796`) + **rå hex `border-[#e8c547]/25`** (`:252/344/432/604`) uden for token-systemet.
- **15 identiske `StatRow`-progress-bar-rækker** (`:1608-1621`, `DERIVED_ABILITIES.map`) + `◆`-glyf potentiale-row-ikon (`:1601`) — ingen gruppering selvom kategorierne (Fysiske/Tekniske/Taktisk-mentale) findes i kode-kommentar `:135-141` men ikke vises.

**(b) Behandling:**
- Tabs → `tabClass()`. Erstat alle `border-[#e8c547]/25` → `border-cz-accent/25` (token). Reservér fyldt accent-tint til ÉT semantisk niveau (fx "du fører/aktiv auktion"); differentiér badges via `StatusBadge` tone-tokens og række-highlight via `bg-cz-subtle`.
- Stats-fanen: gruppér de 15 evner under de tre eksisterende kategori-headings (genbrug guld-keyline-`section`-stil). `◆`-glyf → SVG-ikon.

**(c) [EJER-VALG: A vs B] — top-stat-fremhævning.** De 15 evner vises i dag som 15 visuelt ens `rounded-full`-bars.
- **A (anbefalet):** gruppér under kategori-headings + fremhæv rytterens **top-3 evner** editorialt (større tal / guld-keyline) så profilen får et fokus. Brug `<ProgressMeter>` (hairline-track, reduced-motion-aware) i stedet for de hånd-rullede `rounded-full`-bars, med skarp/hairline radius. *Benefit:* fladen læser som en scouting-profil med karakter, ikke en uniform bar-liste; binder til design-systemet. *Cost:* L — det er fladens vigtigste fane og rører meget JSX.
- **B:** behold flad liste, kun gruppér + skift til `ProgressMeter`. *Benefit:* mindre arbejde, stadig en forbedring. *Cost:* misser "hvad er denne rytter god til på 1 sekund"-aflæsningen.

**(d)** Effort **L**. Snapshot: refresh hvis rider-stats er i en core-smoke-rute; ellers Playwright-mock-verify begge temaer.

### 3.4 PatchNotesPage (`frontend/src/pages/PatchNotesPage.jsx`, 225 l.; data i `frontend/src/data/patchNotes.js`)

**(a) Fund:**
- Accordion-kort: åben-state markeret kun med `border-cz-accent/30` (`:129-130`) + accent/10-version-pille (`:144`) + kategori-chips m. `bg-cz-accent/10 ... border-cz-accent/30` (`:107`). Accent-tint er den eneste "design"-gestus på en stak ellers identiske kort; ingen versions-tidslinje/hairline-rytme. (Audit-finding citerede "linje 7655" — det er en bundle-artefakt; den reelle kilde er `PatchNotesPage.jsx:96-174`.)

**(b) Behandling:**
- Erstat accent/30-border-trick som åben-markør med en **venstre hairline-accent-rail** (`border-l-2 border-l-cz-accent` på åben dag) — samme keyline-sprog som HallOfFame's kategori-header og regelbogens `section`-token. Holder guldet betydningsfuldt (markerer "her er du") frem for en tint-vask.
- Kategori-prikker (`new`/`improved`/`fixed`, `:111`/`:168`) bruger allerede `meta.dot`-tone-tokens — behold; men ret kategori-FILTER-knapperne `:105-107` til neutral `cz-subtle`/`cz-border` med en lille tone-prik, så accent-tint ikke er default-badge.

**(c) [EJER-VALG: A vs B] — changelog-struktur.**
- **A (anbefalet):** byg en venstre **versions-rail/tidslinje** (tynd vertikal hairline med dato-noder) så changelog'en får editorial retning i stedet for en stak ens kort. *Benefit:* matcher "stor kondenseret + ægte struktur"-DNA; datoer i `font-data tabular`. *Cost:* M — ny layout-komponent.
- **B:** behold accordion-stakken, men giv hver dag-header en `font-display`-dato + hairline-divider mellem dage. *Benefit:* let, bevarer kendt interaktion. *Cost:* stadig "stak af kort", bare pænere.

**(d)** Effort **M**. Snapshot: refresh hvis patch-notes er i smoke-ruten.

### 3.5 BoardPage (`frontend/src/pages/BoardPage.jsx`)

**(a) Fund:**
- **Centreret-alt wizard-hero** i alle 3 trin (`:1558-1563`, `:1674-1677`, `:1755-1762`): rundt `accent/10`-ikon-badge + centreret titel/undertitel — arketypisk "AI onboarding-modal", gentaget identisk.
- **Accent-tint overbrugt** på bannere/badges/pills (`:1303/1486/2429/2446/2460` bannere, `:1575/1583` wizard-valg, `:2354-2356` fane-pills, `:419` chip).

**(b) Behandling:**
- Venstrestil wizard-headeren: kondenseret `font-display`-trin-titel + sekundær label + et lille SVG-step-ikon (drop den centrerede emoji/glyf-i-cirkel). Lad type-skala bære hierarkiet, ikke center-align.
- Fane-pills `:2354-2356` → `tabClass()`. Reservér accent-fill til få ægte-vigtige states (udløbet plan / aktiv CTA); info-bannere → hairline `border-cz-border` + `bg-cz-subtle`.
- **NB WP4-overlap:** Board-modalerne er allerede migreret til `Modal`-primitiven ([#1589](https://github.com/NicolaiDolmer/CyclingZone/issues/1589), merged) — rør ikke dem; WP5 er kun wizard-layout + tint-disciplin.

**(c) [EJER-VALG: A vs B] — wizard-step-indikator.**
- **A (anbefalet):** venstrejusteret "Step 2 / 3"-progress-rail (hairline + udfyldte noder) frem for centreret badge. *Benefit:* editorial, viser fremdrift. *Cost:* M.
- **B:** behold center men drop ikon-cirklen + skift til `font-display`-titel. *Benefit:* let. *Cost:* stadig center-skabelon.

**(d)** Effort **M**. Snapshot: `board.png` — refresh (wizard-layout skifter synligt).

### 3.6 RaceDetailPage (`frontend/src/pages/RaceDetailPage.jsx`, 433 l.)

**(a) Fund:**
- `TabButton` pill-tabs `:248-256` (`rounded-lg bg-cz-accent/10 ... border-cz-accent/30`).
- Hånd-rullet `ResultTable` `:370-422` — rå `<table>`, blandet celle-padding (`px-4/px-2/px-3`), `font-semibold`-header i stedet for `Table`/`cellClass`.
- Hånd-spinner `:165-169`.

**(b) Behandling:**
- Tabs → `tabClass()`. Spinner → `<Spinner>`.
- `ResultTable` → `Table`/`Th numeric`/`Td numeric`; ensret padding via `cellClass`; uppercase data-header.

**(c) [EJER-VALG: A vs B] — trøje-data i resultater.** RaceDetail viser etape-/klassements-resultater. Trøje-klassementerne (fører/point/bjerg/ungdom) vises uden farve-affordance.
- **A (anbefalet):** tilføj `<JerseyDot color=… />` (findes i `Table.jsx:39`) ved trøje-bundne result-typer (fører=gul `#e8c547`, point=grøn, bjerg=rød-prik, ungdom=hvid) via et lille type→farve-map. *Benefit:* øjeblikkelig cykel-autenticitet, nul ny data, genbruger eksisterende primitiv. *Cost:* S-M. *(Samme greb anbefales på RacePoints §3.10 og RiderRankings §3.12 — overvej ét delt `jerseyColorForType()`-helper.)*
- **B:** kun primitiv-konvertering, ingen trøje-prikker. *Benefit:* mindre. *Cost:* misser fladens største editorial-detalje.

**(d)** Effort **M**. Snapshot: refresh hvis race-detail er i smoke-ruten.

### 3.7 ResultaterPage (`frontend/src/pages/ResultaterPage.jsx`, 216 l.)

**(a) Fund:**
- **Hub = 5 identiske centrerede ikon-kort** i `grid grid-cols-2 md:grid-cols-4` (`:112-123`) — hver `text-center` + `mx-auto`-ikon, ingen vægtning af at Standings/Rankings er de primære destinationer; 5 kort i 4-kol giver skæv enlig række.
- **Top-lister** (Tophold/Topscorere, `:133-202`) uden ægte data-feel — nr. 1 kun guld-tekst, tal i lille `text-sm`.

**(b) Behandling:**
- Hub → venstrestillet hairline-divideret liste (ikon + label på linje, desc under) ELLER asymmetrisk vægt (primær-links større). Fjern `text-center`/`mx-auto`-symmetrien.
- Top-lister → `font-display`/større data-type til point-tal + diskret podie-/`JerseyDot`-affordance for top-3.

**(c) [EJER-VALG: A vs B] — hub-layout.**
- **A (anbefalet):** liste-/række-orienteret hub (hairline-divideret, venstrestillet) — bryder helt med feature-grid-skabelonen. *Benefit:* mest editorial, løser skæv-række-problemet. *Cost:* M, ændrer den kendte navigations-form.
- **B:** behold grid men giv Standings + Rider-rankings større/bredere kort (2-kol-span) som primære, resten mindre. *Benefit:* bevarer grid-mental-model, mindre re-arbejde. *Cost:* stadig kort-grid, bare vægtet.

**(d)** Effort **M**. Snapshot: refresh hvis hub er i smoke-ruten.

### 3.8 AcademyPage (`frontend/src/pages/AcademyPage.jsx`, 407 l.)

**(a) Fund:**
- **Tre næsten identiske kort-grids** (`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4`): graduations `:140`, intake `:207`, free-agents `:360`. Tre forskellige domæne-koncepter (gradering=tidskritisk, intake=primær scouting, free-agents=købbar) renderes visuelt ens.
- Accent/30-tint-badge som eneste dekorativ accent (`:238`, `:157`).
- Flad roster-tabel `:304-345` uden cykel-data (alder=bart tal, ingen potentiale/evne-kolonne).

**(b) Behandling:**
- Differentiér de tre sektioner visuelt: gradering (hastende) → kompakt liste/række m. deadline fremhævet; intake (primær) → rigeste kort m. potentiale-stjerner i fokus; free-agents → strammere tabel-liste. Skab editorial rytme, ikke tre ens grids.
- Accent-badge → strammere editorial markør (lille guld-prik + uppercase mikro-label) eller hairline-tag uden tint-fyld.
- Roster-tabel → `Table`-primitiv + tilføj potentiale-/udviklings-kolonne (genbrug `PotentialeStars`) så signerede akademi-ryttere viser samme rige data som intake.

**(c) [EJER-VALG: A vs B] — sektions-differentiering.**
- **A (anbefalet):** fuld differentiering (liste / rige kort / tabel pr. sektion) som ovenfor. *Benefit:* hierarkiet kommunikerer hvad der haster vs. er primært. *Cost:* L.
- **B:** behold tre grids men giv hver sektion en distinkt `section`-keyline-header + variér kort-densitet. *Benefit:* lettere. *Cost:* sektionerne læser stadig ens.

**(d)** Effort **L**. Snapshot: refresh hvis academy er i smoke-ruten.

### 3.9 AuctionHistoryPage (`frontend/src/pages/AuctionHistoryPage.jsx`, 318 l.) — "Auctions"

**(a) Fund:**
- **Pill-tabs gentaget 3×** (Active/History `:150-167` + filter-tabs `:186-200`) m. `bg-cz-accent/10 ... border-cz-accent/30`.
- **4 centrerede identiske KPI-kort** (`:171-183`, `grid grid-cols-2 sm:grid-cols-4`, `Card p-3 text-center`) — Spent/Earned (penge-flow) og Bought/Sold (tællere) behandles visuelt ens.

**(b) Behandling:**
- Begge tab-rækker → `<Tabs>`/`tabClass()` (ét fix retter også de andre sider der kopierer pill-snippet).
- KPI-strip → venstrejusteret editorial række: label + stort `font-data tabular`-tal; gruppér tællere vs. penge-flow; overvej hairline-divider-strip frem for 4 separate centrerede kort.

**(c)** Ingen stor fork — KPI-grupperingen (penge vs. tællere) er den eneste dømmekraft-beslutning; anbefaling: to grupper adskilt af en hairline.

**(d)** Effort **M**. Snapshot: refresh hvis auction-history er i smoke-ruten.

### 3.10 RacePointsPage (`frontend/src/pages/RacePointsPage.jsx`, 243 l.)

**(a) Fund:**
- Hånd-rullet flad `<table>` `:197-225` (`font-medium text-xs`-header) i stedet for `Table`/`cellClass`.
- **Trøje-resultater uden trøjefarve-prikker** (`:161-238`, `:170-188`) — siden handler bogstaveligt om trøjer (Førertrøje=gul, Pointtrøje=grøn, Bjergtrøje=prik/rød, Ungdomstrøje=hvid) men viser dem som ren tekst. `JerseyDot` findes ubrugt.

**(b) Behandling:**
- Tabel → `Table`/`Th numeric`/`Td numeric` (arver editorial header + tabular højre-stilling).
- Tilføj `<JerseyDot>` ved trøje-bundne result-typer via samme `jerseyColorForType()`-helper som RaceDetail §3.6. **Største forspildte editorial-detalje på fladen** — høj-værdi, lav-risiko.

**(c)** Ingen fork (trøje-farve-mapping er fakta, ikke smag). Del helper med §3.6/§3.12.

**(d)** Effort **M**. Snapshot: refresh hvis i smoke-ruten.

### 3.11 Dashboard / Help — kun emoji, ingen editorial-fund

`DashboardPage.jsx` og `HelpPage.jsx` står i issue #1590's prioriterings-liste, men audit'en giver dem **0 fund** i WP5-kategorierne — kun `emoji-as-icon` (WP1/WP2-scope, og verificeret allerede sweepet: ingen rest-emoji i de to filer pr. 2026-06-21). Dashboard er desuden allerede flade-migreret til `Card`-primitiver i Plan-4 Slice B.

**Konklusion:** WP5 har **ingen editorial gæld** på Dashboard/Help. Et WP5-"løft" her ville være gold-plating uden audit-belæg. **Anbefaling:** marker dem grøn/ude-af-scope for WP5; hvis ejeren ønsker et frivilligt løft (fx Help-FAQ-typografi eller Dashboard-hierarki), spec'es det separat med konkrete fund først. [antagelse] de var med i listen som trafik-kandidater, ikke fordi audit fandt slop.

### 3.12 Resten ("sweepes") — batch-mønstre

Disse flader bærer 1-3 fund hver og deler de mønstre §3 allerede har defineret. De migreres når deres tur kommer (eller foldes ind hvis et struktur-rework rammer dem — Plan-4-arbejdsmodellen). Grupperet efter mønster:

- **Uniform centrerede KPI-tile-grids** (samme fix: venstrejustér + `font-data tabular` + fremhæv primær-metrik, ikke 3-7 ens centrerede bokse): `TeamsPage:158-177`, `TeamProfilePage:156-168/191-202`, `ManagerProfilePage:197-210`, `SeasonEndPage:266-305` (+ `WinnerCard` — fremhæv præmie-leader som hero), `SeasonFinanceReportPanel:354-409` (løft net-cashflow-hero).
- **Hånd-rullede primitiver** (→ `Card`/`Table`/`Spinner`/`EmptyState`/`ProgressMeter`/`Button`/`Modal`): `TeamProfilePage` (Card `:138/173/231`), `TeamPage` RiderActionModal `:96-185` (→ `Modal`), `ProfilePage` Discord-knap `:428-442` (→ `Button variant="discord"` — kræver ny `discord`-variant i `buttonStyles.js`, deler color-drift-fix), `TrainingPage` tabel/MiniBar/pills `:21-32/282-291/437-494`, `DeadlineDayBoard` SquadTable `:129-169`, `RaceHistoryPage` h1 `:115` (→ `font-display`), `WatchlistPage` empty `:194-203` (→ `EmptyState`), `ProfilePage` 5 ens kort `:220-351` (→ `Divider` mellem grupper), `RoadmapPage:117-199` (today→next editorial akse).
- **Accent-tint-overbrug** (reservér fyldt guld til ÉT primært element pr. view; sekundære → neutral + vægt): `RidersPage` (+ child-komponenter: RiderBadges/TypeBadge/StatsToggle/filter-chips/CompareToggle, `:360/435`), `CompareSelection:30` (neutral border + guld kun på CTA), landing `LaunchWaitlistForm:87` + `RaceSignature:92` (neutral terræn-vask `fill-cz-1/[0.04]`).
- **Trøje-data-feel** (del `jerseyColorForType()` m. §3.6/§3.10): `RiderRankingsPage:30-33/411-429` (`JerseyDot` i kolonne-header + legend, i dag rene tal).
- **`transition-all` → `transition-colors`** (mekanisk, fold ind når fladen alligevel rører): `RacesPage:536`, `SeasonPreviewPage:139` (no-op-hover — men SeasonPreview er nu redirect, så denne er sandsynligvis død [antagelse]).

> **NB FounderSupporter:** dens 4 fund i audit'en (centreret-alt hero, uniforme tier/benefit-grids, accent-tint) blev allerede adresseret i **WP3** ([#1588](https://github.com/NicolaiDolmer/CyclingZone/issues/1588)/[#1643](https://github.com/NicolaiDolmer/CyclingZone/issues/1643), merged). Verificér den faktiske live-tilstand før WP5 rører den — sandsynligvis allerede løst eller delvist. Ikke medregnet i §2-prioriteringen.

---

## 4. Per-flade-PR-rækkefølge

**Forudsætninger (alt landet):** WP0 (token-lås, [#1578](https://github.com/NicolaiDolmer/CyclingZone/issues/1578)) · WP1/WP2 (emoji/farve/radius-sweeps) · WP3 (public-flader) · WP4 (Board-modaler). WP5 forbruger det færdige primitiv-lag — det bygger ikke nye primitiver (undtagen evt. én `discord` `Button`-variant + et delt `jerseyColorForType()`-helper, som er små additions, ikke fundament).

**Arbejdsmodel (uændret fra Plan-4):**
1. **Én flade = én PR.** Hele fladen inkl. child-komponenter (ingen halv-migreret inkonsistens).
2. **GitHub-sweep før hver flade.** Ligger der et struktur-rework på fladen → fold WP5-løftet ind i det reworket frem for en kosmetisk éngangs-omgang.
3. **Greenlight først.** Hver flade-PR refererer den greenlit `[EJER-VALG]` fra dette dokument i sin body.

**Rækkefølge** (= §2-prioritering): HallOfFame → Activity → RiderStats → PatchNotes → Board → RaceDetail → Resultater → Academy → Auctions → RacePoints → (resten/§3.12 som batch eller fold-in).

**Først-i-rækken-anbefaling:** start med **de tre delte mønster-fixes** (underline-tabs, `<Spinner>`, `<EmptyState>`) på HallOfFame som *referans-PR* — den etablerer det visuelle mål + de delte helpers, og de øvrige flader genbruger mønstret. Det giver ejeren én konkret PR at kalibrere smagen på før resten følger.

**Patch notes:** hver flade-PR er brugerrettet (visuel ændring) → patch-note-linje obligatorisk. Help/FAQ: N/A (ingen spilmekanik ændres).

---

## 5. Acceptkriterier (per flade-PR)

En WP5-flade er **done** når:

1. **Ingen centreret-alt:** intet `text-center` på hero/sektion-headers/KPI-tal på fladen (undtagen `EmptyState`-primitivens bevidste center). Layout er venstrejusteret med editorial hierarki.
2. **Ingen uniform-card-grid:** intet `grid grid-cols-N` med N visuelt identiske, ligevægtede kort. Hierarki via vægt/størrelse/position, eller konverteret til hairline-tabel/-liste.
3. **Ingen accent-tint-som-eneste-design:** fyldt `bg-cz-accent/10 ... border-cz-accent/30` er reserveret til ÉT primært/aktivt element pr. view; tabs bruger underline (`tabClass`), badges bruger `StatusBadge`/`Chip` tone-tokens. Ingen rå hex (`border-[#e8c547]` → `border-cz-accent`).
4. **Primitiv-disciplin:** ingen hånd-rullet `<table>`/spinner/empty-state/modal/progress-bar hvor en `ui/`-primitiv findes (`Table`, `Spinner`, `EmptyState`, `ErrorState`, `Modal`, `ProgressMeter`, `Tabs`, `Card`, `Button`).
5. **Hairline editorial layout:** kort/paneler = `<Card>` (`rounded-cz` hairline, ingen skygge); tal = `font-data`/`font-mono` tabular; sektion-headers bruger guld-keyline-`section`-mønstret hvor relevant; display-overskrifter = `font-display` (Bebas).
6. **Ægte cykel-data-feel hvor data findes:** trøje-bundne lister har `JerseyDot`; top-/leder-rækker har en podie-/leder-affordance (ikke kun guld-tekst).
7. **`[EJER-VALG]` afklaret:** PR'en implementerer den greenlit variant og noterer hvilken.
8. **Gates grønne:** `cd frontend && node --test` · `npm run build` · `npm run lint` · `npm run check:i18n` · warning-budget · **`npm run test:lint-ui-slop && npm run lint:ui-slop`** (baseline skrumpet for fladen, ingen nye fund — ratchet `ui-slop-baseline.json` ned i samme PR via `npm run check:ui-slop-baseline`).
9. **Snapshots:** ved visuel ændring refreshes core-smoke-snapshots på **alle 3 playwright-projekter** (desktop-chromium + mobile-chromium + mobile-webkit), PNG'er committed. Flader uden for smoke-ruten verificeres via Playwright-mock-screenshot begge temaer (umasket engangs).
10. **Ingen adfærdsændring:** kun præsentation; queries/data/event-logging uændret (source-pinned tests består uændret).

---

## 6. Åbne punkter

- **Snapshot-dækning:** ikke alle 12 flader er i core-smoke-ruten. [antagelse] Standings/Dashboard/Board er; resten verificeres via mocks. Bekræft pr. flade ved migration.
- **Delt `jerseyColorForType()`-helper:** anbefales oprettet i første trøje-flade-PR (RaceDetail eller RacePoints) og genbrugt — ikke 3× kopieret.
- **`discord` Button-variant:** ProfilePage-fix kræver den; lille addition til `buttonStyles.js`, ikke en fundament-ændring. Kan laves i ProfilePage-PR'en.
- **FounderSupporter live-tilstand:** verificér WP3-resultatet før WP5 evt. rører den igen.
- **Dashboard/Help:** ude af WP5-scope (ingen audit-fund) medmindre ejeren ønsker et frivilligt løft — spec'es da separat.

## Referencer

- Regelbog: [`2026-06-14-design-system-foundation-design.md`](2026-06-14-design-system-foundation-design.md) (DEL-A A1-A9 tokens/anti-slop, DEL-B primitiv-inventar)
- Udrulnings-arbejdsmodel: [`2026-06-15-ui-foundation-plan4-rollout.md`](../plans/2026-06-15-ui-foundation-plan4-rollout.md)
- Audit: [`docs/audits/2026-06-20-ai-slop-findings.json`](../../audits/2026-06-20-ai-slop-findings.json)
- Anker-flade: `frontend/src/pages/StandingsPage.jsx` · primitiver: `frontend/src/components/ui/` (`Card.jsx`, `Table.jsx`+`tableStyles.js`, `EmptyState.jsx`, `tabsStyles.js`, `ProgressMeter.jsx`, `StatusBadge.jsx`, `Modal.jsx`)
- Tokens: `frontend/src/index.css` · `frontend/tailwind.config.js` (`rounded-cz`, `font-display`/`font-data`, `cz-accent`/`cz-accent-t`, semantiske states)
