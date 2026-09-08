-- #2853 · Resend-webhook-events (leveringsstatus, bounce, klage, indgaaende svar).
--
-- PROBLEM: email_log kender kun hvad VI gjorde (sent/dry_run/failed ved
-- afsendelsestidspunktet). Alt hvad der sker BAGEFTER hos modtageren --
-- leveret, hard bounce, spam-klage, forsinket levering -- var usynligt. En
-- doed adresse blev derfor ved med at faa mails, og en spam-klage naaede
-- aldrig nogen. Det er praecis den slags stilhed der brænder et
-- afsender-domaenes omdoemme ned uden at nogen opdager det.
--
-- FIX (to dele):
--   1. Ny tabel email_events: raa, append-only log over Resends webhook-
--      leveringer. provider_event_id (Svix' `svix-id`-header) er UNIQUE og
--      ER idempotens-ankeret -- en gen-levering fra Resend rammer conflict
--      og bliver et no-op i stedet for at koere sideeffekterne to gange.
--      Samme rolle som email_log.dedupe_key spiller mod Resends
--      Idempotency-Key ved afsendelse.
--   2. Udvidelse af email_log.status' CHECK-constraint med 'delivered',
--      'bounced' og 'complained'. Webhooken opdaterer den afsendte raekke
--      (join paa provider_id) saa email_log alene svarer paa "naaede den
--      frem?", uden at man skal krydse to tabeller for det basale spoergsmaal.
--
-- HAARD BOUNCE + KLAGE -> undertrykkelse: backend/lib/resendWebhook.js saetter
-- users.email_prefs = merge med {"all": false, "suppressed_reason": ...,
-- "suppressed_at": ...}. Det genbruger den EKSISTERENDE opt-out-mekanisme
-- (emailPrefs.js's master-"all"-noegle, samme som et-kliks-unsubscribe skriver)
-- i stedet for at opfinde en parallel suppression-tabel -- én kilde til
-- sandhed for "maa vi maile denne bruger?".
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS +
-- DROP CONSTRAINT IF EXISTS foer ADD CONSTRAINT (Postgres har ingen
-- ADD CONSTRAINT IF NOT EXISTS, jf. scripts/lint-migration-idempotency.mjs).
-- Sikker at koere igen. Ikke-destruktiv: constraint-udvidelsen er en ren
-- UDVIDELSE af den tilladte vaerdimaengde, ingen eksisterende raekke kan
-- falde udenfor.
--
-- ⚠️ Denne fil COMMITTES kun -- den anvendes ALDRIG af implementerings-agenten
--    mod nogen database under selve PR'en. auto-migrate.yml koerer den ved
--    merge (#2642-rammer), og Claude laver KUN post-verify bagefter.
--
-- POST-VERIFY (koeres EFTER merge, read-only):
--   -- 1. Tabellen findes med de forventede kolonner:
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'email_events'
--    ORDER BY ordinal_position;
--   -- 2. UNIQUE paa provider_event_id (idempotens-ankeret) findes:
--   SELECT conname, contype FROM pg_constraint
--    WHERE conrelid = 'public.email_events'::regclass AND contype IN ('u','p');
--   -- 3. email_log.status accepterer de tre nye vaerdier:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.email_log'::regclass AND conname = 'email_log_status_check';
--   -- Forventet: CHECK ((status = ANY (ARRAY['sent','dry_run','failed','delivered','bounced','complained'])))
--   -- 4. Ingen anon/authenticated-grants tilbage:
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_schema = 'public' AND table_name = 'email_events';
--
-- Rollback:
--   DROP TABLE IF EXISTS public.email_events;
--   ALTER TABLE public.email_log DROP CONSTRAINT IF EXISTS email_log_status_check;
--   ALTER TABLE public.email_log ADD CONSTRAINT email_log_status_check
--     CHECK (status IN ('sent', 'dry_run', 'failed'));

CREATE TABLE IF NOT EXISTS public.email_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Svix' `svix-id`-header: unik pr. LEVERING fra Resend. UNIQUE gør
  -- gen-leveringer (Resends egen retry) til et no-op i webhook-handleren.
  provider_event_id TEXT NOT NULL UNIQUE,
  -- Resends email-id (data.email_id). Matcher email_log.provider_id for
  -- udgaaende mails; NULL for indgaaende (email.received) hvor der ikke
  -- findes en tilsvarende email_log-raekke.
  provider_id TEXT,
  type TEXT NOT NULL,
  recipient TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Opslag "alle events for denne afsendte mail" (drift/fejlsoegning).
CREATE INDEX IF NOT EXISTS email_events_provider_id_idx
  ON public.email_events (provider_id);

-- Sundhedsrapportens vinduer (seneste 24 t / 7 d, grupperet pr. type).
CREATE INDEX IF NOT EXISTS email_events_type_created_at_idx
  ON public.email_events (type, created_at);

ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;

-- Defense-in-depth, samme topologi som email_log (2026-07-20-2725-email-
-- retention-loop.sql): RLS uden policies blokerer allerede alt for
-- anon/authenticated, men en eksplicit REVOKE dokumenterer hensigten.
REVOKE ALL ON public.email_events FROM anon, authenticated;
GRANT ALL ON public.email_events TO service_role;

COMMENT ON TABLE public.email_events IS
  '#2853: raa append-only log over Resend-webhook-events (sent/delivered/delivery_delayed/bounced/complained/received). provider_event_id = Svix'' svix-id og er idempotens-ankeret. service-role only -- ingen anon/authenticated-policies.';
COMMENT ON COLUMN public.email_events.provider_event_id IS
  '#2853: Svix'' svix-id-header for leveringen. UNIQUE -- en gen-levering af samme event bliver et no-op i stedet for at koere sideeffekterne igen.';
COMMENT ON COLUMN public.email_events.provider_id IS
  '#2853: Resends email-id (data.email_id). Join-noegle mod email_log.provider_id for udgaaende mails; NULL for email.received.';

-- Udvidelse af email_log.status: webhooken loefter en afsendt raekke videre
-- til dens faktiske skaebne hos modtageren. DROP + ADD fordi Postgres ikke
-- har ADD CONSTRAINT IF NOT EXISTS; rækkefoelgen er sikker fordi den nye
-- maengde er et supersaet af den gamle.
ALTER TABLE public.email_log DROP CONSTRAINT IF EXISTS email_log_status_check;
ALTER TABLE public.email_log ADD CONSTRAINT email_log_status_check
  CHECK (status IN ('sent', 'dry_run', 'failed', 'delivered', 'bounced', 'complained'));

COMMENT ON COLUMN public.email_log.status IS
  '#2853: sent/dry_run/failed skrives ved afsendelse; delivered/bounced/complained loeftes bagefter af Resend-webhooken (backend/lib/resendWebhook.js) via join paa provider_id. Alle fire "naaede Resend"-vaerdier (sent/delivered/bounced/complained) blokerer en gen-afsendelse i sendLoopEmail''s dedupe-tjek.';
