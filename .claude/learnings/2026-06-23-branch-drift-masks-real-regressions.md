# Branch-drift maskerer ægte CI-regressioner (merge-batch 23/6)

**Kontekst:** 4 PR'er (#1782/#1764/#1783/#1767) skulle merges, alle 3-25 commits bagud `main`, alle med røde checks (`audit`, `frontend-build`, `leak-check`, `frontend-smoke`).

**Fælde:** Den nemme hypotese er "alt er bare branch-drift" (main har rykket sig siden branchene blev lavet). Det var sandt for de FLESTE fejl — men ikke alle.

**Sådan skilte jeg støj fra signal:**
1. Tjekkede `branch protection`: `strict=false` (branche behøver ikke være up-to-date), og hvilke checks der er **required** vs ej. `audit` + `frontend-smoke` var IKKE required → ren støj her.
2. `gh pr update-branch` på de drift-ramte branche (billigt, GitHub-side, rører ikke lokal checkout) → CI kørte forfra med main's fixes inde.
3. Efter opdatering forsvandt de fleste fejl — men **2 var ægte regressioner** der først blev synlige på den opdaterede base:
   - **#1783:** backend ændrede `FIRST_PROMOTION_RELEGATION_SEASON` 3→1, men frontend-spejlet `rulesNumbers.js` fulgte ikke med → `frontend-build`-test fejlede. (Drift-fix #1772 bragte testen ind; regressionen var #1783's egen.)
   - **#1767:** ny rå dansk fejl-streng i `api.js` → +1 i18n-leak (brød ratchet #1068). Ægte, ikke drift.

**Lektie:** Ved batch-merge af bagud-branche: `update-branch` FØRST for at fjerne drift-støjen, og afgør required-vs-ikke-required, FØR du konkluderer at en rød check er "bare drift". En forældet branch kan skjule en ægte regression bag drift-fejl.

**Bonus (parallelle PR'er rører samme fil):** #1783 (engine) opdaterede `help.json`'s `promotionRelegation`-FAQ samtidig med at jeg byggede #1760-visningen (#1787), som også rørte den. Resultat: merge-konflikt + divergerende copy. Når du bygger en follow-up-PR til en feature, så tjek om den merged feature-PR allerede har rørt de delte docs (help/patch-notes) — og tag den autoritative version i reconcile frem for at duplikere.
