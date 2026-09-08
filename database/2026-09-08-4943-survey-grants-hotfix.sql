-- #4943 · Hotfix: table-grants manglede for spoergeskema-tabellerne.
--
-- HÆNDELSE (8/9 kl. 14:30): spoergeskemaet '2026-09-features' blev aabnet og
-- 241 managers inviteret, men INGEN kunne gemme svar. Root cause:
-- 2026-09-07-4943-in-app-survey.sql opretter RLS-policies for
-- INSERT/UPDATE/DELETE på public.survey_responses og INSERT på
-- public.survey_completions, men giver ALDRIG tabel-grants til rollen
-- `authenticated` — kun SELECT var til stede (fra ENABLE ROW LEVEL SECURITY-
-- opsætningen; ingen anden GRANT stod i filen). Postgres tjekker
-- tabel-privilegier FØR RLS-policyerne overhovedet evalueres, saa enhver
-- INSERT/UPDATE/DELETE blev afvist med 42501, uanset at policyerne selv var
-- korrekte.
--
-- Ejeren gav go til at rette det direkte i prod under hændelsen. Denne fil er
-- den skriftlige, idempotente version af det samme GRANT, saa retten staar i
-- database/ og ikke kun i en session-log.
--
-- ALLEREDE APPLIED MANUELT 8/9 kl. 14:33 (orkestrator, ejer-go): kørt direkte
-- mod prod som
--   GRANT INSERT, UPDATE, DELETE ON public.survey_responses TO authenticated;
--   GRANT INSERT ON public.survey_completions TO authenticated;
-- og verificeret med has_table_privilege (alle fire kombinationer true).
--
-- DEL 2 (samme dag, 14:55): "Send mine svar" laver et `INSERT ... ON CONFLICT
-- DO UPDATE` (upsert) mod public.survey_completions. Postgres kræver
-- UPDATE-tabelret for at PLANLÆGGE en upsert overhovedet — ogsaa naar raekken
-- slet ikke findes endnu og forespørgslen reelt kun indsætter. Uden
-- GRANT UPDATE fejlede upserten stadig med 42501, selvom INSERT-grantet fra
-- del 1 var på plads. ALLEREDE APPLIED MANUELT 8/9 kl. 14:56 (orkestrator,
-- ejer-go):
--   GRANT UPDATE ON public.survey_completions TO authenticated;
-- verificeret med has_table_privilege (true). CI's kørsel af DENNE fil er
-- derfor stadig en no-op i prod for alle tre GRANT-linjer.
--
-- CI's kørsel af DENNE fil (auto-migrate.yml) er derfor en NO-OP i prod — GRANT
-- er selv idempotent (gentaget GRANT af en allerede-given rettighed fejler
-- ikke og ændrer intet). Filen skrives alligevel, saa retten er i git-historik,
-- reproducerbar for andre miljøer (lokal/staging), og dækket af forward-guarden
-- i scripts/lint-sql-policy-grants.mjs.
--
-- Ingen destruktiv klasse. GRANT er i sig selv idempotent.
--
-- Post-verify:
--   SELECT has_table_privilege('authenticated', 'public.surveys', 'SELECT');             -- forventet t
--   SELECT has_table_privilege('authenticated', 'public.survey_questions', 'SELECT');     -- forventet t
--   SELECT has_table_privilege('authenticated', 'public.survey_responses', 'SELECT');     -- forventet t
--   SELECT has_table_privilege('authenticated', 'public.survey_responses', 'INSERT');     -- forventet t
--   SELECT has_table_privilege('authenticated', 'public.survey_responses', 'UPDATE');     -- forventet t
--   SELECT has_table_privilege('authenticated', 'public.survey_responses', 'DELETE');     -- forventet t
--   SELECT has_table_privilege('authenticated', 'public.survey_completions', 'SELECT');   -- forventet t
--   SELECT has_table_privilege('authenticated', 'public.survey_completions', 'INSERT');   -- forventet t
--   SELECT has_table_privilege('authenticated', 'public.survey_completions', 'UPDATE');   -- forventet t (del 2)

-- SELECT eksplicit for alle fire tabeller (harmløst hvor det allerede var til
-- stede via RLS-opsætningen — GRANT er additiv og idempotent).
GRANT SELECT ON public.surveys              TO authenticated;
GRANT SELECT ON public.survey_questions     TO authenticated;
GRANT SELECT ON public.survey_responses     TO authenticated;
GRANT SELECT ON public.survey_completions   TO authenticated;

-- De manglende skrive-grants — selve hotfixen (del 1).
GRANT INSERT, UPDATE, DELETE ON public.survey_responses   TO authenticated;
GRANT INSERT               ON public.survey_completions TO authenticated;

-- Del 2: upsert på survey_completions kræver UPDATE-tabelret, også ved den
-- allerførste indsættelse for en bruger (Postgres tjekker retten for at
-- planlægge ON CONFLICT DO UPDATE, uafhængigt af om raekken findes).
GRANT UPDATE ON public.survey_completions TO authenticated;
