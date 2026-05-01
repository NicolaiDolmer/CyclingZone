-- Fix uci_points for riders whose names didn't match the UCI CSV at import time.
-- Root causes:
--   1. Compound surnames in PCM (e.g. "Cort Nielsen") vs UCI single-part (e.g. "CORT Magnus")
--   2. Middle names in UCI data not stored in PCM (e.g. "HONORÉ Mikkel Frølich")
--   3. Name variants (Joe/Joseph, Bjoern/Bjorn, Dversnes/Dversnes Lavik)
--   4. Stale data (Hamilton imported before he accumulated current points)
-- price and market_value are GENERATED columns — they recompute automatically.

UPDATE riders SET uci_points = v.pts
FROM (VALUES
  (15360, 185),   -- Rasmus Søjberg Pedersen     ← UCI: PEDERSEN Rasmus Søjberg
  (13452, 1904),  -- Tobias Halland Johannessen  ← UCI: JOHANNESSEN Tobias Halland
  (13451, 626),   -- Anders Halland Johannessen  ← UCI: JOHANNESSEN Anders Halland
  (3011,  459),   -- Magnus Cort Nielsen         ← UCI: CORT Magnus
  (7494,  2514),  -- Tobias Lund Andresen        ← UCI: ANDRESEN Tobias Lund
  (5633,  661),   -- Guillaume Martin-Guyonnet   ← UCI: MARTIN Guillaume
  (6594,  398),   -- Mikkel Honoré               ← UCI: HONORÉ Mikkel Frølich
  (9151,  245),   -- Joe Blackmore               ← UCI: BLACKMORE Joseph
  (7154,  368),   -- Fredrik Dversnes            ← UCI: DVERSNES LAVIK Fredrik
  (6000,  211),   -- Iván Sosa                   ← UCI: SOSA Iván Ramiro
  (7090,  286),   -- Brandon Rivera              ← UCI: RIVERA Brandon Smith
  (6513,   62),   -- Erik Nordsæter Resell       ← UCI: RESELL Erik Nordsæter
  (7616,   44),   -- Gil Gelders                 ← UCI: GELDERS Gil (stale)
  (13032, 379),   -- Sergio Chumil               ← UCI: CHUMIL Sergio Geovani
  (7705,   43),   -- Mateo Pablo Ramírez         ← UCI: RAMÍREZ Mateo
  (9934,  205),   -- Bjoern Koerdt               ← UCI: KOERDT Bjorn
  (6374,   50)    -- Lucas Hamilton              ← UCI: HAMILTON Lucas (stale: was 7)
) AS v(pcm_id, pts)
WHERE riders.pcm_id = v.pcm_id;

-- salary is NOT a generated column — must be updated alongside uci_points.
-- Formula: salary = uci_points * 4000 * 0.10 = uci_points * 400
UPDATE riders
SET salary = uci_points * 400
WHERE pcm_id IN (15360,13452,13451,3011,7494,5633,6594,9151,7154,6000,7090,6513,7616,13032,7705,9934,6374);
