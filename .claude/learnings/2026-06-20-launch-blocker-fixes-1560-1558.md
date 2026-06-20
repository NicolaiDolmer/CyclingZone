# 2026-06-20 — To forever-relaunch launch-blockers: tom-trup (#1560) + akademi-race (#1558)

To bugs fundet i natbølge-audit 19→20/6, fixet 20/6. Begge har en genbrugbar lektie.

## #1560 — Setup-logik bagt ind i et engangs-script, ikke i runtime-flowet

**Symptom:** Nye hold oprettet *efter* relaunchen fik 0 ryttere (tom-trup blindgyde).

**Rod-årsag:** Starter-trup-allokering (`runStarterSquadAllocation`) blev kun kaldt fra relaunch-orchestratoren (engangs-script). Den normale hold-oprettelse (`upsertOwnTeamProfile`) tildelte aldrig ryttere. Relaunch-holdene så "rigtige" ud, så bug'en var usynlig indtil næste *nye* signup.

**Lektie (genbrugbar):** Når et engangs-migrations-/seed-script udfører setup som det *normale runtime-flow også burde gøre*, så **udtræk den delte logik til runtime-stien** — lad ikke scriptet være den eneste caller. Ellers er enhver entitet skabt efter scriptet brudt. Symptomet er usynligt netop fordi de script-skabte entiteter er korrekte.

**Forward-guard:** `allocateStarterSquadForTeam` (single-team) deler nu kerne-generering med relaunch-allokeringen → kan ikke drifte. Integrations-test: `created===true` udløser allokering.

**Restrisiko (→ #1563):** allokeringen er ikke transaktionel; en delvis fejl + idempotens-guard (≥1 rytter → no-op) kan efterlade <8 ryttere uden auto-heal. Lav sandsynlighed; hærdning tracket.

## #1558 — Divergerende idempotency-keys giver INGEN cross-path-beskyttelse

**Symptom:** Køber kunne debiteres uden at få ungdomsrytteren (eneste penge-tabs-sted).

**Rod-årsag (to lag):**
1. **Cross-path idempotency-svigt:** `finalizeYouthAuctionRecord` brugte key `youth_auction_winner:<id>`; `signAcademyCandidate` brugte type `academy_signing` med **INGEN key**. To forskellige (eller manglende) keys → to separate `finance_transactions` → dobbelt-debit. Idempotency-key beskytter kun *inden for samme key-namespace*.
2. **TOCTOU på cap:** alle tre akademi-stier lavede et ulåst `getTeamAcademyCount()` (SELECT) → write. Låsen sad kun inde i balance-RPC'en og spændte ikke over count-tjek + rider-update.

**Lektie (genbrugbar):**
- **Idempotency ≠ concurrency-beskyttelse.** En idempotency-key deduplikerer kun retries *på samme sti med samme key*. To stier der håndhæver samme invariant skal dele en **lås** (atomær RPC), ikke bare hver sin key.
- **En lås skal spænde over hele check→write**, ikke kun selve skrivningen. Ulåst count-check + write er en TOCTOU-race uanset om writet selv er atomisk.

**Fix:** atomær `finalize_academy_acquisition`-RPC under `pg_advisory_xact_lock(team_id)` (samme lock-nøgle som `increment_balance_with_audit`, så de serialiserer på samme team) der dækker count→saldo→rider-update→debit i én transaktion. Rider-update-guard (`team_id IS NULL OR is_academy = false`) lukker det omvendte tab. Migration → ejer-merget.

**Test-mønster:** `academyAcquisitionAtomicity.test.js` mocker advisory-låsen via per-team Promise-mutex (kopieret fra `balanceAtomicity.test.js`) — N parallelle kald → præcis ÉN lykkes, netto ÉN debit. Ægte plpgsql-concurrency verificeres mod prod-klon (kan ikke testes lokalt).

## Proces-note
Begge fixes bygget parallelt i isolerede worktrees (disjunkte filer efter at akademi-kuld blev scopet ud af #1560 for at undgå delt `academyIntake.js`). Re-plan (PLAN.md → forever-relaunch) kørt i samme session.
