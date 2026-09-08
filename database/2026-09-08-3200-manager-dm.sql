-- database/2026-09-08-3200-manager-dm.sql
-- #3200 · Beskeder mellem managers (DM v1). Design:
-- docs/superpowers/specs/2026-09-08-manager-dm-v1-design.md
--
-- Ejer-designvalg 8/9 (#3200-kommentar), oversat til datamodel:
--
--  1. KUN 1:1. En samtale har præcis to deltagere, og deltagerne er BRUGERE
--     (auth.users), ikke hold — en manager er én person (#4379), så samtalen
--     følger personen hvis han skifter hold. Visningen slår managernavn +
--     holdnavn op via teams.user_id.
--     Den uordnede par-nøgle: participant_a er ALTID least(u1,u2) og
--     participant_b greatest(u1,u2), håndhævet af CHECK + UNIQUE. Uden den
--     ville (A,B) og (B,A) kunne blive to samtaler mellem de samme to
--     mennesker, og ulæst-tælleren ville splitte sig over dem.
--
--  2. BLOKÉR + ANMELD + LOG. dm_messages har hverken UPDATE- eller
--     DELETE-policy for nogen rolle — heller ikke afsenderen. Tabellen ER
--     loggen, og den er evidensen i fair-play-sager (#3131). En bruger kan
--     kun skjule en samtale for SIG SELV (dm_conversation_hides); rækkerne
--     bliver liggende.
--     Blok-semantikken: en blokeret afsenders besked bliver GEMT (loggen skal
--     være komplet), men modtageren ser den ikke og notificeres ikke. Filteret
--     ligger i SELECT-policyen på dm_messages: beskeder fra en bruger jeg har
--     blokeret, sendt EFTER at jeg blokerede, er usynlige for mig. Historik
--     fra før blokeringen bevares — ellers ville en blokering slette
--     konteksten for den anmeldelse man typisk laver samtidig.
--
--  3. ADMIN LÆSER IKKE PRIVAT POST UDEN ANMELDELSE. Admin-policyen på
--     dm_conversations og dm_messages kræver at der findes en dm_reports-række
--     for netop den samtale. Gaten ligger i RLS, ikke kun i UI: en uanmeldt
--     samtale er usynlig for admin på databaseniveau.
--
-- Skrivevejen er backendens service_role (POST /api/messages/send), som laver
-- blok-tjek, længde-validering og rate-limit (30 beskeder pr. 10 min) før
-- INSERT. Derfor har authenticated INGEN INSERT på dm_messages. Læsning sker
-- også gennem backenden i v1; policies er defense in depth mod direkte
-- PostgREST-kald.
--
-- auth.uid() er overalt wrappet som (SELECT auth.uid()) — ellers re-evalueres
-- den pr. række (auth_rls_initplan, samme hærdning som #4720).
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS + DROP POLICY IF EXISTS før
-- CREATE POLICY. Ingen destruktiv klasse, ingen data-skrivning. Applies af CI
-- ved merge (auto-migrate.yml).
--
-- Post-verify:
--   SELECT table_name FROM information_schema.tables
--     WHERE table_schema='public' AND table_name LIKE 'dm\_%' ORDER BY 1;
--     -- forventet: dm_blocks, dm_conversation_hides, dm_conversations,
--     --            dm_messages, dm_reads, dm_reports
--   SELECT tablename, policyname, cmd FROM pg_policies
--     WHERE schemaname='public' AND tablename LIKE 'dm\_%' ORDER BY 1,2;
--     -- forventet: INGEN UPDATE- eller DELETE-policy på dm_messages
--   SELECT count(*) FROM public.dm_messages;   -- forventet 0
--   SELECT conname FROM pg_constraint
--     WHERE conrelid='public.dm_conversations'::regclass ORDER BY 1;
--     -- forventet bl.a. dm_conversations_ordered_pair + unik par-nøgle
--
-- Rollback (kun før nogen har skrevet en besked):
--   DROP TABLE IF EXISTS public.dm_conversation_hides, public.dm_reports,
--     public.dm_blocks, public.dm_reads, public.dm_messages,
--     public.dm_conversations CASCADE;

-- ── dm_conversations ────────────────────────────────────────────────────────

-- ON DELETE CASCADE, bevidst — CodeRabbit foreslog 8/9 RESTRICT, saa "loggen er
-- evidensen" ikke kunne slettes. Afvist: RESTRICT ville goere en konto
-- USLETTELIG i det oejeblik den har sendt eller modtaget een besked, og
-- sletteretten vejer tungere end en fair-play-sag mod en konto der ikke
-- laengere findes. CASCADE er ogsaa praecis det forummet (#3199) goer med
-- forum_posts.user_id og forum_reports.reporter_user_id, saa DM afviger ikke
-- fra den etablerede sletteadfaerd. Evidensen lever saa laenge begge parter
-- findes; det er den periode en sag foeres i.
CREATE TABLE IF NOT EXISTS public.dm_conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_a   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  participant_b   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ,
  CONSTRAINT dm_conversations_ordered_pair CHECK (participant_a < participant_b)
);

CREATE UNIQUE INDEX IF NOT EXISTS dm_conversations_pair_key
  ON public.dm_conversations (participant_a, participant_b);

-- Samtalelisten: "mine samtaler, nyeste øverst". To indexes fordi jeg kan stå
-- i enten a- eller b-kolonnen.
CREATE INDEX IF NOT EXISTS dm_conversations_a_recent_idx
  ON public.dm_conversations (participant_a, last_message_at DESC);
CREATE INDEX IF NOT EXISTS dm_conversations_b_recent_idx
  ON public.dm_conversations (participant_b, last_message_at DESC);

COMMENT ON TABLE public.dm_conversations IS
  '#3200 DM v1: en 1:1-samtale mellem to managere. Deltagerne er brugere (auth.users), ikke hold (#4379). participant_a = least(u1,u2), participant_b = greatest(u1,u2) — haandhaevet af CHECK dm_conversations_ordered_pair + UNIQUE dm_conversations_pair_key, saa (A,B) og (B,A) aldrig kan blive to samtaler.';

-- ── dm_messages ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.dm_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.dm_conversations(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  context         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dm_messages_body_length CHECK (char_length(body) BETWEEN 1 AND 2000)
);

CREATE INDEX IF NOT EXISTS dm_messages_conversation_idx
  ON public.dm_messages (conversation_id, created_at DESC);

-- Rate-limitten (30 pr. 10 min) tælles pr. afsender over et tidsvindue.
CREATE INDEX IF NOT EXISTS dm_messages_sender_recent_idx
  ON public.dm_messages (sender_id, created_at DESC);

COMMENT ON TABLE public.dm_messages IS
  '#3200 DM v1: ÉN tabel med alle beskeder (afsender, modtager via samtalen, tidsstempel). Den ER loggen og slettes aldrig — evidens i fair-play-sager (#3131). Ingen UPDATE-/DELETE-policy for nogen rolle; en bruger kan kun skjule samtalen for sig selv via dm_conversation_hides.';
COMMENT ON COLUMN public.dm_messages.context IS
  '#3200: citeret handel paa den foerste besked fra "Skriv til modparten" — { kind: transfer_offer|auction, refId, riderName, amount, occurredAt }. Kun tal begge parter i forvejen kan se.';

-- ── dm_reads ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.dm_reads (
  conversation_id UUID NOT NULL REFERENCES public.dm_conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS dm_reads_user_idx ON public.dm_reads (user_id);

COMMENT ON TABLE public.dm_reads IS
  '#3200 DM v1: hvornaar brugeren sidst laeste samtalen. Ulaest = beskeder fra den ANDEN part med created_at > last_read_at. Ingen raekke = alt er ulaest.';

-- ── dm_blocks ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.dm_blocks (
  blocker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT dm_blocks_not_self CHECK (blocker_id <> blocked_id)
);

-- "Har nogen blokeret denne afsender?" — slås op ved hver afsendelse.
CREATE INDEX IF NOT EXISTS dm_blocks_blocked_idx ON public.dm_blocks (blocked_id);

COMMENT ON TABLE public.dm_blocks IS
  '#3200 DM v1: retningsbestemt blokering. En blokeret afsenders besked GEMMES stadig (loggen skal vaere komplet), men modtageren ser den ikke og notificeres ikke, og afsenderen faar ingen indikation af blokeringen.';

-- ── dm_reports ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.dm_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.dm_conversations(id) ON DELETE CASCADE,
  reporter_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT dm_reports_reason_length CHECK (reason IS NULL OR char_length(reason) <= 1000)
);

-- Admin-policyen laver et EXISTS pr. samtale — dette index er den opslagssti.
CREATE INDEX IF NOT EXISTS dm_reports_conversation_idx
  ON public.dm_reports (conversation_id);
CREATE INDEX IF NOT EXISTS dm_reports_open_idx
  ON public.dm_reports (created_at DESC) WHERE resolved_at IS NULL;

COMMENT ON TABLE public.dm_reports IS
  '#3200 DM v1: en anmeldelse sender en kopi af traaden til admin. Raekkens eksistens ER admin-noeglen: uden en raekke for samtalen kan admin ikke laese den, haandhaevet i RLS.';

-- ── dm_conversation_hides ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.dm_conversation_hides (
  conversation_id UUID NOT NULL REFERENCES public.dm_conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hidden_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id)
);

COMMENT ON TABLE public.dm_conversation_hides IS
  '#3200 DM v1: skjul pr. bruger. Erstatningen for sletning — beskederne bliver liggende i dm_messages. En ny besked efter hidden_at bringer samtalen tilbage i listen.';

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.dm_conversations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dm_messages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dm_reads               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dm_blocks              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dm_reports             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dm_conversation_hides  ENABLE ROW LEVEL SECURITY;

-- dm_conversations: parterne laeser deres egne. Admin kun hvis anmeldt.
DROP POLICY IF EXISTS dm_conversations_participant_read ON public.dm_conversations;
CREATE POLICY dm_conversations_participant_read ON public.dm_conversations
  FOR SELECT TO authenticated
  USING (
    (SELECT auth.uid()) IN (participant_a, participant_b)
  );

DROP POLICY IF EXISTS dm_conversations_admin_reported_read ON public.dm_conversations;
CREATE POLICY dm_conversations_admin_reported_read ON public.dm_conversations
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    AND EXISTS (
      SELECT 1 FROM public.dm_reports r
      WHERE r.conversation_id = public.dm_conversations.id
    )
  );

-- dm_messages: parterne laeser, MINUS beskeder fra en jeg har blokeret, sendt
-- efter blokeringen. Ingen INSERT/UPDATE/DELETE for authenticated overhovedet:
-- skrivning gaar gennem backendens service_role, som validerer foerst.
DROP POLICY IF EXISTS dm_messages_participant_read ON public.dm_messages;
CREATE POLICY dm_messages_participant_read ON public.dm_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.dm_conversations c
      WHERE c.id = public.dm_messages.conversation_id
        AND (SELECT auth.uid()) IN (c.participant_a, c.participant_b)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.dm_blocks b
      WHERE b.blocker_id = (SELECT auth.uid())
        AND b.blocked_id = public.dm_messages.sender_id
        AND public.dm_messages.created_at >= b.created_at
    )
  );

DROP POLICY IF EXISTS dm_messages_admin_reported_read ON public.dm_messages;
CREATE POLICY dm_messages_admin_reported_read ON public.dm_messages
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    AND EXISTS (
      SELECT 1 FROM public.dm_reports r
      WHERE r.conversation_id = public.dm_messages.conversation_id
    )
  );

-- dm_reads / dm_blocks / dm_conversation_hides: kun egne raekker.
-- CodeRabbit 8/9: "kun egne raekker" var ikke nok. user_id = auth.uid() alene
-- lod enhver indlogget bruger skrive en laest-/skjult-markering paa en HVILKEN
-- SOM HELST samtale-id han kunne gaette. Raekken ville vaere hans egen og
-- harmloes i UI'et, men den er stadig en skrivning til en samtale han ikke er
-- part i. Medlemskabs-tjekket staar nu i baade USING og WITH CHECK.
DROP POLICY IF EXISTS dm_reads_own_rows ON public.dm_reads;
CREATE POLICY dm_reads_own_rows ON public.dm_reads
  FOR ALL TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.dm_conversations c
      WHERE c.id = conversation_id
        AND (SELECT auth.uid()) IN (c.participant_a, c.participant_b)
    )
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.dm_conversations c
      WHERE c.id = conversation_id
        AND (SELECT auth.uid()) IN (c.participant_a, c.participant_b)
    )
  );

DROP POLICY IF EXISTS dm_blocks_own_rows ON public.dm_blocks;
CREATE POLICY dm_blocks_own_rows ON public.dm_blocks
  FOR ALL TO authenticated
  USING (blocker_id = (SELECT auth.uid()))
  WITH CHECK (blocker_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS dm_conversation_hides_own_rows ON public.dm_conversation_hides;
CREATE POLICY dm_conversation_hides_own_rows ON public.dm_conversation_hides
  FOR ALL TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.dm_conversations c
      WHERE c.id = conversation_id
        AND (SELECT auth.uid()) IN (c.participant_a, c.participant_b)
    )
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.dm_conversations c
      WHERE c.id = conversation_id
        AND (SELECT auth.uid()) IN (c.participant_a, c.participant_b)
    )
  );

-- dm_reports: en part kan anmelde sin egen samtale og se sin egen anmeldelse.
-- Admin ser alle anmeldelser (det er indgangen til admin-listen).
DROP POLICY IF EXISTS dm_reports_reporter_read ON public.dm_reports;
CREATE POLICY dm_reports_reporter_read ON public.dm_reports
  FOR SELECT TO authenticated
  USING (reporter_id = (SELECT auth.uid()) OR public.is_admin());

DROP POLICY IF EXISTS dm_reports_participant_insert ON public.dm_reports;
CREATE POLICY dm_reports_participant_insert ON public.dm_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    reporter_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.dm_conversations c
      WHERE c.id = conversation_id
        AND (SELECT auth.uid()) IN (c.participant_a, c.participant_b)
    )
  );

-- ── Grants ──────────────────────────────────────────────────────────────────
-- anon har intet at goere her. authenticated faar praecis det policies tillader:
-- laesning overalt, skrivning kun paa de tre "egne raekker"-tabeller + anmeldelse.
-- INGEN INSERT paa dm_messages eller dm_conversations: den vej gaar gennem
-- backenden, som er det eneste sted blok-tjek og rate-limit findes.

REVOKE ALL ON TABLE public.dm_conversations      FROM anon, authenticated;
REVOKE ALL ON TABLE public.dm_messages           FROM anon, authenticated;
REVOKE ALL ON TABLE public.dm_reads              FROM anon, authenticated;
REVOKE ALL ON TABLE public.dm_blocks             FROM anon, authenticated;
REVOKE ALL ON TABLE public.dm_reports            FROM anon, authenticated;
REVOKE ALL ON TABLE public.dm_conversation_hides FROM anon, authenticated;

GRANT SELECT                        ON TABLE public.dm_conversations      TO authenticated;
GRANT SELECT                        ON TABLE public.dm_messages           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.dm_reads             TO authenticated;
GRANT SELECT, INSERT, DELETE        ON TABLE public.dm_blocks             TO authenticated;
GRANT SELECT, INSERT                ON TABLE public.dm_reports            TO authenticated;
GRANT SELECT, INSERT, DELETE        ON TABLE public.dm_conversation_hides TO authenticated;

-- Notifikationstypen dm_message ligger i sin EGEN fil,
-- database/2026-09-08-3200-dm-notification-type.sql, fordi paritets-testen
-- (backend/lib/notificationTypes.test.js) peger MIGRATION_PATH paa den nyeste
-- type-migration og laeser hele typelisten ud af den ene fil.
