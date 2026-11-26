-- #8797: rytterlistens nationalitetsfilter hentede nationality_code for ALLE aktive
-- ryttere og lavede distinct i browseren. Over 1.000 ryttere afkortede PostgREST
-- svaret stille, så filtret manglede nationer. Distinct laves nu i databasen; svaret
-- er én række pr. nation og kan ikke nå rækkeloftet.
--
-- security_invoker: viewet ser kun de ryttere den kaldende rolle selv må se (riders-RLS
-- gælder uændret), så det åbner intet nyt.
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE VIEW public.rider_nationality_codes
  WITH (security_invoker = true) AS
SELECT DISTINCT r.nationality_code
FROM public.riders r
WHERE r.is_retired = false
  AND r.nationality_code IS NOT NULL;

GRANT SELECT ON public.rider_nationality_codes TO anon, authenticated, service_role;

-- Verifikation (post-merge):
--   SELECT count(*) FROM public.rider_nationality_codes;  -- antal nationer, ikke ryttere
--   SELECT count(DISTINCT nationality_code) FROM public.riders
--    WHERE is_retired = false AND nationality_code IS NOT NULL;  -- samme tal
