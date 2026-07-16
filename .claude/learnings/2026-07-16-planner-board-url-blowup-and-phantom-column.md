# Planner-board 500: URL-sprængt IN-liste + fantom-kolonne (16/7-2026, #2516)

**Symptom:** Ejeren (admin, `peak_planner_enabled='beta'`) så kun "Season planner isn't live yet". Ingen fejl i UI'et.

**Rod-årsager (begge fra samme dags planner-PR'er #2455/#2506):**
1. `loadManualRegisteredRaceIds` sendte `.in("race_id", allRaceIds)` med ALLE sæsonens 423 løbs-UUID'er (~16 KB GET-URL) → undici `TypeError: fetch failed` → endpointet 500'ede (Sentry CYCLINGZONE-33).
2. Onboarding-progress head-countede `race_entries.select("id")` — tabellen har composite key, ingen `id`-kolonne (42703, CYCLINGZONE-34).

**Forstærker:** `usePlanner` behandler enhver ikke-OK-respons som `enabled:false` — en 500 er visuelt identisk med flag-off. Kill-switch-mønstret camouflerede altså en crash som en lukket feature.

**Lærdomme:**
- Kendt fælde igen (jf. `feedback_test_real_endpoint_not_just_mocked`, #1840/#1851): nyt endpoint testet mod mock, aldrig kørt mod ægte DB-skala. En IN-liste der virker med 5 fixture-løb sprænger med 423 prod-løb.
- PostgREST-lints (`lint-postgrest-in-cap`) fanger kun `.slice(0,N)`-trunkering — IKKE u-chunkede IN-lister. URL-størrelse er en anden fejlklasse end række-cap.
- Flag-gated features bør skelne "flag off" fra "endpoint fejlede" i UI-hooken; ellers rapporteres crashes aldrig af spillere ("den er nok bare ikke live endnu").

**Forward-guards:** 2 source-scan-tests i `riderPeakPlans.routes.test.js` (chunk-mønster obligatorisk i `loadManualRegisteredRaceIds`; `race_entries.select("id")` forbudt i api.js). Følgearbejde-kandidat: generalisér "chunk alle .in()-lister over N ids" som lint.
