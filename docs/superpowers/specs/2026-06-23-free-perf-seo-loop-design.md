# Gratis, løbende performance- & SEO-loop

**Status:** Godkendt design — klar til implementeringsplan

**Dato:** 2026-06-23

**Beslutnings-ejer:** Product owner (Nicolai)

**Anledning:** Vercel opgraderet fra Hobby til Pro. Speed Insights blev kort aktiveret men **slukket igen fordi den koster penge** (~$10/md/projekt). Det efterlod et hul: ingen kilde måler længere rigtige brugeres Core Web Vitals. Ejeren vil have en **gratis** erstatning + en **løbende rutine** der faktisk driver perf/SEO-forbedringer — ikke bare måler.

## 1. Kontekst — hvad findes allerede

Bygger ovenpå (duplikerer ikke):

- [`docs/seo/2026-06-21-seo-ownership.md`](../../seo/2026-06-21-seo-ownership.md) — udpeger **Lighthouse-CI** som ejer af Core Web Vitals "som CI-gate" (markeret post-launch, [#1301](https://github.com/NicolaiDolmer/CyclingZone/issues/1301)). Fastslår at ranking/keywords ejes af GSC/Ahrefs/Morningscore og **ikke kan automatiseres herfra** (kræver login).
- [`docs/superpowers/specs/2026-06-13-world-class-performance-architecture-design.md`](2026-06-13-world-class-performance-architecture-design.md) ([#1375](https://github.com/NicolaiDolmer/CyclingZone/issues/1375)) — "Phase 0: baseline" dækker bundle-size + CWV-måling; §5 kræver "bundle-size budgets to CI"; §9 definerer CWV-targets (INP p75 <150 ms, LCP p75 <2,0 s, CLS p75 <0,05).
- **Eksisterende scheduled-audit-mønster:** [`feature-liveness-audit.yml`](../../../.github/workflows/feature-liveness-audit.yml) + [`quality-inbox.yml`](../../../.github/workflows/quality-inbox.yml) — JSON+tekst-rapport, artifact-upload, PR-comment der blokerer ved findings, og ét idempotent tracking-issue med `claude:todo`-label på cron. **Dette mønster genbruges 1:1.**
- **Måling i dag:** GA4 (`frontend/src/lib/gaIntegration.jsx`) + Microsoft Clarity + Vercel Web Analytics (`frontend/src/lib/vercelAnalyticsIntegration.jsx`) — alle consent-gated via `useConsent("analytics")`. Vercel Speed Insights (`frontend/src/lib/speedInsightsIntegration.jsx`) — kode findes, men produktet er **slukket i Vercel-dashboardet** → død kode.

### Verificerede fakta (2026-06-23)

- Vercel **Web Analytics: TÆNDT og gratis** for denne konto → **beholdes uændret**. Kost styres af dashboard-toggles, ikke koden.
- Vercel **Speed Insights: slukket**; ville koste ~$10/md/projekt → **erstattes gratis**.
- Vercel-MCP'en har **intet billing/usage-endpoint** — faktisk forbrug kan kun ses i ejerens Vercel Usage/Billing-dashboard. Pris-tal ($10/md, 25k events) stammer fra tredjeparts-kilder, ikke verificeret mod Vercels egne docs (secret-hook blokerede docs-output pga. Vercels eksempel-projectId'er — falsk positiv, ingen reel læk).

## 2. Mål og ikke-mål

**Mål:**
- Gratis erstatning for Speed Insights' field-måling af Core Web Vitals.
- Automatisk regressions-beskyttelse pr. PR (en tung/langsom PR fanges før merge).
- En løbende, lav-friktions rutine der leverer en **prioriteret, konkret** perf+SEO-forbedringsliste og lader ejeren vælge hvad der fixes.

**Ikke-mål (eksplicit):**
- Loopet ejer **teknisk** SEO (meta, struktur, hastighed, crawlbarhed) + perf. **Ranking/keywords forbliver hos GSC/Ahrefs/Morningscore** — kan ikke automatiseres herfra. Ingen påstand om at loopet rykker rankings; det rykker det tekniske fundament rankings står på.
- Ingen auto-PR fra reviewen (for risikabelt autonomt). Reviewen producerer issues; mennesket beslutter.
- Intet data-layer-refactor (TanStack Query, broad-refetch m.m.) — det er #1374/#1375 post-launch-arbejde og uden for dette design. Alt her er **additivt** og rører ikke gameplay/data-layer → trygt før relaunch.

## 3. Arkitektur — tre uafhængige dele

Hver del kan leveres og verificeres for sig. Leverings-rækkefølge: 1 → 2 → 3.

### Del 1 — Gratis field-måling (erstat Speed Insights)

**Ny:** `frontend/src/lib/webVitalsIntegration.jsx`
- Bruger `web-vitals` (npm, ~2 kB) til at registrere `onLCP`, `onINP`, `onCLS`, `onFCP`, `onTTFB`.
- Sender hver metrik til GA4 som event via eksisterende `window.gtag` (samme GA4-stream som `gaIntegration.jsx`). Event-form: metrik-navn (`LCP`/`INP`/`CLS`/...), `value`, `metric_id`, `metric_delta`, `non_interaction: true`.
- **Consent-gated** præcis som de tre andre vendors: kun aktiv når `import.meta.env.PROD && hasConsent("analytics")`. Mountes inde i `ConsentProvider`, samme sted som de eksisterende integrations-komponenter.
- Registrering sker i `useEffect` ved mount; web-vitals' egne lyttere håndterer resten.

**Ændret:** fjern `<SpeedInsights/>`-mounten + slet `frontend/src/lib/speedInsightsIntegration.jsx` + fjern `@vercel/speed-insights`-dependency. (Død kode — produktet er slukket.)

**Uændret:** `vercelAnalyticsIntegration.jsx` / `<Analytics/>` beholdes (tændt + gratis).

**Kendt tradeoff:** consent-gaten betyder at brugere der endnu ikke har givet samtykke ikke måles, og at LCP/CLS for en *netop-givet* samtykke i samme load kan gå tabt (lytterne registreres efter consent). Samme tradeoff som de øvrige vendors allerede har — accepteret, ikke en regression.

### Del 2 — CI-gate (regressions-beskyttelse pr. PR)

**Ny:** `.github/workflows/lighthouse-ci.yml` — skelet kopieret fra `feature-liveness-audit.yml` (Node 24, `actions/checkout@v7`, `setup-node@v6`, `upload-artifact@v7`, `github-script@v9`, Dependabot-skip).

Trigger: `pull_request` på `paths: [frontend/**, .github/workflows/lighthouse-ci.yml]` + `workflow_dispatch`.

Trin:
1. `npm ci` + `vite build` i `frontend/`.
2. **Hard gate — bundle-size:** nyt script `scripts/check-bundle-budget.mjs` læser `frontend/dist/assets/*.js`, gzipper, summerer pr. entry + total, sammenligner mod committet budget-fil `frontend/bundle-budget.json` (med justerbar margin). Over budget → `exit 1` (blokerer merge). Deterministisk, ingen CI-hardware-støj.
3. **Advisory — Lighthouse:** `vite preview` på localhost → Lighthouse (`@lhci/cli` eller `treosh/lighthouse-ci-action`) mod localhost → scores (perf/SEO/a11y/best-practices) postes som PR-comment. **Aldrig blokerende** (`continue-on-error`/informational) — scores varierer på CI-hardware.
4. Upload Lighthouse-JSON + budget-rapport som artifact.

Initial `bundle-budget.json` sættes fra den faktiske build på `main` ved implementering (Phase 0-baseline), så gaten starter sandt frem for gættet.

### Del 3 — Ugentlig AI-review (forbedringer + læring)

**Ny:** `.github/workflows/perf-seo-review.yml` — skelet fra `quality-inbox.yml`. Trigger: `schedule` (ugentlig cron) + `workflow_dispatch`. Permissions: `contents: read`, `issues: write`.

Trin:
1. Kør Lighthouse mod **prod** (`https://cyclingzone.org`) → JSON (lab-måling i ægte miljø).
2. Kør statisk repo-analyse — nyt script `scripts/audit-perf-seo.mjs` der tjekker: meta-/OG-tags i `index.html`, structured data (JSON-LD), `robots.txt` + `sitemap.xml` gyldighed/friskhed, og bundle-størrelse-trend vs. budget.
3. Saml Lighthouse-JSON + audit-output til kontekst og lad **Claude** (jeres eksisterende Actions-kanal — `claude.yml`/`claude-review.yml`-mønster + `ANTHROPIC_API_KEY`-secret) skrive en **prioriteret perf+SEO-forbedringsliste** (impact-sorteret, konkret handling pr. punkt).
4. Opret/opdatér ét idempotent **"Perf & SEO inbox"**-issue (marker-kommentar + label-søgning, præcis som quality-inbox) med labels `claude:todo`, `priority:medium`. Separate actionable issues kun for klart høj-impact enkeltfund.

**Bevidst udeladt nu:** GA4 Data API (field-RUM ind i rapporten automatisk). Kræver service-account + secret. Field-data ser ejeren selv i GA4-UI indtil videre; kobles på senere ved behov.

**Kadence:** ugentlig i den aktive pre-/post-relaunch-fase. Nedjustér til månedlig efter relaunch (matcher perf-arkitektur §9 "review monthly").

## 4. Filer

**Nye:**
- `frontend/src/lib/webVitalsIntegration.jsx`
- `frontend/bundle-budget.json`
- `scripts/check-bundle-budget.mjs`
- `scripts/audit-perf-seo.mjs`
- `.github/workflows/lighthouse-ci.yml`
- `.github/workflows/perf-seo-review.yml`

**Ændrede:**
- `frontend/package.json` — `+ web-vitals`, `− @vercel/speed-insights`
- App-roden hvor integrations-komponenterne mountes — `+ <WebVitalsIntegration/>`, `− <SpeedInsights/>`

**Slettede:**
- `frontend/src/lib/speedInsightsIntegration.jsx`

## 5. Verifikation

- **Del 1:** Playwright-mock-build i PROD-mode → bekræft web-vitals-events sendes til gtag når consent=ON, og **ikke** når consent=OFF. Manuel: ejer åbner prod, klikker rundt, ser CWV-events i GA4 Realtime/DebugView.
- **Del 2:** Test-PR der bevidst opbloater bundle → gaten skal `exit 1`. Normal PR → grøn + Lighthouse-comment til stede.
- **Del 3:** `workflow_dispatch`-kør → bekræft "Perf & SEO inbox"-issue oprettes/opdateres idempotent med konkret indhold.
- Kør hele CI-gate-sættet lokalt før push (`scripts/verify-local.ps1` + eslint + i18n + warning-budget).

## 6. Dokumentations-impact

- **Patch notes / Help-FAQ:** ingen brugerrettet ændring (web-vitals er bag consent og ændrer ikke UI; Speed Insights-fjernelse er usynlig). → skriv "ingen patch note: intern måling/CI, ingen player-facing effekt" i PR-body.
- **`docs/seo/2026-06-21-seo-ownership.md`:** opdatér Lighthouse-CI-rækken fra "Post-launch" til "implementeret" + tilføj web-vitals→GA4 som field-CWV-kilde (erstatter Speed Insights-rækken i perf-arkitektur §9's telemetri-liste).
- **FEATURE_STATUS.md:** tilføj perf/SEO-loop hvis relevant.

## 7. Sekvensering & risiko

Alt additivt; rører ikke gameplay, data-layer eller migrationer → **lav risiko, trygt før relaunch**. Ingen `database/*.sql`. Leveres 1 → 2 → 3; hver del er selvstændigt mergebar og giver værdi alene (Del 1 lukker Speed-Insights-hullet straks).
