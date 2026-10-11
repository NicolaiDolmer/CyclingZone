# #6487 dry-run: doed `deadline-day`-raekke i `cron_checkins`

**Status: DRY-RUN. Intet er slettet. Sletning kraever ejer-go (prod-data).**

## Hvad

`deadline-day`-cronen blev fjernet med vilje i #6259. Rækken i `cron_checkins` står tilbage.
Den er ikke i `backend/lib/cronMonitorRegistry.js` (55 monitorer, `deadline-day` = false) og ikke i
`scripts/ci/cron-source-map.json`.

## Effekt i dag

Ingen funktionel effekt. Rækken bliver aldrig læst som bevis eller alarm:

- `scripts/ci/cron-deploy-verification.mjs` filtrerer på registry-slugs (`job_slug=in.(...)`).
- `runCronHeartbeatSweepCron` (`backend/lib/cronHeartbeat.js`) itererer kun over `ALL_CRON_MONITORS`.

Sletningen er altså ren oprydning. Den blokerede ikke merge-køen 11/10 (se #6487).

## Aflæsning (read-only, 2026-10-11 15:25:52 UTC)

```sql
select job_slug, last_checkin_at, expected_cadence_seconds, updated_at, now() as observed_at
from cron_checkins
where last_checkin_at < now() - interval '2 days' or job_slug = 'deadline-day'
order by job_slug;
```

| job_slug | last_checkin_at | expected_cadence_seconds | updated_at |
|---|---|---|---|
| deadline-day | 2026-10-06 17:03:10.757+00 | 300 | 2026-10-06 17:03:10.757+00 |

Én række. Ingen andre check-ins er ældre end 2 døgn.

## Sletning ved ejer-go (præcis én række)

Afgrænset til slug + den observerede tidsstempel, så den aldrig rammer en genoplivet cron.
Idempotent: kører den igen, sletter den 0 rækker.

```sql
delete from cron_checkins
where job_slug = 'deadline-day'
  and last_checkin_at = '2026-10-06 17:03:10.757+00'
returning job_slug, last_checkin_at;
```

Forventet: 1 række returneret. Efterkontrol:

```sql
select count(*) from cron_checkins where job_slug = 'deadline-day';  -- forventet 0
```

Fortrydelse (hvis nødvendigt):

```sql
insert into cron_checkins (job_slug, last_checkin_at, expected_cadence_seconds, updated_at)
values ('deadline-day', '2026-10-06 17:03:10.757+00', 300, '2026-10-06 17:03:10.757+00');
```
