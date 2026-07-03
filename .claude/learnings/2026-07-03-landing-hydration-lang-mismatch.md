# Landing-hydration: EN-prerender vs. da-klient → React #418/#422/#425

**Dato:** 2026-07-03
**Symptom:** `https://cyclingzone.org/` loggede konsistent React minified errors **#418** (hydration failed), **#422** (Suspense-boundary → client render) og **#425** (text content mismatch) i browser-konsollen — både ved første load og efter reload. Ramte den offentlige landing (prerendret/SSG). TdF-kampagnen 4/7 sender kold trafik direkte hertil → reel SEO/perf-effekt.

## Rod-årsag

Den prerendrede landing i `dist/index.html` renderes **altid på engelsk** (`scripts/prerender.mjs` → `render("/", "en")`). Header-baseret per-sprog-servering er umulig fordi Vercels CDN cacher `/` på URL alene (ignorerer `Accept-Language`).

På klienten kører i18next's `LanguageDetector` (`localStorage cz_lang → navigator.language → fallback`) **før** React monterer. For en dansk besøgende (ejeren + dansk TdF-trafik) er `i18n.language === "da"` når `main.jsx` hydrerer → klientens hydrerings-render producerer **dansk** tekst (og dansk-afledte attributter som `<LanguageToggle>` `aria-pressed`) mod **engelsk** server-HTML.

React opdager mismatchet, logger #418/#425, og falder Suspense-boundary tilbage til fuld client-render (#422). Resultat: prerender-gevinsten (hurtig first paint, SEO) **smides væk for præcis de brugere** vi prerenderer for, plus konsol-fejl.

Ingen af landing-komponenterne (`RaceSignature`, `LaunchWaitlistForm`) var skyld — de er 100% deterministiske (`t()` + statisk data, ingen `Math.random`/`Date`/`window`/media-queries, `useSearchParams` bruges kun i submit-handleren). Den **eneste** mismatch-kilde var sproget.

### Hvorfor det slap igennem

`prerender.mjs`-kommentaren anerkendte tradeoffet ("En DA-klient får ét hurtigt tekst-skift ved hydration") — men det "tekst-skift ved hydration" **ER** #418/#425. Den der skrev det, opfattede det som et kosmetisk flimmer, ikke som en hydration-fejl der nulstiller SSR-værdien. `entry-server.jsx`'s kommentar påstod desuden per-sprog-prerender-filer (`index.en.html` + `index.da.html`) som aldrig blev implementeret — stale doc der skjulte, at der kun findes én EN-variant.

## Fix

Standard SSR-i18n-mønster: **hydrér mod det sprog serveren renderede (EN), skift til den besøgendes sprog FØRST efter hydrationen er committet.**

- `main.jsx`: når vi hydrerer den prerendrede landing og det detekterede sprog ikke er EN, `await i18n.changeLanguage("en")` FØR `hydrateRoot`, og send det detekterede sprog videre som `deferredLanguage`-hint.
- `lib/language.jsx`: `LanguageProvider` afleder nu sit sprog fra `i18n.language` (ikke en dobbelt `cz_lang`-læsning, der kunne divergere under det tvungne EN-vindue), abonnerer på i18next `languageChanged` (så `aria-pressed` + `<html lang>` altid følger med), og udfører det deferrede skift i en **mount-effect** (kører efter commit → normalt re-render, ikke en hydration → ingen mismatch).
- `AppProviders.jsx`: videresender `deferredLanguage` (prerender-entry sender det ikke → server/klient matcher 1:1).

**Rækkefølge-fælde:** `languageChanged`-listeneren skal registreres i en effect **før** den deferrede-switch-effect, ellers emitter skiftet eventet før listeneren er på plads, og provideren misser det (EN-toggle mens teksten er dansk). React kører effects i definitions-rækkefølge.

## Forward-guard

`frontend/tests/e2e/landing-hydration.spec.js` — loader `/` (prerendret dist mod preview-build) med `cz_lang="da"` og fejler hvis konsollen logger #418/#422/#425. Reproducerede bug'en 1:1 før fixet (#425×3, #418×2, #422×1) og er grøn efter, på alle 3 playwright-projekter.

## Verifikation

Reproduceret + verificeret mod prod-preview (`npm run build && vite preview`): dansk besøgende → ren konsol, `<html lang="da">`, DA-toggle `aria-pressed`, dansk tekst efter hydration. Engelsk besøgende → ren konsol, ingen unødigt skift. 978 unit-tests + lint grønne.
