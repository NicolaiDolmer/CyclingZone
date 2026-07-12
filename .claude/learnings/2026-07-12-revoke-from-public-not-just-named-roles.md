# REVOKE EXECUTE fra anon/authenticated holder ikke, hvis PUBLIC stadig har grant

**Dato:** 2026-07-12
**Kontekst:** #2258 (Supabase security advisor hærdning), fund gjort under aktuel-tilstands-verifikation.

## Rod-årsag

`database/2026-07-11-revoke-rpc-grants-2327.sql` (#2327/#2345, merged+applied 11/7) kørte
`REVOKE EXECUTE ON FUNCTION public.<fn>(...) FROM anon, authenticated` på 13 muterende
funktioner for at lukke en anon/authenticated PostgREST-eksponering. Dette **virkede ikke**
for 11 af de 13 (bl.a. `create_emergency_loan_atomic`, `repay_loan_atomic`,
`finalize_academy_acquisition`, `demote_rider_to_academy`) — verificeret 2026-07-12 via
`pg_proc.proacl` at de stadig havde `=X` (PUBLIC) i deres ACL, og `has_function_privilege
('anon', oid, 'EXECUTE')` returnerede `true`.

I Postgres er `anon`/`authenticated` almindelige roller. Et `GRANT EXECUTE ... TO PUBLIC`
(som Supabase' default privileges for `supabase_admin` sætter på nye/CREATE OR REPLACE'ede
funktioner) gør funktionen kaldbar af **enhver rolle**, uanset om den rolle selv har fået
et eksplicit REVOKE. `REVOKE ... FROM anon, authenticated` fjerner kun evt. eksplicitte
grants til akkurat de to roller — det fjerner IKKE adgangen der kommer via PUBLIC-grantet.
Man skal eksplicit `REVOKE ... FROM PUBLIC` (eller `FROM anon, authenticated, PUBLIC`) for
at lukke hullet reelt.

## Dette er 2. forekomst

Nøjagtig samme rodårsag ramte allerede `apply_stage_result` og `sync_auth_email_to_users`
i #1971 (`database/2026-06-29-secure-securitydefiner-rpc-grants.sql`, linje 17-24) — den
migration dokumenterer allerede mekanismen og bruger korrekt `FROM anon, authenticated, PUBLIC`.
#2327/#2345 (6 uger senere) genintroducerede fejlen ved ikke at følge det etablerede mønster.

## Fix

`database/2026-07-12-security-advisor-hardening.sql` — Blok B: eksplicit
`REVOKE EXECUTE ... FROM PUBLIC` for de 11 berørte funktioner + re-affirmerer
`GRANT ... TO service_role`.

## Forward-guard

Enhver fremtidig REVOKE-migration på en SECURITY DEFINER/muterende funktion **skal**
inkludere `PUBLIC` i REVOKE-listen, ikke kun de navngivne roller man vil spærre. Overvej
en automatiseret advisor-baseret check (`get_advisors` kører allerede ugentligt) der
specifikt flagger `proacl` med `=X` (PUBLIC) på funktioner der IKKE er beregnet til
offentlig adgang — dette ville have fanget #2327/#2345's ufuldstændige fix samme dag den
blev merged, i stedet for at det lå åbent i ~24 timer indtil #2258's manuelle audit.
