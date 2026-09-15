-- #4619 · Trup-datamodel slice 1: riders.squad + academy_graduation.from_squad/to_squad
--
-- Spec: docs/superpowers/specs/2026-09-15-u23-kalender-og-trup-datamodel-design.md §3.2
-- Regler: docs/YOUTH_RULES.md §2.1 (junior ≤ 18 · u23 19-22 · senior ≥ 23), §2.2, §2.4
--
-- HVAD DEN GØR (alt additivt — ingen kolonne fjernes, ingen data mutteres her)
--   1) riders.squad TEXT NOT NULL DEFAULT 'senior' + CHECK (NOT VALID)
--   2) partielt indeks på (team_id, squad) for ungdomsrækkerne
--   3) academy_graduation.from_squad / .to_squad TEXT (de TO overgange)
--   4) tom snapshot-tabel som backfill-scriptet fylder FØR det skriver
--   5) NOTIFY pgrst
--
-- HVAD DEN BEVIDST IKKE GØR
--   • INGEN BACKFILL. Sæsonalder beregnes ALDRIG i SQL — backend/lib/riderSeasonAge.js
--     er SSOT (#3071/#3081: fire kopier af formlen, to prod-bugs). Backfill'en er
--     backend/scripts/backfill-4619-riders-squad.js (--dry-run default,
--     --apply --owner-go) og køres KUN efter ejer-go på dry-run-tallene.
--     Konsekvens: efter denne migration står ALLE ryttere som 'senior' (kolonnens
--     DEFAULT), mens is_academy stadig bærer sandheden. Det er med vilje — indtil
--     backfill'en er kørt er `is_academy` fortsat den kolonne der læses.
--   • RØRER IKKE training_day_runs. Squad-nøglen dér ejes af PR #5264 (spor B4).
--   • FJERNER IKKE is_academy. Kolonnen bliver stående og vedligeholdes som
--     `squad <> 'senior'`: 35+ kaldsteder i 12 filer læser den, og RLS-policyen
--     "Public read riders" hænger på is_offered_intake_rider(), som selv læser
--     r.is_academy = false (database/2026-06-22-hide-intake-riders-from-db.sql:60-62).
--     En fjernelse her ville låse offentlig rytter-læsning. Slice 2+ rydder op.
--   • ÆNDRER IKKE den flade 8-plads-cap i RPC'erne (demote_rider_to_academy,
--     finalize_academy_acquisition). Den er stadig hård i SQL og er dermed indtil
--     videre STRAMMERE end U23-loftet på 12 — se PR-body "Ejer godkender".
--
-- HVORFOR CHECK ... NOT VALID
-- NOT VALID gælder alle FREMTIDIGE rækker uden at tage en fuld tabelscan under
-- ACCESS EXCLUSIVE på riders. Alle eksisterende rækker får DEFAULT 'senior' og
-- opfylder trivielt constrainten, så der er intet at validere; en senere
-- `VALIDATE CONSTRAINT` kan køres i et roligt vindue hvis vi vil have den markeret
-- valid. Samme afvejning som spec §3.2 foreskriver.
--
-- RLS: ingen ny policy. riders.squad er lige så offentligt læsbar som is_academy
-- (spec §3.3). Fog of war på modstanderens ungdomstrup er #5107, ikke denne slice.
--
-- IDEMPOTENT: IF NOT EXISTS på kolonner/indeks/tabel, constraint guardet i en
-- DO-blok mod pg_constraint. Anden kørsel = no-op.
--
-- APPLIES af auto-migrate.yml ved merge (#2642). Ikke destruktiv: kun tilføjelser.

BEGIN;

-- ── 1) riders.squad ─────────────────────────────────────────────────────────
ALTER TABLE public.riders
  ADD COLUMN IF NOT EXISTS squad TEXT NOT NULL DEFAULT 'senior';

COMMENT ON COLUMN public.riders.squad IS
  'Trup: senior | u23 | junior (#4619). Sæsonalder junior <= 18, u23 19-22, senior >= 23 '
  '(docs/YOUTH_RULES.md §2.1). is_academy er afledt som (squad <> ''senior'') i '
  'overgangsperioden - skriv ALTID begge felter konsistent. Sæsonalderen beregnes '
  'aldrig i SQL: backend/lib/riderSeasonAge.js er SSOT.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.riders'::regclass
      AND conname = 'riders_squad_check'
  ) THEN
    ALTER TABLE public.riders
      ADD CONSTRAINT riders_squad_check
      CHECK (squad IN ('senior', 'u23', 'junior')) NOT VALID;
  END IF;
END $$;

-- Partielt: kun ungdomsrækkerne indekseres. Langt de fleste ryttere er 'senior',
-- og hvert eneste opslag der skal bruge indekset ("holdets U23-trup", "holdets
-- junior-trup", cap-tællingen i academyTransfer) filtrerer netop squad <> 'senior'.
CREATE INDEX IF NOT EXISTS idx_riders_team_squad
  ON public.riders (team_id, squad)
  WHERE squad <> 'senior';

-- ── 2) academy_graduation: de TO overgange ──────────────────────────────────
-- Indtil nu bar tabellen kun ÉN implicit overgang (akademi → senior ved 22).
-- Med tre trupper er der to (junior → u23 ved 19, u23 → senior ved 23), og
-- Graduation Day skal kunne vise hvilken. Nullable med vilje: eksisterende
-- rækker har ingen trup-information, og backfill-scriptet sætter dem til
-- u23 → senior (spec §3.2) - migrationen gætter det ikke selv.
ALTER TABLE public.academy_graduation
  ADD COLUMN IF NOT EXISTS from_squad TEXT;

ALTER TABLE public.academy_graduation
  ADD COLUMN IF NOT EXISTS to_squad TEXT;

COMMENT ON COLUMN public.academy_graduation.from_squad IS
  'Truppen rytteren forlader (#4619). junior|u23. NULL paa raekker fra foer slice 1.';
COMMENT ON COLUMN public.academy_graduation.to_squad IS
  'Truppen rytteren skal til (#4619). u23|senior. NULL paa raekker fra foer slice 1.';

-- ── 3) Snapshot-tabel til backfill'en ───────────────────────────────────────
-- Mønster: riders_4587_is_u25_backup_20260902. Tabellen oprettes TOM her, fordi
-- DDL ikke kan køres fra backfill-scriptet (supabase-js har ingen DDL-sti), og
-- fyldes af scriptet FØR den første skrivning. Rollback = læs den tilbage.
-- squad_before er nullable: for ryttere backfillet før nogen squad var sat er
-- "før"-værdien kolonnens DEFAULT, men vi gemmer den vi faktisk læste.
CREATE TABLE IF NOT EXISTS public.riders_4619_squad_backup_20260915 (
  rider_id           uuid PRIMARY KEY REFERENCES public.riders(id) ON DELETE CASCADE,
  squad_before       TEXT,
  is_academy_before  boolean,
  captured_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.riders_4619_squad_backup_20260915 IS
  'Rollback-snapshot for #4619-backfill''en. Fyldes af '
  'backend/scripts/backfill-4619-riders-squad.js FOER den skriver riders.squad.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── POST-VERIFY (køres af Claude efter auto-migrate, #2642) ─────────────────
--
--   -- kolonnen findes, default + not null som ventet
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'riders' AND column_name = 'squad';
--
--   -- constraint findes (convalidated = false er FORVENTET, se NOT VALID ovenfor)
--   SELECT conname, convalidated FROM pg_constraint
--    WHERE conrelid = 'public.riders'::regclass AND conname = 'riders_squad_check';
--
--   -- indekset findes
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname = 'public' AND indexname = 'idx_riders_team_squad';
--
--   -- alle ryttere staar som 'senior' indtil backfill'en er koert (forventet)
--   SELECT squad, count(*) FROM public.riders GROUP BY 1 ORDER BY 1;
--
--   -- de to nye graduerings-kolonner
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'academy_graduation'
--      AND column_name IN ('from_squad', 'to_squad') ORDER BY 1;
