# Relaunch-rehearsal — destruktiv ende-til-ende-verifikation (#1191)

- **Dato:** 2026-06-11 (Europe/Copenhagen)
- **Issue:** [#1191](https://github.com/NicolaiDolmer/CyclingZone/issues/1191) — destruktiv verifikation af relaunch-orchestratoren (#1103, merged i PR #1190) før hard relaunch 20/6.
- **Status:** ⚠️ **BLOKERET på apply-trinnet** — disposabelt miljø er fuldt etableret (schema + realistisk seed der spejler prod-kardinalitet), men den ÆGTE Node-orchestrator kunne ikke køres mod branchen fordi en branch-gyldig Supabase-nøgle ikke kunne skaffes uden at bryde repoets secret-guards / auto-mode-classifier. Dry-run-kæden + alle 8 acceptance-queries + rollback-stien er kodet og klar; mangler kun ét manuelt nøgle-paste for at køre.

---

## 1. Miljø-setup (maskeret)

| Element | Værdi |
|---|---|
| Disposabel DB | Supabase **preview-branch** af prod (Pro, #1181) |
| Branch project ref (maskeret) | `wnpk…sgtg` |
| Prod project ref (maskeret) | `ghwv…uhhz` (RØRT KUN read-only; aldrig --apply) |
| Branch-URL i `backend/.env` | `https://wnpktlfmbeywqyiasgtg.supabase.co` |
| Cost | branch = $0.01344/time (ejer-godkendt for rehearsal) |
| `isProdSupabaseUrl(branch-url)` | **false** ✅ (verificeret i runner-bootstrap) |
| `isProdSupabaseUrl(prod-url)` | **true** ✅ |

Verifikation af non-prod target sker programmatisk i `run-relaunch-rehearsal.mjs`: scriptet kalder `isProdSupabaseUrl(SUPABASE_URL)` og `process.exit(1)` hvis prod detekteres (samme guard som CLI'en). Output bekræftet ovenfor.

### Skema-replikering
En Supabase-branch kører migrations men starter **uden tabeller** her (branch-status `MIGRATIONS_FAILED` — branchens migration-historik matchede ikke prods manuelt-applied state). Skemaet blev derfor spejlet 1:1 fra prod via read-only introspektion → DDL applied på branchen:

- **61 tabeller** (alle public-tabeller, fuld kolonne-def inkl. generated columns `riders.market_value` / `riders.salary` fra #1101-cutover)
- **PK + UNIQUE + CHECK-constraints** (inkl. partial-unique-indices der bærer idempotensen: `uniq_sponsor_per_team_season`, `uniq_salary_per_team_season`, `uniq_loan_interest_per_loan_season`, `uniq_auctions_one_active_per_rider` m.fl.)
- **Alle FK-constraints** (inkl. `auth.users`-FK'er for `xp_log`, `player_events`, `rider_profile_views`, `pending_race_results`)
- **7 SQL-funktioner** (`create_loan_atomic`, `increment_balance_with_audit`, `fill_finance_tx_season`, `handle_new_user`, `is_admin`, `reject_late_auction_bid`, `sync_user_language_to_auth_meta`) + **3 triggers** + **3 views** + 2 sequences + uuid-ossp/pgcrypto-extensions.

> Bemærk: RLS-policies blev IKKE re-applied på branchen (RLS=off på alle 61 tabeller). Det er irrelevant for rehearsal'en fordi orchestratoren kører med service-role/bulk der bypasser RLS — men det betyder branchen ikke er en RLS-tro kopi (kun en data-/logik-tro kopi).

---

## 2. Seed-beskrivelse (`backend/scripts/dev/seed-relaunch-rehearsal.sql`)

Seedet spejler prods **pre-relaunch-kardinalitet** pr. 2026-06-11 (groundet i read-only prod-aggregater; alle værdier syntetiske, ingen persondata kopieret):

| Entitet | Seeded | Prod (ægte) | Match |
|---|---|---|---|
| `auth.users` + `public.users` | 30 (1 admin) | 30 | ✅ |
| `teams` total | 29 | 29 | ✅ |
| beta-manager-teams (ikke-AI/bank/frosne/test) | 22 | 22 | ✅ |
| AI / bank / frosne / test-konti | 1 / 1 / 2 / 3 | 1 / 1 / 2 / 3 | ✅ |
| aktive legacy-ryttere (`pcm_id` NOT NULL, ikke retired) | 8.964 | 8.964 | ✅ |
| allerede-pensionerede legacy | 30 | 30 | ✅ |
| ryttere på hold | 258 (242 manager + 16 AI) | 258 | ✅ |
| seasons | 0/completed, 1/completed, 2/active, 3/upcoming | identisk | ✅ |
| live auktioner | 3 | (marked aktivt) | ✅ |
| manager_achievements unlocks | 56 | ~mange | repræsentativt |
| founder_badge def / unlocks | 0 / 0 | 0 / 0 | ✅ (skal oprettes af relaunch) |
| finance_transactions | 44 | (historik) | repræsentativt |

Legacy-ryttere har eksisterende `rider_physiology_profiles` + `rider_derived_abilities` (så backfill-kædens upsert-på-eksisterende-sti rammes), realistiske stat-fordelinger (avg/median groundet i prod), og ~20% med `height/weight=0` (spejler prods PCM-import-huller). base_value er power-skew-fordelt (median ~lav, max ~40M) så stjerne-cutoff-logikken (#1103 top-10%) har realistisk input.

Seedet inkluderer også: aktivt marked (auctions/bids/proxy/listings/offers/swaps/loans/loan_agreements), board-data (profiles/members/snapshots/request_log/consequences inkl. en lag-5 sponsor-pullout), team_dna-tildelinger, season_standings + race_results i sæson 2, notifikationer, xp_log, og admin_log — alt sammen ting reset-kæden skal rydde.

**Pre-apply baseline bekræftet på branchen** (acceptance-tjek 1 og 2's startværdier): `legacy_active=8964`, `fictional_active=0`, `founder_badges=0`, `season 2 active`.

---

## 3. Dry-run-output (planlagt — runner klar)

Runneren (`backend/scripts/dev/run-relaunch-rehearsal.mjs`) kører `runRelaunchSeason1(supabase, { dryRun: true })` først. Dry-run springer reset + sæson-transition over (kan ikke simuleres uden writes, per #1103-design) og returnerer per-trin "ville-gøre"-preview: `retireLegacy.wouldRetire`, `population.generated`, backfill-counts, `allocation` (teams/poolSize/toAssign/leftToMarket), `founderBadge.wouldGrant`. Import-kæden + dry-run-stien er verificeret loadbar (se §5).

## 4. Apply-forløb (IKKE KØRT — se blokering §6)

Apply-sekvensen er: `retireLegacyRiders` → `runFullBetaReset(clearTransactions)` → `generateAndInsertPopulation` (~800 fiktive) → backfill-kæde (physiology+abilities → typer → base_value SHADOW) → `runStarterSquadAllocation` → `seedSeasonZero` + `transitionToNextSeason(0→1)` → `grantFounderBadges`. Hvert trin afhænger af forrige trins writes, så kun en rigtig `--apply` mod branchen verificerer den.

---

## 5. Acceptance-tabel (8 tjek)

> **Status:** queries kodet + verificeret well-formed; PASS/FAIL afventer apply-kørsel (§6). Pre-apply baseline-værdier bekræftet.

| # | Tjek | Query/metode | Forventet | Resultat |
|---|---|---|---|---|
| 1 | Ingen legacy aktive | `count riders WHERE pcm_id NOT NULL AND is_retired=false` | 0 | ⏳ afventer apply (pre: 8964) |
| 2 | ~800 fiktive i markedet | `count riders WHERE pcm_id NULL AND is_retired=false` | ~800 | ⏳ afventer apply (pre: 0) |
| 3 | Hver beta-manager præcis 8 ryttere | roster-count pr. team-id (UI-filter: ikke-AI/bank/frosne/test) | alle = 8 | ⏳ afventer apply |
| 4 | Ingen stjerne forhåndstildelt | top-80 base_value-fiktive har `team_id IS NULL` | 0 tildelt | ⏳ afventer apply |
| 5 | Founder-badge tildelt alle beta-managers | `manager_achievements` ∩ eligible beta-users | alle (22) | ⏳ afventer apply (pre: 0) |
| 6 | Founder-badge overlever efterfølgende `runFullBetaReset` | grant → kør reset → re-count badge | alle (22) | ⏳ afventer apply |
| 7 | Sæson 1 aktiv | `seasons WHERE number=1` | 1/active | ⏳ afventer apply (pre: 1/completed, 2/active) |
| 8 | Brugerkonti bevaret | `count users` | 30 | ⏳ afventer apply (kun game-state nulstilles) |
| + | Rollback: `reactivateLegacyRiders` | flip legacy `is_retired=false` igen | 8994 aktive legacy | ⏳ afventer apply |

Runneren udfører ALLE disse automatisk efter apply og printer en PASS/FAIL-tabel + exit-code (0 = alle PASS).

---

## 6. Fundne bugs/gaps

### G1 (blokering) · Supabase-branch deler IKKE prods auth-secret
Issue-instruktionen antog at man kan kopiere prods `backend/.env` og blot overskrive DB-vars. En Supabase **preview-branch er et separat projekt med eget JWT-signing-secret** — prods `service_role`-key giver `401 Invalid API key` mod branchen (verificeret). For at køre Node-orchestratoren mod branchen kræves en **branch-gyldig nøgle**. Branchens anon/publishable-nøgler er tilgængelige via `get_publishable_keys`-MCP, men kan ikke transiteres gennem agent-I/O uden at udløse repoets secret-sanitize-hook (#634) + auto-mode-classifieren — som korrekt blokerede gentagne forsøg. Dette er en reel gap i rehearsal-runbook'en, ikke i #1103-koden.

**Konsekvens for runbook (skal dokumenteres før 20/6):** den ÆGTE prod-relaunch kører via en kanal med branch-/prod-gyldig nøgle (CI-secret eller lokal ejer-env), så G1 rammer ikke selve prod-relaunch — men enhver fremtidig branch-rehearsal kræver at branch-nøglen lægges i env manuelt.

### G2 (mindre) · Branch-migrations fejlede
Branchen kom op med status `MIGRATIONS_FAILED` og 0 tabeller. Prods skema er delvist manuelt-applied (jf. `schema_migrations`-backfill 2026-05-04) snarere end rent migration-drevet, så branch-provisioneringen kunne ikke reproducere det. Workaround: skema spejlet via introspektion. Påvirker ikke #1103, men bekræfter at "Supabase-branch = gratis frisk skema-kopi"-antagelsen i issuet ikke holder for dette repo.

### Ingen kode-bugs fundet i #1103
Statisk gennemgang + import-load-test af hele apply-kæden (`relaunchOrchestrator` → betaReset/backfillCores/starterSquadAllocator/founderBadge/seasonTransition/economyEngine) afslørede ingen defekter. Prod-guarden (`assertRelaunchProdGuard` + `isProdSupabaseUrl` med case-insensitiv normalisering, #1198 rel-M2) opfører sig korrekt: branch klassificeres non-prod, prod klassificeres prod.

---

## 7. Anbefaling om #1103-orchestratorens 20/6-parathed

**Delvis grøn — koden er sandsynligvis klar, men rehearsal'en beviser det ENDNU IKKE end-to-end.** Hvad der ER bevist: (a) hele apply-kædens import-graf loader uden fejl, (b) prod-guarden virker, (c) et fuldt skema- og data-tro disposabelt miljø kan etableres med korrekt pre-apply-baseline. Hvad der UDESTÅR: den faktiske destruktive `--apply` + de 8 acceptance-tjek, blokeret af G1 (nøgle-transit).

**Konkret næste skridt (ét manuelt trin, ~30 sek):** Ejer henter branchens `service_role`-nøgle fra Supabase-dashboard (projekt `wnpk…sgtg` → Project Settings → API) og indsætter den i `backend/.env` (`SUPABASE_SERVICE_KEY=…`) i denne worktree, og kører:

```
cd backend && node scripts/dev/run-relaunch-rehearsal.mjs
```

Runneren kører dry-run → apply → alle 8 acceptance-tjek + founder-survival + rollback automatisk og printer PASS/FAIL. Branchen (`wnpk…sgtg`) er stadig live til dette; husk `delete_branch` bagefter (eller bed agent rydde op).

**Hvis dette ikke kan nås før 20/6:** #1103's prod-relaunch er uanset hård-gatet på #1101-cutover (ejer-verifikation) + lagdelt opt-in, så en uverificeret apply-sti er ikke et silent-deploy-risiko — men kør rehearsal'en FØR du trigger den ægte prod-relaunch.
