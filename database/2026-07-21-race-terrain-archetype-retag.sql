-- 2026-07-21 · #2769 (Sub-1) · Re-tag terrain_archetype så tier 3/4-båndene (#2755) rammes.
-- Idempotent (matcher external_id; ren UPDATE). Applies post-merge EFTER scorecard-GO.
-- terrain_archetype er ortogonal til tier-selektionen → flytter ikke løb mellem tiers.
-- Verificeret mod live-katalog + in-memory scorecard: tier 3 (summit 10, M-Down 52%, ITT 1,
-- brosten 1) + tier 4 (summit 8, M-Down 50%, ITT 1, brosten 1) — begge GO.

-- summit_tour (9): garanteret high_mountain-summit → hæver summit, sænker M-Down.
--   Alpes Juliennes, Vuelta Burgalesa, Tour Arctique, Giro d'Abruzzo (tier 3);
--   Vuelta a los Picos, Giro del Trentino, Tour de l'Ain, Tour du Jura, Tour des Cévennes (tier 4).
UPDATE race_pool SET terrain_archetype = 'summit_tour'
  WHERE external_id IN (
    'bce1bccdd57efbb9','622efeaa9c1a849d','e2471519c99384c6','8fe98b9f788c3b06',
    'b5d4329a6fa8dc15','8b36bfed0f0557f5','8f40dfb81187fab3','4e559db3ff7da746','91b97c71a759380e'
  );

-- cobbled_tour (2): garanteret brosten-etape i etapeløb.
--   Danmark Rundt (tier 3), Ronde van Vlaams-Brabant (tier 4).
UPDATE race_pool SET terrain_archetype = 'cobbled_tour'
  WHERE external_id IN ('37e566b5829adb99','7e002873eb156b00');

-- itt_classic (2): fritstående enkeltstart-endagsløb.
--   Mascate Classic (tier 3), Gran Premio de Castilla (tier 4).
UPDATE race_pool SET terrain_archetype = 'itt_classic'
  WHERE external_id IN ('aea34f4c27148948','5206a2390029811d');

-- Post-verify (forventet: summit_tour=9, cobbled_tour=2, itt_classic=2 = 13 rækker). Kør efter apply:
--   SELECT terrain_archetype, COUNT(*) FROM race_pool
--   WHERE external_id IN (
--     'bce1bccdd57efbb9','622efeaa9c1a849d','e2471519c99384c6','8fe98b9f788c3b06','b5d4329a6fa8dc15',
--     '8b36bfed0f0557f5','8f40dfb81187fab3','4e559db3ff7da746','91b97c71a759380e',
--     '37e566b5829adb99','7e002873eb156b00','aea34f4c27148948','5206a2390029811d')
--   GROUP BY terrain_archetype;
