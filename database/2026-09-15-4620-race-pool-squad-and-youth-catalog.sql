-- Youth catalogue preparation. Refs #4620 #4621 #4845.
-- Design-go: owner decisions 2026-09-15, U23 design spec sections 10.3/10.5.
-- MERGE DEPENDENCY: ship squad-filtered catalogue readers before this seed
-- can be consumed by senior calendar generation. Packer changes are separate.
-- Auto-applied only after merge; no manual production apply in this task.

BEGIN;

ALTER TABLE public.race_pool
  ADD COLUMN IF NOT EXISTS squad TEXT NOT NULL DEFAULT 'senior';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.race_pool'::regclass
      AND conname = 'race_pool_squad_check'
  ) THEN
    ALTER TABLE public.race_pool ADD CONSTRAINT race_pool_squad_check
      CHECK (squad IN ('senior', 'u23', 'junior'));
  END IF;
END;
$$;

-- Existing senior rows retain their identities and acquire the senior default.
-- Seed IDs and all catalogue fields match racePoolCatalog.youth.json exactly.
INSERT INTO public.race_pool (id, external_id, name, race_class, race_type, stages, date_text, country, terrain_archetype, retired_at, squad)
VALUES
  ('46200915-2026-4000-8000-000000000001', 'u23-espoirs-france', 'Tour des Espoirs de France', 'ProSeries', 'stage_race', 8, '23/8 - 30/8', 'France', 'summit_tour', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000002', 'u23-nuove-leve', 'Giro delle Nuove Leve', 'ProSeries', 'stage_race', 8, '14/6 - 21/6', 'Italy', 'mountain_tour', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000003', 'u23-bretagne', 'Tour de Bretagne Nouveau', 'ProSeries', 'stage_race', 7, '25/4 - 1/5', 'France', 'hilly_tour', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000004', 'u23-valle-aosta', 'Giro delle Valli d''Aosta', 'Class1', 'stage_race', 5, '15/7 - 19/7', 'Italy', 'summit_tour', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000005', 'u23-alsace', 'Tour des Coteaux d''Alsace', 'Class1', 'stage_race', 5, '29/7 - 2/8', 'France', 'balanced_week', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000006', 'u23-savoie', 'Tour des Vallées de Savoie', 'Class2', 'stage_race', 4, '18/6 - 21/6', 'France', 'summit_tour', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000007', 'u23-isard', 'Ronde des Cols Ariégeois', 'Class2', 'stage_race', 4, '21/5 - 24/5', 'France', 'mountain_tour', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000008', 'u23-jeseniky', 'Závod Jesenických Nadějí', 'Class1', 'stage_race', 4, '28/5 - 31/5', 'Czech Republic', 'hilly_tour', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000009', 'u23-carpathian', 'Tour des Jeunes Carpates', 'Class2', 'stage_race', 4, '13/8 - 16/8', 'Poland', 'hilly_tour', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000010', 'u23-palio-recioto', 'Trofeo delle Colline Veronesi', 'Class1', 'single', 1, '7/4', 'Italy', 'puncheur', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000011', 'u23-poggiana', 'Gran Premio dei Colli Trevigiani', 'Class2', 'single', 1, '9/8', 'Italy', 'puncheur', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000012', 'u23-nord', 'Enfer du Nord Espoirs', 'Class1', 'single', 1, '31/5', 'France', 'cobbled_classic', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000013', 'u23-vlaanderen', 'Vlaamse Kasseien Beloften', 'Class1', 'single', 1, '11/4', 'Belgium', 'cobbled_classic', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000014', 'u23-liege', 'Classique des Ardennes Espoirs', 'Class1', 'single', 1, '18/4', 'Belgium', 'hilly_classic', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000015', 'u23-thuringen', 'Thüringer Land-Rundfahrt der Talente', 'Class2', 'stage_race', 5, '8/6 - 12/6', 'Germany', 'hilly_tour', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000016', 'u23-ras', 'Rás na nÓg', 'Class2', 'stage_race', 5, '20/5 - 24/5', 'Ireland', 'balanced_week', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000017', 'u23-olympia', 'Ronde van de Lage Landen Beloften', 'Class2', 'stage_race', 5, '18/3 - 22/3', 'Netherlands', 'cobbled_tour', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000018', 'u23-normandie', 'Tour du Bocage Normand Espoirs', 'Class2', 'stage_race', 5, '23/3 - 27/3', 'France', 'balanced_week', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000019', 'u23-baltic', 'Bałtycki Wyścig Nadziei', 'Class2', 'stage_race', 3, '28/5 - 30/5', 'Poland', 'sprinters_week', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000020', 'u23-nations-chrono', 'Chrono de Vendée Espoirs', 'Class1', 'single', 1, '20/9', 'France', 'itt_classic', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000021', 'u23-champenois', 'Chrono des Vignobles Espoirs', 'Class2', 'single', 1, '13/9', 'France', 'itt_classic', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000022', 'u23-san-vendemiano', 'Trofeo di San Vendemiano Giovani', 'Class2', 'single', 1, '19/4', 'Italy', 'puncheur', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000023', 'u23-liberazione', 'Circuito di Roma Giovani', 'Class2', 'single', 1, '25/4', 'Italy', 'flat_sprint', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000024', 'u23-belvedere', 'Giro dei Colli di Fregona', 'Class2', 'single', 1, '6/4', 'Italy', 'hilly_classic', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000025', 'u23-san-pietro', 'Trofeo delle Valli del Chiampo', 'Class2', 'single', 1, '5/7', 'Italy', 'hilly_classic', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000026', 'u23-capodarco', 'Gran Premio delle Colline Fermane', 'Class2', 'single', 1, '16/8', 'Italy', 'puncheur', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000027', 'u23-ruota-oro', 'Circuito del Valdarno Giovani', 'Class2', 'single', 1, '29/9', 'Italy', 'hilly_classic', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000028', 'u23-gent', 'Klassieker van de Westhoek Beloften', 'Class1', 'single', 1, '29/3', 'Belgium', 'flat_sprint', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000029', 'u23-kustkoers', 'Kustkoers voor Beloften', 'Class2', 'single', 1, '20/3', 'Belgium', 'flat_sprint', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000030', 'u23-frankfurt', 'Main-Rundfahrt der Talente', 'Class1', 'single', 1, '1/5', 'Germany', 'flat_sprint', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000031', 'u23-midden-brabant', 'Brabantse Polderomloop Beloften', 'Class2', 'single', 1, '26/4', 'Netherlands', 'flat_sprint', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000032', 'u23-alkmaar', 'Noord-Hollandse Omloop Beloften', 'Class2', 'single', 1, '15/3', 'Netherlands', 'flat_sprint', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000033', 'u23-famenne', 'Circuit des Vallons de Famenne Espoirs', 'Class2', 'single', 1, '12/7', 'Belgium', 'hilly_classic', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000034', 'u23-sund', 'Sundets Talentløb', 'Class2', 'single', 1, '23/8', 'Denmark', 'flat_sprint', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000035', 'u23-lisboa', 'Volta dos Jovens do Tejo', 'Class2', 'stage_race', 4, '3/9 - 6/9', 'Portugal', 'balanced_week', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000036', 'u23-baden', 'Chrono der Badischen Talente', 'Class2', 'single', 1, '6/9', 'Germany', 'itt_classic', NULL, 'u23'),
  ('46200915-2026-4000-8000-000000000037', 'jun-roubaix', 'Pavés du Nord Juniors', 'Class1', 'single', 1, '12/4', 'France', 'cobbled_classic', NULL, 'junior'),
  ('46200915-2026-4000-8000-000000000038', 'jun-vaud', 'Tour des Rives et Cols Vaudois', 'Class1', 'stage_race', 4, '28/5 - 31/5', 'Switzerland', 'balanced_week', NULL, 'junior'),
  ('46200915-2026-4000-8000-000000000039', 'jun-paix', 'Závod Mladých Krušnohor', 'Class1', 'stage_race', 4, '7/5 - 10/5', 'Czech Republic', 'hilly_tour', NULL, 'junior'),
  ('46200915-2026-4000-8000-000000000040', 'jun-gent', 'Westhoekse Jeugdklassieker', 'Class1', 'single', 1, '29/3', 'Belgium', 'flat_sprint', NULL, 'junior'),
  ('46200915-2026-4000-8000-000000000041', 'jun-saar', 'Saarland-Rundfahrt der Jugend', 'Class1', 'stage_race', 3, '12/6 - 14/6', 'Germany', 'hilly_tour', NULL, 'junior'),
  ('46200915-2026-4000-8000-000000000042', 'jun-lunigiana', 'Giro delle Valli Lunigianesi', 'Class1', 'stage_race', 4, '3/9 - 6/9', 'Italy', 'mountain_tour', NULL, 'junior'),
  ('46200915-2026-4000-8000-000000000043', 'jun-aubel', 'Tour des Trois Vallées Juniors', 'Class1', 'stage_race', 3, '7/8 - 9/8', 'Belgium', 'hilly_tour', NULL, 'junior'),
  ('46200915-2026-4000-8000-000000000044', 'jun-paluzang', 'Giro dei Colli Friulani Juniors', 'Class2', 'stage_race', 4, '30/4 - 3/5', 'Italy', 'mountain_tour', NULL, 'junior'),
  ('46200915-2026-4000-8000-000000000045', 'jun-valromey', 'Tour des Cols du Bugey Juniors', 'Class2', 'stage_race', 4, '10/7 - 13/7', 'France', 'summit_tour', NULL, 'junior'),
  ('46200915-2026-4000-8000-000000000046', 'jun-basque', 'Euskal Haranak Gazteak', 'Class2', 'stage_race', 4, '21/5 - 24/5', 'Spain', 'mountain_tour', NULL, 'junior'),
  ('46200915-2026-4000-8000-000000000047', 'jun-morbihan', 'Trophée du Golfe Juniors', 'Class1', 'stage_race', 2, '23/5 - 24/5', 'France', 'sprinters_week', NULL, 'junior'),
  ('46200915-2026-4000-8000-000000000048', 'jun-axel', 'Driedaagse van Zeeuws-Vlaanderen Jeugd', 'Class2', 'stage_race', 3, '22/5 - 24/5', 'Netherlands', 'cobbled_tour', NULL, 'junior'),
  ('46200915-2026-4000-8000-000000000049', 'jun-vendee', 'Circuit des Bocages Vendéens Juniors', 'Class2', 'single', 1, '22/3', 'France', 'flat_sprint', NULL, 'junior'),
  ('46200915-2026-4000-8000-000000000050', 'jun-nantes', 'Classique Nantaise des Jeunes', 'Class2', 'single', 1, '15/3', 'France', 'flat_sprint', NULL, 'junior'),
  ('46200915-2026-4000-8000-000000000051', 'jun-koksijde', 'Duinenklassieker voor Junioren', 'Class2', 'single', 1, '20/3', 'Belgium', 'flat_sprint', NULL, 'junior'),
  ('46200915-2026-4000-8000-000000000052', 'jun-kobenhavn', 'Øresunds Juniorløb', 'Class2', 'single', 1, '16/8', 'Denmark', 'flat_sprint', NULL, 'junior'),
  ('46200915-2026-4000-8000-000000000053', 'jun-herbiers', 'Chrono du Bocage Juniors', 'Class1', 'single', 1, '20/9', 'France', 'itt_classic', NULL, 'junior'),
  ('46200915-2026-4000-8000-000000000054', 'jun-champagne', 'Chrono des Vignes Juniors', 'Class2', 'single', 1, '13/9', 'France', 'itt_classic', NULL, 'junior')
ON CONFLICT (external_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
COMMIT;
