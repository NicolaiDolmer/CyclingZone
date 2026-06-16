# Udtrukket fetch+render-komponent skal gardere mod partiel respons

**Dato:** 2026-06-16 · **Kontekst:** #986 Finance-konsolidering (PR #1417)

## Hvad skete

Da `SeasonFinanceReport`-body blev udtrukket til en genbrugskomponent
(`SeasonFinanceReportPanel`) og monteret i den nye Historik-fane, crashede fanen
(React error boundary: "Siden kunne ikke vises"). Rod-årsag: panelet læste
`report.hero.net` direkte, og Playwright-mockens catch-all returnerede en
**ufuldstændig** `finance-report`-shape (`apiResponse(pathname)` uden `hero`).
`hero` var `undefined` → TypeError under render.

## Hvorfor build + unit-tests ikke fangede det

- `npm run build` + `node --test` (502) + eslint var alle grønne — de kører ikke
  komponentens render mod en realistisk (eller urealistisk) respons.
- `core-smoke` screenshotter kun **default-fanen** (Overblik), ikke Historik →
  snapshot-guarden så aldrig den crashende fane.
- Først en **logget-ind Playwright-mock-verify der klikkede fanerne** afslørede
  crashet (PAGE_ERRORS var tom, fordi error boundary fanger render-fejl — så jeg
  måtte se på selve screenshottet, ikke kun page-errors).

## Læring (forward-guard)

1. **Når en fetch+render-blok udtrækkes til en komponent: gardér ALLE nested
   felt-tilgange med safe defaults** (`const hero = report.hero || {}`, lister
   `|| []`). En komponent må aldrig crashe siden på en uventet/partiel respons
   (#1350-filosofi: terminale states, aldrig evig spinner / aldrig crash).
2. **Snapshot-tests dækker kun default-tilstanden.** Ny tab/modal/conditional UI
   skal verificeres ved at *interagere* (klik fanen) i en mock-session, ikke kun
   stole på core-smoke. Tjek selve screenshottet — error boundaries lækker ikke
   altid til `pageerror`.
3. Relaterer til [[feedback_runtime_verify_first]] +
   [[feedback_local_logged_in_verify_via_playwright_mocks]].
