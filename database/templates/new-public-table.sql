-- TEMPLATE ONLY: copy into a dated migration and replace example_notes.
-- Never run this template directly in production.
-- data-api-access: {"table":"public.example_notes","roles":{"anon":[],"authenticated":["SELECT"],"service_role":["SELECT","INSERT","UPDATE","DELETE"]},"reason":"Owners read their notes; the backend manages writes"}
BEGIN;
CREATE TABLE IF NOT EXISTS public.example_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  body text NOT NULL
);
ALTER TABLE public.example_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.example_notes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.example_notes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.example_notes TO service_role;
DROP POLICY IF EXISTS example_notes_owner_read ON public.example_notes;
CREATE POLICY example_notes_owner_read ON public.example_notes
  FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));
COMMIT;
