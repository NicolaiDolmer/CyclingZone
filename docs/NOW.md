# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Ingen aktiv slice — 07b shipped LIVE 2026-05-07.** Næste kandidat: 07d (audit-log foundation) eller 07c (atomic balance updates). Brugeren prioriterer.

## Open beta status
**Open beta live siden 2026-05-04, sæson 1 aktiv, 0 sæsoner afsluttet.** ~18 managers (DB-tal). S-02 KOMPLET. 07a leveret som v2.50, **07b leveret som v2.51**. Alle 3 pre-kode-beslutninger til 07 låst 2026-05-07: (1) sponsor=240K, (2) konkurs-mekanik=light, (3) 07f aktiverer automatisk fra sæson 2.

## Senest leveret
*(2026-05-06 og tidligere arkiveret til [`docs/archive/NOW_HISTORIK_2026-05-06.md`](archive/NOW_HISTORIK_2026-05-06.md))*

- 2026-05-07: **Slice 07b v2.51 LIVE** ([#80](https://github.com/NicolaiDolmer/CyclingZone/issues/80), [PR #95](https://github.com/NicolaiDolmer/CyclingZone/pull/95), commit `a90128e`) — TOCTOU + idempotency. Migration `2026-05-07-economy-idempotency.sql` anvendt på prod: 4 partial UNIQUE indices (`uniq_{sponsor,salary,bonus}_per_team_season` + `uniq_loan_interest_per_loan_season`), `finance_transactions.related_loan_id`-kolonne, `create_loan_atomic` Postgres-RPC med `pg_advisory_xact_lock`. SOFT debt_ceiling-warning på `createEmergencyLoan` (light konkurs-mekanik lag 1). 1 historisk dublet ryddet (v2.49 sponsor-kompensering reklassificeret til `admin_adjustment`). 32/32 backend-tests grønne, smoke-test af `create_loan_atomic` live OK.
- 2026-05-06: **Cross-PC + workflow refactor** ([#67](https://github.com/NicolaiDolmer/CyclingZone/pull/67), commit `2265b33`) — preflight/migrate/setup-new-pc/install-user-hooks scripts + `cross-pc-stop-check.sh`. Bundlet med `#72` SessionStart-hook, `#68` PRODUCT_BACKLOG → GitHub-issues, og `#70` GitHub-first CLAUDE.md cold-start ~800 tok.
- 2026-05-07: **Slice 07a v2.50** — `backend/lib/economyConstants.js` med 7 delte konstanter; 299/299 backend-tests grønne.

## Næste session
1. **Vælg næste 07-slice:** anbefalet 07d (audit-log foundation, blokerer 07e dashboard) eller 07c (atomic balance updates, lukker resterende lost-update-races på `teams.balance`). Master-doc: [07-economy-overhaul-MASTER.md](slices/07-economy-overhaul-MASTER.md).
2. **Bug #45** dækket af #80 — luk efter du har verificeret manuelt at gældsloft holder.
3. **Live cron-verifikation af 07b** ved naturlig sæson-end: tjek 0 dubletter på sponsor/salary/bonus/loan_interest + alle nye `loan_interest`-rows har `related_loan_id` sat.
4. **PC #2 cross-PC verifikation** når sessionen flyttes — kør `scripts/preflight-check.ps1`.
5. **Tier 4 Discord-arkivering:** 2 tråde manuel close (`1500927555731984567` + `1501473256417267722`).

## Kritiske invarianter
- **Verificér runtime FØR claim** — grep før TODO-claims
- **Skaler for variabelt manager-tal** — ingen hardcoded antal (vokser løbende fra ~19)
- **Build on top, don't replace** — bevar eksisterende strukturer, tilføj ved siden af
- Economy: SALARY_RATE=0.10 (DB-GENERATED, kan ikke skrives fra app), sponsor 240K (matcher DB-default; samlet i `backend/lib/economyConstants.js` siden v2.50), gældsloft D1/D2/D3=1.2M/900K/600K
- UCI-sync må aldrig nulle high-value ryttere (popularity≥70 OR uci_points≥100 auto-protected)
- `applyRaceResults` udbetaler IKKE præmier — kun `prizePayoutEngine.paySeasonPrizesToDate`
- AI/bank/frozen får ALDRIG board-state (members, identity_basis, dna, consequences) — manager-only per Q-batch 1A Q8
- **Discord-GitHub bridge:** images via `scripts/sync-discord-attachments.js` → commit + push → reference via `raw.githubusercontent.com`. Token i `.mcp.json` (gitignored). MCP-write-403 kendt — brug `gh` CLI fallback.
