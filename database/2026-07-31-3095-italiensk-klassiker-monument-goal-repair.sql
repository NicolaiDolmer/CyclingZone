-- #3095 — Data-reparation: fem rigtige tier-3-hold har en 'completed' 5yr
-- bestyrelsesplan med italiensk_klassiker-DNA'ens tradition-mål
-- (monument_podium, race_scope=classics) — et mål der er MATEMATISK
-- UMULIGT at opfylde i deres tier. Kode-fix i samme PR:
-- backend/lib/boardClubDna.js buildDnaTraditionGoal() og
-- backend/lib/boardConsequences.js selectBonusExtraGoal() gater nu begge
-- mod tierRaceSelection.TIER_CLASS_WHITELIST (ny delt helper
-- boardConstants.tierSupportsRaceScope) og injicerer/tilbyder ALDRIG et
-- sådant mål for tier 3/4 fremover.
--
-- Root cause: TIER_CLASS_WHITELIST[3] = ["ProSeries","Class1"] og
-- TIER_CLASS_WHITELIST[4] = ["Class1","Class2"] (#2276-kaskaden) — ingen af
-- disse er i CLASSIC_RACE_CLASSES (Monuments/OtherWorldTourA/B/C), så tier
-- 3/4-kalenderen kører ALDRIG en klassiker eller et Monument. Målet blev
-- injiceret betingelsesløst for ALLE tiers ved 5yr-planens forhandling,
-- uden tjek mod team.division — holdet fik derfor en satisfaction_penalty
-- på 19 hver evaluering for et mål det aldrig kunne nå.
--
-- STATUS: IKKE KØRT — forberedt til ejer-review (jf. database/proposals/README.md
-- + .claude/learnings/2026-07-19-prepared-sql-auto-applied-footgun.md). Ligger
-- BEVIDST i database/proposals/, IKKE database/-topniveau, så auto-migrate.yml
-- (matcher kun `database/2026-*.sql` via `find -maxdepth 1`) IKKE plukker den
-- op ved merge. Flyt til database/-topniveau i en SEPARAT PR når ejeren har
-- godkendt reparationsreglen nedenfor (orkestratoren applier derefter selv,
-- idempotent + post-verify, jf. #2642-rammerne).
--
-- ─── Kvantificering (read-only mod prod 31/7, supabase MCP execute_sql) ────────
--
-- Verificeret PRÆCIS de 5 hold #3095 navngiver, alle ægte tier-3-managere
-- (is_ai=false, is_bank=false, is_frozen=false, is_test_account=false,
-- team_dna_key='italiensk_klassiker', division=3):
--   Ardennaise Pro Cycling Team  → board_id e6644736-42bb-43db-876f-917ec9bc403f
--   Bad At Names                 → board_id 75c4c708-d9fb-40b7-bc46-3a0f9363a3dd
--   Hopplà Team                  → board_id 89e6c486-0c18-41f0-aa04-ed7cedd774f6
--   Kemphanen Cycling Team       → board_id 29daee66-0196-497d-854a-a229ae9a62fd
--   Nickstar Rockets             → board_id 2913409c-86dc-46a2-8e04-40406da05e29
--
-- Alle 5 har PRÆCIS ét board_profiles-row med plan_type='5yr',
-- negotiation_status='completed', og current_goals indeholder som sidste
-- element den identiske bug-signatur:
--   {"type":"monument_podium","source":"club_dna","dna_key":"italiensk_klassiker",
--    "race_scope":"classics", ...}
-- Deres 1yr/3yr-planer har IKKE dette mål (buildDnaTraditionGoal kaldes kun
-- for planType==='5yr') — kun 5yr-planens current_goals er ramt.
--
-- ─── Reparationsregel (deterministisk, kun de 5) ────────────────────────────────
--
-- ERSTATTER (jf. issue: "neutraliser/erstat") = FJERNER det umulige
-- monument_podium-element fra current_goals-arrayet. Ingen substitut-mål
-- indsættes i stedet — det matcher PRÆCIS hvad kode-fixet nu gør for enhver
-- FREMTIDIG 5yr-forhandling for et tier 3/4-hold med italiensk_klassiker-DNA
-- (buildDnaTraditionGoal returnerer null → intet bonus-tradition-mål
-- injiceres, planens øvrige 5 mål er upåvirkede). Holdets øvrige mål
-- (top_n_finish, min_riders/min_u25_riders, stage_wins, no_outstanding_debt,
-- relative_rank/u25_development_delta) er IKKE en del af bug-signaturen og
-- røres ikke.
--
-- IKKE rørt (bevidst, uden for scope): historisk satisfaction (sunk cost —
-- allerede tabte penalty-point fra tidligere evalueringer reverseres ikke,
-- kun den FREMADRETTEDE straf stoppes) og board_plan_snapshots (historisk
-- log, ikke forward-evaluerings-state).
--
-- IDEMPOTENT: WHERE-prædikatet (præcis de 5 board_id + EXISTS-tjek på
-- bug-signaturen i current_goals) rammer 0 rækker efter første succesfulde
-- kørsel — signaturen er væk efter UPDATE'en.

-- ─── Backup (før-værdier, til evt. rollback) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS backup_italiensk_klassiker_monument_goal_fix_20260731 (
  board_id UUID PRIMARY KEY,
  team_id UUID,
  current_goals JSONB,
  backed_up_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO backup_italiensk_klassiker_monument_goal_fix_20260731
  (board_id, team_id, current_goals)
SELECT bp.id, bp.team_id, bp.current_goals
FROM board_profiles bp
WHERE bp.id IN (
  'e6644736-42bb-43db-876f-917ec9bc403f', -- Ardennaise Pro Cycling Team
  '75c4c708-d9fb-40b7-bc46-3a0f9363a3dd', -- Bad At Names
  '89e6c486-0c18-41f0-aa04-ed7cedd774f6', -- Hopplà Team
  '29daee66-0196-497d-854a-a229ae9a62fd', -- Kemphanen Cycling Team
  '2913409c-86dc-46a2-8e04-40406da05e29'  -- Nickstar Rockets
)
ON CONFLICT (board_id) DO NOTHING;

BEGIN;

UPDATE board_profiles bp
SET current_goals = COALESCE(
      (
        SELECT jsonb_agg(elem)
        FROM jsonb_array_elements(bp.current_goals) elem
        WHERE NOT (
          elem->>'type' = 'monument_podium'
          AND elem->>'source' = 'club_dna'
          AND elem->>'dna_key' = 'italiensk_klassiker'
          AND elem->>'race_scope' = 'classics'
        )
      ),
      '[]'::jsonb
    ),
    updated_at = now()
WHERE bp.id IN (
  'e6644736-42bb-43db-876f-917ec9bc403f',
  '75c4c708-d9fb-40b7-bc46-3a0f9363a3dd',
  '89e6c486-0c18-41f0-aa04-ed7cedd774f6',
  '29daee66-0196-497d-854a-a229ae9a62fd',
  '2913409c-86dc-46a2-8e04-40406da05e29'
)
AND bp.plan_type = '5yr'
AND EXISTS (
  SELECT 1 FROM jsonb_array_elements(bp.current_goals) e2
  WHERE e2->>'type' = 'monument_podium'
    AND e2->>'source' = 'club_dna'
    AND e2->>'dna_key' = 'italiensk_klassiker'
    AND e2->>'race_scope' = 'classics'
);

COMMIT;

-- =============================================================================
-- Post-verify (kør manuelt før og efter — forventede tal ovenfor)
-- =============================================================================
--
-- 1) 0 tilbage med bug-signaturen blandt de 5 (idempotens-tjek):
--    SELECT count(*) FROM board_profiles bp
--    WHERE bp.id IN (
--      'e6644736-42bb-43db-876f-917ec9bc403f', '75c4c708-d9fb-40b7-bc46-3a0f9363a3dd',
--      '89e6c486-0c18-41f0-aa04-ed7cedd774f6', '29daee66-0196-497d-854a-a229ae9a62fd',
--      '2913409c-86dc-46a2-8e04-40406da05e29'
--    )
--    AND EXISTS (
--      SELECT 1 FROM jsonb_array_elements(bp.current_goals) e
--      WHERE e->>'type' = 'monument_podium' AND e->>'dna_key' = 'italiensk_klassiker'
--    );
--    → forventet: 0
--
-- 2) Backup-tabellen har præcis 5 rækker:
--    SELECT count(*) FROM backup_italiensk_klassiker_monument_goal_fix_20260731;
--    → forventet: 5
--
-- 3) Hvert af de 5 boards har nu 5 mål tilbage (var 6 — kun tradition-målet
--    fjernet, resten uændret):
--    SELECT bp.id, jsonb_array_length(bp.current_goals) AS goal_count
--    FROM board_profiles bp
--    WHERE bp.id IN (
--      'e6644736-42bb-43db-876f-917ec9bc403f', '75c4c708-d9fb-40b7-bc46-3a0f9363a3dd',
--      '89e6c486-0c18-41f0-aa04-ed7cedd774f6', '29daee66-0196-497d-854a-a229ae9a62fd',
--      '2913409c-86dc-46a2-8e04-40406da05e29'
--    );
--    → forventet: 5 for alle 5 rækker
--
-- 4) Bredere forward-guard: INGEN board_profiles-row (nogen tier) har
--    længere et bonus-mål der er strukturelt umuligt for holdets egen
--    division (kræver tier-info fra teams — kør som sanity-check, forventet
--    0 efter denne migration OG efter kode-fixet er live):
--    SELECT bp.id, t.division, e->>'type' AS goal_type, e->>'race_scope' AS race_scope
--    FROM board_profiles bp
--    JOIN teams t ON t.id = bp.team_id
--    CROSS JOIN LATERAL jsonb_array_elements(bp.current_goals) e
--    WHERE e->>'type' = 'monument_podium'
--      AND t.division IN (3, 4)
--      AND (e->>'race_scope' IS NULL OR e->>'race_scope' = 'classics');
--    → forventet: 0 rækker
