-- Refs #8741. Pin the RPC search paths and combine the existing DM read
-- predicates. No data or grants change.
BEGIN;
SET LOCAL lock_timeout = '3s';

ALTER FUNCTION public.training_runs_from_ticks_6490(uuid[], date, date, boolean)
  SET search_path = public, pg_catalog;
-- #7659 is a manual migration. A fresh automatic replay may not have this RPC.
DO $migration$
BEGIN
  IF pg_catalog.to_regprocedure('public.get_team_result_history_page(uuid,integer,integer)') IS NOT NULL THEN
    ALTER FUNCTION public.get_team_result_history_page(uuid, integer, integer)
      SET search_path = public, pg_catalog;
  END IF;
END
$migration$;

DROP POLICY IF EXISTS dm_conversations_participant_read ON public.dm_conversations;
DROP POLICY IF EXISTS dm_conversations_admin_reported_read ON public.dm_conversations;
DROP POLICY IF EXISTS dm_conversations_authenticated_read ON public.dm_conversations;
CREATE POLICY dm_conversations_authenticated_read ON public.dm_conversations
  FOR SELECT TO authenticated
  USING (
    (SELECT auth.uid()) IN (participant_a, participant_b)
    OR (
      public.is_admin()
      AND EXISTS (
        SELECT 1 FROM public.dm_reports r
        WHERE r.conversation_id = dm_conversations.id
      )
    )
  );

DROP POLICY IF EXISTS dm_messages_participant_read ON public.dm_messages;
DROP POLICY IF EXISTS dm_messages_admin_reported_read ON public.dm_messages;
DROP POLICY IF EXISTS dm_messages_authenticated_read ON public.dm_messages;
CREATE POLICY dm_messages_authenticated_read ON public.dm_messages
  FOR SELECT TO authenticated
  USING (
    (
      EXISTS (
        SELECT 1 FROM public.dm_conversations c
        WHERE c.id = dm_messages.conversation_id
          AND (SELECT auth.uid()) IN (c.participant_a, c.participant_b)
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.dm_blocks b
        WHERE b.blocker_id = (SELECT auth.uid())
          AND b.blocked_id = dm_messages.sender_id
          AND dm_messages.created_at >= b.created_at
      )
    )
    OR (
      public.is_admin()
      AND EXISTS (
        SELECT 1 FROM public.dm_reports r
        WHERE r.conversation_id = dm_messages.conversation_id
      )
    )
  );

COMMIT;
