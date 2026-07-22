-- 2026-07-21 · #2769 (Sub-1) · Additive rute-datamodel på race_stage_profiles.
-- Alt eksisterende urørt; motoren læser IKKE disse kolonner i Sub-1 (rent persisteret + vist).
-- Idempotent: kan køres flere gange. Applies post-merge (Claude, #2642-rammer).

ALTER TABLE race_stage_profiles
  ADD COLUMN IF NOT EXISTS distance_km        integer,
  ADD COLUMN IF NOT EXISTS elevation_gain_m   integer,
  ADD COLUMN IF NOT EXISTS climbs             jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sprints            jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sectors            jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN race_stage_profiles.distance_km      IS 'Etapens længde i km (Sub-1 #2769). NULL = ikke-genereret (legacy).';
COMMENT ON COLUMN race_stage_profiles.elevation_gain_m IS 'Samlet højdemeter (Sub-1 #2769).';
COMMENT ON COLUMN race_stage_profiles.climbs           IS 'Kategoriserede stigninger [{name,category,crest_km,length_km,avg_gradient,summit_finish}] sorteret på crest_km (Sub-1 #2769).';
COMMENT ON COLUMN race_stage_profiles.sprints          IS 'Sprints [{name,km,kind:"intermediate"|"finish"}] sorteret på km (Sub-1 #2769).';
COMMENT ON COLUMN race_stage_profiles.sectors          IS 'Brosten/grus-sektorer [{kind:"cobbles"|"gravel",start_km,length_km,name?}] sorteret på start_km (Sub-1 #2769).';
