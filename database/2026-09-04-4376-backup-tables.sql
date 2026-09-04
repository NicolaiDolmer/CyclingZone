-- #4376 — BACKUP-TABELLER FOR SÆSON 3-REPARATIONEN (timing-hul + divisions-tillæg).
--
-- Opretter KUN tomme tabeller. Selve reparationen (rettelse af guaranteed_base/
-- signed_division på de 30 timing-hul-kontrakter + divisions-tillæg via
-- incrementBalanceWithAudit) sker fra
-- `backend/scripts/repair-4376-sponsor-division-correction.js --apply`, ikke herfra
-- — samme arbejdsdeling som #4485
-- (`2026-09-04-4485-young-classification-backup-tables.sql`): DDL i en fil der kan
-- reviewes, dataflytning i et script der kan tørkøres og verificeres.
--
-- Typerne er slået op i prod via information_schema (2026-09-04), IKKE gættet —
-- se .claude/learnings/2026-09-04-4485-backup-tabel-typer-fra-snapshot-ikke-gaet.md
-- for hvorfor det er en hård regel efter #4485s backup-tabel-hændelse.
--
-- HVAD DEN DÆKKER (ejer-beslutning 4/9 kl. ~16:15 på #4376,
-- `gh issue view 4376 --comments`):
--   1) sponsor_contracts — FØR-billedet af de op til 30 aktive kontrakter hvis
--      guaranteed_base/signed_division rettes af timing-hul-korrektionen (a).
--      Fuld række (LIKE-spejling), så en rollback ikke skal rekonstruere noget.
--   2) teams — FØR-balancen for hvert hold der får en #4376-divisions-tillæg-
--      korrektion (b). Selve transaktionen er allerede revisions-sikret i
--      finance_transactions (reason_code sponsor_division_correction); denne
--      tabel er et hurtigt rollback-anker uden at rekonstruere balance fra
--      ledger-summen.
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS. Sikker at køre igen.
-- IKKE DESTRUKTIV: opretter kun; rører ingen eksisterende data.

CREATE TABLE IF NOT EXISTS public.backup_4376_sponsor_contracts_20260904 (
  LIKE public.sponsor_contracts INCLUDING DEFAULTS
);

ALTER TABLE public.backup_4376_sponsor_contracts_20260904
  ADD COLUMN IF NOT EXISTS captured_at timestamptz NOT NULL DEFAULT now();

COMMENT ON TABLE public.backup_4376_sponsor_contracts_20260904 IS
  'FOER-billede af de aktive sponsor_contracts-raekker #4376-timing-hul-korrektionen retter (guaranteed_base + signed_division, saeson 3). Fyldes af backend/scripts/repair-4376-sponsor-division-correction.js. Kan slettes naar reparationen er verificeret stabil.';

CREATE TABLE IF NOT EXISTS public.backup_4376_teams_balance_20260904 (
  team_id         uuid        PRIMARY KEY,
  balance_before  bigint,
  captured_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.backup_4376_teams_balance_20260904 IS
  'FOER-balance for hvert hold der faar en #4376-divisions-tillaeg-korrektion i saeson 3. Selve transaktionen er revisions-sikret i finance_transactions (reason_code sponsor_division_correction) — denne tabel er et hurtigt rollback-anker.';

ALTER TABLE public.backup_4376_sponsor_contracts_20260904 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_4376_teams_balance_20260904 ENABLE ROW LEVEL SECURITY;

-- ── POST-VERIFY efter apply ─────────────────────────────────────────────────
--   SELECT count(*) FROM public.backup_4376_sponsor_contracts_20260904;
--   -- skal matche antallet af timing-hul-kontrakter der faktisk blev rettet
--   -- (report.timingHoleCorrections.length fra dry-run-planen).
--
--   SELECT count(*) FROM public.backup_4376_teams_balance_20260904;
--   -- skal matche antallet af hold der fik et divisions-tillæg (report.paidCount).

-- ── ROLLBACK (kun hvis nødvendigt) ──────────────────────────────────────────
--   BEGIN;
--   UPDATE public.sponsor_contracts sc
--      SET guaranteed_base = b.guaranteed_base, signed_division = b.signed_division
--     FROM public.backup_4376_sponsor_contracts_20260904 b
--    WHERE b.id = sc.id;
--   -- Balance: brug incrementBalanceWithAudit(teamId, balance_before - nuvaerende_balance, ...)
--   -- pr. hold, ALDRIG en direkte UPDATE teams.balance (mister finance_transactions-sporet).
--   COMMIT;

-- ── OPRYDNING (efter ejer-go, når reparationen er verificeret stabil) ───────
--   DROP TABLE public.backup_4376_sponsor_contracts_20260904;
--   DROP TABLE public.backup_4376_teams_balance_20260904;

-- Refs #4376
