-- Economy retuning: startkapital 2M → 800K, sponsor 400K → 240K
ALTER TABLE teams
  ALTER COLUMN balance SET DEFAULT 800000,
  ALTER COLUMN sponsor_income SET DEFAULT 240000;

-- Opdatér eksisterende hold til nye værdier
UPDATE teams SET balance = 800000, sponsor_income = 240000;
