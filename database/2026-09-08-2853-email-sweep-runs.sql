-- #2853 · Sweep-koersels-log for mail-loopet (kandidater vs. faktisk sendt).
--
-- PROBLEM: den daglige sundhedsrapport (backend/lib/emailHealthReport.js) skal
-- kunne svare paa "fandt sweepen kandidater, som den saa IKKE fik sendt til?".
-- Det er den ENESTE stille fejlklasse der ikke efterlader et spor i email_log:
-- en sweep der finder 12 kandidater og skriver 0 raekker ser fra email_log's
-- side praecis ud som en sweep der ikke fandt nogen. Fundet 8/9 (#2853,
-- dry_run-sessionen) var netop den form: hver kandidat kastede paa en
-- manglende unsub-hemmelighed, og INGEN email_log-raekke blev skrevet -- kun
-- Sentry saa det.
--
-- FIX: hver sweep-koersel MED mindst én kandidat skriver én raekke her.
-- Koersler uden kandidater skriver intet (welcome-sweepen tikker hvert 5.
-- minut; en tom tick har ingen informationsvaerdi og skal ikke koste en
-- skrivning). Rapporten sammenligner candidates mod sent pr. type pr. doegn.
--
-- Skrivningen er BEST-EFFORT i sweepsene: en fejlet log-skrivning maa aldrig
-- vaelte en sweep der ellers gjorde sit arbejde (samme kontrakt som
-- cronHeartbeat.js's recordCronCheckIn).
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Sikker at koere igen. Ikke-destruktiv.
--
-- ⚠️ Denne fil COMMITTES kun -- den anvendes ALDRIG af implementerings-agenten
--    mod nogen database under selve PR'en. auto-migrate.yml koerer den ved
--    merge (#2642-rammer); Claude laver KUN post-verify bagefter.
--
-- POST-VERIFY (koeres EFTER merge, read-only):
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'email_sweep_runs'
--    ORDER BY ordinal_position;
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_schema = 'public' AND table_name = 'email_sweep_runs';
--
-- Rollback:
--   DROP TABLE IF EXISTS public.email_sweep_runs;

CREATE TABLE IF NOT EXISTS public.email_sweep_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'welcome' | 'day1' | 'race_digest' -- samme type-navne som
  -- email_log.email_type og emailLoopFlag.js's EMAIL_LOOP_TYPE_KEYS.
  email_type TEXT NOT NULL,
  -- Stage'n koerslen loeb under ('dry_run' | 'on'). En 'off'-sweep naar
  -- aldrig hertil (den returnerer foer kandidat-query'en).
  stage TEXT,
  candidates INT NOT NULL DEFAULT 0,
  sent INT NOT NULL DEFAULT 0,
  skipped INT NOT NULL DEFAULT 0,
  failed INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rapportens vindue-query: WHERE created_at >= ... GROUP BY email_type.
CREATE INDEX IF NOT EXISTS email_sweep_runs_type_created_at_idx
  ON public.email_sweep_runs (email_type, created_at);

ALTER TABLE public.email_sweep_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.email_sweep_runs FROM anon, authenticated;
GRANT ALL ON public.email_sweep_runs TO service_role;

COMMENT ON TABLE public.email_sweep_runs IS
  '#2853: én raekke pr. mail-sweep-koersel der fandt mindst én kandidat. Grundlag for sundhedsrapportens "kandidater fundet vs. faktisk sendt pr. type" og for taerskelen "type havde kandidater men sendte 0 to dage i traek". service-role only.';
