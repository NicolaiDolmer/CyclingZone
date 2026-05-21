# NOW — Aktuel arbejdsstatus

> **🔴 Session 2026-05-22 00:10 CEST — sæson-loop incident løst:** Auto-transition cron fyrede 0→1→2→3→4 (loop) pga. racing-window cron-leakage. Akut-stop kl 23:48; rollback til sæson 1 kl 00:08; v3.86 fix deployer nu (closed_at IS NOT NULL guard i 3 crons + admin_log.admin_user_id nullable + 3 regressionstests). Postmortem: [`.claude/learnings/2026-05-22-season-transition-cron-loop-racing-window-leakage.md`](.claude/learnings/2026-05-22-season-transition-cron-loop-racing-window-leakage.md).

## Aktiv styring
