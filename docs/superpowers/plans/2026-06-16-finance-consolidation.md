# Finance Consolidation (Plan 4 + #986) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/finance` the single home for all economy content — a 3-tab page (Overblik / Lån / Historik) built on design primitives — by migrating FinancePage to primitives, folding the per-season finance report and the TeamPage economy tab into it, so "everything finance is findable under finance, nothing scattered" (owner principle, 2026-06-16).

**Architecture:** FinancePage gains a `Tabs` shell. Overblik = today's overview (balance/debt/prize grid + `FinanceForecastCard` + prize list + a new one-line loan summary). Lån = loans (active + take + terms). Historik = a season picker driving a reusable `SeasonFinanceReportPanel` (extracted from `SeasonFinanceReport.jsx`) + flat transaction history. TeamPage's `EconomyTab` is removed (its content is already subsumed by the forecast card + season donuts; only the team-value total is preserved, on the squad tab). The `/seasons/:seasonId/finance/:teamId` route stays alive for admin cross-team viewing; owner-facing buttons repoint to the Historik tab. Frontend + i18n only — **no backend change, no `database/*.sql`** → normal PR flow.

**Tech Stack:** React + Vite, react-router-dom v6, react-i18next, Tailwind (design tokens `cz-*`, radius `rounded-cz`), recharts (donuts), Playwright (`core-smoke` snapshots), `node --test` (frontend unit/source tests), `scripts/lint-ui-slop.mjs` (+ baseline).

---

## Why this scope (verified findings)

- `FinanceForecastCard` (already on FinancePage, `FinanceForecastCard.jsx:145-189`) already renders projected **sponsor**, **prize**, **salary**, loan interest/fees and **net** + risk tier. → TeamPage `EconomyTab`'s 4 KPI cards + its "season forecast" sub-card were **redundant**.
- `SeasonFinanceReport` is the only place with **per-season cashflow + income/expense donuts ("Fordeling") + top-3**. These are the genuinely unique historical views → they become the Historik tab.
- The only `EconomyTab` content NOT already on Finance is **team value** (squad-asset → preserve on TeamPage squad tab) and the by-type **breakdown** (subsumed by the season donuts → not re-created).
- `EconomyTab` is state-only (`TeamPage.jsx:591`), no `?tab=economy` deep-link exists → removing it needs no redirect.
- Inbound links to `/finance` root (Layout sidebar, Dashboard balance/badge, Board, Notifications) stay valid as long as the **default tab = Overblik**.
- The two SeasonFinanceReport launch buttons (`FinancePage.jsx:330-337`, `SeasonEndPage.jsx:233-239`, `SeasonPreviewPage.jsx:~235`) repoint to the tab; the route stays for admin (`api.js:3730-3743` admin path).

---

## File Structure

**Create:**
- `frontend/src/components/SeasonFinanceReportPanel.jsx` — reusable per-season report body (hero + donuts + top-3 + sponsor placeholder), props `{ seasonId, teamId }`. Used by both the standalone route and the Historik tab.
- `frontend/src/lib/chartPalette.js` — exports the categorical donut palette as token-backed values (replaces the 9 raw hex in SeasonFinanceReport).

**Modify:**
- `frontend/src/pages/FinancePage.jsx` — tab shell + primitive migration + Historik tab + one-line loan summary.
- `frontend/src/pages/SeasonFinanceReport.jsx` — becomes a thin route shell rendering `SeasonFinanceReportPanel`; primitive migration of the shell.
- `frontend/src/components/FinanceForecastCard.jsx` — risk-tier emoji (🟢🟡🔴) → `StatusBadge` tones (deferred from #1396 to #986). NOTE: also rendered on Dashboard via `FinanceForecastBadge` → refresh `dashboard.png` too.
- `frontend/src/components/FinanceFirstVisitHint.jsx` — primitive migration (rounded-xl → Card/rounded-cz, emoji tiles → icons).
- `frontend/src/pages/TeamPage.jsx` — remove `EconomyTab` (fn + tab def + render); add team-value total to squad tab.
- `frontend/src/pages/SeasonEndPage.jsx` + `frontend/src/pages/SeasonPreviewPage.jsx` — repoint finance-report buttons to `/finance?tab=historik&season=:id`.
- `frontend/public/locales/{en,da}/finance.json` — add `tabs.*` + `history.*` season-picker keys; absorb the few `report.*` already present.
- `frontend/public/locales/{en,da}/team.json` — remove dead `economy.*` keys; add `squad.totalValue`.
- `frontend/src/index.css` + `frontend/tailwind.config.js` — chart palette CSS vars (`--cz-chart-1..9`) if tokenizing via CSS.
- `frontend/src/pages/PatchNotesPage.jsx` — user-facing patch note.
- `frontend/public/locales/{en,da}/help.json` — finance help: note the new tab layout (or document why N/A).
- `docs/NOW.md`, `docs/FEATURE_STATUS.md`, `docs/superpowers/plans/2026-06-15-ui-foundation-plan4-rollout.md` — close-out.
- `scripts/ui-slop-baseline.json` — ratchet down.

---

## Task 0: Worktree + branch + baseline

**Files:** none (setup)

- [ ] **Step 1: Create an isolated worktree** (parallel-session safety, per `docs/WORKTREE_WORKFLOW.md`)

```powershell
pwsh -File scripts/new-worktree.ps1 -Name 986-finance-consolidation
```
Branch from `origin/main`: `feat/986-finance-consolidation`. In the worktree: `cd frontend; npm ci` and create `.env` with only `VITE_*` vars (per local-logged-in-verify memory).

- [ ] **Step 2: Capture the UI-slop baseline for the files in scope**

Run: `node scripts/lint-ui-slop.mjs` and note current counts for FinancePage.jsx, SeasonFinanceReport.jsx, FinanceFirstVisitHint.jsx (expected ~11 / ~9 hex / ~1 from earlier audit).
Expected: baseline present in `scripts/ui-slop-baseline.json`.

- [ ] **Step 3: Confirm the snapshot guard surface**

Run: `Select-String -Path frontend/tests/e2e/core-smoke.spec.js -Pattern "finance|board|dashboard|team"` (or Grep) — confirm `finance.png`, `dashboard.png`, and any `team.png` snapshots that this PR can shift.
Expected: know which snapshots to re-verify in Task 12.

---

## Task 1: i18n — finance tab + history keys

**Files:**
- Modify: `frontend/public/locales/en/finance.json`
- Modify: `frontend/public/locales/da/finance.json`

- [ ] **Step 1: Add `tabs.*` + `history.season.*` keys (EN)**

In `en/finance.json`, add (sibling to `page`):

```json
"tabs": { "overview": "Overview", "loans": "Loans", "history": "History" },
"loanSummary": { "active": "{{count}} active loan", "active_other": "{{count}} active loans", "owed": "{{value}} CZ$ remaining", "none": "No active loans", "view": "Manage loans" },
"history": { "seasonPicker": "Season", "currentSeason": "Current season" }
```

- [ ] **Step 2: Add the DA mirror**

In `da/finance.json`, add the same structure with Danish copy (EN-first/DA-second rule applies to source content; both files must have identical keys):

```json
"tabs": { "overview": "Overblik", "loans": "Lån", "history": "Historik" },
"loanSummary": { "active": "{{count}} aktivt lån", "active_other": "{{count}} aktive lån", "owed": "{{value}} CZ$ tilbage", "none": "Ingen aktive lån", "view": "Administrér lån" },
"history": { "seasonPicker": "Sæson", "currentSeason": "Indeværende sæson" }
```

- [ ] **Step 3: Verify i18n parity**

Run: `npm run check:i18n`
Expected: PASS (key parity en↔da, no EN-leak, namespace ok).

- [ ] **Step 4: Commit**

```bash
git add frontend/public/locales/en/finance.json frontend/public/locales/da/finance.json
git commit -F .git/COMMIT_FINANCE_I18N.txt
```
Message: `i18n(finance): tab + loan-summary + history-picker keys (Refs #986)`

---

## Task 2: Extract `SeasonFinanceReportPanel` + tokenize donut palette

**Files:**
- Create: `frontend/src/lib/chartPalette.js`
- Create: `frontend/src/components/SeasonFinanceReportPanel.jsx`
- Modify: `frontend/src/pages/SeasonFinanceReport.jsx`
- Test: `frontend/src/lib/chartPalette.test.js`

- [ ] **Step 1: Write the failing test for the chart palette**

`frontend/src/lib/chartPalette.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHART_PALETTE, chartColor } from "./chartPalette.js";

test("CHART_PALETTE has 9 categorical colors", () => {
  assert.equal(CHART_PALETTE.length, 9);
});

test("chartColor wraps by index", () => {
  assert.equal(chartColor(0), CHART_PALETTE[0]);
  assert.equal(chartColor(9), CHART_PALETTE[0]);
  assert.equal(chartColor(10), CHART_PALETTE[1]);
});

test("no raw 6-digit hex leaks (must be token-backed)", () => {
  for (const c of CHART_PALETTE) assert.ok(/var\(--cz-chart-\d\)/.test(c), c);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (in `frontend/`): `node --test src/lib/chartPalette.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `chartPalette.js`**

```js
// Categorical donut palette, token-backed so it themes in light/dark.
// CSS vars defined in frontend/src/index.css (--cz-chart-1..9).
// recharts cannot read CSS classes, but DOES accept rgb()/var() strings as fill.
export const CHART_PALETTE = Array.from({ length: 9 }, (_, i) => `var(--cz-chart-${i + 1})`);
export const chartColor = (i) => CHART_PALETTE[((i % 9) + 9) % 9];
```

- [ ] **Step 4: Add the CSS vars**

In `frontend/src/index.css`, under the existing `:root` token block (and the dark theme block if colors should differ), add a categorical chart ramp (values are the former hardcoded donut hex, now centralized; keep both light/dark identical unless a dark variant is desired):

```css
--cz-chart-1: 96 165 250;   /* blue   (was #60a5fa) */
--cz-chart-2: 167 139 250;  /* violet (was #a78bfa) */
--cz-chart-3: 52 211 153;   /* emerald(was #34d399) */
--cz-chart-4: 251 191 36;   /* amber  (was #fbbf24) */
--cz-chart-5: 248 113 113;  /* red    (was #f87171) */
--cz-chart-6: 34 211 238;   /* cyan   (was #22d3ee) */
--cz-chart-7: 244 114 182;  /* pink   (was #f472b6) */
--cz-chart-8: 250 204 21;   /* yellow (was #facc15) */
--cz-chart-9: 148 163 184;  /* slate  (was #94a3b8) */
```
The palette entries use `var(--cz-chart-N)` directly; recharts `Cell fill` and the legend swatch `style.background` reference `rgb(var(--cz-chart-N))`. (Tailwind config change only needed if a `cz-chart-*` utility class is wanted — not required here.)

- [ ] **Step 5: Run the palette test to verify it passes**

Run: `node --test src/lib/chartPalette.test.js`
Expected: PASS.

- [ ] **Step 6: Create `SeasonFinanceReportPanel.jsx`**

Move the report body out of `SeasonFinanceReport.jsx` (the `HeroCard`, `Donut`, `TopTransactionsCard`, `LoanPortfolioCard` and the fetch) into a panel that takes `{ seasonId, teamId }`. Keep the existing fetch (`GET ${API}/api/teams/${teamId}/finance-report?seasonId=${seasonId}`), loading/error states, and all `report.*` i18n keys. Replace `DONUT_COLORS` with `chartColor(i)` from `chartPalette.js`. Migrate hand-rolled cards to the `Card` primitive and `rounded-lg/xl` → `rounded-cz`. The panel renders ONLY the data sections (no page header / no back button — those stay in the route shell and the tab provides its own framing).

```jsx
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { Card, Spinner, ErrorState } from "./ui";
import { chartColor } from "../lib/chartPalette";
// ...HeroCard, Donut, TopTransactionsCard, LoanPortfolioCard moved here (migrated to Card)...

const API = import.meta.env.VITE_API_URL;

export default function SeasonFinanceReportPanel({ seasonId, teamId }) {
  const { t } = useTranslation("finance");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!seasonId || !teamId) return;
    let alive = true;
    (async () => {
      setLoading(true); setError(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${API}/api/teams/${teamId}/finance-report?seasonId=${seasonId}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } });
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json();
        if (alive) setReport(json);
      } catch (e) { if (alive) setError(e); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [seasonId, teamId]);

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (error || !report) return <ErrorState title={t("report.loadError")} />;
  // ...render HeroCard + two Donuts + TopTransactionsCard x2 + LoanPortfolioCard + sponsor placeholder...
}
```

- [ ] **Step 7: Slim `SeasonFinanceReport.jsx` to a route shell**

The route component keeps `useParams()` (seasonId, teamId), the page header (`report.team.name`, `report.title`, admin suffix), the back button (`navigate(-1)`), and renders `<SeasonFinanceReportPanel seasonId={seasonId} teamId={teamId} />`. Migrate the shell's remaining bespoke divs/buttons to `Card`/`Button`/`rounded-cz`. (The admin cross-team viewing path is preserved because the route + its params are unchanged.)

- [ ] **Step 8: Verify build + tests + the report route still renders**

Run (in `frontend/`): `node --test && npm run build`
Expected: PASS. Then Playwright-mock verify (Task 12) covers the visual.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/lib/chartPalette.js frontend/src/lib/chartPalette.test.js frontend/src/components/SeasonFinanceReportPanel.jsx frontend/src/pages/SeasonFinanceReport.jsx frontend/src/index.css
git commit -F .git/COMMIT_PANEL.txt
```
Message: `refactor(finance): extract SeasonFinanceReportPanel + tokenize donut palette (Refs #986, #671)`

---

## Task 3: FinancePage tab shell

**Files:**
- Modify: `frontend/src/pages/FinancePage.jsx:321-707` (the returned JSX)

- [ ] **Step 1: Import primitives + router search params**

Add to the top imports:

```jsx
import { useSearchParams } from "react-router-dom";
import { Tabs, TabList, Tab, TabPanel, Card, Button, Input, Select, Table, Tr, Th, Td, ProgressMeter, StatusBadge, Spinner, ErrorState } from "../components/ui";
import SeasonFinanceReportPanel from "../components/SeasonFinanceReportPanel";
```

- [ ] **Step 2: Add tab state synced to `?tab=`**

Inside the component, near other state:

```jsx
const [searchParams, setSearchParams] = useSearchParams();
const allowedTabs = ["overview", "loans", "history"];
const activeTab = allowedTabs.includes(searchParams.get("tab")) ? searchParams.get("tab") : "overview";
const setTab = (tab) => setSearchParams(prev => { const p = new URLSearchParams(prev); p.set("tab", tab); return p; }, { replace: true });
```

- [ ] **Step 3: Wrap the page body in the Tabs shell**

Replace the flat section list (after the header + `msg` banner + `FinanceFirstVisitHint`) with:

```jsx
<Tabs value={activeTab} onChange={setTab} className="mt-2">
  <TabList label={t("page.title")} className="mb-4">
    <Tab value="overview">{t("tabs.overview")}</Tab>
    <Tab value="loans">{t("tabs.loans")}</Tab>
    <Tab value="history">{t("tabs.history")}</Tab>
  </TabList>
  <TabPanel value="overview">{/* Task 4 */}</TabPanel>
  <TabPanel value="loans">{/* Task 5 */}</TabPanel>
  <TabPanel value="history">{/* Task 6 */}</TabPanel>
</Tabs>
```

- [ ] **Step 4: Verify build**

Run (in `frontend/`): `npm run build`
Expected: PASS (sections temporarily empty inside panels is fine for this step; fill in Tasks 4-6 before committing).

---

## Task 4: Overblik tab (overview + primitive migration + loan summary)

**Files:**
- Modify: `frontend/src/pages/FinancePage.jsx` (move overview sections into the `overview` TabPanel)

- [ ] **Step 1: Move overview sections into the panel + migrate to primitives**

Into `<TabPanel value="overview">` place, in order:
1. The balance/debt/prize grid (`FinancePage.jsx:357-394`) — each `<div className="bg-cz-card border border-cz-border rounded-xl p-5">` → `<Card className="p-5">`. Keep `data-tour` attributes.
2. A **one-line loan summary** (new), linking to the Lån tab:

```jsx
<Card className="p-4 mb-4 flex items-center justify-between gap-3">
  <p className="text-cz-2 text-sm">
    {activeLoans.length === 0 ? t("loanSummary.none")
      : `${t("loanSummary.active", { count: activeLoans.length })} · ${t("loanSummary.owed", { value: formatNumber(loanData?.total_debt || 0) })}`}
  </p>
  {activeLoans.length > 0 && (
    <Button variant="ghost" size="sm" onClick={() => setTab("loans")}>{t("loanSummary.view")}</Button>
  )}
</Card>
```
3. The `<FinanceForecastCard .../>` (already a component, lines 397-405) — unchanged here (its internal migration is Task 9).
4. The prize list (`FinancePage.jsx:407-442`) — outer div → `<Card className="p-5 mb-4">`; keep the row `<Link>`s; replace the `›` glyph with `<ChevronRightIcon size={16} aria-hidden />`.

- [ ] **Step 2: Verify build**

Run (in `frontend/`): `npm run build`
Expected: PASS.

---

## Task 5: Lån tab (loans + form/table primitive migration)

**Files:**
- Modify: `frontend/src/pages/FinancePage.jsx` (move loan sections into the `loans` TabPanel)

- [ ] **Step 1: Move + migrate the three loan sections**

Into `<TabPanel value="loans">` place: active loans (`444-530`), take-loan form (`532-624`), loan terms table (`626-659`). Migrations:
- Section wrappers `rounded-xl` divs → `<Card className="p-5 mb-4">`.
- Per-loan inner card (`458`) → `<Card className="p-4">` (nested surface) or keep `bg-cz-subtle rounded-cz` inline.
- Repay/amount `<input>` → `<Input type="number" ...>`; `<select>` → `<Select>`; loan-type/amount labels → `Field` or keep labels.
- All `<button>` → `<Button>`: submit = `variant="primary"`, use-max/start-repay = `variant="secondary"`, cancel `✕` → `<Button variant="ghost" iconOnly aria-label={t("loans.active.cancelRepayAria")}><XIcon size={14} /></Button>`. Pass `loading={takingLoan}` / `loading={repaying}`.
- Progress bar (`490-493`) → `<ProgressMeter value={...} max={100} tone="danger" ariaLabel={...} />`.
- Loan terms `<table>` (`632-657`) → `<Table>/<Tr>/<Th>/<Td>`.
- All `rounded-lg/xl` → `rounded-cz`.

- [ ] **Step 2: Verify build + the loan-config contract is untouched**

Run (in `frontend/`): `node --test && npm run build`
Expected: PASS (no logic change — `handleTakeLoan`/`handleRepay`/`maxPrincipal` math unchanged).

---

## Task 6: Historik tab (season picker + report panel + transaction history)

**Files:**
- Modify: `frontend/src/pages/FinancePage.jsx` (history tab + season fetch in `loadAll`)

- [ ] **Step 1: Fetch the season list in `loadAll`**

Add a seasons query to the `Promise.all` in `loadAll` (FinancePage.jsx:131-151) and a state `const [seasons, setSeasons] = useState([])` + `const [historySeasonId, setHistorySeasonId] = useState(null)`:

```jsx
supabase.from("seasons").select("id, number, status").order("number", { ascending: false }),
```
After resolving: `setSeasons(seasonsRes.data || []);` and default `setHistorySeasonId(activeSeasonId || seasonsRes.data?.[0]?.id || null)`.

- [ ] **Step 2: Render the Historik tab**

Into `<TabPanel value="history">`:

```jsx
<div className="mb-4 flex items-center gap-2">
  <label className="text-cz-3 text-xs">{t("history.seasonPicker")}</label>
  <Select value={historySeasonId || ""} onChange={e => setHistorySeasonId(e.target.value)} className="w-auto">
    {seasons.map(s => (
      <option key={s.id} value={s.id}>
        {t("history.currentSeason") /* when active */ /* else */ } {s.number}
      </option>
    ))}
  </Select>
</div>
{historySeasonId && team?.id && (
  <SeasonFinanceReportPanel seasonId={historySeasonId} teamId={team.id} />
)}
{/* flat transaction history (moved from FinancePage.jsx:661-705) → Card + rounded-cz */}
```
Move the transaction-history section (`661-705`) here, outer div → `<Card>`, keep the `<Link>` rows + `resolveLegacyFinanceMessage` logic; `›` glyph → `<ChevronRightIcon size={16} aria-hidden />`.

- [ ] **Step 3: Remove the old header season-report Link**

Delete `FinancePage.jsx:330-337` (the `📊 page.seasonReport` Link) — the report is now the Historik tab. (Retire the `page.seasonReport` key in Task 10 if unused elsewhere — grep first.)

- [ ] **Step 4: Verify build + tests**

Run (in `frontend/`): `node --test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit Tasks 3-6**

```bash
git add frontend/src/pages/FinancePage.jsx
git commit -F .git/COMMIT_FINANCE_TABS.txt
```
Message: `feat(finance): tabbed Overblik/Lån/Historik + season picker + primitives (Refs #986, #671)`

---

## Task 7: Remove TeamPage EconomyTab + preserve team value on squad

**Files:**
- Modify: `frontend/src/pages/TeamPage.jsx`
- Modify: `frontend/public/locales/{en,da}/team.json`

- [ ] **Step 1: Grep to confirm `economy.*` keys are only used in EconomyTab**

Run: Grep `economy\.` in `frontend/src` (expect hits only in `TeamPage.jsx` EconomyTab). If any other file uses them, do NOT delete those keys.
Expected: confirmation that removal is safe.

- [ ] **Step 2: Remove the EconomyTab function, tab def, and render**

- Delete `EconomyTab` function (`TeamPage.jsx:370-493`).
- Remove `{ key: "economy", label: t("tabs.economy") }` from the tabs array (`:591`).
- Remove the `{activeTab === "economy" && <EconomyTab .../>}` render (`:636-637`).
- Remove now-unused imports if any became dead (check `formatDate` etc. still used elsewhere before removing).

- [ ] **Step 3: Preserve team value on the squad tab**

`totalValue` is already computed at `TeamPage.jsx:579`. Surface it in the squad tab header (near the squad count). Add a `squad.totalValue` key to `team.json` (en + da) and render:

```jsx
<span className="text-cz-3 text-xs">{t("squad.totalValue", { value: formatNumber(totalValue) })}</span>
```
EN: `"totalValue": "Squad value {{value}} CZ$"` · DA: `"totalValue": "Holdværdi {{value}} CZ$"`.

- [ ] **Step 4: Remove dead `economy.*` keys from team.json (en + da)**

Delete the `economy` block (kpi/forecast/breakdown/history/txType/amount/amountSigned) from both locale files. Keep `tabs.economy`? — remove it too (tab is gone).

- [ ] **Step 5: Verify build + i18n + tests**

Run (in `frontend/`): `node --test && npm run build`; (root) `npm run check:i18n`
Expected: PASS (no orphaned keys, parity holds, no missing-key runtime warnings).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/TeamPage.jsx frontend/public/locales/en/team.json frontend/public/locales/da/team.json
git commit -F .git/COMMIT_TEAMPAGE.txt
```
Message: `refactor(team): remove EconomyTab — finance consolidated under /finance (Refs #986)`

---

## Task 8: Repoint inbound links to the Historik tab

**Files:**
- Modify: `frontend/src/pages/SeasonEndPage.jsx:233-239`
- Modify: `frontend/src/pages/SeasonPreviewPage.jsx` (the finance-report button, ~line 235)

- [ ] **Step 1: Repoint SeasonEndPage button**

Change `navigate(\`/seasons/${selectedSeason.id}/finance/${myTeamId}\`)` → `navigate(\`/finance?tab=history&season=${selectedSeason.id}\`)`. (Owner-facing path now lands in the tab; the standalone route stays for admin.)

- [ ] **Step 2: Repoint SeasonPreviewPage button** (same change).

- [ ] **Step 3: Make the Historik tab honor `?season=`**

In FinancePage, after computing `seasons`, initialize `historySeasonId` from `searchParams.get("season")` when present and valid; else default to active. (Extends Task 6 Step 1.)

- [ ] **Step 4: Verify build + that `/seasons/:id/finance/:teamId` route still resolves**

Run (in `frontend/`): `npm run build`. Confirm `App.jsx:197` route is untouched (admin path intact).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SeasonEndPage.jsx frontend/src/pages/SeasonPreviewPage.jsx frontend/src/pages/FinancePage.jsx
git commit -F .git/COMMIT_LINKS.txt
```
Message: `feat(finance): route season-report entry points to the Historik tab (Refs #986)`

---

## Task 9: Emoji → icons, risk-tier → StatusBadge, slop ratchet

**Files:**
- Modify: `frontend/src/components/FinanceForecastCard.jsx` (risk-tier 🟢🟡🔴)
- Modify: `frontend/src/components/FinanceFirstVisitHint.jsx` (💰📈📉⚠️🏦 tiles, × close)
- Modify: `frontend/src/pages/FinancePage.jsx` (📊 already removed in Task 6; ✕ → XIcon done in Task 5)
- Modify: `scripts/ui-slop-baseline.json`

- [ ] **Step 1: FinanceForecastCard risk-tier → StatusBadge tones**

In `getTierMeta`, drop `tier.icon` emoji; render the tier via `<StatusBadge tone={...}>` (green→`success`, yellow→`warning`, red→`danger`) instead of the `rounded-full` span with emoji at `FinanceForecastCard.jsx:95-100`. Keep `tier.label`. NOTE: this component is also rendered on the Dashboard (`FinanceForecastBadge`) — verify both surfaces (Task 12 refreshes `dashboard.png` if needed).

- [ ] **Step 2: FinanceFirstVisitHint → primitives + icons**

Outer `rounded-xl` → `<Card>`; dismiss `×` → `<Button variant="ghost" iconOnly><XIcon/></Button>`; the 4 emoji tiles (💰📈📉⚠️🏦) → matching `ui/icons` (e.g. `CoinIcon`/`TrendingUpIcon`/`TrendingDownIcon`/`AlertTriangleIcon`/`BankIcon` — use the closest existing icon from `ui/icons/index.jsx`; if a needed icon is absent, keep the tile text-only rather than inventing). Tour/skip buttons → `<Button>`.

- [ ] **Step 3: Ratchet the slop baseline**

Run: `node scripts/lint-ui-slop.mjs --update-baseline` then inspect the diff — counts for FinancePage/SeasonFinanceReport/FinanceFirstVisitHint must SHRINK (or entries disappear). Baseline may only shrink.
Run: `npm run test:lint-ui-slop && npm run lint:ui-slop`
Expected: PASS, baseline reduced.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/FinanceForecastCard.jsx frontend/src/components/FinanceFirstVisitHint.jsx scripts/ui-slop-baseline.json
git commit -F .git/COMMIT_SLOP.txt
```
Message: `refactor(finance): risk-tier StatusBadge + icon-ify hint, ratchet slop baseline (Refs #986, #671)`

---

## Task 10: Patch notes + help + docs

**Files:**
- Modify: `frontend/src/pages/PatchNotesPage.jsx`
- Modify: `frontend/public/locales/{en,da}/help.json`

- [ ] **Step 1: Add a patch note** (next version after the current latest — read the top entry first to get the number). User-facing copy, EN-first/DA-second, no em-dash, no invented content. Example: "Økonomisiden er samlet i faner (Overblik · Lån · Historik) — sæson-finansrapporten og holdets økonomi-overblik bor nu ét sted."

- [ ] **Step 2: Update finance help** — note the tab layout + that the season report lives under Historik (or document why no help change is needed). Both `en` and `da` help.json, identical keys.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/PatchNotesPage.jsx frontend/public/locales/en/help.json frontend/public/locales/da/help.json
git commit -F .git/COMMIT_PATCHNOTES.txt
```
Message: `docs(finance): patch note + help for economy consolidation (Refs #986)`

---

## Task 11: Full local gate

**Files:** none (verification)

- [ ] **Step 1: Run the consolidated local gate**

Run: `pwsh -File scripts/verify-local.ps1` (backend tests + frontend `node --test` + frontend build).
Expected: all PASS.

- [ ] **Step 2: Run the rest of the CI gate set** (per `feedback_full_ci_gate_before_pr`)

Run (root): `npm run lint` · `npm run check:i18n` · `node scripts/check-eslint-warning-budget.mjs` · `npm run test:lint-ui-slop && npm run lint:ui-slop` · the tone/em-dash check.
Expected: all PASS (warning budget not exceeded).

---

## Task 12: Playwright snapshots (all 3 projects) + visual verify

**Files:** possibly `frontend/tests/e2e/core-smoke.spec.js-snapshots/*.png`

- [ ] **Step 1: Run core-smoke on ALL 3 projects**

Run (in `frontend/`): `npx playwright test core-smoke.spec.js` (no `--project` flag → desktop-chromium + mobile-chromium + mobile-webkit).
Expected: PASS, OR diffs on `finance.png` / `dashboard.png` / `team.png` exceeding masked tolerance.

- [ ] **Step 2: If (and only if) diffs exceed tolerance, refresh + commit the PNGs**

Run (in `frontend/`): `npx playwright test core-smoke --update-snapshots` (all 3, win32) and commit the regenerated `*.png`. Never refresh desktop-only (mobile snapshots differ).

- [ ] **Step 3: Logged-in visual verify via Playwright mocks** (per `feedback_local_logged_in_verify_via_playwright_mocks`)

Drive a mocked session (fixtures.js) and screenshot `/finance` (each tab) + `/team` (squad) + the `/seasons/:id/finance/:teamId` route, in both themes once, to confirm the Card/icon/StatusBadge/tab swaps render and nothing is lost.

- [ ] **Step 4: Commit any snapshot refresh**

```bash
git add frontend/tests/e2e/core-smoke.spec.js-snapshots
git commit -F .git/COMMIT_SNAPSHOTS.txt
```
Message: `test(finance): refresh core-smoke snapshots for tabbed finance (Refs #986)`

---

## Task 13: Close-out docs + PR

**Files:**
- Modify: `docs/NOW.md`, `docs/FEATURE_STATUS.md`, `docs/superpowers/plans/2026-06-15-ui-foundation-plan4-rollout.md`

- [ ] **Step 1: Update close-out docs** — NOW.md (Next action + reset Working agent, ≤~1200 tok), FEATURE_STATUS if finance contract changed, the Plan 4 rollout doc with the Finance slice + sweep findings + the consolidation decision.

- [ ] **Step 2: Commit docs**

```bash
git add docs/NOW.md docs/FEATURE_STATUS.md docs/superpowers/plans/2026-06-15-ui-foundation-plan4-rollout.md docs/superpowers/plans/2026-06-16-finance-consolidation.md
git commit -F .git/COMMIT_DOCS.txt
```

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin feat/986-finance-consolidation
gh pr create --title "feat(finance): consolidate economy under /finance tabs (Plan 4 + #986)" --body-file .git/PR_BODY.txt
```
PR body MUST include a **## Brugerverifikation** section with `- [x]` items (zero behavior change to loan/forecast logic; tab navigation; season picker; team-value preserved on squad; admin report route intact). Body: `Refs #986, #671`. Co-Authored-By line. No `database/*.sql` → normal PR flow (no owner-merge gate). Auto-push done.

---

## Self-Review (spec coverage)

- #986 pt.1 (Mit Hold økonomi → startskærm): EconomyTab removed; its content was redundant with the forecast card (already on Overblik). ✅ (team value preserved on squad — Task 7)
- #986 pt.2 (correct forecast): already shipped; stays on Overblik. ✅
- #986 pt.3 (Fordeling → separate tab + season picker + report coupling): Historik tab + season picker + `SeasonFinanceReportPanel`. ✅ (Tasks 2, 6)
- #986 pt.4 (sponsor-modifier curve): placeholder is dormant (`sponsor_modifier_curve` always null today) — it travels with the report panel into Historik; no live curve to move. ✅ (noted, not re-built)
- #986 pt.5 (loans own tab + summary line on overview): Lån tab + one-line loan summary on Overblik. ✅ (Tasks 4, 5)
- Owner principle (nothing scattered): scattered teasers verified as correct entry-points; only EconomyTab removed; report route kept for admin only. ✅
- Plan 4 primitive migration of the whole flade + slop ratchet + snapshots. ✅ (Tasks 4-6, 9, 12)
- No backend/`database/*.sql`. ✅
