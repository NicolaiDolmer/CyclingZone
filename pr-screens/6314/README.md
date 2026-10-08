# #6314 — daglig kvittering

Reproduktion med lokale, syntetiske Playwright-data. Ingen billeder eller persondata fra Sentry. API-fixturen har et falsk eller manglende legacy-flag; eventets faktiske flagværdi er ikke registreret.

| Tilstand | Desktop | Mobil |
|---|---|---|
| Før: rå række når kvitteringen, siden fejler | [1440 px](before-1440.png) | [390 px](before-390.png) |
| Efter: dagskvittering med udfoldet rytter | [Chromium](after-desktop.png) | [Chromium](after-mobile.png), [WebKit](after-webkit.png) |

Efter-billederne viser kun kvitteringens område. Den faste mobilnavigation kan overlappe det lange elementbillede; sidens samlede layout er ikke ændret i denne PR. Testen kontrollerer også, at rytterdetaljerne åbner korrekt.

Før-billederne er taget på referencebuild 5bebe0e2798603d39278afa8b30d909360800d18. Komponent og de to hooks var identiske med rettelsens base 11da65db1cebb2c5cbd5a4417fc91dbd0c39b274. Regressionen og efter-billederne kan gentages med `frontend/tests/e2e/6314-daily-receipt-contract.spec.ts`.
