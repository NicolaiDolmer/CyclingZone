# 2026-07-19 — PostgREST-schema-cache-race efter MCP-apply (CYCLINGZONE-37)

## Hvad skete
#2690 (søndags-drip) merged; migrationerne blev MCP-applied straks efter (#2642-
rammen) og verificeret via information_schema — men Railway bootede sekunder
senere, og boot-run'ets claims fejlede alle med "Could not find the table
'public.academy_intake_ticks' in the schema cache". Tabellen VAR i Postgres;
**PostgREST/supabase-js' schema-cache** havde bare ikke genindlæst.

## Hvorfor det ikke gjorde skade
Claim-FØRST-designet er fail-closed: claim-fejl → holdet springes over, INGEN
kandidater genereres halvt. Cron-handleren capturede delfejlene aggregeret i
Sentry (CYCLINGZONE-37) præcis som designet. `NOTIFY pgrst, 'reload schema'` +
næste boot (#2663-deployet) kørte drippen 100% rent: 127 hold × 2, 0 orphans.

## Lærdom (klasse)
`information_schema`-verify beviser at Postgres kender objektet — IKKE at
API-laget gør. Efter MCP-apply af nye tabeller/kolonner der tilgås via
supabase-js/PostgREST: kør ALTID `NOTIFY pgrst, 'reload schema';` som del af
post-apply-verifikationen. Kodificeret i AGENTS.md hard rule 9 (commit da7c92dd).
Bemærk: auto-migrate-workflowets psql-sti har samme hul for fremtidige
tabel-skabende migrationer — men enhver efterfølgende deploy/timelig retry
selv-healer, hvis forbrugeren er fail-closed. Design nye cron-forbrugere af nye
tabeller fail-closed, så racen altid er benign.
