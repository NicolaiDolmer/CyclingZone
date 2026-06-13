-- #1309 HOTFIX: GRANT SELECT på de nye kontrakt-kolonner til frontend-rollerne.
--
-- riders bruger KOLONNE-PRIVILEGIER (#1162, se 2026-06-10-riders-potentiale-column-privilege.sql):
-- SELECT er REVOKE't på hele tabellen og GRANT't kolonne-for-kolonne til anon/authenticated.
-- Den migration ADVARER eksplicit:
--   "FAIL-CLOSED for fremtidige kolonner: en senere ALTER TABLE riders ADD COLUMN ...
--    er IKKE automatisk klient-læsbar. Nye kolonner der skal kunne læses af frontend
--    kræver et eksplicit GRANT SELECT (ny_kolonne) ON public.riders TO anon, authenticated
--    i samme migration."
--
-- #1309-migrationen (2026-06-13-contract-data-fields.sql) tilføjede contract_length +
-- contract_end_season men glemte denne GRANT. Resultat: frontend (anon/authenticated)
-- fik "permission denied for table riders" på enhver query der selecter kontrakt-
-- kolonnerne (rytter-profil, RidersPage, AuctionsPage, transfers) → rytteren blev null
-- → "rider not found" for HVER rytter. Kolonnerne er player-facing og SKAL kunne læses.
--
-- Anvendt som hotfix direkte i prod 13/6 (Supabase apply_migration); denne fil bringer
-- repoet i sync + sikrer friske miljøer / relaunch-reproduktion. Idempotent (re-grant = no-op).
--
-- Bemærk: friske DB'er var ikke ramt — #1162 kører dynamisk EFTER schema.sql og fanger
-- kolonnen der. Kun eksisterende DB'er (prod), hvor #1162 kørte før kolonnen fandtes,
-- manglede granten.

GRANT SELECT (contract_length, contract_end_season) ON public.riders TO anon, authenticated;

-- pgrst_ddl_watch trigger normalt reload ved GRANT; eksplicit NOTIFY koster intet (jf. #1162).
NOTIFY pgrst, 'reload schema';
