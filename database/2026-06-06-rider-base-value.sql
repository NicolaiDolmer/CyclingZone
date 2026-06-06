-- Eget data-drevet værdisystem (#1101) — SHADOW-fase.
--
-- Tilføjer den skrivbare kolonne riders.base_value. I denne fase WIRES den
-- IKKE ind i nogen GENERATED-kolonne (price/market_value/salary kører uændret
-- videre på uci_points), så kolonnen påvirker INTET i den live økonomi. Den
-- fyldes af scripts/backfillRiderBaseValue.js fra den lærte model
-- (backend/lib/riderValuationModel.json) og vises kun player-/admin-facing til
-- godkendelse.
--
-- Cutover (#1101 slice 2, efter ejer-godkendelse): omlæg market_value/salary til
-- at bygge på base_value + afkobl uci_points. Se docs/decisions/rider-valuation-model-v1.md.
--
-- Nullable + ingen default: en NULL base_value betyder "endnu ikke beregnet" og
-- er let at skelne fra en rigtig 0 (som log-modellen aldrig producerer).

ALTER TABLE riders ADD COLUMN IF NOT EXISTS base_value INTEGER;

COMMENT ON COLUMN riders.base_value IS
  'Data-drevet rytter-værdi (#1101). Lært af faktiske kontesterede handler via '
  'riderValuationModel.json. SHADOW: styrer endnu ikke økonomien — uci-afledte '
  'price/market_value/salary er stadig kilden indtil cutover (slice 2).';
