# 2026-11-25: #8668's migration was refused in prod (function-level custom setting)

**What happened:** #8668 merged at 18:11. auto-migrate stopped at
`2026-11-24-7323-season-squad-promotion.sql:82` with
`permission denied to set parameter "cyclingzone.season_squad_promotion"`.
The transaction rolled back, so neither #8668 migration reached prod. The new
backend code ran without `auctions.reservation_squad` and the new RPCs.
Auctions with a squad violation would throw at settlement. Prod check 18:48:
0 overdue auctions.

**Root cause:** `CREATE FUNCTION ... SET cyclingzone.x = 'on'` (and
`SET cyclingzone.swap_departure = ''` in 8034). PostgreSQL only lets a
superuser attach an unregistered custom setting to a function. The PG17 replay
in CI runs as a superuser, so it passed. Prod's `postgres` role is not one.

**Fix:** set the value in the body with `set_config(..., true)` and restore
the caller's value before each return. An exception rolls the local value back
with the work. Verified in prod in a rolled-back probe that body `set_config`
works for the migration role.

**Prevention:** `scripts/lint-migration-function-settings.mjs` in CI's
migration job rejects a dotted setting on CREATE/ALTER FUNCTION, PROCEDURE,
ROLE or DATABASE. 0 historic hits across all 665 files.

**Lesson:** a green superuser replay does not prove the migration runs in prod.
Check the auto-migrate run right after each merge with a migration.
