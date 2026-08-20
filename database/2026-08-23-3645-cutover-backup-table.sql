-- #3645 — BACKUP-TABEL FOR CUTOVEREN 23/8 (løn-komponenten #3393 + mandat-komponenten #3514).
--
-- Denne fil opretter KUN en tom tabel. Selve kopieringen sker fra
-- `backend/scripts/dev/cutoverBackup3645.mjs`, ikke herfra — samme arbejdsdeling
-- som ved #3591 (`2026-08-13-3591-recompute-ability-caps.sql`): DDL i en fil der
-- kan reviewes, dataflytning i et script der kan tør-køres og verificeres.
--
-- HVORFOR ÉN TABEL OG IKKE TRE. Løn-genberegningen rører `riders`, mandat-
-- migrationen rører `board_profiles` og `team_board_members`. Tre backup-tabeller
-- ville betyde tre DDL-runder, tre navne at holde styr på under et cutover-vindue
-- på under et døgn, og tre steder hvor en manglende tabel først opdages midt i
-- kørslen. Én generisk tabel med hele rækken som jsonb tåler samtidig at kolonner
-- kommer til mellem i dag og 23/8 — hvilket de gør, for mandat-migrationen
-- tilføjer selv kolonner.
--
-- Datosuffikset er CUTOVER-datoen (20260823), ikke kørselsdatoen. To kørsler samme
-- cutover fylder derfor den samme tabel, og upsert på primærnøglen gør en gentagen
-- kørsel til en no-op i stedet for en dublet.
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS. Sikker at køre igen.
-- IKKE DESTRUKTIV: opretter kun; rører ingen eksisterende data.

CREATE TABLE IF NOT EXISTS public.cutover_3645_backup_20260823 (
  table_name  text        NOT NULL,
  row_id      uuid        NOT NULL,
  row_before  jsonb       NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (table_name, row_id)
);

COMMENT ON TABLE public.cutover_3645_backup_20260823 IS
  'FØR-billede af de rækker cutoveren 2026-08-23 rører (#3645). Fyldes af backend/scripts/dev/cutoverBackup3645.mjs. Kan slettes når cutoveren er verificeret stabil.';

-- Servicerollen skriver via scriptet; ingen anden rolle skal kunne se den.
-- (Tabellen indeholder et fuldt før-billede af spilleres hold- og lønforhold.)
ALTER TABLE public.cutover_3645_backup_20260823 ENABLE ROW LEVEL SECURITY;

-- ── POST-VERIFY efter backup-kørslen ────────────────────────────────────────
--   SELECT table_name, count(*) FROM public.cutover_3645_backup_20260823 GROUP BY 1 ORDER BY 1;
--
-- Forventede tal skrives af scriptet i dets rapport. Er de ikke ens, er backuppen
-- ufuldstændig, og cutoveren må ikke fortsætte.

-- ── ROLLBACK: LØN (#3393) ───────────────────────────────────────────────────
-- Skriver de frosne lønninger tilbage. Idempotent: anden kørsel rører 0 rækker.
--
--   BEGIN;
--   UPDATE public.riders r
--      SET salary = (b.row_before ->> 'salary')::bigint
--     FROM public.cutover_3645_backup_20260823 b
--    WHERE b.table_name = 'riders'
--      AND b.row_id = r.id
--      AND r.salary IS DISTINCT FROM (b.row_before ->> 'salary')::bigint;
--   COMMIT;
--
--   -- post-verify (skal give 0):
--   SELECT count(*) FROM public.riders r
--     JOIN public.cutover_3645_backup_20260823 b ON b.row_id = r.id AND b.table_name = 'riders'
--    WHERE r.salary IS DISTINCT FROM (b.row_before ->> 'salary')::bigint;

-- ── ROLLBACK: MANDAT (#3514) ────────────────────────────────────────────────
-- STALE PR. 20/8 — brug IKKE dette afsnit. Mandat-migrationen blev bygget som
-- mandateMigration3514.mjs og skriver til board_relations/board_mandates/
-- board_vision_milestones, IKKE board_profiles.satisfaction. Den autoritative
-- rollback (kill-switch + truncate) står i docs/2026-08-23-cutover-drejebog.md,
-- Komponent 4. Backup-tabellen for mandat er backup_board_profiles_3514_<dato>
-- (oprettes MANUELT, se drejebogens trin 5a). Historisk udkast bevaret nedenfor:
--
--   BEGIN;
--   UPDATE public.board_profiles p
--      SET satisfaction = (b.row_before ->> 'satisfaction')::int
--     FROM public.cutover_3645_backup_20260823 b
--    WHERE b.table_name = 'board_profiles'
--      AND b.row_id = p.id
--      AND p.satisfaction IS DISTINCT FROM (b.row_before ->> 'satisfaction')::int;
--   COMMIT;
--
-- Slettede rækker gendannes med INSERT fra jsonb:
--   INSERT INTO public.board_profiles
--   SELECT * FROM jsonb_populate_recordset(NULL::public.board_profiles,
--            (SELECT jsonb_agg(row_before) FROM public.cutover_3645_backup_20260823
--              WHERE table_name = 'board_profiles'))
--   ON CONFLICT (id) DO NOTHING;
--
-- Rækkefølge ved fuld tilbagerulning af cutoveren: løn FØR mandat er ligegyldigt
-- (de rører forskellige tabeller), men BEGGE skal ligge EFTER caps-gendannelsen
-- (`restoreCaps3459.mjs`), fordi løn regnes af værdier der regnes af lofter.

-- ── OPRYDNING (efter ejer-go, når cutoveren er verificeret stabil) ───────────
--   DROP TABLE public.cutover_3645_backup_20260823;
