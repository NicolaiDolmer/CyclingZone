-- Backwards-fix for UCI translit-mismatches (Refs #508).
-- Genereret af scripts/uci_audit.py --mode translit + manuel verifikation
-- 2026-05-20. PR #509 leverede audit-scriptet; denne migration retter de 45
-- verificerede translit-victims fra cron-syncen 2026-05-20 09:55 UTC og indsaetter
-- en historikraekke pr. rytter saa UCI-grafen ikke faar et hul.
--
-- Verifikation: alle 45 ryttere er bekraeftet paa uci_points=5 inden migration,
-- og navn/nationalitet matcher PCS-rytteren. Sheet-points er fra Google Sheet
-- 2026-05-20. False positives med samme efternavn (men anden rytter) er bevidst
-- skippet — 156 audit-kandidater var ikke ægte translit (Mauro Schmid / Tim
-- Merlier / Matthew Brennan etc.).
--
-- Forward-guard: scripts/uci_scraper.py.UCI_NAME_OVERRIDE er udvidet med
-- de samme 45 entries, saa onsdagens cron ikke nedskriver dem igen.
-- salary er GENERATED — opdateres automatisk.

BEGIN;

-- ── 1) Opdater uci_points paa de 45 verificerede translit-victims ─────────
UPDATE riders SET uci_points = v.pts, updated_at = NOW()
FROM (VALUES
  ('94b98ec3-10c5-4d93-8b1c-a43ef199c026'::uuid, 196),  -- Tegshbayar Batsaikhan (MN) <- BATSAIKHAN Tegsh-Bayar
  ('0bd9064e-dfbd-4c29-8d8d-1c2b7d91e18b'::uuid, 153),  -- Mohammad Al Mutaiwei (AE) <- ALMUTAIWEI Mohammad
  ('fc25af24-34b5-4e1b-81b1-f9c807f79380'::uuid, 138),  -- Alfie George (GB) <- GEORGE Alfred
  ('b12d1bcc-3719-4699-a2d6-9811ebd068d7'::uuid, 115),  -- Edinson Alejandro Callejas (CO) <- CALLEJAS Edison Alejandro
  ('7dfa67e0-0ee7-42bc-80b7-3ade0802f2c7'::uuid, 110),  -- Nahom Zerai (ER) <- ZERAY Nahom
  ('6d1103e7-2642-41db-b404-618f6555039c'::uuid, 110),  -- Finlay Walsh (AU) <- WALSH Finn
  ('ac7c573a-7873-4e3f-8075-d7efc383351a'::uuid, 101),  -- Cristofer Robin Jurado (PA) <- JURADO Christofer Robín
  ('4d60c1f2-de7b-441b-849e-40cba3df8584'::uuid,  87),  -- Will Smith (GB) <- SMITH William
  ('fad219fe-4a98-4ebb-bc14-c3fd0123cb83'::uuid,  80),  -- Akil Campbell (TT) <- CAMPBELL Akill
  ('07675278-9f64-400b-a363-8b9fc12172e3'::uuid,  78),  -- Matvey Boldyrev (RU) <- BOLDYREV Matvei
  ('30564b9c-b383-445c-9d99-d28185cf7c81'::uuid,  75),  -- Martin Pluto (LV) <- PLUTO Mārtiņš
  ('0ca77095-127f-4e7b-87a8-60effc16c1ba'::uuid,  75),  -- Luis Fernando Bomfim de Almeida (BR) <- BOMFIM DE ALMEIDA Luiz Fernando
  ('7eb65822-0ef6-4cd0-9767-6de983ef756c'::uuid,  71),  -- Muhammad Abdurrohman (ID) <- ABDURRAHMAN Muhammad
  ('15f6f5ae-0526-44c4-a068-fc7b3cfe8fa0'::uuid,  69),  -- Brayan Obando (EC) <- OBANDO Bryan Raul
  ('bdf58111-2eb3-4589-8fbe-b01fdf849c1f'::uuid,  63),  -- Joshua Kench (NZ) <- KENCH Josh
  ('dd5e7158-ab93-4bbf-a9d9-d58dd77a0180'::uuid,  47),  -- Serdar Anil Depe (TR) <- DEPE Serdar Anıl
  ('416ea6db-97e4-42d5-9b39-4a5a2b3cada5'::uuid,  45),  -- Thavone Phon Asa (LA) <- PHONASA Thavone
  ('667c3e76-635a-4fc0-a1b3-8b882c677031'::uuid,  45),  -- David Jónsson (IS) <- JÓNSSON Davíð
  ('80da533f-7017-47e4-a301-f679a41b7ea9'::uuid,  40),  -- Wooho Jung (KR) <- JUNG Woo-Ho
  ('5ed99aba-55da-4f12-be8c-349d3ced2438'::uuid,  39),  -- Mattie Dodd (GB) <- DODD Matthew
  ('7208d317-5f97-41d6-aa37-fa9c180fd222'::uuid,  35),  -- Mohamed Alaleeli (AE) <- ALALEELI Mohammed
  ('ad37ee46-49e5-4099-adcd-7f395403279d'::uuid,  33),  -- Nattawat Mongkonwong (TH) <- MONGKONWONG Natawat
  ('c8bc9c3a-ad30-48e6-b036-c0329597cbd7'::uuid,  30),  -- Maher Habouria (TN) <- MAHER Habouriya
  ('a38a9334-2577-4125-bfcd-deb23c92e5eb'::uuid,  30),  -- Ioannis Kyriakidis (GR) <- KIRIAKIDIS Ioannis
  ('8640d172-e9db-4a49-9edb-49139ce1b892'::uuid,  30),  -- Hassan Elseify (EG) <- ELSAIFY Hassan
  ('3333180f-6be5-4821-be56-d2c4f7b654c7'::uuid,  30),  -- Ahmed Khalid Al Nuaimi (AE) <- ALNUAIMI Khalid
  ('ecb59a31-4713-4106-97d5-e67a667a13f6'::uuid,  25),  -- Hyeongmin Choe (KR) <- CHOE Hyeong Min
  ('f978f5d0-46c0-4303-914b-e038a2a0bdf3'::uuid,  25),  -- Sasha Bergaud (FR) <- BERGAUD Sacha
  ('58202546-5655-476b-99cc-46537b284539'::uuid,  23),  -- Saif Al Kaabi (AE) <- ALKAABI Saif
  ('ee4df1a2-8cf4-4c11-af0a-ee25f2a7d0af'::uuid,  22),  -- Julio Amicar Ispache (GT) <- ISPACHE Julio Amilcar
  ('1f6e1ed6-f9d6-46e6-92c4-fb0b4bf8da58'::uuid,  20),  -- Abderaouf Bengayou (DZ) <- BENGAYOU Abdelraouf
  ('4b331340-87f2-46b4-8e21-7ee41eb10354'::uuid,  20),  -- Maksim Bilyi (UA) <- BILYI Maksym
  ('1b7651b7-99fe-4c46-85aa-2d2bdaf474a0'::uuid,  20),  -- Dionisyos Douzas (GR) <- DOUZAS Dionysios
  ('8b492a50-3dcb-4840-9df3-6911dcc5f4e5'::uuid,  20),  -- Nadhem Ben Amar (TN) <- BEN AMOR Nadhem
  ('32fcf3cd-7103-44b1-9467-afc1d42994b7'::uuid,  20),  -- Fanis Kyritsis (GR) <- KYRITSIS Theofanis
  ('358f9104-a4f2-4f93-b314-f3ae30a1591f'::uuid,  18),  -- Matthijs De Clercq (BE) <- DE CLERCQ Mathijs
  ('c43d32b1-9302-41af-b3fe-054eff6a7b81'::uuid,  15),  -- Thanakone Vongdeaune (LA) <- VONGDEUANE Thanakone
  ('e280915d-15a5-400e-afb8-d68bb82d244b'::uuid,  15),  -- Zer Abruk Debay (ET) <- DEBAY Filimon Zerabruk
  ('dec7dc34-d3ea-4921-9b98-35b1926f9d6b'::uuid,  15),  -- Alex Correll (AU) <- CORRELL Alexander
  ('7b539ebb-a197-4d43-8c9b-510d0fd8b5f9'::uuid,  14),  -- Julen Arriola-Bengoa (ES) <- ARRIOLABENGOA Julen
  ('d15a4738-82c6-4607-996e-a2dc293677ae'::uuid,  13),  -- Sergei Rostovtsev (UZ) <- ROSTOVTSEV Sergey
  ('248ad301-d27e-41f1-89ca-77c7a76169fd'::uuid,  10),  -- Abdallah Ben Youcef (DZ) <- BENYOUCEF Abdallah
  ('034636f7-d050-4ac2-8ae1-3b044b017ffc'::uuid,  10),  -- Kyunggu Jang (KR) <- JANG Kyung-Gu
  ('7941ab98-8122-4151-86f0-6a139da2f8df'::uuid,  10),  -- Vitaliy Hryniv (UA) <- GRYNIV Vitaliy
  ('9d8248c1-4c31-44b4-92f0-81b1808ff540'::uuid,  10)   -- Cristhian Triminio Martinez (HN) <- TRIMINIO Cristian
) AS v(rider_id, pts)
WHERE riders.id = v.rider_id;

-- ── 2) Indsaet historikraekker saa UCI-grafen ser pænt ud ────────────────
-- Matcher formatet fra scripts/uci_scraper.py sync_supabase() history_rows.
-- synced_at = NOW() saa de ligger efter den fejlede 09:55 UTC-sync.
INSERT INTO rider_uci_history (rider_id, uci_points, synced_at)
SELECT v.rider_id, v.pts, NOW()
FROM (VALUES
  ('94b98ec3-10c5-4d93-8b1c-a43ef199c026'::uuid, 196),
  ('0bd9064e-dfbd-4c29-8d8d-1c2b7d91e18b'::uuid, 153),
  ('fc25af24-34b5-4e1b-81b1-f9c807f79380'::uuid, 138),
  ('b12d1bcc-3719-4699-a2d6-9811ebd068d7'::uuid, 115),
  ('7dfa67e0-0ee7-42bc-80b7-3ade0802f2c7'::uuid, 110),
  ('6d1103e7-2642-41db-b404-618f6555039c'::uuid, 110),
  ('ac7c573a-7873-4e3f-8075-d7efc383351a'::uuid, 101),
  ('4d60c1f2-de7b-441b-849e-40cba3df8584'::uuid,  87),
  ('fad219fe-4a98-4ebb-bc14-c3fd0123cb83'::uuid,  80),
  ('07675278-9f64-400b-a363-8b9fc12172e3'::uuid,  78),
  ('30564b9c-b383-445c-9d99-d28185cf7c81'::uuid,  75),
  ('0ca77095-127f-4e7b-87a8-60effc16c1ba'::uuid,  75),
  ('7eb65822-0ef6-4cd0-9767-6de983ef756c'::uuid,  71),
  ('15f6f5ae-0526-44c4-a068-fc7b3cfe8fa0'::uuid,  69),
  ('bdf58111-2eb3-4589-8fbe-b01fdf849c1f'::uuid,  63),
  ('dd5e7158-ab93-4bbf-a9d9-d58dd77a0180'::uuid,  47),
  ('416ea6db-97e4-42d5-9b39-4a5a2b3cada5'::uuid,  45),
  ('667c3e76-635a-4fc0-a1b3-8b882c677031'::uuid,  45),
  ('80da533f-7017-47e4-a301-f679a41b7ea9'::uuid,  40),
  ('5ed99aba-55da-4f12-be8c-349d3ced2438'::uuid,  39),
  ('7208d317-5f97-41d6-aa37-fa9c180fd222'::uuid,  35),
  ('ad37ee46-49e5-4099-adcd-7f395403279d'::uuid,  33),
  ('c8bc9c3a-ad30-48e6-b036-c0329597cbd7'::uuid,  30),
  ('a38a9334-2577-4125-bfcd-deb23c92e5eb'::uuid,  30),
  ('8640d172-e9db-4a49-9edb-49139ce1b892'::uuid,  30),
  ('3333180f-6be5-4821-be56-d2c4f7b654c7'::uuid,  30),
  ('ecb59a31-4713-4106-97d5-e67a667a13f6'::uuid,  25),
  ('f978f5d0-46c0-4303-914b-e038a2a0bdf3'::uuid,  25),
  ('58202546-5655-476b-99cc-46537b284539'::uuid,  23),
  ('ee4df1a2-8cf4-4c11-af0a-ee25f2a7d0af'::uuid,  22),
  ('1f6e1ed6-f9d6-46e6-92c4-fb0b4bf8da58'::uuid,  20),
  ('4b331340-87f2-46b4-8e21-7ee41eb10354'::uuid,  20),
  ('1b7651b7-99fe-4c46-85aa-2d2bdaf474a0'::uuid,  20),
  ('8b492a50-3dcb-4840-9df3-6911dcc5f4e5'::uuid,  20),
  ('32fcf3cd-7103-44b1-9467-afc1d42994b7'::uuid,  20),
  ('358f9104-a4f2-4f93-b314-f3ae30a1591f'::uuid,  18),
  ('c43d32b1-9302-41af-b3fe-054eff6a7b81'::uuid,  15),
  ('e280915d-15a5-400e-afb8-d68bb82d244b'::uuid,  15),
  ('dec7dc34-d3ea-4921-9b98-35b1926f9d6b'::uuid,  15),
  ('7b539ebb-a197-4d43-8c9b-510d0fd8b5f9'::uuid,  14),
  ('d15a4738-82c6-4607-996e-a2dc293677ae'::uuid,  13),
  ('248ad301-d27e-41f1-89ca-77c7a76169fd'::uuid,  10),
  ('034636f7-d050-4ac2-8ae1-3b044b017ffc'::uuid,  10),
  ('7941ab98-8122-4151-86f0-6a139da2f8df'::uuid,  10),
  ('9d8248c1-4c31-44b4-92f0-81b1808ff540'::uuid,  10)
) AS v(rider_id, pts);

COMMIT;
