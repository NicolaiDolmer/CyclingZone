# Playwright WebKit-projekt — iOS Safari engine-coverage

> Lever per [#376](https://github.com/NicolaiDolmer/CyclingZone/issues/376). Tilføjet 2026-05-16 fordi bruger ikke har iPhone og derfor ikke kan spot-teste iOS Safari manuelt.

## Hvad det dækker

`frontend/playwright.config.js` kører nu 3 projekter:

| Project | Engine | Viewport | Brug |
|---|---|---|---|
| `desktop-chromium` | Blink | 1280×900 | Desktop smoke |
| `mobile-chromium` | Blink | 393×852 (Pixel 5) | Android-class mobile smoke |
| `mobile-webkit` | WebKit | iPhone 13 (390×844) | **iOS Safari-engine smoke** ← ny |

CI installerer WebKit-binary i [`playwright-smoke.yml`](../../.github/workflows/playwright-smoke.yml) (`npx playwright install chromium webkit`).

### Historik — læs før du fjerner webkit fra CI igen

`mobile-webkit` var ude af CI fra [#1342](https://github.com/NicolaiDolmer/CyclingZone/issues/1342) (maj) til [#3429](https://github.com/NicolaiDolmer/CyclingZone/issues/3429) (7/8). Årsagen var et teardown-hæng på windows-runneren: `webServer` kørte dengang `npm run build && npm run preview` som ÉN kommando og efterlod en forældreløs preview-proces, som Playwright ikke kunne dræbe → jobbet hang 48 min. Byggetrinnet er siden flyttet til sit eget workflow-step, så den rodårsag er væk, og jobbet har nu `timeout-minutes` som backstop.

Prisen ved at have webkit ude viste sig større end hænget: den er den eneste mobil-Safari-dækning der findes, og uden CI kunne dens snapshots drive uset. Det skete — planner-snapshottet drev 5/8 og blev opdaget 6/8, hvorefter det blev rettet ved et tilfælde af en anden PR's snapshot-refresh. Hvis webkit skal ud af CI igen, så find en anden måde at fange den drift på først.

## Hvad det IKKE dækker

Playwright WebKit ≠ rigtig iOS Safari. Det er **engine'en**, ikke iOS-wrapperen. Du får dækning for:

✅ CSS layout-bugs (safe-area, `-webkit-`-prefix, flexbox-quirks, font-rendering)
✅ Stricter CORS-håndtering (fanges ofte tidligt)
✅ Module-script loading / MIME-strikse fetches

Du får IKKE dækning for:

❌ Touch-event-quirks (gesture, tap-delay, momentum scroll)
❌ PWA/standalone-mode-bugs
❌ `100vh`-viewport-bug på iOS Safari URL-bar
❌ Autoplay/audio-policies
❌ IndexedDB edge-cases
❌ Web Share API, biometric auth, app-store-integration

De sidste 30% kræver enten en rigtig iPhone eller BrowserStack/LambdaTest (out-of-scope per #376).

## Sådan opdaterer du snapshots lokalt

```bash
cd frontend
npx playwright install webkit   # første gang (~80MB)
npx playwright test --project=mobile-webkit --update-snapshots
```

Snapshots ligger i `frontend/tests/e2e/core-smoke.spec.js-snapshots/` med suffix `*-mobile-webkit-win32.png`.

## Kendt dev-only-noise (filtreret)

I `tests/e2e/core-smoke.spec.js` filtrerer vi to fejlmønstre fra `pageerror`-collectoren **kun på WebKit**:

- `Importing a module script failed` — Vite HMR + WebKit modul-import-quirk i dev-mode (sker ikke på prod-bundle)
- `due to access control checks` — Playwright `route.fulfill`-mocks kan ikke perfekt emulere Supabase CORS-headers; prod har rigtig Supabase-CORS-config

Ægte JS-exceptions slipper stadig igennem og fejler testen.

## Hvad du gør hvis CI fejler på `mobile-webkit`

1. **Snapshot-diff:** Download Playwright HTML-report fra PR-action-artifact. Hvis kun visuel (kosmetisk), kør lokalt med `--update-snapshots` og commit nye baselines.
2. **Page-error / crash:** Reel iOS Safari-engine-bug. Reproducér lokalt (`--project=mobile-webkit --headed`), fix CSS/JS, og commit både fix + nye baselines.
3. **Vite dep-cache-fejl** (fx `Failed to resolve import "X"`): kør `rm -rf frontend/node_modules/.vite && npm install` i `frontend/`.
