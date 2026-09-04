# CREATE OR REPLACE paa en SECURITY DEFINER-funktion mister search_path og re-granter EXECUTE

**Dato:** 2026-09-03 · **Kontekst:** #4733 PR3 (#4737), migration der udvidede `handle_new_user()` med `browser_language`.

## Hvad skete

Workeren skrev `CREATE OR REPLACE FUNCTION public.handle_new_user() ... SECURITY DEFINER` ved at kopiere definitionen fra den migration der oprindeligt oprettede funktionen (2026-05-17). Kommentaren sagde "al eksisterende logik bevaret". To ting var IKKE bevaret:

1. `SET search_path TO 'public', 'pg_catalog'`, som sikkerhedshaerdningen 2026-05-21 havde sat bagefter. En CREATE OR REPLACE uden klausulen fjerner den.
2. `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`. Supabase' default privileges re-granter EXECUTE ved enhver (re)definition, saa den gamle REVOKE overlever ikke.

Fundet i review ved at hente `pg_get_functiondef` + `proconfig` fra prod og diffe mod migrationen, ikke ved at laese migrationens egen kommentar. Punkt 2 blev derefter fanget af CI-vagten `check-secdef-revoke-lint.mjs` (#2858). `auto-migrate.yml` applier `database/2026-*.sql` automatisk ved push til main, saa fejlen ville vaere gaaet direkte i prod ved merge.

## Regel

- Foer enhver `CREATE OR REPLACE FUNCTION` i en migration: hent den LEVENDE definition (`select pg_get_functiondef(oid), proconfig from pg_proc where oid='public.<fn>'::regproc`) og spejl den 1:1; tilfoej kun den oenskede aendring. Den aeldste migration er ikke sandheden.
- SECURITY DEFINER = altid `SET search_path` + REVOKE-linjen i SAMME fil.
- Worker-prompter for migrationer skal sige "diff mod prod-definitionen", ikke "bevar eksisterende logik".

## Forward-guard

`scripts/preflight-pr.ps1` koerer nu `check-secdef-revoke-lint.mjs` paa aendrede SQL-filer (landet i #4737), saa REVOKE-hullet fanges lokalt. search_path-tabet har ingen statisk vagt endnu; den daglige `scripts/security-grants.sql` mod prod fanger tilstanden bagefter.
