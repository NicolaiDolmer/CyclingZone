-- Refs #7153. Owner-approved content refresh, 27 October.
-- Owner go 27/10: only delivered items may move to Done. Settings, TTT,
-- U23 promotion and all remaining open items are untouched.
-- Intended apply: auto-migrate after PC1-controlled merge, then read-back.
-- Codex validates locally and does not execute this against production.
-- No schema changes, flags, player data, votes or priority ordering are changed.
-- Baseline: read-only prod 27/10. Guard every existing row against stale status.
BEGIN;

DO $refresh$
DECLARE
  item record;
  found_status text;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('120e5d1a-29d3-412b-aa54-cdabe6c2f408'::uuid, 6156, 'planned', 'shipped')
  ) AS expected(id, issue_ref, before_status, after_status)
  LOOP
    SELECT status INTO found_status FROM public.roadmap_items
    WHERE id = item.id AND issue_ref = item.issue_ref FOR UPDATE;
    IF NOT FOUND OR found_status NOT IN (item.before_status, item.after_status) THEN
      RAISE EXCEPTION 'Roadmap baseline changed for issue %', item.issue_ref;
    END IF;
    UPDATE public.roadmap_items
    SET status = item.after_status,
        live_soon = false, beta_soon = false,
        shipped_at = CASE WHEN item.after_status = 'shipped'
          THEN COALESCE(shipped_at, '2026-10-26T09:23:00Z'::timestamptz) ELSE shipped_at END
    WHERE id = item.id;
  END LOOP;
END
$refresh$;

-- History additions do not reorder the planned queue. Existing rows win.
INSERT INTO public.roadmap_items
  (id, engine, sort_order, title_en, title_da, approved, status, horizon, issue_ref, shipped_at)
SELECT '00007153-0000-4000-8000-000000007282'::uuid, 'training', 0,
  'Training every day, also between seasons.',
  'Træning hver dag, også mellem sæsonerne.',
  true, 'shipped', 'next', 7282, '2026-10-27T06:35:20Z'::timestamptz
WHERE NOT EXISTS (SELECT 1 FROM public.roadmap_items WHERE issue_ref = 7282)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.roadmap_items
  (id, engine, sort_order, title_en, title_da, approved, status, horizon, issue_ref, shipped_at)
SELECT '00007153-0000-4000-8000-000000007288'::uuid, 'training', 0,
  'New seasons start with a little base fatigue, so you can manage form before the first race.',
  'Nye sæsoner starter med lidt grundtræthed, så du kan styre formen før det første løb.',
  true, 'shipped', 'next', 7288, '2026-10-27T11:32:49Z'::timestamptz
WHERE NOT EXISTS (SELECT 1 FROM public.roadmap_items WHERE issue_ref = 7288)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.roadmap_items
  (id, engine, sort_order, title_en, title_da, approved, status, horizon, issue_ref, shipped_at)
SELECT '00007153-0000-4000-8000-000000007003'::uuid, 'races', 0,
  'Conflicting orders can no longer be selected together.',
  'Modsatte ordrer kan ikke længere vælges sammen.',
  true, 'shipped', 'next', 7003, '2026-10-27T12:48:00Z'::timestamptz
WHERE NOT EXISTS (SELECT 1 FROM public.roadmap_items WHERE issue_ref = 7003)
ON CONFLICT (id) DO NOTHING;
-- Read-back: PC1 compares these rows with the approved diff and /roadmap.
SELECT issue_ref, title_en, title_da, status, horizon, sort_order, shipped_at
FROM public.roadmap_items WHERE issue_ref IN (6156,7282,7288,7003)
ORDER BY sort_order, issue_ref;
COMMIT;
