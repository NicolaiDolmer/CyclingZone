# Lazy-loaded i18n namespaces render som raw keys ved first paint

**Dato:** 2026-05-16
**Sammenhæng:** #411 i18n Fase 2 — refactor LoginPage med `useTranslation(["auth", "errors"])`. Pre-login flow.

## Symptom

LoginPage rendered med raw key-strings (`page.title`, `field.email.label`, `submit.login.idle`) i stedet for oversatte værdier. `LanguageSwitcher` virkede (common.json bundled inline), men auth- og errors-namespaces gjorde ikke.

`/locales/da/auth.json` returnerede HTTP 200 med korrekt JSON. Keys eksisterede. Console viste ingen i18next-errors.

## Årsag

`frontend/src/i18n/index.js` har `react: { useSuspense: false }` for at undgå Suspense-boundaries. Med HTTP backend lazy-loader namespaces async, men når `useSuspense: false` triggrer react-i18next ikke pålideligt re-render efter namespace-load — komponenten ser permanent `ready: false` og returnerer keys som fallback.

I #410 Fase 1 fungerede `common.json` fordi den var bundlet inline i `resources`. Lazy-loaded namespaces havde aldrig været brugt på en first-paint-side.

## Fix

Bundlede `auth.json` + `errors.json` inline ligesom `common.json`:

```js
import authDa from "../../public/locales/da/auth.json";
import authEn from "../../public/locales/en/auth.json";
import errorsDa from "../../public/locales/da/errors.json";
import errorsEn from "../../public/locales/en/errors.json";

resources: {
  da: { common: commonDa, auth: authDa, errors: errorsDa },
  en: { common: commonEn, auth: authEn, errors: errorsEn },
},
```

Konsekvens: +~6 KB initial JS (begge sprog × 2 namespaces). Acceptable for first-paint-kritiske namespaces.

## Forward-guard

**Bundling-regel for namespaces:**
- First-paint-kritisk (vist før user kan agere) → bundle inline i `i18n/index.js`. Eksempler: `common`, `auth`, `errors`.
- Lazy-loadable (vises efter navigation/interaktion) → behold HTTP backend default. Eksempler: `dashboard`, `auctions`, `admin`, `patchnotes`.

Hvis fremtidige first-paint-namespaces tilføjes, bundle dem også. Hvis vi vil retur til pure lazy-loading, skift til `useSuspense: true` + Suspense-boundary omkring app-roden.

## Detection

Symptom let at fange via Chrome MCP `read_page`: hvis output viser keys som "page.title" eller "field.X.label", er det denne fejl.
