# schema_migrations double-record fra manuel psql + auto-migrate race

**Date:** 2026-05-18
**Issue:** [#478](https://github.com/NicolaiDolmer/CyclingZone/issues/478)
**Fix:** [`3e5e002`](https://github.com/NicolaiDolmer/CyclingZone/commit/3e5e002)
**Severity:** Low (benign — idempotente migrations, kun beskidt bookkeeping)

## Symptom

Feature-liveness audit ([weekly cron 2026-05-18 08:07 UTC](https://github.com/NicolaiDolmer/CyclingZone/actions/runs/26021298280)) flagede Detector C migration-drift:

```
Detector C — migration-drift (1):
  2026-05-16-waitlist-utm-country.sql
    Applied migration findes ikke i database/ — repo og DB driver
```

## Root cause

`schema_migrations` havde 2 records for samme migration med forskellige filename-formater:

| filename | applied_at | hvordan |
|---|---|---|
| `2026-05-16-waitlist-utm-country.sql` (uden prefix) | 2026-05-16 11:59:12 UTC | Manuel psql/Studio-run af bruger |
| `database/2026-05-16-waitlist-utm-country.sql` (med prefix) | 2026-05-16 12:25:52 UTC | `auto-migrate.yml` 26 min senere |

Sekvens:
1. Bruger kørte migrationen manuelt og indsatte filename uden `database/`-prefix
2. 26 min senere triggede `auto-migrate.yml` på push, så `ls database/2026-*.sql` (med prefix-format)
3. Auto-migrate så `database/...`-format ikke matchede den manuelle uden-prefix-record → kørte migrationen igen
4. Migrationen er fuldt idempotent (`ADD COLUMN IF NOT EXISTS` + guarded constraint via `IF NOT EXISTS`-check) → 2. run ændrede ingenting
5. Auto-migrate skrev `database/...`-record i `schema_migrations` → 2 records

Audit's Detector C tjekker `database/*.sql` (med prefix) mod applied (RPC-returneret). Den uden-prefix-record matcher intet i `committedSet` → finding rejst.

## Fix

```sql
DELETE FROM schema_migrations WHERE filename = '2026-05-16-waitlist-utm-country.sql';
```

Beholdt kanonisk `database/...`-record. Ingen data-impact pga. idempotent migration-design.

## Forward-guard

Tilføjet eksplicit `VIGTIGT — brug database/-prefix` callout i [`docs/AUTO_MIGRATION_SETUP.md`](../../docs/AUTO_MIGRATION_SETUP.md) under "Manuel marker som applied"-sektion. Forklarer at uden prefix vil auto-migrate ikke matche og køre migrationen igen.

## Hvorfor det ikke blev en kode-ændring i auto-migrate

Auto-migrate kunne normalisere ved at slette stripped-prefix-duplikater før run. Vurdering: ikke værd kompleksiteten lige nu. Audit fanger driften ugentligt, manuel cleanup tager 1 SELECT + 1 DELETE. Hvis mønsteret rammer 2+ gange mere, så build normalize-step.

## Også fixet i samme commit

Detector E false-positive på `survey_banner_dismissed` (0 impressions sidste 30 dage) whitelistet, fordi banneret er gated bag admin-preview via `app_config`-flag indtil Tally-URL flippes ([#364](https://github.com/NicolaiDolmer/CyclingZone/issues/364) sprint uge 1 ons/tor). Fjern whitelist-entry når banner går live for alle.

## Lessons

1. **Auto-migrate's filename-format er load-bearing.** Manuel intervention skal matche eksakt eller skabe beskidt state.
2. **Idempotente migrations gemte os.** Hvis migrationen havde `ALTER TABLE ADD COLUMN` (ikke `IF NOT EXISTS`), ville 2. run have fejlet med "column already exists" og lavet et synligt incident i stedet for stille bookkeeping-drift.
3. **Audit-bot virker som intended.** Den fangede driften 2 dage efter den opstod via ugentlig cron — uden den ville recorden ligget undetected.
