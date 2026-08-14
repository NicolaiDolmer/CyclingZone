-- race_results: stabil deltager-identitet (entrant_key) + unik nøgle (#3022)
-- =============================================================================
--
-- Baggrund (#3022): race_results har i dag INGEN unik nøgle på sit indhold. At der
-- ikke findes dubletter afhænger udelukkende af at hvert kaldested husker at slette
-- FØR insert og tjekker at sletningen lykkedes (#2898/#2974). Det er et sikkerhedsnet,
-- ikke en garanti.
--
-- Det naive fix — UNIQUE (race_id, stage_number, result_type, rider_id) — virker IKKE.
-- Målt mod prod 2026-08-05 (samme forespørgsel som issuets 2026-07-26-tal, blot
-- genkørt — churnen er fortsat i mellemtiden):
--
--   Rækker i alt                                   710.397
--   Rider-scoped rækker med rider_id IS NULL       225.947  (31,8 %)
--   Heraf: 100 % team_name LIKE 'AI %', 0 rigtige hold, 0 kr. præmie-risiko
--   Kolliderende grupper for den naive nøgle          4.248  (op fra 2.336 pr. 26/7)
--   Rækker i de kolliderende grupper                256.419  (værste gruppe: 168)
--
-- Årsagen er IKKE datafejl: AI-hold ryddes/regenereres løbende (aiTeamGenerator),
-- og race_results.rider_id/team_id har ON DELETE SET NULL. Et navne-snapshot
-- (rider_name/team_name) overlever slettes IKKE af generatorens skyld men er
-- garanteret populeret siden #2481 (trg_snapshot_result_names_on_rider_delete /
-- trg_snapshot_result_names_on_team_delete, database/2026-07-16-race-results-orphan-guard.sql)
-- — de to BEFORE DELETE-triggers snapshotter rider_name/team_name for ALLE
-- delete-stier FØR FK'en nulstilles. Verificeret 2026-08-05: 0 af de 225.947
-- orphan-rækker mangler et navne-snapshot.
--
-- #1847 (247 orphaned race_results) er samme mekanisme i mindre skala — og er
-- allerede afgjort som "intet at reparere" (issue-kommentar 2026-07-16, PR #2481):
-- rækkerne er display-sikker løbshistorik for afdøde AI-hold, 0 rigtige hold ramt,
-- 0 uindfriet præmie. Sletning ville FJERNE historik (stik modsat palmarès-målet,
-- #1997) uden at rette noget. Denne migration gentager IKKE den vurdering — den
-- bygger identiteten (entrant_key) der gør orphan-status irrelevant for uniqueness.
--
-- ── Trin 1: entrant_key — en identitet der overlever FK-nulstilling ──────────────
--
-- Genereret kolonne, ALDRIG NULL:
--   - team-scoped rækker (result_type IN ('team','team_day')): team_id hvis sat,
--     ellers 'team-name:'+lower(trim(team_name))
--   - alle andre (rytter-scoped): rider_id hvis sat, ellers
--     'rider-name:'+lower(trim(rider_name))+'::'+lower(trim(team_name))
--
-- Fordi entrant_key ALDRIG er NULL er "NULLS NOT DISTINCT" ikke nødvendigt for at
-- UNIQUE-constrainten skal virke korrekt på tværs af orphan-rækker — en simpel
-- UNIQUE er tilstrækkelig og portabel til Postgres 15+ (ikke kun 17.6-specifik syntaks).
--
-- JS-siden af samme logik (bruges til at afvise en batch FØR databasen, med et
-- forklarende budskab i stedet for en rå unique_violation): backend/lib/raceResultEntrantKey.js
-- (computeEntrantKey/hasValidEntrantIdentity/assertValidEntrantRows). De to sider
-- er bevidst holdt i sync — ændres CASE-logikken her, skal JS-filen opdateres 1:1
-- (bevist af backend/lib/testdb/raceResultsEntrantUnique.integration.test.js, der
-- kører DENNE fils SQL mod en ægte PGlite-instans).
--
-- ── Trin 2: unik nøgle — kun MULIGT fordi Trin 1 fjerner NULL-kollisionen ────────
--
-- ── Krænkelser målt mod den VALGTE nøgle (ikke den naive) — 2026-08-05 ───────────
--
--   Ægte dubletter (rider_id IS NOT NULL, samme race/stage/type/rider)     0
--   Ægte dubletter (team_id IS NOT NULL, team/team_day)                    0
--   Kolliderende grupper for entrant_key-nøglen (HELE tabellen, alle
--   710.397 rækker, inkl. de 225.947 orphans)                              0
--
-- Konklusion: INGEN oprydning (ingen DELETE) er nødvendig for at denne constraint
-- kan tilføjes — entrant_key-designet undgår kollisionen helt, i stedet for at
-- rydde op i den. Det er derfor der ikke er noget "cleanup"-script ved siden af
-- denne fil: cleanup ER arkitekturændringen (Trin 1), ikke en data-mutation.
--
-- Sikkerhedsnet mod at det tal har ændret sig mellem 2026-08-05 og apply-tidspunktet
-- (churnen er kontinuerlig, ca. 10-15k orphan-rækker/dag jf. imported_at-fordelingen):
-- migrationen tæller selv kollisioner for den VALGTE nøgle lige før den tilføjer
-- constrainten og RAISER en EXCEPTION (hele transaktionen rulles tilbage, ingenting
-- er halvvejs anvendt) hvis der findes ÉN. Idempotent + selv-verificerende.
--
-- Idempotens: ADD COLUMN IF NOT EXISTS + DO-blok der tjekker pg_constraint før
-- ADD CONSTRAINT (Postgres har ingen "ADD CONSTRAINT IF NOT EXISTS"). Genkørsel er
-- et no-op.
--
-- Rækkefølge ift. database/proposals/2026-08-05-race-results-batch-write-atomic-rpc.sql:
-- DENNE fil bør appliceres FØRST (selvom de ikke er strukturelt afhængige) — Trin 3
-- (atomisk skrivning) giver først sin fulde værdi når Trin 1+2 gør en dublet
-- UMULIG at INSERT'e, ikke kun mindre sandsynlig. Se PR-beskrivelsen for den fulde
-- rækkefølge og hvorfor den er sikker.
--
-- Rollback:
--   ALTER TABLE public.race_results DROP CONSTRAINT IF EXISTS race_results_entrant_unique;
--   ALTER TABLE public.race_results DROP COLUMN IF EXISTS entrant_key;

-- ── Trin 1 ────────────────────────────────────────────────────────────────────
ALTER TABLE public.race_results
  ADD COLUMN IF NOT EXISTS entrant_key text GENERATED ALWAYS AS (
    CASE
      WHEN result_type IN ('team', 'team_day') THEN
        COALESCE(team_id::text, 'team-name:' || lower(btrim(coalesce(team_name, ''))))
      ELSE
        COALESCE(rider_id::text, 'rider-name:' || lower(btrim(coalesce(rider_name, ''))) || '::' || lower(btrim(coalesce(team_name, ''))))
    END
  ) STORED;

-- ── Pre-flight: RAISER hvis den VALGTE nøgle alligevel kolliderer et sted ───────
-- (forventet 0 pr. målingen ovenfor — dette er et sikkerhedsnet mod data-drift,
-- ikke en forventet fejlvej). Rammer den, SKAL constrainten IKKE tilføjes —
-- transaktionen ruller automatisk tilbage (entrant_key-kolonnen forsvinder også).
DO $$
DECLARE
  v_collisions integer;
BEGIN
  SELECT count(*) INTO v_collisions FROM (
    SELECT race_id, stage_number, result_type, entrant_key
    FROM public.race_results
    GROUP BY 1, 2, 3, 4
    HAVING count(*) > 1
  ) g;

  IF v_collisions > 0 THEN
    RAISE EXCEPTION
      'race_results_entrant_unique pre-flight FAILED: % kolliderende gruppe(r) fundet for entrant_key-nøglen — STOP, undersøg FØR constrainten tilføjes (forventet 0 pr. 2026-08-05-målingen i filens header)',
      v_collisions;
  END IF;
END $$;

-- ── Trin 2 ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'race_results_entrant_unique'
  ) THEN
    ALTER TABLE public.race_results
      ADD CONSTRAINT race_results_entrant_unique
      UNIQUE (race_id, stage_number, result_type, entrant_key);
  END IF;
END $$;

-- =============================================================================
-- Verifikation efter migration (kør manuelt mod prod, forventet output)
-- =============================================================================
--
-- 1) Constrainten findes:
--    SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--      WHERE conrelid = 'public.race_results'::regclass AND conname = 'race_results_entrant_unique';
--    → forventet: 1 række, def = "UNIQUE (race_id, stage_number, result_type, entrant_key)"
--
-- 2) Et forsøg på at indsætte en ægte dublet afvises (kør i en transaktion du ruller tilbage):
--    BEGIN;
--      INSERT INTO race_results (race_id, stage_number, result_type, rider_id, rider_name, points_earned, prize_money)
--        SELECT race_id, stage_number, result_type, rider_id, rider_name, points_earned, prize_money
--        FROM race_results WHERE rider_id IS NOT NULL LIMIT 1;
--    → forventet: ERROR: duplicate key value violates unique constraint "race_results_entrant_unique"
--    ROLLBACK;
--
-- 3) Ingen eksisterende rækker blev rørt (kolonnetilføjelse + constraint er additiv):
--    SELECT count(*) FROM race_results;
--    → forventet: uændret optælling fra FØR migrationen (710.397 pr. 2026-08-05 + normal væksten siden).
