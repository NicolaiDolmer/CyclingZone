# Backend cron + season audit — 2026-05-24

> **Issue:** [#545](https://github.com/NicolaiDolmer/CyclingZone/issues/545). Trigger: sæson-loop-incident 2026-05-21 ([postmortem](../.claude/learnings/2026-05-22-season-transition-cron-loop-racing-window-leakage.md)) afslørede filter-assumption-drift i 3 crons. Audit dækker hele cron-infrastrukturen for samme klasse af bugs.

## Metode

Hver af 8 crons review'd mod 5 dimensioner. Verdict-legenden:

| Symbol | Betyder |
|---|---|
| ✅ | Robust — eksplicit guard på plads |
| ⚠️ | Concern — funktionelt OK pt., men fragilt eller incomplete |
| 🔴 | Bug — bør fixes |
| N/A | Ikke relevant for cron'en |

Filer læst: `backend/cron.js`, `backend/lib/{auctionFinalization,deadlineDayReport,squadEnforcement,seasonAutoTransition,boardAutoAccept,boardMidSeason,dailySeasonCountCheck,balanceRpc,notificationService}.js`, `database/2026-05-22-transfer-window-racing-guard.sql`.

## Matrix

| Cron | Filter-præcision | Idempotency | Error-handling | Observability | Concurrency |
|---|---|---|---|---|---|
| `finalizeExpiredAuctions` (60s) | ✅ | ✅ | ✅ | ⚠️ | ⚠️ |
| `processDeadlineDayCron` (5m) | ⚠️ | ✅ | ⚠️ | ✅ | ✅ |
| `processSquadEnforcementCron` (5m) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `processSeasonAutoTransitionCron` (5m) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `checkDebtWarnings` (24h) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `processBoardAutoAcceptCron` (30m) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `processMidSeasonReviewCron` (30m) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `processDailySeasonCountCheck` (24h) | ✅ | ✅ | ✅ | ✅ | ✅ |

## Findings — pr. cron

### 1. `finalizeExpiredAuctions` (60s) — `backend/lib/auctionFinalization.js:525`

- **Filter:** `.in("status", ["active","extended"]).lte("calculated_end", now)` — eksplicit status-whitelist. Pause-check via `getMarketPauseState` skipper ticks når marked er paused. ✅
- **Idempotency:** Tre `incrementBalanceWithAudit`-calls bruger `idempotency_key` (`auction_winner:${id}`, `auction_seller:${id}`, `auction_bank_sale:${id}`) + `allowDuplicate: true`. UNIQUE-constraint på `finance_transactions.idempotency_key` blokker double-spend ved retries. ✅
- **Error-handling:** Per-auction try/catch i `finalizeExpiredAuctions`-loop, `onError` callback + result.code='error'. En auction's fail stopper ikke resten. ✅
- **Observability:** ⚠️ `activity_feed.insert` har silent catch ("must never block auction finalization"). En broken activity_feed pipe ville være usynlig.
- **Concurrency:** ⚠️ Ingen overlap-guard på selve ticken. Hvis tick N tager >60s, starter tick N+1 parallelt. `trackedTick` global counter (`cronInFlight`) tracker kun for graceful shutdown, prevents IKKE overlap. Race-window mellem SELECT (status='active') og UPDATE (status='completed') i `closeAuction`. Beskyttet i praksis af `idempotency_key`-uniqueness på finance-mutations, men `rider.team_id`-UPDATE er afhængig af, at `windowOpen`-state ikke ændrer sig mellem N og N+1. Lav sandsynlighed; fully addressed by #330 multi-instance locking.

### 2. `processDeadlineDayCron` (5m) — `backend/lib/deadlineDayReport.js:329`

- **Filter:** `.order("created_at", desc).limit(1).single()` — plukker SENESTE window uden lifecycle-filter. Racing-window guard er post-fetch early-return: `if (!window.closes_at && !window.closed_at) return`. ⚠️ Fragilt: hvis nyeste window er stale (ikke transitioned), ville cron skippe og older deadline-window aldrig handles. I praksis er det invariant-sikret af window-lifecycle, men query'en udtrykker ikke assumption.
- **Idempotency:** `fireFinalWhistle` har atomic claim på `final_whistle_sent_at IS NULL`, `fireAutoCloseIfDue` på `status='open'`. CHECK constraint `transfer_windows_final_whistle_requires_closed` (database/2026-05-22-transfer-window-racing-guard.sql) er DB-niveau backup. ✅
- **Error-handling:** 🔴 `fireDeadlineWarnings`-loop har **INGEN per-team try/catch** (linje 281-292). Hvis `notifyTeamOwnerFn` kaster på team N, vil teams N+1..M ikke få deres warning. Partial-failure mode med synlig user-impact (manglende deadline-warning).
- **Observability:** ✅ Post-#614: `captureExceptionFn` injected (kaldes med `{ tags: { cron: "deadline-day-warning" }, extra: { teamId, windowId, step } }` på per-team-fail). `console.log` summary stadig på plads.
- **Concurrency:** ✅ Atomic claims beskytter `final_whistle` + `auto_close`. Warnings beskyttet af `notifyUser` 24h dedup-window (samme title+message+relatedId).

### 3. `processSquadEnforcementCron` (5m) — `backend/lib/squadEnforcement.js:409`

- **Filter:** `.eq("status","closed").not("closed_at","is",null).is("squad_enforcement_completed_at",null)` — fully eksplicit efter 2026-05-21 fix. CHECK constraint DB-side. ✅
- **Idempotency:** 🔴 **Partial-failure recovery gap.** Window-level atomic claim på `squad_enforcement_completed_at` sker FØR per-team loop (linje 437-443). Hvis processen dør (Railway SIGTERM, OOM, network blip) midt i loopen efter f.eks. 5 af 10 teams er enforced:
  - `transfer_windows.squad_enforcement_completed_at` = SET (claim succeeded)
  - 5 teams har fået auto-purchase/sale + finance_transactions + penalty
  - 5 teams er IKKE enforced
  - Næste cron-tick filtrerer windowet ud (claim sat) → de 5 forbliver outside squad-limits, ingen bøde
  - Modsat `auctionFinalization`, hvor per-item idempotency_key + retry kører hver tick, mangler squad-enforcement **per-team-claim** og **per-team idempotency_key** på finance-RPC calls (linje 151-166, 191-206, 234-247).
  - Samme klasse-bug som [#578](https://github.com/NicolaiDolmer/CyclingZone/issues/578) (season-transition partial failure recovery, lukket i session B). Squad-enforcement er nu det største blinde-spot for samme failure-mode.
- **Error-handling:** ✅ Per-team try/catch, `onError` callback.
- **Observability:** ✅ Post-#614: `captureExceptionFn` injected (kaldes ud over `onError` med `{ tags: { cron: "squad-enforcement" }, extra: { teamId, windowId, seasonId } }`).
- **Concurrency:** ✅ Window-level claim sikrer kun én tick får fat i et givet window.

### 4. `processSeasonAutoTransitionCron` (5m) — `backend/lib/seasonAutoTransition.js:18`

- **Filter:** Eksplicit 4-betingelses filter: `status='closed' AND closed_at NOT NULL AND final_whistle_sent_at NOT NULL AND squad_enforcement_completed_at NOT NULL`. Plus `season.status='active'` post-fetch check. ✅
- **Idempotency:** ✅ #578 resume-support merged (`buildTransitionPlan` tillader completed fromSeason når toSeason eksisterer). `transitionToNextSeason` self-idempotent per fase.
- **Error-handling:** ✅ Throw propagerer til `trackedTick` → console.error + Sentry. admin_log silent INSERT-failure (fra 2026-05-21 incident) er fixed via nullable admin_user_id + description-felt fra cron.
- **Observability:** ✅ Console.log success, Sentry via trackedTick, admin_log audit-entries, daily safety-net (cron #8).
- **Concurrency:** ✅ Ingen atomic claim på selve transition-firingen, men `transitionToNextSeason` er self-idempotent. Hvis 2 instanser fyrer samme tick, 2nd ville se `season.status='completed'` og early-return.

### 5. `checkDebtWarnings` (24h, var 6h) — `backend/cron.js:78`

- **Filter:** ✅ Post-#613: `.eq("is_ai", false).eq("is_bank", false).eq("is_frozen", false).lt("balance", 0)`. Bank-team filtreres væk via defense-in-depth (mirror af `fireDeadlineWarnings`-pattern).
- **Idempotency:** ✅ Post-#607 ([PR #611](https://github.com/NicolaiDolmer/CyclingZone/pull/611)): cadence skiftet til 24h + statisk message ("Dit hold har negativ saldo. Tjek Økonomi-siden for detaljer.") → `notifyUser` dedup-nøgle (`userId+type+title+message+relatedId+24h`) virker korrekt selv ved svingende balance. Regressionstest dækker 4 ticks med varierende balance → 1 notification.
- **Error-handling:** ✅ Post-#613: per-team try/catch + `errors` counter. En notifyUser-throw isolerer kun den fejlende team, øvrige teams får stadig warning. Regressionstest dækker 5-team-fan-out med throw på team-3.
- **Observability:** ✅ Post-#614: `captureExceptionFn` default'er til `sentryCapture` (kaldes på per-team-fail med `{ tags: { cron: "debt-warnings" }, extra: { teamId, userId } }`). Console.log delivered-sum + errors-sum stadig på plads.
- **Concurrency:** ✅ 24h interval, ingen DB-mutation udover notification.

### 6. `processBoardAutoAcceptCron` (30m) — `backend/lib/boardAutoAccept.js:45`

- **Filter:** ✅ Multi-stage: window.board_negotiation_state (skip locked/complete), active season check, race_days_completed threshold (≥T_MINUS_3), human teams.
- **Idempotency:** ✅ `findPendingPlanType` returnerer kun pending plans. `autoAcceptPendingPlan` bruger `upsert(onConflict: "team_id,plan_type")`. Notif-dedup via `notifyUser` 24h vindue (titel er statisk per plan-type).
- **Error-handling:** ✅ Per-team try/catch, `summary.errors++` + console.error.
- **Observability:** ✅ Post-#614: `captureExceptionFn` injected (kaldes på per-team-fail med `{ tags: { cron: "board-auto-accept" }, extra: { teamId, seasonId, raceDaysCompleted } }`). summary-object stadig returneret.
- **Concurrency:** ✅ Beskyttet af notification-dedup + upsert idempotency. 30m interval lav konflikt-risk.

### 7. `processMidSeasonReviewCron` (30m) — `backend/lib/boardMidSeason.js:37`

- **Filter:** ✅ Window state COMPLETE only, active season, race_days_completed ≥ midpoint, human teams. Per-team idempotency-check via existing-notification lookup på title+related_id+type.
- **Idempotency:** ✅ Eksplicit per-team idempotency-check FØR send. Race window mellem check og insert er beskyttet af `notifyUser` 24h dedup-fallback.
- **Error-handling:** ✅ Per-team try/catch.
- **Observability:** ✅ Post-#614: `captureExceptionFn` injected (kaldes på per-team-fail med `{ tags: { cron: "board-mid-season" }, extra: { teamId, seasonId, seasonNumber } }`).
- **Concurrency:** ✅ Som #6.

### 8. `processDailySeasonCountCheck` (24h) — `backend/lib/dailySeasonCountCheck.js:15`

- **Filter:** ✅ `action_type=SEASON_TRANSITION` + 24h time-window. Eksplicit count-baseret threshold (>1/døgn = alarm).
- **Idempotency:** ✅ Pure read + notify, ingen DB-writes.
- **Error-handling:** ✅ Throw propagerer til trackedTick.
- **Observability:** ✅ Discord webhook + Sentry capture. Bedste observability-coverage af alle 8 crons.
- **Concurrency:** ✅ 24h interval, pure read.

## Sammenfattende findings

### P0 — Akut

Ingen identified.

### P1 — Bør fixes hurtigt

**P1-A: `processSquadEnforcementCron` partial-failure recovery gap** (cron #3) → [#606](https://github.com/NicolaiDolmer/CyclingZone/issues/606) ✅ **FIXED 2026-05-24 (Approach C lite-fix)**
- Window-claim sker FØR per-team loop. Mid-tick crash efterlader window claim'et men halvdelen af teams ikke-enforced. Næste tick filtrerer windowet ud → permanent state-leak.
- **Fix:** Split window-claim i `squad_enforcement_started_at` (atomic claim FØR loop, stale-recovery efter 10min) + `squad_enforcement_completed_at` (SIDST). Per-team `idempotency_key='squad_fine:${windowId}:${teamId}'` på fine-RPC sikrer replay-safety. Migration: [`database/2026-05-24-squad-enforcement-started-at.sql`](../database/2026-05-24-squad-enforcement-started-at.sql).
- **Restrisiko (accepteret):** single-team mid-crash mellem purchase og fine vil få team within_limits ved replay → ingen fine. ~50-200ms vindue per team. Hvis observeret, skift til Approach B (per-team `squad_enforcement_records`-tabel med in_progress/completed states). Forward-guard kommenteret i `squadEnforcement.js`.

**P1-B: `checkDebtWarnings` dedup-bypass via dynamic message** (cron #5) → [#607](https://github.com/NicolaiDolmer/CyclingZone/issues/607)
- 4 cron-runs/døgn × `message` der varierer med balance → potentielt 4 warnings/døgn per team med ændret saldo.
- Mitigation: Skift dedup-nøgle. Fx send notification med statisk title+message ("Dit hold har negativ saldo. Tjek Økonomi-siden for detaljer.") og lad UI lede til faktisk balance, eller udvid `notifyUser` med dedup-nøgle-override så debt-warning kan dedupe på `userId+type+season_id` alene. Eller skift cron-cadence til 24h (matches naturlig forventning).

**P1-C: `processDeadlineDayCron.fireDeadlineWarnings` mangler per-team try/catch** (cron #2) → [#608](https://github.com/NicolaiDolmer/CyclingZone/issues/608)
- Linje 281-292: en `notifyTeamOwnerFn`-throw på team N stopper teams N+1..M fra at få warning. User-impact: manglende deadline-day-warning.
- Mitigation: Wrap per-team-loop i try/catch + summary-error-counter, mønster fra `boardAutoAcceptCron`.

### P2 — Nice-to-have

**P2-A: Per-team Sentry capture mangler i 5 crons** (#2, #3, #5, #6, #7) → [#614](https://github.com/NicolaiDolmer/CyclingZone/issues/614) ✅ **FIXED 2026-05-24**
- Console.error + summary.errors++ fanger ikke i Sentry-dashboard. Top-level `trackedTick` fanger kun den FØRSTE fejl per tick (try/catch swallows).
- **Fix:** `captureExceptionFn` injected som optional dep i alle 5 crons; kaldes ved per-team try/catch med `{ tags: { cron: "<name>" }, extra: { teamId, ...context } }`. cron.js wrappers passer `sentryCapture` fra `./sentry.js`. Pattern matcher `dailySeasonCountCheck` (gold-standard).
- **Tests:** 7 nye regressionstests (én pr. cron + backwards-compat + null-safe) — verificerer fn-kald, tags, extra-felter, samt at omitted/null fn ikke crasher non-cron callers.

**P2-B: `finalizeExpiredAuctions` tick-overlap-guard** (cron #1)
- Hvis tick tager >60s starter ny tick parallelt. Beskyttet af `idempotency_key` på finance, men teoretisk race på `rider.team_id`+`pending_team_id` hvis windowOpen-state ændrer sig mellem ticks.
- Mitigation: Per-cron mutex (boolean flag eller Promise-deduplikation) ovenpå `trackedTick`. Lav prioritet; #330 multi-instance-locking dækker det bredere problem.
- Spawn issue: P2, type:enhancement, risk:low.

**P2-C: `processDeadlineDayCron` filter er fragilt** (cron #2)
- `.order(created_at desc).limit(1).single()` plukker nyeste window uden lifecycle-filter. Racing-window er post-fetch early-return. Mere robust at filtrere i query: kræver lifecycle_phase enum eller eksplicit `closed_at IS NOT NULL OR (status='open' AND closes_at IS NOT NULL)` predicate.
- Dækket af eksisterende #542 (split transfer_windows.status overload til lifecycle_phase enum). Notér på #542.

**P2-D: `checkDebtWarnings` mangler is_bank filter + per-team try/catch** (cron #5) → ✅ FIXED via [#613](https://github.com/NicolaiDolmer/CyclingZone/issues/613) (P1-B fix i #607/#611 missede disse to robusthedshul; spawnet som separat issue)
- Filter + per-team try/catch tilføjet. Mirror af `fireDeadlineWarnings`-pattern fra [PR #612](https://github.com/NicolaiDolmer/CyclingZone/pull/612).

### Forward-guards — allerede tracked

| Issue | Status | Relevans |
|---|---|---|
| [#542](https://github.com/NicolaiDolmer/CyclingZone/issues/542) | open | lifecycle_phase enum eliminerer compound-filters i crons #2, #3, #4 |
| [#543](https://github.com/NicolaiDolmer/CyclingZone/issues/543) | open | season_transition_paused admin-håndsving — gør cron #4 stoppelig uden code-deploy |
| [#544](https://github.com/NicolaiDolmer/CyclingZone/issues/544) | open | closed_at manual deletion edge case — risiko i alle 3 crons der filtrerer på closed_at |
| [#330](https://github.com/NicolaiDolmer/CyclingZone/issues/330) | open | multi-instance cron-locking — addresses #1 (auction-finalize overlap) bredt |
| [#577](https://github.com/NicolaiDolmer/CyclingZone/issues/577) | closed | negative-interest payroll idempotency (handled) |
| [#578](https://github.com/NicolaiDolmer/CyclingZone/issues/578) | closed | season-transition partial-failure recovery (handled) |

### Mønstre worth lære fra

1. **`dailySeasonCountCheck`** (cron #8) er gold-standard for observability: passer `captureExceptionFn` + `sendWebhookFn` ind, alarm til Discord + Sentry, dokumenterer egen invariant. Replicate pattern i de andre crons.
2. **`finalizeExpiredAuctions`** (cron #1) er gold-standard for idempotency: per-item `idempotency_key` + `allowDuplicate: true` på alle finance-RPC calls. Pattern bør replikeres i squad-enforcement (P1-A).
3. **`processSeasonAutoTransitionCron`** (cron #4) viser at filter-eksplicitet + DB CHECK constraint giver defense-in-depth: 3 lag (kode-filter, DB constraint, regression-test). Pattern udvides naturligt af #542 (lifecycle_phase enum).

## Næste skridt

1. Spawn fix-issues for P1-A, P1-B, P1-C (separate, hver `vurder først`-flagget jf. mønsteret i [#577](https://github.com/NicolaiDolmer/CyclingZone/issues/577)/[#578](https://github.com/NicolaiDolmer/CyclingZone/issues/578)).
2. Spawn enhancement-issue for P2-A (Sentry-capture pattern).
3. Notér P2-C på [#542](https://github.com/NicolaiDolmer/CyclingZone/issues/542) (dæk eksisterende issue).
4. Luk [#545](https://github.com/NicolaiDolmer/CyclingZone/issues/545) som completed (objektiv verifikation: review-doc leveret + fix-issues spawned).
