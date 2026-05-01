-- Synkroniser uci_points med Google Sheet (autoritativ kilde).
-- Den lokale uci_top1000.csv var forældet og kun top-1000.
-- Google Sheet indeholder 3000 ryttere og er opdateret 2026-04-30.
--
-- Tre årsager til mismatch:
--   1. Ryttere ikke i gammel top-1000 CSV (Van Moer, Heiduk, Scotson m.fl.)
--   2. Værdier ændret siden gammel CSV (Cort Nielsen, Halland Johannessen m.fl.)
--   3. Polske/specielle tegn i Google Sheet (Aniołkowski, Bogusławski → ł→L fix)
--   4. Alternativ translitteration (Tesfazion/Tesfatsion → PCM_UCI_OVERRIDE)
--
-- salary = uci_points * 400 (SALARY_RATE 0.10, price = uci_points * 4000)
-- price og market_value er GENERATED og genberegnes automatisk.

UPDATE riders SET uci_points = v.pts, salary = v.pts * 400
FROM (VALUES
  (7307,  364),  -- Mick van Dijke
  (6314,  190),  -- Brent Van Moer
  (6913,  119),  -- Kim Heiduk
  (6326,  117),  -- Callum Scotson
  (1981,  113),  -- Michal Kwiatkowski
  (7100,  110),  -- Matis Louvel
  (7014,   99),  -- Attila Valter
  (15300,  94),  -- Florian Dauphin
  (13452, 2393), -- Tobias Halland Johannessen (korrekt fra Sheet; gammel CSV: 1904)
  (3011,   321), -- Magnus Cort Nielsen        (gammel CSV: 459)
  (7154,   431), -- Fredrik Dversnes           (gammel CSV: 368)
  (5633,   379), -- Guillaume Martin-Guyonnet  (gammel CSV: 661)
  (6594,   418), -- Mikkel Honoré              (gammel CSV: 398)
  (15360,  170), -- Rasmus Søjberg Pedersen    (gammel CSV: 185)
  (13032,  282), -- Sergio Chumil              (gammel CSV: 379)
  (7090,   288), -- Brandon Rivera             (gammel CSV: 286)
  (9934,   225), -- Bjoern Koerdt              (gammel CSV: 205)
  (6000,   208), -- Iván Sosa                  (gammel CSV: 211)
  (6513,    58), -- Erik Nordsæter Resell      (gammel CSV: 62)
  (6374,     7), -- Lucas Hamilton             (gammel CSV: 50, korrekt er 7)
  (7506,   206), -- Gal Glivar                 (gammel CSV: 44)
  (7372,   728), -- Natnael Tesfazion          (TESFATSION i Sheet)
  (7010,   905), -- Stanislaw Aniolkowski      (ANIOŁKOWSKI — ł-fix)
  (7329,   285), -- Marceli Bogusławski        (ł-fix)
  (6462,   250), -- David Dekker
  (6433,   161), -- Samuel Leroux
  (7279,   154), -- Alexandre Balmer
  (6380,   151), -- Clément Russo
  (15260,  122), -- Vincent Van Hemelen
  (7153,   122), -- Tord Gudmestad
  (7694,   106), -- Seth Dunwoody
  (15615,   80), -- Hugo de la Calle
  (6755,    71), -- Thomas Champion
  (6588,    16), -- Johan Price-Pejtersen
  (7770,    16), -- Santiago Mesa
  (6803,    14)  -- Alejandro Osorio
) AS v(pcm_id, pts)
WHERE riders.pcm_id = v.pcm_id;
