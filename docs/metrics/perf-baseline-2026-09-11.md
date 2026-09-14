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
| Forside (`/`) — efter spor 1 (#5177) | mobil | 73 | 4296 ms | 143 ms | 0,114 | 490 KB | 35 | 🔴 |
| Forside (`/`) — efter spor 1 (#5177) | desktop | 99 | 816 ms | 0 ms | **0,052** | 490 KB | 35 | 🟢 |
| `/login` — efter spor 1 (#5177) | mobil | 72 | 4991 ms | 36 ms | 0,00 | 583 KB | 42 | 🔴 |
| `/login` — efter spor 1 (#5177) | desktop | 98 | 1041 ms | 0 ms | 0,00 | 583 KB | 42 | 🟢 |
| `/roadmap` — efter spor 1 (#5177) | mobil | 68 | 5834 ms | 54 ms | 0,00* | 596 KB | 59 | 🔴 |
| `/roadmap` — efter spor 1 (#5177) | desktop | 75 | 1208 ms | 0 ms | 0,553 | 596 KB | 59 | 🔴 |
| `/roadmap` — efter spor 2 (#5177, 14/9) | mobil | 72 | 5573 ms | 0 ms | **0,000** | 610 KB | 60 | 🔴 |
| `/roadmap` — efter spor 2 (#5177, 14/9) | desktop | 97 | 1188 ms | 0 ms | **0,038** | 610 KB | 60 | 🟢 |

### Spor 3 (#5177, 14/9) — sitewide i18n-bundle + flag-icons-CSS

Egen før/efter-serie, målt i ÉN session med samme metode (lokal
`npm run build` + `npm run preview`, `localhost`, Lighthouse **mobil**, 3
kørsler pr. side, median, Playwright-Chromium). Rækkerne herunder skal kun
sammenlignes indbyrdes — ikke med `cyclingzone.org`-rækkerne ovenfor.

| Side | Perf | LCP | FCP | TBT | CLS | Transfer | Requests |
|---|---:|---:|---:|---:|---:|---:|---:|
| `/` før | 76 | 3990 ms | 3545 ms | 36 ms | 0,114 | 490 KB | 35 |
| `/` **efter** | 77 | **3919 ms** | **3192 ms** | 90 ms | 0,114 | 501 KB | 36 |
| `/login` før | 75 | 4878 ms | 3453 ms | 0 ms | 0,037 | 584 KB | 42 |
| `/login` **efter** | 78 | **4392 ms** | **3177 ms** | 85 ms | 0,037 | 512 KB | 41 |
| `/roadmap` før | 70 | 5850 ms | 3623 ms | 0 ms | 0,000 | 612 KB | 61 |
| `/roadmap` **efter** | 74 | **5228 ms** | **3169 ms** | 64 ms | 0,037 | 540 KB | 60 |

**Vigtigt forbehold — dette er WORST CASE.** Lighthouse-Chromium på målemaskinen
melder et dansk `navigator.language`, så alle rækker er målt som en **dansk**
besøgende. Netop dén besøgende er den eneste der ikke får i18n-gevinsten:
engelsk er `fallbackLng` og ligger stadig inline, så dansk henter begge bundles
(69,5 + 73,0 KB gzip mod 131,2 KB før = +11,4 KB, fordi gzip-ordbogen er pr.
fil). En **engelsk** besøgende henter kun de 69,5 KB, altså −61,7 KB kritisk JS
oveni flag-gevinsten. Tallene ovenfor viser derfor kun flag-CSS-effekten plus en
lille i18n-STRAF; den engelske forbedring er større.

- **Flag-icons-CSS (85 KB, 99,9 % ubrugt ifølge `unused-css-rules`) er væk fra
  alle tre sider.** Den blev trukket ind af `LanguageSwitcher`s to 20×15 px flag
  og lå derfor i entry-chunkens CSS-graf; switcheren bruger nu inline SVG.
  `/login` −72 KB, `/roadmap` −72 KB transfer. `/` viste den aldrig (landing har
  ingen sprogvælger), så `/`-transferen er netto +11 KB fra i18n-splittet alene.
- **FCP falder 350-450 ms på alle tre sider**, fordi den danske bundle ikke
  længere skal hentes og parses før first paint.
- **TBT stiger 0-36 ms → 64-90 ms.** Reelt og reproducerbart, ikke støj: arbejde
  der før lå FØR FCP (entry-grafens modul-evaluering) ligger nu efter, og TBT
  måler kun vinduet efter FCP. Alle værdier er stadig klart under 200 ms-
  tærsklen, så INP-proxyen er fortsat grøn.
- **`/roadmap`-CLS 0,000 → 0,037** — samme kendte flakiness som noten under
  "efter spor 1" (2 af 3 kørsler 0,037, én 0). Begge tal er grønne.

**LCP-målet (< 2.500 ms) er stadig IKKE ramt** — 5.228 ms på `/roadmap`. Se
fund 3 for hvad der er tilbage.

Verdikt = værste enkeltmetrik mod tærsklerne (LCP/CLS/Performance; grænser:
grøn = CWV "good"/≥90, gul = CWV "needs improvement"/50-89, rød = CWV "poor"/<50).

**"Efter spor 1" (#5177, 13/9) — metode-forbehold:** disse rækker er målt mod
en **lokal production-build** (`npm run build` + `npm run preview`,
`localhost:4173`), IKKE mod `cyclingzone.org` som resten af tabellen —
ændringen er endnu ikke deployet. Tal på tværs af de to metoder er derfor
ikke 1:1 sammenlignelige (anden cache/CDN/netværk); brug kun disse rækker
til at vurdere **CLS-effekten af selve fixet**, ikke til at genvurdere de
øvrige metrikker (LCP/Performance) mod baseline. **Mål ramt:** forside
desktop CLS 0,29 → **0,052** (< 0,1-tærsklen). Mobil-CLS og roadmap-CLS er
uændrede/uafhængige som forventet — spor 1 rørte kun `Brand.jsx`-wordmarken;
forside mobil (0,114) og roadmap-desktop (0,553) har andre/adskilte
shift-kilder (se fund 2 nedenfor, uløst). `/login`-CLS gik fra ~0 til
nøjagtigt 0 (støj i tredje decimal, ikke en reel ændring — `/login` bruger
ikke footer-wordmarken).
\* Roadmap mobil-CLS er kendt flaky (se spredningsnoten nedenfor): 2 af 3
kørsler gav 0, én gav 0,517 (identisk med baseline) — medianen 0 er ikke et
reelt fix, kun en tilfældig timing af sektionen "Løb — hvor det er i dag"
(fund 2, urørt af denne PR). Roadmap-desktop (0,553, alle 3 kørsler ens)
viser tydeligt at fund 2 stadig står uløst.

**"Efter spor 2" (#5177, 14/9) — samme metode-forbehold som spor 1** (lokal
preview-build, `localhost:4173`, IKKE 1:1 sammenlignelig med
`cyclingzone.org`-rækkerne). **CLS-målet er ramt, robust denne gang:** mobil
0,517 → **0,000** (alle 3 kørsler, ikke kun medianen — ingen af spor 1's
flakiness) og desktop 0,553 → **0,038**, begge klart under 0,1-tærsklen.
Fund 2's "next"-liste skiftede fra korte statiske i18n-bullets til en langt
højere stemme-UI når Supabase-kaldet landede; fix var en `Skeleton`-baseret
placeholder i samme højde som den rigtige stemme-UI (reserverer pladsen fra
første paint) + at intro-linjen ikke længere popper ind bagefter og skubber
den allerede-malede races-sektion ned. Se PR #5217 for detaljer.
**LCP-målet (< 2.500 ms) er IKKE ramt:** mobil 5.834 ms → 5.573 ms (kun
-261 ms; performance-score 68→72, primært CLS-scorens bidrag). Roadmap-
scoped JS blev reduceret (AdminCreateForm lazy-splittet ud, -3,8 KB fra
roadmap-chunken), men LCP-elementet er stadig en tekst-node hvis paint-tid
domineres af sitewide, delte assets uden for denne branch' fil-ejerskab:
render-blokerende `chunk-selfheal.js` + `index-*.css` (uændret siden fund 3,
ikke rørt her) OG to store, globalt-loadede chunks fundet under denne
måling — `i18n-messages-*.js` (131 KB transfer) og `flag-icons-*.css`
(85 KB transfer, importeret fra `main.jsx` for en lille sprog-vælger-ikon) —
tilsammen ~216 KB af siden 610 KB total, uafhængigt af hvilken side der
besøges. Disse to bør blive egne fund/spor (ikke løst her — ude af
`frontend/src/pages/Roadmap*`-ejerskabet, se PR-slutrapport).

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
   desktop (CLS 0,29) — samme footer ligger i `Brand.jsx` og rammer
   formentlig alle sider der bruger den. **Forventet gevinst:** ét ét-linjes
   fix (sæt eksplicit `width`/`height` eller `aspect-ratio`) kan fjerne en
   væsentlig del af CLS sitewide — billigste/højeste-ROI fund på listen.
   **Status 13/9:** løst som #5177 spor 1 (PR #5189) — forside desktop CLS
   0,29 → 0,052, se "efter spor 1"-rækkerne ovenfor. Mobil-CLS og roadmap
   var uændrede (andre shift-kilder, jf. fund 2), som forventet.
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
   **Status 14/9:** CLS-delen løst som #5177 spor 2 (PR #5217) — mobil
   0,517 → **0,000**, desktop 0,553 → **0,038**, se "efter spor 2"-rækkerne
   ovenfor. LCP-delen (5,7 s → 5,6 s) er IKKE løst — se opdateret fund 3.
3. **Mobil-LCP er rødt/gult på alle tre SPA-sider (forside 4,1 s, login 3,5 s,
   roadmap 5,7 s)** mens marketing-sitet (Next.js, prerenderet) ligger på 2,6 s.
   Fælles delårsag: render-blocking `index-*.css` + `chunk-selfheal.js` (~150-
   300 ms spildtid pr. side) og uudnyttet JS (56-99 KiB estimeret) lastet også
   på sider der ikke bruger det. **Forventet gevinst:** at udskyde/inline'e det
   render-blokerende CSS og splitte uudnyttet JS kan realistisk barbere flere
   hundrede ms af LCP på tværs af hele SPA'en, ikke kun én side — størst
   spredningseffekt af de tre fund.
   **Status 14/9 (#5177 spor 2, PR #5217):** roadmap-scoped JS reduceret
   (AdminCreateForm lazy-splittet, -3,8 KB), men LCP stod stort set stille
   (5.834 ms → 5.573 ms). Netværkslog fra samme måling fandt to yderligere,
   STORE, sitewide bidragsydere — begge uden for `frontend/src/pages/
   Roadmap*`-ejerskabet, så urørt her: `i18n-messages-*.js` (131 KB transfer,
   `vite.config.js`-chunking) og `flag-icons-*.css` (85 KB transfer, eager
   import i `main.jsx` for `LanguageSwitcher`s flag-ikon) — tilsammen ~35 %
   af sidens 610 KB, uafhængigt af hvilken rute der besøges. Sammen med
   render-blocking `chunk-selfheal.js`/`index-*.css` er dette den reelle
   LCP-flaskehals; bør blive sit eget spor/issue (global scope, ikke en
   enkelt-side-fix).
   **Status 14/9 (#5177 spor 3):** begge de to sitewide bidragsydere er
   behandlet — se "Spor 3"-tabellen ovenfor. Flag-CSS'en er helt væk fra
   den kritiske sti (−72 KB på `/login` og `/roadmap`), og i18n-bundlen er
   splittet pr. sprog (−61,7 KB for en engelsk besøgende; en dansk betaler
   +11,4 KB, bevidst bytte, EN-first). LCP faldt 5.850 → 5.228 ms på
   `/roadmap` — stadig langt fra 2.500 ms.
   **Det der nu er tilbage, målt med `render-blocking-insight`:**
   estimeret spildtid faldt 330 ms → 160 ms, og de to poster er
   `chunk-selfheal.js` (10 KB, **615 ms** parser-blokering — den er en
   classic `<script src>` i `<head>` og skal blive der, men behøver ikke
   være en separat REQUEST: inlines den, forsvinder rundturen uden at
   semantikken ændres) og `index-*.css` (16,7 KB, 315 ms, 89,7 % ubrugt —
   Tailwinds sitewide utility-sæt; kan ikke gøres non-blocking uden FOUC på
   sidehovedet). Ingen af de to er rørt her: `chunk-selfheal` er den mest
   sikkerhedskritiske fil i repoet (#4595/CYCLINGZONE-56) og fortjener sin
   egen PR med ejer-go, ikke en sidegevinst i et perf-spor. Resten af
   LCP'en er `elementRenderDelay` (975 ms målt i `lcp-breakdown-insight`),
   altså ren JS-eksekvering frem til at roadmap-teksten males.

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
