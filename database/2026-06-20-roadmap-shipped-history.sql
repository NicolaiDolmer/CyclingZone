-- Roadmap-vedligehold (#1600): historik-visning + admin-flade til nye ideer.
-- Schema'et fra 2026-06-11-roadmap-items-votes.sql forberedte status active →
-- shipped/archived, men frontend læste hårdt status='active' OG den player-
-- vendte SELECT-policy gav KUN læseadgang til (approved AND status='active').
-- Et 'shipped'-item var derfor usynligt for almindelige spillere.
--
-- Denne migration gør to ting (begge bagudkompatible — ingen data flyttes):
--   1. Tilføjer shipped_at TIMESTAMPTZ så "Shipped / already built"-sektionen kan
--      sorteres kronologisk (nyeste først). NULL for items der aldrig er sat til
--      shipped; sættes af admin-toggle'en (frontend) når active → shipped.
--   2. Udvider den player-vendte SELECT-policy til også at omfatte shipped-items,
--      så spillere kan se historikken. Admin (public.is_admin()) ser fortsat ALT
--      (også archived) uændret. 'archived' forbliver skjult for spillere.
--
-- Stemme-policies røres IKKE: votes kræver fortsat status='active' (man stemmer
-- ikke på allerede-byggede items). DROP-then-CREATE for idempotent re-apply.

ALTER TABLE roadmap_items
  ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;

COMMENT ON COLUMN roadmap_items.shipped_at IS
  'Tidspunkt hvor item blev sat til status=shipped (#1600). Bruges til kronologisk sortering af historik-sektionen på /roadmap. NULL = aldrig shipped. Sættes af admin-toggle i frontend.';

-- Player-vendt læseadgang udvides fra kun active til {active, shipped}.
-- (approved-flag gater fortsat: kun ejer-godkendt indhold vises.)
DROP POLICY IF EXISTS "Authenticated can read approved active roadmap items" ON roadmap_items;
DROP POLICY IF EXISTS "Authenticated can read approved roadmap items" ON roadmap_items;
CREATE POLICY "Authenticated can read approved roadmap items"
  ON roadmap_items FOR SELECT
  TO authenticated
  USING ((approved AND status IN ('active', 'shipped')) OR public.is_admin());

COMMENT ON TABLE roadmap_items IS
  'Kurateret roadmap-indhold til /roadmap (#954, #1600). EN+DA i samme row; approved-flag gater visning. status: active (på vej) → shipped (historik, spiller-synlig) → archived (skjult for spillere). shipped_at tidsstempler historik-rækkefølgen.';
