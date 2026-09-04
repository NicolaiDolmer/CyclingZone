-- #4377 · Reparér PERSISTEREDE sprint_kommerciel jersey_wins-tradition-mål der
-- mangler cumulative:true.
--
-- HVAD DEN GØR
-- Sætter `cumulative: true` ind i det ÉNE matchende element i
-- `board_profiles.current_goals` (en jsonb-ARRAY af mål) for enhver plan hvor
-- goal-elementet har `type = 'jersey_wins'` og `source = 'club_dna'`, men
-- IKKE allerede `cumulative = true`. Rører kun dét ene nøgle-felt i dét ene
-- array-element — resten af arrayet (øvrige mål, rækkefølge, targets) er
-- uændret.
--
-- HVORFOR (rodårsagen, ikke symptomet — se PR #4549 + .claude/learnings/
-- 2026-09-01-board-jersey-goal-missing-cumulative-flag.md)
-- `sprint_kommerciel`-DNA'ens tradition_goal (backend/lib/boardClubDna.js) var
-- `{ type: "jersey_wins", target: 2, ... }` UDEN `cumulative: true`. Målet
-- injiceres KUN på 5yr-forslag (buildBoardProposal: planType==="5yr" &&
-- dnaKey), så det er altid multi-year — men evaluateGoal/evaluateGoalProgress
-- (boardGoals.js:810-817, 1055-1082) grener jersey_wins-evalueringen på netop
-- dette felt: uden det læses seasonJerseyWins (nulstiller hvert sæsonskifte)
-- i stedet for cumulativeJerseyWins (summerer over hele plan-perioden).
--
-- Kode-fixet (PR #4549) retter KUN nye forslag (buildDnaTraditionGoal-kald
-- efter merge). Allerede-signerede planer har den gamle goal-JSON frosset i
-- current_goals og retter sig ikke selv — deraf denne data-migration.
-- boardGoals.js har fået et forward-guard (console.warn) der flager præcis
-- denne tilstand ved evaluering, så resterende urepairede rækker er synlige
-- i logs indtil denne migration er kørt.
--
-- MÅLT 2026-09-01 (read-only SELECT, service_role, prod):
--   board_profiles-rækker med et jersey_wins/club_dna-mål uden cumulative:true: 113
--   (alle: plan_type='5yr', negotiation_status='completed', is_baseline=false —
--   ingen 3yr/1yr-plan matcher nogensinde dette mønster, da tradition_goal kun
--   injiceres på 5yr-forslag). Prædikatet herunder filtrerer IKKE eksplicit på
--   plan_type — det matcher på selve mål-formen, så migrationen forbliver
--   korrekt selv hvis den antagelse nogensinde ændres.
--
-- INGEN SPILLER MISTER FREMDRIFT: `cumulative:true` kan kun flytte evalueringen
-- til at læse cumulativeJerseyWins (>= seasonJerseyWins per definition, da
-- cumulative inkluderer indeværende sæson) — aldrig en lavere tælling. Se
-- boardClubDna.test.js's monotoni-test for samme invariant på evaluerings-siden.
--
-- IDEMPOTENT: prædikatet (cumulative IS NOT true) matcher ingen rækker efter
-- første kørsel. Kør den gerne igen — 0 rækker rammes.
--
-- ⚠️ Denne fil APPLIES IKKE automatisk her — den køres af ejer/orkestrator
-- POST-MERGE under #2642-rammerne (idempotent + post-verify, ikke en
-- destruktiv klasse: ingen sletning, kun tilføjelse af ét boolean-flag).
--
-- ROLLBACK: backup-tabellen nedenfor bærer hver berørt plans `current_goals`
-- FØR ændringen (nøglet på board_profiles.id). Se UPDATE-skabelonen i bunden.

BEGIN;

-- ── 1) BACKUP FØR SKRIVNING ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.board_profiles_4377_backup_20260901 (
  board_id             uuid PRIMARY KEY REFERENCES public.board_profiles(id) ON DELETE CASCADE,
  current_goals_before jsonb NOT NULL,
  captured_at          timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.board_profiles_4377_backup_20260901 (board_id, current_goals_before)
SELECT bp.id, bp.current_goals
FROM public.board_profiles bp
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements(coalesce(bp.current_goals, '[]'::jsonb)) g
  WHERE g->>'type' = 'jersey_wins'
    AND g->>'source' = 'club_dna'
    AND coalesce((g->>'cumulative')::boolean, false) = false
)
ON CONFLICT (board_id) DO NOTHING;

-- ── 2) SKRIVNINGEN ──────────────────────────────────────────────────────────
-- WITH ORDINALITY bevarer array-rækkefølgen (jsonb_agg uden ORDER BY garanterer
-- den IKKE). CASE rører kun det matchende element; alle andre mål i arrayet
-- (og andre felter på DET matchende mål: target, label, satisfaction_*,
-- dna_key osv.) går uændret igennem `||`-merget.
UPDATE public.board_profiles bp
SET current_goals = (
  SELECT jsonb_agg(
    CASE
      WHEN elem.g->>'type' = 'jersey_wins'
        AND elem.g->>'source' = 'club_dna'
        AND coalesce((elem.g->>'cumulative')::boolean, false) = false
      THEN elem.g || jsonb_build_object('cumulative', true)
      ELSE elem.g
    END
    ORDER BY elem.ord
  )
  FROM jsonb_array_elements(bp.current_goals) WITH ORDINALITY AS elem(g, ord)
)
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements(coalesce(bp.current_goals, '[]'::jsonb)) g
  WHERE g->>'type' = 'jersey_wins'
    AND g->>'source' = 'club_dna'
    AND coalesce((g->>'cumulative')::boolean, false) = false
);

COMMIT;

-- ── 3) POST-VERIFY (kør efter COMMIT) ───────────────────────────────────────
-- 3a. Ingen plan har længere et unflagget jersey_wins/club_dna-mål (forventet 0):
--     SELECT count(*) FROM public.board_profiles bp
--      WHERE EXISTS (
--        SELECT 1 FROM jsonb_array_elements(coalesce(bp.current_goals, '[]'::jsonb)) g
--        WHERE g->>'type' = 'jersey_wins' AND g->>'source' = 'club_dna'
--          AND coalesce((g->>'cumulative')::boolean, false) = false
--      );
--
-- 3b. Backuppen dækker præcis de skrevne rækker (forventet 113 pr. 2026-09-01):
--     SELECT count(*) FROM public.board_profiles_4377_backup_20260901;
--
-- 3c. Array-længden er uændret for hver berørt plan (intet mål tabt/duplikeret):
--     SELECT count(*) FROM public.board_profiles bp
--     JOIN public.board_profiles_4377_backup_20260901 bak ON bak.board_id = bp.id
--      WHERE jsonb_array_length(bp.current_goals) <> jsonb_array_length(bak.current_goals_before);
--     -- forventet 0
--
-- 3d. Alle ANDRE nøgler på det reparerede mål er uændrede (kun 'cumulative' tilføjet):
--     SELECT count(*) FROM public.board_profiles bp
--     JOIN public.board_profiles_4377_backup_20260901 bak ON bak.board_id = bp.id
--     CROSS JOIN LATERAL jsonb_array_elements(bp.current_goals) g_after
--     CROSS JOIN LATERAL jsonb_array_elements(bak.current_goals_before) g_before
--      WHERE g_after->>'type' = 'jersey_wins' AND g_after->>'source' = 'club_dna'
--        AND g_before->>'type' = 'jersey_wins' AND g_before->>'source' = 'club_dna'
--        AND (g_after - 'cumulative') IS DISTINCT FROM (g_before - 'cumulative');
--     -- forventet 0
--
-- ── ROLLBACK (kun hvis nødvendigt) ──────────────────────────────────────────
-- UPDATE public.board_profiles bp
-- SET current_goals = bak.current_goals_before
-- FROM public.board_profiles_4377_backup_20260901 bak
-- WHERE bak.board_id = bp.id;

-- Refs #4377 #2642
