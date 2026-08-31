# ADR: Klassificering af `rls_enabled_no_policy`-tabeller (Phase C, #528)

**Status:** Klassificering afsluttet for alle 101 tabeller (9 + 66 + 26) - INGEN migration, INGEN `COMMENT ON TABLE`, INGEN policy tilføjet, INGEN grants ændret. Ét fund kræver ejerens go før videre handling (se "Fund der kræver ejer-go" nedenfor).
**Date:** 2026-08-30 (de 9 + backup-bucket, #4439), udvidet samme dato med de 26 driftstabeller (#4440).
**Owner:** Claude (klassificering), Nicolai Dolmer (skal godkende evt. policy- eller grant-ændring).
**Issue:** [#528](https://github.com/NicolaiDolmer/CyclingZone/issues/528) - Phase C-opfølgning til [#525](https://github.com/NicolaiDolmer/CyclingZone/issues/525) (Phase A) og [#527](https://github.com/NicolaiDolmer/CyclingZone/issues/527) (Phase B). Tredje bucket: [#4440](https://github.com/NicolaiDolmer/CyclingZone/issues/4440).

---

## Resumé

`rls_enabled_no_policy`-advisoren er vokset markant siden #528 blev skrevet:

| Tidspunkt | Antal tabeller |
|---|---|
| Issue oprettet | 6 |
| Kommentar 16/6 | 9 |
| **Denne kørsel (`get_advisors`, type `security`, project `ghwvkxzhsbbltzfnuhhz`, 2026-08-30, read-only)** | **101** |

De **9 oprindeligt navngivne** tabeller (`board_consequences`, `board_request_log`, `import_log`, `schema_migrations`, `team_board_members`, `team_dna`, `discord_dm_outbox`, `rider_development_log`, `signup_attribution`) er stadig uklassificerede og udokumenterede — ingen `COMMENT ON TABLE` er nogensinde tilføjet for nogen af dem.

Væksten fra 9 til 101 skyldes primært (men ikke udelukkende) engangs-backup/snapshot-tabeller fra senere oprydningsscripts (#2259-mønstret). Se "Tredje bucket" nedenfor for en vigtig nuance: framingen "de øvrige ca. 92 er alle backup-tabeller" holder **ikke helt** ved verifikation - 26 af de 92 er ikke backup-tabeller. De 26 er klassificeret enkeltvis i #4440, så alle 101 nu er dækket: 9 + 66 + 26.

---

## Metode

1. `get_advisors(type=security)` via Supabase MCP mod `ghwvkxzhsbbltzfnuhhz` — read-only, ingen anden SQL kørt.
2. For hver af de 9 navngivne tabeller: `grep` for `.from("<table>")` i `backend/` og `frontend/src/` (både enkelt- og dobbeltcitat), samt for RPC-kald og migrations-filer, for at afgøre hvem der rent faktisk læser/skriver tabellen i dag.
3. Krydstjek mod [`database/proposals/2026-08-05-2830-write-grants-lockdown.sql`](../../database/proposals/2026-08-05-2830-write-grants-lockdown.sql) — en **ikke-anvendt, ejer-review-pending** migration fra en uafhængig, bredere audit (#2830) af write-grants på ALLE 133 daværende public-tabeller. Den audit klassificerede allerede (2026-08-05, live-verificeret) alle 9 tabeller som del af "99 tabeller UDEN legitim klient-skrivesti" — samme konklusion denne klassificering når frem til ad en anden vej (kode-læsning fremfor grant-inspektion). To uafhængige metoder der lander samme sted er stærkere end én.

4. **Udvidelsen til de 26 (#4440, samme dato):** samme grep-metode pr. tabel, plus en read-only `execute_sql`-måling af (a) at RLS faktisk er enabled med 0 policies for hver af de 26, og (b) hvilke `anon`/`authenticated`-grants hver tabel bærer (`information_schema.role_table_grants`). Grant-målingen kom med fordi #4440's triage viste at grants ikke er ensartede på tværs af de 101, og en tabel med `GRANT ALL` men nul policies har en anden risikoprofil end en helt uden grants.

**Vigtig mekanisk pointe for hele denne klassificering:** Backend bruger ÉT centralt `supabase`-objekt instantieret med `SUPABASE_SERVICE_KEY` (`backend/routes/api.js:660-663`, kommentar "Supabase admin client"). Service-role bruger `BYPASSRLS` — RLS-status (herunder "ingen policies") er derfor **irrelevant** for al backend-kode, uanset hvor mange `.from(...)`-kald der findes i `backend/lib/*.js`. Det eneste der betyder noget for om `rls_enabled_no_policy` er et reelt problem, er: **findes der noget sted et direkte klient-kald (frontend `supabase.from(...)` med anon/authenticated-nøgle) mod tabellen?** Når RLS er enabled og der ingen policies findes, afviser Postgres ALLE rækker for enhver rolle uden `BYPASSRLS` — også `SELECT` — uanset eventuelle table-level grants. Det er derfor konservativt sikkert by default; spørgsmålet er udelukkende om det også er *funktionelt korrekt* (dvs. om nogen reelt har brug for klient-adgang der i dag fejler stille).

---

## De 9 oprindelige tabeller

### `board_consequences` — Bevidst default-deny

- **Skriv:** `backend/lib/boardConsequences.js:462,487,540,591,639` (insert), `backend/lib/betaResetService.js:317` (beta-reset-oprydning).
- **Læs:** `backend/lib/boardConsequences.js:130-142,707-794` (interne helpers), `backend/lib/economyEngine.js:267,466` (sponsor-pullout-modifier i engine).
- **Route-lag:** `backend/routes/api.js:9322,9557` — begge via det centrale service-role-objekt.
- **Frontend:** ingen `.from("board_consequences")` nogen steder i `frontend/src/`. `BoardPage.jsx:1379` og patch-note-tekst refererer kun til data der allerede er hentet via backend-API'et (`BoardConsequencesPanel`), ikke en direkte Supabase-query.
- **Historik:** `frontend/src/data/patchNotes.js:21962` dokumenterer at #284 allerede undersøgte netop denne tabel (sammen med `board_request_log` og `team_board_members`) og fandt den "milestone-gated tomme. Ikke broken." — tomhed/manglende direkte adgang er tidligere verificeret som forventet, ikke en fejl.
- **Korroboreret:** `database/proposals/2026-08-05-2830-write-grants-lockdown.sql:185`.

### `board_request_log` — Bevidst default-deny

- **Skriv:** `backend/routes/api.js:15523` (insert ved board-request), `backend/lib/betaResetService.js:315` (beta-reset).
- **Læs:** `backend/routes/api.js:14586` (board-historik-panel), `backend/routes/api.js:15404` (seneste request pr. sæson).
- **Frontend:** ingen `.from("board_request_log")`. Samme #284-verifikation som `board_consequences` (patchNotes.js:21962).
- **Korroboreret:** `write-grants-lockdown.sql:186`.

### `import_log` — Bevidst default-deny

- **Skriv:** `backend/lib/pcmResultsImport.js:555` og `backend/lib/prizePayoutEngine.js:284` (audit-insert efter hhv. PCM-resultat-import og prize-payout-bølge). `backend/routes/api.js:13314` (nulstiller `imported_by`-FK ved bruger-sletning).
- **Læs:** **ingen** — hverken backend eller frontend selecter nogensinde fra `import_log`. Der findes ikke et admin-dashboard der viser import-historikken i dag.
- **Nuance i forhold til issuets oprindelige gæt** ("Admin-read? Service-write?"): der er intet admin-read implementeret. Tabellen er i praksis en ren write-only audit-trail. Hvis et admin-UI til at vise import-historik bygges senere, følger det samme mønster som resten af appen (backend-endpoint med service-role), ikke en direkte klient-RLS-policy.
- **Korroboreret:** `write-grants-lockdown.sql:189`.

### `schema_migrations` — Systemtabel

- Oprettet af `database/2026-05-04-schema-migrations-table.sql`. Hver migrationsfil under `database/2026-*.sql` indeholder sin egen `INSERT INTO schema_migrations`-linje, kørt af migrations-runneren (`auto-migrate.yml`/manuel psql-lignende kørsel) med `postgres`-rollen — ikke supabase-js med anon/authenticated-nøgle.
- Læses kun af `backend/scripts/audit-feature-liveness.js:375,685` (drift-detektion: "er denne migration committed men ikke applied i prod") og af diverse lint-scripts (`scripts/lint-migration-idempotency.mjs`, `scripts/lint-sql-strings.mjs`) som statisk tekst-reference, ikke runtime-query.
- Ingen frontend-reference overhovedet (kun `database.types.ts`, auto-genereret).
- Spørgsmålet "skal en klient kunne læse/skrive dette" giver ikke mening for en migrations-bogføringstabel — samme kategori som issuets eget gæt.
- **Korroboreret:** figurerer også i `write-grants-lockdown.sql:195` (samme "ingen legitim klient-sti"-konklusion, om end af en anden grund end de øvrige 8).

### `team_board_members` — Bevidst default-deny

- **Skriv:** `backend/lib/boardMembers.js:151,171,189,279,660,717,723` (tildeling/opdatering af board-medlemmer), `backend/lib/betaResetService.js:316` (beta-reset).
- **Læs:** `backend/routes/api.js:14544` — henter 5 board-medlemmer for teamet, eksponeret til frontend via API-response, ikke direkte query.
- **Frontend:** ingen `.from("team_board_members")`.
- **Nuance i forhold til issuets oprindelige gæt** ("Authenticated read for eget team?"): dette er allerede implementeret — men via en autoriseret backend-route (session-check + `team_id`-scoping i Express-laget), IKKE via en RLS-policy på en direkte klient-query. Appen bruger konsekvent dette mønster for board-relaterede tabeller (samme som `board_consequences`/`board_request_log`). En RLS-policy ville være en ekstra, overflødig adgangssti til noget der allerede er korrekt scopet i et andet lag.
- **Historik:** samme #284-verifikation (patchNotes.js:21962).
- **Korroboreret:** `write-grants-lockdown.sql:198`.

### `team_dna` — Bevidst default-deny (og reelt ubrugt i dag)

- Tabellen er en DB-seed af de 5 håndlavede DNA-arketyper fra `database/2026-05-05-board-club-dna.sql`. Kildekoden i `backend/lib/boardClubDna.js:22` dokumenterer eksplicit: "Persistens: data lever både her (kode-sandhed) og i `team_dna`-tabellen (DB-seed ... engines læser herfra for hurtig adgang" — hvor "herfra" er JS-konstanten `BOARD_CLUB_DNA`, ikke DB-tabellen.
- **Verificeret: ingen `.from("team_dna")` findes noget sted i hverken `backend/` eller `frontend/src/`.** Al DNA-logik (forslag, valg, alignment-score) kører på den håndlavede JS-konstant. `teams.team_dna_key`/`teams.team_dna_chosen_at` (kolonner på `teams`-tabellen, ikke `team_dna`) er det der faktisk læses/skrives (`backend/routes/api.js:14442,14534,15098`).
- **Nuance i forhold til issuets oprindelige gæt** ("Authenticated read for eget team?"): der er intet kald overhovedet mod `team_dna`-tabellen i den nuværende kodebase — hverken fra backend eller frontend. Den er i praksis dormant. Det gør "bevidst default-deny" til en triviel sandhed her (ingen kan finde ud af at læse den, endsige et uautoriseret angreb), men rejser et separat, mindre spørgsmål: er tabellen overflødig og kan renses op? Det ligger uden for #528's scope og flages her udelukkende til orientering — ikke handlet på i denne PR.
- **Korroboreret:** `write-grants-lockdown.sql:199`.

### `discord_dm_outbox` — Bevidst default-deny

- **Skriv/læs/slet:** udelukkende `backend/lib/discordDmOutbox.js:51,94,121,132,147` (outbox-pattern for Discord-DM-levering, forbrugt af cron i `backend/cron.js`, se kommentar linje 439) og `backend/lib/discordDmDelivery.js`/`backend/lib/discordNotifier.js`.
- **Frontend:** ingen reference overhovedet ud over auto-genererede typer.
- **Korroboreret:** `write-grants-lockdown.sql:187`.

### `rider_development_log` — Bevidst default-deny

- **Læs:** `backend/lib/riderProgressionEngine.js:100` (idempotens-guard: hvilke ryttere er allerede udviklet denne sæson).
- **Skriv:** sker IKKE via et direkte `.from(...).insert(...)`, men via den `SECURITY DEFINER`-RPC `apply_rider_development` (`database/2026-07-20-rider-development-atomic-rpc.sql`), kaldt fra `backend/lib/riderProgressionEngine.js:253` med service-role-klienten. Migrationsfilen dokumenterer eksplicit at RPC'en har "eksplicit REVOKE fra anon/authenticated/PUBLIC" på selve `EXECUTE`-privilegiet — dobbelt-lukket, både RLS-tomhed på tabellen og RPC-exec-revoke.
- **Frontend:** ingen reference.
- **Korroboreret:** `write-grants-lockdown.sql:194`.

### `signup_attribution` — Bevidst default-deny

- **Skriv:** `backend/routes/api.js:8579` (upsert ved signup, fire-and-forget, service-role).
- **Læs:** `backend/routes/api.js:8670,8702,8708` (attribution-dashboard-aggregering), `backend/lib/fairplayFlagsCron.js:474` (cron-batch-læsning til fairplay-korrelation).
- **Frontend:** `frontend/src/pages/AdminAttributionPage.jsx` viser attribution-data, men henter det via backend-API'et (`attributionDashboard.js`), ikke direkte Supabase-query. Ingen `.from("signup_attribution")` i `frontend/src/`.
- **Korroboreret:** `write-grants-lockdown.sql:197`.

### Fordeling

| Kategori | Tabeller |
|---|---|
| Bevidst default-deny | `board_consequences`, `board_request_log`, `import_log`, `team_board_members`, `team_dna`, `discord_dm_outbox`, `rider_development_log`, `signup_attribution` (8) |
| Systemtabel | `schema_migrations` (1) |
| Mangler policy (reelt fund) | 0 |
| Kan ikke afgøres | 0 |

**Ingen af de 9 tabeller er et reelt sikkerhedshul.** Alle 9 har enten (a) udelukkende backend/service-role-adgang i dag, verificeret ved udtømmende grep mod både `backend/` og `frontend/src/`, eller (b) er en migrations-bogføringstabel hvor spørgsmålet ikke giver mening. To af dem (`board_consequences`, `board_request_log`, `team_board_members` — faktisk tre) er allerede eksplicit gennemgået tidligere i #284. Én af dem (`team_dna`) er reelt ubrugt af nogen kodesti i dag.

Ingen af de 9 kræver derfor et ejer-go for en policy-tilføjelse — men se "Tredje bucket" nedenfor for et fund der GØR kræve opmærksomhed, om end ikke fra de 9 oprindelige.

---

## De ~66 backup/snapshot-mønster-tabeller — én samlet vurdering

66 af de 101 tabeller følger et klart engangs-snapshot-mønster: filnavn/tabelnavn indeholder enten `backup_`-præfiks eller et dato-/issue-stempel (`_20260628`, `_3591_backup_20260813`, `_type_backfill_snapshot_20260805` osv.), fx `backup_fairplay_2221_20260706_teams`, `rider_caps_3591_backup_20260813`, `backup_race_results_2103_20260702`.

**Vurdering: bevidst default-deny, ingen handling nødvendig.** Disse er alle engangs-punkt-i-tiden-kopier taget af oprydnings-/data-reparations-scripts (samme mønster som #2259 dokumenterer) forud for en destruktiv operation, bevaret som rollback-sikkerhedsnet. De:

- oprettes altid direkte i databasen af et engangs-script, aldrig af applikationskoden (`backend/`/`frontend/`),
- læses/skrives aldrig af hverken backend eller frontend efter oprettelse — de er "frosne" historiske snapshots,
- er allerede inkluderet i den fulde REVOKE-liste i `write-grants-lockdown.sql:169-202` (kategori "99 tabeller UDEN legitim klient-skrivesti").

En `COMMENT ON TABLE` pr. tabel ville være ren støj for 66 engangs-artefakter. Hvis/når disse tabeller ryddes op (jf. #2259-opfølgning), forsvinder advisor-varslet for dem automatisk sammen med tabellen — det er den rigtige løsning, ikke dokumentation.

---

## Tredje bucket: de 26 driftstabeller - klassificeret enkeltvis ([#4440](https://github.com/NicolaiDolmer/CyclingZone/issues/4440))

Den antagelse denne opgave startede med - "de øvrige ca. 92 er `backup_*`-snapshot-tabeller" - holdt kun delvist ved verifikation. Af de 92 tabeller der hverken er blandt de 9 navngivne eller reelt backup/snapshot-mønster, er:

- **66** faktisk backup/snapshot-mønster (afsnittet ovenfor).
- **26** ordinære, løbende drifts-/log-tabeller uden dato-stempel-navngivning, aldrig nævnt i #528 eller nogen tidligere RLS-gennemgang.

#4439 flagede de 26 uden at klassificere dem. #4440 lukker hullet: alle 26 er nu gennemgået enkeltvis med samme metode som de 9.

### Måling (30/8 2026, kl. 23:05 CEST, read-only)

`execute_sql` mod `ghwvkxzhsbbltzfnuhhz` (ren `SELECT` mod `pg_class`/`pg_policy`/`information_schema.role_table_grants`, ingen skrivning):

| Kontrol | Resultat |
|---|---|
| Af de 26: RLS enabled | 26/26 |
| Af de 26: antal policies | 0 for alle 26 |
| Sum-tjek | 9 (enkeltvis, #528/#4439) + 66 (backup-bucket) + 26 (denne sektion) = **101** |

**Grants er ikke ensartede.** Triage-kommentaren på #4440 fremhævede `email_log` som den tabel der mangler `anon`-grant. Målingen her viser at billedet er bredere: **7** af de 26 har slet ingen grant til hverken `anon` eller `authenticated`, **8** har kun `SELECT`, og **11** bærer stadig Supabases default `GRANT ALL` (inkl. `INSERT`/`UPDATE`/`DELETE`). Grant-tallet er derfor noteret pr. tabel nedenfor.

| Grant-mønster (anon + authenticated identisk i alle 26) | Antal | Tabeller |
|---|---|---|
| Fuld CRUD (`SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER`) | 11 | `academy_intake_ticks`, `academy_season_intake_runs`, `ai_recovery_runs`, `board_satisfaction_events`, `discord_webhook_outbox`, `matview_refresh_heartbeat`, `rider_derived_ability_history`, `scout_sweep_runs`, `season_form_reset_runs`, `traffic_events`, `training_slot_health_daily` |
| Kun `SELECT` | 8 | `board_mandates`, `board_relations`, `board_vision_milestones`, `race_entry_days`, `race_stage_claims`, `rider_ownership_events`, `season_end_claims`, `value_transition_preview` |
| Ingen grant overhovedet | 7 | `discord_race_digest_log`, `email_log`, `growth_metric_snapshots`, `market_value_level_correction_apply_log`, `market_value_level_correction_gate_log`, `market_value_sunday_sweep_log`, `player_feedback` |

**Det afgørende resultat af kode-gennemgangen:** der findes **nul** direkte klient-queries mod nogen af de 26. Udtømmende grep for `"<tabel>"` og `'<tabel>'` i hele `frontend/src/` gav kun tre hits, alle i den auto-genererede `frontend/src/types/database.types.ts`: `board_mandates:3858`, `board_vision_milestones:3865`, `market_value_level_correction_apply_log:5495`. Et bredere, citat-frit grep tilføjer `race_entry_days:6059` fra samme genererede fil. Alle fire er typedefinitioner, ikke kald. Ingen `supabase.from(...)` med anon/authenticated-nøgle rører nogen af dem. Al adgang går enten gennem backendens service-role-klient (`backend/routes/api.js:660-663`) eller gennem DB-funktioner.

### De 26

#### `academy_intake_ticks` - Bevidst default-deny
- **Grants:** fuld CRUD.
- **Skriv/læs:** `backend/lib/academyIntakePull.js:87,126` (claim + upsert i søndags-drippet), `backend/lib/sundayIntakeTick.js:81` (claim-først-idempotens pr. hold og søndagsdato), `backend/scripts/seasonStartScorecard.js:378` (scorecard-læsning), `backend/scripts/dev/compensationIntake3576.mjs:193,248,316` (engangs-kompensation, #3576).
- **Frontend:** ingen forekomst i `frontend/src/`.

#### `academy_season_intake_runs` - Bevidst default-deny
- **Grants:** fuld CRUD.
- **Skriv/læs:** `backend/lib/seasonAcademyIntake.js:185` - egen claim-tabel (PK `team_id, season_id`) for sæsonskiftets akademi-indtag, dokumenteret på `:13`.
- **Frontend:** ingen forekomst.

#### `ai_recovery_runs` - Bevidst default-deny
- **Grants:** fuld CRUD.
- **Skriv/læs:** `backend/lib/aiRecoverySweep.js:47,58,175` (claim + bogføring af AI-holdenes recovery-sweep).
- **Frontend:** ingen forekomst.

#### `board_mandates` - Bevidst default-deny
- **Grants:** kun `SELECT`.
- **Skriv/læs:** `backend/lib/boardMandateEngine.js:260`; seed i `backend/scripts/dev/mandateMigration3514.mjs:379`. `backend/lib/seasonCarryOver.js:122` dokumenterer at tabellen er tom og ulæst indtil kill-switchen `board_mandate_model_enabled` flippes.
- **Frontend:** kun genereret typedefinition `frontend/src/types/database.types.ts:3858`, intet kald.

#### `board_relations` - Bevidst default-deny
- **Grants:** kun `SELECT`.
- **Skriv/læs:** `backend/lib/boardMandateEngine.js:189,229`; seed i `backend/scripts/dev/mandateMigration3514.mjs:368`.
- **Frontend:** ingen forekomst. Samme familie som `board_consequences`/`board_request_log`/`team_board_members` blandt de 9.

#### `board_satisfaction_events` - Bevidst default-deny
- **Grants:** fuld CRUD.
- **Skriv:** `backend/lib/boardMandateEngine.js:237`, `backend/lib/boardWeekendFinalization.js:346,441`; seed i `backend/scripts/dev/mandateMigration3514.mjs:417`.
- **Læs:** `backend/routes/api.js:14689` - bestyrelses-visningen henter den gennem en autoriseret backend-route, ikke en klient-query.
- **Frontend:** ingen forekomst.

#### `board_vision_milestones` - Bevidst default-deny
- **Grants:** kun `SELECT`.
- **Skriv/læs:** ingen kodesti læser den. `backend/lib/boardMandateFlag.js:6` konstaterer det ordret ("`board_vision_milestones` læses ikke af nogen kodesti"). Oprettes i `database/2026-08-18-3514-mandate-model.sql`, seedes af `backend/scripts/dev/mandateMigration3514.mjs`. `backend/lib/seasonCarryOver.js:122` forklarer hvorfor den bevidst ikke er sæson-scopet.
- **Frontend:** kun genereret typedefinition `frontend/src/types/database.types.ts:3865`.

#### `discord_race_digest_log` - Bevidst default-deny
- **Grants:** ingen (hverken `anon` eller `authenticated`).
- **Skriv/læs:** `backend/lib/discordRaceDigestSweep.js:79,89` (dedup-bogføring for løbs-digest til Discord).
- **Frontend:** ingen forekomst.

#### `discord_webhook_outbox` - Bevidst default-deny
- **Grants:** fuld CRUD.
- **Skriv/læs:** `backend/lib/discordWebhookOutbox.js:92,140,173,199,225` (insert, plukning, sletning ved leveret). Samme outbox-mønster som `discord_dm_outbox` blandt de 9.
- **Frontend:** ingen forekomst.

#### `email_log` - Bevidst default-deny
- **Grants:** ingen. Verificeret ved `SET LOCAL ROLE anon; SELECT ... FROM email_log` → `42501 permission denied` (triage-måling 30/8).
- **Skriv/læs:** `backend/lib/emailService.js:136` (dedupe-opslag), `:146,165,191` (log-insert pr. afsendelse), `backend/lib/emailRetrySweep.js:79,113,130,153,166` (retry-sweep).
- **Frontend:** ingen forekomst. Tabellen indeholder modtager-adresser og hører til det snævreste grant-billede i hele bucket'en, hvilket er det korrekte niveau.

#### `growth_metric_snapshots` - Bevidst default-deny
- **Grants:** ingen.
- **Skriv:** DB-funktionen i `database/2026-08-03-growth-snapshots-3196.sql:247`, kaldt fra cron (`backend/cron.js:1579`).
- **Læs:** `backend/routes/api.js:8889` (`GET /admin/growth/snapshots`, `requireAdmin`). Intentionaliteten står allerede eksplicit i koden på `backend/routes/api.js:8871`: "growth_metric_snapshots er service_role-only (RLS uden policies ...)".
- **Frontend:** `AdminGrowthPage` henter via backend-routen; ingen forekomst af tabelnavnet i `frontend/src/`.

#### `market_value_level_correction_apply_log` - Bevidst default-deny
- **Grants:** ingen.
- **Skriv/læs:** `backend/scripts/marketValueLevelCorrectionApply.js:316` (bogføring af niveau-korrektionens apply-kørsel).
- **Frontend:** kun genereret typedefinition `frontend/src/types/database.types.ts:5495`.

#### `market_value_level_correction_gate_log` - Bevidst default-deny
- **Grants:** ingen.
- **Skriv/læs:** tilgås gennem en konstant, ikke en literal, hvilket er grunden til at et naivt `grep from("...")` ikke finder den: `backend/lib/marketValueLevelCorrectionGate.js:40` (`LEVEL_CORRECTION_GATE_LOG_TABLE`), brugt på `:240,252` og i `backend/scripts/marketValueLevelCorrectionApply.js:141`. Oprettes i `database/2026-08-19-3449-level-correction-gate.sql`.
- **Frontend:** ingen forekomst.

#### `market_value_sunday_sweep_log` - Bevidst default-deny
- **Grants:** ingen.
- **Skriv/læs:** samme konstant-mønster: `backend/lib/marketValueSundaySweep.js:67` (`MARKET_VALUE_SWEEP_LOG_TABLE`), brugt på `:152,167`. Oprettes i `database/2026-08-06-3448-market-value-sweep.sql`. Dedup pr. `sweep_date` (UNIQUE), jf. kommentaren på `:25`.
- **Frontend:** ingen forekomst.

#### `matview_refresh_heartbeat` - Systemtabel
- **Grants:** fuld CRUD.
- **Skriv/læs:** `backend/lib/refreshRankingMatviews.js:69` (heartbeat efter refresh), `backend/lib/stallWatchdog.js:391` (stall-detektion). Ren drifts-/observability-bogføring uden spilindhold - samme kategori som `schema_migrations` blandt de 9.
- **Frontend:** ingen forekomst.

#### `player_feedback` - Bevidst default-deny
- **Grants:** ingen.
- **Skriv:** `backend/routes/api.js:13915` - spilleren indsender gennem en `requireAuth`-route der validerer og trunkerer felterne serverside; klienten skriver aldrig direkte.
- **Læs:** `backend/lib/feedbackInbox.js:97,144,168,213,241` (admin-indbakke).
- **Frontend:** ingen forekomst. Tabellen indeholder `user_agent` og `user_id`; default-deny plus manglende grant er det rigtige niveau.

#### `race_entry_days` - Bevidst default-deny (DB-vedligeholdt afledning)
- **Grants:** kun `SELECT`.
- **Skriv/læs:** ingen klientkode og ingen backend-`.from(...)` rører den. Tabellen oprettes og vedligeholdes udelukkende i databasen: `database/2026-08-24-4173-rider-binding-per-game-day.sql:55` (tabel), `:82` og `:115` (funktionen `public.race_entry_days_rebuild(uuid, uuid)` der sletter og genopbygger). `backend/lib/raceBinding.js:119` forholder sig kun til dens UNIQUE-constraint i fejloversættelsen. `backend/lib/seasonCarryOver.js:105-107` klassificerer den eksplicit som "ren afledning af `race_entries` × `race_stage_schedule`".
- **Frontend:** kun genereret typedefinition `frontend/src/types/database.types.ts:6059`.

#### `race_stage_claims` - Bevidst default-deny
- **Grants:** kun `SELECT`.
- **Skriv/læs:** `backend/lib/adminSimulateRace.js:50,60,78,94` (claim pr. etape så to samtidige simulerings-kald ikke kører samme etape).
- **Frontend:** ingen forekomst.

#### `rider_derived_ability_history` - Bevidst default-deny
- **Grants:** fuld CRUD.
- **Skriv:** `backend/lib/dailyTrainingEngine.js:583`, `backend/lib/riderProgressionEngine.js:292` (daglige snapshots).
- **Læs:** `backend/routes/api.js:1319` (`GET /riders/:id/development`, `requireAuth`) og `:1346` (værdi-trend). Kommentaren umiddelbart over kaldet kalder den ordret "samme RLS-lukkede kilde som Udvikling-fanen" - intentionaliteten er allerede skrevet ned i koden. Analyse-scripts: `backend/scripts/fitMarketValueModelV1.js:389`, `backend/scripts/fitMarketValueModelV2.js:565`.
- **Frontend:** ingen forekomst; Udvikling-fanen går gennem routen. Bemærk at fog-gaten (#2499) netop afhænger af at klienten IKKE kan læse tabellen direkte - en policy her ville åbne modellens komponenter.

#### `rider_ownership_events` - Bevidst default-deny
- **Grants:** kun `SELECT`.
- **Skriv/læs:** `backend/lib/riderOwnershipAudit.js:77` (append-only audit-spor for ejerskifte).
- **Frontend:** ingen forekomst.

#### `scout_sweep_runs` - Bevidst default-deny
- **Grants:** fuld CRUD.
- **Skriv/læs:** `backend/lib/scoutSweep.js:72` (claim/bogføring pr. sweep-kørsel).
- **Frontend:** ingen forekomst.

#### `season_end_claims` - Bevidst default-deny
- **Grants:** kun `SELECT`.
- **Skriv/læs:** `backend/routes/api.js:924` (`claimSeasonEndOrReject` - UNIQUE-claim der afviser dobbelt-POST med 409 før den irreversible sæson-slut-bearbejdning), `backend/lib/betaResetService.js:552` (beta-reset-oprydning), `backend/scripts/endSeasonS2.mjs:111`.
- **Frontend:** ingen forekomst.

#### `season_form_reset_runs` - Bevidst default-deny
- **Grants:** fuld CRUD.
- **Skriv/læs:** `backend/lib/seasonFormReset.js:192,257` (claim + bogføring af formnulstilling ved sæsonskifte).
- **Frontend:** ingen forekomst.

#### `traffic_events` - Bevidst default-deny
- **Grants:** fuld CRUD. Værd at bemærke: `anon` har `INSERT` her, hvilket er den mest interessante grant i hele bucket'en (se fund nedenfor).
- **Skriv:** `backend/routes/api.js:8729` (`POST /collect`, best-effort; IP og user-agent hashes serverside til `visit_hash`, aldrig lagret rå).
- **Slet:** `backend/cron.js:1012` (retention-oprydning).
- **Frontend:** ingen forekomst - telemetrien POSTer til backend-routen, ikke til Supabase.

#### `training_slot_health_daily` - Bevidst default-deny
- **Grants:** fuld CRUD.
- **Skriv/læs:** `backend/lib/trainingSlotHealthWatch.js:103,132` (daglig sundhedsmåling af træningsslots).
- **Frontend:** ingen forekomst.

#### `value_transition_preview` - Bevidst default-deny
- **Grants:** kun `SELECT`.
- **Skriv:** `backend/scripts/buildValueTransitionPreview.js:152,159` (upsert pr. rytter).
- **Læs:** `backend/routes/api.js:12655` (`GET /admin/value-transition`, `requireOwner`) - ejer-only preview af S3-lønninger, netop det stik modsatte af noget en spillerklient skal kunne læse.
- **Frontend:** ingen forekomst.

### Fordeling (de 26)

| Kategori | Antal | Tabeller |
|---|---|---|
| Bevidst default-deny | 25 | alle undtagen `matview_refresh_heartbeat` |
| Systemtabel | 1 | `matview_refresh_heartbeat` |
| Mangler policy (reelt fund) | 0 | - |
| Kan ikke afgøres | 0 | - |

**Ingen af de 26 er et sikkerhedshul, og ingen af dem mangler en policy.** Konklusionen er den samme som for de 9, og hviler på det samme mekaniske forhold: alle 26 tilgås udelukkende af backendens service-role-klient (`BYPASSRLS`) eller af DB-funktioner, og ingen frontend-kodesti laver en direkte `supabase.from(...)` mod dem. RLS-med-nul-policies er derfor ikke bare sikkert, det er også funktionelt korrekt - der findes ingen stille fejlende klient-adgang at rette op på.

### Samlet regnskab for alle 101

| Bucket | Antal | Hvor klassificeret |
|---|---|---|
| Navngivne i #528 | 9 | "De 9 oprindelige tabeller" ovenfor (#4439) |
| Backup/snapshot-mønster | 66 | "De ~66 backup/snapshot-mønster-tabeller" ovenfor (#4439) |
| Driftstabeller | 26 | denne sektion (#4440) |
| **Sum** | **101** | = advisorens tal målt 30/8 |

### Forward-guard

Fejlklassen #4440 rettede op på var ikke en forkert klassificering - den var en **manglende** en, gemt bag et regnestykke der gik op. #4439 nævnte de 26 tabeller ved navn, summerede korrekt til 101, og klassificerede ingen af dem. Dokumentet så færdigt ud.

`scripts/check-rls-classification-coverage.mjs` (kørt i CI, jobbet `rls-classification-guard`) lukker den sti mekanisk: hver tabel der nævnes i grant-mønster-tabellen ovenfor SKAL have sin egen `#### `tabelnavn``-sektion, og hver sektion SKAL indeholde mindst én `fil:linje`-reference eller den eksplicitte konstatering af at ingen kodesti rører tabellen. Guarden tjekker også at bucket-tallene matcher antallet af navne i cellerne, at ingen tabel står i to grant-buckets, og at "Samlet regnskab" summer. Den er ren dokument-intern konsistens uden DB-adgang, så den kører på enhver PR. Selvtest: `node --test scripts/check-rls-classification-coverage.test.mjs`.

---

## Fund der kræver ejer-go

### Mangler policy

**Ingen - hverken blandt de 9 eller de 26.** Ved verifikation viste ingen af de 9 oprindelige tabeller sig at være i kategorien "mangler policy" (en klient burde kunne læse/skrive, og fraværet er en fejl). To af issuets oprindelige gæt (`team_board_members`, `team_dna`: "Authenticated read for eget team?") viste sig ved kode-læsning at være allerede-løst-på-anden-vis snarere end et hul - adgangen findes, men går gennem en autoriseret backend-route, ikke en RLS-policy. Samme resultat for alle 26 driftstabeller: nul direkte klient-queries, altså intet der fejler stille.

Hvis dette billede ændrer sig — fx hvis en fremtidig feature skal læse `team_dna` eller `import_log` direkte fra frontend med `supabase.from(...)` — er det på det tidspunkt et nyt, isoleret policy-behov, og skal behandles som en selvstændig sikkerhedsændring i prod (ejer-gated, jf. `AGENTS.md` hard rule 9), ikke retroaktivt via denne klassificering.

### Grant-observation fra #4440 (ikke et hul i dag, men værd at beslutte)

Målingen af de 26 fandt **11 tabeller der stadig bærer Supabases default `GRANT ALL` til `anon` og `authenticated`** - inklusive `INSERT`, `UPDATE` og `DELETE`:

`academy_intake_ticks`, `academy_season_intake_runs`, `ai_recovery_runs`, `board_satisfaction_events`, `discord_webhook_outbox`, `matview_refresh_heartbeat`, `rider_derived_ability_history`, `scout_sweep_runs`, `season_form_reset_runs`, `traffic_events`, `training_slot_health_daily`.

**Det er ikke et hul i dag.** RLS er enabled med nul policies på alle 11, og Postgres afviser derfor hver eneste række for enhver rolle uden `BYPASSRLS`, uanset grants. Grantet er kun det yderste lag i en to-lags forsvarsopstilling hvor det inderste lag holder.

Men opstillingen har kun ét virksomt lag. Slås RLS nogensinde fra på en af de 11 - ved et uheld, under en fejlsøgning, eller af et fremtidigt script - går tabellen direkte fra "helt lukket" til "enhver anonym bruger kan skrive i den". `traffic_events` er det skarpeste eksempel: `anon` har `INSERT`, og tabellen fodres i forvejen af et offentligt `POST /collect`-endpoint.

Den rigtige rettelse er at tilbagekalde de overflødige grants, og den er **allerede skrevet**: `database/proposals/2026-08-05-2830-write-grants-lockdown.sql` (#2830) gør præcis det, men er ikke anvendt og afventer ejer-review. **Fundet kræver ejerens go** og hører hjemme i #2830/#2901, ikke i denne klassificering. Intet er ændret her.

---

## Hvad der IKKE er gjort i denne PR

Ingen migration. Ingen `COMMENT ON TABLE`. Ingen policy. Ingen ændring af grants - heller ikke i #4440-udvidelsen, hvor grants udelukkende er **målt** og noteret. Denne fil er ren dokumentation af et allerede-verificeret, allerede-sikkert nulpunkt - formålet er udelukkende at fjerne den fremtidige tvetydighed advisoren selv beskriver ("ser ud som om nogen glemte det"), ikke at ændre databasens adfærd.

---

## When to re-evaluate

1. Hvis en af de 101 tabeller får et fremtidigt behov for direkte klient-adgang - behandl som en ny, isoleret RLS-policy-tilføjelse, ejer-gated.
2. Hvis `team_dna`-tabellen fortsat er ubrugt om nogle måneder - overvej et separat oprydnings-issue (drop eller dokumentér som bevidst dobbelt-kilde). Samme spørgsmål gælder `board_vision_milestones`, der efter #4440-gennemgangen heller ikke læses af nogen kodesti.
3. Når #2259-oprydningen kører de 66 backup/snapshot-tabeller væk — denne dokumentation kan trimmes tilsvarende.
4. Når advisor-tallet næste gang ændrer sig fra 101 - mål buckets forfra (9 + 66 + 26 skal stadig summe), og klassificér tilvæksten med samme metode: grep for `.from(...)` og RPC i `frontend/src/` + `backend/`, plus en grant-måling pr. tabel. Bemærk fælden: to af de 26 (`market_value_level_correction_gate_log`, `market_value_sunday_sweep_log`) tilgås gennem en eksporteret konstant, ikke en literal, så et rent `grep from("<tabel>")` melder dem falsk som ubrugte.
5. Når #2830 (`write-grants-lockdown.sql`) prioriteres - de 11 tabeller med `GRANT ALL` fra "Grant-observation fra #4440" ovenfor er allerede dækket af den migrations forslag; genmål grants bagefter og opdatér tabellen her.

---

## References

- [#528](https://github.com/NicolaiDolmer/CyclingZone/issues/528) - denne klassificerings-opgave (Phase C), de 9 navngivne tabeller.
- [#4440](https://github.com/NicolaiDolmer/CyclingZone/issues/4440) - tredje bucket: klassificering af de 26 driftstabeller, inkl. grant-måling pr. tabel.
- [`scripts/check-rls-classification-coverage.mjs`](../../scripts/check-rls-classification-coverage.mjs) - forward-guard der holder denne fil intern-konsistent (CI-job `rls-classification-guard`).
- [#525](https://github.com/NicolaiDolmer/CyclingZone/issues/525) — Phase A (security hardening, live i prod 2026-05-20).
- [#527](https://github.com/NicolaiDolmer/CyclingZone/issues/527) — Phase B (`rls_policy_always_true`).
- [#2830](https://github.com/NicolaiDolmer/CyclingZone/issues/2830) / [`database/proposals/2026-08-05-2830-write-grants-lockdown.sql`](../../database/proposals/2026-08-05-2830-write-grants-lockdown.sql) - uafhængig, bredere write-grants-audit der korroborerer klassificeringen af alle 9 tabeller, og som også er den rigtige placering for de 11 `GRANT ALL`-tabeller fundet i #4440 (ikke anvendt endnu, ejer-review-pending).
- [#2259](https://github.com/NicolaiDolmer/CyclingZone/issues/2259) — oprindelig kilde til backup/snapshot-tabel-mønstret.
- [#284](https://github.com/NicolaiDolmer/CyclingZone/issues/284) — tidligere verifikation af `board_consequences`/`board_request_log`/`team_board_members` som "milestone-gated tomme, ikke broken" (`frontend/src/data/patchNotes.js:21962`).
- [`docs/decisions/2026-05-22-rls-behavioral-vs-structural-guard.md`](2026-05-22-rls-behavioral-vs-structural-guard.md) — søster-ADR om RLS-verifikationsmetode.
- Supabase advisor-remediation: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
