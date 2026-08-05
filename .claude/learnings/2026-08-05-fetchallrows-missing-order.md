# Postmortem · 2026-08-05 · fetchAllRows(...) uden stabil .order() (#3391)

## Hvad skete der?
`fetchAllRows` (`backend/lib/supabasePagination.js`) dokumenterer sit eget
kontrakt-krav inline siden #2951/#2962 (88%/38% datatab dengang): buildQuery
SKAL have en stabil `.order()`, ellers kan Postgres/PostgREST returnere
rækker i forskellig rækkefølge mellem `.range()`-pagede sider — tavst
dublet/mangel på tværs af sider, ingen fejl. En backwards-check (udløst af at
en subagent tilfældigt så det manglende `.order()` i
`riderProgressionEngine.js:111` under #3150/#3372-verifikation) fandt 14
flere kaldesteder med samme overtrædelse. Kontrakten stod kun i en kommentar
— ingen mekanisk vagt håndhævede den.

## Root cause
`.order()`-kravet var dokumentation, ikke kode. Intet stoppede en ny
`fetchAllRows(() => supabase.from(x).select(y).eq(...))` uden sortering fra
at merge.

## Fix
1. Rettet alle 15 kaldesteder (`riderProgressionEngine.js`×3,
   `academyIntake.js`×2, `seasonTransitionNotice.js`×2, `useGlobalRank.js`×2,
   4 engangs-scripts) med `.order("id")` (eller `.order("team_id")` /
   `.order("rider_id")` hvor DEN er tabellens PK — verificeret pr. tabel via
   Supabase MCP `execute_sql` mod information_schema, ikke gættet).
2. `scripts/check-fetchallrows-order.mjs`: scanner `backend/` +
   `frontend/src/` for `fetchAllRows(...)`-kald der wrapper en `.from(...)`
   men aldrig chainer `.order(...)`. Ingen opt-out — modsat
   `lint-pagination-guard.mjs`'s deny-liste (som HAR legitime bounded-read-
   undtagelser) har et `fetchAllRows`-kald ingen legitim grund til at mangle
   sortering; helperen eksisterer specifikt for at hente MERE end én side.
3. Egen fuld-repo-sweep (samme scope som issuets) fandt PRÆCIS 15 — ingen
   flere `fetchAllRows(...)`-kaldesteder. En separat sweep af de 17
   `fetchAllRowsChunkedIn(...)`-kaldesteder (samme kontrakt, ét niveau
   dybere) fandt 0 manglende `.order()` — allerede compliant.

## Forhindret-fremover
`scripts/check-fetchallrows-order.mjs` (+ 11 tests, inkl. en repo-wide
scan-assertion) kører i `preflight-pr.ps1` og et dedikeret CI-job
(`fetchallrows-order-guard`, `.github/workflows/ci.yml`). Verificeret ved
midlertidigt at fjerne én `.order()` og se guarden fejle (exit 1), derefter
rullet tilbage uden commit.

## Læring
Samme mønster som #3331-pagineringsvagten (`.claude/learnings/2026-08-05-
pagination-guard-forward-guard.md`): en kontrakt der kun lever i en
kode-kommentar drifter, uanset hvor tydeligt kommentaren er skrevet. Forskel
her: fordi `fetchAllRows` KUN har én gyldig brug (hente >1 side, stabilt),
var der ingen baseline-ratchet nødvendig — guarden kunne gå direkte til
"0 tilladte fund, ingen undtagelser" i stedet for at grandfathere en
eksisterende bunke. Når hele kald-familien allerede er ren efter fixet, er
den simplere hårde gate at foretrække frem for en ratchet man alligevel skal
stramme til 0 senere.
