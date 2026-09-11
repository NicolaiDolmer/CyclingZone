# Perf-baseline 2026-09-11 (#5131)

READ-ONLY måling, ingen kodeændring. Metode: `npx lighthouse@latest` (resolved
**v13.4.1**), headless Chromium (Playwright's `chromium-1234`, da systemets
Chrome ikke findes), 3 kørsler pr. side × preset, **median** rapporteret.
`--only-categories=performance`.
Rå tal: [`perf-baseline-2026-09-11.json`](perf-baseline-2026-09-11.json).
Fulde Lighthouse-JSON-rapporter (24 stk., ~650 KB/stk.) ligger kun i sessionens
scratch-mappe, ikke i repoet — for store til at committe, og alt relevant er
allerede udtrukket til JSON'en her.

**Tærskler (offentlige sider):** LCP ≤ 2,5 s (mobil) · INP ≤ 200 ms · CLS ≤ 0,1 ·
Performance ≥ 90. Lighthouse-lab måler ikke INP (kræver field-data/CrUX) —
**Total Blocking Time (TBT)** bruges som lab-proxy og kan afvige fra ægte INP.

## 1. Lighthouse — median af 3 kørsler

| Side | Preset | Perf | LCP | TBT (INP-proxy) | CLS | Transfer | Requests | Verdikt |
|---|---|---:|---:|---:|---:|---:|---:|:---:|
| Forside (`/`) | mobil | 77 | 4112 ms | 81 ms | 0,114 | 515 KB | 35 | 🔴 |
| Forside (`/`) | desktop | 85 | 688 ms | 0 ms | 0,29 | 515 KB | 35 | 🔴 |
| `/login` | mobil | 85 | 3489 ms | 91 ms | 0,00 | 591 KB | 41 | 🟡 |
| `/login` | desktop | 99 | 755 ms | 0 ms | 0,00 | 591 KB | 41 | 🟢 |
| `/roadmap` | mobil | 49 | 5665 ms | 54 ms | 0,517 | 618 KB | 60 | 🔴 |
| `/roadmap` | desktop | 74 | 1320 ms | 0 ms | 0,553 | 618 KB | 60 | 🔴 |
| Marketing-forside (cycling-zone-marketing.vercel.app) | mobil | 96 | 2590 ms | 136 ms | 0,00 | 316 KB | 13 | 🟡 |
| Marketing-forside | desktop | 100 | 583 ms | 0 ms | 0,00 | 315 KB | 13 | 🟢 |

Verdikt = værste enkeltmetrik mod tærsklerne (LCP/CLS/Performance; grænser:
grøn = CWV "good"/≥90, gul = CWV "needs improvement"/50-89, rød = CWV "poor"/<50).

**Offentlig ranglisteside uden login:** findes ikke. `/standings`
(`RankingsHubPage`) ligger i `App.jsx` under `ProtectedRoute` — al rangliste
kræver login. Ikke målt.

**Kørsel-til-kørsel-spredning:** roadmap mobil Performance svingede 49/70/49 —
enkeltkørsler kan afvige markant fra medianen (netværks-jitter i CI-miljøet);
brug medianen, ikke enkeltkørsler, til beslutninger.

## 2. Bundle-tabel (frontend, gzip)

Total gzippet JS: **1144,1 KB** (200 chunks). `check-bundle-budget.mjs`: ✅
inden for budget (1138 KB + 5% margin). `audit-perf-seo.mjs`: 0 🔴, 1 🟡 (bundle
100% af budget), SEO/crawl alt 🟢.

| # | Chunk | Gzip |
|---:|---|---:|
| 1 | index | 232,6 KB |
| 2 | module | 88,9 KB |
| 3 | CategoricalChart | 88,5 KB |
| 4 | supabase | 53,0 KB |
| 5 | PlanningHubPage | 40,8 KB |
| 6 | RiderStatsPage | 37,8 KB |
| 7 | RaceDetailPage | 33,3 KB |
| 8 | AdminGrowthPage | 29,9 KB |
| 9 | DashboardPage | 24,2 KB |
| 10 | BoardPage | 19,6 KB |
| 11 | AdminEconomyTab | 16,8 KB |
| 12 | AuctionsPage | 14,0 KB |
| 13 | intl | 13,8 KB |
| 14 | NotificationsPage | 13,3 KB |
| 15 | TrainingPage | 13,0 KB |

## 3. Top 3 fund (størst effekt)

1. **Footer-wordmark uden dimensioner giver CLS på tværs af alle sider.**
   `<img src="/brand/wordmark-ondark.svg" class="h-4 ...">` i footeren mangler
   `width`/`height` (Lighthouse: "Media element lacking an explicit size").
   Ses som layout-shift-årsag på både forside mobil (CLS 0,114) og forside
   desktop (CLS 0,29) — samme footer ligger i `Layout.jsx` og rammer
   formentlig alle sider der bruger den. **Forventet gevinst:** ét ét-linjes
   fix (sæt eksplicit `width`/`height` eller `aspect-ratio`) kan fjerne en
   væsentlig del af CLS sitewide — billigste/højeste-ROI fund på listen.
2. **`/roadmap` er den svageste offentlige side, med to adskilte problemer.**
   Mobil: Performance 49, LCP 5,7 s, CLS 0,517 (alle langt over tærsklerne).
   Layout-shiftet er en stor sektion ("Løb — hvor det er i dag") der forskyder
   ~5.365 px indhold efter load — det er et **CLS-spor** (reserveret
   plads/skeleton før data er klar); det ændrer ikke LCP. Den høje mobil-LCP
   (5,7 s) er et **separat spor** (se fund 3) og skal løses selvstændigt —
   siden bliver ikke grøn/gul af CLS-fixet alene, da verdiktet bruger værste
   metrik. Desktop deler CLS-problemet (0,553) selvom LCP der er fint (1,3 s).
   **Forventet gevinst:** CLS-fixet er billigst og fjerner det værste enkelttal;
   fuld grøn/gul kræver derudover LCP-arbejdet fra fund 3.
3. **Mobil-LCP er rødt/gult på alle tre SPA-sider (forside 4,1 s, login 3,5 s,
   roadmap 5,7 s)** mens marketing-sitet (Next.js, prerenderet) ligger på 2,6 s.
   Fælles delårsag: render-blocking `index-*.css` + `chunk-selfheal.js` (~150-
   300 ms spildtid pr. side) og uudnyttet JS (56-99 KiB estimeret) lastet også
   på sider der ikke bruger det. **Forventet gevinst:** at udskyde/inline'e det
   render-blokerende CSS og splitte uudnyttet JS kan realistisk barbere flere
   hundrede ms af LCP på tværs af hele SPA'en, ikke kun én side — størst
   spredningseffekt af de tre fund.

Alle tre bør blive egne spor/issues (ikke løst i denne PR — ren måling).

## 4. Dækning: D-047 mobilstandard (navn + 3 kolonner, ingen vandret scroll)

D-047 (#5102, ejer 10/9) gik live via **PR #5111** (10/9 kl. 19:07) for tabeller
der bruger den delte `DataTable`-komponent.

**Gennemgået (bruger `DataTable`):** Academy, AdminValueTransition,
GlobalRank, HallOfFame, RiderRankings, Riders, StaffOverview, Standings, Team,
TeamProfile, Watchlist, AdminFeedbackTab, AdminForumTab + KitchenSink (i alt
19 tabeller ifølge #5124 — grep viser `DataTable`-import i 14 side-filer,
nogle sider har mere end én tabel).

**IKKE gennemgået — egne håndrullede tabeller (åbent issue #5124):**

| Side | Fil | Hvorfor særlig |
|---|---|---|
| Auktioner | `AuctionsPage.jsx` | sticky HØJRE bud-kolonne |
| Transferlisten | `TransfersPage.jsx` | bulk-select + udvidelig række |
| Daglig træning | `TrainingPage.jsx` | multi-select + gruppe-header-rækker |
| Sæsonmatricen | `racehub/SeasonMatrix.jsx` | rå `<table>` |

Ejer-audit (docs/audits/2026-09-10-mobil-stemmer.md) peger netop på transfers
og træning som "almost unplayable" på telefon — højeste prioritet af de fire.

**Bredere mobil-huller (epic #1602, delvist overlap, ikke D-047-specifikt):**
RiderCompare klipper på 360px, Finance loan-terms-tabel klipper sidste kolonne
(`overflow-hidden`), touch-targets <44px håndhævet i kun 9/40 filer, og
overflow+sticky-mønsteret er duplikeret i 27 filer (ingen delt komponent).

---
*Denne fil + `perf-baseline-2026-09-11.json` er READ-ONLY-leverancen for #5131.
Ingen kode i `frontend/`, `marketing/` eller config er ændret.*
