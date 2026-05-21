-- Sæson-transition cron-loop incident 2026-05-21:
-- transitionToNextSeason kaldt fra cron har adminUserId=null, men admin_log.admin_user_id
-- var NOT NULL → admin_log INSERT fejlede silently, så 4 transitions kørte uden audit-trail.
-- Vi gør admin_user_id nullable så cron-initierede admin-handlinger kan logges korrekt.
-- FK til users(id) bibeholdes (kun NULL eller eksisterende user accepteres).
--
-- Rollback:
--   ALTER TABLE admin_log ALTER COLUMN admin_user_id SET NOT NULL;
--   (vil fejle hvis der findes rows med admin_user_id=null — slet dem først)

ALTER TABLE admin_log
  ALTER COLUMN admin_user_id DROP NOT NULL;

COMMENT ON COLUMN admin_log.admin_user_id IS
  'auth.users-id for admin der initierede handlingen. NULL for cron/system-initierede handlinger (fx auto-season-transition).';
