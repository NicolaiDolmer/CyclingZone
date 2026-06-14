# CI-only flake: læs den FULDE log før du fixer — symptom-summaryen lyver

**Dato:** 2026-06-14
**Issue:** [#1342](https://github.com/NicolaiDolmer/CyclingZone/issues/1342) — Playwright Windows-smoke hang 48 min efter beståede tests
**PR:** #1385

## Hvad skete der

Playwright "smoke" på windows-latest hang systematisk (10/12 runs). Symptom-summaryen
var `88 passed` → `worker-2 did not exit within 300000ms, force-killed` → exit 1.
To fix-forsøg blev gjort på den synlige hypotese (webServer-processen):

1. **Forsøg 1:** skift dev-server → `npm run build && npm run preview`. Virkede LOKALT
   (87/90), men hang STADIG i CI (48 min, cancelled).
2. **Forsøg 2:** split build ud så webServer = én `vite preview`-proces. Hang IGEN.

Begge ramte ved siden af. Først da jeg trak den **fulde CI-log** og fandt det præcise
hængepunkt blev rod-årsagen klar:

- Alle CI-fejl var `[mobile-webkit]`; **nul** på desktop-/mobile-chromium.
- Webkit ramte navigations-races (`page.goto("/board")` afbrudt af auth-redirect til
  `/dashboard`), hvorefter webkit-workeren ikke kunne exit'e → 48-min hæng.
- Webkit **består lokalt** (samme suite) → CI-runner-timing-artefakt på windows-latest,
  ikke en produkt- eller webkit-overalt-bug.

Fix: drop mobile-webkit i CI (`process.env.CI`-filter i `playwright.config.js`), behold
den lokalt; `timeout-minutes: 15`-backstop i workflow'en. Grønt på 2m33s.

## Lektion

1. **På en CI-only flake der ikke repro'er lokalt: træk den fulde CI-log FØRST og find
   det præcise hængepunkt** (hvilket projekt, hvilken test, hvilket timestamp) før du
   gætter et fix. `gh run view <id> --log` + grep efter `::error`-projekt-tags og
   tidsstempel-gaps. Symptom-summaryen (`worker did not exit`) pegede på webServer;
   den faktiske synder var ét browser-projekt. ~2 spildte CI-round-trips kunne være
   undgået med 5 minutters log-læsning.
2. **"2 fejl på samme symptom → STOP + diagnosticér"-guarden virkede** — efter forsøg 2
   stoppede jeg de blinde fix og læste loggen i stedet for et forsøg 3.
3. **webkit på windows-latest er en kendt skør kombination.** Når et enkelt
   browser-projekt hænger/fejler kun i CI men består lokalt, er "drop det fra CI / flyt
   til Linux" et legitimt førstevalg frem for at jagte teardown-internals.
4. **`timeout-minutes` på langtkørende test-steps er billig forsikring** — et hæng skal
   aldrig kunne æde en 6-timers runner.

Se også: [[reference_frontend_smoke_teardown_flake]], `feedback_reproduce_locally_before_push.md`.
