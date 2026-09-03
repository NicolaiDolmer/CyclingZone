-- #4576 — BACKUP-TABEL FOR ENGANGSOPRYDNING AF FORLADTE 'offered'-INTAKE-RAEKKER.
--
-- Denne fil opretter KUN en tom tabel. Selve kopieringen + status-flippet sker fra
-- `backend/scripts/repairOrphanedAcademyOffers4576.js`, ikke herfra — samme
-- arbejdsdeling som #3645 (`2026-08-23-3645-cutover-backup-table.sql`): DDL i en
-- fil der kan reviewes, dataflytning i et script der kan toerkoeres og verificeres.
--
-- HVAD DEN DAEKKER. `academy_intake`-raekker med status='offered' hvor rytteren
-- allerede er ejet (riders.team_id IS NOT NULL) — se #4576 for maalingen (105
-- raekker fra S3-akademi-optaget 29/8, stabil poel, vokser ikke). Reparations-
-- logikken (findStaleOfferedIntake i backend/lib/academyIntakeReconcile.js, #1756)
-- flipper hver raekke til 'signed' (ejet af det tilbudte hold) eller 'rejected'
-- (ejet af et andet hold). Foer-billedet af HELE raekken gemmes her foer flippet.
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS. Sikker at koere igen.
-- IKKE DESTRUKTIV: opretter kun; roerer ingen eksisterende data.
--
-- Datosuffikset er kørselsdatoen for denne engangsoprydning (ikke en
-- begivenhedsdato — modsat #3645's cutover-dato — fordi #4576 ikke er bundet
-- til én hændelse, men til en stabil pulje der findes ved oprydningstidspunktet).

CREATE TABLE IF NOT EXISTS public.backup_4576_academy_intake_20260903 (
  row_id      uuid        NOT NULL,
  row_before  jsonb       NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (row_id)
);

COMMENT ON TABLE public.backup_4576_academy_intake_20260903 IS
  'FOER-billede af de academy_intake-raekker #4576-reparationen flipper (stale offered, rytter allerede ejet). Fyldes af backend/scripts/repairOrphanedAcademyOffers4576.js. Kan slettes naar reparationen er verificeret stabil.';

-- Servicerollen skriver via scriptet; ingen anden rolle skal kunne se den.
ALTER TABLE public.backup_4576_academy_intake_20260903 ENABLE ROW LEVEL SECURITY;

-- ── POST-VERIFY efter backup-kørslen ────────────────────────────────────────
--   SELECT count(*) FROM public.backup_4576_academy_intake_20260903;
--   -- skal matche antallet af planlagte flip (rapporteret af scriptet).

-- ── ROLLBACK ─────────────────────────────────────────────────────────────────
-- Skriver status/resolved_at tilbage til foer-billedet. Idempotent: anden koersel
-- roerer 0 raekker (WHERE-praedikatet kraever IS DISTINCT FROM).
--
--   BEGIN;
--   UPDATE public.academy_intake i
--      SET status = (b.row_before ->> 'status'),
--          resolved_at = (b.row_before ->> 'resolved_at')::timestamptz
--     FROM public.backup_4576_academy_intake_20260903 b
--    WHERE b.row_id = i.id
--      AND i.status IS DISTINCT FROM (b.row_before ->> 'status');
--   COMMIT;
--
--   -- post-verify (skal give 0):
--   SELECT count(*) FROM public.academy_intake i
--     JOIN public.backup_4576_academy_intake_20260903 b ON b.row_id = i.id
--    WHERE i.status IS DISTINCT FROM (b.row_before ->> 'status');

-- ── OPRYDNING (efter ejer-go, når reparationen er verificeret stabil) ────────
--   DROP TABLE public.backup_4576_academy_intake_20260903;
