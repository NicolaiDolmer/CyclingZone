# 2026-07-16: Prod-log-audit — 3 rod-årsager fra samme 13/7-vindue (#2424, #2425)

## Symptom
5× Postgres 23514 `riders_contract_length_check` + 5× PATCH 400 på `/rest/v1/riders`; 5× HEAD 404 på `/rest/v1/loan_agreements?select=id&status=eq.active`; 1× "column riders.name does not exist".

## Rod-årsag 1 — kontraktforlængelse uden loft (#2424)
`computeContractExtension()` i `backend/lib/contractSeed.js` beregnede `contract_length: len + 1` uden at clampe mod `CONTRACT.MAX_LENGTH` (3). En rytter allerede på længde 3 der blev forlænget igen (`POST /api/riders/:id/extend-contract`) fik `contract_length=4`, som DB'ens `riders_contract_length_check` (1..3, se `database/2026-06-13-contract-data-fields.sql`) afviste med 23514 → PATCH 400.

Fix: `Math.min(rawLength, CONTRACT.MAX_LENGTH)` clamper resultatet. `contract_end_season` rykker stadig frem (så en forlængelse ikke er en no-op), kun kontraktlængde-tallet loftes.

## Rod-årsag 2 — dødt kald til droppet tabel (#2425a)
`database/2026-07-11-drop-loan-agreements-table.sql` droppede `loan_agreements` (udlåns-featuren afviklet, #1994) med kommentaren "All application code that read/wrote this table was removed in the same PR" — men ét kald overlevede: `GET /admin/deadline-readiness` i `backend/routes/api.js` gjorde stadig en `count`-query mod `loan_agreements`, som PostgREST rapporterer som 404 når tabellen ikke findes. Feltet blev vist i `frontend/src/components/admin/DeadlineReadinessSection.jsx` ("Aktive lejeaftaler").

Fix: fjernet queryen + response-feltet (`active_loans`) + admin-UI-tilen.

Lektion: en migration-kommentar der påstår "al kode fjernet i samme PR" bør verificeres med et grep i selve PR'en der lukker issuet — ikke tages for givet i en senere audit.

## Rod-årsag 3 — kolonnenavn-drift (#2425b)
`POST /api/riders/names` (batch-navneopslag til Scouting-centralen, #2244) selectede `id, name` — men `riders`-tabellen har `firstname`/`lastname`, ikke `name`. PostgREST fejlede med "column riders.name does not exist".

Fix: select `id, firstname, lastname`, saml navnet server-side (`[firstname, lastname].filter(Boolean).join(" ")`) så response-formen (`{id, name}`) forbliver uændret for frontend (`ScoutingCentralPage.jsx` forventer `r.name`).

## Forebyggelse
Ingen af de tre fejl var synlige i CI — alle ramte kun prod-runtime (constraint-violation, droppet tabel, kolonne-drift). Overvej: kør en let "select-smoke"-test der verificerer alle statiske `.select("...")`-strenge i `api.js` mod `information_schema.columns` for de tabeller de rammer, som del af en periodisk log-audit (ikke CI-gate — for langsom/skrøbelig til per-PR).
