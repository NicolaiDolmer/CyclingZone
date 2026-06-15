# Finance-flade: struktur-rework + primitiv-migration (#986 + #671)

> Design-doc · 2026-06-15 · brainstorm-output. Eksekvering via implementeringsplan (writing-plans).
> Slice i per-flade-migrationsmodellen (vedtaget 15/6, jf. `feedback_migrate_per_flade_with_github_sweep`).

## 1. Mål & kontekst

Finance-fladen er næste flade i UI-fundament Plan 4 (#671). Driveren er **primitiv-migrationen**; vi folder opportunistisk **strukturelle** dele af #986 (Discord-feedback @jeppek, 2/6) ind så fladen ikke migreres to gange.

**Beslutning (ejer, 15/6): Fork A** — struktur + migration nu, **økonomi-feature udskudt**.

## 2. Scope

**I scope (denne PR):**
1. `FinancePage.jsx` → omstruktureres til **3 faner** (Tabs-primitiv) + fuld primitiv/token-migration (0 anti-drift-overtrædelser).
2. `FinanceForecastCard.jsx` (child) → primitiv-migration; emoji-tier-prikker + ⚠️ → tokens/ikoner.
3. `FinanceFirstVisitHint.jsx` (child) → primitiv-migration.
4. `SeasonFinanceReport.jsx` → **kun** fjern den malplacerede sponsor-modifier-placeholder (#986 bullet 4). Fuld recharts/donut-palette-migration **udskydes** til egen flade-slice (sibling-route, ikke child).

**Eksplicit UDE af scope for DENNE UI-PR (men IKKE udskudt — se note):**
- **Forecast-korrekthed** (sponsor + præmiepenge-prognose, #986 bullet 2) — rører backend `/api/me/finance-forecast` + værdimodel; udløser simulér-før-ship-kravet (`feedback_simulate_before_ship_balance`). Overlapper #784. **Ejer-direktiv 15/6: økonomien skal være korrekt inden 20/6** → håndteres i et **parallelt økonomi-korrekthed-spor** (egen scoping-doc), IKKE i denne UI-PR. Forecast-kortets placering ændres ikke; dets interne tal rettes i det spor.
- **Cross-season fordeling/historik m. sæson-vælger** (#986 bullet 3) — ny data-fetch + UI. **Post-launch.**
- **Sponsor-modifier-kurve på selve økonomisiden** — den ægte graf kræver `board_plan_snapshots`-data (sæson 2+); vi tilføjer IKKE en tom placeholder (ville være slop). Knyttes til board-økonomi (#1237/#101) post-launch.
- Fuld `SeasonFinanceReport`-migration (recharts donut-hex-palette → chart-tokens) — egen slice.

**Ingen adfærdsændring:** ingen ændring i økonomi-/balance-logik, lån-validering, forecast-tal eller backend-kald. Ren UI/IA-omflytning af eksisterende elementer.

## 3. Informationsarkitektur (3 faner)

Fane-bar (Tabs-primitiv) + sæsonrapport-link i header (`ClipboardIcon`, ikke 📊).

**Fane 1 · Overblik** (default/startskærm — "samlet overblik", #986 bullet 1):
- Stat-grid: Balance / Gæld / Præmier (sæson) — inkl. reserveret/tilgængelig-linje.
- Forecast-kort (`FinanceForecastCard`) — beholdes på Overblik; **intern korrekthed håndteres i det parallelle økonomi-korrekthed-spor** (ikke denne UI-PR).
- **Aktiv-lån-sammenfatning: én linje** ("Aktivt lån: X CZ$ · N lån →") der linker til Lån-fanen (#986 bullet 5).

**Fane 2 · Lån** (#986 bullet 5):
- Aktive lån + tilbagebetaling.
- Optag lån (formular).
- Lånebetingelser (tabel pr. division).

**Fane 3 · Historik:**
- Fuld transaktionshistorik.
- **Løbspræmie-liste** (flyttet hertil — ejer-valg 15/6; præmier ER transaktioner, holder Overblik lean).
- Link til fuld sæsonrapport.

## 4. Komponent-ændringer

### FinancePage.jsx
- Wrap eksisterende sektioner i `Tabs/TabList/Tab/TabPanel`. Aktiv-fane = lokal `useState` (default `"overview"`). **Bevar ét `loadAll()`** — al data hentes upfront, så fane-skift er instant (TabPanel rendrer kun aktiv panel, men data er allerede i state).
- Migrér inline-kort-kopi → `Card`-primitiv; `rounded-xl`/`rounded-lg` → `rounded-cz`; rå `📊`/`✕` → ikoner (`ClipboardIcon`, `XIcon`).
- Ny aktiv-lån-sammenfatningslinje på Overblik (afledt af eksisterende `activeLoans` + `loanData.total_debt`).

### FinanceForecastCard.jsx (delt med dashboard via `FinanceForecastBadge`)
- Emoji-tier-indikator (🟢🟡🔴) → tokeniseret farve-prik (StatusBadge-mønster: `h-[7px] w-[7px] rounded-full` + `bg-cz-success/warning/danger`), keyed på tier. Samme i multiSeason-tabellens tier-celler.
- ⚠️ → `AlertTriangleIcon` (arver farve via currentColor).
- `rounded-full` badges → behold semantisk pille-form (StatusBadge), men via primitiv.
- **NB:** `FinanceForecastBadge` rendres på dashboard (netop migreret, Slice B) — verificér begge temaer + at dashboard-badgen forbliver konsistent.

### FinanceFirstVisitHint.jsx
- Primitiv/token-migration (Card + ikoner, ingen emoji/rounded-xl).

### SeasonFinanceReport.jsx
- Fjern det stiplede sponsor-placeholder-kort (linje 382-390) + tilhørende `report.sponsorTitle`/`report.sponsorBody`-keys hvis ubrugte. **Ingen anden ændring** denne slice.

## 5. Onboarding-tour-integration (kritisk detalje)

`OnboardingTour({ pageKey, steps })` rendrer `TabPanel` returnerer `null` for inaktiv fane → tour-trin der peger på elementer i en ikke-aktiv fane (`finance-tx-history` ligger på Historik) fejler highlight.

**Løsning:** annotér hvert tour-trin med sin ejende fane og **skift fane** så target-elementet er rendret før highlight. Konkret mekanik afklares i planen (verificér `lib/onboardingTour`-storens læse-API først): enten FinancePage observerer aktivt trin fra storen, eller et lille `onStep`-hook tilføjes `OnboardingTour`. Foretræk indkapsling i FinancePage hvis storen eksponerer trinnet. (Trin: balance→Overblik, gældsloft→Overblik, tx-historik→Historik.)

## 6. Anti-drift-ratchet

`lint-ui-slop.mjs` forward-guard; baseline `scripts/ui-slop-baseline.json`. Efter migration → fjern (eller nul-stil) baseline-entries for `FinancePage.jsx`, `FinanceForecastCard.jsx`, `FinanceFirstVisitHint.jsx`. `SeasonFinanceReport.jsx` skrumper (sponsor-placeholder fjernet) men forbliver i baseline (donut-hex udskudt). Regenerér: `node scripts/lint-ui-slop.mjs --update-baseline`. Baseline må kun skrumpe.

## 7. i18n (en + da, `public/locales/*/finance.json`)

Nye keys:
- `tabs.overview`, `tabs.loans`, `tabs.history`
- `overview.activeLoanSummary` (params: `{ amount, count }`) + `overview.goToLoans`
- Evt. `tabs.ariaLabel` til `TabList label`.

Eksisterende sektions-keys genbruges uændret. Slet ubrugte `report.sponsor*`-keys hvis placeholder fjernes. i18n-leak-guard skal forblive grøn.

## 8. Verifikation (pre-push, jf. CLAUDE.md pre-flight)

- `pwsh -File scripts/verify-local.ps1` (backend + frontend `node --test` + build).
- `npm run lint` (eslint) + `node scripts/lint-ui-slop.mjs` + `node scripts/i18n-check-leaks.mjs` + tone/em-dash + warning-budget.
- `npx playwright test core-smoke.spec.js` (alle 3 projekter — desktop + mobile-chromium + mobile-webkit). Visuel diff forventet (fane-bar + radius) → refresh snapshots på alle 3 + commit PNG'er.
- Logget-ind verify via Playwright-mocks (fixtures.js), umasket screenshot, begge temaer — bekræft Overblik/Lån/Historik + forecast-badge på dashboard uændret.
- Patch notes (PatchNotesPage.jsx) — brugerrettet UI-ændring. Help/FAQ: ingen ny spilmekanik → skriv hvorfor ikke (eller note om fane-navigation).

## 9. Risici

- **Tour-regression:** hvis fane-skift-hooket fejler → tx-historik-trin highlighter intet. Mitigeret af eksplicit verifikation af tour-gennemløb.
- **Dashboard-spillover:** `FinanceForecastBadge` deles → emoji→prik må ikke regne dashboard-badgen visuelt forkert. Verificér dashboard.
- **Snapshot-flak:** fane-bar ændrer layout → core-smoke snapshots SKAL refreshes på alle 3 projekter (#536-fælde).

## 10. Leverancer

Én PR (`feat(ui)` via branch): FinancePage 3-faner + primitiv-migration, child-migration (ForecastCard + FirstVisitHint), SeasonFinanceReport-placeholder-fjernelse, i18n-keys, baseline-ratchet, snapshot-refresh, patch note. `Refs #671`, `Refs #986` (#986 forbliver åben for udskudt forecast/historik). Ingen migration/SQL → ingen ejer-merge-gate, men PR-flow + brugerverifikation-sektion.
