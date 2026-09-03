-- #2881 (2. forekomst) — Data-reparation: resolveGraduation()'s "promote"-gren i
-- backend/lib/academyGraduation.js overskrev UBETINGET salary/contract_length/
-- contract_end_season på enhver akademirytter der graduerede (alder 22) og blev
-- promoveret via graduerings-flowet — SAMME #1309-invariant-brud som blev fundet
-- og fixet i academyTransfer.js promote() (PR #2929, 25/7), bare via en ANDEN
-- kode-sti som den PR ikke rørte. Fundet ved opfølgende gennemgang af
-- "kontrakt-skrivende stier omkring academyGraduation.js" (#2881).
--
-- Kode-fix i samme PR som denne fil (backend/lib/academyGraduation.js
-- resolveGraduation(): genbruger nu contractOnAcquirePatch, samme gate som
-- academyTransfer.js promote() + al anden erhvervelse).
--
-- STATUS: IKKE KØRT — forberedt til ejer-review (jf. database/proposals/README.md
-- + .claude/learnings/2026-07-19-prepared-sql-auto-applied-footgun.md). Denne fil
-- ligger BEVIDST i database/proposals/, IKKE på database/2026-*.sql-topniveauet,
-- så auto-migrate.yml IKKE plukker den op ved merge. Flyt til database/-topniveau
-- i en SEPARAT PR FØRST når ejeren har godkendt reparationsreglen nedenfor.
--
-- ─── Kvantificering (read-only mod prod 5/8, Supabase MCP execute_sql) ─────────
--
-- Audit-spor: academy_graduation.status='promoted' (sat af finishGraduation()
-- ved hver promote-udfald — utvetydigt, ingen fire-and-forget-notifikations-
-- svaghed som i den første #2881-reparation).
--
--   22 rider_id har status='promoted' i academy_graduation (hele historikken,
--      season_id altid sæson 2 — graduering sker først når rytteren er fyldt 22
--      OG en aktiv graduerings-detektion har kørt; sæson 1 havde ingen 22-årige
--      akademiryttere endnu).
--   ├─  12 → contract_length=2 STADIG i dag (bug-signaturen: DEFAULT_ACQUIRE_
--   │       LENGTH, aldrig ACADEMY.CONTRACT_LENGTH=3) OG et deterministisk
--   │       sporbart akademi-indtrædelses-tidspunkt (academy_intake.status=
--   │       'signed' i sæson 1, ELLER en 'academy_demoted'-notifikation FØR
--   │       gradueringen og FØR sæson 2 startede 27/7) → den korrekte
--   │       kontrakt-længde ved indtræden er ALTID ACADEMY.CONTRACT_LENGTH=3
--   │       (konstant, ingen sæson-/seed-varians). contract_end_season kræver
--   │       INGEN ændring — computeContractEndSeason(1,3)=3 er en TILFÆLDIG
--   │       sammenfald med den buggede computeContractEndSeason(2,2)=3 (begge
--   │       giver 3), så kun contract_length er forkert (2 i stedet for 3).
--   │       ← DENNE migration retter KUN disse 12.
--   ├─   4 → contract_length=3 i dag allerede: kontrakten er siden selv-heldet
--   │       via en efterfølgende, uafhængig hændelse (fornyet demote til
--   │       akademiet, eller en #1720-kontraktforlængelse) — INGEN bug-
--   │       signatur tilbage. IKKE rørt.
--   └─   6 → contract_length=2 STADIG, men INGEN sporbar akademi-indtrædelses-
--           hændelse fundet (hverken academy_intake.status='signed' i sæson 1
--           eller en 'academy_demoted'-notifikation før gradueringen). Kan
--           IKKE repareres med sikkerhed — vi kender ikke rytterens faktiske
--           kontrakt-længde ved indtræden (mulig seed-data/tidlig-launch-rytter
--           uden intake-row, eller notifyTeamOwner-fejl der aldrig loggede en
--           demote-notifikation — samme residual-risiko-klasse som i den
--           første #2881-reparation). IKKE rørt — kræver ejer-beslutning om
--           enten (a) acceptere som ukendt/urepareret, eller (b) en bredere,
--           mindre sikker heuristik.
--
-- Alle 22 er ægte menneskehold (0 AI/bank/frosne/test-konti — verificeret via
-- teams.is_ai/is_bank/is_test_account/is_frozen).
--
-- ─── Løn: IKKE rekonstruerbar, IKKE rørt (samme begrundelse som 25/7-filen) ────
--
-- Den buggede kode gen-beregnede OGSÅ salary (computeFrozenSalary ud fra
-- current_production_value PÅ GRADUERINGS-TIDSPUNKTET, typisk år efter akademi-
-- indtræden — rytteren er vokset betydeligt). Den korrekte adfærd
-- (contractOnAcquirePatch-gaten) ville have bevaret akademi-lønnen UÆNDRET —
-- men den værdi blev overskrevet i samme UPDATE og findes IKKE i noget
-- logspor. Salary røres IKKE af denne reparation.
--
-- ─── Reparationsregel (deterministisk, kun de 12) ──────────────────────────────
--
--   contract_length      → 3   (ACADEMY.CONTRACT_LENGTH, konstant)
--   contract_end_season  → UÆNDRET (allerede 3 — se kvantificering ovenfor)
--
-- IDEMPOTENT: WHERE-prædikatet (contract_length=2 AND graduerings-promote-row
-- findes AND sporbar sæson-1-indtrædelse) rammer 0 rækker efter første
-- succesfulde kørsel (contract_length er så 3, ekskluderet af prædikatet).
--
-- Rollback: backup_academy_graduation_promote_contract_fix_20260805 (oprettet
-- af denne fil, FØR UPDATE) har før-værdien af contract_length pr. rytter-id.
--
-- #2744-kollision: disse 12 har contract_end_season=3, ALLEREDE korrekt uanset
-- reparation — ingen akut frigivelses-risiko fra denne migration alene. Men
-- se den FØRSTE #2881-reparation (2026-07-25-filen) for de 22 riders med
-- contract_end_season=2, som DER er den akutte #2744-kollision før S2-slut.

-- ─── Backup (før-værdi, til evt. rollback) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS backup_academy_graduation_promote_contract_fix_20260805 (
  rider_id UUID PRIMARY KEY,
  team_id UUID,
  contract_length INTEGER,
  contract_end_season INTEGER,
  salary INTEGER,
  backed_up_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO backup_academy_graduation_promote_contract_fix_20260805
  (rider_id, team_id, contract_length, contract_end_season, salary)
SELECT r.id, r.team_id, r.contract_length, r.contract_end_season, r.salary
FROM riders r
WHERE r.is_academy = false AND r.team_id IS NOT NULL
  AND r.contract_length = 2
  AND EXISTS (SELECT 1 FROM academy_graduation ag WHERE ag.rider_id = r.id AND ag.status = 'promoted')
  AND (
    EXISTS (
      SELECT 1 FROM academy_intake ai
      WHERE ai.rider_id = r.id AND ai.status = 'signed'
        AND ai.season_id = (SELECT id FROM seasons WHERE number = 1)
    )
    OR EXISTS (
      SELECT 1 FROM notifications n
      JOIN academy_graduation ag2 ON ag2.rider_id = r.id AND ag2.status = 'promoted'
      WHERE n.type = 'academy_demoted' AND n.related_id = r.id
        AND n.created_at < ag2.resolved_at AND n.created_at < '2026-07-27'
    )
  )
ON CONFLICT (rider_id) DO NOTHING;

BEGIN;

UPDATE riders r
SET contract_length = 3
WHERE r.is_academy = false AND r.team_id IS NOT NULL
  AND r.contract_length = 2
  AND EXISTS (SELECT 1 FROM academy_graduation ag WHERE ag.rider_id = r.id AND ag.status = 'promoted')
  AND (
    EXISTS (
      SELECT 1 FROM academy_intake ai
      WHERE ai.rider_id = r.id AND ai.status = 'signed'
        AND ai.season_id = (SELECT id FROM seasons WHERE number = 1)
    )
    OR EXISTS (
      SELECT 1 FROM notifications n
      JOIN academy_graduation ag2 ON ag2.rider_id = r.id AND ag2.status = 'promoted'
      WHERE n.type = 'academy_demoted' AND n.related_id = r.id
        AND n.created_at < ag2.resolved_at AND n.created_at < '2026-07-27'
    )
  );

COMMIT;

-- =============================================================================
-- Post-verify (kør manuelt før og efter — forventede tal ovenfor)
-- =============================================================================
--
-- 1) 0 tilbage med den reparerbare bug-signatur:
--    SELECT count(*) FROM riders r
--    WHERE r.is_academy = false AND r.team_id IS NOT NULL AND r.contract_length = 2
--      AND EXISTS (SELECT 1 FROM academy_graduation ag WHERE ag.rider_id = r.id AND ag.status = 'promoted')
--      AND (
--        EXISTS (SELECT 1 FROM academy_intake ai WHERE ai.rider_id = r.id AND ai.status = 'signed'
--                AND ai.season_id = (SELECT id FROM seasons WHERE number = 1))
--        OR EXISTS (SELECT 1 FROM notifications n
--                   JOIN academy_graduation ag2 ON ag2.rider_id = r.id AND ag2.status = 'promoted'
--                   WHERE n.type = 'academy_demoted' AND n.related_id = r.id
--                     AND n.created_at < ag2.resolved_at AND n.created_at < '2026-07-27')
--      );
--    → forventet: 0
--
-- 2) Backup-tabellen har præcis 12 rækker:
--    SELECT count(*) FROM backup_academy_graduation_promote_contract_fix_20260805;
--    → forventet: 12
--
-- 3) De 6 urepareret-men-buggede + 4 allerede-selv-helede rører denne migration IKKE
--    (kør før/efter, sammenlign optælling — bør være identisk):
--    SELECT count(*) FROM riders r
--    WHERE r.is_academy = false AND r.team_id IS NOT NULL AND r.contract_length = 2
--      AND EXISTS (SELECT 1 FROM academy_graduation ag WHERE ag.rider_id = r.id AND ag.status = 'promoted');
--    → forventet FØR: 18 (12 reparerbare + 6 urepareret) → EFTER: 6 (kun de urepareret-uden-sporbar-indtrædelse)
--
-- ─── Nyt bug-vindue efter fix (post-verify til at bekræfte INGEN NYE rammes) ───
-- Kør denne EFTER kode-fixet er deployet (kontrollér mod merge-tidspunktet for
-- denne PR) for at bekræfte at INGEN nye graduerings-promote-hændelser viser
-- bug-signaturen (kontrakt-felter regenereret på trods af et sporbart akademi-
-- indtrædelses-tidspunkt der IKKE matcher graduerings-sæsonen):
--
--   SELECT ag.rider_id, ag.resolved_at, r.contract_length, r.contract_end_season
--   FROM academy_graduation ag
--   JOIN riders r ON r.id = ag.rider_id
--   WHERE ag.status = 'promoted'
--     AND ag.resolved_at > '<MERGE_TIMESTAMP_FOR_DENNE_PR>'
--     AND r.contract_length = 2  -- DEFAULT_ACQUIRE_LENGTH-signaturen
--     AND (
--       EXISTS (SELECT 1 FROM academy_intake ai WHERE ai.rider_id = r.id AND ai.status = 'signed')
--       OR EXISTS (SELECT 1 FROM notifications n WHERE n.type = 'academy_demoted' AND n.related_id = r.id
--                  AND n.created_at < ag.resolved_at)
--     );
--   → forventet: 0 rækker (en rytter med sporbar akademi-historik der STADIG
--     lander på DEFAULT_ACQUIRE_LENGTH efter fixet, er enten reelt kontraktløs
--     (sjælden healing-case, OK) eller et tegn på regression — undersøg
--     enkeltvis hvis > 0).
