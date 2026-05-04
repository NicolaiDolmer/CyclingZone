-- Auto-genereret af scripts/uci_audit.py 2026-05-04
-- Token-baseret match fanger compound surnames (Lund Andresen, Halland Johannessen).
-- salary er GENERATED siden v2.25 — opdateres automatisk.
UPDATE riders SET uci_points = v.pts
FROM (VALUES
  ( 7494,  2514),  -- Tobias Lund Andresen ← UCI: ANDRESEN Tobias Lund
  (13452,  2393),  -- Tobias Halland Johannessen ← UCI: JOHANNESSEN Tobias Halland
  ( 5633,   379),  -- Guillaume Martin-Guyonnet ← UCI: MARTIN Guillaume
  (14231,   319),  -- Sakarias Koller Løland ← UCI: LØLAND Sakarias Koller
  (17431,   145),  -- Tsegay Tekle Alemayo ← UCI: ALEMAYO Tekle
  ( 9773,    81),  -- Álvaro Sagrado Pérez ← UCI: SAGRADO Alvaro
  ( 4735,    40),  -- Achraf Ed-Doghmy ← UCI: ED DOGHMY Achraf
  ( 4425,    20),  -- José Miguel Reyes Morales ← UCI: REYES Jose Miguel
  (10589,    18),  -- Abel Rosado Arroyo ← UCI: ROSADO Abel
  (10755,    15),  -- Shih-Hsin Hsiao ← UCI: HSIAO Shih Hsin
  (12679,    14),  -- Mohamed-Nadjib Assal ← UCI: ASSAL Mohamed Nadjib
  (15749,    10),  -- Alexy Faure-Prost ← UCI: FAURE PROST Alexy
  ( 2800,     6),  -- Vegard Stake Laengen ← UCI: LAENGEN Vegard Stake
  (15952,     6)  -- Dorcu Ovidiu ← UCI: DORCU Ovidiu-Gabriel
) AS v(pcm_id, pts)
WHERE riders.pcm_id = v.pcm_id;
