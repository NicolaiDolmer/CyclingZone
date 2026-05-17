# 2026-05-17 — Dashboard i18n raw keys: namespace ikke inlinet

## TL;DR
Brugeren åbnede Dashboard og så ~20 rå i18n keys i UI'et (`STATS.BALANCE`, `cards.transfers.empty`, `forecast.tier.yellow.label`, ...) på BÅDE DA og EN. Samme klasse-bug som #466/#468, men på `dashboard` + `banners` namespaces der ikke blev fanget af Fase 3b/3c-arbejdet.

Root cause: `i18n/index.js` har `useSuspense: false`. Namespaces der IKKE er inlinet i `resources`-blokken loades lazy via HttpBackend efter første render — `t()` returnerer raw key indtil fetch lander. På Dashboard ramte race-vinduet HVER load fordi alle 4 dashboard-konsumerende komponenter (DashboardPage, FinanceForecastCard, OnboardingCompletionCard, OnboardingProgressCard) renderer instant. SurveyBanner ramte samme for `banners`.

## Hvorfor det slap igennem trods #466-postmortem samme dag
[`.claude/learnings/2026-05-17-symptom-patching-loop-vs-root-cause.md`](.claude/learnings/2026-05-17-symptom-patching-loop-vs-root-cause.md) identificerede præcist mønstret:
> Highly-trafficked translated pages bør inline-bundles. Auctions, Dashboard er åbenlyse kandidater.

Men forward-guarden var dokumentation, ikke automation. Når jeg merged `transfers` (#468) i Fase 3c kiggede jeg ikke på Dashboard fordi Dashboard ikke var i scope for Fase 3c. Ingen CI-check fangede at Dashboard allerede brugte `dashboard:` keys via lazy-load.

**Symptom-tæthed:** Dashboard har 30+ `t("dashboard:...")` kald → mest synlige page-leak i hele appen. Brugerens skærmbillede viste 20+ raw keys på samme view.

## Fix
1. **[`frontend/src/i18n/index.js`](frontend/src/i18n/index.js)** — importér `dashboard.json` + `banners.json` (DA + EN) og tilføj til `resources`-blokken. Samme pattern som `auctions`/`transfers`. Bundle-overhead: ~3KB gzipped per sprog.
2. **Dev-only:** `window.__i18n = i18n` (kun under `import.meta.env.DEV`) for fremtidig DevTools-inspektion. Gør at man kan verificere `window.__i18n.t("dashboard:stats.balance")` uden fuld login-flow.

## Forward-guard (denne gang automatiseret)
**Nyt script:** [`scripts/i18n-check-namespace-inline.mjs`](scripts/i18n-check-namespace-inline.mjs)
- Parser `frontend/src/**/*.{jsx,js,ts,tsx}` for `useTranslation(...)` + `t("ns:key")` kald
- Parser `frontend/src/i18n/index.js` for inlinede namespaces i `resources`-blokken
- Fejler med exit 1 hvis brugt namespace ikke er inlinet, med filliste + fix-vejledning

**Verificeret begge veje:**
- Pre-fix (dashboard + banners ikke inlinet): exit 1, "2 namespace(s) brugt men ikke inlinet"
- Post-fix: exit 0, "alle 7 brugte namespaces er inlinet"

**CI:** Tilføjet som REQUIRED job i [`.github/workflows/i18n-check.yml`](.github/workflows/i18n-check.yml) — modsat den eksisterende key-coverage job der er advisory. Begrundelse: med `useSuspense: false` er dette en user-visible regression, ikke en advisory.

**Workflow trigger:** Udvidet paths fra kun `frontend/public/locales/**` til også at inkludere `frontend/src/**` så enhver useTranslation-ændring triggrer checken.

## Hvad de tidligere postmortems sagde
- **2026-05-17 (symptom-patching):** Inline-bundles for high-traffic pages = "åbenlyse kandidater" — dokumenteret, ikke automatiseret
- **2026-05-17 (visual-snapshots-layout-only):** Snapshots masker tekst → fanger IKKE raw key leaks (med intention, men efterlader bug-klassen blind)

Begge var korrekte observationer. Manglende skridt: lav guarden eksekverbar.

## Læringer fremover
1. **Postmortem = action item, ikke dokumentation.** Hvis et mønster identificeres som "åbenlys kandidat for forward-guard", lav guarden samme dag. Ellers bides det igen — dette her er bevis.
2. **CI checks > human discipline** for klasse-bugs der koster brugersigt. Snapshot-tests fanger ikke i18n leaks med design — så lav en check der gør.
3. **Fase-arbejde indfører nye konsumenter af gamle namespaces.** Når Fase 3c addede transfers-inline glemte jeg at Dashboard allerede konsumerede `dashboard:` keys via lazy-load. Guarden fanger dette uafhængigt af fase.
4. **`useSuspense: false` har et flugtventil-problem.** Det undgår Suspense-boundaries men på bekostning af first-paint correctness for ikke-inlinede namespaces. Alternativet er `useSuspense: true` + `<Suspense fallback={...}>` rundt om hver konsument — for stort blast-radius til retrofit. Inline + guard er pragmatisk valg.

## Bør i HOT memory?
Nej — forward-guarden er nu i CI. Hvis guarden fejler igen i fremtidige sessioner pga edge case (fx dynamiske `useTranslation(useNamespaceFromProp())`) skal det promotes.

## Tidsregnskab
- Identifikation (kode-analyse + screenshot match): ~5 min
- Fix (inline dashboard + banners): ~3 min
- Forward-guard script + CI integration: ~15 min
- Verifikation (preview eval + build + key-check + pre/post-fix script test): ~10 min
- Postmortem: ~5 min
- **Total: ~38 min for klasse-fix der eliminerer hele bug-familien**
