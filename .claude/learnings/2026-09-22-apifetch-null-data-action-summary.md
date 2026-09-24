# 2026-09-22: apiFetch `data: null` crashede Layout + Indbakke (CYCLINGZONE-66/67)

**Symptom:** 22/9 kl. 06:42 viste én manager ErrorBoundary på /notifications. Der kom 6 events:
`Cannot read properties of null (reading 'counts')` i Layout.jsx:501 og
`... (reading 'transfer_offers')` i NotificationsPage.jsx:557.

**Rod-årsag:** #5372 (apiFetch skive A) ændrede `if (res.ok) setPending(await res.json())` til
`if (res.ok) setPending(res.data)`. apiFetch sluger en fejlende JSON-parse på et 2xx og returnerer
`data: null`. Før kastede `res.json()` ind i hookets catch, og state blev stående. Efter
migreringen landede `null` i state, og begge forbrugere dereferencerer den uden guard.

**Fix:** `normalizeActionSummary()` (frontend/src/lib/actionSummaryShape.js) afviser alt uden
den forventede form. Hooket beholder så den forrige liste. Testen vogter både funktionen og at
hooket ikke igen sender `res.data` direkte i state.

**Backwards-check:** Grep efter `set*(res.data)` fandt 3 steder. De to andre er ufarlige:
ProfilePage læser `betaAccess?.`, og useStageRoles behandler `null` som "henter".

**Forward-guard / læring:** Når et kaldsted migreres fra `await res.json()` til `apiFetch`, så husk:
et 2xx kan nu give `data: null` uden at kaste. Enhver `setX(res.data)` hvor forbrugeren ikke
tåler null, skal have en formvagt. Det gælder også de resterende migreringsskiver under #5242.
