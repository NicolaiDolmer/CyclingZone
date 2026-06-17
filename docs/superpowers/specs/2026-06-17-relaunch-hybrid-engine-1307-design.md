# Relaunch sæson 1 — hybrid race-motor + spiller-vendt holdudtagelse (design)

**Dato:** 2026-06-17 · **Status:** UNDER EKSEKVERING · **Slice:** `slice:tdf-launch`
**Fase-tracker:** Fase A ✅ · Fase B trin 4 ✅ (hybrid-fatigue, PR #1443 merged) · Fase B trin 5 — **tooling ✅** (backup + verify-restore bygget + lokalt-grøn, commit `893fed13`; `scripts/db-backup.mjs`/`db-verify-restore.mjs`/`db-selftest.mjs` + `scripts/db-README.md`). **⏭ NÆSTE = ejer lægger `SUPABASE_DB_URL` (session-pooler) i prod-Infisical → `npm run db:backup`+`db:verify-restore` mod prod → P3 opfyldt** · Fase C (orchestrator-verify → prod-relaunch → flag-flip) ⬜ · Fase D (post-launch: #1021, PCM-oprydning, #1310) ⬜. Følg §5 i rækkefølge.
**Relaterede issues:** #1105 (relaunch-epic) · #1103 (orchestrator/founder-badge) · #1102/#1122/#1428 (race engine v2) · #1307 (holdudtagelse/kaptajn/udbrud, CLOSED/done) · #1136/#1137 (daglig træning/progression) · #1101 (værdimodel, hard-gate) · #1438/#1442 (økonomi E2 + anti-inflation Fase 1) · #677 (fiktive stats — OPEN, mulig blocker) · #1346 (season-transition readiness-gate) · #1021 (fuld fysiologi — POST-launch) · #97 (hård gældsbund).

> Verificeret mod kode **og** live prod (`ghwvkxzhsbbltzfnuhhz`) 2026-06-17. To workflow-kortlægninger + direkte prod-queries. Hvor docs (især `PLAN.md`) modsiger koden, vinder koden — se §2.

---

## 1. Mål og scope (ejer-besluttet)

"Afskaf PCM, indfør de relaunch-gatede systemer — hurtigst muligt og bedst muligt."

**Afgørende reframe:** dette er ikke et byggeprojekt. Næsten alt det relaunch-gatede er **allerede bygget og merged**, dormant bag feature-flags. Arbejdet er primært **verificér → vip flag → kør orchestrator** — plus ét lille, fokuseret byg (in-race-træthed) og én sikkerheds-mekanisme (backup).

**Ejer-valgt scope ved relaunch:**
- **Hybrid race-motor:** flip `race_engine_v2_enabled` → `on` (evner afgør resultatet) + **aktivér in-race-træthed med cross-stage akkumulering** + tænd daglig træning (`daily_training_enabled`) så form divergerer over tid.
- **#1307 spiller-vendt holdudtagelse/kaptajn/hjælpere/udbrud** — synlig ved relaunch (nul byg; aktiveres af samme flag-flip som motoren).

**Eksplicit POST-launch (ikke relaunch-gate):**
- **Fuld fysiologi #1021** (persistent recovery-model der erstatter resten af stub-adfærd). Kan teknisk ikke være "ægte" på relaunch-dagen: form bygges af daglig træning over tid på en population der først findes EFTER seed.
- PCM-import-kode-oprydning · kontrakt-flows #1310 · dybe outsider-udbrudssejre (p15+) · økonomi Fase 2/3.

**"PCM" = to ting — kun den ene afskaffes:**
- **Ægte PCM (afskaffes, post-launch):** ekstern Excel-import-nødløsning (`/api/admin/import-results-pcm` + `backend/lib/pcm*.js`). Ren import, ingen simulering.
- **"Light-motoren" (bliver — er IKKE PCM):** Race Engine v2 (`raceSimulator.js` + `raceRunner.js`), deterministisk stats-drevet simulator. "Afskaf PCM" for almindelige brugere = vip `race_engine_v2_enabled` fra `beta` → `on`.

---

## 2. Verificeret nuværende tilstand (kendsgerninger, ikke docs)

| Forhold | Verificeret tilstand | Kilde |
|---|---|---|
| Feature-flags i prod | `race_engine_v2_enabled`, `daily_training_enabled`, `academy_enabled` står **alle på `"beta"`** (ikke off, ikke on) | SQL mod `app_config` |
| Sæson-state | 0 completed, 1 completed, **2 ACTIVE**, 3 upcoming — der kører en levende sæson | SQL mod `seasons` |
| Population | **8.964 aktive ryttere, alle legacy PCM, 0 fiktive** (8.994 total). Relaunch aldrig kørt mod prod | SQL mod `riders` |
| Økonomi E2 + Fase 1 | **Deployet + migration anvendt** — `transfer_frozen` + `debt_breach_streak` findes på `teams`; `economyConstants.js` på main har division-sponsor {600/400/340k}, løn 0.067, upkeep {440/140/40k} | SQL + kode + Railway-deploy 80s efter merge |
| #1307 | **Bygget + merged end-to-end** (PR #1361): backend autopick/roller/udbrud, API `/races/:id/selection`, UI `RaceSelectionPanel.jsx`, EN/DA, help, patch notes 5.30. Gated bag `race_engine_v2_enabled` | Kode + `gh issue view 1307` |
| In-race-træthed | **Allerede en ægte score-komponent** (`raceSimulator.js:345`, `fatigueComponent` linje 94-102) — IKKE en 0-stub. Vægtet lavt (støj dominerer ~10:1) og **statisk gennem et helt løb** (`simEntrants` bygges én gang, `raceRunner.js:171-178`) | Kode |
| Daglig træning | Pipeline + cron bygget og wired (`dailyTrainingEngine.js`, `cron.js:480`, sweep efter kl. 22). Tænd = ren DB-toggle, ingen deploy. Skriver `rider_condition.form` | Kode |

**Doc-drift der skal rettes i `PLAN.md` (begge bekræftet forkerte mod kode):**
1. **"E2-økonomi ikke i kode endnu / sponsor 240k flat" (linje ~7/12)** — forkert. E2 + Fase 1 er landet og deployet. `SPONSOR_INCOME_BASE=240000` er nu kun legacy-fallback, ikke aktiv sæson-1-værdi.
2. **"Ingen server-gate på transition pt." (linje ~13)** — forkert. `assessTransitionReadiness` (#1346, merged 2026-06-12) håndhæves på `POST /api/admin/season-transition` (409 medmindre `force===true`). MEN gaten dækker **kun HTTP-endpointet** — relaunch-orchestrator, cron og `executeSeasonTransition.js` kalder `transitionToNextSeason` direkte og er **bevidst ugatede**. Den reelle risiko er at relaunch-stien er ugatet, ikke at endpointet er det.

---

## 3. Kritisk risiko (afgør hele Fase C)

Prod kører en **levende sæson 2** (8.964 aktive ryttere, 23 menneske-managers, 17.570 race_results, finance-historik). Relaunch-orchestratorens trin 2 (`runFullBetaReset`) udfører **uigenkaldelige hårde DELETEs** på alt det (sæsoner, races, results, standings, finance_transactions, loans, notifications, xp_log). Kombineret med:
- relaunch-stien er **ugatet** (springer #1346-readiness over),
- der er **ingen undo** (`reactivateLegacyRiders` flipper kun `is_retired`, genskaber ikke `team_id` eller slettede sæson/race/finance-rows),
- dry-run kan **ikke** trofast simulere reset+transition (destruktiv sekvens springes i dry-run),

→ **ét fejlklik eller forkert `.env`-pegning sletter en levende sæson permanent.** En verificerbar backup/PITR-sti er en **hård pre-req** før `--apply` mod prod. Ikke til forhandling.

---

## 4. Hårde pre-reqs (skal være sande før Fase C)

| # | Pre-req | Status | Verify / handling |
|---|---|---|---|
| P1 | Økonomi E2 + Fase 1 deployet + migreret | ✅ **Verificeret** (kolonner findes, konstanter på main, Railway-deploy) | — |
| P2 | race_engine_v2 grøn mod **nuværende** population | ⚠️ Grøn ved merge-tid 12/6; ikke gen-kørt | `node backend/scripts/raceGate.js --condition --roles` (Fase A) |
| P3 | Verificerbar DB-backup/PITR før prod-apply | ⚠️ **Tooling bygget + lokalt-verificeret** (`scripts/db-backup.mjs` + `db-verify-restore.mjs`, commit `893fed13`); mangler kun `SUPABASE_DB_URL` i prod-Infisical + ét prod-run | Ejer: tilføj `SUPABASE_DB_URL` (Supabase→Connect→Session pooler) → `npm run db:backup` + `db:verify-restore` |
| P4 | Orchestrator grøn ejer-verify mod preview-branch | ❌ Kode-komplet, aldrig kørt apply | `run-relaunch-rehearsal.mjs`, 8 acceptance + rollback PASS (Fase C) |
| P5 | #1101 base_value-shadow-cutover kvitteret | ❌ Hard-gate (`RELAUNCH_1101_CUTOVER_ACK=true`) | Ejer-kvittering (Fase C) |
| P6 | #677 (fiktive stats via ability-model) afklaret | ⚠️ OPEN/claude:todo | Beslutning ④ — er det dækket af orchestrator-backfill, eller en kvalitets-blocker? |

---

## 5. Sekvenseret plan

### Fase A — no-regret (kan startes straks, ingen prod-effekt)
1. **Ret `PLAN.md` doc-drift** (§2). Docs-only. Effort **S**. Beslutninger må ikke træffes ud fra et forkert risikobillede.
2. **Kør kalibrerings-gaten** mod nuværende population: `raceGate.js --condition --roles`. Read-only. Effort **S** (M hvis re-tune). Dette er simulér-før-ship for #1307-delen (P2).
3. ✅ Deploy-verify (P1) — gjort.

### Fase B — lille byg (parallelt; separate worktrees, forskellige moduler)
4. ✅ **In-race-træthed: cross-stage akkumulering — IMPLEMENTERET** (branch `feat/hybrid-race-fatigue-1021`, plan `plans/2026-06-17-hybrid-race-fatigue.md`). Ren helper `stageEnteringFatigues` (`raceFatigue.js`) wired ind i `buildRaceResults` (`raceRunner.js`); træthed akkumulerer mellem etaper + start = `rider_condition.fatigue`. **Kalibrering ejer-valgt: `FATIGUE_RACE_WEIGHT 0.008→0.030`** (4,6% af terræn). **Acceptance MET:** `race:gate` grøn · `race:gate:condition` exit 0 (durability ⌀rank 0.01→**0.07**, ikke længere dødvægt) · `race:gate:roles` kaptajn-delta positiv (2137 vs 2114) · fuld suite 1740/1740. Sanity-udskrift + spec-6.4-bound-test afledt af konstanterne (ingen stale tal). Pre-eksisterende `race:gate:roles` itt-bånd uændret (uden for scope).
5. **Backup/PITR-sti** (P3). Effort **L** (men PITR-verifikation << at bygge reverse-DELETE). Se beslutning ②.
6. ~~E2-økonomi byg~~ — **udgår, allerede gjort** (P1).
7. **#1307** — **nul byg.** Aktiveres af flag-flippet i Fase C.

> Faldgrube: trin 4 (fatigue) er balance-følsom og trin 5 rører ikke balance — men kør race:gate **én gang samlet** efter trin 4 er merged, ikke isoleret per ændring.

### Fase C — irreversibel prod-relaunch (ét vindue, ejer kører, ingen samtidige sessioner)
8. **Rehearsal mod disposabel preview-branch FØRST** (P4). `run-relaunch-rehearsal.mjs` — alle 8 acceptance-tjek + rollback PASS (0 legacy aktive, ~800 fiktive [780-820], hver beta-manager præcis 8 ryttere, ingen stjerne forhåndstildelt, founder-badge overlever reset, sæson 1 active, 30 brugerkonti). + #1101-ack (P5). Effort **M**.
9. **Beslut academy i seed** (beslutning ③) FØR `--apply`: orchestrator trin 6.4 læser `isAcademyEnabled` UDEN beta-opts → `"beta"` = false → academy-intake springes over. Sæt `academy_enabled='on'` før apply hvis kuld ønskes.
10. **Prod-apply:** `relaunchSeason1.js --target-prod --confirm "RELAUNCH SEASON 1"` + `RELAUNCH_1101_CUTOVER_ACK=true`. Genererer 800 fiktive deterministisk (seed=2026) ved apply-tid, retirer legacy, beta-reset, sæson 0→1, founder-badges. Effort **M**. **Kræver P3 (backup) på plads.**
11. **Vip spiller-vendte flags i rækkefølge** (SQL `UPDATE app_config`, ingen deploy):
    1. `race_engine_v2_enabled='on'` — **efter** golden/distributions-verifikation mod den færdige fiktive population. Gater BÅDE motoren OG #1307-selection-UI → først her bliver `RaceSelectionPanel` synligt.
    2. `daily_training_enabled='on'` — form begynder at divergere via cron-sweep efter kl. 22.
    3. `academy_enabled='on'` (hvis ikke sat i trin 9).
    > Dobbelt-flag-afhængighed: daglig træning har INGEN effekt på resultater medmindre `race_engine_v2` også er `on`. Efter relaunch er `off`/`beta` ikke længere en ægte fallback (legacy PCM-ryttere er retiret).

### Fase D — post-launch (mod TdF 4/7)
12. **Fuld fysiologi #1021** (persistent form/recovery). Effort **L**.
13. **Udvid `simulateSeasonDryRun` condition-mode** til akkumuleret fler-etape tour-fatigue (i dag statisk [0,70], linje 303-304). Effort **M**.
14. **PCM-import-kode-oprydning** (BEHOLD `raceResultsEngine.js` — delt med approve-results + ny motor; VEND forward-guard `adminRouteOwnership.test.js:34`; opdatér `GAME_INVARIANTS.md`). Effort **M**.
15. **Kontrakt-flows #1310** før sæson 1-slut · dybe outsider-udbrud (kræver #1021).

---

## 6. Simulér-før-ship-gate (tre punkter)

Per reglen: balance-følsomme systemer får empirisk dry-run mod ægte population + scorecard FØR ship.
1. **Fase A trin 2** — `raceGate.js --condition --roles` mod nuværende population (bekræft scorecard grønt før noget aktiveres).
2. **Efter Fase B trin 4** (fatigue) — gen-kør gaten; win-rate-scorecard skal forblive grønt (favoritter vinder oftest men ikke 100%, roles/breakaway-bånd grønne). **Dette er den iterative kørsel der finder den rigtige fatigue-følsomhed** — vægt/akkumulerings-rate er IKKE regnet ud på forhånd.
3. **Før Fase C trin 11** (flag-flip) — golden/distributions-verifikation mod den FÆRDIGE fiktive population (ikke seeds 2026/7/42). Seed-først, flip-bagefter.

---

## 7. Paralleliserbarhed

- **Samtidigt straks:** Fase A trin 1 (docs) + trin 2 (read-only gate).
- **Fleet-kandidater (separate worktrees):** Fase B trin 4 (fatigue, `raceRunner.js`) + trin 5 (backup-infra) — forskellige moduler.
- **Strengt sekventielt:** trin 8 (rehearsal) kræver trin 4+5 done → trin 10 (prod-apply) kræver trin 8 grøn + P3/P5 → trin 11 (flags) kræver trin 10 verificeret. Flag-orden: `race_engine_v2` FØRST.
- **Aldrig parallelt:** hele Fase C (prod-blokken) — ét vindue, én operatør.

---

## 8. Åbne ejer-beslutninger (prioriteret; tages én ad gangen i denne rækkefølge)

- **① Træthed-niveau** — ✅ **AFGJORT: ægte hybrid** (cross-stage akkumulering).
- **② Backup-strategi** (P3) — ✅ **AFGJORT: verificeret logisk pg_dump-backup** (`scripts/db-backup.mjs` + `db-verify-restore.mjs`, commit `893fed13`, lokalt-grøn). En frisk restore-testet dump slår både den 24t-gamle daglige backup og en ubetestet PITR; PITR valgfri oveni. Reverse-DELETE-undo forkastet (dækker ikke sæson/race/finance). MCP-stramning (read-only/scope) bevidst FORKASTET — ejer vil maks autonomi; backuppen er det der gør bred adgang sikker. Resterer: `SUPABASE_DB_URL` i prod-Infisical + ét prod-run (i morgen).
- **③ Academy i seed-kørslen** (Fase C trin 9) — skal hver menneske-trup have et kandidat-kuld på relaunch-dag 1, eller staged efter? Afgøres lige før `--apply`.
- **④ #677-status** (P6) — er fiktive stats dækket af orchestratorens backfill-kæde (physiology→abilities→base_value), eller er #677 en reel kvalitets-blocker? Kræver kort undersøgelse.
- **⑤ PCM-kode-oprydning timing** + approve-results/`pending_race_results`-stiens skæbne (ingen kode skriver tabellen i dag — vestigial). **Anbefaling: post-launch (Fase D)** — ikke en relaunch-blocker.

---

## 9. Centrale filer

`backend/lib/raceSimulator.js` (linje 79-80 vægte, 345 finalScore) · `backend/lib/raceRunner.js` (171-178 statisk fatigue → cross-stage-akkumulering her; 384-396 loadEntrantsForRace) · `backend/lib/raceFatigue.js` (linje 25 raceFatigueLoad) · `backend/lib/dailyTrainingEngine.js` · `backend/lib/economyConstants.js` (E2 + SEASON_*-konstanter L97/103/108) · `backend/lib/relaunchOrchestrator.js` + `backend/scripts/relaunchSeason1.js` · `backend/scripts/raceGate.js` + `simulateSeasonDryRun.js` · `backend/scripts/dev/run-relaunch-rehearsal.mjs` · `backend/lib/seasonTransitionReadiness.js` (#1346) · `backend/lib/betaResetService.js` (hårde DELETEs) · `backend/lib/fictionalLaunchPopulation.js` (seed=2026, count=800) · `frontend/src/components/race/RaceSelectionPanel.jsx` · `docs/PLAN.md` (linje ~7/12/13 doc-drift — skal rettes).
