# Ultrareview prompt — Economy/Finalization-paths (CyclingZone)

> Genbrugelig template til `/ultrareview` på PRs/branches der rører economy
> eller finalization-paths. Designet 2026-05-17 baseret på #3 i ultrareview
> ROI-prioritering. Opdatér når invarianter ændres eller nye safety-learnings
> tilkommer (`.claude/learnings/`).

## Framing
Du reviewer en CyclingZone-PR/branch der rører **economy- og finalization-paths**.
Brug `docs/GAME_INVARIANTS.md` som primær linse. State-mutationer her er svære
at rulle tilbage i prod (data allerede skrevet, brugere allerede påvirket),
så false-negatives koster mere end false-positives.

## Severity-skala
- **P0** — Block merge. Invariant brudt, data-corruption-risiko, ekstern API-kontrakt brudt.
- **P1** — Fix before merge. Symmetri-/safety-bug, race, manglende rollback.
- **P2** — Nice to have. Observability-gap, manglende test-edge, micro-refactor.
- **P3** — Informational. Observation/spørgsmål uden actionable fix.

## Tier 1 — Invariant violations (P0 default)
Tjek mod `docs/GAME_INVARIANTS.md`:
- Economy-konstanter rørt uden tilsvarende ADR i `docs/decisions/`:
  - `DEFAULT_BETA_BALANCE = 800_000`
  - `sponsor = 240_000`
  - `SALARY_RATE = 0.10`
  - Gældsloft: D1=1.2M · D2=900K · D3=600K
- Finalization-logik duplikeret i `backend/routes/api.js` eller `backend/cron.js`
  i stedet for delegeret til `backend/lib/auctionFinalization.js`
- AI/bank/frozen managers får board-state (board features SKAL være manager-only)
- `/api/admin/import-results-pcm` kontrakt brudt: multipart `files[]` (maks 30)
  + 10MB memory-loft pr. fil (Excel-/Sheets-import fjernet 2026-06-12, #1179/#1180)

## Tier 2 — Symmetri & safety (P0–P1)
Per learning `2026-05-08-auction-safety-bundled-fixes.md`:
- **Asymmetriske guards på symmetriske endpoints** — hvis ny route deler intent
  med eksisterende (bid/proxy, finalize-cron/finalize-manual): tjek owner-checks,
  rate-limits, validation matcher.
- **`.catch(() => {})` fire-and-forget** der swallower fejl uden trace.
- **Idempotency** — re-trigger af finalization må ikke double-deduct salary
  eller double-credit sponsor.
- **Rollback-safety** — hvis partial-finalization crasher midtvejs, er state
  konsistent eller efterlader vi orphans?

## Tier 3 — Concurrency & timing (P1)
- **Race conditions** mellem cron-finalization og bruger-action (bid placed
  mens cron afslutter samme auktion).
- **Timezone-bugs** (UTC vs CET) — per `2026-05-07-auction-timezone-utc-vs-cet.md`.
  Alle deadline-sammenligninger skal være eksplicit timezone-aware.
- **RLS-policies** dækker nye economy-tabeller/-kolonner for `authenticated` rolle
  (ikke kun `service_role`).
- **Locking** ved samtidige writes på samme `rider_id`/`manager_id`.

## Tier 4 — Observability (P2)
- Logging på nye silent paths (`.catch`-handlers skal logge:
  `console.error("[ctx]", { meta, e })`).
- Auditerbar trail for economy-mutationer: hvem trak hvad fra hvilken konto,
  hvornår, hvilken trigger.

## Tier 5 — Test coverage (P2)
- Backend-tests dækker både happy path OG rollback-path.
- Edge cases: 0-balance, gældsloft-grænse ±1, deadline-sekund-edge,
  samtidige bids på sidste sekund.

## Primary attention-zones (hybrid)
Kerne-filer at læse FØR diff'en (minimum, ikke maksimum):
- `backend/lib/auctionFinalization.js` — finalization single-source-of-truth
- `backend/lib/auctionEngine.js` + `backend/lib/proxyBidding.js` — bid/proxy-logik
- `backend/lib/loanEngine.js` — debt-ceiling + TOCTOU (jf. #45 slice-07b)
- `backend/lib/sponsorEngine.js` + `backend/lib/prizePayoutEngine.js` — sponsor/præmie-credit
- `backend/lib/seasonTransition.js` + `backend/lib/seasonFinanceReport.js` — sæson-finalization
- `backend/lib/balanceRpc.js` + `backend/lib/economyConstants.js` + `backend/lib/economyInvariants.test.js`
- `backend/routes/api.js` (route-laget, søg efter `/api/auctions`, `/api/loans`, `/api/admin/import-results-pcm`)
- `backend/cron.js` (finalization cron-jobs)
- `docs/GAME_INVARIANTS.md`

Udvid selv til relaterede helpers, RLS-migrations, tests.

## Output-format
Group findings pr. tier (1–5). Inden for hver tier: sortér severity P0→P3.

Per finding:
```
[Pn][Tier N] <one-line title>
File: <path>:<line>
Issue: <max 2 sentences>
Suggested fix: <max 2 sentences ELLER patch-diff>
```

Hvis en tier er clean: skriv eksplicit `Tier N: ingen findings.` — pad ikke noise.

## Scope-guard (ignorér)
- i18n-keys/oversættelser medmindre de ændrer economy-strings eller invariant-doks
- Pure styling/CSS
- Docs-only ændringer (samme undtagelse)
- Test-only refactors uden adfærdsændring

## Runtime placeholders
Erstat før fyring:
- `<PR#>` — GitHub PR-nummer (eller `<BRANCH>` hvis lokal)
- `<SPECIFIC_CONCERN>` — (valgfri) én sætning om hvad DU er mest bekymret for.
  Fx: "Ny cron-path til mid-season finalization — bange for double-finalize
  hvis cron retrier."

## Sådan bruges
1. Åbn issue/PR der rører economy/finalization
2. Kopiér denne prompt + erstat placeholders
3. Fyr `/ultrareview <PR#>` og paste prompten som første follow-up message
4. Vurder findings: P0/P1 fixes før merge; P2/P3 i issue-tracker

> **Usikkerhed:** `/ultrareview`'s præcise UX for custom-prompts er ikke verificeret.
> Hvis (a) follow-up message ikke virker, prøv (b) paste i PR-body før triggering
> eller (c) check `/ultrareview --help`. Opdatér denne sektion efter første live-kørsel.
