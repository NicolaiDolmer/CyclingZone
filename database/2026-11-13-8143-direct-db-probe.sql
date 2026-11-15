-- #8143 trin 1 · Måleprøvens lille opgørelse og dens kontakt.
--
-- 1) public.direct_db_probe_samples: to rækker i minuttet, mens prøven er tændt
--    (én pr. vej: web-adgangen og den direkte linje). Kun serveren læser og skriver
--    (RLS uden policies, ingen rettigheder til anon/authenticated). Prøven sletter
--    selv rækker, der er ældre end 14 dage, én gang i timen, så tabellen aldrig
--    bliver større end ca. 40.000 små rækker.
--    Opgørelsen pr. vej pr. time læses med én SELECT (docs/AI_OPS_REFERENCE.md).
--
-- 2) app_config-rækken direct_db_probe_8143 = "off". Prøven læser nøglen direkte
--    (kun "on" tænder); ingen række betyder også slukket. Rækken lægges ind, så
--    ejerens "kør" er én UPDATE. Ingen spillervendt virkning.
--
-- Additiv + idempotent: CREATE TABLE IF NOT EXISTS, ON CONFLICT DO NOTHING.
-- Køres efter merge (#2642).
--
-- POST-VERIFY (read-only):
--   SELECT value FROM public.app_config WHERE key = 'direct_db_probe_8143';   -- "off"
--   SELECT count(*) FROM public.direct_db_probe_samples;                       -- 0
-- Rollback: DROP TABLE public.direct_db_probe_samples;
--           DELETE FROM public.app_config WHERE key = 'direct_db_probe_8143';
--
-- Refs #8143

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS public.direct_db_probe_samples (
  sampled_at timestamptz NOT NULL,
  path text NOT NULL CHECK (path IN ('web', 'direct')),
  ok boolean NOT NULL,
  query_ms real,
  acquire_ms real,
  new_connection boolean,
  error_kind text,
  PRIMARY KEY (sampled_at, path)
);

COMMENT ON TABLE public.direct_db_probe_samples IS
  '#8143 trin 1: måleprøve, ét lille spørgsmål pr. vej i minuttet (web-adgangen og den direkte linje). Kun serveren. Prøven sletter rækker ældre end 14 dage.';

-- data-api-access: {"table":"public.direct_db_probe_samples","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","DELETE"]},"reason":"Internal measurement probe for #8143; only the backend writes samples and expires rows older than 14 days"}
ALTER TABLE public.direct_db_probe_samples ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.direct_db_probe_samples FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON public.direct_db_probe_samples TO service_role;

INSERT INTO public.app_config (key, value, description)
VALUES (
  'direct_db_probe_8143',
  '"off"'::jsonb,
  'Internal switch (off|on) for the #8143 step 1 measurement probe: once a minute, one small question over the web API and one over the direct database line, timed and stored in direct_db_probe_samples. No player-facing effect. Only "on" turns it on.'
)
ON CONFLICT (key) DO NOTHING;

COMMIT;
