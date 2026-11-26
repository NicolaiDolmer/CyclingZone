# 2026-11-26: expected-load gav 500 på et ikke-UUID løbs-id (CYCLINGZONE-BH)

**Symptom:** 7 fejl på 30 s (25/11 19:54 UTC, én bruger): `GET /api/races/wb-dender/expected-load` -> Postgres `invalid input syntax for type uuid` -> 500 + Sentry-capture.

**Rodårsag:** `loadExpectedLoad7535` sendte `req.params.raceId` urørt til `races.eq("id", ...)`. "wb-dender" er et id fra planlægnings-preview-mocken (`frontend/src/preview/planningWorkbenchMock.ts`); en klient med mock-data ramte prod-API'et. Et ugyldigt id er en klientfejl (404), ikke en serverfejl.

**Fix:** UUID-guard i loaderen før race-opslaget -> `404 race_not_found`, intet DB-kald. Regressionstest med "wb-dender", tom streng, or-filter-agtig streng og undefined.

**Forebyggelse:** ruter der tager et id fra URL'en og slår op på en uuid-kolonne skal validere formatet først (samme mønster som `UUID_RE` i `routes/api.js`).
