-- #2760 -- one-off win-back campaign gate. scripts/winback-send.mjs's
-- --execute mode refuses to send unless this key is exactly boolean true
-- (backend/lib/winbackSegment.js has the segment/consent/dedupe logic; this
-- migration only creates the switch). Idempotent (ON CONFLICT DO NOTHING) --
-- safe to replay, never overwrites a value the owner has already flipped.
--
-- Default false: no send happens until the owner explicitly sets this to
-- true (ejer-beslutning 14/9, planned send window ca. 21-24/9, AFTER
-- reviewing the mail copy in backend/lib/emailTemplates.js's
-- buildWinbackEmail -- see this PR's body for the "EJER SKAL GODKENDE" lines
-- and the dry-run numbers the orchestrator runs read-only post-merge).
--
-- Unlike the retention loop's per-type off/dry_run/on stage keys
-- (email_loop_welcome/day1/race_digest, backend/lib/emailLoopFlag.js), this
-- is a plain boolean: win-back has no recurring cron stage to gate, only a
-- single --execute invocation of the ops script, and --dry-run is always
-- available regardless of this flag (it never sends, so it needs no gate).

INSERT INTO app_config (key, value, description)
VALUES
  ('winback_send_enabled', 'false'::jsonb,
   '#2760 - gates scripts/winback-send.mjs --execute (one-off win-back mail to dormant, consenting managers). false = --execute refuses with exit 1. Owner flips to true only after reviewing the mail copy.')
ON CONFLICT (key) DO NOTHING;
