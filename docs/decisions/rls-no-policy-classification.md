# ADR: Klassificering af `rls_enabled_no_policy`-tabeller (Phase C, #528)

**Status:** Klassificering afsluttet — INGEN migration, INGEN `COMMENT ON TABLE`, INGEN policy tilføjet i denne PR. Ét fund kræver ejerens go før videre handling (se "Fund der kræver ejer-go" nedenfor).
**Date:** 2026-08-30
**Owner:** Claude (klassificering), Nicolai Dolmer (skal godkende evt. policy-tilføjelse).
**Issue:** [#528](https://github.com/NicolaiDolmer/CyclingZone/issues/528) — Phase C-opfølgning til [#525](https://github.com/NicolaiDolmer/CyclingZone/issues/525) (Phase A) og [#527](https://github.com/NicolaiDolmer/CyclingZone/issues/527) (Phase B).

---

## Resumé

`rls_enabled_no_policy`-advisoren er vokset markant siden #528 blev skrevet:

| Tidspunkt | Antal tabeller |
|---|---|
| Issue oprettet | 6 |
| Kommentar 16/6 | 9 |
| **Denne kørsel (`get_advisors`, type `security`, project `ghwvkxzhsbbltzfnuhhz`, 2026-08-30, read-only)** | **101** |

De **9 oprindeligt navngivne** tabeller (`board_consequences`, `board_request_log`, `import_log`, `schema_migrations`, `team_board_members`, `team_dna`, `discord_dm_outbox`, `rider_development_log`, `signup_attribution`) er stadig uklassificerede og udokumenterede — ingen `COMMENT ON TABLE` er nogensinde tilføjet for nogen af dem.

Væksten fra 9 til 101 skyldes primært (men ikke udelukkende) engangs-backup/snapshot-tabeller fra senere oprydningsscripts (#2259-mønstret). Se "Tredje bucket" nedenfor for en vigtig nuance: framingen "de øvrige ca. 92 er alle backup-tabeller" holder **ikke helt** ved verifikation — 26 af de 92 er ikke backup-tabeller.

---

## Metode

1. `get_advisors(type=security)` via Supabase MCP mod `ghwvkxzhsbbltzfnuhhz` — read-only, ingen anden SQL kørt.
2. For hver af de 9 navngivne tabeller: `grep` for `.from("<table>")` i `backend/` og `frontend/src/` (både enkelt- og dobbeltcitat), samt for RPC-kald og migrations-filer, for at afgøre hvem der rent faktisk læser/skriver tabellen i dag.
3. Krydstjek mod [`database/proposals/2026-08-05-2830-write-grants-lockdown.sql`](../../database/proposals/2026-08-05-2830-write-grants-lockdown.sql) — en **ikke-anvendt, ejer-review-pending** migration fra en uafhængig, bredere audit (#2830) af write-grants på ALLE 133 daværende public-tabeller. Den audit klassificerede allerede (2026-08-05, live-verificeret) alle 9 tabeller som del af "99 tabeller UDEN legitim klient-skrivesti" — samme konklusion denne klassificering når frem til ad en anden vej (kode-læsning fremfor grant-inspektion). To uafhængige metoder der lander samme sted er stærkere end én.

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

## Tredje bucket: 26 tabeller der IKKE er backup-tabeller (fund uden for oprindelig scope)

Den antagelse denne opgave startede med — "de øvrige ca. 92 er `backup_*`-snapshot-tabeller" — holder kun delvist ved verifikation. Af de 92 tabeller der hverken er blandt de 9 navngivne eller reelt backup/snapshot-mønster, er:

- **66** faktisk backup/snapshot-mønster (ovenfor).
- **26** er IKKE backup-tabeller. De er ordinære, løbende drifts-/log-tabeller uden dato-stempel-navngivning, aldrig nævnt i #528 eller nogen tidligere RLS-gennemgang:

```
academy_intake_ticks              board_vision_milestones           rider_derived_ability_history
academy_season_intake_runs        discord_race_digest_log           rider_ownership_events
ai_recovery_runs                  discord_webhook_outbox            scout_sweep_runs
board_mandates                    email_log                         season_end_claims
board_relations                   growth_metric_snapshots           season_form_reset_runs
board_satisfaction_events         market_value_level_correction_apply_log   traffic_events
                                   market_value_level_correction_gate_log    training_slot_health_daily
                                   market_value_sunday_sweep_log             value_transition_preview
                                   matview_refresh_heartbeat
                                   player_feedback
                                   race_entry_days
                                   race_stage_claims
```

Flere af disse ligner strukturelt de 9 oprindelige (fx `board_mandates`, `board_relations`, `board_satisfaction_events`, `board_vision_milestones` — samme board-system-familie som `board_consequences`/`board_request_log`/`team_board_members`, oprettet efter #528 blev skrevet, jf. `database/2026-08-18-3514-mandate-model.sql`). Andre er nyere log-/audit-tabeller (`email_log`, `discord_webhook_outbox`, `traffic_events`, `player_feedback`).

**Denne PR klassificerer IKKE disse 26 individuelt** — det var ikke en del af opgavens scope (9 navngivne + backup-bucket), og en forsvarlig klassificering kræver samme kode-læsning pr. tabel som ovenfor, ikke et gæt ud fra navnemønstre. De flages her udelukkende for at undgå at "92 = alle backups" bliver stående som en unøjagtig antagelse i beslutningsloggen. **Anbefaling:** et opfølgende issue der udvider #528-metoden til disse 26, når den prioriteres — ikke et sikkerhedshul (samme RLS-default-deny-mekanik beskytter dem i dag), men udokumenteret intentionalitet på samme måde som de oprindelige 9 var.

---

## Fund der kræver ejer-go

**Ingen.** Ved verifikation viste ingen af de 9 oprindelige tabeller sig at være i kategorien "mangler policy" (en klient burde kunne læse/skrive, og fraværet er en fejl). To af issuets oprindelige gæt (`team_board_members`, `team_dna`: "Authenticated read for eget team?") viste sig ved kode-læsning at være allerede-løst-på-anden-vis snarere end et hul — adgangen findes, men går gennem en autoriseret backend-route, ikke en RLS-policy.

Hvis dette billede ændrer sig — fx hvis en fremtidig feature skal læse `team_dna` eller `import_log` direkte fra frontend med `supabase.from(...)` — er det på det tidspunkt et nyt, isoleret policy-behov, og skal behandles som en selvstændig sikkerhedsændring i prod (ejer-gated, jf. `AGENTS.md` hard rule 9), ikke retroaktivt via denne klassificering.

---

## Hvad der IKKE er gjort i denne PR

Ingen migration. Ingen `COMMENT ON TABLE`. Ingen policy. Ingen ændring af grants. Denne PR er ren dokumentation af et allerede-verificeret, allerede-sikkert nulpunkt — formålet er udelukkende at fjerne den fremtidige tvetydighed advisoren selv beskriver ("ser ud som om nogen glemte det"), ikke at ændre databasens adfærd.

---

## When to re-evaluate

1. Hvis en af de 9 tabeller (eller de 26 i tredje bucket) får et fremtidigt behov for direkte klient-adgang — behandl som en ny, isoleret RLS-policy-tilføjelse, ejer-gated.
2. Hvis `team_dna`-tabellen fortsat er ubrugt om nogle måneder — overvej et separat oprydnings-issue (drop eller dokumentér som bevidst dobbelt-kilde).
3. Når #2259-oprydningen kører de 66 backup/snapshot-tabeller væk — denne dokumentation kan trimmes tilsvarende.
4. Hvis nogen prioriterer de 26 tabeller i tredje bucket — brug samme metode (grep for `.from(...)` i frontend+backend, RPC-kald, korrelér med `write-grants-lockdown.sql`) som denne fil demonstrerer.

---

## References

- [#528](https://github.com/NicolaiDolmer/CyclingZone/issues/528) — denne klassificerings-opgave (Phase C).
- [#525](https://github.com/NicolaiDolmer/CyclingZone/issues/525) — Phase A (security hardening, live i prod 2026-05-20).
- [#527](https://github.com/NicolaiDolmer/CyclingZone/issues/527) — Phase B (`rls_policy_always_true`).
- [#2830](https://github.com/NicolaiDolmer/CyclingZone/issues/2830) / [`database/proposals/2026-08-05-2830-write-grants-lockdown.sql`](../../database/proposals/2026-08-05-2830-write-grants-lockdown.sql) — uafhængig, bredere write-grants-audit der korroborerer klassificeringen af alle 9 tabeller (ikke anvendt endnu, ejer-review-pending).
- [#2259](https://github.com/NicolaiDolmer/CyclingZone/issues/2259) — oprindelig kilde til backup/snapshot-tabel-mønstret.
- [#284](https://github.com/NicolaiDolmer/CyclingZone/issues/284) — tidligere verifikation af `board_consequences`/`board_request_log`/`team_board_members` som "milestone-gated tomme, ikke broken" (`frontend/src/data/patchNotes.js:21962`).
- [`docs/decisions/2026-05-22-rls-behavioral-vs-structural-guard.md`](2026-05-22-rls-behavioral-vs-structural-guard.md) — søster-ADR om RLS-verifikationsmetode.
- Supabase advisor-remediation: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
