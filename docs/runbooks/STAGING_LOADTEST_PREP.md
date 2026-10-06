# Staging-klargøring til load-test-gaten (#5904)

Ejer-beslutning A (4/10): Claude Code klargør Supabase-branchen `staging-cutover`
(ref `pywxpnynzmbukdvoiazp`) til load-testen. Prod (`ghwvkxzhsbbltzfnuhhz`) skrives aldrig;
prod er kun læst for schema og størrelses-estimater. Denne side er afleveringen: hvad der er
klar, hvad der er bevist, og hvad der stadig blokerer.

## Status 5/10 (målt)

| Område | Status |
|---|---|
| Schema = prod | **Klar.** App-schemaet er identisk med prod på alle 8 objekttyper (bevis nedenfor). |
| Sideeffekt-isolation, værktøj | **Klar.** Rent-miljø-wrapper og fail-closed isolationstjek findes og er testet. |
| Sideeffekt-isolation, data | **Blokeret.** Staging er stadig en prod-kopi fra 23/8. Den indeholder DB-gemte Discord-webhooks, rigtige e-mails og auth-brugere. Isolationstjekket stopper derfor enhver backend-kørsel. |
| Volumen i prod-størrelse | **Blokeret.** Branchens disk og compute kan ikke rumme 1,8 mio. resultatrækker (se "Kapacitet"). |
| Fuld pinned S4-løbsdag | **Ikke bygget.** Staging har S3-strukturen: 15 seniorpuljer og ingen U23/junior-grupper. |
| #6170-prerequisites | `BLOCKED`, kun på `RESULT_VOLUME_TOO_SMALL`. De tre schema-prober består. |

**Konklusion:** load-testen kan ikke køres endnu. Schemadelen er løst. De tre blokeringer
nedenfor kræver ejer-handling eller ejer-go.

## 1. Schema-identitet

**Sådan blev det gjort:** De 155 manglende `database/2026-*.sql`-migrationer blev anvendt på
staging i prods egen `applied_at`-rækkefølge. Rækkefølgen er læst read-only fra prods
`schema_migrations`, og scriptet er `scripts/staging/apply-staging-migrations.ps1`.

- 3 data-reparationer fejlede, fordi stagings data er fra 23/8, og blev ikke registreret:
  `2026-08-24-4203-monumenter-ud-af-gt-vinduer.sql`, `2026-08-24-4203-rollback-monument-byttet.sql`
  og `2026-09-01-4377-jersey-wins-cumulative-repair.sql`. De skaber kun backup-tabeller og
  data-rettelser, ikke app-schema.
- CRLF: migrationerne blev anvendt fra et Windows-checkout, så 79 funktionskroppe fik `\r`.
  `scripts/staging/normalize-crlf-functions.sql` rettede dem. Apply-scriptet LF-normaliserer
  nu selv, og `scripts/staging/.gitattributes` holder SQL-filerne LF.
- `race_entry_days_rebuild`: prods krop er den samme logik, men uden kommentarer.
  `scripts/staging/schema-drift-fixups.sql` gør den byte-identisk.

**Bevis:** `scripts/staging/schema-fingerprint.sql` laver én række pr. objekt med md5 af
definitionen. Den køres mod staging. Resumé-varianten `schema-fingerprint-summary.sql` køres
read-only mod prod. `backend/scripts/staging/schemaFingerprint.mjs compare` gav
`identical: true`:

| Type | Antal (begge) | md5 (begge) |
|---|---|---|
| table | 177 | `8e4af0a6…` |
| constraint | 696 | `0691d6e8…` |
| index | 526 | `6cb45d6f…` |
| function | 126 | `9ecdf04a…` |
| policy | 242 | `1c4087be…` |
| trigger | 38 | `4c5cdf20…` |
| view | 5 | `0267ec01…` |
| matview | 5 | `866c097b…` |

Backup-klassen er bevidst udeladt: navne med `backup` eller `_snapshot_2026`, ad hoc
data-kopier fra prod-reparationer. Prod har 89 og staging 59. De listes som `backup_table`,
så forskellen forbliver synlig. Extensions, `auth`, `storage` og `cron` er ikke dækket af
fingeraftrykket. Staging har 0 pg_cron-jobs og 0 `public`-triggere, der kalder pg_net.

## 2. Volumen pr. tabel

Prod er pg_class-estimater fra 5/10. Staging er præcise counts fra 5/10.

| Tabel | Prod (est.) | Staging |
|---|---|---|
| race_results | 1.865.119 | 0 |
| riders | 18.000 | 6.698 |
| hold, menneske / AI (aktive) | 272 / 140 | 219 / 9 |
| league_divisions | 35 (15 senior, 10 U23, 10 junior) | 15 (kun senior) |
| race_entries | 183.748 | 70.328 |
| race_entry_days | 186.527 | 546 |
| race_stage_profiles | 4.483 | 3.356 |
| race_day_participation | 40.434 | 0 |
| training_day_runs | 30.768 | 0 |
| training_rider_ticks | 256.233 | 0 |
| training_date_work | 1.578 | 0 |
| rider_training_scores | 346.539 | 0 |
| training_plans | 10.533 | 7.073 |

`scripts/staging/synthesize-race-results.sql` er generatoren til resultatvolumen. Den bruger
deterministisk syntetisk historik fra stagings egne løb, entries og trupper, uden prod-data.
Den laver én transaktion pr. løb, er idempotent og kan genoptages. Med
`pinned_season = S3` og `pinned_day = 14` dækker den 1.121 løb. Rækkeantallet er estimeret
til cirka 1,9 mio. ud fra felter × etaper × resultattyper; det er ikke målt.
Kørslen blev afbrudt (se "Kapacitet"), så staging har stadig 0 rækker.

## 3. Kapacitet (blokering, kræver ejer)

Målt 5/10: Den første generator-kørsel var én statement over hele mængden. Ved cirka 733 MB
databasestørrelse genstartede branchens postmaster ("crash of another server process"), og
databasen gik i read-only. Transaktionen rullede tilbage, og bloat blev ryddet med
`VACUUM FULL` (tilbage på 151 MB, read-only er slået fra igen). Prods `race_results` alene
fylder 1.326 MB, og hele prod-databasen fylder cirka 4 GB. Branchens disk/compute rummer det
ikke. Det samme ramte refresh-staging 23/8 ("No space left on device" ved cirka 1 GB).

**Ejer-valg:** forstør branchens disk (og helst compute til prod-niveau, så målingen er
retvisende) i Supabase-dashboardet. Det koster penge. Kør derefter generatoren igen.

## 4. Sideeffekt-isolation

**Indgang:** Den ENESTE tilladte indgang til at køre backend-kode mod load-test-staging er:

```powershell
pwsh -File scripts/staging/with-loadtest-staging.ps1 -Cwd backend node <script> <args>
```

- Infisical bruges ikke. Child-processen starter med et tomt miljø plus OS-basis plus
  staging-credentials fra Supabase CLI (`Set-StagingEnv`). Resend-, Discord-, Alunta-
  (betaling), Sentry- og LLM-nøgler findes derfor ikke i processen.
  `scripts/with-staging.ps1` (generalprøven) loader prod-Infisical og blanker kun en liste.
- `Staging-Guard.ps1` stopper, medmindre ref, origin og DB-URL er staging, og ingen
  variabel nævner prod-ref'en.
- `backend/scripts/staging/assertLoadtestIsolation.mjs` kører FØR kommandoen og stopper
  (exit 1), hvis en sideeffekt-nøgle findes i miljøet, eller hvis staging-DB'en har
  Discord-webhooks i `discord_settings`, ikke-tomme outbox-tabeller, ikke-syntetiske e-mails
  eller Discord-id'er i `users`, eller mangler markøren `app_config.cz_environment`.
  Den printer kun faste koder.

**Målt 5/10:** wrapperen giver `BLOCKED`: `DB_DISCORD_WEBHOOKS_PRESENT`,
`DB_REAL_EMAILS_IN_USERS`, `DB_DISCORD_IDS_IN_USERS` og `DB_ENV_MARKER_MISSING`. Ingen
miljø-blockers. Det er korrekt fail-closed. Staging har 20 DB-gemte webhook-URL'er fra prod,
og `getResultWebhooks` læser dem, så en motor-kørsel ville poste i de rigtige Discord-kanaler.

**Rensning (kræver ejer-go):** Claude Codes auto-mode afviste kørslen som masse-sletning:
`scripts/staging/anonymize-staging.sql` trunkerer kanaler, brugerindhold, betaling og logs
samt backup-tabellernes data. Den anonymiserer `public.users` og menneske-holdenes navne og
sætter miljø-markøren. Udskiftning af `auth.users` med syntetiske test-brugere er heller ikke
lavet, og læsning af auth-schemaet blev også afvist. Efter ejer-go køres:

```powershell
. ./scripts/lib/Staging-Env.ps1; Set-StagingEnv
. ./scripts/staging/Staging-Guard.ps1; Assert-LoadtestStagingTarget
psql $env:STAGING_DB_URL -f scripts/staging/anonymize-staging.sql
```

**Motor/scheduler:** tændes KUN i stagings `app_config` (`race_engine_v2`/`stage_scheduler`)
og kun efter grønt isolationstjek. Prod-flag røres aldrig.

## 5. Kommandoen til målingen (Codex)

Når 3 og 4 er løst og generatoren er kørt:

```powershell
. ./scripts/lib/Staging-Env.ps1; Set-StagingEnv
node scripts/loadtest/check-staging-prerequisites.mjs --min-results 1865119   # #6170, forventet DATA_PREREQUISITES_READY
pwsh -File scripts/staging/with-loadtest-staging.ps1 -Cwd . node scripts/loadtest/<målescript>.mjs
```

Målescriptet er Codex' (#5904/#6136), og det skal køre gennem wrapperen. Den pinned
løbsdag er i dag kun mulig som **S3 game day 14, senior**. En fuld S4-dag med alle
senior/U23/junior-puljer kræver, at S4-strukturen bygges på staging (punkt 6).

## 6. Udestående

1. **Ejer-go: rensning** (`anonymize-staging.sql`) og syntetiske `auth.users`.
2. **Ejer-valg: disk/compute** på branchen. Kør derefter `synthesize-race-results.sql`.
3. **S4-struktur på staging:** U23-/junior-grupper (`seedYouthPools.js`), AI-ungdomstrupper
   (`generateYouthSquadsS4.js`), S4-kalender pr. trup (`buildSeasonCalendar.js --squad`),
   entries (`generateSeasonEntries.js`) og træningsdata. Alt gennem wrapperen, efter 1 og 2.
4. Genmål tabellerne ovenfor, og kør #6170 og fingeraftrykket igen.

## Genskab beviserne

```powershell
pwsh -File scripts/staging/apply-staging-migrations.ps1 -DryRun     # forventet: pending=0
. ./scripts/lib/Staging-Env.ps1; Set-StagingEnv
psql $env:STAGING_DB_URL -tA -f scripts/staging/schema-fingerprint.sql > fp-staging.txt
# prod: kør scripts/staging/schema-fingerprint-summary.sql read-only (Supabase MCP execute_sql), gem som linjer
node backend/scripts/staging/schemaFingerprint.mjs compare prod-summary.txt fp-staging.txt
```
