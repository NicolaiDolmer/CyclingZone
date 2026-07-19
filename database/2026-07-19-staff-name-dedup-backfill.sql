-- #2657 (opfølgning på #2643) — backfill: omdøb duplikat-NAVNE blandt aktive
-- team_staff-rækker på tværs af hold, så præcis ÉN aktiv række beholder et givet
-- navn. Renser 'dobbeltjob'-oplevelsen (knud_r_flink, 18/7): 60 aktive rows delte
-- 28 unikke navne før #2658 (40→150 fast liste) og fast-liste-tilgangen har
-- stadig et hårdt loft (samme birthday-paradox-mekanik ved liga-vækst — se
-- backend/lib/staffCandidates.js for kode-fixet: fornavn×efternavn-kombinatorik).
--
-- Scope: KUN status='active' rows. Fyret staff (status='fired') er historisk
-- audit-trail (fired_season mm.) og indgår ikke i spillerens samtidige "hvem er
-- ansat hvor"-oplevelse — de røres bevidst ikke.
--
-- Regel: for hvert navn der deles af 2+ aktive rows, beholder den ÆLDSTE række
-- (laveste created_at, id som tie-break) sit navn uændret; øvrige rows får et
-- nyt, unikt fornavn+efternavn fra en lokal kombinatorisk pulje (samme stil som
-- STAFF_NAME_POOL var — fiktive, ingen ægte personer). Navnevalget er
-- deterministisk pr. (staff-id, forsøg) via md5-hash, ikke Math.random-ækvivalent,
-- og re-tjekkes mod LIVE-tabellen for hvert forsøg, så to omdøbte rows i samme
-- kørsel aldrig kan kollidere med hinanden.
--
-- IDEMPOTENT: efter første kørsel er alle aktive navne unikke, så
-- ROW_NUMBER()-partitioneringen giver rn=1 for samtlige rows → løkken CONTINUE'er
-- for alt → no-op ved gen-kørsel.
--
-- ⚠️ Migration auto-applies i prod ved merge — EJEREN merger PR'en (database/*.sql).
--
-- Rollback: ikke muligt at genskabe de oprindelige duplikat-navne (de er per
-- definition tabt information — det ER fixet). Ingen data slettes; kun `name`
-- opdateres på de rows der blev omdøbt.

BEGIN;

DO $$
DECLARE
  dup RECORD;
  new_name TEXT;
  first_names TEXT[] := ARRAY[
    'Aksel', 'Bea', 'Cezar', 'Dalia', 'Emrik', 'Fenna', 'Gudrun', 'Havel',
    'Ines', 'Jorik', 'Kaja', 'Lior', 'Milena', 'Noor', 'Orsolya', 'Pavle',
    'Quirin', 'Reka', 'Sirin', 'Tycho', 'Ulla', 'Vidar', 'Wiebke', 'Yeva'
  ];
  last_names TEXT[] := ARRAY[
    'Amdal', 'Brenner', 'Cortez', 'Duval', 'Ekberg', 'Farkas', 'Grunewald', 'Halberg',
    'Ibsen', 'Jelinek', 'Kovarik', 'Lindal', 'Moldova', 'Nagata', 'Oleander', 'Piccard',
    'Quintal', 'Rasner', 'Sandal', 'Trentin', 'Ulvang', 'Vestman', 'Wachter', 'Yilmaz'
  ];
  fn_len INT := array_length(first_names, 1);
  ln_len INT := array_length(last_names, 1);
  combo_hash BIGINT;
  fi INT;
  li INT;
  attempt INT;
BEGIN
  FOR dup IN
    SELECT id, name,
           ROW_NUMBER() OVER (PARTITION BY name ORDER BY created_at, id) AS rn
    FROM team_staff
    WHERE status = 'active'
  LOOP
    IF dup.rn = 1 THEN
      CONTINUE; -- ældste række med dette navn beholder det uændret
    END IF;

    attempt := 0;
    LOOP
      combo_hash := ('x' || substr(md5(dup.id::text || ':' || attempt::text), 1, 8))::bit(32)::bigint;
      fi := 1 + (combo_hash % fn_len);
      li := 1 + ((combo_hash / fn_len) % ln_len);
      new_name := first_names[fi] || ' ' || last_names[li];
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM team_staff WHERE status = 'active' AND name = new_name
      );
      attempt := attempt + 1;
      -- Sikkerhedsnet: pulje (24×24=576 kombinationer) er langt større end antal
      -- duplikater i praksis, men undgå en uendelig løkke hvis den nogensinde
      -- udtømmes — tving unikhed med et suffiks fra rækkens eget id.
      EXIT WHEN attempt > 300;
    END LOOP;
    IF attempt > 300 THEN
      new_name := new_name || ' ' || substr(dup.id::text, 1, 4);
    END IF;

    UPDATE team_staff SET name = new_name WHERE id = dup.id;
  END LOOP;
END $$;

COMMIT;
