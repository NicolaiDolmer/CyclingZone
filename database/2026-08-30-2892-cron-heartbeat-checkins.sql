-- 2026-08-30 — #2892: egen cron-heartbeat-vagt (check-in-tabel).
--
-- PROBLEM
--   Sentys basisplan tillader kun 1 aktiv cron-monitor. cronMonitorRegistry.js
--   (ALL_CRON_MONITORS) registrerer ~40 periodiske jobs til Sentry-heartbeats,
--   men Sentry disabler resten pga. kvote — det er kvote, ikke en fejl (ejer-
--   beslutning 6/8, "valg A": byg egen vagt i stedet for at forsøge at
--   genforhandle/genaktivere Sentry-monitorerne).
--
-- LØSNING
--   En simpel check-in-tabel: hvert periodisk job i backend/cron.js skriver et
--   check-in her efter et vellykket tick (lib/cronHeartbeat.js). Et separat
--   sweep-tick sammenligner sidste check-in mod forventet kadence + margin og
--   alarmerer Discord #ops når et job er overskredet. expected_cadence_seconds
--   caches her for introspektion (dashboards/ad-hoc SQL) men er IKKE en ny
--   SSOT — den genskrives fra ALL_CRON_MONITORS ved HVERT check-in, så
--   cronMonitorRegistry.js forbliver den ene sandhed om kadence.
--
-- IDEMPOTENT: kan køres flere gange uden effekt (IF NOT EXISTS overalt).

CREATE TABLE IF NOT EXISTS public.cron_checkins (
  job_slug                  text PRIMARY KEY,
  last_checkin_at           timestamptz NOT NULL DEFAULT now(),
  expected_cadence_seconds  integer NOT NULL,
  updated_at                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cron_checkins IS
  '#2892 — egen cron-heartbeat-vagt. Én række pr. job-slug (matcher ALL_CRON_MONITORS i backend/lib/cronMonitorRegistry.js). last_checkin_at opdateres af backend/lib/cronHeartbeat.js efter hvert vellykket tick; expected_cadence_seconds er en cache af registrets kadence, ikke en selvstændig SSOT.';

-- RLS: ren ops-metadata (job-slug + timestamps, ingen PII). Backend læser/skriver
-- via service_role (bypasser RLS). RLS enabled + eksplicit deny-all-policy for
-- anon/authenticated — samme mønster som ops_alert_state (2026-07-20).
ALTER TABLE public.cron_checkins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cron_checkins_no_client_access" ON public.cron_checkins;
CREATE POLICY "cron_checkins_no_client_access" ON public.cron_checkins
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- pgrst schema-reload (billigt; matcher andre nye tabeller).
NOTIFY pgrst, 'reload schema';

-- POST-VERIFY (kør efter apply):
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'cron_checkins'
--    ORDER BY ordinal_position;
--   -- forventet: job_slug/text, last_checkin_at/timestamptz, expected_cadence_seconds/integer, updated_at/timestamptz
--
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'cron_checkins';
--   -- forventet: t
--
--   SELECT policyname FROM pg_policies WHERE tablename = 'cron_checkins';
--   -- forventet: cron_checkins_no_client_access
