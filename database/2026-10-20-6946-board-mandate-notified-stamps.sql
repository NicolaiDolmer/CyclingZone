-- #6946 · Bestyrelsesbeskeder (mandat-åbning, T-3, T-1) dedupliceres på et
-- stempel pr. mandat i stedet for på notifications-rækker.
--
-- Før: cronen (boardMandateAutoAccept.js) slog op i notifications for at se om
-- beskeden allerede var sendt. Sletning i indbakken er en hård DELETE, så
-- beviset forsvandt, og beskeden (inkl. Discord-DM) kom igen ved næste kørsel.
-- Nu: stemplet står på board_mandates, som spilleren ikke kan røre (RLS uden
-- policies, kun service_role skriver).
--
-- Additiv + idempotent: ADD COLUMN IF NOT EXISTS, og backfillen rører kun
-- rækker hvor stemplet stadig er NULL. Backfillen dækker kun 'proposed'
-- mandater (de eneste cronen læser) og sætter stemplet til den første
-- eksisterende notits for mandatet, så ingen får beskeden igen ved udrulning.
-- Rækker hvor spilleren allerede HAR slettet beskeden har intet bevis tilbage;
-- de får den højst én gang mere, og så står stemplet.

BEGIN;

SET LOCAL lock_timeout = '3s';

ALTER TABLE public.board_mandates
  ADD COLUMN IF NOT EXISTS opened_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS t3_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS t1_notified_at timestamptz;

COMMENT ON COLUMN public.board_mandates.opened_notified_at IS
  '#6946: tidspunkt hvor mandat-åbnings-notitsen blev sendt (cron-dedupe; overlever at spilleren sletter beskeden).';
COMMENT ON COLUMN public.board_mandates.t3_notified_at IS
  '#6946: tidspunkt hvor T-3-påmindelsen blev sendt (cron-dedupe; overlever at spilleren sletter beskeden).';
COMMENT ON COLUMN public.board_mandates.t1_notified_at IS
  '#6946: tidspunkt hvor T-1-påmindelsen blev sendt (cron-dedupe; overlever at spilleren sletter beskeden).';

-- Backfill: samme nøgle som cronens gamle opslag (holdets manager, type,
-- related_id = mandatet, titleCode).
UPDATE public.board_mandates m
SET opened_notified_at = sub.first_at
FROM (
  SELECT n.related_id, n.user_id, min(n.created_at) AS first_at
  FROM public.notifications n
  WHERE n.type = 'board_update'
    AND n.metadata->>'titleCode' = 'notif.boardMandateOpened.title'
    AND n.related_id IS NOT NULL
  GROUP BY n.related_id, n.user_id
) sub, public.teams t
WHERE m.status = 'proposed'
  AND m.opened_notified_at IS NULL
  AND t.id = m.team_id
  AND sub.related_id = m.id
  AND sub.user_id = t.user_id;

UPDATE public.board_mandates m
SET t3_notified_at = sub.first_at
FROM (
  SELECT n.related_id, n.user_id, min(n.created_at) AS first_at
  FROM public.notifications n
  WHERE n.type = 'board_update'
    AND n.metadata->>'titleCode' = 'notif.boardMandateT3Reminder.title'
    AND n.related_id IS NOT NULL
  GROUP BY n.related_id, n.user_id
) sub, public.teams t
WHERE m.status = 'proposed'
  AND m.t3_notified_at IS NULL
  AND t.id = m.team_id
  AND sub.related_id = m.id
  AND sub.user_id = t.user_id;

UPDATE public.board_mandates m
SET t1_notified_at = sub.first_at
FROM (
  SELECT n.related_id, n.user_id, min(n.created_at) AS first_at
  FROM public.notifications n
  WHERE n.type = 'board_critical'
    AND n.metadata->>'titleCode' = 'notif.boardMandateT1Reminder.title'
    AND n.related_id IS NOT NULL
  GROUP BY n.related_id, n.user_id
) sub, public.teams t
WHERE m.status = 'proposed'
  AND m.t1_notified_at IS NULL
  AND t.id = m.team_id
  AND sub.related_id = m.id
  AND sub.user_id = t.user_id;

COMMIT;

-- #6946 (Codex P1): nye kolonner laeses via supabase-js; uden reload ser PostgREST dem
-- ikke (PGRST204), og cronen ville blive i notifications-fallbacken.
NOTIFY pgrst, 'reload schema';
