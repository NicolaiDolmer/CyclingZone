# RPC-funktioner fik "authenticated"-grant som default, uden at nogen tjekkede om frontend kaldte dem

**Dato:** 2026-07-11
**Issue:** #2327

## Hvad skete der

En prod-audit (read-only) viste at 13 muterende Postgres-RPC'er havde EXECUTE-grant til
`anon` og/eller `authenticated` — selvom ALLE 13 udelukkende kaldes fra backend via en
service_role-klient, eller er trigger-funktioner der aldrig kaldes via RPC overhovedet.
PostgREST eksponerer enhver `public`-funktion på `/rest/v1/rpc/<fn>`, så disse grants
betød at en autentificeret spiller i teorien kunne kalde fx `increment_balance_with_audit`
direkte på sit eget team-id og ændre sin balance udenom al backend-validering.

Værste enkeltfund: `increment_balance_with_audit` fik `GRANT ... TO authenticated` i
`2026-05-09-balance-rpc.sql` og blev **re-granted** i `2026-05-26-backend-message-codes.sql`
— sandsynligvis kopieret fra en tidligere migrations GRANT-blok uden at spørge "kalder
frontend faktisk denne funktion?".

## Root cause

`CREATE OR REPLACE FUNCTION` nulstiller ikke eksisterende grants, men et nyt
`GRANT EXECUTE ... TO authenticated`-statement i en senere migration lægger grants
oveni uden at nogen fjerner dem igen. Mønsteret "GRANT authenticated på nye RPC'er"
blev kopieret migration-til-migration som en slags boilerplate, ikke som en bevidst
sikkerhedsbeslutning.

## Fix

`database/2026-07-11-revoke-rpc-grants-2327.sql` — REVOKE EXECUTE FROM anon, authenticated
+ eksplicit GRANT TO service_role på alle 13 backend-only funktioner. Bevaret:
`is_admin`, `get_sprint_metrics`, `get_cohort_retention` (kaldes direkte fra frontend
med bruger-JWT, admin-gater internt).

## Forward-guard

Migrationens header dokumenterer mønsteret: enhver ny public-funktion skal eksplicit
tage stilling til PostgREST-eksponering i SAMME migration som `CREATE FUNCTION` —
`REVOKE ... FROM anon, authenticated; GRANT ... TO service_role;` medmindre funktionen
er bevidst spiller-vendt (SECURITY INVOKER + RLS, eller SECURITY DEFINER med intern
autorisation a la is_admin-mønsteret). "authenticated" er ikke en sikker default-grant.

## Hvad ville have fanget det tidligere

Et periodisk audit-script der lister alle `public`-funktioner med EXECUTE-grant til
anon/authenticated og krydstjekker mod faktiske `.rpc()`-kald i frontend/ (grep-baseret)
findes ikke endnu — ingen eksisterende `scripts/*grant*` fundet under denne opgave.
Værd at overveje som opfølgning hvis flere lignende fund dukker op.
