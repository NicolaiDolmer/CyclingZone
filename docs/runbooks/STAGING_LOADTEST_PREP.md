# Staging-klargøring til load-test-gaten (#5904)

Ejer-beslutning A (4/10): Claude Code klargør Supabase-branchen `staging-cutover`
(ref `pywxpnynzmbukdvoiazp`) til load-testen. Prod (`ghwvkxzhsbbltzfnuhhz`) skrives aldrig;
prod er kun læst for schema og størrelses-estimater. Denne side er afleveringen: hvad der er
klar, hvad der er bevist, og hvad der stadig blokerer.

## Status 10/10 (målt)

| Område | Status |
|---|---|
| Schema = prod | **Klar.** Fingeraftrykket matcher prod på alle app-kategorier (genmålt 5/10 efter refresh). |
| Sideeffekt-isolation | **Klar.** Ny prod-kopi 5/10, renset; wrapperen giver `ISOLATED` (genmålt 10/10). |
| Volumen i prod-størrelse | **Blokeret.** Staging 1.889.644 resultatrækker mod prods katalogestimat 1.931.805 (7/10). |
| Fuld pinned S4-løbsdag | **Værktøj klar:** `scripts/loadtest/race-day-sim.mjs` (afsnit 5). Ikke kørt, fordi volumen blokerer. |
| #6170-prerequisites | `BLOCKED`, kun på `RESULT_VOLUME_TOO_SMALL`. Schema-proberne består. |

**Konklusion:** load-testen kan ikke godkendes endnu. Den sidste blokering er volumen.
Afsnit 1-4 nedenfor er historikken fra klargøringen 5/10.

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

### Fail-closed refresh (#6229)

`scripts/refresh-staging.ps1` er kun "gjort", når alle tre gates er bestået. Ingen af dem kan
springes over, heller ikke med `-VerifyOnly` eller `-SkipDump`.

1. **Atomisk import:** `psql --single-transaction -v ON_ERROR_STOP=1` kører rækkefølgen guard
   (replica-rolle, ingen timeouts), `auth.users`, public-schema og data, og til sidst rensning.
   Et fejltrin eller en afbrudt forbindelse ruller alt tilbage. Rensningen kører med triggere
   slukket, så den ikke selv skaber nye outbox- eller notifikationsrækker. Filrækkefølgen og
   at ingen fil indeholder `begin`/`commit` kontrolleres før start.
2. **Gates efter importen:** (a) schema-fingeraftryk skal matche prod (backup-klassen undtaget),
   (b) rækketal for `riders`, `teams`, `races`, `race_results`, `board_profiles`, `app_config`
   og `auth_users` skal ligge mellem prods tal før og efter dumpet (LEAN undtager
   `race_results`; `app_config` må have én ekstra række til miljø-markøren), (c) antal ikke-anonyme
   brugere i `public.users` og `auth.users` skal være præcis 0. (c) er altid det sidste
   databasekald.
3. **`-SkipDump`:** kræver dump-markøren og de to optællinger fra samme dump. Mangler en,
   stopper scriptet. Et nyt dump rydder først gammelt bevis, så et afbrudt dump aldrig genbruges.

Fejltekst fra psql filtreres, så kun `ERROR`/`FATAL`-linjer med maskerede nøgleværdier og
e-mails vises (DETAIL og CONTEXT kan indeholde rækkedata). Gates er unit-testet i
`scripts/refresh-staging.test.mjs` (kører i CI). Selve restore'en mod en database er ikke
testet; det kræver et ejer-godkendt forsøg.

## 5. Fuld løbsdag: `race-day-sim.mjs`

Kør fra en PowerShell-session i worktree-roden (kald scriptet med `&`; `pwsh -File ... --`
fra en anden shell sender ikke `--flag`-argumenterne videre, målt 10/10):

```powershell
& ./scripts/staging/with-loadtest-staging.ps1 -Cwd . -- node scripts/loadtest/race-day-sim.mjs `
  --clock 2026-10-06T00:00:00+02:00 --season 4 --min-results <frisk prod-estimat> `
  --viewer-token-file <sti uden for repoet>
```

Scriptet nægter at køre uden wrapperen (`CZ_LOADTEST_WRAPPER`). Det gentager isolationstjekket
og #6170-prerequisites selv og stopper ved første fejl, før noget job starter. Exit 0 kun når
`loadTestPassed` er true; ellers exit 1 (2 ved forkerte argumenter). Rapporten skrives altid til
`docs/snapshots/5904/race-day-<tid>.md` med commit-SHA, faser, blockers og oracles. Løb vises som
aliaser (R01 ...), aldrig id'er eller navne.

**Før en kørsel (alt på staging, intet på prod):**

1. **Volumen:** `--min-results` er prods `pg_class`-estimat for `race_results`, målt read-only
   samme dag. Ingen default og ingen tolerance; scriptet sænker aldrig grænsen. En relativ
   tolerance kræver et ejer-go (kort i PR'en for #5904). Top-up er kun tilladt på staging
   (`scripts/staging/synthesize-race-results.sql`).
2. **Flag i stagings `app_config`:** `stage_scheduler_enabled`, `race_engine_v2` og `auto_prize`
   skal være tændt. Scriptet læser dem og skriver aldrig flag. Øvrige flag
   (fx `training_tick_per_race_day`) sættes som i prod; rapporten viser ikke deres værdi.
3. **Pinned dag:** første S4-dag der ikke er kørt på staging. Planen stopper ved forfaldne
   etaper før uret, en halv afslutning (`finalize_state`), allerede kørte slots, scheduler-runs
   siden dagens midnat (daglig cap) eller en trup uden slots (senior, U23 og junior skal alle have).
4. **Spiller-token:** JWT for én syntetisk staging-bruger i en fil uden for repoet, udstedt af
   staging-Auth og gyldig mindst 30 minutter. En fuld dag tager længere: hæv stagings JWT-levetid
   eller brug et frisk token, ellers tæller 401'ere i normalfasen som fejl. Commit aldrig filen.
5. **Lokalt:** `psql` på PATH (DB-forbindelser, låse og IO pr. fase) og ingen `.env` i
   `backend/` eller repo-roden (dotenv ville genindføre fjernede nøgler).

**Hvad den gør:** tick-gitteret fra `backend/lib/schedulerTick.js` over vinduet `--clock` til
næste dansk midnat plus en times opsamling. Hvert tick kalder `runStageScheduler` med
`now` = tick-tidspunktet og den rigtige `runAdminSimulateStage` (Discord-besked = null), derefter
auto-præmie, aftentræningens dags-lukning og ranglistens refresh. Backendens HTTP-flade
(`server.js`, cron blokeret af `cronRuntimeGuard`) kører i samme proces, og samtidige læsere
henter ranglister og kalender med tokenet.

**Faser og accept (ejer 2/10):**

| Fase | Hvad sker | Accept |
|---|---|---|
| normal | hele dagen uden fejl | 0 5xx (backend og Supabase), 0 lock-/statement-timeouts, 0 tick-fejl, etaperesultater kan læses straks efter tick'et, ranglister klar inden 5 min (inkl. 1 min cron-ventetid) |
| fault_auth | Auth utilgængelig i processen (`--fault-ticks`, default 3 ticks) | hvert spillerkald entydigt 503 med samme kode, 0 × 200 (en cache må ikke autorisere), 0 × 401 |
| fault_db | REST/RPC utilgængelig | som ovenfor; scheduleren må ikke efterlade en halv afvikling |
| restart_recovery | næste afvikling afbrydes efter resultat-skrivning og trin-markering, derefter genstart (ny klient, ny dedup) | løbet genoptages inden claim-leasen + 2 ticks, uden dobbelt afvikling |

Alle faser: max URL ≤ 8 KB (UTF-8 bytes), og RAM (RSS), proces-IO, CPU, DB-forbindelser,
ventende låse og DB-IO er målt. **Oracles:** præcis én `race_simulation_runs` pr. planlagt slot,
præmie sat for hvert afsluttet løb, ingen dobbelte præmie-/sponsorrækker eller
bestyrelses-hændelser pr. (løb, hold), ingen `finalize_state` tilbage, og resultat-antallet
uændret fra første læsning til slut. Mangler en fase eller en måling, er `loadTestPassed` false.

**Efter en kørsel:** dagen er brugt på staging (etaperne er afviklet). En ny kørsel kræver den
næste uafviklede dag eller en frisk refresh.

## 6. Udestående

1. **Volumen:** top-up på staging til mindst prods friske estimat, eller ejer-go på en relativ
   tolerance.
2. Kør `race-day-sim.mjs` (afsnit 5) og gem rapporten i `docs/snapshots/5904/`.

## Genskab beviserne

```powershell
pwsh -File scripts/staging/apply-staging-migrations.ps1 -DryRun     # forventet: pending=0
. ./scripts/lib/Staging-Env.ps1; Set-StagingEnv
psql $env:STAGING_DB_URL -tA -f scripts/staging/schema-fingerprint.sql > fp-staging.txt
# prod: kør scripts/staging/schema-fingerprint-summary.sql read-only (Supabase MCP execute_sql), gem som linjer
node backend/scripts/staging/schemaFingerprint.mjs compare prod-summary.txt fp-staging.txt
```
