-- security-rls-role-smoketest.sql — runtime bekræftelse af #2671 (punkt 2).
--
-- Kontrakt: returnerer ÉN række pr. fund. TOM output = sund DB.
-- Kolonner: severity | check | detail  (pipe-separeret af workflowen, samme
-- form som scripts/security-grants.sql og scripts/security-rls-policy-fn-grants.sql).
-- Kørt af .github/workflows/security-grants-audit.yml ved siden af de to
-- eksisterende grant-tjek. INGEN prod-mutation: hele scriptet kører i ÉN
-- transaktion der ROLLBACK'es til sidst, uanset udfald.
--
-- ── Hvorfor denne findes (mønster fra .claude/learnings/2026-05-31-…) ────────
--
-- scripts/security-rls-policy-fn-grants.sql (punkt 1, #4464) er en STATISK
-- kontrol: den udtrækker funktionsnavne af pg_get_expr(polqual) med en regex
-- og slår has_function_privilege() op. Det er den rigtige metode til at finde
-- ALLE tilfælde, men den er tekstuel — går regex-udtrækket i stykker på en
-- policy skrevet på en uventet måde (fx en funktion kaldt via et cast, en
-- CASE-gren, eller et navn regexen ikke matcher), ser den statiske kontrol
-- intet, og guarden går grøn på en database der reelt fejler.
--
-- Dette script er den anden halvdel: det gør IKKE tekstanalyse, det GØR
-- rent faktisk det en anon/authenticated-klient ville gøre, og fanger den
-- ÆGTE fejl fra Postgres selv (`42501 permission denied for function`) —
-- samme metode som `.claude/learnings/2026-05-31-rls-policy-calling-function-needs-role-grant.md`
-- brugte til at diagnosticere den allerførste hændelse:
--
--   BEGIN; SET LOCAL role anon; SELECT count(*) FROM riders; ROLLBACK;
--
-- Denne fil kører præcis det mønster, automatisk, for HVER tabel/rolle-
-- kombination hvor en RLS-policy overhovedet kalder en public-funktion —
-- ikke en håndplukket liste af "centrale tabeller", men den fulde liste
-- point 1 allerede opdager, så en ny berørt tabel er dækket automatisk.
--
-- To lag, ingen af dem kan stå alene: statisk fanger MANGLENDE grants uden
-- at nogen læser rammer den tavse fejl først; runtime beviser at fejlen
-- FAKTISK opstår som ægte klienttrafik ville opleve den, uafhængigt af om
-- regex-udtrækket i punkt 1 ramte rigtigt.
--
-- ── Whitelist (skal holdes i sync med scripts/security-rls-policy-fn-grants.sql) ──
--
-- Samme bevidste fail-closed-tilstand, samme learning-reference. Duplikeret
-- bevidst i stedet for delt, fordi de to scripts er uafhængige metoder — men
-- scripts/security-rls-role-smoketest.test.mjs kræver at denne liste er en
-- delmængde af whitelisten i security-rls-policy-fn-grants.sql, så de to
-- ikke kan drifte fra hinanden uden at en test fejler.
--
-- Nøglet på (tabel, rolle), IKKE (tabel, rolle, funktion): en policy skrevet
-- som `a() OR b()` kortslutter i Postgres, så HVILKEN af de to funktioner
-- der rent faktisk optræder i fejlbeskeden er ikke deterministisk fra
-- kørsel til kørsel. Målt i praksis 18/9: samme (riders, anon)-par gav
-- "permission denied for function is_admin" i én kørsel og ville med lige
-- så stor ret kunne give is_offered_intake_rider i en anden. En whitelist
-- nøglet på funktionsnavn ville derfor give falske "whitelist_stale"-fund
-- hver anden kørsel, fuldstændig uafhængigt af databasens tilstand — det
-- er reglen om at en falsk positiv er den sikre retning, men EN FLAKY
-- falsk positiv er værre end ingen: den lærer folk at ignorere den røde
-- check. (Tabel, rolle) er den eneste granularitet runtime-testen kan
-- observere pålideligt.
--
-- ── Sådan læses fundene ──────────────────────────────────────────────────────
--
-- CRITICAL / rls_smoketest_fn_denied + authenticated
--     En indlogget spiller ville rent faktisk få 42501 på hele tabellen lige
--     nu. Behandl som nedbrud. authenticated kan ALDRIG whitelistes her,
--     samme regel som punkt 1.
--
-- WARN / rls_smoketest_fn_denied + anon
--     anon-læsning fejler faktisk med 42501 lige nu, og er IKKE en kendt
--     whitelistet tilstand. Enten er det en ny regression, eller whitelisten
--     her (eller i security-rls-policy-fn-grants.sql) mangler posten.
--
-- WARN / rls_smoketest_whitelist_stale
--     En whitelistet (tabel, rolle)-kombination fejler IKKE længere i
--     praksis. Grantet er givet, eller policyen er ændret. Fjern posten —
--     denne check er samtidig scriptets eget livstegn.
--
-- ── Kendte grænser ────────────────────────────────────────────────────────────
--   * Ingen request.jwt.claims sættes — dette tester roller-niveau-grants
--     (funktionens EXECUTE), ikke en bestemt brugers RLS-udfald. Præcis den
--     afgrænsning learningen fra 2026-05-31 selv brugte.
--   * SELECT 1 ... LIMIT 1 — nok til at trigge policy-evalueringen uden at
--     hente reelt data.
--   * Samme dækning som punkt 1: kun public-funktioner, kun anon +
--     authenticated, kun policies der matcher regexen nedenfor.

BEGIN;

-- Findes KUN inde i denne transaktion; ROLLBACK fjerner den igen. GRANT er
-- nødvendigt fordi anon/authenticated ellers ikke kan skrive fund til en
-- tabel de ikke ejer, når vi længere nede skifter til deres rolle.
CREATE TEMP TABLE _rls_smoketest_findings (
  tbl text,
  polrole text,
  proname text,
  severity text,
  check_name text,
  detail text
) ON COMMIT DROP;
GRANT SELECT, INSERT ON _rls_smoketest_findings TO anon, authenticated;

DO $$
DECLARE
  rec RECORD;
  fn_name text;
BEGIN
  FOR rec IN
    -- Samme opdagelseslogik som scripts/security-rls-policy-fn-grants.sql
    -- (pol/fn-CTE'erne), men UDEN has_function_privilege-filtret: vi vil
    -- teste ALLE tabel/rolle-par en policy kan ramme, uanset om den
    -- statiske kontrol allerede tror grantet er i orden.
    WITH pol AS (
      SELECT c.relname AS tbl,
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
      SELECT p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname ~ '^[A-Za-z_][A-Za-z0-9_]*$'
    )
    SELECT DISTINCT pol.tbl, polrole
    FROM pol
    CROSS JOIN LATERAL unnest(pol.roles) AS polrole
    JOIN fn ON pol.expr ~ ('\m' || fn.proname || '\s*\(')
  LOOP
    EXECUTE format('SET LOCAL ROLE %I', rec.polrole);
    BEGIN
      EXECUTE format('SELECT 1 FROM public.%I LIMIT 1', rec.tbl);
    EXCEPTION WHEN insufficient_privilege THEN
      IF SQLERRM ~* 'permission denied for function' THEN
        fn_name := substring(SQLERRM FROM 'permission denied for function (\S+)');
        INSERT INTO _rls_smoketest_findings VALUES (rec.tbl, rec.polrole, fn_name, NULL, NULL, SQLERRM);
      END IF;
      -- Andre 42501-årsager (fx ren tabel-grant mangler) er IKKE denne
      -- klasse og rapporteres bevidst ikke her — det er rls-audit.yml's job.
    END;
    RESET ROLE;
  END LOOP;
END $$;

-- ── Whitelist ─────────────────────────────────────────────────────────────
-- Skal være en delmængde af (tabel, rolle)-parrene whitelistet i
-- security-rls-policy-fn-grants.sql (håndhævet af
-- security-rls-role-smoketest.test.mjs).
WITH allowed(tbl, polrole, why) AS (
  VALUES (
    'riders', 'anon',
    'Bevidst fail-closed: anon mangler EXECUTE paa is_admin() og is_offered_intake_rider(uuid), begge kaldt fra "Public read riders". .claude/learnings/2026-07-18-anon-riders-select-fail-closed-42501.md'
  )
)
SELECT CASE WHEN f.polrole = 'authenticated' THEN 'CRITICAL' ELSE 'WARN' END AS severity,
       'rls_smoketest_fn_denied' AS check,
       f.tbl || ' som ' || f.polrole || ' fejler LIVE med: ' || f.detail
         || '. Fix: GRANT EXECUTE ON FUNCTION public.' || f.proname || ' TO ' || f.polrole || ';' AS detail
FROM _rls_smoketest_findings f
LEFT JOIN allowed a ON a.tbl = f.tbl AND a.polrole = f.polrole
WHERE a.tbl IS NULL

UNION ALL

SELECT 'WARN' AS severity,
       'rls_smoketest_whitelist_stale' AS check,
       'Whitelist-posten ' || a.tbl || ' / ' || a.polrole
         || ' fejler ikke længere i praksis. Fjern posten fra scripts/security-rls-role-smoketest.sql. Baggrund: ' || a.why
         AS detail
FROM allowed a
WHERE NOT EXISTS (
  SELECT 1 FROM _rls_smoketest_findings f
  WHERE f.tbl = a.tbl AND f.polrole = a.polrole
);

ROLLBACK;
