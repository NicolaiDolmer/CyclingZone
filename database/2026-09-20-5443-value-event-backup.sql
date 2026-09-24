-- #5443 · Backup-anker for DEN EKSTRAORDINÆRE VÆRDIKØRSEL (ejer-beslutning 3, 20/9 aften).
--
-- Rytterværdier flytter sig normalt kun søndag fra kl. 06 (ECONOMY_RULES §9.1),
-- med ét dato-claim i rider_value_sunday_log. Ejeren har besluttet at
-- model-skiftet skal ud som ÉN ekstraordinær kørsel uden for søndagen, så snart
-- spillerbeskeden er ude og han selv siger "kør".
--
-- Denne tabel er det der gør kørslen tilbagerullelig. Scriptet
-- backend/scripts/riderValueExtraordinaryRun5443.js fylder den med de fire
-- kolonner kørslen kan skrive — FØR den skriver noget som helst — og kan lægge
-- dem tilbage igen med --rollback.
--
-- HVORFOR EN TABEL OG IKKE EN CSV: en rollback skal kunne køres fra samme
-- maskine, samme session, uden at nogen skal finde en fil frem. Backup-tabeller
-- er i forvejen husets mønster for ejer-gatede prod-indgreb
-- (backup_4485_*, backup_4376_*, backup_5443_valuation_type_20260920).
--
-- DENNE MIGRATION ER INERT: den opretter en TOM tabel. Ingen rytterværdi
-- flytter sig af at merge den, og den ekstraordinære kørsel starter ikke af sig
-- selv — den kræver --apply, en bekræftelses-sætning og en miljø-variabel.
--
-- ⚠️ LIVSCYKLUS — LÆS FØR MERGE: filer i database/2026-*.sql KØRER AUTOMATISK
--    mod prod ved merge til main (.github/workflows/auto-migrate.yml, AGENTS.md
--    hard rule 9). Ejeren merger derfor PR'en manuelt. Post-apply-verifikation:
--    tabellen findes og er tom.
--
-- Oprydning NÅR kørslen er verificeret og rollback-vinduet er lukket:
--   DROP TABLE IF EXISTS public.backup_5443_value_event_20260920;

CREATE TABLE IF NOT EXISTS public.backup_5443_value_event_20260920 (
  rider_id                 UUID PRIMARY KEY,
  -- Præcis de fire kolonner refreshChangedRiderValues kan skrive
  -- (riderValueRefresh.js: selectChangedValueUpdates). Flere ville give falsk
  -- tryghed; færre ville gøre rollbacken ufuldstændig.
  base_value               INTEGER,
  current_production_value INTEGER,
  primary_type             TEXT,
  secondary_type           TEXT,
  captured_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.backup_5443_value_event_20260920 IS
  '#5443: før-billede af (base_value, current_production_value, primary_type, secondary_type) for hele populationen, taget FØR den ekstraordinære værdikørsel. Rollback-kilde for backend/scripts/riderValueExtraordinaryRun5443.js --rollback. Droppes når kørslen er verificeret.';

-- service-role only, som de øvrige backup-/log-tabeller. Ingen spiller-vendt
-- læsning: rækkerne er et øjebliksbillede af hele markedet.
ALTER TABLE public.backup_5443_value_event_20260920 ENABLE ROW LEVEL SECURITY;
