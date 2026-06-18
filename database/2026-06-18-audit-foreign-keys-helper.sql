-- FK-audit helper RPC (forward-guard mod relaunch-reset FK-crash-klassen, #1471 · #1464).
--
-- Returnerer én række pr. (foreign key-constraint, kolonne) i public-skemaet med dens
-- ON DELETE-handling som menneske-tekst. Bruges af scripts/audit-reset-fk-coverage.js til
-- at finde FK'er med ON DELETE NO ACTION/RESTRICT der peger på en tabel beta-reset SLETTER
-- rækker fra — den klasse der crashede relaunch-applyen 18/6 (finance_transactions →
-- loans/races/seasons, board_profiles/academy → seasons). Auditen krydstjekker det LIVE
-- prod-skema mod en checked-in baseline og fejler ved enhver ny uhåndteret blocking-FK.
--
-- Spejler mønstret fra database/2026-05-10-audit-rls-helper.sql (SECURITY DEFINER, kun
-- service_role må EXECUTE). Read-only — ingen skriv, ingen prod-risiko.

CREATE OR REPLACE FUNCTION public.audit_foreign_keys()
RETURNS TABLE (
  constraint_name text,
  child_table text,
  child_column text,
  parent_table text,
  parent_column text,
  delete_action text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT
    con.conname::text AS constraint_name,
    child.relname::text AS child_table,
    child_att.attname::text AS child_column,
    parent.relname::text AS parent_table,
    parent_att.attname::text AS parent_column,
    CASE con.confdeltype
      WHEN 'a' THEN 'NO ACTION'
      WHEN 'r' THEN 'RESTRICT'
      WHEN 'c' THEN 'CASCADE'
      WHEN 'n' THEN 'SET NULL'
      WHEN 'd' THEN 'SET DEFAULT'
      ELSE con.confdeltype::text
    END AS delete_action
  FROM pg_constraint con
  JOIN pg_class child ON child.oid = con.conrelid
  JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
  JOIN pg_class parent ON parent.oid = con.confrelid
  JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
  -- Unnest child- og parent-kolonner positionsvist (composite-FK-sikkert; vores er enkelt-kolonne).
  JOIN LATERAL unnest(con.conkey)  WITH ORDINALITY AS ck(attnum, ord) ON true
  JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS pk(attnum, ord) ON pk.ord = ck.ord
  JOIN pg_attribute child_att  ON child_att.attrelid  = con.conrelid  AND child_att.attnum  = ck.attnum
  JOIN pg_attribute parent_att ON parent_att.attrelid = con.confrelid AND parent_att.attnum = pk.attnum
  WHERE con.contype = 'f'
    AND child_ns.nspname = 'public'
    AND parent_ns.nspname = 'public'
  ORDER BY parent.relname, child.relname, child_att.attname;
$$;

REVOKE ALL ON FUNCTION public.audit_foreign_keys() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_foreign_keys() TO service_role;
