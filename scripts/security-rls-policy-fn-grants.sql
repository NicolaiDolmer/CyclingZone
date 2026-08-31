-- security-rls-policy-fn-grants.sql — funktioner kaldt fra RLS-policies skal
-- kunne eksekveres af de roller policyen rammer (#2671).
--
-- Kontrakt: returnerer ÉN række pr. fund. TOM output = sund DB.
-- Kolonner: severity | check | detail  (pipe-separeret af workflowen).
-- Kørt af .github/workflows/security-grants-audit.yml ved siden af
-- scripts/security-grants.sql; ikke-tomt output → GitHub-issue.
--
-- ── Hvorfor denne findes ─────────────────────────────────────────────────────
--
-- En RLS-policy evalueres MED KALDERENS rettigheder. Kalder policyen
-- `is_admin()`, skal enhver rolle der rammer tabellen have EXECUTE på
-- `is_admin()`. Mangler grantet, fejler ALLE læsninger for den rolle med
-- 42501 "permission denied for function". Fejlen er tavs: den rammer kun
-- roller som ingen tester i hånden, og den ligner ikke en RLS-afvisning.
--
-- Klassen har bidt tre gange på PRÆCIS samme policy (riders / "Public read riders"):
--   2026-05-31  policyen begyndte at kalde is_admin() uden anon-grant.
--               .claude/learnings/2026-05-31-rls-policy-calling-function-needs-role-grant.md
--   2026-06-29  database/2026-06-29-secure-securitydefiner-rpc-grants.sql revokede
--               anon-EXECUTE på is_admin() + is_offered_intake_rider(uuid).
--               Backwards-checken greppede kun efter `.rpc()`-kaldssteder og
--               overså RLS-policy-stien. Stod uopdaget i ~3 uger.
--               .claude/learnings/2026-07-18-anon-riders-select-fail-closed-42501.md
--   2026-08-05  is_offered_intake_rider blev tilføjet policyen uden at arve
--               anon-grantet fra søsterfunktionen is_admin. Fanget ved held,
--               mens moneySupplyScorecard kørte sin live-sektion.
--
-- scripts/security-grants.sql dækker den MODSATTE retning: SECURITY DEFINER-
-- funktioner som klienten KAN kalde (over-grants). Denne fil dækker under-grants.
--
-- ── Sådan læses fundene ──────────────────────────────────────────────────────
--
-- CRITICAL / policy_fn_missing_execute + authenticated
--     En indlogget spiller får 42501 på hele tabellen. Behandl som nedbrud.
--     Fix: GRANT EXECUTE ON FUNCTION public.<fn>(<args>) TO authenticated;
--
-- WARN / policy_fn_missing_execute + anon
--     Anon-læsning af tabellen fail-closer med 42501. Kan være tilsigtet
--     (strammeste tilstand), men SKAL være en bevidst beslutning: enten
--     GRANT EXECUTE, eller scope policyen `TO authenticated` så anon får en
--     ren tom afvisning i stedet for en fejl, eller whitelist nedenfor MED
--     reference til den learning der dokumenterer beslutningen.
--
-- WARN / policy_fn_whitelist_stale
--     En whitelist-post matcher ikke længere et fund. Grantet er givet, eller
--     policyen er omdøbt/droppet. Fjern posten. Denne check er samtidig
--     tjekkets eget livstegn: den fyrer hvis scanningen holder op med at se
--     den ene kendte post, og dermed også hvis selve udtræks-logikken går i stå.
--
-- CRITICAL / policy_fn_name_not_regex_safe
--     Funktionsnavnet kan ikke indsættes sikkert i scannings-regexen, så
--     funktionen falder UDEN FOR dækningen. Aldrig et acceptabelt fund.
--
-- ── Dækning (målt mod prod 30/8 2026) ────────────────────────────────────────
--
-- 189 policies i public, 257 funktioner i public, 0 overloads, 0 navne uden
-- for [A-Za-z_][A-Za-z0-9_]*. Scanningen finder 64 (policy, funktion, rolle)-
-- tripler fordelt på 61 policies og 2 funktioner (is_admin 62,
-- is_offered_intake_rider 2). Ét fund, som er whitelistet nedenfor.
--
-- Kendte grænser, bevidst valgte:
--   * Kun funktioner i `public`. Supabase' egne (auth.uid(), auth.role())
--     er grantet bredt af platformen og ejes ikke herfra.
--   * Kun rollerne anon + authenticated. Det er de to PostgREST-roller en
--     klient kan optræde som; service_role rammes ikke af RLS.
--   * Kun DIREKTE kald i policy-udtrykket. Kalder policy-funktionen selv en
--     anden funktion, kører det indre kald som funktionens ejer (SECURITY
--     DEFINER) eller som kalderen (INVOKER), og i begge tilfælde er det
--     ydre grant det eneste der kan mangle for at policyen fejler.
--   * Tekstuel match på funktionsnavn i pg_get_expr-outputtet. Et navn der
--     også optræder som kolonnenavn giver en falsk positiv, hvilket er den
--     sikre retning: en falsk positiv koster en whitelist-linje, en falsk
--     negativ koster tre ugers tavs 42501.

WITH pol AS (
  SELECT c.relname AS tbl,
         pol.polname,
         -- polroles = '{0}' betyder PUBLIC, dvs. policyen rammer begge
         -- klient-roller. Er den scoped `TO ...`, tæller kun de navngivne.
         CASE WHEN pol.polroles = '{0}' THEN ARRAY['anon','authenticated']
              ELSE ARRAY(SELECT r.rolname::text FROM pg_roles r
                         WHERE r.oid = ANY(pol.polroles)
                           AND r.rolname IN ('anon','authenticated')) END AS roles,
         coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' ||
         coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') AS expr
  FROM pg_policy pol
  JOIN pg_class c ON c.oid = pol.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
),
fn AS (
  SELECT p.oid,
         p.proname,
         pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    -- Navne uden for dette mønster ville gøre regexen nedenfor ugyldig.
    -- De rapporteres separat som policy_fn_name_not_regex_safe.
    AND p.proname ~ '^[A-Za-z_][A-Za-z0-9_]*$'
),
mismatch AS (
  SELECT pol.tbl, pol.polname, fn.proname, fn.args, polrole
  FROM pol
  CROSS JOIN LATERAL unnest(pol.roles) AS polrole
  JOIN fn ON pol.expr ~ ('\m' || fn.proname || '\s*\(')
  WHERE NOT has_function_privilege(polrole, fn.oid, 'EXECUTE')
),
-- ── Whitelist ────────────────────────────────────────────────────────────────
-- Fail-closed-tilstande der ER en truffet beslutning. Tilføj kun med en
-- learning-reference: en whitelist-post uden dokumenteret beslutning er
-- præcis den tavshed dette tjek findes for at bryde.
allowed(tbl, polname, proname, polrole, why) AS (
  VALUES (
    'riders', 'Public read riders', 'is_offered_intake_rider', 'anon',
    'Bevidst fail-closed. Fuld kodebase-audit 18/7 2026 viste at ingen pre-login-flade laeser riders. Beslutning + re-grant-opskrift: .claude/learnings/2026-07-18-anon-riders-select-fail-closed-42501.md'
  )
)
SELECT CASE WHEN m.polrole = 'authenticated' THEN 'CRITICAL' ELSE 'WARN' END AS severity,
       'policy_fn_missing_execute' AS check,
       m.tbl || ' / "' || m.polname || '" kalder ' || m.proname || '(' || m.args || ')'
         || ', men rollen ' || m.polrole || ' mangler EXECUTE. '
         || 'Alle ' || m.polrole || '-adgange til ' || m.tbl || ' fejler med 42501. '
         || 'Fix: GRANT EXECUTE ON FUNCTION public.' || m.proname || '(' || m.args || ') TO ' || m.polrole || ';'
         AS detail
FROM mismatch m
LEFT JOIN allowed a
  ON a.tbl = m.tbl AND a.polname = m.polname
 AND a.proname = m.proname AND a.polrole = m.polrole
WHERE a.tbl IS NULL

UNION ALL

SELECT 'WARN' AS severity,
       'policy_fn_whitelist_stale' AS check,
       'Whitelist-posten ' || a.tbl || ' / "' || a.polname || '" / ' || a.proname
         || ' / ' || a.polrole || ' matcher ikke laengere et fund. '
         || 'Enten er grantet givet, eller policyen er omdoebt eller droppet. '
         || 'Fjern posten fra scripts/security-rls-policy-fn-grants.sql. Baggrund: ' || a.why
         AS detail
FROM allowed a
WHERE NOT EXISTS (
  SELECT 1 FROM mismatch m
  WHERE m.tbl = a.tbl AND m.polname = a.polname
    AND m.proname = a.proname AND m.polrole = a.polrole
)

UNION ALL

SELECT 'CRITICAL' AS severity,
       'policy_fn_name_not_regex_safe' AS check,
       'public.' || p.proname || ' har et navn der ikke kan indsaettes sikkert i '
         || 'scannings-regexen, saa funktionen er ikke daekket af dette tjek. '
         || 'Omdoeb funktionen, eller udvid udtraekket i scripts/security-rls-policy-fn-grants.sql.'
         AS detail
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname !~ '^[A-Za-z_][A-Za-z0-9_]*$'

ORDER BY 1, 3;
