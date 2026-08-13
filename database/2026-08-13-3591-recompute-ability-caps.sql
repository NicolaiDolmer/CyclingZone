-- #3591 pkt. 2 — GENBEREGNING AF DE GEMTE UDVIKLINGSLOFTER (kørt 2026-08-13).
--
-- Denne fil er DOKUMENTATION + ROLLBACK. Selve skrivningen sker fra
-- `backend/scripts/dev/lofterApply3591.mjs`, ikke herfra: det nye loft er en
-- JS-beregning (buildCapsForRider) over 15 evner pr. rytter, ikke et SQL-udtryk.
-- Værktøjet bygger planen forfra mod en frisk læsning hver gang det kører, fordi
-- populationen driver — mellem 11/8 og 13/8 kom 48 nye ryttere til med samme mangel,
-- og 9 af de oprindeligt berørte var allerede rettet af den daglige træningsmotor.
--
-- FORUDSÆTNING: `2026-08-11-3593-anchor-secondary-archetype-draw.sql` skal være kørt.
-- Uden den former lofterne sig af et halvt anlæg. Værktøjet har en port der stopper
-- kørslen hvis just den betingelse ikke holder.
--
-- HVAD DER BLEV SKREVET 2026-08-13 (ejer-go samme dag):
--   ryttere med nyt loft ......... 516  (453 op, 63 ned)
--   heraf på spilleres hold ...... 5    (4 op, 1 ned — Sven Maes, −2 rating)
--   heraf frie agenter ........... 511
--   type-skift ................... 0
--   markedsværdi flyttet ......... 0
--   gulv-brud .................... 0    (intet loft under rytterens nuværende evne)
--   post-verify .................. 516/516 rækker i DB matcher planen
--
-- KOLONNEN DER BLEV RØRT: `rider_derived_abilities.ability_caps`. Intet andet.
-- Ikke evner, ikke typer, ikke base_value/market_value, ikke løn.

-- ── Backup-tabellen værktøjet fylder FØR det skriver ────────────────────────
CREATE TABLE IF NOT EXISTS public.rider_caps_3591_backup_20260813 (
  rider_id            uuid PRIMARY KEY REFERENCES public.riders(id) ON DELETE CASCADE,
  ability_caps_before jsonb,
  captured_at         timestamptz NOT NULL DEFAULT now()
);

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- Gendanner de gemte lofter præcis som de stod før kørslen. Idempotent: anden
-- kørsel skriver 0 rækker.
--
-- RÆKKEFØLGE hvis BEGGE dele skal rulles tilbage: kør DENNE først, derefter
-- `2026-08-11-3593-anchor-secondary-archetype-draw-ROLLBACK.sql`. Omvendt
-- rækkefølge efterlader lofter formet af ét anlæg og et anlæg der peger på et andet.
--
--   BEGIN;
--   UPDATE public.rider_derived_abilities d
--   SET ability_caps = b.ability_caps_before
--   FROM public.rider_caps_3591_backup_20260813 b
--   WHERE d.rider_id = b.rider_id
--     AND d.ability_caps IS DISTINCT FROM b.ability_caps_before;
--   COMMIT;
--
--   -- post-verify (skal give 0):
--   SELECT count(*) FROM public.rider_derived_abilities d
--     JOIN public.rider_caps_3591_backup_20260813 b ON b.rider_id = d.rider_id
--    WHERE d.ability_caps IS DISTINCT FROM b.ability_caps_before;

-- ── POST-VERIFY efter selve kørslen (kørt 13/8, alle grønne) ────────────────
-- Værktøjet gør det selv og fejler højlydt, men tallene kan efterprøves sådan:
--
--   -- backuppen dækker de skrevne rækker (forventet 516):
--   SELECT count(*) FROM public.rider_caps_3591_backup_20260813;
--
--   -- identiteten er stadig fuldt forankret (forventet 0):
--   SELECT count(*) FROM public.riders
--    WHERE is_retired = false AND archetype_draw ->> 'secondary' IS NULL;
