# Plan: det bedste manager-browserspil på pc, mobil og app (#8243)

Undersøgelse 16/11, kun læsning. Refs #8243 #8069 #6584 #6494 #6165.

## 1. Nutiden, målt

### Ægte spillere (Microsoft Clarity, 14.-16/11, ikke-bots, 307 sessioner: 179 mobil, 128 pc)

| p75 | Mobil | PC | Google "god" |
|---|---|---|---|
| LCP | 3,23 s | 3,75 s | ≤ 2,5 s |
| INP | 272 ms | 288 ms | ≤ 200 ms |
| CLS | 458* | 346* | ≤ 0,1 |

\* Clarity kalder feltet "CLSInMS". Tallet er sandsynligvis CLS × 1000 (0,46 / 0,35), og så ligger begge i "dårlig" (> 0,25). Enheden bør bekræftes, før den bruges som mål.

Gennemsnittet for LCP på pc er 22 s, trukket op af få ekstreme sessioner (formentlig faner i baggrunden). p75 er det rigtige tal.

**Værste INP på mobil (gennemsnit pr. side):** rytterprofiler 0,9-6,7 s, holdsider 1,0-3,7 s, /transfers 2,0 s og /standings 0,7 s. Spilleren trykker, og der sker intet i sekunder. Det rammer de sider, et managerspil lever af.

Web-vitals-biblioteket er installeret (`frontend/src/lib/webVitalsIntegration.jsx`), men sender kun til GA4. Det er bag samtykke og uden attribution, så ingen kan se tallene pr. rute uden at åbne GA4.

### Bundle (Lighthouse CI på main, run 43859125812, 16/11)

- Første indlæsning: **435,3 KB gzip mod loftet 435,8 KB**, altså 0,5 KB luft. Det består af `i18n-messages-en` 91,3 KB, `react-vendor` 66,0 KB, `supabase` 55,3 KB, `index` 45,7 KB, `i18n` 18,3 KB og det største valgfrie sprog (fr) 101,7 KB.
- Største lazy-stykker: RaceDetailPage 52,6 KB (loft 54,6), PlanningHubPage 48,5 KB, RiderStatsPage 41,7 KB, DashboardPage 30,5 KB og TrainingPage 28,7 KB.
- Samlet trend: 1392,6 KB fordelt på 275 chunks. `bundle-budget.json` har mere end 40 loft-hævninger med noter. Vægten vokser for hver feature.

### Lighthouse

- CI (`lighthouserc.json`) måler kun **desktop** og kun **statiske filer**: 404.html, app.html-skallen, index (landing), en Google-verifikationsfil og race-planning-preview.html. Ingen indlogget spillerside bliver målt, og mobil bliver slet ikke målt.
- På PR-run 43857626763 er der advarsler om perf og a11y på race-planning-preview og om a11y og best practices på verifikationsfilen.
- Det ugentlige `perf-seo-review.yml` er endt som **failure tre uger i træk** (26/10, 2/11, 9/11), selv om SEO-score er 100 på alle seks offentlige sider. Ingen reagerer på den røde status.

### Tilgængelighed (axe 4.14, ratchet-baseline `frontend/tests/e2e/axe-baseline.json` på main)

Der er 8 flader × 3 Playwright-projekter, i alt **229 kendte fund**:

- color-contrast: 181 (79 %). Fundene samler sig om tokens som `text-cz-sidebar-3` og `text-cz-accent-t`, dvs. sidebjælken og accenttekst.
- label-content-name-mismatch: 33
- heading-order: 6
- scrollable-region-focusable: 4
- link-in-text-block: 3
- landmark-unique: 1
- empty-table-header: 1

Dashboard har flest fund (32 på desktop, 22 på mobil). Training har 0 på mobil.

### Stakken (`frontend/package.json` v4.34.0)

React 19.3, react-router 8.5, Vite 8, Tailwind 4.3, TypeScript 7 (checkJS), TanStack Query 5.107, Supabase JS 2.119, i18next 26 (5 sprog), recharts 3.10, Sentry, PostHog-lite, Clarity, Vercel Analytics, Playwright og axe.

Der er **ingen** komponent-primitiver (Radix/React Aria), ingen tabel- eller virtualiseringsbibliotek, intet komponentkatalog og intet motion-bibliotek.

PWA findes allerede: `public/manifest.webmanifest`, `public/sw.js`, `src/pwa/` (installPrompt, push, TWA-pakke). #6584 er markeret claude:done.

**Kodesignaler:**

| Signal | Antal |
|---|---|
| UI-filer med direkte `supabase.from(` | 41 |
| Filer med useQuery/useMutation | 7 |
| JSX-filer med `useEffect(` | 149 |
| Filer med håndrullet `role="dialog"`, `"menu"` eller `"tablist"` | 34 |
| JSX-filer med `<table` | 35 (ingen virtualisering) |
| Playwright-screenshots | 79 PNG fra 8 specs |

## 2. Sammenligning med de bedste

- **Football Manager / FM Mobile:** tætte tabeller med valgfrie kolonner, sortering, filtre og sammenligning side om side. Tastaturgenveje. Navigation føles øjeblikkelig, fordi data allerede er lokalt.
- **Hattrick:** let, hurtig og virker på enhver enhed. Spillet holder i over 25 år, fordi siderne er simple og hurtige, ikke flotte.
- **Top Eleven / Online Soccer Manager:** mobil først, push ved kampresultater og korte daglige sløjfer. Butiksapp via native wrapper.
- **Bedste webapps (Linear, Figma):** INP under 100 ms via lokal cache og optimistiske opdateringer, kommando-palet og konsekvente tilgængelige primitiver.

Fællesnævneren er, at de bedste føles **øjeblikkelige** og er **tætte uden at være rodede**. Cycling Zone halter netop på øjeblikkelighed: INP og LCP ligger over grænsen, og datalaget har ingen fælles cache.

## 3. Rangeret plan (top 12)

Rækkefølgen er sat efter gevinst for spilleren pr. indsats. Ejeren afgør bagefter.

| # | Hvad | Gevinst for spillerne (målbar) | Pris | Risiko | Første skridt |
|---|---|---|---|---|---|
| 1 | **Feltmåling som sandhed:** web-vitals *attribution*-build sender LCP/INP/CLS pr. rute og enhed til PostHog (ikke kun GA4) og får et dashboard med p75-mål | Alle nedenstående punkter kan bevises. Mål: p75 LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1 | S (1 PR) | Lav. Samme samtykke-gate | Udvid `webVitalsIntegration.jsx` med `web-vitals/attribution` og en PostHog-capture. Bekræft CLS-enheden mod Clarity |
| 2 | **Kontrast via tokens (TASTE):** ret de få tokens (`cz-sidebar-3`, `cz-accent-t` m.fl.) centralt i stedet for side for side | 181 af 229 axe-fund (79 %) forsvinder. Læsbarhed i sol på mobil | S | Lav. Visuel ændring kræver ejer-billede | Kontrasttabel over alle `--cz-*`-tokens i lys og mørk tilstand, AA-forslag og ejer-go |
| 3 | **INP-jagt på rytter-, hold-, transfer- og standings-sider** | Tryk reagerer under 200 ms i stedet for 1-6,7 s. Mål: p75 INP ≤ 200 ms på /riders/:id og /teams/:id | M | Mellem | Clarity-optagelser af de værste sessioner og React Profiler i preview-mock. Derefter `useTransition` og `useDeferredValue` på tunge filtre/faner, memo på rækker og lazy hover-kort |
| 4 | **CLS:** faste pladsholdere (PAGE_TEMPLATES' loading-markup med kendt højde), dimensioner på billeder og flag, `font-display` | Siden hopper ikke, og man rammer ikke forkert knap. Mål: CLS ≤ 0,1 | S-M | Lav | Find de største shift-kilder med web-vitals-attribution fra punkt 1 |
| 5 | **Første indlæsning ned:** del den inlinede engelske i18n (91 KB) op pr. rute med ready-gate, og hent Supabase-klienten lazy på offentlige sider | LCP på mobil fra 3,2 s mod 2,5 s. Giver luft under loftet (0,5 KB i dag), så features ikke venter på loft-hævninger | M | Mellem. Loader-blink ved navigation (ejer-trade-off, jf. #4231) | Mål hvilke namespaces dashboardet reelt bruger. Prototype på ét namespace |
| 6 | **Ét datalag (TanStack Query, #6494):** de 41 UI-filer med direkte `supabase.from` flyttes til queries med fælles cache, prefetch ved hover og optimistiske mutationer | Tilbage-navigation uden spinner, færre DB-kald og konsistente tal på tværs af sider. Mål: andel navigationer uden loader | L (gradvis) | Mellem | Fortsæt #6494 med top-5-sider efter trafik. Lint-regel mod nye `supabase.from` i `pages/` |
| 7 | **Tilgængelige primitiver (React Aria Components eller Radix):** erstat de 34 håndrullede dialog-, menu- og tab-komponenter | Tastatur, fokusfælde og skærmlæser virker ens overalt. Rammer label-, heading- og scroll-fund | M | Mellem. Bundle +10-20 KB, hvis det ikke tree-shakes | Vælg ét bibliotek (React Aria, fordi det er headless og passer til Tailwind og TASTE) og migrér Dialog først |
| 8 | **Lighthouse CI på rigtige spillersider + mobil:** kør LHCI mod preview-mock (dashboard, rytter, løb, træning, marked) med mobil-preset og et budget pr. rute. Gør det ugentlige røde run grønt eller luk det | Regressioner fanges før spillerne mærker dem. I dag måles 0 indloggede sider | S-M | Lav | Tilføj `url`-liste og mobil-preset til `lighthouserc.json` med `e2e-static-server` og preview-mock. Diagnosticér `perf-seo-review.yml` |
| 9 | **Komponentkatalog + visuel regression:** en intern `/dev/katalog`-rute i preview-mocken med alle kort, tabeller og knapper i lys og mørk, snapshottet af Playwright. **Ikke Storybook** | Ét udseende på web, mobil og app (#8069) og færre "ser forkert ud"-fejl | M | Lav | Én katalogside med Card, Button, Table, Badge og 3 Playwright-snapshots (desktop, mobil-chromium, webkit) |
| 10 | **Tabeller i FM-klasse (TanStack Table + Virtual):** valgfrie kolonner, sortering, sticky første kolonne, virtualisering af lange lister og gemte visninger | Rytterlister og marked bliver hurtige og tætte som FM. Mål: INP på /riders og /auctions | M-L | Mellem. 35 tabeller | Rytterlisten som pilot bag en kontakt |
| 11 | **App (#6584): TWA-polering, ikke Capacitor nu.** Offline-skal, push ved løbsresultater og app-genveje | Push-genbesøg og en app-følelse på Android (ejer og spillere). Capacitor giver kun noget for iOS eller native API'er | S-M | Lav | Tjek installability og push-opt-in i Play-buildet. Capacitor genovervejes først ved iOS-krav |
| 12 | **Motion med måde:** View Transitions API (react-router `viewTransition`) og CSS-overgange med `prefers-reduced-motion`. Intet Framer Motion | Navigation føles flydende uden bundle-vægt | S | Lav | Én overgang (liste til rytterprofil) bag en kontakt |

### Fravalgt nu

- **TanStack Router:** react-router 8 fungerer. En migrering koster meget og giver spillerne næsten intet.
- **Storybook:** tung værktøjskæde ved siden af Vite og Playwright. Punkt 9 giver det samme med eksisterende værktøj.
- **Capacitor:** se punkt 11.

## 4. Anbefalet første bølge (uafhængige spor)

1. Punkt 1 (feltmåling) og punkt 8 (LHCI på rigtige sider). Det er måleinstrumenterne.
2. Punkt 2 (kontrast-tokens), som kræver ejer-billede.
3. Punkt 3 (INP på rytter- og holdsider) med Clarity-optagelser som bevis.

Punkt 4-12 rangeres af ejeren efter, at punkt 1 har givet tal pr. rute.

## Kilder

- Clarity-dashboard (MCP), 14.-16/11
- GitHub Actions run 43859125812 (main) og 43857626763 (PR)
- `frontend/tests/e2e/axe-baseline.json`
- `frontend/package.json`
- Web: [AlternativeTo: PManager/Hattrick](https://alternativeto.net/software/pmanager/), [FRVR: sports management sims ranked](https://frvr.com/blog/news/ranking-football-managers-biggest-competitors-every-sports-management-simulator-ranked), [TWA-tjekliste 2026](https://spacenexus.us/blog/play-store-launch-checklist-pwa-twa-android), [Capacitor vs PWA](https://stackshare.io/stackups/capacitor-vs-pwa)
