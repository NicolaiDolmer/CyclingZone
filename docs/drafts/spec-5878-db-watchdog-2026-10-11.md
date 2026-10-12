# Spec-udkast #5878: DB-vagt (tiltag 5, alarm når DB hænger)

Status: **ejer-valg A (10/10), bygget i `.github/workflows/db-watchdog.yml` + `scripts/ops/db-watchdog.mjs`.** B tages op efter 14 dage med A.
Afvigelser fra udkastet: tilstand ligger i Actions-cache (ikke gist). Sentry-delen er et Cron Monitor check-in pr. kørsel (aktiveres af secret `SENTRY_DSN`); et separat Sentry-event ved alarm er ikke bygget, fordi Discord-ops + monitoren dækker det. Nye secrets ejeren skal oprette: `DISCORD_OPS_WEBHOOK_URL`, `SUPABASE_PUBLISHABLE_KEY` (valgfri: `DISCORD_OPS_MENTION`, `SENTRY_DSN`).
Baggrund: `docs/audits/2026-10-11-5878-supabase-udfald.md`. 6/10 frøs databasen i 21 min (13:21-13:42 UTC), og ejeren opdagede det selv. Eksisterende vagter kører kun ugentligt (`db-health.yml`) og dagligt (`supabase-log-watch.yml`).

## Mål

1. Ejeren får besked på Discord-ops inden for ca. 10 min, når databasen hænger eller er nede.
2. Alle genstarter registreres, også de der løser sig selv på 1-3 min (1/10, 2/10, 6/10 kl. 11:00 UTC). Lige nu findes de kun, hvis nogen leder i loggen.
3. Vagten må aldrig selv belaste databasen mærkbart (de tunge kald var en del af problemet).

## Hvad vagten måler (fælles for A og B)

| Check | Hvordan | Fejl når |
|---|---|---|
| Backend-readiness | `GET /health/ready` på Railway (`backend/lib/healthRoutes.ts:42`, 3 s DB-timeout, svarer 503 ved DB-fejl) | ikke 200, eller ikke svar inden 10 s |
| PostgREST direkte | `HEAD /rest/v1/app_config?select=key&limit=1` med publishable key | 5xx eller timeout 10 s. Skiller "DB/PostgREST nede" fra "Railway nede" |
| Genstart-markør | `select pg_postmaster_start_time()` via `SUPABASE_DB_URL` med `connect_timeout=5` og `statement_timeout=5s` | værdien er ændret siden sidste kørsel |

Tilstand (sidste postmaster-start, antal fejl i træk, tid for sidste alarm) gemmes i en Actions-cache-nøgle eller en lille gist. **Ikke** i prod-databasen, fordi den skal kunne læses, mens databasen er nede.

Alarmregel: 2 fejlede kørsler i træk (ca. 10 min) gør at der sendes én besked til Discord-ops plus et Sentry-event. Når tjekket er grønt igen, sendes én "oppe igen"-besked med varighed. Genstart-markør: én besked med gammel og ny starttid, også selvom alt er grønt nu.

## Valgkort

**A: Probe + alarm (anbefalet 👍)**
Det der står ovenfor. Ingen automatisk handling.
- Gevinst: ejeren får besked inden for ca. 10 min i stedet for at opdage det selv; alle genstarter bliver talt; ingen risiko for prod.
- Omkostning: ejeren skal stadig genstarte selv ved frysning (6/10: dashboard-genstart).
- Byg: 1 workflow + 1 lille script, ingen migration.

**B: A + automatisk genstart 👎 (ikke nu)**
Som A, men ved 3 fejl i træk (ca. 15 min) og hvis PostgREST også fejler: `POST /v1/projects/{ref}/restart` via Management API. Højst én pr. time og aldrig hvis `auto-migrate.yml` kører.
- Gevinst: frysning som 6/10 er løst efter ca. 15 min uden ejeren.
- Omkostning: en automatisk genstart kan ramme midt i en migration eller en crash-recovery der er ved at blive færdig, og gøre det værre. Skriveadgang til prod-infrastruktur fra CI. Strider mod reglen om at store prod-indgreb kræver ejer-go pr. skridt.
- Anbefaling: tag B op igen, når A har kørt i 14 dage og vi kender antallet af falske alarmer.

**C: Kun Supabase' egen overvågning 👎**
Supabase-dashboardets rapporter plus metrics-endpoint (Prometheus) koblet til en ekstern Grafana-alarm.
- Gevinst: RAM- og swap-kurver, som vi i dag ikke kan måle (hukommelse er kun antaget som årsag).
- Omkostning: en ny tjeneste at passe; en ny secret uden for Infisical-flowet. Om Supabase har indbygget alarm på "DB svarer ikke" på vores plan: ingen evidens, ikke tjekket.
- Kan bygges senere, oven på A, hvis RAM-målinger bliver nødvendige.

## Actions-cron eller Railway-proces?

| | GitHub Actions cron (anbefalet) | Proces i Railway-backenden |
|---|---|---|
| Uafhængighed | kører uden for Railway og Supabase; opdager også "Railway nede" | dør sammen med backenden; en backend der crashlooper pga. DB alarmerer ikke |
| Kadence | min. 5 min; GitHub forsinker eller dropper planlagte kørsler i spidser | 1 min, præcis |
| Omkostning | gratis (offentligt repo) | et ekstra interval i hver replika; risiko for dobbelte alarmer |
| Secrets | `SUPABASE_DB_URL` og `SENTRY_AUTH_TOKEN` findes; **`DISCORD_OPS_WEBHOOK_URL` findes ikke som GitHub-secret** og skal sættes (ejer, fra Infisical) | findes allerede i Railway (`backend/lib/opsWebhook.js`) |

Valg: Actions-cron `*/5 * * * *`. Mod at GitHub dropper kørsler: hver kørsel sender et Sentry Cron Monitor check-in. Udebliver det i 15 min, sender Sentry selv en alarm. Det fanger også, at vagten selv er død.

## Filer (ved byg, efter ejer-valg)

- `.github/workflows/db-watchdog.yml`: cron hvert 5. min + `workflow_dispatch`, `concurrency: db-watchdog`, `timeout-minutes: 3`.
- `scripts/ops/db-watchdog.mjs`: de 3 checks, tilstand, alarmregel; genbrug payload-formen fra `backend/lib/opsWebhook.js` (`withOpsMention`).
- `scripts/ops/db-watchdog.test.mjs`: alarmregel (2 i træk, "oppe igen", genstart-markør, ingen gentagne alarmer).
- Ingen migration, ingen ændring i backend.

## Risiko

- Falske alarmer ved Railway-deploy (container-start ca. 1-2 min). Afbødning: 2 fejl i træk; deploy-vinduet er kortere end 10 min.
- `pg_postmaster_start_time`-forbindelsen bruger én forbindelse hvert 5. min. Det er ubetydeligt ved 120 max og 60 i brug.
- Vagten belaster ikke DB med tunge kald: 1 `HEAD`-kald + 1 skalar-`select` pr. kørsel.

## Verifikation

1. `workflow_dispatch` med en forkert URL giver alarm efter 2 kørsler og "oppe igen" bagefter.
2. Første rigtige genstart bliver registreret (sammenlign med `pg_postmaster_start_time` manuelt).
3. Sentry Cron Monitor viser grønne check-ins hvert 5. min i 24 t.
