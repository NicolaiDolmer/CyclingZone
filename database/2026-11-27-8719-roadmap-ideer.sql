-- =============================================================================
-- 2026-11-27 · #8719 · tre ejer-direktiver som idéer på roadmappet
-- =============================================================================
-- Ejer 27/11 (AskUserQuestion, hovedsessionen): #8746, #8852 og #8851 "Som idé uden
-- dato"; titlerne EN/DA ordret godkendt ("Godkendt (Recommended)"). #8854 kommer IKKE
-- på roadmappet (ejer: "Nej, kun issue-listen").
--
-- Idéer = status 'active', approved = true (synlige og til afstemning), horizon
-- 'unscheduled'. engine og sort_order kopieres fra en eksisterende række i samme
-- kategori. Kun INSERT i roadmap_items; idempotent (springer over, hvis issuet allerede
-- har en ikke-arkiveret række). Stemmer røres ikke.
-- APPLY IKKE her: auto-migrate.yml applier post-merge (#2642); Claude post-verificerer.
-- =============================================================================

SET lock_timeout = '3s';
BEGIN;

INSERT INTO public.roadmap_items (engine, category, sort_order, title_en, title_da, approved, status, horizon, issue_ref)
SELECT src.engine, v.category, src.sort_order, v.title_en, v.title_da, true, 'active', 'unscheduled', v.issue
FROM (VALUES
  (8746, 'club', 'f79233f8-fac5-44c9-b791-d44b01843f55'::uuid,
   'More nations and nationalities for riders and managers.',
   'Flere nationer og nationaliteter for ryttere og managere.'),
  (8852, 'academy', '3f3530a9-2de8-4249-a93d-73ea2af68941'::uuid,
   'Global Rank and clear rankings for U23 and junior.',
   'Global Rank og overskuelige ranglister for U23 og junior.'),
  (8851, 'academy', '3f3530a9-2de8-4249-a93d-73ea2af68941'::uuid,
   'Take your team out of, or back into, the senior, U23 or junior competition.',
   'Meld dit hold fra eller til igen i senior-, U23- eller juniorkonkurrencen.')
) AS v(issue, category, src_id, title_en, title_da)
JOIN public.roadmap_items AS src ON src.id = v.src_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.roadmap_items r WHERE r.issue_ref = v.issue AND r.status <> 'archived'
);

DO $chk$
BEGIN
  IF (SELECT count(*) FROM public.roadmap_items
      WHERE issue_ref IN (8746, 8851, 8852) AND status = 'active' AND approved) < 3 THEN
    RAISE EXCEPTION '#8719 roadmap-idéer: de tre idéer mangler';
  END IF;
END
$chk$;

COMMIT;
