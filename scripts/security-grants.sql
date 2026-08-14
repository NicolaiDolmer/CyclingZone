-- security-grants.sql — klient-eksekverbare SECURITY DEFINER-funktioner (#2858).
--
-- Kontrakt: returnerer ÉN række pr. fund. TOM output = sund DB.
-- Kolonner: severity | check | detail  (pipe-separeret af workflowen).
-- Kørt dagligt af .github/workflows/security-grants-audit.yml; ikke-tomt
-- output → GitHub-issue. Samme form som scripts/db-health.sql.
--
-- ── Hvorfor denne findes ─────────────────────────────────────────────────────
--
-- Supabase' `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO anon,
-- authenticated` granter EXECUTE til begge klient-roller ved ENHVER funktions-
-- oprettelse i public. `REVOKE ALL ... FROM PUBLIC` fjerner IKKE de eksplicitte
-- role-grants. En ny SECURITY DEFINER-funktion er derfor kaldbar over
-- /rest/v1/rpc/<navn> med den publicerbare anon-nøgle med det samme, medmindre
-- migrationen eksplicit gør `REVOKE ... FROM anon, authenticated`.
--
-- Klassen har bidt tre gange:
--   #2676, #2692 — begge reddet af en intern auth.role()-gate i kroppen.
--   #3765 (14/8)  — apply_race_results_batch: INGEN intern gate, og funktionen
--                   sletter + indsætter i race_results. Enhver kunne have
--                   omskrevet ethvert løbs resultater. Stod åbent i 9 dage.
--
-- #3765 blev IKKE fanget af noget eksisterende værn, fordi:
--   1. auto-migrate.yml kører kun `database/*.sql` (maxdepth 1) — funktionen
--      kom fra database/proposals/, som automatikken aldrig rører. Den blev
--      anvendt i hånden, og kun CREATE-delen kom med; REVOKE-linjerne nederst
--      i filen blev aldrig kørt.
--   2. rls-audit.yml dækker TABEL-grants (#2830), ikke FUNKTIONS-grants.
--   3. Ingen workflow kaldte Supabase-advisoren (0028/0029) eller læste
--      pg_proc.proacl.
--
-- Dette tjek lukker punkt 3, og fanger dermed ogsaa hånd-anvendt SQL — det
-- statiske lint (scripts/check-secdef-revoke-lint.mjs) kan pr. definition kun
-- se filer, ikke hvad der faktisk står i databasen.
--
-- ── Allowlist ────────────────────────────────────────────────────────────────
--
-- Funktioner der BEVIDST er klient-eksekverbare. Hver enkelt er verificeret
-- 14/8 til enten at være read-only ELLER at have en intern autorisations-gate.
-- Tilføj kun her sammen med en begrundelse — en tilføjelse uden begrundelse er
-- præcis den fejl tjekket findes for at fange.
--
--   is_admin                          anon+auth. Read-only, returnerer false for
--                                     anon. Bevidst grantet for at fjerne
--                                     42501-støj fra RLS-policies (#2858).
--   is_beta_tester                    auth. Read-only, kaldes fra RLS-policies.
--   is_offered_intake_rider           auth. Read-only, bærer riders-RLS-policyen
--                                     "Public read riders" (#2581).
--   get_cohort_retention              auth. Read-only admin-analytics, intern gate.
--   get_sprint_metrics                auth. Read-only admin-analytics, intern gate.
--   get_retention_scorecard_activity  auth. Read-only admin-analytics, intern gate.

WITH secdef AS (
  SELECT
    p.oid,
    p.proname,
    pg_get_function_identity_arguments(p.oid) AS args,
    has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_can,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_can,
    -- Grov skrive-detektion: kun brugt til at vælge severity, ikke til at
    -- afgøre om noget er et fund. Falsk-positiv retning er den sikre.
    pg_get_functiondef(p.oid) ~* '\m(insert|update|delete|truncate)\M' AS writes
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND p.proname NOT IN (
      'is_admin',
      'is_beta_tester',
      'is_offered_intake_rider',
      'get_cohort_retention',
      'get_sprint_metrics',
      'get_retention_scorecard_activity'
    )
)
SELECT
  CASE WHEN writes THEN 'CRITICAL' ELSE 'WARN' END AS severity,
  'secdef_client_executable' AS check,
  proname || '(' || args || ')'
    || ' — EXECUTE: '
    || concat_ws(' + ',
         CASE WHEN anon_can THEN 'anon' END,
         CASE WHEN auth_can THEN 'authenticated' END)
    || CASE WHEN writes
            THEN ' — funktionen SKRIVER. Kør: REVOKE EXECUTE ON FUNCTION public.'
                 || proname || '(' || args || ') FROM anon, authenticated;'
            ELSE ' — read-only. Bekræft at det er tilsigtet, ellers revoke.'
       END AS detail
FROM secdef
WHERE anon_can OR auth_can
ORDER BY writes DESC, proname;
