-- Ryttertyper (#49 / #92) — persisterede klassifikations-kolonner.
--
-- primary_type / secondary_type er en rytters top-2 ryttertype (sprinter,
-- climber, gc, …) udledt af de 14 legacy stats via z-score-normaliserede
-- #49-formler. Eneste sandhedskilde for formlerne er backend/lib/riderTypes.js;
-- kolonnerne fyldes af backend/scripts/backfillRiderTypes.js (idempotent,
-- deterministisk) ud fra den fittede baseline (riderTypesBaseline.json).
--
-- Hvorfor persisteret (og ikke beregnet i frontend): RidersPage er server-
-- pagineret over ~9.000 ryttere, så et korrekt ryttertype-FILTER (med rigtig
-- total + paginering) kræver server-side kolonner at filtrere på. Frontend læser
-- bare kolonnerne — den genberegner ikke (ingen formel-dublet front/back).
--
-- NULL = "endnu ikke beregnet" (før første backfill). Værdierne er en lukket
-- nøgle-mængde (RIDER_TYPE_KEYS) — vi bruger ikke en DB-enum, så formel-/type-
-- ændringer ikke kræver en enum-migration; gyldigheden håndhæves af lib + test.

ALTER TABLE riders ADD COLUMN IF NOT EXISTS primary_type TEXT;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS secondary_type TEXT;

COMMENT ON COLUMN riders.primary_type IS
  'Primær ryttertype (#49). Udledt af legacy stats via riderTypes.js, fyldt af '
  'backfillRiderTypes.js. Lukket nøgle-mængde (RIDER_TYPE_KEYS). NULL = ikke beregnet.';
COMMENT ON COLUMN riders.secondary_type IS
  'Sekundær ryttertype (#49) — næsthøjeste score (top-2 altid). Se primary_type.';

-- Indeks til server-side filtrering (filter matcher primary ELLER secondary).
CREATE INDEX IF NOT EXISTS idx_riders_primary_type ON riders (primary_type);
CREATE INDEX IF NOT EXISTS idx_riders_secondary_type ON riders (secondary_type);
